require('dotenv').config();
const express = require('express');
const axios = require('axios');
const tmi = require('tmi.js');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { Counter, Gauge, register } = require('prom-client');

// —— Validate and load environment variables ——
const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_CHANNEL,
  BROADCASTER_ID,
  THRESHOLD,
  POLL_INTERVAL,
  PORT,
  CACHE_TTL = 60000,              // Default Cache TTL (ms)
  CACHE_TTL_HIGH_VIEWERS = 30000, // Cache TTL when viewers are high (ms)
  VIEWERS_THRESHOLD = 5000,       // Threshold above which TTL is reduced
  DISCORD_WEBHOOK_URL,
  BOT_BLACKLIST = '',             // Comma-separated bot usernames
  IP_RATE_LIMIT = 100             // Max requests per interval per IP
} = process.env;

// Required checks
if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_CHANNEL || !BROADCASTER_ID || !THRESHOLD || !POLL_INTERVAL || !PORT) {
  console.error('❌ Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// —— Parse numeric configs ——
const threshold = Number(THRESHOLD);
const pollInterval = Number(POLL_INTERVAL);
const port = Number(PORT);
const cacheTTL = Number(CACHE_TTL);
const cacheTTLHighViewers = Number(CACHE_TTL_HIGH_VIEWERS);
const viewersThreshold = Number(VIEWERS_THRESHOLD);
const ipRateLimit = Number(IP_RATE_LIMIT);
const botBlacklist = BOT_BLACKLIST.split(',').map(b => b.trim().toLowerCase());

// —— Twitch rate limit (default: 800 req/min) ——
const HELIX_RATE_LIMIT_PER_MINUTE = 800;
const minHelixInterval = Math.ceil(60000 / HELIX_RATE_LIMIT_PER_MINUTE);
const interval = Math.max(pollInterval, minHelixInterval);

// —— Initialize SQLite DB for persistent storage ——
const dbPath = path.resolve(__dirname, '../data/stats.db');
if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new sqlite3.Database(dbPath);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS stats (
    ts INTEGER, total_viewers INTEGER, unique_chatters INTEGER,
    organic_viewers INTEGER, artificial_viewers INTEGER,
    spike_detected INTEGER, raid_viewers INTEGER, host_viewers INTEGER
  )`);
});

// —— Prometheus metrics ——
const viewerGauge = new Gauge({ name: 'twitch_viewers', help: 'Twitch viewer count' });
const chatterGauge = new Gauge({ name: 'unique_chatters', help: 'Unique chatters count' });
const organicGauge = new Gauge({ name: 'organic_viewers', help: 'Organic viewers count' });
const artificialGauge = new Gauge({ name: 'artificial_viewers', help: 'Artificial viewers count' });
const anomalyCounter = new Counter({ name: 'anomaly_detected_total', help: 'Total anomaly/spike detections' });

// —— Rate limiting middleware ——
const ipCounts = new Map();
setInterval(() => ipCounts.clear(), interval);

// —— State and history ——
let accessToken = process.env.TWITCH_ACCESS_TOKEN || '';
let tokenExpiry = 0;
let viewers = 0;
let cachedViewerCount = 0;
let lastFetchedTime = 0;
const cachedChatters = new Set();
const chatCountMap = new Map();

// History arrays
const viewerHistory = [];
const chatterHistory = [];
const HISTORY_LENGTH = 10;
let lastStats = { raid_viewers: 0, host_viewers: 0, spike_detected: false };

// —— Axios retry on 429 ——
axios.interceptors.response.use(response => response, async err => {
  if (err.response?.status === 429) {
    await new Promise(res => setTimeout(res, minHelixInterval));
    return axios(err.config);
  }
  return Promise.reject(err);
});

// —— Chat listener & bot filtering ——
const chatClient = new tmi.Client({ channels: [TWITCH_CHANNEL] });
chatClient.connect()
  .then(() => console.log(`✔️ Connected to #${TWITCH_CHANNEL} chat`))
  .catch(console.error);
chatClient.on('chat', (channel, user, message) => {
  const uname = user.username.toLowerCase();
  if (!botBlacklist.includes(uname)) {
    cachedChatters.add(uname);
    chatCountMap.set(uname, (chatCountMap.get(uname) || 0) + 1);
  }
});

// —— Raid & host detection ——
chatClient.on('raided', (channel, username, raidViewers) => {
  lastStats.raid_viewers = raidViewers;
});
chatClient.on('hosted', (channel, username, hostViewers) => {
  lastStats.host_viewers = hostViewers;
});

// —— Refresh token helper ——
async function refreshAccessToken() {
  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({ client_id: TWITCH_CLIENT_ID, client_secret: TWITCH_CLIENT_SECRET, grant_type: 'client_credentials' });
  const res = await axios.post(`${url}?${params}`);
  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000;
}

// —— Fetch viewer count ——
async function fetchViewerCount() {
  if (Date.now() > tokenExpiry - 60000) await refreshAccessToken();
  const ttl = viewers > viewersThreshold ? cacheTTLHighViewers : cacheTTL;
  if (Date.now() - lastFetchedTime > ttl) {
    const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${TWITCH_CHANNEL}`, {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${accessToken}` }
    });
    cachedViewerCount = res.data.data[0]?.viewer_count || 0;
    lastFetchedTime = Date.now();
  }
  viewers = cachedViewerCount;
}

// —— Periodic polling ——
console.log(`🔄 Polling every ${interval}ms`);
setInterval(async () => {
  await fetchViewerCount();
  const chatterCount = cachedChatters.size;

  // Update history
  viewerHistory.push(viewers);
  chatterHistory.push(chatterCount);
  if (viewerHistory.length > HISTORY_LENGTH) viewerHistory.shift();
  if (chatterHistory.length > HISTORY_LENGTH) chatterHistory.shift();

  // Moving averages
  const avgViewers = viewerHistory.reduce((a,b) => a+b,0)/viewerHistory.length;
  const avgChatters = chatterHistory.reduce((a,b) => a+b,0)/chatterHistory.length;

  // Spike/anomaly detection (1.5x average)
  const spike = viewers > avgViewers * 1.5;
  if (spike) anomalyCounter.inc();

  // Dynamic threshold (example tuning)
  const dynamicThresh = Math.max(threshold, Math.ceil(avgChatters * 1.2));

  // Organic vs artificial
  const organic = spike
    ? Math.min(viewers, avgChatters * dynamicThresh)
    : Math.min(viewers, chatterCount * dynamicThresh);
  const artificial = Math.max(0, viewers - organic);

  // ADD YOUR MACHINE LEARNING BELOW !! if you have one for better results
  // ML anomaly placeholder
  // const mlAlert = mlAnomalyDetection(viewerHistory, chatterHistory);

  // Compose stats
  lastStats = {
    total_viewers: viewers, unique_chatters: chatterCount,
    organic_viewers: Math.round(organic), artificial_viewers: Math.round(artificial),
    spike_detected: spike, raid_viewers: lastStats.raid_viewers, host_viewers: lastStats.host_viewers
  };

  // Persist to DB
  db.run(`INSERT INTO stats VALUES (?,?,?,?,?,?,?,?)`, [
    Date.now(), viewers, chatterCount, Math.round(organic), Math.round(artificial), spike ? 1 : 0,
    lastStats.raid_viewers, lastStats.host_viewers
  ]);

  // Reset
  cachedChatters.clear();
  chatCountMap.clear();

}, interval);

// —— Express setup ——
const app = express();
app.use(cors());

// Rate limiting middleware
app.use((req, res, next) => {
  const ip = req.ip;
  const count = (ipCounts.get(ip) || 0) + 1;
  ipCounts.set(ip, count);
  if (count > ipRateLimit) return res.status(429).send('Too many requests');
  next();
});

// Serve Real-Time Dashboard (static files in /public)
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => res.send('OK'));

// Stats endpoint
app.get('/stats', (req, res) => res.json(lastStats));

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Start server
const server = app.listen(port, () => console.log(`🚀 Running on http://localhost:${port}`));

// Graceful shutdown
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
  console.log('Shutting down...');
  server.close();
  db.close();
  process.exit(0);
}));
