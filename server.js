const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
require('dotenv').config();

// Configuration
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '2525', 10);
const DEFAULT_DOMAIN = (process.env.DOMAIN || 'tempmail.mycustomdomain.com').toLowerCase().trim();
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

// Application State
let config = {
  domain: DEFAULT_DOMAIN,
  smtpPort: SMTP_PORT,
  httpPort: HTTP_PORT,
  availableDomains: [DEFAULT_DOMAIN]
};

// In-Memory store
let inboxes = new Map(); // address -> { id, address, alias, domain, createdAt, expiresAt, ttlMinutes }
let messages = []; // [{ id, inboxAddress, from, to, subject, text, html, receivedAt, otp, rawSize }]

// Load state from disk if exists
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.config) config = { ...config, ...data.config };
    if (Array.isArray(data.inboxes)) {
      for (const ib of data.inboxes) {
        if (!ib.expiresAt || ib.expiresAt > Date.now()) {
          inboxes.set(ib.address.toLowerCase(), ib);
        }
      }
    }
    if (Array.isArray(data.messages)) {
      messages = data.messages.filter(m => inboxes.has(m.inboxAddress.toLowerCase()));
    }
    console.log(`[Store] Loaded ${inboxes.size} active inboxes and ${messages.length} messages.`);
  }
} catch (err) {
  console.error('[Store] Failed to load store.json:', err.message);
}

function saveStore() {
  try {
    const data = {
      config,
      inboxes: Array.from(inboxes.values()),
      messages: messages.slice(-500) // keep last 500
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Store] Failed to save store.json:', err.message);
  }
}

// Smart OTP Detection
function extractOtp(subject = '', text = '', html = '') {
  const content = `${subject}\n${text}`;

  // 1. High confidence: Labeled OTP / verification codes
  const labeledRegexes = [
    /(?:verification\s*code|security\s*code|one-time\s*password|login\s*code|auth\s*code|confirmation\s*code|passcode|otp)\s*(?:is|:|=|-)?\s*([0-9]{4,8})\b/i,
    /(?:your\s*code\s*is|use\s*code|enter\s*code)\s*(?:is|:|=|-)?\s*([0-9]{4,8})\b/i,
    /\b(?:code|pin|otp)\s*[:#-]?\s*([0-9]{4,8})\b/i,
    /(?:code|otp|token)\s*(?:is|:)?\s*([A-Z0-9]{6,8})\b/i
  ];

  for (const regex of labeledRegexes) {
    const match = content.match(regex);
    if (match && match[1]) {
      const code = match[1].trim();
      return code;
    }
  }

  // 2. Prefixed codes (e.g. G-123456 or FB-12345)
  const prefixedMatch = content.match(/\b([A-Z]{1,3}-[0-9]{4,8})\b/i);
  if (prefixedMatch) {
    return prefixedMatch[1];
  }

  // 3. Subject-line standalone 4-8 digit codes (e.g. "491823 is your verification code")
  const subjectCode = subject.match(/\b([0-9]{4,8})\b/);
  if (subjectCode && subjectCode[1]) {
    const code = subjectCode[1];
    if (!['2024', '2025', '2026', '2027'].includes(code)) {
      return code;
    }
  }

  // 4. Standalone 6-digit number in the body
  const sixDigitMatch = text.match(/\b([0-9]{6})\b/);
  if (sixDigitMatch) {
    return sixDigitMatch[1];
  }

  // 5. Standalone 4-8 digit code fallback
  const anyDigits = text.match(/\b([0-9]{4,8})\b/);
  if (anyDigits) {
    const code = anyDigits[1];
    if (!['2024', '2025', '2026', '2027'].includes(code)) {
      return code;
    }
  }

  return null;
}

// Generate human-friendly random alias
const ADJECTIVES = ['quick', 'silent', 'amber', 'cyber', 'swift', 'shadow', 'neon', 'iron', 'frost', 'pixel', 'turbo', 'stellar', 'hyper', 'zenith', 'pulse'];
const NOUNS = ['fox', 'hawk', 'spark', 'shield', 'vault', 'rover', 'comet', 'wolf', 'matrix', 'beacon', 'blade', 'falcon', 'ghost', 'prism', 'relay'];

function generateRandomAlias() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${num}`;
}

// Express App
const app = express();
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(event, payload) {
  const msg = JSON.stringify({ event, data: payload, timestamp: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) { // OPEN
      client.send(msg);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    event: 'connected',
    data: {
      message: 'Connected to TempMail Live Stream',
      serverTime: Date.now(),
      domain: config.domain
    }
  }));
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '25mb' }));

// Raw body parser specifically for incoming email webhook (e.g. Cloudflare Worker or POST /api/webhook/email)
app.use('/api/webhook/email', (req, res, next) => {
  if (req.headers['content-type'] && (
    req.headers['content-type'].includes('message/rfc822') ||
    req.headers['content-type'].includes('multipart/') ||
    req.headers['content-type'].includes('application/octet-stream') ||
    req.headers['content-type'].includes('text/plain')
  )) {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      next();
    });
  } else {
    next();
  }
});

// Process an incoming parsed or unparsed email
async function processIncomingEmail({ rawMime, from, to, subject, text, html }) {
  let parsed = null;
  if (rawMime) {
    parsed = await simpleParser(rawMime);
  }

  const finalFrom = parsed?.from?.text || from || 'Unknown Sender';
  const finalSubject = parsed?.subject || subject || '(No Subject)';
  const finalText = parsed?.text || text || '';
  const finalHtml = parsed?.html || html || (finalText ? `<pre style="white-space: pre-wrap; font-family: monospace;">${escapeHtml(finalText)}</pre>` : '<p>Empty message</p>');
  
  // Extract recipient addresses
  const recipients = [];
  if (parsed?.to) {
    const toList = Array.isArray(parsed.to) ? parsed.to : [parsed.to];
    for (const entry of toList) {
      if (entry.value) {
        for (const v of entry.value) {
          if (v.address) recipients.push(v.address.toLowerCase().trim());
        }
      } else if (entry.text) {
        recipients.push(entry.text.toLowerCase().trim());
      }
    }
  } else if (to) {
    if (Array.isArray(to)) {
      recipients.push(...to.map(t => t.toLowerCase().trim()));
    } else {
      recipients.push(to.toLowerCase().trim());
    }
  }

  if (recipients.length === 0) {
    recipients.push(`default@${config.domain}`);
  }

  const detectedOtp = extractOtp(finalSubject, finalText, finalHtml);
  const createdMessages = [];

  for (const rawRecipient of recipients) {
    const cleanRecipient = rawRecipient.replace(/[<>]/g, '').trim().toLowerCase();
    
    // Check if an inbox exists for this address, or create on the fly if it matches our domain
    let inbox = inboxes.get(cleanRecipient);
    if (!inbox) {
      const [alias, domain] = cleanRecipient.split('@');
      // Auto-create inbox with default 30 min expiration so emails are never dropped
      const ttlMinutes = 30;
      const now = Date.now();
      inbox = {
        id: 'ib_' + Math.random().toString(36).substring(2, 10),
        address: cleanRecipient,
        alias: alias || 'anonymous',
        domain: domain || config.domain,
        createdAt: now,
        expiresAt: now + (ttlMinutes * 60 * 1000),
        ttlMinutes: ttlMinutes
      };
      inboxes.set(cleanRecipient, inbox);
      broadcast('inbox_created', inbox);
    }

    const messageRecord = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      inboxAddress: cleanRecipient,
      from: finalFrom,
      to: cleanRecipient,
      subject: finalSubject,
      text: finalText,
      html: finalHtml,
      otp: detectedOtp,
      receivedAt: Date.now(),
      rawSize: rawMime ? rawMime.length : (finalText.length + finalHtml.length)
    };

    messages.push(messageRecord);
    createdMessages.push(messageRecord);

    console.log(`[Email Received] To: ${cleanRecipient} | From: ${finalFrom} | Subject: "${finalSubject}" | OTP: ${detectedOtp || 'None'}`);
    broadcast('new_message', messageRecord);
  }

  saveStore();
  return createdMessages;
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// API Routes

// 1. Get system config
app.get('/api/config', (req, res) => {
  res.json({
    domain: config.domain,
    smtpPort: config.smtpPort,
    httpPort: config.httpPort,
    availableDomains: config.availableDomains,
    serverTime: Date.now(),
    stats: {
      activeInboxes: inboxes.size,
      totalMessages: messages.length
    }
  });
});

// 2. Update domain or config
app.post('/api/config', (req, res) => {
  const { domain } = req.body;
  if (domain && typeof domain === 'string') {
    const cleanDomain = domain.toLowerCase().trim().replace(/^@/, '');
    config.domain = cleanDomain;
    if (!config.availableDomains.includes(cleanDomain)) {
      config.availableDomains.push(cleanDomain);
    }
    saveStore();
    broadcast('config_updated', config);
    return res.json({ success: true, config });
  }
  res.status(400).json({ error: 'Invalid domain specified' });
});

// 3. List inboxes
app.get('/api/inboxes', (req, res) => {
  const list = Array.from(inboxes.values()).map(ib => {
    const inboxMsgs = messages.filter(m => m.inboxAddress.toLowerCase() === ib.address.toLowerCase());
    return {
      ...ib,
      messageCount: inboxMsgs.length,
      latestOtp: inboxMsgs.length > 0 ? (inboxMsgs[inboxMsgs.length - 1].otp || null) : null
    };
  }).sort((a, b) => b.createdAt - a.createdAt);

  res.json({ inboxes: list });
});

// 4. Create new inbox
app.post('/api/inboxes', (req, res) => {
  let { alias, domain, ttlMinutes } = req.body || {};
  
  domain = (domain || config.domain).toLowerCase().trim().replace(/^@/, '');
  if (!alias || typeof alias !== 'string' || !alias.trim()) {
    alias = generateRandomAlias();
  } else {
    alias = alias.toLowerCase().trim().replace(/[^a-z0-9._-]/g, '');
  }

  const address = `${alias}@${domain}`;
  const now = Date.now();
  
  // Expiration: ttlMinutes = 0 means never expire
  const ttl = ttlMinutes !== undefined ? parseInt(ttlMinutes, 10) : 30;
  const expiresAt = ttl > 0 ? now + (ttl * 60 * 1000) : null;

  const inbox = {
    id: 'ib_' + Math.random().toString(36).substring(2, 10),
    address,
    alias,
    domain,
    createdAt: now,
    expiresAt,
    ttlMinutes: ttl
  };

  inboxes.set(address, inbox);
  saveStore();
  broadcast('inbox_created', inbox);

  res.json({ success: true, inbox });
});

// 5. Extend inbox lifetime
app.post('/api/inboxes/:address/extend', (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const inbox = inboxes.get(address);
  if (!inbox) {
    return res.status(404).json({ error: 'Inbox not found' });
  }

  const minutesToAdd = parseInt(req.body?.minutes || '15', 10);
  const baseTime = inbox.expiresAt && inbox.expiresAt > Date.now() ? inbox.expiresAt : Date.now();
  inbox.expiresAt = baseTime + (minutesToAdd * 60 * 1000);
  inbox.ttlMinutes = Math.round((inbox.expiresAt - inbox.createdAt) / 60000);

  inboxes.set(address, inbox);
  saveStore();
  broadcast('inbox_updated', inbox);

  res.json({ success: true, inbox });
});

// 6. Scrap / Delete inbox immediately
app.delete('/api/inboxes/:address', (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const exists = inboxes.has(address);
  
  inboxes.delete(address);
  messages = messages.filter(m => m.inboxAddress.toLowerCase() !== address);
  saveStore();

  broadcast('inbox_deleted', { address });
  res.json({ success: true, deleted: exists, address });
});

// 7. Get messages for an inbox
app.get('/api/inboxes/:address/messages', (req, res) => {
  const address = req.params.address.toLowerCase().trim();
  const inboxMessages = messages
    .filter(m => m.inboxAddress.toLowerCase() === address)
    .sort((a, b) => b.receivedAt - a.receivedAt);

  res.json({ address, messages: inboxMessages });
});

// 8. Delete specific message
app.delete('/api/messages/:id', (req, res) => {
  const id = req.params.id;
  const initialLength = messages.length;
  messages = messages.filter(m => m.id !== id);
  saveStore();

  broadcast('message_deleted', { id });
  res.json({ success: true, deleted: messages.length < initialLength });
});

// 9. Webhook receiver for Cloudflare Workers, SendGrid, Mailgun, or custom webhooks
app.post('/api/webhook/email', async (req, res) => {
  try {
    let result = null;

    if (req.rawBody) {
      // Raw RFC822 MIME message sent in body
      result = await processIncomingEmail({ rawMime: req.rawBody });
    } else if (req.body) {
      // JSON payload
      const { raw, from, to, subject, text, html } = req.body;
      if (raw) {
        result = await processIncomingEmail({ rawMime: Buffer.from(raw, 'utf8') });
      } else {
        result = await processIncomingEmail({ from, to, subject, text, html });
      }
    } else {
      return res.status(400).json({ error: 'No email content received' });
    }

    res.json({ success: true, processedCount: result?.length || 0, messages: result });
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.status(500).json({ error: 'Failed to process email', details: err.message });
  }
});

// 10. Test OTP Simulator Endpoint
app.post('/api/simulate', async (req, res) => {
  try {
    const { address, senderType } = req.body || {};
    const targetAddress = (address || (inboxes.size > 0 ? Array.from(inboxes.keys())[0] : `test@${config.domain}`)).toLowerCase().trim();

    const sampleOtps = ['492018', '718294', '582041', '903421', '381920'];
    const otp = sampleOtps[Math.floor(Math.random() * sampleOtps.length)];

    const templates = {
      google: {
        from: 'Google Security <no-reply@accounts.google.com>',
        subject: `${otp} is your Google verification code`,
        text: `Hi,\n\nUse this code to verify your Google Account:\n\n${otp}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, you can safely ignore this email.\n\nThanks,\nThe Google Accounts team`,
        html: `
          <div style="font-family: 'Google Sans', Roboto, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <span style="font-size: 26px; font-weight: bold; color: #4285F4;">G</span><span style="font-size: 26px; font-weight: bold; color: #EA4335;">o</span><span style="font-size: 26px; font-weight: bold; color: #FBBC05;">o</span><span style="font-size: 26px; font-weight: bold; color: #4285F4;">g</span><span style="font-size: 26px; font-weight: bold; color: #34A853;">l</span><span style="font-size: 26px; font-weight: bold; color: #EA4335;">e</span>
            </div>
            <h2 style="color: #202124; font-size: 20px; font-weight: 500; margin-bottom: 16px;">Verify your identity</h2>
            <p style="color: #5f6368; font-size: 14px; line-height: 1.5;">Use the following one-time verification code to complete your login or registration:</p>
            <div style="background: #f1f3f4; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #1a73e8; font-family: monospace;">${otp}</span>
            </div>
            <p style="color: #5f6368; font-size: 13px;">This verification code is valid for 10 minutes. Never share this code with anyone.</p>
          </div>
        `
      },
      github: {
        from: 'GitHub <noreply@github.com>',
        subject: `[GitHub] Please verify your device (OTP: ${otp})`,
        text: `Hey there!\n\nA sign-in attempt was detected for your account. Please enter the following code to continue:\n\n${otp}\n\nSecurity code expires in 15 minutes.\n\nThanks,\nThe GitHub Team`,
        html: `
          <div style="background-color: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; padding: 32px; border-radius: 12px; max-width: 560px; margin: auto;">
            <h2 style="color: #58a6ff; font-size: 20px;">Device verification code</h2>
            <p style="font-size: 14px; color: #8b949e;">Please enter this code on GitHub to complete authentication:</p>
            <div style="background-color: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
              <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #3fb950; font-family: monospace;">${otp}</span>
            </div>
            <p style="font-size: 12px; color: #8b949e;">If this wasn't you, your credentials might be compromised.</p>
          </div>
        `
      },
      discord: {
        from: 'Discord <noreply@discord.com>',
        subject: `Your Discord Security Code is ${otp}`,
        text: `Hey!\n\nYour Discord verification code is: ${otp}\n\nIt will expire in 5 minutes. Do not share this code with anyone.\n\n- Discord Team`,
        html: `
          <div style="background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Noto Sans', sans-serif; padding: 28px; border-radius: 10px; max-width: 520px; margin: auto;">
            <h2 style="color: #5865f2; margin-top: 0;">Verification Code</h2>
            <p style="font-size: 15px;">Here is your temporary Discord verification token:</p>
            <div style="background-color: #2b2d31; border-radius: 6px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="font-size: 34px; font-weight: bold; letter-spacing: 6px; color: #ffffff; font-family: monospace;">${otp}</span>
            </div>
            <p style="font-size: 13px; color: #949ba4;">Expires in 5 minutes.</p>
          </div>
        `
      }
    };

    const templateKeys = Object.keys(templates);
    const chosenKey = senderType && templates[senderType] ? senderType : templateKeys[Math.floor(Math.random() * templateKeys.length)];
    const chosen = templates[chosenKey];

    const result = await processIncomingEmail({
      from: chosen.from,
      to: targetAddress,
      subject: chosen.subject,
      text: chosen.text,
      html: chosen.html
    });

    res.json({ success: true, simulatedOtp: otp, messages: result });
  } catch (err) {
    console.error('[Simulate Error]', err);
    res.status(500).json({ error: 'Simulation failed', details: err.message });
  }
});

// Periodic Expiry Cleaner (runs every 10 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;

  for (const [address, inbox] of inboxes.entries()) {
    if (inbox.expiresAt && now >= inbox.expiresAt) {
      console.log(`[Auto-Scrap] Inbox expired and destroyed: ${address}`);
      inboxes.delete(address);
      messages = messages.filter(m => m.inboxAddress.toLowerCase() !== address);
      broadcast('inbox_expired', { address });
      changed = true;
    }
  }

  if (changed) {
    saveStore();
  }
}, 10000);

// Initialize SMTP Server
const smtp = new SMTPServer({
  secure: false,
  disabledCommands: ['AUTH', 'STARTTLS'],
  authOptional: true,
  size: 25 * 1024 * 1024, // 25MB max
  onConnect(session, callback) {
    console.log(`[SMTP Client Connected] IP: ${session.remoteAddress}`);
    callback();
  },
  onMailFrom(address, session, callback) {
    callback();
  },
  onRcptTo(address, session, callback) {
    // Accept all recipients
    callback();
  },
  onData(stream, session, callback) {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', async () => {
      try {
        const rawMime = Buffer.concat(chunks);
        await processIncomingEmail({ rawMime });
        callback();
      } catch (err) {
        console.error('[SMTP Processing Error]', err);
        callback(new Error('Email processing failed'));
      }
    });
  }
});

// Start Web & API Server
server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[Web Server] Running on http://localhost:${HTTP_PORT}`);
  console.log(`[WebSocket] Live at ws://localhost:${HTTP_PORT}/ws`);
  console.log(`[Webhook Endpoint] Ready at http://localhost:${HTTP_PORT}/api/webhook/email`);
});

// Start SMTP Server with graceful port handling (if port 25 is restricted, logs guidance)
smtp.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`[SMTP Server] Listening on port ${SMTP_PORT} (Direct inbound MX)`);
}).on('error', (err) => {
  if (err.code === 'EACCES') {
    console.warn(`[SMTP Warning] Port ${SMTP_PORT} requires root/sudo privileges.`);
    console.warn(`[SMTP Tip] In production on Linux, run with sudo or redirect port 25 to ${SMTP_PORT}:`);
    console.warn(`sudo iptables -t nat -A PREROUTING -p tcp --dport 25 -j REDIRECT --to-port ${SMTP_PORT}`);
  } else {
    console.error('[SMTP Error]', err.message);
  }
});
