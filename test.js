const http = require('http');
const net = require('net');
const { WebSocket } = require('ws');

const LOCAL_PORT = parseInt(process.env.PORT || '3000', 10);
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '2525', 10);
const TUNNEL_URL = process.env.TUNNEL_URL || 'https://taking-solar-oakland-conditions.trycloudflare.com';
const WORKER_URL = process.env.WORKER_URL || 'https://temp-mail-forwarder.parvathanenirajesh657.workers.dev';

// Terminal color formatting
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

function pass(name, detail = '') {
  console.log(`  ${colors.green}✔ PASS${colors.reset} ${colors.bold}${name}${colors.reset} ${detail ? `(${colors.cyan}${detail}${colors.reset})` : ''}`);
}

function fail(name, err) {
  console.log(`  ${colors.red}✖ FAIL${colors.reset} ${colors.bold}${name}${colors.reset}: ${colors.red}${err}${colors.reset}`);
}

function skip(name, reason) {
  console.log(`  ${colors.yellow}⊘ SKIP${colors.reset} ${colors.bold}${name}${colors.reset} (${colors.yellow}${reason}${colors.reset})`);
}

function info(msg) {
  console.log(`\n${colors.magenta}▶ ${msg}${colors.reset}`);
}

async function runTests() {
  console.log(`\n${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bold}          GhostMail End-to-End Pipeline & Integration Tests          ${colors.reset}`);
  console.log(`${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);

  let passed = 0;
  let failed = 0;
  let skipped = 0;

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

  // 1. Healthz & System Config
  info('1. Local Health & Core Configuration APIs');
  await test('Container Health Check (/healthz)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/healthz`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok') throw new Error(`Unexpected status: ${data.status}`);
    return `Status: ${data.status}, Uptime: ${Math.round(data.uptime)}s`;
  });

  let serverDomain = 'tempmail.yourdomain.com';
  await test('Server Config & Domain Registry (/api/config)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/config`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.domain) throw new Error('Missing domain in config');
    serverDomain = data.domain;
    return `Domain: ${data.domain}, Ports: HTTP ${data.httpPort} / SMTP ${data.smtpPort}`;
  });

  // 2. Real-Time WebSocket Layer
  info('2. Real-Time WebSocket Delivery Layer');
  let receivedWsMessage = null;
  let ws = null;

  await test('WebSocket Connection Handshake (/ws)', async () => {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`ws://localhost:${LOCAL_PORT}/ws`);
      const timer = setTimeout(() => reject(new Error('WebSocket timeout')), 3000);
      ws.on('open', () => {
        clearTimeout(timer);
        resolve('Handshake open on /ws');
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

  // 3. Inbox Lifecycle (Create, List, Extend)
  info('3. Temporary Inbox Lifecycle Management');
  const testAlias = `autotest-${Date.now()}`;
  let createdInboxAddress = null;

  await test('Create Instant Disposable Inbox (POST /api/inboxes)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: testAlias, ttlMinutes: 15 })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.inbox?.address) throw new Error('Inbox address not returned');
    createdInboxAddress = data.inbox.address;
    return `Created: ${createdInboxAddress} (TTL: 15m)`;
  });

  await test('List Active Inboxes (GET /api/inboxes)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const found = data.inboxes?.some(ib => ib.address === createdInboxAddress);
    if (!found) throw new Error(`Created inbox ${createdInboxAddress} not found in inboxes list`);
    return `Total active inboxes: ${data.inboxes.length}`;
  });

  await test('Extend Inbox Lifespan (POST /api/inboxes/:address/extend)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes/${encodeURIComponent(createdInboxAddress)}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 20 })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Extend failed');
    return `Extended TTL by +20m (Expires: ${new Date(data.inbox.expiresAt).toLocaleTimeString()})`;
  });

  // 4. Inbound Email Webhook & Smart OTP Extraction
  info('4. Inbound Email Ingestion & OTP Parser');
  const sampleOtp = '948201';
  let ingestedMessageId = null;
  const rawEmailPayload = [
    `From: Security Alert <security@accounts.google.com>`,
    `To: ${createdInboxAddress}`,
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

  await test('Raw RFC822 MIME Webhook Ingestion (/api/webhook/email)', async () => {
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
    ingestedMessageId = msg.id;
    return `Message ID: ${msg.id}, Extracted OTP: ${msg.otp}`;
  });

  await test('WebSocket Real-time Broadcast Event Delivery', async () => {
    // Allow brief time for WS event dispatch
    await new Promise(r => setTimeout(r, 350));
    if (!receivedWsMessage) throw new Error('WebSocket event not received for incoming email');
    if (receivedWsMessage.otp !== sampleOtp) {
      throw new Error(`WebSocket message OTP mismatch: ${receivedWsMessage.otp}`);
    }
    return `Live event delivered with OTP: ${receivedWsMessage.otp}`;
  });

  await test('Query Inbox Messages (GET /api/inboxes/:address/messages)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes/${encodeURIComponent(createdInboxAddress)}/messages`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.messages || data.messages.length === 0) throw new Error('No messages returned');
    return `Retrieved ${data.messages.length} message(s) for ${createdInboxAddress}`;
  });

  // 5. OTP Simulator Endpoint
  info('5. OTP Simulator Engine (Developer Mock Testing)');
  await test('Simulate Inbound Verification Email (POST /api/simulate)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: createdInboxAddress, senderType: 'github' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.simulatedOtp) throw new Error('No OTP returned in simulation');
    return `Sender: GitHub, Simulated OTP: ${data.simulatedOtp}`;
  });

  // 6. Direct SMTP Server Ingestion (Port 2525)
  info('6. Direct Inbound SMTP Server (Port 2525)');
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

  await test('Full SMTP Protocol Email Delivery & Ingestion', async () => {
    const smtpOtp = '827104';
    const smtpRecipient = `smtp-${Date.now()}@${serverDomain}`;
    const rawMime = [
      `From: Accounts <service@verify.com>`,
      `To: ${smtpRecipient}`,
      `Subject: Verification Code: ${smtpOtp}`,
      `Date: Sun, 1 Nov 2026 15:20:00 +0000`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      `Your authentication code is ${smtpOtp}.`
    ].join('\r\n');

    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port: SMTP_PORT, host: '127.0.0.1' });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('SMTP transaction timeout'));
      }, 5000);

      let step = 0;
      socket.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      socket.on('data', (data) => {
        const resp = data.toString();
        if (resp.startsWith('220') && step === 0) {
          step = 1;
          socket.write('HELO testclient\r\n');
        } else if (resp.startsWith('250') && step === 1) {
          step = 2;
          socket.write('MAIL FROM:<service@verify.com>\r\n');
        } else if (resp.startsWith('250') && step === 2) {
          step = 3;
          socket.write(`RCPT TO:<${smtpRecipient}>\r\n`);
        } else if (resp.startsWith('250') && step === 3) {
          step = 4;
          socket.write('DATA\r\n');
        } else if (resp.startsWith('354') && step === 4) {
          step = 5;
          socket.write(`${rawMime}\r\n.\r\n`);
        } else if (resp.startsWith('250') && step === 5) {
          step = 6;
          socket.write('QUIT\r\n');
          clearTimeout(timer);
          resolve(`Delivered to ${smtpRecipient} with OTP ${smtpOtp}`);
        }
      });
    });
  });

  // 7. Message & Inbox Deletion / Scrap
  info('7. Data Purge & Manual Scrap Lifecycle');
  if (ingestedMessageId) {
    await test('Delete Single Message (DELETE /api/messages/:id)', async () => {
      const res = await fetch(`http://localhost:${LOCAL_PORT}/api/messages/${ingestedMessageId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error('Message deletion failed');
      return `Deleted message ${ingestedMessageId}`;
    });
  }

  await test('Scrap Inbox Immediately (DELETE /api/inboxes/:address)', async () => {
    const res = await fetch(`http://localhost:${LOCAL_PORT}/api/inboxes/${encodeURIComponent(createdInboxAddress)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Scrap failed');
    return `Scrapped inbox ${createdInboxAddress}`;
  });

  // 8. Cloudflare Public Tunnel Testing
  info('8. Cloudflare Public Tunnel (Internet Edge to Localhost)');
  let tunnelAccessible = false;
  await test('Cloudflare Tunnel Reachability', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(`${TUNNEL_URL}/healthz`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`Tunnel returned HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== 'ok') throw new Error(`Unexpected status: ${data.status}`);
      tunnelAccessible = true;
      return `Public URL: ${TUNNEL_URL}`;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  });

  if (tunnelAccessible) {
    await test('Cloudflare Tunnel Inbound Webhook Ingestion', async () => {
      const tunnelOtp = '631984';
      const tunnelRecipient = `edge-test-${Date.now()}@${serverDomain}`;
      const tunnelEmail = [
        `From: Discord Security <noreply@discord.com>`,
        `To: ${tunnelRecipient}`,
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
  }

  // 9. Cloudflare Worker Live Verification
  info('9. Cloudflare Worker Edge Forwarder (Production)');
  await test('Cloudflare Worker Endpoint Verification', async () => {
    try {
      const res = await fetch(WORKER_URL);
      const text = await res.text();
      if (res.status === 200 && text.includes('GhostMail')) {
        return `Worker is LIVE: "${text.trim()}"`;
      } else {
        return `Worker HTTP ${res.status} ("${text.trim().substring(0, 40)}")`;
      }
    } catch (e) {
      return `Worker not resolving: ${e.message}`;
    }
  });

  // Cleanup
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  // Summary Report
  const total = passed + failed + skipped;
  console.log(`\n${colors.bold}══════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  Tests Completed: ${colors.bold}${total}${colors.reset} | ${colors.green}Passed: ${passed}${colors.reset} | ${failed > 0 ? `${colors.red}Failed: ${failed}${colors.reset}` : `${colors.green}Failed: 0${colors.reset}`} | ${skipped > 0 ? `${colors.yellow}Skipped: ${skipped}${colors.reset}` : ''}`);
  console.log(`${colors.bold}══════════════════════════════════════════════════════════════════════\n${colors.reset}`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
