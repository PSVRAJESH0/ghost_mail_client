# GhostMail Production Deployment Guide

This guide details all production deployment strategies for **GhostMail**, from free serverless email routing to containerized Docker and dedicated VPS hosting.

---

## Architecture Overview

GhostMail consists of:
1. **Node.js Web & API Server** (Port `3000`): Serves the glassmorphic UI, REST APIs, and WebSockets (`/ws`) for instant push updates.
2. **Inbound Webhook Endpoint** (`POST /api/webhook/email`): Receives RFC822 MIME emails forwarded from Cloudflare Email Routing or other mail services.
3. **Direct SMTP Server** (Port `2525` / `25`): Listens for direct inbound MX email delivery with built-in MIME parsing and OTP extraction.
4. **Persistent JSON Store** (`data/store.json`): Stores inboxes, active countdown timers, and messages across restarts.

---

## Deployment Option 1: Cloudflare Email Routing + Worker (Recommended)

> **Best for**: 100% free hosting, no open ports, zero port-25 ISP blocking, automated spam filtering.

### 1. Cloudflare DNS & Email Routing Setup
1. In Cloudflare Dashboard, select your domain (e.g. `psvrajesh.in`).
2. Go to **Email Routing** -> click **Get Started**.
3. Allow Cloudflare to automatically create the required MX records (`mx1.cloudflare.net`, etc.) and SPF record (`v=spf1 include:_spf.mx.cloudflare.net ~all`).

### 2. Deploy the Email Forwarder Worker
1. Go to **Workers & Pages** -> **Create Application** -> **Worker**.
2. Name it `temp-mail-forwarder`.
3. Paste the contents of [`cloudflare/worker.js`](./cloudflare/worker.js).
4. Go to Worker **Settings** -> **Variables & Secrets** -> Add an environment variable:
   - **Variable name**: `WEBHOOK_URL`
   - **Value**: `https://<YOUR_DEPLOYED_DOMAIN>/api/webhook/email`
5. Click **Save and Deploy**.
6. The worker will be live at `https://temp-mail-forwarder.<account>.workers.dev`.

### 3. Attach Worker to Catch-All Rule
1. In Cloudflare Dashboard -> **Email Routing** -> **Routing Rules**.
2. Under **Catch-all rule**, set:
   - **Action**: `Send to a Worker`
   - **Worker**: `temp-mail-forwarder`
3. Toggle rule to **Enabled**.
4. Every email sent to `*@yourdomain.com` will immediately route to GhostMail!

---

## Deployment Option 2: Docker & Docker Compose (Containerized)

> **Best for**: Any VPS (DigitalOcean, Linode, Hetzner, AWS EC2) or local homelab.

### Quick Start with Docker Compose
```bash
# 1. Clone the repository
git clone https://github.com/PSVRAJESH0/ghost_mail_client.git
cd ghost_mail_client

# 2. Configure environment
cp .env.example .env
nano .env # Set your DOMAIN=yourdomain.com

# 3. Start container in background
docker compose up -d
```

### Manual Docker Build
```bash
docker build -t ghostmail:latest .

docker run -d \
  --name ghostmail \
  --restart unless-stopped \
  -p 3000:3000 \
  -p 2525:2525 \
  -v $(pwd)/data:/app/data \
  -e DOMAIN=psvrajesh.in \
  ghostmail:latest
```

---

## Deployment Option 3: Cloud PaaS (Render / Railway / Fly.io)

### Render.com (Blueprint 1-Click)
1. Fork or push this repository to GitHub.
2. In Render Dashboard, click **New +** -> **Blueprint**.
3. Connect your repository — Render will automatically read [`render.yaml`](./render.yaml).
4. Render will provision:
   - A Node.js web service running `node server.js`
   - An attached 1GB persistent disk at `/var/data`
   - Automatic SSL certificate (`https://<service-name>.onrender.com`)
5. Update your Cloudflare Worker `WEBHOOK_URL` to:
   `https://<service-name>.onrender.com/api/webhook/email`

### Railway.app / Fly.io
- **Railway**: Deploy directly from GitHub repo. Add a volume mounted to `/app/data` to persist storage.
- **Fly.io**: Deploy using `fly launch`. It detects the Dockerfile and allows attaching a persistent volume (`fly volumes create ghostmail_data`).

---

## Deployment Option 4: Linux VPS with Systemd + Direct Port 25 SMTP

> **Best for**: Dedicated mail server with direct MX inbound delivery.

### 1. Install & Configure Node.js
```bash
# Clone to /opt
sudo git clone https://github.com/PSVRAJESH0/ghost_mail_client.git /opt/ghost_mail_client
cd /opt/ghost_mail_client
sudo npm ci --omit=dev

# Copy environment file
sudo cp .env.example .env
sudo nano .env
```

### 2. Configure Port 25 Redirect (iptables)
Linux restricts unprivileged users from binding directly to port 25. Redirect port 25 to GhostMail's port 2525:
```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 25 -j REDIRECT --to-port 2525

# Persist iptables across reboots (Ubuntu/Debian):
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

### 3. Install Systemd Service
```bash
sudo cp systemd/ghostmail.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ghostmail
sudo systemctl status ghostmail
```

### 4. DNS Records for Direct SMTP
Add these records to your domain DNS manager:

| Type | Host / Name | Target / Value | Priority | Note |
|------|-------------|----------------|----------|------|
| **A** | `mail.yourdomain.com` | `<VPS_PUBLIC_IP>` | - | Mail server A record |
| **MX** | `@` (or `mail`) | `mail.yourdomain.com` | `10` | Route incoming emails |
| **TXT** | `@` | `v=spf1 mx ~all` | - | SPF authentication |

---

## Deployment Option 5: Cloudflare Zero Trust Named Tunnel

> **Best for**: Self-hosting behind CGNAT, home servers, or private servers with no open ports or public IP.

1. Create a Cloudflare Tunnel in **Cloudflare Zero Trust** -> **Networks** -> **Tunnels**.
2. Name the tunnel (e.g. `ghostmail-tunnel`).
3. Add a public hostname:
   - **Subdomain**: `mail` (or root `@`)
   - **Domain**: `yourdomain.com`
   - **Service**: `HTTP://localhost:3000`
4. Run tunnel with Docker or cloudflared using the provided tunnel token:
   ```bash
   cloudflared tunnel run --token <YOUR_TUNNEL_TOKEN>
   ```

---

## Verification & Health Probes

Verify your deployment with the automated health endpoint:
```bash
curl -f https://<YOUR_DOMAIN>/healthz
# Response: {"status":"ok","uptime":...,"timestamp":...}
```

Run the complete 17-point integration test suite against your deployment:
```bash
TUNNEL_URL="https://<YOUR_DOMAIN>" npm test
```
