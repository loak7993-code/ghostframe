// GhostFrame mobile controller — REST-driven profile manager + fingerprint verifier.
// Classic script: uses globals `api`, `getSettings`, `saveSettings` from api.js.
'use strict';

const state = {
  profiles: [],
  selectedId: null,
  selected: null,
  settings: getSettings(),
  connected: null, // null | true | 'err'
  sessions: [],
  fpTimer: null,
};

const $ = (id) => document.getElementById(id);
const fmt = (v) => (v === undefined || v === null || v === '' ? '—' : String(v));

/* ---------------- tiny dom ---------------- */
function el(tag, opts, ...kids) {
  const n = document.createElement(tag);
  if (opts) {
    if (opts.class) n.className = opts.class;
    if (opts.text != null) n.textContent = opts.text;
    if (opts.title) n.title = opts.title;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) n.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null) continue;
    n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return n;
}
const ICONS = {
  check: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 11.2L3.4 8.6l.9-.9L6 9.4l5.7-5.7.9.9z" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V4A1.5 1.5 0 009.5 2.5H4A1.5 1.5 0 002.5 4v5.5A1.5 1.5 0 004 11h1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
};
function icon(name, cls) {
  const wrap = document.createElement('span');
  wrap.className = 'ibx' + (cls ? ' ' + cls : '');
  wrap.innerHTML = ICONS[name] || '';
  wrap.style.display = 'inline-flex';
  return wrap;
}

/* ---------------- toast ---------------- */
function toast(msg, kind = 'info') {
  const t = el('div', { class: 'toast toast-' + kind });
  t.appendChild(icon(kind === 'ok' ? 'check' : 'x'));
  t.appendChild(el('span', { text: msg }));
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 200); }, kind === 'err' ? 6000 : 3200);
}

/* ---------------- connectivity ---------------- */
async function checkConnection(silent) {
  try {
    await api.health();
    state.connected = true;
    setConnPill('online');
    return true;
  } catch (e) {
    state.connected = 'err';
    setConnPill('err');
    if (!silent) toast(e.message, 'err');
    return false;
  }
}
function setConnPill(mode) {
  const p = $('conn-pill');
  p.className = 'conn-pill ' + (mode === 'online' ? 'online' : mode === 'err' ? 'err' : 'offline');
  p.textContent = mode === 'online' ? 'connected' : mode === 'err' ? 'offline' : 'offline';
}

/* ---------------- views ---------------- */
function showView(id) {
  for (const v of document.querySelectorAll('.view')) v.classList.remove('active');
  $(id).classList.add('active');
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('active', b.dataset.view === id);
  if (id === 'view-sessions') refreshSessions();
  if (id === 'view-profiles') renderList();
}

/* ---------------- profiles list ---------------- */
function filteredProfiles() {
  const q = ($('search').value || '').trim().toLowerCase();
  if (!q) return state.profiles;
  return state.profiles.filter((p) =>
    [p.label, p.id, p.os, p.browser, p.browserVersion, p.timezone].filter(Boolean).join(' ').toLowerCase().includes(q));
}

function tzShort(tz) {
  if (!tz) return '';
  const parts = tz.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function renderList() {
  const list = filteredProfiles();
  const listEl = $('profile-list');
  listEl.innerHTML = '';
  if (!list.length) {
    listEl.appendChild(el('div', {
      class: 'empty',
      text: state.profiles.length === 0 ? (getSettings().url ? 'No profiles on the server, or server unreachable.' : 'Set the API server in Settings to load profiles.') : 'No match.',
    }));
    return;
  }
  const frag = document.createDocumentFragment();
  for (const p of list) {
    const card = el('div', { class: 'profile-card' });
    card.addEventListener('click', () => selectProfile(p.id));
    card.appendChild(el('div', { class: 'pc-top' },
      el('span', { class: 'pc-label', text: p.label || p.id }),
      el('span', { class: 'pc-tz', text: tzShort(p.timezone) })));
    card.appendChild(el('div', { class: 'pc-bottom' },
      el('span', { class: 'badge badge-os', text: p.os || '?' }),
      el('span', { class: 'badge badge-browser', text: (p.browser || '?') + (p.browserVersion ? ' ' + p.browserVersion : '') })));
    frag.appendChild(card);
  }
  listEl.appendChild(frag);
}

function renderListSkeleton() {
  const listEl = $('profile-list');
  listEl.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 5; i++) frag.appendChild(el('div', { class: 'skel-card' }));
  listEl.appendChild(frag);
}

/* ---------------- profile detail ---------------- */
async function selectProfile(id) {
  state.selectedId = id;
  showView('view-detail');
  $('detail-body').innerHTML = '';
  $('detail-body').appendChild(el('div', { class: 'empty', text: 'Loading…' }));
  try {
    const p = await api.getProfile(id);
    state.selected = p;
    renderDetail(p);
  } catch (e) {
    $('detail-body').innerHTML = '';
    $('detail-body').appendChild(el('div', { class: 'empty', text: 'Failed to load: ' + e.message }));
  }
}

function row(label, value, mono = false, copy = false) {
  const val = el('div', { class: 'row-value' + (mono ? ' mono' : ''), text: fmt(value) });
  if (copy && value) {
    const c = el('button', { class: 'icon-btn copy-btn', title: 'Copy' });
    c.appendChild(icon('copy'));
    c.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(value)); toast('Copied'); } catch { toast('Copy failed', 'err'); }
    });
    val.appendChild(c);
  }
  return el('div', { class: 'row' }, el('div', { class: 'row-label', text: label }), val);
}

function kvSection(title, rows) {
  return el('section', { class: 'section' },
    el('h3', { class: 'section-title', text: title }),
    el('div', { class: 'grid' }, ...rows));
}

function chipSection(title, items) {
  const chips = el('div', { class: 'chip-list' });
  for (const it of items || []) chips.appendChild(el('span', { class: 'chip', text: String(it) }));
  return el('section', { class: 'section' }, el('h3', { class: 'section-title', text: title }), chips);
}

function countKind(devs, k) { return (devs || []).filter((d) => d.kind === k).length; }

function renderDetail(p) {
  const body = $('detail-body');
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'detail-header' },
    el('h2', { text: p.label || p.id }),
    el('div', { class: 'mono', text: p.id })));
  body.appendChild(kvSection('Identity', [
    row('OS', (p.os || '?') + (p.osVersion ? ' ' + p.osVersion : '')),
    row('Browser', (p.browser || '?') + (p.browserVersion ? ' ' + p.browserVersion : '')),
    row('User-Agent', p.userAgent, true, true),
    row('Platform', p.platform),
    row('Languages', (p.languages || []).join(', ')),
    row('Timezone', p.timezone && p.timezone.id),
  ]));
  body.appendChild(kvSection('Hardware', [
    row('CPU cores', p.hardware && p.hardware.hardwareConcurrency),
    row('Memory', p.hardware && p.hardware.deviceMemory != null ? p.hardware.deviceMemory + ' GB' : ''),
    row('GPU vendor', p.gpu && p.gpu.unmaskedVendor, false, true),
    row('GPU renderer', p.gpu && p.gpu.unmaskedRenderer, true, true),
    row('Screen', p.screen ? p.screen.width + '×' + p.screen.height + ' @ ' + (p.window ? p.window.devicePixelRatio : '?') + 'x' : ''),
    row('Touch', p.navigator && p.navigator.maxTouchPoints),
  ]));
  const proxy = p.proxy ? (p.proxy.type + ' ' + p.proxy.host + ':' + p.proxy.port) : 'direct (no proxy)';
  body.appendChild(kvSection('Network & TLS', [
    row('Proxy', proxy, false, true),
    row('JA3', p.tls && p.tls.ja3, true, true),
    row('ClientHello', p.tls && p.tls.clientHelloId),
    row('WebRTC fake IP', p.webrtc && p.webrtc.fakeLocalIP, true, true),
    row('Performance res', p.math && (p.math.performanceNowResolutionMs + ' ms')),
  ]));
  body.appendChild(kvSection('Software surface', [
    row('webdriver', p.navigator && String(p.navigator.webdriver)),
    row('Plugins', (p.navigator && p.navigator.plugins ? p.navigator.plugins.length : 0)),
    row('Voices', (p.speechVoices || []).length + ' local'),
    row('Mics / cams / out', (countKind(p.mediaDevices, 'audioinput') + '/' + countKind(p.mediaDevices, 'videoinput') + '/' + countKind(p.mediaDevices, 'audiooutput'))),
  ]));
  if (p.fonts && (p.fonts.fonts || []).length) body.appendChild(chipSection('Fonts (' + p.fonts.fonts.length + ')', p.fonts.fonts.slice(0, 24)));
}

/* ---------------- actions ---------------- */
async function launchSelected() {
  const p = state.selected;
  if (!p) return;
  try {
    const res = await api.launchSession(p.id, { headless: true });
    toast('Session launched: ' + (res.sessionId || res.id || 'ok'), 'ok');
    showView('view-sessions');
  } catch (e) { toast('Launch failed: ' + e.message, 'err'); }
}

async function deleteSelected() {
  const p = state.selected;
  if (!p) return;
  if (!confirm('Delete "' + (p.label || p.id) + '"?')) return;
  try {
    await api.deleteProfile(p.id);
    toast('Profile deleted', 'ok');
    state.selected = null; state.selectedId = null;
    showView('view-profiles');
    await refreshProfiles(true);
  } catch (e) { toast('Delete failed: ' + e.message, 'err'); }
}

async function duplicateSelected() {
  const p = state.selected;
  if (!p) return;
  try {
    const copy = JSON.parse(JSON.stringify(p));
    delete copy.id; delete copy.createdAt; delete copy.updatedAt;
    copy.label = (p.label || p.id) + ' (copy)';
    const res = await api.createProfile(copy);
    toast('Duplicated: ' + res.id, 'ok');
    await refreshProfiles(true);
    selectProfile(res.id);
  } catch (e) { toast('Duplicate failed: ' + e.message, 'err'); }
}

/* ---------------- fingerprint ---------------- */
function openFingerprint() {
  const p = state.selected;
  if (!p) return;
  $('fp-body').innerHTML = '';
  $('fp-body').appendChild(fpLoading(p));
  $('fp-sheet').classList.remove('hidden');
  $('fp-scrim').classList.remove('hidden');
  const t0 = Date.now();
  clearInterval(state.fpTimer);
  state.fpTimer = setInterval(() => {
    const n = $('fp-elapsed');
    if (n) n.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  }, 250);
  api.fingerprint(p.id)
    .then((rb) => {
      clearInterval(state.fpTimer);
      renderReadback(p, rb, ((Date.now() - t0) / 1000).toFixed(2));
    })
    .catch((e) => {
      clearInterval(state.fpTimer);
      $('fp-body').innerHTML = '';
      $('fp-body').appendChild(el('div', { class: 'empty', text: 'Fingerprint read failed: ' + e.message }));
    });
}

function fpLoading(p) {
  const w = el('div', { class: 'fp-loading' });
  w.appendChild(el('div', { class: 'fp-spinner' }));
  w.appendChild(el('p', { text: 'Reading live fingerprint for "' + (p.label || p.id) + '"…' }));
  w.appendChild(el('div', { id: 'fp-elapsed', class: 'fp-meta mono', text: '0.0s' }));
  return w;
}

function renderReadback(p, rb, secs) {
  const body = $('fp-body');
  body.innerHTML = '';
  const checks = [
    ['User-Agent', p.userAgent, rb.userAgent],
    ['Platform', p.platform, rb.platform],
    ['Languages', (p.languages || []).join(','), (rb.languages || []).join(',')],
    ['Timezone', p.timezone && p.timezone.id, rb.timezone],
    ['Hardware concurrency', p.hardware && p.hardware.hardwareConcurrency, rb.hardwareConcurrency],
    ['Device memory', p.hardware && p.hardware.deviceMemory, rb.deviceMemory],
    ['WebGL vendor', p.gpu && p.gpu.unmaskedVendor, rb.webglVendor],
    ['WebGL renderer', p.gpu && p.gpu.unmaskedRenderer, rb.webglRenderer],
    ['WebRTC local IP', p.webrtc && p.webrtc.fakeLocalIP, rb.webrtcLocalIP],
  ];
  let passed = 0;
  for (const c of checks) if (String(c[1]) === String(c[2])) passed++;
  const total = checks.length;
  const allOk = passed === total;

  const summary = el('div', { class: 'fp-summary ' + (allOk ? 'fp-ok' : 'fp-bad') });
  const ic = el('div', { class: 'fp-summary-icon' });
  ic.innerHTML = allOk
    ? '<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M10.5 17.5l4.5 4.5 8.5-9.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="15.5" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M11 11l12 12m0-12L11 23" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  summary.appendChild(ic);
  summary.appendChild(el('div', {},
    el('div', { class: 'fp-summary-title', text: allOk ? 'Fingerprint verified' : 'Fingerprint mismatch' }),
    el('div', { class: 'fp-summary-sub', text: passed + ' / ' + total + ' checks passed · ' + secs + 's' })));
  body.appendChild(summary);

  const grid = el('div', { class: 'fp-grid' });
  for (const [label, expected, actual] of checks) {
    const ok = String(expected) === String(actual);
    const r = el('div', { class: 'fp-row ' + (ok ? 'match' : 'mismatch') });
    r.appendChild(el('div', { class: 'fp-row-icon', text: ok ? '✓' : '✗' }));
    r.appendChild(el('div', { class: 'fp-row-body' },
      el('div', { class: 'fp-row-label', text: label }),
      el('div', { class: 'fp-val' }, el('span', { class: 'fp-val-k', text: 'expected' }), el('span', { class: 'mono', text: fmt(expected) })),
      el('div', { class: 'fp-val' }, el('span', { class: 'fp-val-k', text: 'actual' }), el('span', { class: 'mono', text: fmt(actual) }))));
    grid.appendChild(r);
  }
  body.appendChild(grid);

  const info = el('div', { class: 'fp-info' }, el('h3', { class: 'section-title', text: 'Measured hashes' }));
  info.appendChild(el('div', { class: 'fp-info-row' }, el('span', { class: 'fp-row-label', text: 'Canvas' }), el('span', { class: 'mono', text: fmt(rb.canvasHash) })));
  info.appendChild(el('div', { class: 'fp-info-row' }, el('span', { class: 'fp-row-label', text: 'Audio' }), el('span', { class: 'mono', text: fmt(rb.audioHash) })));
  body.appendChild(info);
}

/* ---------------- sessions ---------------- */
async function refreshSessions() {
  const listEl = $('session-list');
  try {
    const res = await api.listSessions();
    state.sessions = res.sessions || [];
  } catch (e) {
    state.sessions = [];
    toast(e.message, 'err');
  }
  renderSessions();
}

function renderSessions() {
  const listEl = $('session-list');
  listEl.innerHTML = '';
  $('sessions-empty').classList.toggle('hidden', state.sessions.length > 0);
  for (const s of state.sessions) {
    const card = el('div', { class: 'session-card' });
    card.appendChild(el('div', { class: 'session-top' },
      el('span', { class: 'session-label', text: s.label || s.profileId }),
      el('span', { class: 'badge badge-browser', text: s.browser || '?' })));
    card.appendChild(el('div', { class: 'session-id mono', text: s.id }));
    const actions = el('div', { class: 'session-actions' });
    const bfp = el('button', { class: 'btn btn-accent', text: 'Verify FP' });
    bfp.addEventListener('click', async () => {
      try {
        const rb = await api.sessionFingerprint(s.id);
        const prof = await api.getProfile(s.profileId);
        state.selected = prof;
        openSheetWith(prof, rb);
      } catch (e) { toast(e.message, 'err'); }
    });
    const bclose = el('button', { class: 'btn btn-danger', text: 'Close' });
    bclose.addEventListener('click', async () => {
      try { await api.closeSession(s.id); toast('Session closed'); refreshSessions(); }
      catch (e) { toast(e.message, 'err'); }
    });
    actions.appendChild(bfp);
    actions.appendChild(bclose);
    card.appendChild(actions);
    listEl.appendChild(card);
  }
}

function openSheetWith(p, rb) {
  renderReadback(p, rb, 'n/a');
  $('fp-sheet').classList.remove('hidden');
  $('fp-scrim').classList.remove('hidden');
}

/* ---------------- settings ---------------- */
function syncSettingsForm() {
  $('set-url').value = state.settings.url || '';
  $('set-key').value = state.settings.apiKey || '';
  $('settings-status').textContent = '';
}
async function saveSettingsForm() {
  state.settings = { url: $('set-url').value.trim(), apiKey: $('set-key').value.trim() };
  saveSettings(state.settings);
  setConnPill('offline');
  $('settings-status').textContent = 'Saved. Testing connection…';
  $('settings-status').className = 'settings-status';
  const ok = await checkConnection(true);
  $('settings-status').textContent = ok ? 'Connected — profiles will load.' : 'Saved, but connection failed. Check URL + key.';
  $('settings-status').classList.add(ok ? 'ok' : 'err');
  if (ok) refreshProfiles();
}
async function testConnection() {
  $('settings-status').textContent = 'Testing…';
  $('settings-status').className = 'settings-status';
  const ok = await checkConnection();
  $('settings-status').textContent = ok ? 'Connection OK' : 'Failed: ' + (state.connected === 'err' ? 'see toast' : '');
  $('settings-status').classList.add(ok ? 'ok' : 'err');
}

/* ---------------- events ---------------- */
for (const b of document.querySelectorAll('.nav-btn')) {
  b.addEventListener('click', () => showView(b.dataset.view));
}
$('d-back').addEventListener('click', () => showView('view-profiles'));
$('d-launch-sess').addEventListener('click', launchSelected);
$('d-del').addEventListener('click', deleteSelected);
$('d-dup').addEventListener('click', duplicateSelected);
$('d-fp').addEventListener('click', openFingerprint);
$('fp-close').addEventListener('click', () => { $('fp-sheet').classList.add('hidden'); $('fp-scrim').classList.add('hidden'); });
$('fp-scrim').addEventListener('click', () => { $('fp-sheet').classList.add('hidden'); $('fp-scrim').classList.add('hidden'); });
$('btn-save-settings').addEventListener('click', saveSettingsForm);
$('btn-test').addEventListener('click', testConnection);
let searchTimer = null;
$('search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderList, 120); });

/* ---------------- init ---------------- */
(async function init() {
  syncSettingsForm();
  renderListSkeleton();
  const online = await checkConnection(true);
  if (online) await refreshProfiles(true);
  else renderList();
})();

async function refreshProfiles(silent) {
  try {
    state.profiles = await api.listProfiles();
    renderList();
  } catch (e) {
    state.profiles = [];
    renderList();
    if (!silent) toast(e.message, 'err');
  }
}
