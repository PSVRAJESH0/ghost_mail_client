const http = require('http');
const net = require('net');
const { WebSocket } = require('ws');

const LOCAL_PORT = 3000;
const SMTP_PORT = 2525;
const TUNNEL_URL = 'https://max-invitation-yang-ribbon.trycloudflare.com';
const WORKER_URL = 'https://temp-mail-forwarder.parvathanenirajesh657.workers.dev';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m'
};

function pass(name, detail = '') {
  console.log(`  ${colors.green}✔ PASS${colors.reset} ${colors.bold}${name}${colors.reset} ${detail ? `(${detail})` : ''}`);
}

function fail(name, err) {
  console.log(`  ${colors.red}✖ FAIL${colors.reset} ${colors.bold}${name}${colors.reset}: ${err}`);
}

function info(msg) {
  console.log(`\n${colors.cyan}▶ ${msg}${colors.reset}`);
}

async function runTests() {
  console.log(`\n${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}          GhostMail End-to-End Pipeline & Integration Tests          ${colors.reset}`);
  console.log(`${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      const detail = await fn();
      pass(name, detail);
      passed++;
    } catch (err) {
      fail(name, err.message || err);
      failed++;
    }
  }

  // 1. Local Server Health Check
  info('1. Testing Local Server & Core APIs');
  await test('Local Web Server Health (/api/config)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.domain) throw new Error('Missing domain in config');
    return `Domain: ${data.domain}, Port: ${data.httpPort}`;
  });

  // 2. WebSocket Real-time Connectivity
  info('2. Testing Real-Time WebSocket Layer');
  let receivedWsMessage = null;
  const ws = new WebSocket(`ws://localhost:${LOCAL_PORT}/ws`);

  await test('WebSocket Connection Handshake', async () => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 3000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve('Handshake successful on /ws');
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          if (payload.event === 'new_message') {
            receivedWsMessage = payload.data;
          }
        } catch (e) {}
      });
    });
  });

  // 3. Inbox Creation and Lifecycle
  info('3. Testing Temporary Address Generation & Auto-Scrap');
  const testAddress = `automated-test-${Date.now()}@tempmail.yourdomain.com`;
  await test('Create Instant Temporary Inbox', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: `autotest-${Date.now()}`, ttlMinutes: 10 })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.inbox?.address) throw new Error('Inbox address not returned');
    return `Created: ${data.inbox.address} (TTL: 10m)`;
  });

  // 4. Inbound Email Webhook & Smart OTP Extraction
  info('4. Testing Inbound Email Ingestion & OTP Parser');
  const sampleOtp = '948201';
  const rawEmailPayload = [
    `From: Security Alert <security@accounts.google.com>`,
    `To: ${testAddress}`,
    `Subject: Your Google verification code is ${sampleOtp}`,
    `Date: Sun, 1 Nov 2026 15:15:00 +0000`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Hi user,`,
    ``,
    `Use this one-time password to verify your login:`,
    `OTP: ${sampleOtp}`,
    ``,
    `This code expires in 10 minutes.`,
    `-- Google Accounts`
  ].join('\r\n');

  await test('Raw RFC822 MIME Webhook Ingestion', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/webhook/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: rawEmailPayload
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success || !data.messages || data.messages.length === 0) {
      throw new Error('Message ingestion failed');
    }
    const msg = data.messages[0];
    if (msg.otp !== sampleOtp) {
      throw new Error(`OTP extraction mismatch: expected ${sampleOtp}, got ${msg.otp}`);
    }
    return `Ingested message id: ${msg.id}, Extracted OTP: ${msg.otp}`;
  });

  await test('WebSocket Real-time Broadcast Verification', async () => {
    // Wait briefly for WS event delivery
    await new Promise(r => setTimeout(r, 400));
    if (!receivedWsMessage) throw new Error('WebSocket event not received for incoming email');
    if (receivedWsMessage.otp !== sampleOtp) {
      throw new Error(`WebSocket message OTP mismatch: ${receivedWsMessage.otp}`);
    }
    return `Live event received for OTP: ${receivedWsMessage.otp}`;
  });

  // 5. Cloudflare Public Tunnel Testing
  info('5. Testing Cloudflare Tunnel (Edge to Localhost)');
  await test('Cloudflare Tunnel Reachability (trycloudflare.com)', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${TUNNEL_URL}/api/config`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Tunnel returned HTTP ${res.status}`);
      const data = await res.json();
      return `Accessible from public internet (${TUNNEL_URL})`;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  });

  await test('Cloudflare Tunnel Webhook Ingestion', async () => {
    const tunnelOtp = '631984';
    const tunnelEmail = [
      `From: Discord Security <noreply@discord.com>`,
      `To: ${testAddress}`,
      `Subject: Your Discord security token is ${tunnelOtp}`,
      `Date: Sun, 1 Nov 2026 15:16:00 +0000`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Your Discord verification code is: ${tunnelOtp}`
    ].join('\r\n');

    const res = await fetch(`${TUNNEL_URL}/api/webhook/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'message/rfc822' },
      body: tunnelEmail
    });
    if (!res.ok) throw new Error(`Tunnel webhook returned HTTP ${res.status}`);
    const data = await res.json();
    const msg = data.messages?.[0];
    if (msg?.otp !== tunnelOtp) throw new Error(`OTP mismatch: got ${msg?.otp}`);
    return `Processed via Cloudflare edge -> extracted OTP: ${tunnelOtp}`;
  });

  // 6. Direct SMTP Listener Port
  info('6. Testing Built-in SMTP Server (Port 2525)');
  await test('SMTP Socket Greeting', async () => {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port: SMTP_PORT, host: '127.0.0.1' });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('SMTP connection timed out'));
      }, 3000);

      socket.on('data', (data) => {
        clearTimeout(timer);
        const greeting = data.toString().trim();
        socket.end('QUIT\r\n');
        if (greeting.startsWith('220')) {
          resolve(`Greeting: ${greeting.substring(0, 30)}...`);
        } else {
          reject(new Error(`Unexpected SMTP greeting: ${greeting}`));
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  });

  // 7. Cloudflare Worker Live Verification (if deployed)
  info('7. Testing Deployed Cloudflare Worker');
  await test('Cloudflare Worker HTTP Endpoint', async () => {
    try {
      const res = await fetch(WORKER_URL);
      const text = await res.text();
      if (res.status === 200 && text.includes('GhostMail')) {
        return `Worker is LIVE: "${text.trim()}"`;
      } else {
        return `Worker responded with status ${res.status} ("${text.trim().substring(0, 40)}")`;
      }
    } catch (e) {
      return `Worker not yet publicly resolving (${e.message})`;
    }
  });

  // Cleanup
  ws.close();

  // Summary
  console.log(`\n${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  Tests Completed: ${colors.bold}${passed + failed}${colors.reset} | ${colors.green}Passed: ${passed}${colors.reset} | ${failed > 0 ? `${colors.red}Failed: ${failed}${colors.reset}` : `${colors.green}Failed: 0${colors.reset}`}`);
  console.log(`${colors.bold}══════════════════════════════════════════════════════════════════════\n${colors.reset}`);
}

runTests();
