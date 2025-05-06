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
  CACHE_TTL = 60000, // Default Cache TTL (Time-To-Live) in milliseconds
  CACHE_TTL_HIGH_VIEWERS = 30000, // Cache TTL when viewers are high
  VIEWERS_THRESHOLD = 5000 // Threshold above which TTL will be reduced
} = process.env;

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_CHANNEL || !THRESHOLD || !POLL_INTERVAL || !PORT) {
  console.error('❌ Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// —— Parse numeric configs —— 
const threshold = Number(THRESHOLD);
const pollInterval = Number(POLL_INTERVAL);
const port = Number(PORT);
const cacheTTL = Number(CACHE_TTL); // Cache TTL in milliseconds
const cacheTTLHighViewers = Number(CACHE_TTL_HIGH_VIEWERS); // Cache TTL for high viewers
const viewersThreshold = Number(VIEWERS_THRESHOLD); // Threshold above which TTL is shortened

// —— Twitch rate limit (default: 800 req/min) —— 
const HELIX_RATE_LIMIT_PER_MINUTE = 800;
const minHelixInterval = Math.ceil(60000 / HELIX_RATE_LIMIT_PER_MINUTE);
const interval = Math.max(pollInterval, minHelixInterval);

// —— Access token expiry check —— 
let accessToken = process.env.TWITCH_ACCESS_TOKEN || '';
let tokenExpiry = Date.now();
let viewers = 0;
let chatters = new Set();
let cachedViewerCount = 0;
let cachedChatters = new Set();
let lastFetchedTime = 0;

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
    tokenExpiry = Date.now() + res.data.expires_in * 1000; // Calculate token expiry time
    console.log('🔑 Access token refreshed');
  } catch (err) {
    console.error('🚨 Error refreshing access token:', err.message);
  }
}

async function fetchViewerCount() {
  // Check if the token is about to expire
  if (Date.now() > tokenExpiry - 60000) {  // Refresh token 1 minute before expiry
    await refreshAccessToken();
  }

  // Adjust Cache TTL based on viewer count
  const currentCacheTTL = viewers > viewersThreshold ? cacheTTLHighViewers : cacheTTL;

  // Caching logic: only fetch viewer count if it has expired or if a certain TTL has passed
  if (Date.now() - lastFetchedTime > currentCacheTTL) {
    try {
      const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${TWITCH_CHANNEL}`, {
        headers: {
          'Client-ID': TWITCH_CLIENT_ID,
          'Authorization': `Bearer ${accessToken}`
        }
      });
      cachedViewerCount = res.data.data[0]?.viewer_count || 0;
      lastFetchedTime = Date.now();
    } catch (err) {
      console.error('🚨 Error fetching viewer count:', err.message);
    }
  }

  viewers = cachedViewerCount; // Use cached viewer count
}

// —— Periodic polling —— 
console.log(`🔄 Polling every ${interval}ms (min safe: ${minHelixInterval}ms)`);
setInterval(async () => {
  try {
    await fetchViewerCount();
    console.log(`Viewers: ${viewers}, Chatters: ${cachedChatters.size}`);
    cachedChatters.clear(); // Clear cached chatters periodically
  } catch (err) {
    console.error('🚨 Error polling Twitch API:', err.message);
  }
}, interval);

// —— Stats endpoint —— 
const app = express();
app.use(cors());  // Enable CORS
app.get('/stats', (req, res) => {
  const chatterCount = cachedChatters.size;
  const organic = Math.min(viewers, chatterCount * threshold);
  const artificial = Math.max(0, viewers - organic);
  res.json({
    total_viewers: viewers,
    unique_chatters: chatterCount,
    organic_viewers: organic,
    artificial_viewers: artificial
  });
});
app.listen(port, () => console.log(`🚀 Running on http://localhost:${port}/stats`));
