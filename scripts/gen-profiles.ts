// GhostFrame profile generator — builds 12 coherent DeviceProfiles and writes them to disk.
// Run: npx tsx scripts/gen-profiles.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { DeviceProfile, OS, Browser } from '../src/types/profile.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = resolve(__dirname, '../data/profiles');
mkdirSync(PROFILES_DIR, { recursive: true });

const NOW = '2026-08-12T11:00:00.000Z';

// Known-good public JA3 strings
const JA3 = {
  chrome: '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
  firefox: '771,4865-4867-4866-49195-49199-52393-52392-49196-49200-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-34-51-43-13-45-28-65037,29-23-24-25,0',
  safari: '771,4865-4866-4867-49196-49195-52393-49200-49199-52392-49162-49161-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-51-45-43-21,29-23-24,0',
};
const JA4 = {
  chrome: 't13d1516h2_8daaf6152771_b0da82dd1658',
  firefox: 't13d1716h2_a7c4b7c65280_13d4b0448e16',
  safari: 't13d1614h2_d1aea835e6f4_4a2edf8d6c84',
};

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

// Parse a JA3 string into its component number lists.
function parseJa3(ja3: string) {
  const parts = ja3.split(',');
  const toNums = (s: string) => s.split('-').map(Number);
  return {
    cipherSuites: toNums(parts[1] || ''),
    extensions: toNums(parts[2] || ''),
    curves: toNums(parts[3] || ''),
    signatureAlgorithms: toNums(parts[4] || ''),
  };
}

function clientHelloId(browser: Browser): string {
  if (browser === 'chrome' || browser === 'edge') return 'HelloChrome_120';
  if (browser === 'firefox') return 'HelloFirefox_120';
  if (browser === 'safari') return 'HelloSafari_16_0';
  return 'HelloChrome_120';
}

// OS-appropriate values
const OS_DATA: Record<OS, {
  platform: string;
  fonts: string[];
  detectionFonts: { family: string; present: boolean }[];
  gpuBackend: string;
  voices: { name: string; lang: string }[];
}> = {
  windows: {
    platform: 'Win32',
    fonts: ['Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Light', 'Sylfaen', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
    detectionFonts: [{ family: 'Segoe UI', present: true }, { family: 'Calibri', present: true }, { family: 'Arial', present: true }, { family: 'Helvetica', present: false }, { family: 'Menlo', present: false }, { family: 'Consolas', present: true }],
    gpuBackend: 'Direct3D11',
    voices: [{ name: 'Microsoft David Desktop', lang: 'en-US' }, { name: 'Microsoft Zira Desktop', lang: 'en-US' }, { name: 'Microsoft Mark Desktop', lang: 'en-US' }],
  },
  macos: {
    platform: 'MacIntel',
    fonts: ['Arial', 'Avenir', 'Avenir Next', 'Comic Sans MS', 'Courier New', 'Geneva', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Lucida Grande', 'Menlo', 'Monaco', 'Optima', 'Palatino', 'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
    detectionFonts: [{ family: 'Helvetica', present: true }, { family: 'Helvetica Neue', present: true }, { family: 'Menlo', present: true }, { family: 'Segoe UI', present: false }, { family: 'Calibri', present: false }, { family: 'Consolas', present: false }],
    gpuBackend: 'Metal',
    voices: [{ name: 'Samantha', lang: 'en-US' }, { name: 'Alex', lang: 'en-US' }, { name: 'Daniel', lang: 'en-GB' }],
  },
  linux: {
    platform: 'Linux x86_64',
    fonts: ['Bitstream Vera Sans', 'Cantarell', 'DejaVu Sans', 'DejaVu Sans Mono', 'DejaVu Serif', 'FreeMono', 'FreeSans', 'FreeSerif', 'Liberation Mono', 'Liberation Sans', 'Liberation Serif', 'Nimbus Sans', 'Nimbus Sans Mono', 'Nimbus Roman', 'Ubuntu', 'Ubuntu Mono'],
    detectionFonts: [{ family: 'DejaVu Sans', present: true }, { family: 'Liberation Sans', present: true }, { family: 'Ubuntu', present: true }, { family: 'Segoe UI', present: false }, { family: 'Calibri', present: false }, { family: 'Arial', present: false }],
    gpuBackend: 'OpenGL',
    voices: [{ name: 'espeak', lang: 'en-US' }, { name: 'festival', lang: 'en-US' }],
  },
  android: {
    platform: 'Linux armv8l',
    fonts: ['Roboto', 'Noto Sans', 'Noto Serif', 'Droid Sans', 'Droid Sans Mono', 'Cutive Mono'],
    detectionFonts: [{ family: 'Roboto', present: true }, { family: 'Noto Sans', present: true }, { family: 'Droid Sans', present: true }, { family: 'Segoe UI', present: false }, { family: 'Arial', present: false }],
    gpuBackend: 'OpenGL ES',
    voices: [{ name: 'Google US English', lang: 'en-US' }],
  },
  ios: {
    platform: 'iPhone',
    fonts: ['Arial', 'Avenir', 'Avenir Next', 'Courier New', 'Georgia', 'Helvetica', 'Helvetica Neue', 'Marker Felt', 'Optima', 'Palatino', 'Times New Roman', 'Trebuchet MS', 'Verdana'],
    detectionFonts: [{ family: 'Helvetica', present: true }, { family: 'Helvetica Neue', present: true }, { family: 'Avenir', present: true }, { family: 'Roboto', present: false }, { family: 'Segoe UI', present: false }],
    gpuBackend: 'Metal',
    voices: [{ name: 'Samantha', lang: 'en-US' }, { name: 'Alex', lang: 'en-US' }],
  },
};

// Geolocation by timezone
const GEO: Record<string, { lat: number; long: number }> = {
  'America/New_York': { lat: 40.7128, long: -74.006 },
  'America/Los_Angeles': { lat: 34.0522, long: -118.2437 },
  'America/Chicago': { lat: 41.8781, long: -87.6298 },
  'America/Denver': { lat: 39.7392, long: -104.9903 },
  'Europe/London': { lat: 51.5074, long: -0.1278 },
  'Europe/Berlin': { lat: 52.52, long: 13.405 },
};

const TZ_OFFSETS: Record<string, number> = {
  'America/New_York': 240,   // EDT (Aug) — computed; overwritten by correct offset below at gen time
  'America/Los_Angeles': 420, // PDT
  'America/Chicago': 300,    // CDT
  'America/Denver': 360,     // MDT
  'Europe/London': -60,      // BST
  'Europe/Berlin': -120,     // CEST
};

// Compute a tz's CURRENT getTimezoneOffset-style value (minutes west of UTC) from the
// host ICU tz database so generated profiles always carry the live DST-correct number.
function computedTzOffset(tzid: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, hourCycle: 'h23',
    });
    const map: Record<string, string> = {};
    for (const part of dtf.formatToParts(new Date())) map[part.type] = part.value;
    let hour = parseInt(map.hour || '0', 10);
    if (hour === 24) hour = 0;
    const asUTC = Date.UTC(parseInt(map.year, 10), (parseInt(map.month, 10) - 1), parseInt(map.day, 10), hour, parseInt(map.minute, 10), parseInt(map.second, 10));
    return Math.round(-((asUTC - Math.floor(Date.now() / 1000) * 1000) / 60000));
  } catch {
    return TZ_OFFSETS[tzid] ?? 0;
  }
}

interface Spec {
  id: string;
  label: string;
  os: OS;
  osVersion: string;
  browser: Browser;
  browserVersion: string;
  uaOS: string; // UA OS token
  uaExtra?: string; // mobile UA extras
  locale: string;
  timezoneId: string;
  screen: { width: number; height: number; dpr: number; mobile: boolean; orientation?: 'portrait' | 'landscape' };
  hardware: { cores: number; mem: number };
  gpu: { vendor: string; renderer: string; unmaskedVendor: string; unmaskedRenderer: string };
  touchPoints: number;
}

const SPECS: Spec[] = [
  { id: 'win11-chrome-151', label: 'Windows 11 / Chrome 151', os: 'windows', osVersion: '11', browser: 'chrome', browserVersion: '151', uaOS: 'Windows NT 10.0; Win64; x64', locale: 'en-US', timezoneId: 'America/New_York', screen: { width: 1920, height: 1080, dpr: 1, mobile: false }, hardware: { cores: 12, mem: 16 }, gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, touchPoints: 0 },
  { id: 'win11-chrome-151-gtx', label: 'Windows 11 / Chrome 151 (GTX)', os: 'windows', osVersion: '11', browser: 'chrome', browserVersion: '151', uaOS: 'Windows NT 10.0; Win64; x64', locale: 'en-US', timezoneId: 'America/Los_Angeles', screen: { width: 2560, height: 1440, dpr: 1, mobile: false }, hardware: { cores: 8, mem: 16 }, gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, touchPoints: 0 },
  { id: 'win11-edge-151', label: 'Windows 11 / Edge 151', os: 'windows', osVersion: '11', browser: 'edge', browserVersion: '151', uaOS: 'Windows NT 10.0; Win64; x64', locale: 'en-GB', timezoneId: 'Europe/London', screen: { width: 1920, height: 1080, dpr: 1.25, mobile: false }, hardware: { cores: 12, mem: 32 }, gpu: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, touchPoints: 0 },
  { id: 'win11-firefox-121', label: 'Windows 11 / Firefox 121', os: 'windows', osVersion: '11', browser: 'firefox', browserVersion: '121', uaOS: 'Windows NT 10.0; Win64; x64', locale: 'de-DE', timezoneId: 'Europe/Berlin', screen: { width: 1920, height: 1080, dpr: 1, mobile: false }, hardware: { cores: 8, mem: 16 }, gpu: { vendor: 'Mozilla', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, touchPoints: 0 },
  { id: 'macos14-chrome-151', label: 'macOS 14 / Chrome 151', os: 'macos', osVersion: '14.5', browser: 'chrome', browserVersion: '151', uaOS: 'Macintosh; Intel Mac OS X 10_15_7', locale: 'en-US', timezoneId: 'America/New_York', screen: { width: 2560, height: 1440, dpr: 2, mobile: false }, hardware: { cores: 12, mem: 16 }, gpu: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', unmaskedVendor: 'Google Inc. (Apple)', unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)' }, touchPoints: 0 },
  { id: 'macos14-safari-17', label: 'macOS 14 / Safari 17', os: 'macos', osVersion: '14.5', browser: 'safari', browserVersion: '17.5', uaOS: 'Macintosh; Intel Mac OS X 10_15_7', locale: 'en-US', timezoneId: 'America/Los_Angeles', screen: { width: 2560, height: 1440, dpr: 2, mobile: false }, hardware: { cores: 8, mem: 8 }, gpu: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', unmaskedVendor: 'Google Inc. (Apple)', unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)' }, touchPoints: 0 },
  { id: 'macos13-firefox-121', label: 'macOS 13 / Firefox 121', os: 'macos', osVersion: '13.6', browser: 'firefox', browserVersion: '121', uaOS: 'Macintosh; Intel Mac OS X 13.6', locale: 'en-US', timezoneId: 'America/Chicago', screen: { width: 1440, height: 900, dpr: 2, mobile: false }, hardware: { cores: 8, mem: 16 }, gpu: { vendor: 'Mozilla', renderer: 'ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL)', unmaskedVendor: 'Intel Inc.', unmaskedRenderer: 'ANGLE (Intel Inc., Intel Iris Xe Graphics, OpenGL)' }, touchPoints: 0 },
  { id: 'ubuntu-chrome-151', label: 'Ubuntu 22.04 / Chrome 151', os: 'linux', osVersion: '22.04', browser: 'chrome', browserVersion: '151', uaOS: 'X11; Linux x86_64', locale: 'en-US', timezoneId: 'America/Denver', screen: { width: 1920, height: 1080, dpr: 1, mobile: false }, hardware: { cores: 8, mem: 16 }, gpu: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.6)', unmaskedVendor: 'Google Inc. (AMD)', unmaskedRenderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT, OpenGL 4.6)' }, touchPoints: 0 },
  { id: 'ubuntu-firefox-121', label: 'Ubuntu 22.04 / Firefox 121', os: 'linux', osVersion: '22.04', browser: 'firefox', browserVersion: '121', uaOS: 'X11; Linux x86_64', locale: 'en-US', timezoneId: 'America/Denver', screen: { width: 1920, height: 1200, dpr: 1, mobile: false }, hardware: { cores: 8, mem: 32 }, gpu: { vendor: 'Mozilla', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.6)', unmaskedVendor: 'Google Inc. (NVIDIA)', unmaskedRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.6)' }, touchPoints: 0 },
  { id: 'android13-chrome-151-mobile', label: 'Android 13 / Chrome 151 (Pixel 7)', os: 'android', osVersion: '13', browser: 'chrome', browserVersion: '151', uaOS: 'Linux; Android 13; Pixel 7', locale: 'en-US', timezoneId: 'America/New_York', screen: { width: 412, height: 915, dpr: 2.625, mobile: true, orientation: 'portrait' }, hardware: { cores: 8, mem: 8 }, gpu: { vendor: 'Google Inc. (Qualcomm)', renderer: 'ANGLE (Qualcomm, Adreno 730, OpenGL ES 3.2)', unmaskedVendor: 'Google Inc. (Qualcomm)', unmaskedRenderer: 'ANGLE (Qualcomm, Adreno 730, OpenGL ES 3.2)' }, touchPoints: 5 },
  { id: 'ios17-safari-mobile', label: 'iOS 17 / Safari (iPhone 15)', os: 'ios', osVersion: '17.2', browser: 'safari', browserVersion: '17.2', uaOS: 'iPhone; CPU iPhone OS 17_2 like Mac OS X', locale: 'en-US', timezoneId: 'America/New_York', screen: { width: 393, height: 852, dpr: 3, mobile: true, orientation: 'portrait' }, hardware: { cores: 6, mem: 6 }, gpu: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple A16, Unspecified Version)', unmaskedVendor: 'Google Inc. (Apple)', unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple A16, Unspecified Version)' }, touchPoints: 5 },
  { id: 'macos14-chrome-151-m3max', label: 'macOS 14 / Chrome 151 (M3 Max)', os: 'macos', osVersion: '14.5', browser: 'chrome', browserVersion: '151', uaOS: 'Macintosh; Intel Mac OS X 10_15_7', locale: 'en-US', timezoneId: 'America/New_York', screen: { width: 3024, height: 1964, dpr: 2, mobile: false }, hardware: { cores: 16, mem: 64 }, gpu: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', unmaskedVendor: 'Google Inc. (Apple)', unmaskedRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)' }, touchPoints: 0 },
];

function buildUA(s: Spec): string {
  if (s.browser === 'chrome') return `Mozilla/5.0 (${s.uaOS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${s.browserVersion}.0.0.0 Safari/537.36`;
  if (s.browser === 'edge') return `Mozilla/5.0 (${s.uaOS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${s.browserVersion}.0.0.0 Safari/537.36 Edg/${s.browserVersion}.0.0.0`;
  if (s.browser === 'firefox') return `Mozilla/5.0 (${s.uaOS}; rv:${s.browserVersion}.0) Gecko/20100101 Firefox/${s.browserVersion}.0`;
  if (s.browser === 'safari') {
    if (s.os === 'ios') return `Mozilla/5.0 (${s.uaOS}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1`;
    return `Mozilla/5.0 (${s.uaOS}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15`;
  }
  return '';
}

function buildUAData(s: Spec): DeviceProfile['userAgentData'] {
  const v = s.browserVersion;
  if (s.browser === 'chrome') return { brands: [{ brand: 'Google Chrome', version: v }, { brand: 'Chromium', version: v }, { brand: 'Not.A/Brand', version: '24' }], mobile: s.screen.mobile, platform: s.os === 'windows' ? 'Windows' : s.os === 'macos' ? 'macOS' : s.os === 'linux' ? 'Linux' : 'Android', architecture: '', bitness: '', model: s.screen.mobile ? (s.id.includes('pixel') ? 'Pixel 7' : 'iPhone15,3') : '', platformVersion: s.osVersion, uaFullVersion: `${v}.0.0.0`, fullVersionList: [{ brand: 'Google Chrome', version: `${v}.0.0.0` }, { brand: 'Chromium', version: `${v}.0.0.0` }, { brand: 'Not.A/Brand', version: '24.0.0.0' }], wow64: false };
  if (s.browser === 'edge') return { brands: [{ brand: 'Microsoft Edge', version: v }, { brand: 'Chromium', version: v }, { brand: 'Not.A/Brand', version: '24' }], mobile: false, platform: 'Windows', architecture: '', bitness: '', model: '', platformVersion: s.osVersion, uaFullVersion: `${v}.0.0.0`, fullVersionList: [{ brand: 'Microsoft Edge', version: `${v}.0.0.0` }, { brand: 'Chromium', version: `${v}.0.0.0` }, { brand: 'Not.A/Brand', version: '24.0.0.0' }], wow64: false };
  if (s.browser === 'firefox') return { brands: [{ brand: 'Firefox', version: v }], mobile: s.screen.mobile, platform: s.os === 'windows' ? 'Windows' : s.os === 'macos' ? 'macOS' : s.os === 'linux' ? 'Linux' : 'Android', architecture: '', bitness: '', model: '', platformVersion: s.osVersion, uaFullVersion: `${v}.0.0`, fullVersionList: [{ brand: 'Firefox', version: `${v}.0.0` }], wow64: false };
  // safari
  return { brands: [{ brand: 'Safari', version: s.browserVersion }, { brand: 'Not.A/Brand', version: '8' }], mobile: s.screen.mobile, platform: s.os === 'macos' ? 'macOS' : 'iOS', architecture: '', bitness: '', model: s.screen.mobile ? 'iPhone15,3' : '', platformVersion: s.osVersion, uaFullVersion: s.browserVersion, fullVersionList: [{ brand: 'Safari', version: s.browserVersion }, { brand: 'Not.A/Brand', version: '8.0.0.0' }], wow64: false };
}

function buildTls(s: Spec): DeviceProfile['tls'] {
  const ja3Full = s.browser === 'firefox' ? JA3.firefox : (s.browser === 'safari' ? JA3.safari : JA3.chrome);
  const parsed = parseJa3(ja3Full);
  const ja4 = s.browser === 'firefox' ? JA4.firefox : (s.browser === 'safari' ? JA4.safari : JA4.chrome);
  return {
    clientHelloId: clientHelloId(s.browser),
    ja3: md5(ja3Full),
    ja3Full,
    ja4,
    cipherSuites: parsed.cipherSuites,
    extensions: parsed.extensions,
    curves: parsed.curves,
    signatureAlgorithms: parsed.signatureAlgorithms,
    alpn: ['h2', 'http/1.1'],
  };
}

function buildProfile(s: Spec): DeviceProfile {
  const osd = OS_DATA[s.os];
  const geo = GEO[s.timezoneId] || { lat: 0, long: 0 };
  const isMobile = s.os === 'android' || s.os === 'ios';
  const offset = computedTzOffset(s.timezoneId);
  const seedBase = s.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 1000 + 17;
  const fakeIp = `192.168.${(seedBase % 200) + 1}.${(seedBase * 7) % 250}`;

  const voices = osd.voices.map((v, i) => ({ name: v.name, lang: v.lang, localService: true, default: i === 0, voiceURI: v.name }));

  return {
    id: s.id,
    label: s.label,
    os: s.os,
    osVersion: s.osVersion,
    browser: s.browser,
    browserVersion: s.browserVersion,
    userAgent: buildUA(s),
    platform: osd.platform,
    userAgentData: buildUAData(s),
    languages: [s.locale],
    timezone: { id: s.timezoneId, offsetMinutes: offset, locale: s.locale },
    screen: { width: s.screen.width, height: s.screen.height, availWidth: s.screen.width, availHeight: s.screen.height - (s.screen.mobile ? 0 : 40), colorDepth: 24, pixelDepth: 24, orientation: { angle: 0, type: s.screen.orientation === 'portrait' ? 'portrait-primary' : 'landscape-primary' } },
    window: { innerWidth: s.screen.width, innerHeight: s.screen.height - (s.screen.mobile ? 0 : 120), outerWidth: s.screen.width, outerHeight: s.screen.height, devicePixelRatio: s.screen.dpr, screenX: 0, screenY: 0 },
    hardware: { hardwareConcurrency: s.hardware.cores, deviceMemory: s.hardware.mem },
    navigator: {
      vendor: (s.browser === 'safari') ? 'Apple Computer, Inc.' : (s.browser === 'firefox' ? '' : 'Google Inc.'),
      vendorSub: '', product: 'Gecko', productSub: '20030107', appName: 'Netscape', appCodeName: 'Mozilla',
      appVersion: buildUA(s).replace('Mozilla/5.0 ', ''),
      cookieEnabled: true, doNotTrack: '1', maxTouchPoints: s.touchPoints, pdfViewerEnabled: (s.browser === 'chrome' || s.browser === 'edge'),
      webdriver: false,
      connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
      plugins: isMobile ? [] : ((s.browser === 'chrome' || s.browser === 'edge') ? [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', mimeTypes: [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }] },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeTypes: [] },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeTypes: [] },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '', mimeTypes: [] },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '', mimeTypes: [] },
      ] : []),
      mimeTypes: isMobile ? [] : ((s.browser === 'chrome' || s.browser === 'edge') ? [{ type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' }] : []),
    },
    gpu: { vendor: s.gpu.vendor, renderer: s.gpu.renderer, unmaskedVendor: s.gpu.unmaskedVendor, unmaskedRenderer: s.gpu.unmaskedRenderer, maxTextureSize: 16384, maxViewportDims: [16384, 16384], maxRenderBufferSize: 16384, maxVertexAttribs: 16, maxVaryingVectors: 30, maxVertexUniformVectors: 4096, maxFragmentUniformVectors: 1024, aliasedLineWidthRange: [1, 1], aliasedPointSizeRange: [1, 1024], maxCombinedTextureImageUnits: 32, maxCubeMapTextureSize: 16384, maxTextureImageUnits: 16, shadingLanguageVersion: 'WebGL GLSL ES 1.0 (OpenGL ES Shading Language, WebGL Specification)', version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)', antialias: true, extensions: ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'EXT_color_buffer_half_float', 'EXT_disjoint_timer_query', 'EXT_float_blend', 'EXT_frag_depth', 'EXT_shader_texture_lod', 'EXT_texture_compression_bptc', 'EXT_texture_compression_rgtc', 'EXT_texture_filter_anisotropic', 'EXT_sRGB', 'OES_element_index_uint', 'OES_fbo_render_mipmap', 'OES_standard_derivatives', 'OES_texture_float', 'OES_texture_float_linear', 'OES_texture_half_float', 'OES_texture_half_float_linear', 'OES_vertex_array_object', 'WEBGL_color_buffer_float', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb', 'WEBGL_debug_renderer_info', 'WEBGL_debug_shaders', 'WEBGL_depth_texture', 'WEBGL_draw_buffers', 'WEBGL_lose_context', 'WEBGL_multi_draw'] },
    fonts: { fonts: osd.fonts, detectionFonts: osd.detectionFonts },
    mediaDevices: [
      { kind: 'audioinput', label: s.os === 'macos' ? 'MacBook Pro Microphone' : 'Default - Microphone (Built-in)', deviceId: createHash('sha256').update(`${s.id}-mic`).digest('hex').slice(0, 64), groupId: createHash('sha256').update(`${s.id}-grp0`).digest('hex').slice(0, 64) },
      { kind: 'audiooutput', label: s.os === 'macos' ? 'MacBook Pro Speakers' : 'Default - Speakers (Built-in)', deviceId: createHash('sha256').update(`${s.id}-spk`).digest('hex').slice(0, 64), groupId: createHash('sha256').update(`${s.id}-grp0`).digest('hex').slice(0, 64) },
      { kind: 'videoinput', label: s.os === 'macos' ? 'FaceTime HD Camera (Built-in)' : 'Default - Camera (Built-in)', deviceId: createHash('sha256').update(`${s.id}-cam`).digest('hex').slice(0, 64), groupId: createHash('sha256').update(`${s.id}-grp1`).digest('hex').slice(0, 64) },
    ],
    speechVoices: voices,
    permissions: [{ name: 'notifications', state: 'prompt' }, { name: 'geolocation', state: 'prompt' }, { name: 'camera', state: 'prompt' }, { name: 'microphone', state: 'prompt' }, { name: 'persistent-storage', state: 'prompt' }],
    geolocation: { latitude: geo.lat, longitude: geo.long, accuracy: 24.5, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
    battery: { charging: false, chargingTime: Infinity, dischargingTime: 12600, level: 0.83 },
    webrtc: { iceCandidatePolicy: 'default', forceRelay: false, mangleSDP: true, fakeLocalIP: fakeIp },
    canvas: { noiseSeed: seedBase, noiseStrength: 1 },
    audio: { noiseSeed: seedBase + 1, sampleRate: 48000, noiseStrength: 0.0001 },
    math: { performanceNowResolutionMs: 0.0001 },
    tls: buildTls(s),
    http2: { settings: [{ id: 1, value: 65536 }, { id: 3, value: 1000 }, { id: 5, value: 16384 }, { id: 7, value: 6291456 }, { id: 9, value: 15663105 }, { id: 11, value: 1 }, { id: 13, value: 0 }], windowUpdate: 15663105, headerOrder: ['host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'upgrade-insecure-requests', 'user-agent', 'accept', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user', 'sec-fetch-dest', 'accept-encoding', 'accept-language', 'cookie'], pseudoHeaderOrder: [':method', ':authority', ':scheme', ':path'], priority: [{ streamId: 0, weight: 256, exclusive: false, depStreamId: 0 }] },
    httpHeaders: { order: ['host', 'connection', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'upgrade-insecure-requests', 'user-agent', 'accept', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user', 'sec-fetch-dest', 'accept-encoding', 'accept-language', 'cookie'], casing: { host: 'Host', connection: 'Connection', 'sec-ch-ua': 'Sec-CH-UA', 'sec-ch-ua-mobile': 'Sec-CH-UA-Mobile', 'sec-ch-ua-platform': 'Sec-CH-UA-Platform', 'upgrade-insecure-requests': 'Upgrade-Insecure-Requests', 'user-agent': 'User-Agent', accept: 'Accept', 'sec-fetch-site': 'Sec-Fetch-Site', 'sec-fetch-mode': 'Sec-Fetch-Mode', 'sec-fetch-user': 'Sec-Fetch-User', 'sec-fetch-dest': 'Sec-Fetch-Dest', 'accept-encoding': 'Accept-Encoding', 'accept-language': 'Accept-Language', cookie: 'Cookie' } },
    proxy: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

let count = 0;
for (const spec of SPECS) {
  const profile = buildProfile(spec);
  const path = resolve(PROFILES_DIR, `${spec.id}.json`);
  writeFileSync(path, JSON.stringify(profile, null, 2));
  count++;
  console.log(`wrote ${spec.id}.json`);
}
console.log(`\nDone. ${count} profiles written to ${PROFILES_DIR}`);
