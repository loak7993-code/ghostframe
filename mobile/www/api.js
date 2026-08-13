// GhostFrame mobile — REST API client (classic script; globals available in app.js).
'use strict';

const SETTINGS_KEY = 'gf_api_settings_v1';

function getSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch { return {}; }
}
function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ url: s.url || '', apiKey: s.apiKey || '' }));
}

function apiBaseUrl() {
  let u = (getSettings().url || '').trim();
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

async function apiRequest(method, path, body) {
  const s = getSettings();
  const b = apiBaseUrl();
  if (!b) throw new Error('No API server set. Open Settings.');
  const opt = {
    method,
    headers: { 'x-api-key': s.apiKey || '', 'accept': 'application/json' },
  };
  if (body !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), 45000);
  opt.signal = ctrl.signal;
  let res;
  try {
    res = await fetch(b + path, opt);
  } finally {
    clearTimeout(killer);
  }
  if (res.status === 401) throw new Error('Unauthorized — check the API key in Settings.');
  if (!res.ok) {
    let detail = res.status + ' ' + res.statusText;
    try { const j = await res.json(); if (j && j.error) detail = j.error + (j.detail ? ' — ' + j.detail : ''); } catch {}
    throw new Error(detail);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const api = {
  health: () => apiRequest('GET', '/health'),
  listProfiles: async () => (await apiRequest('GET', '/profiles')).profiles || [],
  getProfile: (id) => apiRequest('GET', '/profiles/' + encodeURIComponent(id)),
  deleteProfile: (id) => apiRequest('DELETE', '/profiles/' + encodeURIComponent(id)),
  createProfile: (data) => apiRequest('POST', '/profiles', data),
  fingerprint: (id) => apiRequest('GET', '/profiles/' + encodeURIComponent(id) + '/fingerprint'),
  launchSession: (profileId, opts) => apiRequest('POST', '/sessions', Object.assign({ headless: true }, opts, { profileId })),
  listSessions: () => apiRequest('GET', '/sessions'),
  sessionFingerprint: (sid) => apiRequest('GET', '/sessions/' + encodeURIComponent(sid) + '/fingerprint'),
  closeSession: (sid) => apiRequest('DELETE', '/sessions/' + encodeURIComponent(sid)),
};
