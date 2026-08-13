'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Project root resolved relative to this file — the GUI lives inside the repo at gui/.
const ROOT = path.resolve(__dirname, '..');
let PROFILES_DIR = path.join(ROOT, 'data', 'profiles');

// Packaged app: install dir is read-only (resources/app.asar). Everything writable
// relocates into OS user-data; bundled chromium + stock profiles ride along as resources.
function configurePackagedPaths() {
  if (!app.isPackaged) return;
  const resources = process.resourcesPath;
  const userData = app.getPath('userData');

  // bundled browsers (extraResources/browsers) — playwright honors this path
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(resources, 'browsers');

  // stock profiles → userData copy (first run)
  const profilesDest = path.join(userData, 'profiles');
  if (!fs.existsSync(profilesDest)) {
    try { fs.cpSync(path.join(resources, 'extra-profiles'), profilesDest, { recursive: true }); } catch {}
  }
  if (fs.existsSync(profilesDest)) process.env.GHOSTFRAME_PROFILES_DIR = profilesDest;

  // writable state → userData
  process.env.GHOSTFRAME_STATE_DIR = path.join(userData, 'profiles-state');
  process.env.GHOSTFRAME_DATA_ROOT = ROOT;
  process.env.GHOSTFRAME_PROJECT_ROOT = ROOT;
  PROFILES_DIR = process.env.GHOSTFRAME_PROFILES_DIR || PROFILES_DIR;
}
configurePackagedPaths();

// In-process launcher access: load the esbuild-bundled CommonJS launcher.
// Pre-built at packaging time (esbuild --bundle), so no TypeScript runtime is needed
// and it works cleanly from inside an asar archive.
let _launcher = null;
function loadLauncher() {
  if (!_launcher) {
    _launcher = require(path.join(ROOT, 'dist', 'launcher.cjs'));
  }
  return _launcher;
}

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
  const profileFile = path.join(PROFILES_DIR, id + '.json');
  if (!fs.existsSync(profileFile)) throw new Error('profile not found');
  const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  const launcher = loadLauncher();
  // Launch a *headed* browser — the user wants to interact with it from this machine.
  const { launchProfile } = launcher;
  const result = await launchProfile(profile, { headless: false, useGhostProxy: false });
  // Track open contexts for clean close; leave them running until the user closes them.
  return { ok: true, pid: process.pid };
});

ipcMain.handle('profiles:fingerprint', async (event, id) => {
  if (!isValidId(id)) throw new Error('invalid profile id');
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const send = (stage, message) => {
    const target = win && !win.isDestroyed() ? win : mainWindow;
    if (target && !target.isDestroyed()) target.webContents.send('fingerprint:progress', { id, stage, message });
  };
  const profileFile = path.join(PROFILES_DIR, id + '.json');
  if (!fs.existsSync(profileFile)) throw new Error('profile not found');
  const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  send('start', 'Launching headless browser to read fingerprint…');
  const launcher = loadLauncher();
  const { launchProfile, readFingerprint, close } = launcher;
  const t0 = Date.now();
  let session = null;
  try {
    session = await launchProfile(profile, { headless: true, useGhostProxy: false });
    const rb = await readFingerprint(session.context, profile);
    send('done', 'Fingerprint read.');
    return rb;
  } catch (e) {
    throw new Error(String(e && e.message ? e.message : e));
  } finally {
    if (session) await close(session.context).catch(() => {});
  }
});

process.on('uncaughtException', (err) => {
  try { console.error('main uncaughtException:', err); } catch (e) {}
});
process.on('unhandledRejection', (reason) => {
  try { console.error('main unhandledRejection:', reason); } catch (e) {}
});
