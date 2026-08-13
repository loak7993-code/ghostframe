'use strict';

const api = window.ghostframe;
if (!api) {
  document.body.innerHTML = '<div class="error" style="margin:24px">GhostFrame preload failed — window.ghostframe is undefined.</div>';
  throw new Error('preload failed');
}

/* ---------------------------------------------------------------- state */
const state = {
  profiles: [],
  selectedId: null,
  profile: null,
  tab: 'overview',
  appInfo: null,
};
let fpUnsub = null;
let fpTimer = null;

const $ = (id) => document.getElementById(id);
const listEl = $('profile-list');
const searchEl = $('search');
const detailEl = $('detail');
const welcomeEl = $('welcome');

/* ---------------------------------------------------------------- dom helpers */
function el(tag, opts, ...kids) {
  const n = document.createElement(tag);
  if (opts) {
    if (opts.class) n.className = opts.class;
    if (opts.text != null) n.textContent = opts.text;
    if (opts.title) n.title = opts.title;
    if (opts.id) n.id = opts.id;
    if (opts.role) n.setAttribute('role', opts.role);
    if (opts.aria) n.setAttribute('aria-selected', opts.aria);
    if (opts.title) n.title = opts.title;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) n.setAttribute(k, v);
  }
  for (const k of kids) {
    if (k == null) continue;
    n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  }
  return n;
}
function frag() { return document.createDocumentFragment(); }
const esc = (s) => String(s);
const fmt = (v) => (v === undefined || v === null || v === '') ? '—' : String(v);

// tiny inline-svg helper — CSP allows inline svg in elements
function icon(name, cls) {
  const wrap = document.createElement('span');
  wrap.className = 'ibx' + (cls ? ' ' + cls : '');
  wrap.innerHTML = ICONS[name] || '';
  wrap.style.display = 'inline-flex';
  return wrap.firstElementChild
    ? (() => { const s = wrap.firstElementChild.cloneNode(true); return s; })()
    : wrap;
}
const ICONS = {
  check: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 11.2L3.4 8.6l.9-.9L6 9.4l5.7-5.7.9.9z" fill="currentColor"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>',
  info: '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 7.2v4M8 4.6v.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  copy: '<svg viewBox="0 0 16 16" width="12" height="12"><rect x="5" y="5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M11 5V4A1.5 1.5 0 009.5 2.5H4A1.5 1.5 0 002.5 4v5.5A1.5 1.5 0 004 11h1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
};

function osBadgeClass(os) { return 'badge badge-os'; }
function brBadgeClass(b) { return 'badge badge-browser'; }

/* ---------------------------------------------------------------- toasts */
function toast(msg, kind) {
  kind = kind || 'info';
  const t = el('div', { class: 'toast toast-' + kind });
  t.appendChild(icon(kind === 'ok' ? 'check' : kind === 'err' ? 'x' : 'info'));
  t.appendChild(el('span', { text: msg }));
  $('toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, kind === 'err' ? 6000 : 3200);
}

/* ---------------------------------------------------------------- confirm modal */
function confirmDialog({ title, message, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const ov = $('confirm-overlay');
    $('confirm-title').textContent = title;
    $('confirm-msg').textContent = message;
    const ok = $('confirm-ok');
    ok.textContent = confirmLabel || 'Delete';
    ok.className = danger === false ? 'btn btn-primary' : 'btn btn-danger';
    const cancel = $('confirm-cancel');
    function done(v) {
      ov.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      resolve(v);
    }
    function onOk() { done(true); }
    function onCancel() { done(false); }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    ov.addEventListener('click', function onBg(e) { if (e.target === ov) { ov.removeEventListener('click', onBg); done(false); } });
    ov.classList.remove('hidden');
  });
}

/* ---------------------------------------------------------------- list rendering */
function filteredProfiles() {
  const q = searchEl.value.trim().toLowerCase();
  if (!q) return state.profiles;
  return state.profiles.filter((p) =>
    [p.label, p.id, p.os, p.browser, p.browserVersion, p.timezone].filter(Boolean).join(' ').toLowerCase().includes(q));
}

function renderList() {
  const filtered = filteredProfiles();
  $('list-meta').textContent = state.profiles.length
    ? filtered.length + ' / ' + state.profiles.length + ' profiles' : '';
  listEl.innerHTML = '';
  if (filtered.length === 0) {
    const msg = state.profiles.length === 0
      ? 'No profiles yet.\nCreate one with the + button or Ctrl+N.'
      : 'No profiles match "' + searchEl.value + '".';
    listEl.appendChild(el('div', { class: 'empty', text: msg }));
    return;
  }
  const f = frag();
  for (const p of filtered) {
    const card = el('div', {
      class: 'profile-card' + (p.id === state.selectedId ? ' selected' : ''),
      role: 'option', aria: String(p.id === state.selectedId),
      attrs: { 'data-id': p.id, tabindex: '-1' },
    });
    card.addEventListener('click', () => selectProfile(p.id));
    card.addEventListener('dblclick', () => launchProfile(p.id));
    card.appendChild(el('div', { class: 'pc-top' },
      el('span', { class: 'pc-label', text: p.label || p.id }),
      el('span', { class: 'pc-tz', text: tzShort(p.timezone) })));
    card.appendChild(el('div', { class: 'pc-bottom' },
      el('span', { class: osBadgeClass(p.os), text: p.os || '?' }),
      el('span', { class: brBadgeClass(p.browser), text: (p.browser || '?') + (p.browserVersion ? ' ' + p.browserVersion : '') })));
    f.appendChild(card);
  }
  listEl.appendChild(f);
}

function tzShort(tz) {
  if (!tz) return '';
  const parts = tz.split('/');
  return parts[parts.length - 1].replace(/_/g, ' ');
}

function markSelected() {
  for (const node of listEl.querySelectorAll('.profile-card')) {
    const on = node.getAttribute('data-id') === state.selectedId;
    node.classList.toggle('selected', on);
    node.setAttribute('aria-selected', String(on));
  }
}

// move selection by keyboard
function moveSelection(delta) {
  const filtered = filteredProfiles();
  if (!filtered.length) return;
  const idx = filtered.findIndex((p) => p.id === state.selectedId);
  const next = idx === -1
    ? (delta > 0 ? 0 : filtered.length - 1)
    : Math.min(filtered.length - 1, Math.max(0, idx + delta));
  selectProfile(filtered[next].id, { scroll: true });
}

/* ---------------------------------------------------------------- status bar */
function renderStatusBar() {
  $('st-count').textContent = state.profiles.length + ' profiles';
  $('st-selected').textContent = state.selectedId || 'no selection';
  if (state.appInfo) {
    $('st-info').textContent =
      'Electron ' + state.appInfo.electron + ' · Chrome ' + state.appInfo.chrome + ' · Node ' + state.appInfo.node;
  }
}

/* ---------------------------------------------------------------- refresh */
async function refresh(opts) {
  opts = opts || {};
  listEl.innerHTML = '';
  const skel = frag();
  for (let i = 0; i < 6; i++) skel.appendChild(el('div', { class: 'skel-card' }));
  listEl.appendChild(skel);
  try {
    const before = Date.now();
    state.profiles = await api.listProfiles();
    if (!opts.silent && state.profiles.length > 0 && Date.now() - before > 300) { /* slow fs read, list will pop */ }
  } catch (e) {
    state.profiles = [];
    toast('Failed to load profiles: ' + e.message, 'err');
  }
  renderList();
  renderStatusBar();
}

/* ---------------------------------------------------------------- detail */
async function selectProfile(id, opts) {
  opts = opts || {};
  state.selectedId = id;
  markSelected();
  renderStatusBar();
  if (opts.scroll) {
    const node = listEl.querySelector('[data-id="' + CSS.escape(id) + '"]');
    if (node) node.scrollIntoView({ block: 'nearest' });
  }
  welcomeEl.classList.add('hidden');
  detailEl.classList.remove('hidden');

  // skeleton while loading
  $('d-title').textContent = '…';
  $('d-id').textContent = '';
  const pane = paneFor();
  pane.innerHTML = '';
  pane.appendChild(detailSkeleton());

  try {
    const p = await api.getProfile(id);
    if (!p) throw new Error('profile not found');
    state.profile = p;
    renderDetail(p);
  } catch (e) {
    pane.innerHTML = '';
    pane.appendChild(el('div', { class: 'error', text: 'Failed to load profile: ' + e.message }));
  }
}

function detailSkeleton() {
  const f = frag();
  const sec = el('section', { class: 'section' });
  for (let i = 0; i < 6; i++) {
    const line = el('div', { class: 'skel-line' });
    line.style.width = (40 + Math.round(Math.random() * 50)) + '%';
    sec.appendChild(line);
  }
  f.appendChild(sec);
  return f;
}

function paneFor(tab) {
  tab = tab || state.tab;
  return $('tab-' + tab);
}

function row(label, value, opts) {
  opts = opts || {};
  const val = el('div', { class: 'row-value' + (opts.mono ? ' mono' : ''), text: fmt(value) });
  const r = el('div', { class: 'row' }, el('div', { class: 'row-label', text: label }), val);
  if (opts.copy && value) {
    const c = el('button', { class: 'icon-btn copy-btn', title: 'Copy' });
    c.appendChild(icon('copy'));
    c.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(value)); toast('Copied ' + label); }
      catch (e) { toast('Copy failed', 'err'); }
    });
    val.appendChild(c);
  }
  return r;
}

function kvSection(title, rows) {
  const grid = el('div', { class: 'grid' });
  for (const r of rows) grid.appendChild(r);
  return el('section', { class: 'section' }, el('h3', { class: 'section-title', text: title }), grid);
}

function chipSection(title, items) {
  const chips = el('div', { class: 'chip-list' });
  for (const it of items || []) chips.appendChild(el('span', { class: 'chip', text: String(it) }));
  return el('section', { class: 'section' }, el('h3', { class: 'section-title', text: title }), chips);
}

function renderDetail(p) {
  $('d-title').textContent = p.label || p.id;
  $('d-id').textContent = p.id;
  renderStatusBar();
  renderTab('overview', p);
  renderTab('network', p);
  renderTab('fingerprint', p);
  renderTab('json', p);
  activateTab(state.tab);
}

function renderTab(tab, p) {
  const pane = paneFor(tab);
  pane.innerHTML = '';
  const f = frag();
  if (tab === 'overview') {
    f.appendChild(kvSection('Identity', [
      row('OS', (p.os || '?') + (p.osVersion ? ' ' + p.osVersion : '')),
      row('Browser', (p.browser || '?') + (p.browserVersion ? ' ' + p.browserVersion : '')),
      row('User-Agent', p.userAgent, { mono: true, copy: true }),
      row('Platform', p.platform),
      row('UA-CH Platform', p.userAgentData && p.userAgentData.platform),
      row('UA-CH Mobile', p.userAgentData && String(p.userAgentData.mobile)),
      row('Created', p.createdAt),
      row('Updated', p.updatedAt),
    ]));
    f.appendChild(kvSection('Hardware', [
      row('CPU cores', p.hardware && p.hardware.hardwareConcurrency),
      row('Device memory', p.hardware && p.hardware.deviceMemory != null ? p.hardware.deviceMemory + ' GB' : ''),
      row('GPU vendor', p.gpu && p.gpu.unmaskedVendor, { copy: true }),
      row('GPU renderer', p.gpu && p.gpu.unmaskedRenderer, { mono: true, copy: true }),
      row('Screen', p.screen ? p.screen.width + '×' + p.screen.height + ' @ ' + p.screen.colorDepth + '-bit' : ''),
      row('Device pixel ratio', p.window && p.window.devicePixelRatio),
      row('Touch points', p.navigator && p.navigator.maxTouchPoints),
    ]));
    f.appendChild(kvSection('Speech & Media', [
      row('Voices', (p.speechVoices || []).length + ' local'),
      row('Audio inputs', countKind(p.mediaDevices, 'audioinput')),
      row('Audio outputs', countKind(p.mediaDevices, 'audiooutput')),
      row('Video inputs', countKind(p.mediaDevices, 'videoinput')),
    ]));
  } else if (tab === 'network') {
    const proxy = p.proxy ? (p.proxy.type + ' ' + p.proxy.host + ':' + p.proxy.port) : 'direct (no proxy)';
    f.appendChild(kvSection('Locale & Region', [
      row('Timezone', p.timezone && p.timezone.id),
      row('UTC offset', p.timezone && p.timezone.offsetMinutes != null ? p.timezone.offsetMinutes + ' min' : ''),
      row('Locale', p.timezone && p.timezone.locale),
      row('Languages', (p.languages || []).join(', ')),
      row('Geolocation', p.geolocation ? p.geolocation.latitude + ', ' + p.geolocation.longitude : ''),
    ]));
    f.appendChild(kvSection('Connectivity', [
      row('Proxy', proxy, { copy: true }),
      row('Downlink', p.navigator && p.navigator.connection && p.navigator.connection.downlink + ' Mbps'),
      row('RTT', p.navigator && p.navigator.connection && p.navigator.connection.rtt + ' ms'),
      row('WebRTC policy', p.webrtc && p.webrtc.iceCandidatePolicy),
      row('Force relay', p.webrtc && String(p.webrtc.forceRelay)),
      row('Fake local IP', p.webrtc && p.webrtc.fakeLocalIP, { mono: true, copy: true }),
    ]));
    f.appendChild(kvSection('TLS Fingerprint', [
      row('ClientHello', p.tls && p.tls.clientHelloId),
      row('JA3', p.tls && p.tls.ja3, { mono: true, copy: true }),
      row('JA4', p.tls && p.tls.ja4, { mono: true, copy: true }),
      row('JA3 full string', p.tls && p.tls.ja3Full, { mono: true, copy: true }),
      row('ALPN', p.tls && (p.tls.alpn || []).join(', ')),
    ]));
    if (p.httpHeaders && (p.httpHeaders.order || []).length) {
      f.appendChild(chipSection('HTTP header order', p.httpHeaders.order));
    }
  } else if (tab === 'fingerprint') {
    f.appendChild(kvSection('Noise Seeds (stable per profile)', [
      row('Canvas seed', p.canvas && p.canvas.noiseSeed, { mono: true }),
      row('Canvas strength', p.canvas && p.canvas.noiseStrength),
      row('Audio seed', p.audio && p.audio.noiseSeed, { mono: true }),
      row('Audio sample rate', p.audio && (p.audio.sampleRate + ' Hz')),
      row('Audio strength', p.audio && p.audio.noiseStrength),
      row('perf.now resolution', p.math && (p.math.performanceNowResolutionMs + ' ms')),
    ]));
    f.appendChild(kvSection('Navigator Surface', [
      row('webdriver', p.navigator && String(p.navigator.webdriver)),
      row('vendor', p.navigator && p.navigator.vendor),
      row('cookieEnabled', p.navigator && String(p.navigator.cookieEnabled)),
      row('doNotTrack', p.navigator && String(p.navigator.doNotTrack)),
      row('pdfViewerEnabled', p.navigator && String(p.navigator.pdfViewerEnabled)),
      row('Plugins', (p.navigator && p.navigator.plugins ? p.navigator.plugins.length : 0)),
      row('MIME types', (p.navigator && p.navigator.mimeTypes ? p.navigator.mimeTypes.length : 0)),
    ]));
    if (p.fonts && (p.fonts.fonts || []).length) f.appendChild(chipSection('Fonts (' + p.fonts.fonts.length + ')', p.fonts.fonts));
    if ((p.speechVoices || []).length) f.appendChild(chipSection('Speech voices', (p.speechVoices || []).map((v) => v.name)));
    if ((p.permissions || []).length) f.appendChild(chipSection('Permissions', (p.permissions || []).map((x) => x.name + '=' + x.state)));
  } else if (tab === 'json') {
    const pre = el('pre', { class: 'json-pre', text: JSON.stringify(p, null, 2) });
    const wrap = el('div', { class: 'json-wrap' });
    const cp = el('button', { class: 'btn', title: 'Copy JSON', text: 'Copy JSON' });
    cp.style.position = 'absolute';
    cp.style.top = '10px';
    cp.style.right = '10px';
    cp.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(p, null, 2)); toast('JSON copied'); }
      catch (e) { toast('Copy failed', 'err'); }
    });
    wrap.appendChild(pre);
    wrap.appendChild(cp);
    f.appendChild(wrap);
  }
  pane.appendChild(f);
}

function countKind(devs, kind) {
  return (devs || []).filter((d) => d.kind === kind).length;
}

function activateTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('#tabbar .tab')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const pane of document.querySelectorAll('.tabpane')) pane.classList.add('hidden');
  const pane = paneFor(tab);
  if (pane) pane.classList.remove('hidden');
}

/* ---------------------------------------------------------------- actions */
async function launchProfile(id) {
  try {
    const res = await api.launchProfile(id);
    toast('Browser launched (pid ' + res.pid + ')', 'ok');
  } catch (e) {
    toast('Launch failed: ' + e.message, 'err');
  }
}

async function deleteSelected() {
  const p = state.profile;
  if (!p) return;
  const ok = await confirmDialog({
    title: 'Delete profile',
    message: 'Delete "' + (p.label || p.id) + '"? Its saved browser state is removed too. This cannot be undone.',
    confirmLabel: 'Delete permanently',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.deleteProfile(p.id);
    toast('Profile deleted', 'ok');
    state.selectedId = null;
    state.profile = null;
    detailEl.classList.add('hidden');
    welcomeEl.classList.remove('hidden');
    await refresh({ silent: true });
    renderStatusBar();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'err');
  }
}

async function duplicateSelected() {
  const p = state.profile;
  if (!p) return;
  try {
    const copy = JSON.parse(JSON.stringify(p));
    delete copy.id;
    copy.label = (p.label || p.id) + ' (copy)';
    const res = await api.createProfile(copy);
    toast('Duplicated as ' + res.id, 'ok');
    await refresh({ silent: true });
    selectProfile(res.id, { scroll: true });
  } catch (e) {
    toast('Duplicate failed: ' + e.message, 'err');
  }
}

async function openProfilesDir() {
  try { await api.openProfilesDir(); }
  catch (e) { toast('Could not open folder: ' + e.message, 'err'); }
}

/* ---------------------------------------------------------------- fingerprint modal */
function openFingerprint() {
  const p = state.profile;
  if (!p) return;
  const ov = $('fp-overlay');
  const body = $('fp-body');
  body.innerHTML = '';
  body.appendChild(fpLoading(p));

  const t0 = Date.now();
  const logEl = () => $('fp-progress-log');
  if (fpUnsub) fpUnsub();
  fpUnsub = api.onFingerprintProgress((m) => {
    const log = logEl();
    if (!log) return;
    const line = el('div', {
      class: 'fp-log-line' + ((m.stage === 'start' || m.stage === 'done') ? ' sys' : ''),
      text: (m.stage ? '[' + m.stage + '] ' : '') + (m.message || ''),
    });
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  });
  const metEl = () => $('fp-elapsed');
  clearInterval(fpTimer);
  fpTimer = setInterval(() => {
    const n = metEl();
    if (n) n.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's elapsed';
  }, 250);

  api.readFingerprint(p.id)
    .then((rb) => {
      const secs = ((Date.now() - t0) / 1000).toFixed(2);
      if (fpUnsub) { fpUnsub(); fpUnsub = null; }
      clearInterval(fpTimer);
      renderReadback(p, rb, secs);
    })
    .catch((e) => {
      if (fpUnsub) { fpUnsub(); fpUnsub = null; }
      clearInterval(fpTimer);
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'error', text: 'Fingerprint read failed: ' + e.message }));
    });
  ov.classList.remove('hidden');
}

function fpLoading(p) {
  const wrap = el('div', { class: 'fp-loading' });
  wrap.appendChild(el('div', { class: 'fp-spinner' }));
  wrap.appendChild(el('p', { text: 'Reading live fingerprint for "' + (p.label || p.id) + '"…' }));
  wrap.appendChild(el('div', { id: 'fp-elapsed', class: 'fp-meta mono', text: '0.0s elapsed' }));
  wrap.appendChild(el('div', { id: 'fp-progress-log', class: 'fp-log' }));
  return wrap;
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
  for (const c of checks) { if (String(c[1]) === String(c[2])) passed++; }
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
    const core = el('div', { class: 'fp-row-body' }, el('div', { class: 'fp-row-label', text: label }));
    const vals = el('div', { class: 'fp-row-vals' });
    vals.appendChild(el('div', { class: 'fp-val' }, el('span', { class: 'fp-val-k', text: 'expected' }), el('span', { class: 'mono', text: fmt(expected) })));
    vals.appendChild(el('div', { class: 'fp-val' }, el('span', { class: 'fp-val-k', text: 'actual' }), el('span', { class: 'mono', text: fmt(actual) })));
    core.appendChild(vals);
    r.appendChild(core);
    grid.appendChild(r);
  }
  body.appendChild(grid);

  const info = el('div', { class: 'fp-info' },
    el('h3', { class: 'section-title', text: 'Measured hashes (stable per profile)' }));
  info.appendChild(fpInfoRow('Canvas', rb.canvasHash));
  info.appendChild(fpInfoRow('Audio', rb.audioHash));
  body.appendChild(info);
}

function fpInfoRow(label, value) {
  return el('div', { class: 'fp-info-row' },
    el('span', { class: 'fp-row-label', text: label }),
    el('span', { class: 'mono', text: fmt(value) }));
}

/* ---------------------------------------------------------------- create modal */
function openCreate() {
  const tpl = $('new-template');
  tpl.innerHTML = '<option value="">— blank (paste JSON below) —</option>';
  for (const p of state.profiles) {
    tpl.appendChild(el('option', { text: (p.label || p.id), attrs: { value: p.id } }));
  }
  $('new-error').classList.add('hidden');
  $('new-json').value = '';
  tpl.value = '';
  $('new-overlay').classList.remove('hidden');
  setTimeout(() => $('new-json').focus(), 60);
}

async function fillTemplate() {
  const id = $('new-template').value;
  if (!id) { $('new-json').value = ''; return; }
  try {
    const p = await api.getProfile(id);
    const copy = JSON.parse(JSON.stringify(p));
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    copy.label = (p.label || id) + ' (new)';
    $('new-json').value = JSON.stringify(copy, null, 2);
  } catch (e) {
    showNewError('Template load failed: ' + e.message);
  }
}

function showNewError(msg) {
  const n = $('new-error');
  n.textContent = msg;
  n.classList.remove('hidden');
}

async function createFromModal() {
  $('new-error').classList.add('hidden');
  const text = $('new-json').value.trim();
  if (!text) { showNewError('Paste DeviceProfile JSON first (or pick a template).'); return; }
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { showNewError('Invalid JSON: ' + e.message); return; }
  try {
    const res = await api.createProfile(obj);
    $('new-overlay').classList.add('hidden');
    toast('Profile created: ' + res.id, 'ok');
    await refresh({ silent: true });
    selectProfile(res.id, { scroll: true });
  } catch (e) {
    showNewError(e.message);
  }
}

/* ---------------------------------------------------------------- keyboard + wiring */
function isInputActive() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  const key = e.key;
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'n') { e.preventDefault(); openCreate(); return; }
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'l') { e.preventDefault(); if (state.profile) launchProfile(state.profile.id); return; }
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'e') { e.preventDefault(); openFingerprint(); return; }
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'r') { e.preventDefault(); refresh(); toast('Profiles reloaded'); return; }

  if (key === '/' && !isInputActive()) { e.preventDefault(); searchEl.focus(); return; }
  if (key === 'ArrowDown' && !isInputActive()) { e.preventDefault(); moveSelection(1); return; }
  if (key === 'ArrowUp' && !isInputActive()) { e.preventDefault(); moveSelection(-1); return; }
  if (key === 'Delete' && !isInputActive() && state.profile) { deleteSelected(); return; }
  if (key === 'Escape') {
    for (const id of ['fp-overlay', 'new-overlay', 'confirm-overlay']) $(id).classList.add('hidden');
    if (document.activeElement === searchEl) { searchEl.value = ''; renderList(); searchEl.blur(); }
  }
});

// simple debounce for search performance
let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 110);
});

// tab bar
$('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (b) activateTab(b.dataset.tab);
});

// detail action buttons
$('d-launch').addEventListener('click', () => state.profile && launchProfile(state.profile.id));
$('d-fp').addEventListener('click', () => state.profile && openFingerprint());
$('d-dup').addEventListener('click', duplicateSelected);
$('d-del').addEventListener('click', deleteSelected);
$('d-folder').addEventListener('click', openProfilesDir);

// toolbar
$('btn-new').addEventListener('click', openCreate);
$('btn-refresh').addEventListener('click', () => { refresh(); });

// modals
$('fp-close').addEventListener('click', () => $('fp-overlay').classList.add('hidden'));
$('new-close').addEventListener('click', () => $('new-overlay').classList.add('hidden'));
$('new-create').addEventListener('click', createFromModal);
$('new-template').addEventListener('change', fillTemplate);
for (const id of ['fp-overlay', 'new-overlay']) {
  $(id).addEventListener('click', (e) => { if (e.target === $(id)) $(id).classList.add('hidden'); });
}

// global error surface — production safety net
window.addEventListener('unhandledrejection', (ev) => {
  toast('Unexpected error: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason), 'err');
  console.error('unhandledrejection:', ev.reason);
});

/* ---------------------------------------------------------------- init */
(async function init() {
  try { state.appInfo = await api.getAppInfo(); $('brand-version').textContent = 'v' + state.appInfo.version; }
  catch (e) { /* non-fatal */ }
  renderStatusBar();
  await refresh();
})();

// expose for debugging in DevTools
window.__ghostframeState = state;
