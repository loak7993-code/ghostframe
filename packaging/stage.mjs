// Stages the app folder for electron-builder: copies gui/, dist bundles, browsers.json,
// browser binaries, and a minimal package.json with only runtime deps.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import fs from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const APP = join(here, 'app');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function ensured(p) { fs.mkdirSync(p, { recursive: true }); }
function cp(src, dest) { fs.cpSync(src, dest, { recursive: true }); }

console.log('[*] cleaning staging');
rmrf(APP);
ensured(APP);

// 1) gui sources
console.log('[*] copying gui/');
cp(join(ROOT, 'gui'), join(APP, 'gui'));

// 2) bundle + inject script
ensured(join(APP, 'dist'));
for (const f of ['launcher.cjs', 'inject.js']) {
  fs.copyFileSync(join(ROOT, 'dist', f), join(APP, 'dist', f));
}

// 3) playwright browsers.json schema (registry looks it up next to the bundle location)
fs.copyFileSync(join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), join(APP, 'browsers.json'));

// 4) bundled browser — matches playwright-core browsers.json revision.
// Playwright's own lookup expects <PLAYWRIGHT_BROWSERS_PATH>/chromium-1234/chrome-linux64/chrome.
import os from 'node:os';
function msPlaywrightDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || resolve(os.homedir(), 'AppData', 'Local');
    return resolve(la, 'ms-playwright');
  }
  return resolve(os.homedir(), '.cache', 'ms-playwright');
}
const browsersJson = JSON.parse(fs.readFileSync(join(ROOT, 'node_modules', 'playwright-core', 'browsers.json'), 'utf8'));
const chromiumRev = (browsersJson.browsers.find((b) => b.name === 'chromium') || {}).revision || '1234';
const srcBrowsers = resolve(msPlaywrightDir(), 'chromium-' + chromiumRev);
if (fs.existsSync(srcBrowsers)) {
  console.log('[*] copying bundled chromium-' + chromiumRev + ' (many MB, takes a minute)');
  cp(srcBrowsers, join(APP, 'browsers', 'chromium-' + chromiumRev));
} else {
  console.log('[!] chromium-' + chromiumRev + ' cache not found at ' + srcBrowsers + ' — run `npx playwright install chromium` first');
  process.exit(2);
}

// 5) minimal package.json inside the app
fs.writeFileSync(join(APP, 'package.json'), JSON.stringify({
  name: 'ghostframe',
  productName: 'GhostFrame',
  version: '0.1.0',
  description: 'GhostFrame — coherent-fingerprint browser platform',
  license: 'MIT',
  main: 'gui/main.js',
  dependencies: {},
  devDependencies: {},
}, null, 2));

console.log('[+] staged → ' + APP);
console.log('    size: ' + du(APP) + 'MB');
function du(p) {
  let total = 0;
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const s = join(d, f); const st = fs.statSync(s); if (st.isDirectory()) walk(s); else total += st.size; } };
  walk(p); return Math.round(total / 1024 / 1024);
}
