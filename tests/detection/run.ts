// GhostFrame Stage 6 — Detection Test Suite.
// Launches a profile headless and runs lie-detection + coherence + stability checks in the page,
// mirroring what creepjs / fingerprintjs / browserleaks look for.
// Exit 0 only if every CRITICAL check passes. Run: npx tsx tests/detection/run.ts [profileId]

import { launchProfile, close } from '../../src/browser/launcher.js';
import { ProfileManager } from '../../src/profile/manager.js';

interface Check {
  name: string;
  critical: boolean;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
  note?: string;
}

const DETECTION_PAGE_SCRIPT = `
(async () => {
  const out = {};
  const g = globalThis;

  // --- chrome.runtime surface (bot tell when missing) ---
  out.chromeRuntimePresent = (typeof chrome === 'object' && chrome !== null && typeof chrome.runtime === 'object' && chrome.runtime !== null);
  out.chromeRuntimeIdType = (typeof chrome === 'object' && chrome && chrome.runtime) ? typeof chrome.runtime.id : 'no-chrome';
  out.chromePlatform = (() => { try { const p = chrome.runtime.platformInfo; return p ? (p.os + '/' + p.arch) : 'none'; } catch { return 'err'; } })();

  // --- override signature check: spoofed fns must look native to .name/.length/.prototype probes ---
  out.sig = {
    toDataURL: { name: HTMLCanvasElement.prototype.toDataURL.name, len: HTMLCanvasElement.prototype.toDataURL.length, proto: typeof HTMLCanvasElement.prototype.toDataURL.prototype },
    getImageData: { name: CanvasRenderingContext2D.prototype.getImageData.name, len: CanvasRenderingContext2D.prototype.getImageData.length, proto: typeof CanvasRenderingContext2D.prototype.getImageData.prototype },
    getParameter: (typeof WebGLRenderingContext !== 'undefined') ? (() => { const f = WebGLRenderingContext.prototype.getParameter; return { name: f.name, len: f.length, proto: typeof f.prototype }; })() : null,
    getTimezoneOffset: { name: Date.prototype.getTimezoneOffset.name, len: Date.prototype.getTimezoneOffset.length, proto: typeof Date.prototype.getTimezoneOffset.prototype },
  };

  // --- identity ---
  out.userAgent = navigator.userAgent;
  out.platform = navigator.platform;
  out.language = navigator.language;
  out.languages = Array.from(navigator.languages || []);
  out.hardwareConcurrency = navigator.hardwareConcurrency;
  out.deviceMemory = navigator.deviceMemory;
  out.webdriver = navigator.webdriver;
  out.vendor = navigator.vendor;
  out.maxTouchPoints = navigator.maxTouchPoints;
  out.timezone = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
  out.timezoneOffset = new Date().getTimezoneOffset();
  out.screenW = screen.width; out.screenH = screen.height;
  out.colorDepth = screen.colorDepth; out.pixelDepth = screen.pixelDepth;
  out.dpr = window.devicePixelRatio;

  // --- userAgentData brands ---
  try { out.uaDataBrands = (navigator.userAgentData && navigator.userAgentData.brands) ? navigator.userAgentData.brands.map(b => b.brand) : null; }
  catch { out.uaDataBrands = null; }
  out.uaDataPlatform = navigator.userAgentData ? navigator.userAgentData.platform : null;
  out.uaDataMobile = navigator.userAgentData ? navigator.userAgentData.mobile : null;

  // --- override-leak: toString native-ness (creepjs "lies" check) ---
  function tn(fn) { try { return String(fn); } catch (e) { return 'ERR:' + e; } }
  out.strToDataURL = tn(HTMLCanvasElement.prototype.toDataURL);
  out.strGetImageData = tn(CanvasRenderingContext2D && CanvasRenderingContext2D.prototype.getImageData);
  out.strGetParameter = (typeof WebGLRenderingContext !== 'undefined') ? tn(WebGLRenderingContext.prototype.getParameter) : 'no-webgl';
  out.strGetTimezoneOffset = tn(Date.prototype.getTimezoneOffset);
  out.strCreateBattery = tn(navigator.getBattery || function(){});
  out.toDataUrlNative = out.strToDataURL.indexOf('[native code]') !== -1;
  out.getImageDataNative = out.strGetImageData.indexOf('[native code]') !== -1;
  out.getParameterNative = String(out.strGetParameter).indexOf('[native code]') !== -1;
  out.tzoNative = out.strGetTimezoneOffset.indexOf('[native code]') !== -1;

  // --- descriptor coherence for a spoofed getter ---
  try {
    const d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'userAgent');
    out.uaDescConfigurable = d ? !!d.configurable : null;
  } catch { out.uaDescConfigurable = null; }

  // --- canvas stability: two identical renders must hash identically ---
  function renderCanvas() {
    const c = document.createElement('canvas'); c.width = 280; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60'; ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069'; ctx.fillText('GhostFrame fingerprint test', 2, 15);
    ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('GhostFrame fingerprint test', 4, 17);
    return c.toDataURL();
  }
  let a = '', b = '';
  try { a = renderCanvas(); } catch (e) { a = 'ERR:' + e; }
  try { b = renderCanvas(); } catch (e) { b = 'ERR:' + e; }
  out.canvasStable = (a === b) && a.length > 0 && a.indexOf('ERR') !== 0;

  // --- WebGL ---
  out.webglVendor = ''; out.webglRenderer = '';
  try {
    const glc = document.createElement('canvas');
    const gl = glc.getContext('webgl') || glc.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        out.webglVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL));
        out.webglRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
      } else {
        out.webglVendor = String(gl.getParameter(gl.VENDOR));
        out.webglRenderer = String(gl.getParameter(gl.RENDERER));
      }
    } else { out.webglVendor = 'no-webgl'; out.webglRenderer = 'no-webgl'; }
  } catch (e) { out.webglVendor = 'ERR'; out.webglRenderer = String(e); }

  // --- audio sampleRate + OfflineAudioContext existence ---
  out.sampleRate = null;
  try { const ac = new (window.AudioContext || window.webkitAudioContext)(); out.sampleRate = ac.sampleRate; try { ac.close(); } catch {} } catch { out.sampleRate = null; }

  // --- performance.now resolution exists ---
  out.perfNowOk = (typeof performance !== 'undefined' && typeof performance.now === 'function');

  // --- plugins / mimeTypes shape ---
  out.pluginsLength = (navigator.plugins && typeof navigator.plugins.length === 'number') ? navigator.plugins.length : 0;
  out.mimeTypesLength = (navigator.mimeTypes && typeof navigator.mimeTypes.length === 'number') ? navigator.mimeTypes.length : 0;

  // --- permissions ---
  out.permNotifications = null; out.permGeolocation = null;
  try {
    const p1 = await navigator.permissions.query({ name: 'notifications' });
    out.permNotifications = p1.state;
    const p2 = await navigator.permissions.query({ name: 'geolocation' });
    out.permGeolocation = p2.state;
  } catch (e) { out.permNotifications = 'ERR:' + e; }

  // --- WebRTC ICE: capture raw candidate strings for host-analysis in Node ---
  out.webrtcCandidates = [];
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('gfdet');
    await new Promise((res) => {
      let done = false;
      const finish = () => { if (!done) { done = true; res(null); } };
      const timer = setTimeout(finish, 2500);
      pc.onicecandidate = (ev) => {
        if (ev.candidate == null) { clearTimeout(timer); finish(); return; }
        if (ev.candidate.candidate) out.webrtcCandidates.push(String(ev.candidate.candidate));
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => { clearTimeout(timer); finish(); });
    });
    try { pc.close(); } catch {}
  } catch (e) { out.webrtcCandidates = ['ERR:' + e]; }

  return out;
})();
`;

async function main() {
  const profileId = process.argv[2] || 'win11-chrome-151';
  const pm = new ProfileManager();
  const profile = await pm.getProfile(profileId);
  if (!profile) {
    console.error(`Profile "${profileId}" not found.`);
    process.exit(2);
  }

  console.log(`\n=== GhostFrame Detection Suite: ${profile.id} ===`);
  console.log(`label: ${profile.label}\n`);

  const { context } = await launchProfile(profile, { headless: true, useGhostProxy: false });
  const page = context.pages()[0] ?? (await context.newPage());

  let pageData: Record<string, unknown>;
  try {
    await page.goto('about:blank');
    pageData = (await page.evaluate(DETECTION_PAGE_SCRIPT)) as Record<string, unknown>;
  } finally {
    await close(context).catch(() => {});
  }

  const checks: Check[] = [];
  const str = (v: unknown) => String(v);

  function expect(name: string, pass: boolean, critical: boolean, expected?: unknown, actual?: unknown, note?: string) {
    checks.push({ name, pass, critical, expected, actual, note });
  }

  // masks/tells
  if (profile.browser === 'chrome' || profile.browser === 'edge') {
    expect('chrome.runtime exposed (chromium profile)', pageData.chromeRuntimePresent === true, true, true, pageData.chromeRuntimePresent);
    expect('chrome.runtime.id is undefined (plain page)', pageData.chromeRuntimeIdType === 'undefined', false, 'undefined', pageData.chromeRuntimeIdType);
  } else {
    expect('chrome.runtime NOT exposed (non-chromium profile)', pageData.chromeRuntimePresent !== true, false, false, pageData.chromeRuntimePresent);
  }
  const sig = pageData.sig as Record<string, { name: string; len: number; proto: string } | null>;
  expect('toDataURL signature native', sig && sig.toDataURL && sig.toDataURL.name === 'toDataURL' && sig.toDataURL.len === 0 && sig.toDataURL.proto === 'undefined', true,
    'name toDataURL len 0 proto undefined', sig ? sig.toDataURL : null);
  expect('getImageData signature native', sig && sig.getImageData && sig.getImageData.name === 'getImageData' && sig.getImageData.len === 4 && sig.getImageData.proto === 'undefined', true,
    'name getImageData len 4 proto undefined', sig ? sig.getImageData : null);
  expect('getTimezoneOffset signature native', sig && sig.getTimezoneOffset && sig.getTimezoneOffset.name === 'getTimezoneOffset' && sig.getTimezoneOffset.proto === 'undefined', true,
    'name getTimezoneOffset proto undefined', sig ? sig.getTimezoneOffset : null);

  // critical: webdriver false
  expect('navigator.webdriver === false', pageData.webdriver === false, true, false, pageData.webdriver);
  // UA match
  expect('UA matches profile', pageData.userAgent === profile.userAgent, true, profile.userAgent, pageData.userAgent);
  // platform match
  expect('navigator.platform matches', pageData.platform === profile.platform, true, profile.platform, pageData.platform);
  // languages
  expect('languages[0] matches', str((pageData.languages as string[])?.[0]) === profile.languages[0], true, profile.languages[0], (pageData.languages as string[])?.[0]);
  // hardware
  expect('hardwareConcurrency matches', pageData.hardwareConcurrency === profile.hardware.hardwareConcurrency, true, profile.hardware.hardwareConcurrency, pageData.hardwareConcurrency);
  expect('deviceMemory matches', pageData.deviceMemory === profile.hardware.deviceMemory, true, profile.hardware.deviceMemory, pageData.deviceMemory);
  // timezone
  expect('timezone matches', pageData.timezone === profile.timezone.id, true, profile.timezone.id, pageData.timezone);
  expect('timezoneOffset matches', (pageData.timezoneOffset as number) === profile.timezone.offsetMinutes, false, profile.timezone.offsetMinutes, pageData.timezoneOffset);
  // screen
  expect('screen.dimensions match', pageData.screenW === profile.screen.width && pageData.screenH === profile.screen.height, false, [profile.screen.width, profile.screen.height], [pageData.screenW, pageData.screenH]);
  expect('devicePixelRatio matches', pageData.dpr === profile.window.devicePixelRatio, false, profile.window.devicePixelRatio, pageData.dpr);
  // userAgentData
  const brandName = { chrome: 'Google Chrome', firefox: 'Firefox', safari: 'Safari', edge: 'Microsoft Edge' }[profile.browser];
  expect('userAgentData.brands contains browser', Array.isArray(pageData.uaDataBrands) && (pageData.uaDataBrands as string[]).includes(brandName), true, brandName, pageData.uaDataBrands);
  expect('userAgentData.mobile matches', pageData.uaDataMobile === profile.userAgentData.mobile, true, profile.userAgentData.mobile, pageData.uaDataMobile);
  // toString native (lies)
  expect('toDataURL looks native', pageData.toDataUrlNative === true, true, 'has [native code]', pageData.strToDataURL);
  expect('getImageData looks native', pageData.getImageDataNative === true, true, 'has [native code]', pageData.strGetImageData);
  expect('getParameter looks native', pageData.getParameterNative === true, true, 'has [native code]', pageData.strGetParameter);
  expect('getTimezoneOffset looks native', pageData.tzoNative === true, true, 'has [native code]', pageData.strGetTimezoneOffset);
  expect('UA getter descriptor configurable', pageData.uaDescConfigurable !== false, false, 'configurable', pageData.uaDescConfigurable);
  // canvas stability (critical — detectors flag per-call variance)
  expect('canvas stable across 2 renders', pageData.canvasStable === true, true, 'identical', pageData.canvasStable);
  // WebGL
  expect('WebGL vendor matches', pageData.webglVendor === profile.gpu.unmaskedVendor, true, profile.gpu.unmaskedVendor, pageData.webglVendor);
  expect('WebGL renderer matches', pageData.webglRenderer === profile.gpu.unmaskedRenderer, true, profile.gpu.unmaskedRenderer, pageData.webglRenderer);
  // audio
  expect('AudioContext sampleRate matches', pageData.sampleRate === profile.audio.sampleRate, false, profile.audio.sampleRate, pageData.sampleRate);
  // performance
  expect('performance.now available', pageData.perfNowOk === true, false, true, pageData.perfNowOk);
  // vendor coherence
  const expectedVendor = profile.browser === 'safari' ? 'Apple Computer, Inc.' : (profile.browser === 'firefox' ? '' : 'Google Inc.');
  if (profile.browser !== 'firefox') expect('navigator.vendor coherent', pageData.vendor === expectedVendor, false, expectedVendor, pageData.vendor);
  // WebRTC: parse candidates, flag any REAL private IPv4 host leak (must equal the fake)
  const candidates = (pageData.webrtcCandidates as string[]) || [];
  const ipToken = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const hostIPs = candidates
    .filter((c) => / typ host /.test(c))
    .map((c) => c.trim().split(/\s+/).find((tok) => ipToken.test(tok)) || '')
    .filter((ip) => ipToken.test(ip));
  const realIPLeak = hostIPs.some((ip) => ip && ip !== profile.webrtc.fakeLocalIP);
  expect('no real WebRTC host IP leak', realIPLeak === false, true, profile.webrtc.fakeLocalIP, hostIPs);
  // plugins coherence with device class (mobile Chrome has zero)
  const isMobileOs = profile.os === 'android' || profile.os === 'ios';
  const expectedPlugins = isMobileOs ? 0 : (profile.navigator.plugins || []).length;
  expect('plugins count coherent', pageData.pluginsLength === expectedPlugins, true, expectedPlugins, pageData.pluginsLength);

  // OS/UA coherence
  const osUaToken = { windows: 'Windows NT', macos: 'Mac OS X', linux: 'Linux', android: 'Android', ios: 'iPhone' }[profile.os];
  expect('UA contains OS token', str(pageData.userAgent).includes(osUaToken), true, osUaToken, pageData.userAgent);

  // report
  let critFail = 0;
  let warnFail = 0;
  console.log('--- CHECKS ---');
  for (const c of checks) {
    const tag = c.pass ? 'PASS' : 'FAIL';
    const crit = c.critical ? '[core]' : '[warn]';
    const exp = c.expected !== undefined ? ` | expected ${fmt(c.expected)}` : '';
    const act = c.actual !== undefined && !c.pass ? ` | actual ${fmt(c.actual)}` : '';
    console.log(`${tag} ${crit} ${c.name}${c.pass ? '' : exp + act}`);
    if (!c.pass) { if (c.critical) critFail++; else warnFail++; }
  }
  console.log(`\n=== ${checks.length - critFail - warnFail}/${checks.length} passed | ${critFail} critical failures | ${warnFail} warnings ===`);
  console.log(critFail === 0 ? 'RESULT: PASS (no critical lies detected)' : 'RESULT: FAIL (critical lies detected — would be flagged)');
  process.exit(critFail === 0 ? 0 : 1);
}

function fmt(v: unknown): string {
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

main().catch((e) => {
  console.error('detection run errored:', e);
  process.exit(2);
});
