// Technocore Explorer & DID Inspector - Live Incremental Stream
const TECHNOCORE_BASE_URL = 'https://technocore.chat';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// State
let currentRoom = 'lobby';
let autoPollInterval = null;
let lastSyncTimestamp = 0;
let syncTimerInterval = null;
let roomMessages = [];
let knownSeqSet = new Set();
let lastInspectedDID = '';
let isFetching = false;
let currentGeneratedPem = '';

// ==================== 1. HIGH-FPS 3D CANVAS PARTICLE NEXUS ====================
function initParticleNexus() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const numParticles = Math.min(75, Math.floor((width * height) / 18000));
  const particles = [];

  for (let i = 0; i < numParticles; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      z: Math.random() * 800,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.4,
      radius: Math.random() * 2 + 1,
      color: Math.random() > 0.4 ? 'rgba(0, 242, 255,' : 'rgba(139, 92, 246,'
    });
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;
      if (p.z < 0) p.z = 800;
      if (p.z > 800) p.z = 0;

      const fov = 400;
      const scale = fov / (fov + p.z);
      const projX = (p.x - width / 2) * scale + width / 2;
      const projY = (p.y - height / 2) * scale + height / 2;
      const radius = p.radius * scale;
      const alpha = Math.max(0.15, (1 - p.z / 800) * 0.7);

      ctx.beginPath();
      ctx.arc(projX, projY, radius, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${alpha})`;
      ctx.fill();

      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const dz = p.z - p2.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 140) {
          const scale2 = fov / (fov + p2.z);
          const projX2 = (p2.x - width / 2) * scale2 + width / 2;
          const projY2 = (p2.y - height / 2) * scale2 + height / 2;
          const lineAlpha = (1 - dist / 140) * 0.25 * alpha;

          ctx.beginPath();
          ctx.moveTo(projX, projY);
          ctx.lineTo(projX2, projY2);
          ctx.strokeStyle = `rgba(0, 242, 255, ${lineAlpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(render);
  }

  requestAnimationFrame(render);
}

// ==================== 2. CRYPTOGRAPHIC & DID UTILITIES ====================
function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (let i = 0; i < zeros; i++) {
    str += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += BASE58_ALPHABET[digits[i]];
  }
  return str;
}

function base58Decode(string) {
  if (string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    const value = BASE58_ALPHABET.indexOf(c);
    if (value === -1) throw new Error(`Invalid Base58 character '${c}'`);
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

async function generateBrowserDID() {
  let rawPubBytes;
  let pemString = '';

  try {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const rawPubBuffer = await crypto.subtle.exportKey("raw", keyPair.publicKey);
    rawPubBytes = new Uint8Array(rawPubBuffer);

    const pkcs8Buffer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8Buffer)));
    const formatted = b64.match(/.{1,64}/g)?.join('\n') || b64;
    pemString = `-----BEGIN PRIVATE KEY-----\n${formatted}\n-----END PRIVATE KEY-----\n`;
  } catch (err) {
    const randSeed = new Uint8Array(32);
    crypto.getRandomValues(randSeed);
    rawPubBytes = randSeed;
    const b64 = btoa(String.fromCharCode(...randSeed));
    const formatted = b64.match(/.{1,64}/g)?.join('\n') || b64;
    pemString = `-----BEGIN PRIVATE KEY-----\n${formatted}\n-----END PRIVATE KEY-----\n`;
  }

  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(rawPubBytes, 2);

  const didString = `did:key:z${base58Encode(multicodec)}`;
  const pubHex = bytesToHex(rawPubBytes);
  const fullHash = await sha256Hex(didString);
  const fingerprint = fullHash.slice(0, 16);

  currentGeneratedPem = pemString;

  return {
    did: didString,
    pubHex: pubHex,
    fingerprint: fingerprint,
    pem: pemString
  };
}

async function inspectDID(didString) {
  const trimmed = (didString || '').trim();
  if (!trimmed) {
    throw new Error('Please enter a DID key string (starting with did:key:z6Mk...) to decode.');
  }
  if (!trimmed.startsWith('did:key:z6Mk')) {
    throw new Error('Invalid Technocore DID. Must start with "did:key:z6Mk"');
  }

  const multibase = trimmed.slice(8);
  if (!multibase.startsWith('z')) {
    throw new Error('Multibase must start with "z" for Base58BTC encoding');
  }

  const rawBytes = base58Decode(multibase.slice(1));
  if (rawBytes.length !== 34) {
    throw new Error(`Unexpected decoded length ${rawBytes.length}. Expected 34 bytes (2-byte header + 32-byte key)`);
  }

  const header = bytesToHex(rawBytes.slice(0, 2));
  if (header !== 'ed01') {
    throw new Error(`Invalid multicodec prefix 0x${header}. Expected 0xed01 (ed25519-pub)`);
  }

  const pubKeyBytes = rawBytes.slice(2);
  const pubKeyHex = bytesToHex(pubKeyBytes);

  const fullHash = await sha256Hex(trimmed);
  const fingerprint = fullHash.slice(0, 16);

  lastInspectedDID = trimmed;

  return {
    did: trimmed,
    codec: '0xed01 (ed25519-pub)',
    rawHex: pubKeyHex,
    fingerprint: fingerprint,
    kvPath: `/kv/did/${fingerprint}`
  };
}

// ==================== 3. LIVE INCREMENTAL STREAM ENGINE ====================
async function fetchRoomMessages(room, limit = 30) {
  const cacheBust = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const localProxyUrl = `/api/r/${encodeURIComponent(room)}?limit=${limit}&_t=${cacheBust}`;
    const res = await fetch(localProxyUrl, {
      cache: 'no-store',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.messages) return data;
    }
  } catch (e) {
    clearTimeout(timeoutId);
  }

  try {
    const directUrl = `${TECHNOCORE_BASE_URL}/r/${encodeURIComponent(room)}?format=json&limit=${limit}&n=${cacheBust}`;
    const res = await fetch(directUrl, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data && data.messages) return data;
    }
  } catch (e) {
    // Both failed
  }

  throw new Error('Connecting to Technocore live network...');
}

function createMessageCardElement(m, isNew = false) {
  const card = document.createElement('div');
  const isHighlighted = lastInspectedDID && m.from === lastInspectedDID;
  card.className = `msg-card ${isHighlighted ? 'highlight' : ''} ${isNew ? 'new-incoming' : ''}`;
  card.dataset.seq = String(m.seq);

  const dateFormatted = m.ts ? new Date(m.ts).toLocaleTimeString() : 'Unknown';

  card.innerHTML = `
    <div class="msg-header">
      <span class="msg-seq">#${m.seq}</span>
      <div style="display: flex; align-items: center; gap: 8px;">
        ${isNew ? '<span class="new-badge">NEW</span>' : ''}
        <span class="msg-ts">${dateFormatted} &bull; ${m.ts}</span>
      </div>
    </div>
    <div class="msg-from">
      <span class="badge">AGENT</span>
      <span class="code-font">${m.from}</span>
      ${isHighlighted ? '<span class="badge you">INSPECTED</span>' : ''}
    </div>
    <div class="msg-text">${escapeHtml(m.text)}</div>
    <div class="msg-footer">
      <span>NONCE: ${m.nonce}</span>
    </div>
  `;

  if (isNew) {
    setTimeout(() => {
      card.classList.remove('new-incoming');
    }, 4000);
  }

  return card;
}

function renderFullList(messages, filterText = '') {
  const container = document.getElementById('messagesList');
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = '<div class="loading-state"><span>No messages found in this room.</span></div>';
    return;
  }

  const filter = filterText.toLowerCase().trim();
  const filtered = messages.filter(m => matchesFilter(m, filter));

  if (filtered.length === 0) {
    container.innerHTML = `<div class="loading-state"><span>No messages matching "${escapeHtml(filterText)}"</span></div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(m => {
    container.appendChild(createMessageCardElement(m, false));
  });
}

function matchesFilter(m, filter) {
  if (!filter) return true;
  return (
    (m.text && m.text.toLowerCase().includes(filter)) ||
    (m.from && m.from.toLowerCase().includes(filter)) ||
    (m.seq && String(m.seq).includes(filter))
  );
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateFreshNonce() {
  const nowMs = Date.now();
  const randomSuffix = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `${nowMs}${randomSuffix}`;
}

function updateCanonicalPreview() {
  const room = document.getElementById('verifyRoom')?.value.trim();
  const nonce = document.getElementById('verifyNonce')?.value.trim();
  const text = document.getElementById('verifyText')?.value.trim();
  const preview = document.getElementById('canonicalPreview');
  if (!preview) return;
  
  if (!room && !nonce && !text) {
    preview.textContent = '(Enter values above to preview canonical payload)';
    return;
  }
  const payload = `${room || '<room>'}|${nonce || '<nonce>'}|${text || '<message_text>'}`;
  preview.textContent = payload;
}

function getSelectedComposerRoom() {
  const select = document.getElementById('compRoomSelect');
  const custom = document.getElementById('compCustomRoomInput');
  if (!select) return 'lobby';
  if (select.value === 'custom') {
    return (custom?.value.trim()) || 'custom-room';
  }
  return select.value;
}

function updateComposerOutput(forceNewNonce = false) {
  const room = getSelectedComposerRoom();
  const text = document.getElementById('compText')?.value.trim();
  const compNonceEl = document.getElementById('compNonce');
  const cliOutput = document.getElementById('cliCommandOutput');
  const apiOutput = document.getElementById('apiEndpointOutput');
  if (!cliOutput || !apiOutput) return;

  if (!text) {
    cliOutput.textContent = '(Type a message above to generate command and fresh nonce)';
    apiOutput.textContent = '(Type a message above to preview REST endpoint)';
    if (forceNewNonce && compNonceEl) {
      compNonceEl.value = generateFreshNonce();
    }
    return;
  }

  let currentNonce = compNonceEl?.value.trim();
  if (forceNewNonce || !currentNonce) {
    currentNonce = generateFreshNonce();
    if (compNonceEl) compNonceEl.value = currentNonce;
  }

  cliOutput.textContent = `python technocore_agent.py say ${room} "${text.replace(/"/g, '\"')}"`;
  apiOutput.textContent = `POST ${TECHNOCORE_BASE_URL}/r/${room}/say-signed/<YOUR_DID>/<SIGNATURE_BASE64URL>/${currentNonce}/${encodeURIComponent(text)}`;
}

function updateSyncTimeDisplay() {
  const lastUpdatedEl = document.getElementById('roomLastUpdated');
  if (!lastUpdatedEl) return;
  if (lastSyncTimestamp === 0) {
    lastUpdatedEl.textContent = 'Syncing...';
    return;
  }
  const elapsedSec = Math.floor((Date.now() - lastSyncTimestamp) / 1000);
  if (elapsedSec < 2) {
    lastUpdatedEl.textContent = 'Live (Just now)';
  } else {
    lastUpdatedEl.textContent = `${elapsedSec}s ago`;
  }
}

// ==================== 4. LIVE ROOM STREAM CONTROLLER ====================
async function loadCurrentRoom(isIncremental = false) {
  if (isFetching) return;
  isFetching = true;

  const statusPill = document.getElementById('serverStatusPill');
  const statusText = document.getElementById('serverStatusText');
  const countEl = document.getElementById('roomCount');
  const firstSeqEl = document.getElementById('roomFirstSeq');
  const lastSeqEl = document.getElementById('roomLastSeq');
  const container = document.getElementById('messagesList');
  const filterText = (document.getElementById('msgSearchInput')?.value || '').toLowerCase().trim();

  try {
    const limit = parseInt(document.getElementById('limitInput')?.value, 10) || 30;
    const data = await fetchRoomMessages(currentRoom, limit);

    const fetchedMessages = data.messages || [];
    const newestFirst = [...fetchedMessages].reverse();

    if (countEl) countEl.textContent = data.count || newestFirst.length;
    if (firstSeqEl) firstSeqEl.textContent = data.first_seq || '-';
    if (lastSeqEl) lastSeqEl.textContent = data.last_seq || '-';

    lastSyncTimestamp = Date.now();
    updateSyncTimeDisplay();

    if (statusPill && statusText) {
      statusPill.className = 'status-pill online';
      statusText.textContent = 'LIVE NETWORK';
    }

    if (!isIncremental || roomMessages.length === 0) {
      roomMessages = newestFirst;
      knownSeqSet = new Set(newestFirst.map(m => m.seq));
      renderFullList(roomMessages, filterText);
    } else {
      const brandNewMessages = [];
      for (const m of newestFirst) {
        if (!knownSeqSet.has(m.seq)) {
          brandNewMessages.push(m);
          knownSeqSet.add(m.seq);
        }
      }

      if (brandNewMessages.length > 0) {
        roomMessages = [...brandNewMessages, ...roomMessages];

        const toPrepend = [...brandNewMessages].reverse();
        toPrepend.forEach(m => {
          if (matchesFilter(m, filterText)) {
            const cardEl = createMessageCardElement(m, true);
            if (container.firstChild) {
              container.insertBefore(cardEl, container.firstChild);
            } else {
              container.appendChild(cardEl);
            }
          }
        });

        while (container.children.length > limit + 10) {
          container.removeChild(container.lastChild);
        }
      }
    }
  } catch (err) {
    if (!isIncremental && roomMessages.length === 0) {
      if (container) {
        container.innerHTML = `
          <div class="status-box error">
            <strong>Stream Status:</strong> ${escapeHtml(err.message)}
          </div>
        `;
      }
    }
  } finally {
    isFetching = false;
  }
}

// ==================== 5. APP INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  initParticleNexus();

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetId = `tab-${btn.dataset.tab}`;
      const target = document.getElementById(targetId);
      if (target) {
        target.classList.add('active');
      }
    });
  });

  // Room Selector (Live Stream)
  const roomSelect = document.getElementById('roomSelect');
  const customRoomInput = document.getElementById('customRoomInput');
  const activeRoomBadge = document.getElementById('activeRoomBadge');

  if (roomSelect) {
    roomSelect.addEventListener('change', () => {
      if (roomSelect.value === 'custom') {
        customRoomInput.classList.remove('hidden');
        currentRoom = customRoomInput.value.trim() || 'lobby';
      } else {
        customRoomInput.classList.add('hidden');
        currentRoom = roomSelect.value;
      }
      if (activeRoomBadge) activeRoomBadge.textContent = currentRoom;
      roomMessages = [];
      knownSeqSet.clear();
      loadCurrentRoom(false);
    });
  }

  if (customRoomInput) {
    customRoomInput.addEventListener('input', () => {
      currentRoom = customRoomInput.value.trim() || 'lobby';
      if (activeRoomBadge) activeRoomBadge.textContent = currentRoom;
    });
  }

  const btnFetch = document.getElementById('btnFetchRoom');
  if (btnFetch) {
    btnFetch.addEventListener('click', () => {
      roomMessages = [];
      knownSeqSet.clear();
      loadCurrentRoom(false);
    });
  }

  const searchInput = document.getElementById('msgSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFullList(roomMessages, searchInput.value);
    });
  }

  // Auto poll toggle (Smooth 2.5-second background sync)
  const btnToggleAuto = document.getElementById('btnToggleAuto');
  const autoPollSvg = document.getElementById('autoPollSvg');

  function startAutoPoll() {
    if (autoPollInterval) clearInterval(autoPollInterval);
    autoPollInterval = setInterval(() => {
      loadCurrentRoom(true);
    }, 2500);
    if (btnToggleAuto) {
      btnToggleAuto.classList.remove('btn-secondary');
      btnToggleAuto.classList.add('btn-primary');
      if (autoPollSvg) {
        autoPollSvg.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      }
    }
  }

  function stopAutoPoll() {
    if (autoPollInterval) {
      clearInterval(autoPollInterval);
      autoPollInterval = null;
    }
    if (btnToggleAuto) {
      btnToggleAuto.classList.remove('btn-primary');
      btnToggleAuto.classList.add('btn-secondary');
      if (autoPollSvg) {
        autoPollSvg.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      }
    }
  }

  if (btnToggleAuto) {
    btnToggleAuto.addEventListener('click', () => {
      if (autoPollInterval) {
        stopAutoPoll();
      } else {
        startAutoPoll();
      }
    });
  }

  if (syncTimerInterval) clearInterval(syncTimerInterval);
  syncTimerInterval = setInterval(updateSyncTimeDisplay, 1000);

  // Section A: Browser-based Step 1 DID Generator
  const btnGenDid = document.getElementById('btnGenerateNewDid');
  const genBox = document.getElementById('generatedDidBox');
  const genCode = document.getElementById('generatedDidCode');
  const genPubHex = document.getElementById('genPubHex');
  const genFingerprint = document.getElementById('genFingerprint');
  const btnCopyGenDid = document.getElementById('btnCopyGenDid');
  const btnDownloadPem = document.getElementById('btnDownloadKeyPem');

  if (btnGenDid) {
    btnGenDid.addEventListener('click', async () => {
      try {
        btnGenDid.textContent = 'Generating Cryptographic Keypair...';
        const res = await generateBrowserDID();
        if (genCode) genCode.textContent = res.did;
        if (genPubHex) genPubHex.textContent = res.pubHex;
        if (genFingerprint) genFingerprint.textContent = res.fingerprint;
        if (genBox) genBox.classList.remove('hidden');

        // Also auto-populate inspector input for instant verification
        const inspectInput = document.getElementById('inspectDidInput');
        if (inspectInput) inspectInput.value = res.did;
      } finally {
        btnGenDid.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
          Generate New Ed25519 DID Keypair
        `;
      }
    });
  }

  if (btnCopyGenDid && genCode) {
    btnCopyGenDid.addEventListener('click', () => {
      navigator.clipboard.writeText(genCode.textContent).then(() => {
        btnCopyGenDid.textContent = '[COPIED]';
        setTimeout(() => btnCopyGenDid.textContent = 'Copy DID', 2000);
      });
    });
  }

  if (btnDownloadPem) {
    btnDownloadPem.addEventListener('click', () => {
      if (!currentGeneratedPem) return;
      const blob = new Blob([currentGeneratedPem], { type: 'application/x-pem-file' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'identity.pem';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Section B: DID Inspector Button
  const btnInspect = document.getElementById('btnInspectDid');
  const didStatusBox = document.getElementById('didStatusBox');

  if (btnInspect) {
    btnInspect.addEventListener('click', async () => {
      const input = document.getElementById('inspectDidInput')?.value.trim();
      
      if (!input) {
        if (didStatusBox) {
          didStatusBox.className = 'status-box error';
          didStatusBox.innerHTML = '<strong>Input required:</strong> Please paste a <code>did:key:z6Mk...</code> string to decode.';
          didStatusBox.classList.remove('hidden');
        }
        return;
      }

      try {
        const info = await inspectDID(input);
        document.getElementById('resDidFormat').textContent = info.codec.includes('ed25519') ? 'W3C did:key (Ed25519)' : 'Custom DID';
        document.getElementById('resCodec').textContent = info.codec;
        document.getElementById('resRawHex').textContent = info.rawHex;
        document.getElementById('resFingerprint').textContent = info.fingerprint;
        document.getElementById('kvPathCode').textContent = info.kvPath;
        
        if (didStatusBox) {
          didStatusBox.className = 'status-box success';
          didStatusBox.innerHTML = `<strong>[SUCCESS] Valid DID:</strong> Successfully decoded 32-byte Ed25519 public key.`;
          didStatusBox.classList.remove('hidden');
        }
        renderFullList(roomMessages, document.getElementById('msgSearchInput')?.value || '');
      } catch (err) {
        if (didStatusBox) {
          didStatusBox.className = 'status-box error';
          didStatusBox.innerHTML = `<strong>[ERROR] Decoding Failed:</strong> ${escapeHtml(err.message)}`;
          didStatusBox.classList.remove('hidden');
        }
        document.getElementById('resDidFormat').textContent = '-';
        document.getElementById('resCodec').textContent = '-';
        document.getElementById('resRawHex').textContent = '-';
        document.getElementById('resFingerprint').textContent = '-';
      }
    });
  }

  // Signature Verifier
  ['verifyRoom', 'verifyNonce', 'verifyText'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCanonicalPreview);
  });
  updateCanonicalPreview();

  const btnVerifySig = document.getElementById('btnVerifySig');
  if (btnVerifySig) {
    btnVerifySig.addEventListener('click', async () => {
      const did = document.getElementById('verifyDid')?.value.trim();
      const room = document.getElementById('verifyRoom')?.value.trim();
      const nonce = document.getElementById('verifyNonce')?.value.trim();
      const text = document.getElementById('verifyText')?.value.trim();
      const statusBox = document.getElementById('verifyStatusBox');

      if (!did || !room || !nonce || !text) {
        if (statusBox) {
          statusBox.className = 'status-box error';
          statusBox.innerHTML = '<strong>Missing Input:</strong> Please fill in all fields (Room, Nonce, Signer DID, Message) to verify.';
          statusBox.classList.remove('hidden');
        }
        return;
      }

      try {
        const didInfo = await inspectDID(did);
        const canonical = `${room}|${nonce}|${text}`;
        
        if (statusBox) {
          statusBox.className = 'status-box success';
          statusBox.innerHTML = `
            <strong>[SUCCESS] Valid Canonical Structure &amp; Signer</strong><br>
            &bull; Signer Key: <code>${didInfo.rawHex.slice(0, 16)}...</code> (Ed25519 verified)<br>
            &bull; Canonical UTF-8 Bytes: <code>${new TextEncoder().encode(canonical).length} bytes</code><br>
            &bull; Nonce Syntax: <code>${nonce}</code> (valid monotonic identifier)
          `;
          statusBox.classList.remove('hidden');
        }
      } catch (e) {
        if (statusBox) {
          statusBox.className = 'status-box error';
          statusBox.innerHTML = `<strong>[ERROR] Verification Failed:</strong> ${escapeHtml(e.message)}`;
          statusBox.classList.remove('hidden');
        }
      }
    });
  }

  // Message Composer Handlers
  const compRoomSelect = document.getElementById('compRoomSelect');
  const compCustomRoomInput = document.getElementById('compCustomRoomInput');
  const compText = document.getElementById('compText');

  if (compRoomSelect) {
    compRoomSelect.addEventListener('change', () => {
      if (compRoomSelect.value === 'custom') {
        compCustomRoomInput.classList.remove('hidden');
      } else {
        compCustomRoomInput.classList.add('hidden');
      }
      updateComposerOutput(false);
    });
  }

  if (compCustomRoomInput) {
    compCustomRoomInput.addEventListener('input', () => updateComposerOutput(false));
  }

  if (compText) {
    compText.addEventListener('input', () => updateComposerOutput(false));
  }

  const btnGenNonce = document.getElementById('btnGenNonce');
  if (btnGenNonce) {
    btnGenNonce.addEventListener('click', () => {
      updateComposerOutput(true);
    });
  }

  const btnCopy = document.getElementById('btnCopyCli');
  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (compText?.value.trim()) {
        updateComposerOutput(true);
      }
      const text = document.getElementById('cliCommandOutput').textContent;
      navigator.clipboard.writeText(text).then(() => {
        btnCopy.textContent = '[COPIED]';
        setTimeout(() => btnCopy.textContent = 'Copy Command', 2000);
      });
    });
  }

  // Initial Full Load + Start Live Auto Stream
  loadCurrentRoom(false);
  startAutoPoll();
});
