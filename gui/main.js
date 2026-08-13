'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Project root resolved relative to this file — the GUI lives inside the repo at gui/.
const ROOT = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(ROOT, 'data', 'profiles');
const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');
const CLI_ENTRY = 'src/cli/index.ts';

// Canonical app identity — drives WM_CLASS + userData dir; must match the .desktop StartupWMClass.
app.setName('GhostFrame');

// ---- single instance: exact native app behavior ----
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

let mainWindow = null;

// ---------------- window-state persistence ----------------
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const raw = fs.readFileSync(STATE_FILE(), 'utf8');
    const s = JSON.parse(raw);
    if (typeof s.width === 'number' && typeof s.height === 'number') return s;
  } catch (e) { /* first run / corrupt state */ }
  return { width: 1220, height: 820 };
}

let saveStateTimer = null;
function saveWindowState(win) {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const wasMax = win.isMaximized();
    const bounds = wasMax ? win.getNormalBounds() : win.getBounds();
    try {
      fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
      fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...bounds, maximized: wasMax }));
    } catch (e) { /* non-fatal */ }
  }, 250);
}

// ---------------- window creation ----------------
function createWindow() {
  const state = loadWindowState();
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#0d0f13',
    title: 'GhostFrame',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    show: false, // avoid white flash: show once ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.removeMenu ? mainWindow.removeMenu() : mainWindow.setMenuBarVisibility(false);

  // ---- navigation hardening: never leave the local app ----
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => {
    if (!e.url.startsWith('file://')) e.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  // production sanity: tsx must exist for launch/fingerprint IPC
  if (!fs.existsSync(TSX)) {
    dialog.showErrorBox('GhostFrame', 'Missing tsx runtime. Run `npm install` in ' + ROOT);
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------------- app info ----------------
ipcMain.handle('app:info', () => ({
  version: '0.1.0',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  profilesDir: PROFILES_DIR,
}));

ipcMain.handle('shell:openProfilesDir', async () => {
  ensureProfilesDir();
  const err = await shell.openPath(PROFILES_DIR);
  if (err) throw new Error(err);
  return { ok: true };
});

// ---------------- profile IPC ----------------
function isValidId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function ensureProfilesDir() {
  if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

function listProfilesSync() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(PROFILES_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, f), 'utf8'));
      out.push({
        id: p.id, label: p.label, os: p.os, browser: p.browser,
        browserVersion: p.browserVersion, userAgent: p.userAgent,
        timezone: p.timezone ? p.timezone.id : undefined, createdAt: p.createdAt,
      });
    } catch (e) { /* skip corrupt file */ }
  }
  out.sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
  return out;
}

function parseReadback(text) {
  const t = (text || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const s = t.indexOf('{');
  const e2 = t.lastIndexOf('}');
  if (s !== -1 && e2 > s) {
    try { return JSON.parse(t.slice(s, e2 + 1)); } catch (e3) { /* fall through */ }
  }
  return null;
}

ipcMain.handle('profiles:list', async () => listProfilesSync());

ipcMain.handle('profiles:get', async (event, id) => {
  if (!isValidId(id)) throw new Error('invalid profile id');
  const file = path.join(PROFILES_DIR, id + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
});

ipcMain.handle('profiles:delete', async (event, id) => {
  if (!isValidId(id)) throw new Error('invalid profile id');
  const file = path.join(PROFILES_DIR, id + '.json');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  try { fs.rmSync(path.join(ROOT, 'profiles-state', id), { recursive: true, force: true }); } catch (e) { /* state cleanup best-effort */ }
  return { ok: true, id };
});

ipcMain.handle('profiles:create', async (event, data) => {
  let profile = data;
  if (typeof data === 'string') profile = JSON.parse(data);
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('invalid profile payload');
  if (!profile.id) profile.id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  if (!isValidId(profile.id)) throw new Error('invalid profile id');
  ensureProfilesDir();
  const file = path.join(PROFILES_DIR, profile.id + '.json');
  if (fs.existsSync(file)) throw new Error('profile already exists: ' + profile.id);
  const now = new Date().toISOString();
  if (!profile.createdAt) profile.createdAt = now;
  profile.updatedAt = now;
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return { ok: true, id: profile.id };
});

ipcMain.handle('profiles:launch', async (event, id) => {
  if (!isValidId(id)) throw new Error('invalid profile id');
  const child = spawn(TSX, [CLI_ENTRY, 'launch', id], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env } });
  child.unref();
  return { ok: true, pid: child.pid };
});

ipcMain.handle('profiles:fingerprint', async (event, id) => {
  if (!isValidId(id)) throw new Error('invalid profile id');
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const send = (stage, message) => {
    const target = win && !win.isDestroyed() ? win : mainWindow;
    if (target && !target.isDestroyed()) target.webContents.send('fingerprint:progress', { id, stage, message });
  };
  send('start', 'Launching headless browser to read fingerprint…');
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI_ENTRY, 'fingerprint', id], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const killer = setTimeout(() => { if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch (e) {} reject(new Error('fingerprint timed out after 90s')); } }, 90000);
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; for (const line of s.split(/\r?\n/)) if (line.trim()) send('stdout', line); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; for (const line of s.split(/\r?\n/)) if (line.trim()) send('progress', line); });
    child.on('error', (err) => { if (!settled) { settled = true; clearTimeout(killer); reject(err); } });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (code !== 0) return reject(new Error('fingerprint exited with code ' + code + (stderr ? '\n' + stderr.slice(-1500) : '')));
      const parsed = parseReadback(stdout);
      if (!parsed) return reject(new Error('failed to parse FingerprintReadback JSON' + (stderr ? '\n' + stderr.slice(-1500) : '')));
      send('done', 'Fingerprint read.');
      resolve(parsed);
    });
  });
});

process.on('uncaughtException', (err) => {
  try { console.error('main uncaughtException:', err); } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  try { console.error('main unhandledRejection:', reason); } catch (e) {}
});
