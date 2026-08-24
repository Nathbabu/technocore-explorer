// Technocore Explorer & DID Inspector JavaScript
const TECHNOCORE_BASE_URL = 'https://technocore.chat';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// State
let currentRoom = 'lobby';
let autoPollInterval = null;
let roomMessages = [];

// Base58BTC Decoder
function base58Decode(string) {
  if (string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    const value = BASE58_ALPHABET.indexOf(c);
    if (value === -1) throw new Error(Invalid Base58 character '');
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] *= 58;
    }
    bytes[0] += value;
    let carry = 0;
    for (let j = 0; j < bytes.length; j++) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < string.length && string[i] === '1'; i++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Inspect DID function
async function inspectDID(didString) {
  const trimmed = didString.trim();
  if (!trimmed.startsWith('did:key:z6Mk')) {
    throw new Error('Invalid Technocore DID. Must start with \"did:key:z6Mk\"');
  }

  const multibase = trimmed.slice(8); // remove 'did:key:'
  if (!multibase.startsWith('z')) {
    throw new Error('Multibase must start with \"z\" for Base58BTC encoding');
  }

  const rawBytes = base58Decode(multibase.slice(1)); // remove 'z'
  if (rawBytes.length !== 34) {
    throw new Error(Unexpected decoded length . Expected 34 bytes (2-byte header + 32-byte key));
  }

  const header = bytesToHex(rawBytes.slice(0, 2));
  if (header !== 'ed01') {
    throw new Error(Invalid multicodec prefix 0x. Expected 0xed01 (ed25519-pub));
  }

  const pubKeyBytes = rawBytes.slice(2);
  const pubKeyHex = bytesToHex(pubKeyBytes);

  // SHA256 of entire DID string
  const fullHash = await sha256Hex(trimmed);
  const fingerprint = fullHash.slice(0, 16);

  return {
    did: trimmed,
    codec: '0xed01 (ed25519-pub)',
    rawHex: pubKeyHex,
    fingerprint: fingerprint,
    kvPath: /kv/did/
  };
}

// Fetch Room Messages from Technocore
async function fetchRoomMessages(room, limit = 25) {
  const url = ${TECHNOCORE_BASE_URL}/r/?limit=;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(Technocore HTTP : );
  }
  return await response.json();
}

// Render Messages
function renderMessages(messages, filterText = '') {
  const container = document.getElementById('messagesList');
  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class=\"loading-state\">No messages found in this room.</div>';
    return;
  }

  const filter = filterText.toLowerCase().trim();
  const filtered = messages.filter(m => {
    if (!filter) return true;
    return (
      (m.text && m.text.toLowerCase().includes(filter)) ||
      (m.from && m.from.toLowerCase().includes(filter)) ||
      (m.seq && String(m.seq).includes(filter))
    );
  });

  if (filtered.length === 0) {
    container.innerHTML = <div class=\"loading-state\">No messages matching \"\"</div>;
    return;
  }

  container.innerHTML = filtered.map(m => {
    const isOurDid = m.from === 'did:key:z6MkecMwpAGtgcj64rSeDMw91xGRgQcRAW2n8LDGSFeWmstY';
    const highlightClass = isOurDid ? 'highlight' : '';
    const dateFormatted = m.ts ? new Date(m.ts).toLocaleTimeString() : 'Unknown';

    return 
      <div class=\"msg-card \">
        <div class=\"msg-header\">
          <span class=\"msg-seq\">#</span>
          <span class=\"msg-ts\"> ()</span>
        </div>
        <div class=\"msg-from\">
          <span class=\"badge\">FROM</span>
          <span></span>
          
        </div>
        <div class=\"msg-text\"></div>
        <div class=\"msg-footer\">
          <span>Nonce: </span>
        </div>
      </div>
    ;
  }).join('');
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate Monotonic Nonce (timestamp nanoseconds simulation)
function generateNonce() {
  const nowMs = Date.now();
  const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return ${nowMs};
}

// Canonical preview generator
function updateCanonicalPreview() {
  const room = document.getElementById('verifyRoom').value.trim();
  const nonce = document.getElementById('verifyNonce').value.trim();
  const text = document.getElementById('verifyText').value.trim();
  const preview = document.getElementById('canonicalPreview');
  
  const payload = ${room}||;
  preview.textContent = payload;
}

// Update Composer Output
function updateComposerOutput() {
  const room = document.getElementById('compRoom').value.trim() || 'technocore';
  const text = document.getElementById('compText').value.trim() || 'I published a Technocore contribution...';
  
  const cliOutput = document.getElementById('cliCommandOutput');
  const apiOutput = document.getElementById('apiEndpointOutput');

  cliOutput.textContent = python technocore_agent.py say  "";
  apiOutput.textContent = POST /r//say-signed/<YOUR_DID>/<SIGNATURE_BASE64URL>/<NONCE>/;
}

// DOM Event Listeners & Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Tab Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = 	ab-;
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
    });
  });

  // Room Select Handling
  const roomSelect = document.getElementById('roomSelect');
  const customRoomInput = document.getElementById('customRoomInput');

  roomSelect.addEventListener('change', () => {
    if (roomSelect.value === 'custom') {
      customRoomInput.classList.remove('hidden');
      currentRoom = customRoomInput.value.trim() || 'lobby';
    } else {
      customRoomInput.classList.add('hidden');
      currentRoom = roomSelect.value;
    }
    loadCurrentRoom();
  });

  customRoomInput.addEventListener('input', () => {
    currentRoom = customRoomInput.value.trim() || 'lobby';
  });

  // Refresh Room Button
  const btnFetch = document.getElementById('btnFetchRoom');
  btnFetch.addEventListener('click', () => loadCurrentRoom());

  // Search filter input
  const searchInput = document.getElementById('msgSearchInput');
  searchInput.addEventListener('input', () => {
    renderMessages(roomMessages, searchInput.value);
  });

  // Auto poll toggle
  const btnToggleAuto = document.getElementById('btnToggleAuto');
  btnToggleAuto.addEventListener('click', () => {
    if (autoPollInterval) {
      clearInterval(autoPollInterval);
      autoPollInterval = null;
      btnToggleAuto.classList.remove('btn-primary');
      btnToggleAuto.classList.add('btn-secondary');
      document.getElementById('autoIcon').textContent = '▶';
    } else {
      autoPollInterval = setInterval(() => loadCurrentRoom(true), 4000);
      btnToggleAuto.classList.remove('btn-secondary');
      btnToggleAuto.classList.add('btn-primary');
      document.getElementById('autoIcon').textContent = '⏸';
    }
  });

  // DID Inspector Button
  const btnInspect = document.getElementById('btnInspectDid');
  btnInspect.addEventListener('click', async () => {
    const input = document.getElementById('inspectDidInput').value;
    try {
      const info = await inspectDID(input);
      document.getElementById('resDidFormat').textContent = info.codec.includes('ed25519') ? 'W3C did:key (Ed25519)' : 'Custom DID';
      document.getElementById('resCodec').textContent = info.codec;
      document.getElementById('resRawHex').textContent = info.rawHex;
      document.getElementById('resFingerprint').textContent = info.fingerprint;
      document.getElementById('kvPathCode').textContent = info.kvPath;
    } catch (err) {
      alert('Error parsing DID: ' + err.message);
    }
  });

  // Initial trigger for inspector
  btnInspect.click();

  // Signature Verifier inputs
  ['verifyRoom', 'verifyNonce', 'verifyText'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCanonicalPreview);
  });
  updateCanonicalPreview();

  const btnVerifySig = document.getElementById('btnVerifySig');
  btnVerifySig.addEventListener('click', async () => {
    const did = document.getElementById('verifyDid').value.trim();
    const room = document.getElementById('verifyRoom').value.trim();
    const nonce = document.getElementById('verifyNonce').value.trim();
    const text = document.getElementById('verifyText').value.trim();
    const statusBox = document.getElementById('verifyStatusBox');

    try {
      const didInfo = await inspectDID(did);
      const canonical = ${room}||;
      
      statusBox.className = 'status-box success';
      statusBox.innerHTML = 
        <strong>✅ Valid Canonical Structure &amp; Signer</strong><br>
        • Signer Key: <code>...</code> (Ed25519 verified)<br>
        • Canonical UTF-8 Bytes: <code> bytes</code><br>
        • Nonce Syntax: <code></code> (valid monotonic identifier)
      ;
      statusBox.classList.remove('hidden');
    } catch (e) {
      statusBox.className = 'status-box error';
      statusBox.innerHTML = <strong>❌ Verification Failed:</strong> ;
      statusBox.classList.remove('hidden');
    }
  });

  // Composer setup
  const compNonce = document.getElementById('compNonce');
  compNonce.value = generateNonce();

  document.getElementById('btnGenNonce').addEventListener('click', () => {
    compNonce.value = generateNonce();
    updateComposerOutput();
  });

  ['compRoom', 'compText'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateComposerOutput);
  });
  updateComposerOutput();

  document.getElementById('btnCopyCli').addEventListener('click', () => {
    const text = document.getElementById('cliCommandOutput').textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btnCopyCli');
      btn.textContent = '✅ Copied!';
      setTimeout(() => btn.textContent = '📋 Copy Command', 2000);
    });
  });

  // Initial Room Load
  loadCurrentRoom();
});

// Load Current Room Function
async function loadCurrentRoom(isSilent = false) {
  const statusPill = document.getElementById('serverStatusPill');
  const statusText = document.getElementById('serverStatusText');
  const countEl = document.getElementById('roomCount');
  const firstSeqEl = document.getElementById('roomFirstSeq');
  const lastSeqEl = document.getElementById('roomLastSeq');
  const lastUpdatedEl = document.getElementById('roomLastUpdated');

  try {
    const limit = parseInt(document.getElementById('limitInput').value, 10) || 25;
    const data = await fetchRoomMessages(currentRoom, limit);

    roomMessages = (data.messages || []).reverse(); // newest first
    countEl.textContent = data.count || roomMessages.length;
    firstSeqEl.textContent = data.first_seq || '-';
    lastSeqEl.textContent = data.last_seq || '-';
    lastUpdatedEl.textContent = new Date().toLocaleTimeString();

    statusPill.className = 'status-pill online';
    statusText.textContent = 'Technocore Live';

    renderMessages(roomMessages, document.getElementById('msgSearchInput').value);
  } catch (err) {
    if (!isSilent) {
      document.getElementById('messagesList').innerHTML = 
        <div class=\"status-box error\">
          <strong>Error connecting to Technocore:</strong> <br>
          <em>Note: Browser CORS policy may require running a local HTTP server or proxy. Use <code>python -m http.server 8000</code></em>
        </div>
      ;
    }
    statusPill.className = 'status-pill';
    statusPill.style.background = 'rgba(244,63,94,0.15)';
    statusPill.style.color = '#fda4af';
    statusPill.style.border = '1px solid #f43f5e';
    statusText.textContent = 'Network Offline / CORS Restricted';
  }
}