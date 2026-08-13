import { launchProfile, close } from '../src/browser/launcher.js';
import { ProfileManager } from '../src/profile/manager.js';
const pm = new ProfileManager();
const id = process.argv[2] || 'android13-chrome-151-mobile';
const p = await pm.getProfile(id);
if (!p) { console.error('profile not found'); process.exit(1); }
const { context } = await launchProfile(p, { headless: true, useGhostProxy: false });
const page = context.pages()[0] ?? await context.newPage();
console.log('[*] navigating to https://ipfighter.com/browser-fingerprint …');
await page.goto('https://ipfighter.com/browser-fingerprint', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('[*] waiting for fingerprint analysis…');
await page.waitForTimeout(12000);
const text = await page.evaluate(`(document.body && document.body.innerText) ? document.body.innerText.slice(0, 6000) : 'no-body'`);
console.log('======= PAGE REPORT (truncated) =======');
console.log(text);
console.log('======= END =======');
await close(context);
