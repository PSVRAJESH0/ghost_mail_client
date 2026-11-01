/**
 * GhostMail — Instant Disposable Email & OTP Client
 * Frontend Application Logic
 */

// Application State
const state = {
  config: null,
  inboxes: [],
  activeAddress: null,
  activeInbox: null,
  messages: [],
  selectedMessage: null,
  selectedTtl: 30,
  soundEnabled: true,
  ws: null,
  countdownTimerId: null
};

// DOM Elements
const elements = {
  connectionStatusChip: document.getElementById('connectionStatusChip'),
  connectionStatusText: document.getElementById('connectionStatusText'),
  currentDomainBadge: document.getElementById('currentDomainBadge'),
  domainSuffixText: document.getElementById('domainSuffixText'),
  openDomainModalBtn: document.getElementById('openDomainModalBtn'),
  closeDomainModalBtn: document.getElementById('closeDomainModalBtn'),
  cancelDomainModalBtn: document.getElementById('cancelDomainModalBtn'),
  saveDomainModalBtn: document.getElementById('saveDomainModalBtn'),
  domainModal: document.getElementById('domainModal'),
  customDomainInput: document.getElementById('customDomainInput'),

  soundToggleBtn: document.getElementById('soundToggleBtn'),
  soundOnIcon: document.getElementById('soundOnIcon'),
  soundOffIcon: document.getElementById('soundOffIcon'),

  simulateDropdownBtn: document.getElementById('simulateDropdownBtn'),
  simulateDropdownMenu: document.getElementById('simulateDropdownMenu'),

  emailAddressBox: document.getElementById('emailAddressBox'),
  currentEmailDisplay: document.getElementById('currentEmailDisplay'),
  copyAddressBtn: document.getElementById('copyAddressBtn'),
  copyTooltip: document.getElementById('copyTooltip'),

  countdownTimer: document.getElementById('countdownTimer'),
  timerProgressRing: document.getElementById('timerProgressRing'),
  extendTimeBtn: document.getElementById('extendTimeBtn'),
  scrapInboxBtn: document.getElementById('scrapInboxBtn'),

  customAliasInput: document.getElementById('customAliasInput'),
  ttlChipGroup: document.getElementById('ttlChipGroup'),
  createNewInboxBtn: document.getElementById('createNewInboxBtn'),

  activeInboxesList: document.getElementById('activeInboxesList'),
  inboxCountBadge: document.getElementById('inboxCountBadge'),

  currentInboxHeading: document.getElementById('currentInboxHeading'),
  inboxMessageCounter: document.getElementById('inboxMessageCounter'),
  messageSearchInput: document.getElementById('messageSearchInput'),
  refreshInboxBtn: document.getElementById('refreshInboxBtn'),
  refreshSpinIcon: document.getElementById('refreshSpinIcon'),

  messageListContainer: document.getElementById('messageListContainer'),
  readerEmptyState: document.getElementById('readerEmptyState'),
  readerListeningAddress: document.getElementById('readerListeningAddress'),
  readerDetailView: document.getElementById('readerDetailView'),

  otpHeroBanner: document.getElementById('otpHeroBanner'),
  otpLargeDigits: document.getElementById('otpLargeDigits'),
  copyOtpBtn: document.getElementById('copyOtpBtn'),
  copyOtpBtnText: document.getElementById('copyOtpBtnText'),

  readerSubject: document.getElementById('readerSubject'),
  deleteCurrentMessageBtn: document.getElementById('deleteCurrentMessageBtn'),
  readerSenderAvatar: document.getElementById('readerSenderAvatar'),
  readerSenderName: document.getElementById('readerSenderName'),
  readerSenderAddress: document.getElementById('readerSenderAddress'),
  readerTimestamp: document.getElementById('readerTimestamp'),
  readerToAddress: document.getElementById('readerToAddress'),

  emailHtmlIframe: document.getElementById('emailHtmlIframe'),
  emailPlainTextPreview: document.getElementById('emailPlainTextPreview'),
  emailRawDetailsBox: document.getElementById('emailRawDetailsBox'),

  toastContainer: document.getElementById('toastContainer')
};

// ==========================================================================
// Initialization
// ==========================================================================

async function init() {
  setupEventListeners();
  await fetchConfig();
  await loadInboxes();

  // If no active inboxes exist, automatically create an instant temporary email!
  if (state.inboxes.length === 0) {
    await createNewInbox({ ttlMinutes: 30 });
  } else {
    selectInbox(state.inboxes[0].address);
  }

  connectWebSocket();
  startCountdownTicker();
}

// ==========================================================================
// API Calls
// ==========================================================================

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    state.config = data;
    updateDomainDisplay(data.domain);
  } catch (err) {
    console.error('Failed to fetch config:', err);
  }
}

async function loadInboxes() {
  try {
    const res = await fetch('/api/inboxes');
    const data = await res.json();
    state.inboxes = data.inboxes || [];
    renderInboxesList();
  } catch (err) {
    console.error('Failed to load inboxes:', err);
  }
}

async function createNewInbox({ alias = '', domain = '', ttlMinutes = 30 } = {}) {
  try {
    const res = await fetch('/api/inboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias, domain, ttlMinutes })
    });
    const data = await res.json();
    if (data.success && data.inbox) {
      await loadInboxes();
      selectInbox(data.inbox.address);
      showToast(`Created new inbox: ${data.inbox.address}`, 'success');
      return data.inbox;
    }
  } catch (err) {
    showToast('Failed to create inbox', 'danger');
    console.error(err);
  }
}

async function scrapInbox(address) {
  if (!address) return;
  try {
    const res = await fetch(`/api/inboxes/${encodeURIComponent(address)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Scrapped and deleted: ${address}`, 'warning');
      await loadInboxes();
      if (state.inboxes.length > 0) {
        selectInbox(state.inboxes[0].address);
      } else {
        await createNewInbox({ ttlMinutes: 30 });
      }
    }
  } catch (err) {
    showToast('Failed to scrap inbox', 'danger');
  }
}

async function extendInboxTime(address, minutes = 15) {
  if (!address) return;
  try {
    const res = await fetch(`/api/inboxes/${encodeURIComponent(address)}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes })
    });
    const data = await res.json();
    if (data.success && data.inbox) {
      state.activeInbox = data.inbox;
      const idx = state.inboxes.findIndex(ib => ib.address === address);
      if (idx !== -1) state.inboxes[idx] = data.inbox;
      renderInboxesList();
      showToast(`Extended inbox lifespan by +${minutes} minutes`, 'success');
    }
  } catch (err) {
    showToast('Failed to extend lifespan', 'danger');
  }
}

async function loadMessages(address) {
  if (!address) return;
  try {
    const res = await fetch(`/api/inboxes/${encodeURIComponent(address)}/messages`);
    const data = await res.json();
    state.messages = data.messages || [];
    renderMessagesList();

    // Auto-select first message if available and none selected
    if (state.messages.length > 0 && (!state.selectedMessage || state.selectedMessage.inboxAddress !== address)) {
      selectMessage(state.messages[0]);
    } else if (state.messages.length === 0) {
      deselectMessage();
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }
}

async function deleteMessage(id) {
  if (!id) return;
  try {
    const res = await fetch(`/api/messages/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      state.messages = state.messages.filter(m => m.id !== id);
      renderMessagesList();
      if (state.selectedMessage && state.selectedMessage.id === id) {
        if (state.messages.length > 0) {
          selectMessage(state.messages[0]);
        } else {
          deselectMessage();
        }
      }
      showToast('Email deleted', 'info');
    }
  } catch (err) {
    showToast('Failed to delete email', 'danger');
  }
}

async function simulateOtp(senderType) {
  if (!state.activeAddress) return;
  try {
    showToast(`Generating simulated OTP from ${senderType.toUpperCase()}...`, 'info');
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: state.activeAddress, senderType })
    });
    const data = await res.json();
    if (data.success) {
      // WebSocket handles message reception and sound
    }
  } catch (err) {
    showToast('Simulation failed', 'danger');
  }
}

// ==========================================================================
// WebSockets & Real-Time Sync
// ==========================================================================

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    elements.connectionStatusChip.classList.remove('disconnected');
    elements.connectionStatusText.textContent = 'Live Feed Connected';
  };

  state.ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleWebSocketEvent(payload.event, payload.data);
    } catch (err) {
      console.error('Failed to parse WS message:', err);
    }
  };

  state.ws.onclose = () => {
    elements.connectionStatusChip.classList.add('disconnected');
    elements.connectionStatusText.textContent = 'Reconnecting...';
    // Reconnect after 3 seconds
    setTimeout(connectWebSocket, 3000);
  };

  state.ws.onerror = () => {
    state.ws.close();
  };
}

function handleWebSocketEvent(event, data) {
  switch (event) {
    case 'new_message':
      handleIncomingMessage(data);
      break;
    case 'inbox_created':
      if (!state.inboxes.some(ib => ib.address === data.address)) {
        state.inboxes.unshift(data);
        renderInboxesList();
      }
      break;
    case 'inbox_updated':
      const updateIdx = state.inboxes.findIndex(ib => ib.address === data.address);
      if (updateIdx !== -1) {
        state.inboxes[updateIdx] = data;
        if (state.activeAddress === data.address) {
          state.activeInbox = data;
        }
        renderInboxesList();
      }
      break;
    case 'inbox_deleted':
    case 'inbox_expired':
      state.inboxes = state.inboxes.filter(ib => ib.address !== data.address);
      renderInboxesList();
      if (state.activeAddress === data.address) {
        if (event === 'inbox_expired') {
          showToast(`Mailbox ${data.address} expired and was automatically scrapped`, 'warning');
        }
        if (state.inboxes.length > 0) {
          selectInbox(state.inboxes[0].address);
        } else {
          createNewInbox({ ttlMinutes: 30 });
        }
      }
      break;
    case 'message_deleted':
      state.messages = state.messages.filter(m => m.id !== data.id);
      renderMessagesList();
      if (state.selectedMessage && state.selectedMessage.id === data.id) {
        if (state.messages.length > 0) {
          selectMessage(state.messages[0]);
        } else {
          deselectMessage();
        }
      }
      break;
    case 'config_updated':
      state.config = data;
      updateDomainDisplay(data.domain);
      break;
  }
}

function handleIncomingMessage(msg) {
  const isForActive = state.activeAddress && msg.inboxAddress.toLowerCase() === state.activeAddress.toLowerCase();

  // Play incoming alert chime
  playNotificationSound();

  // Notify with Toast
  if (msg.otp) {
    showToast(`⚡ OTP Received: [${msg.otp}] from ${formatSenderName(msg.from)}`, 'success');
  } else {
    showToast(`New email received: "${msg.subject}"`, 'info');
  }

  // Update inboxes list count
  const inbox = state.inboxes.find(ib => ib.address.toLowerCase() === msg.inboxAddress.toLowerCase());
  if (inbox) {
    inbox.messageCount = (inbox.messageCount || 0) + 1;
    if (msg.otp) inbox.latestOtp = msg.otp;
    renderInboxesList();
  }

  // If for current inbox, prepend and select
  if (isForActive) {
    state.messages.unshift(msg);
    renderMessagesList();
    selectMessage(msg);
  }
}

// ==========================================================================
// UI Rendering & Interactivity
// ==========================================================================

function updateDomainDisplay(domain) {
  elements.currentDomainBadge.textContent = domain;
  elements.domainSuffixText.textContent = `@${domain}`;
  elements.customDomainInput.value = domain;
}

function selectInbox(address) {
  state.activeAddress = address;
  state.activeInbox = state.inboxes.find(ib => ib.address === address) || null;

  elements.currentEmailDisplay.textContent = address;
  elements.readerListeningAddress.textContent = address;
  elements.currentInboxHeading.textContent = address;

  renderInboxesList();
  loadMessages(address);
}

function renderInboxesList() {
  elements.inboxCountBadge.textContent = state.inboxes.length;
  elements.activeInboxesList.innerHTML = '';

  state.inboxes.forEach(ib => {
    const item = document.createElement('div');
    item.className = `inbox-list-item ${ib.address === state.activeAddress ? 'active' : ''}`;
    
    const count = ib.messageCount || 0;
    const timeLeft = ib.expiresAt ? formatTimeLeft(ib.expiresAt) : 'Permanent';

    item.innerHTML = `
      <div class="inbox-item-info">
        <span class="inbox-item-addr">${escapeHtml(ib.address)}</span>
        <span class="inbox-item-sub">${timeLeft} • ${count} mail${count !== 1 ? 's' : ''}</span>
      </div>
      <div class="inbox-item-badges">
        ${ib.latestOtp ? `<span class="message-otp-chip" style="font-size: 0.7rem; padding: 1px 5px;">${escapeHtml(ib.latestOtp)}</span>` : ''}
        <span class="count-badge">${count}</span>
        <button class="btn-item-delete" title="Scrap mailbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-item-delete')) {
        e.stopPropagation();
        scrapInbox(ib.address);
      } else {
        selectInbox(ib.address);
      }
    });

    elements.activeInboxesList.appendChild(item);
  });
}

function renderMessagesList() {
  const query = elements.messageSearchInput.value.toLowerCase().trim();
  const filtered = state.messages.filter(m => {
    if (!query) return true;
    return (m.subject && m.subject.toLowerCase().includes(query)) ||
           (m.from && m.from.toLowerCase().includes(query)) ||
           (m.otp && m.otp.toLowerCase().includes(query)) ||
           (m.text && m.text.toLowerCase().includes(query));
  });

  elements.inboxMessageCounter.textContent = `${filtered.length} message${filtered.length !== 1 ? 's' : ''}`;
  elements.messageListContainer.innerHTML = '';

  if (filtered.length === 0) {
    elements.messageListContainer.innerHTML = `
      <div class="empty-list-notice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>No messages received yet.<br>Emails sent to this address will pop up immediately!</p>
      </div>
    `;
    return;
  }

  filtered.forEach(msg => {
    const item = document.createElement('div');
    const isSelected = state.selectedMessage && state.selectedMessage.id === msg.id;
    item.className = `message-item ${isSelected ? 'active' : ''}`;

    const sender = formatSenderName(msg.from);
    const timeAgo = formatTimeAgo(msg.receivedAt);

    item.innerHTML = `
      <div class="message-item-header">
        <span class="message-sender">${escapeHtml(sender)}</span>
        <span class="message-time">${timeAgo}</span>
      </div>
      <div class="message-subject">${escapeHtml(msg.subject || '(No Subject)')}</div>
      ${msg.otp ? `<div class="message-otp-chip">⚡ OTP: ${escapeHtml(msg.otp)}</div>` : ''}
    `;

    item.addEventListener('click', () => selectMessage(msg));
    elements.messageListContainer.appendChild(item);
  });
}

function selectMessage(msg) {
  state.selectedMessage = msg;

  elements.readerEmptyState.classList.add('hidden');
  elements.readerDetailView.classList.remove('hidden');

  // OTP Hero Banner
  if (msg.otp) {
    elements.otpHeroBanner.classList.remove('hidden');
    elements.otpLargeDigits.textContent = msg.otp;
  } else {
    elements.otpHeroBanner.classList.add('hidden');
  }

  // Metadata
  elements.readerSubject.textContent = msg.subject || '(No Subject)';
  elements.readerSenderName.textContent = formatSenderName(msg.from);
  elements.readerSenderAddress.textContent = msg.from;
  elements.readerSenderAvatar.textContent = (formatSenderName(msg.from)[0] || 'E').toUpperCase();
  elements.readerTimestamp.textContent = new Date(msg.receivedAt).toLocaleString();
  elements.readerToAddress.textContent = msg.to;

  // Contents
  elements.emailHtmlIframe.srcdoc = msg.html || `<p>${escapeHtml(msg.text)}</p>`;
  elements.emailPlainTextPreview.textContent = msg.text || '(No text version provided)';
  elements.emailRawDetailsBox.textContent = JSON.stringify({
    id: msg.id,
    from: msg.from,
    to: msg.to,
    subject: msg.subject,
    otp: msg.otp,
    receivedAt: new Date(msg.receivedAt).toISOString(),
    rawSize: `${(msg.rawSize / 1024).toFixed(1)} KB`
  }, null, 2);

  // Re-render list active highlight
  renderMessagesList();
}

function deselectMessage() {
  state.selectedMessage = null;
  elements.readerEmptyState.classList.remove('hidden');
  elements.readerDetailView.classList.add('hidden');
  renderMessagesList();
}

// ==========================================================================
// Countdown & Auto-Scrap Ticker
// ==========================================================================

function startCountdownTicker() {
  if (state.countdownTimerId) clearInterval(state.countdownTimerId);

  state.countdownTimerId = setInterval(() => {
    if (!state.activeInbox) return;

    if (!state.activeInbox.expiresAt) {
      elements.countdownTimer.textContent = 'Never';
      elements.timerProgressRing.style.strokeDashoffset = '0';
      return;
    }

    const remainingMs = state.activeInbox.expiresAt - Date.now();
    if (remainingMs <= 0) {
      elements.countdownTimer.textContent = '00:00';
      elements.timerProgressRing.style.strokeDashoffset = '62.8';
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    elements.countdownTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Update circular progress ring
    const initialTtlSeconds = (state.activeInbox.ttlMinutes || 30) * 60;
    const progress = Math.min(1, Math.max(0, totalSeconds / initialTtlSeconds));
    const circumference = 62.8; // 2 * PI * r (r=10)
    elements.timerProgressRing.style.strokeDashoffset = String(circumference * (1 - progress));
  }, 1000);
}

// ==========================================================================
// Event Listeners
// ==========================================================================

function setupEventListeners() {
  // Copy Active Address
  elements.emailAddressBox.addEventListener('click', () => copyToClipboard(state.activeAddress, elements.copyTooltip));
  elements.copyAddressBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(state.activeAddress, elements.copyTooltip);
  });

  // Copy OTP button in hero banner
  elements.copyOtpBtn.addEventListener('click', () => {
    if (state.selectedMessage && state.selectedMessage.otp) {
      navigator.clipboard.writeText(state.selectedMessage.otp);
      elements.copyOtpBtnText.textContent = 'Copied!';
      showToast(`Copied OTP ${state.selectedMessage.otp} to clipboard!`, 'success');
      setTimeout(() => {
        elements.copyOtpBtnText.textContent = 'Copy OTP';
      }, 2000);
    }
  });

  // Action buttons
  elements.extendTimeBtn.addEventListener('click', () => {
    if (state.activeAddress) extendInboxTime(state.activeAddress, 15);
  });

  elements.scrapInboxBtn.addEventListener('click', () => {
    if (state.activeAddress && confirm(`Scrap mailbox ${state.activeAddress} and delete all stored emails?`)) {
      scrapInbox(state.activeAddress);
    }
  });

  // TTL Chip selector
  elements.ttlChipGroup.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    elements.ttlChipGroup.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.selectedTtl = parseInt(chip.dataset.ttl, 10);
  });

  // Create New Inbox
  elements.createNewInboxBtn.addEventListener('click', () => {
    const alias = elements.customAliasInput.value.trim();
    createNewInbox({ alias, ttlMinutes: state.selectedTtl });
    elements.customAliasInput.value = '';
  });

  elements.customAliasInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      elements.createNewInboxBtn.click();
    }
  });

  // Search input
  elements.messageSearchInput.addEventListener('input', () => {
    renderMessagesList();
  });

  // Refresh Inbox
  elements.refreshInboxBtn.addEventListener('click', async () => {
    elements.refreshSpinIcon.style.animation = 'spin 0.6s linear';
    setTimeout(() => elements.refreshSpinIcon.style.animation = '', 600);
    if (state.activeAddress) {
      await loadMessages(state.activeAddress);
      showToast('Inbox refreshed', 'info');
    }
  });

  // Delete single message
  elements.deleteCurrentMessageBtn.addEventListener('click', () => {
    if (state.selectedMessage) {
      deleteMessage(state.selectedMessage.id);
    }
  });

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      if (tabId === 'html') elements.emailHtmlIframe.parentElement.classList.add('active');
      if (tabId === 'text') elements.emailPlainTextPreview.parentElement.classList.add('active');
      if (tabId === 'headers') elements.emailRawDetailsBox.parentElement.classList.add('active');
    });
  });

  // Sound Toggle
  elements.soundToggleBtn.addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    elements.soundOnIcon.classList.toggle('hidden', !state.soundEnabled);
    elements.soundOffIcon.classList.toggle('hidden', state.soundEnabled);
    showToast(state.soundEnabled ? 'Audio notifications enabled' : 'Audio notifications muted', 'info');
  });

  // Simulate Dropdown
  elements.simulateDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.simulateDropdownMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    elements.simulateDropdownMenu.classList.add('hidden');
  });

  elements.simulateDropdownMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.dropdown-item');
    if (!item) return;
    const sender = item.dataset.sender;
    simulateOtp(sender);
  });

  // Domain Config Modal
  elements.openDomainModalBtn.addEventListener('click', () => {
    elements.domainModal.classList.remove('hidden');
  });

  const closeModal = () => elements.domainModal.classList.add('hidden');
  elements.closeDomainModalBtn.addEventListener('click', closeModal);
  elements.cancelDomainModalBtn.addEventListener('click', closeModal);

  elements.saveDomainModalBtn.addEventListener('click', async () => {
    const domain = elements.customDomainInput.value.trim().replace(/^@/, '');
    if (!domain) return;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      const data = await res.json();
      if (data.success) {
        state.config = data.config;
        updateDomainDisplay(data.config.domain);
        closeModal();
        showToast(`Domain updated to ${domain}`, 'success');
      }
    } catch (err) {
      showToast('Failed to update domain', 'danger');
    }
  });
}

// ==========================================================================
// Utilities
// ==========================================================================

function copyToClipboard(text, tooltipEl) {
  if (!text) return;
  navigator.clipboard.writeText(text);
  if (tooltipEl) {
    tooltipEl.textContent = 'Copied!';
    tooltipEl.classList.add('show');
    setTimeout(() => {
      tooltipEl.textContent = 'Copy';
      tooltipEl.classList.remove('show');
    }, 1500);
  }
  showToast(`Copied ${text}`, 'success');
}

function playNotificationSound() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // AudioContext blocked before user gesture
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function formatSenderName(fromStr = '') {
  if (!fromStr) return 'Unknown Sender';
  const match = fromStr.match(/^"?([^"<]+)"?\s*(?:<.*>)?$/);
  if (match && match[1].trim()) return match[1].trim();
  return fromStr.split('@')[0] || fromStr;
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatTimeLeft(expiresAt) {
  const diffSec = Math.floor((expiresAt - Date.now()) / 1000);
  if (diffSec <= 0) return 'Expired';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m left`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h left`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Start app
document.addEventListener('DOMContentLoaded', init);
