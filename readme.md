# Twitch Viewbot Protection

Lightweight, open‑source Node.js service that detects and separates **organic** vs **artificial** viewers on a Twitch stream.

---

## 🚀 Getting Started

## Make sure to have `NODEJS` installed.
- I recommend `LTS`
- [https://nodejs.org/en](https://nodejs.org/en)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure `.env`

Open the included `.env` file and fill in **your** Twitch credentials and settings. It already lives in the repo—no copying needed.

```ini
# Twitch API credentials
TWITCH_CLIENT_ID=YOUR_CLIENT_ID
TWITCH_CLIENT_SECRET=YOUR_CLIENT_SECRET
TWITCH_ACCESS_TOKEN=YOUR_OAUTH_TOKEN  # optional; auto-refreshes if blank

# The channel you moderate (no leading #)
TWITCH_CHANNEL=your_channel_name

# Chatters-per-organic-view threshold
THRESHOLD=2

# Server & polling settings
PORT=3000
POLL_INTERVAL=15000    # in milliseconds (default: 15000 = 15s)
```

---

## ▶️ Run the Service

```bash
npm start
# (runs `node src/index.js`)
```

You’ll see console logs like:

```
✔️ Connected to #your_channel_name chat
🚀 Running on http://localhost:3000/stats
Viewers: 120, Chatters: 30
```

---

## 📊 Stats Endpoint

Once running, request:

```
GET http://localhost:3000/stats
```

Returns JSON:

```json
{
  "total_viewers": 120,
  "unique_chatters": 30,
  "organic_viewers": 60,
  "artificial_viewers": 60
}
```

* **organic\_viewers** = `min(total_viewers, unique_chatters × THRESHOLD)`
* **artificial\_viewers** = `total_viewers − organic_viewers`

---

## 🔧 How It Works

1. **Chat Listener**
   Uses `tmi.js` to collect unique chatter usernames each interval.

2. **Helix API Polling**
   Uses your `CLIENT_ID` & `CLIENT_SECRET` to get an app token, then fetches `viewer_count` for `TWITCH_CHANNEL` every `POLL_INTERVAL`.

3. **Calculation**

   ```js
   organic    = Math.min(viewer_count, unique_chatters * THRESHOLD)
   artificial = viewer_count - organic
   ```

4. **JSON API**
   Exposes `/stats` on the port you choose.

---

## ⚙️ Environment Variables

| Name                   | Description                                |
| ---------------------- | ------------------------------------------ |
| `TWITCH_CLIENT_ID`     | Your Twitch Developer App Client ID        |
| `TWITCH_CLIENT_SECRET` | Your Twitch Developer App Client Secret    |
| `TWITCH_ACCESS_TOKEN`  | (Optional) App Access Token; auto-refresh  |
| `TWITCH_CHANNEL`       | Channel name you moderate (no leading `#`) |
| `THRESHOLD`            | Chatters-per-organic-view multiplier       |
| `POLL_INTERVAL`        | Poll interval in ms (default: `15000`)     |
| `PORT`                 | HTTP port for the `/stats` endpoint        |

---

## 🔄 Customization

* Tweak **THRESHOLD** for stricter/looser “organic” detection.
* Adjust **POLL\_INTERVAL** for more/less frequent updates.
* Extend `src/index.js` with follower‑spike detection, geo‑filters, dashboards, or webhook alerts.

---

## 🛡️ Security

* Keep your `.env` credentials private.
* Rotate tokens and secrets regularly.

---

## 📄 License

MIT © Your Name
