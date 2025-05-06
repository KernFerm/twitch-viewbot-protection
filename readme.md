# Twitch Viewbot Protection

A **real-time monitoring and analytics** Node.js service that tracks viewer and chat activity, detects bot-like behavior, and separates **organic** vs **artificial** viewers on your Twitch stream.

---

## 📖 What It Does

* **Chat Listener**: Captures unique chatters and message frequency using `tmi.js`.
* **Viewer Polling**: Queries the Twitch Helix API for live viewer counts at configurable intervals.
* **Caching**: Reduces API calls with smart TTLs that adjust based on viewer volume.
* **Spike & Anomaly Detection**: Uses moving averages and raid/host event hooks to identify sudden changes.
* **Dynamic Thresholds**: Adapts “organic” viewer calculation using historical chat-to-viewer ratios.
* **Persistent Storage**: Logs stats to SQLite for long-term trend analysis.
* **Prometheus Metrics**: Exposes gauges and counters for integration with monitoring systems.
* **Rate Limiting & Security**: Filters known bot accounts, rate‑limits API access per IP, and supports graceful shutdowns.
* **Alerts & Web UI**: (Optional) Send anomaly alerts via Discord webhooks and serve a live dashboard from `/public`.

---

## 🚀 Getting Started

### Prerequisites

Make sure you have **Node.js** installed:

* I recommend the **LTS** version.
* Download from [Node.js Official Website](https://nodejs.org/en)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure `.env`

Open the included `.env` file and fill in **your** Twitch credentials and settings. It already exists in the repo — no need to copy it.

```ini
# Cache Settings
CACHE_TTL=60000                # Default Cache TTL (ms)
CACHE_TTL_HIGH_VIEWERS=30000   # Cache TTL when viewers are high (ms)
VIEWERS_THRESHOLD=5000         # Threshold above which TTL is reduced

# Twitch API credentials
TWITCH_CLIENT_ID=YOUR_CLIENT_ID
TWITCH_CLIENT_SECRET=YOUR_CLIENT_SECRET
TWITCH_ACCESS_TOKEN=YOUR_OAUTH_TOKEN  # optional; auto-refreshes if blank
BROADCASTER_ID=YOUR_BROADCASTER_ID    # Numeric channel ID
DISCORD_WEBHOOK_URL=YOUR_DISCORD_WEBHOOK_URL  # optional; anomaly alerts

# Bot & rate limiting
BOT_BLACKLIST=bot1,bot2,bot3        # comma-separated bot usernames to ignore
IP_RATE_LIMIT=100                   # max requests per interval per IP

# Channel & thresholds
TWITCH_CHANNEL=your_channel_name
THRESHOLD=2                         # Chatters-per-organic-view multiplier

# Server & polling settings
PORT=3000
POLL_INTERVAL=15000                 # Poll interval in ms (default: 15000)
```

---

## ▶️ Run the Service

```bash
npm start
# (runs `node src/index.js`)
```

Console output:

```
✔️ Connected to #your_channel_name chat
🚀 Running on http://localhost:3000
```

---

## 📊 Endpoints

* **Stats**: `GET /stats`
  Returns JSON:

  ```json
  {
    "total_viewers":120,
    "unique_chatters":30,
    "organic_viewers":60,
    "artificial_viewers":60,
    "spike_detected":false,
    "raid_viewers":0,
    "host_viewers":0
  }
  ```

* **Metrics**: `GET /metrics`
  Exposes Prometheus-formatted metrics.

* **Health**: `GET /health`
  Returns `OK` if the service is running.

---

## 🔧 How It Works

1. **Chat Listener**
   Collects chatters and message counts, filters known bots.
2. **Helix API Polling**
   Uses OAuth tokens to fetch viewer counts periodically.
3. **Caching & TTL**
   Configurable cache durations reduce API load, adjusting for spikes.
4. **Detection**

   * **Moving Average** for anomaly/spike detection.
   * **Raid/Host Hooks** for large influx tracking.
   * **Dynamic Threshold** for organic viewer calculation.
5. **Storage & Metrics**
   Logs to SQLite; exposes Prometheus metrics for dashboards and alerts.

---

## 🔄 Customization

* **Thresholds**: Tweak `THRESHOLD`, `CACHE_TTL`, `VIEWERS_THRESHOLD` to tune detection.
* **Alerts**: Configure `DISCORD_WEBHOOK_URL` for real-time notifications.
* **Dashboard**: Place static files in `/public` to serve a live UI.
* **Storage**: Swap SQLite for another DB or export logs as needed.

---

## 🛡️ Security & Performance

* Keep `.env` secrets private and rotate regularly.
* Use `BOT_BLACKLIST` to ignore known bot accounts.
* Rate-limit API and IP requests to prevent abuse.
* Gracefully handle shutdowns for zero downtime.

---

## 📄 License

MIT © BubblesTheDev
