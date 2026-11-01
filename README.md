# GhostMail — Custom Domain Disposable Email & OTP Client

A lightweight, self-hosted temporary email client built to generate disposable email addresses under your own custom domain, instantly receive verification codes / OTPs, and auto-scrap or manually delete them after use.

---

## Features

- **Custom Domain Support**: Create temporary addresses like `tiger-8421@yourdomain.com` or custom aliases like `netflix-test@yourdomain.com`.
- **Dual Inbound Mechanism**:
  - **Cloudflare Email Routing Webhook**: Free, no port 25 blocking, spam-filtered, turnkey Cloudflare Worker script included.
  - **Direct SMTP Server**: Built-in Node.js SMTP server running on configurable port (2525 / 25) with MX records.
- **Smart OTP Auto-Extraction**: Automatically parses emails for 4-to-8 digit verification codes and displays a prominent **One-Click Copy OTP Hero Banner**.
- **Real-Time Live Updates**: Push delivery powered by WebSockets — no manual refreshing needed.
- **Instant Audio & Visual Alerts**: Synthesized chime & glowing indicators when new OTPs arrive.
- **Auto-Destruct & Manual Scrap**:
  - Configurable countdown timer (10m, 30m, 1h, 24h, or permanent).
  - Background ticker destroys expired inboxes and purges stored emails.
  - One-click "Scrap Now" button to immediately wipe any mailbox.
  - "+15 Min" button to extend lifespan on the fly.
- **Multi-Inbox Support**: Run and monitor multiple disposable inboxes concurrently in the sidebar.
- **Zero-Config Test Simulator**: Click "Simulate OTP" in the top bar to mock realistic inbound emails from Google, GitHub, or Discord immediately.

---

## Quick Start (Running Locally)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure `.env`
Edit `.env` (or use the in-app domain modal):
```env
PORT=3000
SMTP_PORT=2525
DOMAIN=yourdomain.com
```

### 3. Start the Server
```bash
node server.js
```

Open `http://localhost:3000` in your browser.

---

## Connecting Your Custom Domain

See detailed instructions in [`cloudflare/README.md`](./cloudflare/README.md).

### Method A: Cloudflare Email Routing (Recommended)
1. In Cloudflare Dashboard -> **Email Routing**, enable routing for your domain.
2. In **Workers & Pages**, deploy the script from `cloudflare/worker.js` with `WEBHOOK_URL` set to `https://your-server.com/api/webhook/email`.
3. Set your Catch-All rule in Email Routing to send to this Worker.
4. Done! Every email sent to your domain routes directly to GhostMail with zero port 25 restrictions.

### Method B: Direct SMTP (VPS with Port 25)
1. Add an `A` record: `mail.yourdomain.com` -> `<VPS_IP>`
2. Add an `MX` record: `@` -> `mail.yourdomain.com` (Priority 10)
3. Redirect port 25 to 2525 on Linux:
   ```bash
   sudo iptables -t nat -A PREROUTING -p tcp --dport 25 -j REDIRECT --to-port 2525
   ```
4. Start `server.js`!

---

## Project Structure

```
├── server.js              # Express API, WebSockets, SMTP listener, OTP parser
├── package.json           # Dependencies (express, smtp-server, mailparser, ws)
├── .env                   # Port and domain settings
├── public/
│   ├── index.html         # Modern web interface
│   ├── style.css          # Glassmorphic dark styling & animations
│   └── app.js             # Client state, WebSocket live sync, audio chime
├── cloudflare/
│   ├── worker.js          # Cloudflare Email Routing worker
│   └── README.md          # Domain DNS & routing setup guide
└── data/
    └── store.json         # Auto-saved inboxes and messages
```
