require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const tmi     = require('tmi.js');

// —— Validate and load environment variables ——
const {
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_CHANNEL,
  THRESHOLD,
  POLL_INTERVAL,
  PORT
} = process.env;

if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_CHANNEL || !THRESHOLD || !POLL_INTERVAL || !PORT) {
  console.error('❌ Missing required environment variables. Please check your .env file.');
  process.exit(1);
}

// —— Parse numeric configs ——
const threshold    = Number(THRESHOLD);
const pollInterval = Number(POLL_INTERVAL);
const port         = Number(PORT);

// —— Twitch rate limit (default: 800 req/min) ——
const HELIX_RATE_LIMIT_PER_MINUTE = 800;
const minHelixInterval = Math.ceil(60000 / HELIX_RATE_LIMIT_PER_MINUTE);
const interval = Math.max(pollInterval, minHelixInterval);

let accessToken = process.env.TWITCH_ACCESS_TOKEN || '';
let viewers     = 0;
let chatters    = new Set();

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
chatClient.on('chat', (_, userstate) => chatters.add(userstate.username));

// —— Twitch Helix helpers ——
async function refreshAccessToken() {
  const url    = 'https://id.twitch.tv/oauth2/token';
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID,
    client_secret: TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  const res    = await axios.post(`${url}?${params}`);
  accessToken  = res.data.access_token;
}

async function fetchViewerCount() {
  const res = await axios.get(
    `https://api.twitch.tv/helix/streams?user_login=${TWITCH_CHANNEL}`, {
      headers: {
        'Client-ID': TWITCH_CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`
      }
    }
  );
  viewers = res.data.data[0]?.viewer_count || 0;
}

// —— Periodic polling ——
console.log(`🔄 Polling every ${interval}ms (min safe: ${minHelixInterval}ms)`);
setInterval(async () => {
  try {
    if (!accessToken) await refreshAccessToken();
    await fetchViewerCount();
    console.log(`Viewers: ${viewers}, Chatters: ${chatters.size}`);
    chatters.clear();
  } catch (err) {
    console.error('🚨 Error polling Twitch API:', err.message);
  }
}, interval);

// —— Stats endpoint ——
const app = express();
app.get('/stats', (req, res) => {
  const chatterCount = chatters.size;
  const organic      = Math.min(viewers, chatterCount * threshold);
  const artificial   = Math.max(0, viewers - organic);
  res.json({ total_viewers: viewers, unique_chatters: chatterCount, organic_viewers: organic, artificial_viewers: artificial });
});
app.listen(port, () => console.log(`🚀 Running on http://localhost:${port}/stats`));