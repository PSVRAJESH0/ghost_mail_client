# Custom Domain Routing Guide

You have two powerful options to route emails from your custom domain to this disposable email client.

---

## Method 1: Cloudflare Email Routing + Worker (Recommended)
> **Why this is best**: 100% free, Cloudflare handles spam filtering & MX records, and it works even if your ISP or cloud host blocks port 25.

### Steps:
1. **Add Your Domain to Cloudflare** (Free plan).
2. **Enable Email Routing**:
   - Go to Cloudflare Dashboard -> Your Domain -> **Email Routing**.
   - Click **Get Started** and allow Cloudflare to automatically configure the required MX and SPF DNS records.
3. **Create the Worker**:
   - Go to **Workers & Pages** -> **Create Application** -> **Worker**.
   - Name it `temp-mail-forwarder`.
   - Paste the code from `cloudflare/worker.js`.
   - In Worker **Settings** -> **Variables**, add an environment variable:
     - `WEBHOOK_URL` = `https://your-server-domain.com/api/webhook/email`
       *(Or your Cloudflare Tunnel / ngrok URL if testing locally)*.
   - Click **Save and Deploy**.
4. **Connect Email Routing to Worker**:
   - Go back to **Email Routing** -> **Routing Rules**.
   - Under **Catch-all rule**, set Action to: **Send to a Worker** -> Select `temp-mail-forwarder`.
   - Enable the rule.
5. **Done!** Any email sent to *anything*@yourdomain.com will now hit your disposable email client instantly!

---

## Method 2: Direct SMTP Server (Self-Hosted on VPS)
> **Requirements**: A public server/VPS (e.g., Ubuntu, Debian) with inbound Port 25 open.

### 1. DNS Records:
Add the following DNS records at your domain registrar/DNS manager:

| Type | Name | Value | Priority |
|------|------|-------|----------|
| **A** | `mail.yourdomain.com` | `<YOUR_SERVER_PUBLIC_IP>` | - |
| **MX** | `@` (or subdomain `temp`) | `mail.yourdomain.com` | `10` |
| **TXT** | `@` (SPF) | `v=spf1 mx ~all` | - |

### 2. Port 25 on Linux:
Standard Linux kernels prevent unprivileged users from binding to port 25 directly. You have two easy choices:

**Option A (Redirect port 25 to 2525 using iptables - Recommended):**
```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 25 -j REDIRECT --to-port 2525
```
Then keep `SMTP_PORT=2525` in your `.env`.

**Option B (Allow Node.js to bind port 25 without root):**
```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```
Then set `SMTP_PORT=25` in your `.env`.

---

## Testing Locally
Even without any domain set up yet, you can test everything:
1. Open the web interface at `http://localhost:3000`.
2. Click the **"Simulate Inbound OTP"** button in the header.
3. Watch the real-time WebSocket fire, hear the notification sound, and see the OTP extracted and ready to copy in 1 click!
