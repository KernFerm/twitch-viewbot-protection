require('dotenv').config();
const express = require('express');
const axios = require('axios');
const tmi = require('tmi.js');
const cors = require('cors');

// —— Validate and load environment variables ——
const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_CHANNEL,
  THRESHOLD,
  POLL_INTERVAL,
  PORT,
  CACHE_TTL = 60000,              // Default Cache TTL (ms)
  CACHE_TTL_HIGH_VIEWERS = 30000, // Cache TTL when viewers are high (ms)
  VIEWERS_THRESHOLD = 5000        // Threshold above which TTL is reduced
} = process.env;

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_CHANNEL || !THRESHOLD || !POLL_INTERVAL || !PORT) {
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

// —— Twitch rate limit (default: 800 req/min) ——
const HELIX_RATE_LIMIT_PER_MINUTE = 800;
const minHelixInterval = Math.ceil(60000 / HELIX_RATE_LIMIT_PER_MINUTE);
const interval = Math.max(pollInterval, minHelixInterval);

// —— State and history for detection ——
let accessToken = process.env.TWITCH_ACCESS_TOKEN || '';
let tokenExpiry = Date.now();
let viewers = 0;
let cachedViewerCount = 0;
let lastFetchedTime = 0;
const cachedChatters = new Set();

// History arrays for moving averages
const viewerHistory = [];
const chatterHistory = [];
const HISTORY_LENGTH = 10; // Number of intervals to keep

let lastStats = {
  total_viewers: 0,
  unique_chatters: 0,
  organic_viewers: 0,
  artificial_viewers: 0,
  spike_detected: false
};

// —— Axios retry on 429 rate limit ——
axios.interceptors.response.use(
  response => response,
  async error => {
    if (error.response?.status === 429) {
      console.warn('⚠️ Rate limit hit. Backing off...');
      await new Promise(res => setTimeout(res, minHelixInterval));
      return axios(error.config);
    }
    return Promise.reject(error);
  }
);

// —— Chat listener ——
const chatClient = new tmi.Client({ channels: [TWITCH_CHANNEL] });
chatClient.connect()
  .then(() => console.log(`✔️ Connected to #${TWITCH_CHANNEL} chat`))
  .catch(console.error);
chatClient.on('chat', (_, userstate) => {
  cachedChatters.add(userstate.username);
});

// —— Twitch Helix helpers ——
async function refreshAccessToken() {
  const url = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  try {
    const res = await axios.post(`${url}?${params}`);
    accessToken = res.data.access_token;
    tokenExpiry = Date.now() + res.data.expires_in * 1000;
    console.log('🔑 Access token refreshed');
  } catch (err) {
    console.error('🚨 Error refreshing access token:', err.message);
  }
}

async function fetchViewerCount() {
  if (Date.now() > tokenExpiry - 60000) {
    await refreshAccessToken();
  }
  const currentCacheTTL = viewers > viewersThreshold ? cacheTTLHighViewers : cacheTTL;
  if (Date.now() - lastFetchedTime > currentCacheTTL) {
    try {
      const res = await axios.get(
        `https://api.twitch.tv/helix/streams?user_login=${TWITCH_CHANNEL}`,
        {
          headers: {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`
          }
        }
      );
      cachedViewerCount = res.data.data[0]?.viewer_count || 0;
      lastFetchedTime = Date.now();
    } catch (err) {
      console.error('🚨 Error fetching viewer count:', err.message);
    }
  }
  viewers = cachedViewerCount;
}

// —— Periodic polling and improved artificial detection ——
console.log(`🔄 Polling every ${interval}ms (min safe: ${minHelixInterval}ms)`);
setInterval(async () => {
  await fetchViewerCount();

  const chatterCount = cachedChatters.size;
  // Update history
  viewerHistory.push(viewers);
  chatterHistory.push(chatterCount);
  if (viewerHistory.length > HISTORY_LENGTH) viewerHistory.shift();
  if (chatterHistory.length > HISTORY_LENGTH) chatterHistory.shift();

  // Calculate moving averages
  const avgViewers = viewerHistory.reduce((sum, v) => sum + v, 0) / viewerHistory.length;
  const avgChatters = chatterHistory.reduce((sum, c) => sum + c, 0) / chatterHistory.length;

  // Spike detection: if viewers exceed 1.5x average
  const spikeDetected = viewers > avgViewers * 1.5;

  // Improved organic calculation
  let organic;
  if (spikeDetected) {
    organic = Math.min(viewers, avgChatters * threshold);
  } else {
    organic = Math.min(viewers, chatterCount * threshold);
  }
  const artificial = Math.max(0, viewers - organic);

  lastStats = {
    total_viewers: viewers,
    unique_chatters: chatterCount,
    organic_viewers: Math.round(organic),
    artificial_viewers: Math.round(artificial),
    spike_detected: spikeDetected
  };

  console.log(`Stats:`, lastStats);
  cachedChatters.clear();
}, interval);

// —— Stats endpoint ——
const app = express();
app.use(cors());
app.get('/stats', (req, res) => {
  res.json(lastStats);
});
app.listen(port, () => console.log(`🚀 Running on http://localhost:${port}/stats`));
