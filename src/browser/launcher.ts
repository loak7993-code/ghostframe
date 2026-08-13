import { promises as fs, existsSync, readFileSync } from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type { DeviceProfile, FingerprintReadback } from '../types/profile.js';
import { ProfileManager } from '../profile/manager.js';
import { ProxyManager, type PlaywrightProxyConfig } from '../proxy/manager.js';
import {
  profilesStateDir,
  injectScriptPath,
  ghostProxyServer,
} from '../paths.js';

export interface LaunchOptions {
  headless?: boolean;
  proxyOverride?: string;
  useGhostProxy?: boolean;
  autoRotateProxy?: boolean;
  extraArgs?: string[];
  ignoreCertErrors?: boolean;
}

export interface LaunchResult {
  context: BrowserContext;
  profile: DeviceProfile;
  proxy?: PlaywrightProxyConfig;
  proxyManager: ProxyManager;
}

const profileManager = new ProfileManager();
const proxyManager = new ProxyManager();

export async function launchProfile(
  profile: DeviceProfile,
  opts: LaunchOptions = {},
): Promise<LaunchResult> {
  const userDataDir = profileManager.userDataDir(profile.id);
  await fs.mkdir(profilesStateDir, { recursive: true });

  const injectSrc = readInjectScript();

  const proxy = resolveProxy(profile, opts);

  const lang = profile.languages[0] ?? 'en-US';
  const ignoreCert = opts.ignoreCertErrors ?? true;

  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    `--lang=${lang}`,
  ];
  if (ignoreCert) {
    args.push('--ignore-certificate-errors');
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);

  const contextOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
    headless: opts.headless ?? true,
    args,
    locale: lang,
    timezoneId: profile.timezone.id,
    viewport: {
      width: profile.window.innerWidth,
      height: profile.window.innerHeight,
    },
    screen: {
      width: profile.screen.width,
      height: profile.screen.height,
    },
    deviceScaleFactor: profile.window.devicePixelRatio,
    userAgent: profile.userAgent,
    geolocation: {
      latitude: profile.geolocation.latitude,
      longitude: profile.geolocation.longitude,
      accuracy: profile.geolocation.accuracy,
    },
    ignoreHTTPSErrors: ignoreCert,
    acceptDownloads: true,
  };
  if (proxy) contextOptions.proxy = proxy;

  const context = await chromium.launchPersistentContext(userDataDir, contextOptions);

  await installInjection(context, profile, injectSrc);

  // The persistent context's initial about:blank page exists BEFORE init scripts are
  // registered, so it never receives them. Reload it once to put it under the patch.
  for (const page of context.pages()) {
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
    } catch {
      /* best effort — subsequent navigations are patched regardless */
    }
  }

  return { context, profile, proxy, proxyManager };
}

async function installInjection(
  context: BrowserContext,
  profile: DeviceProfile,
  injectSrc: string,
): Promise<void> {
  await context.addInitScript((p: DeviceProfile) => {
    (globalThis as unknown as Record<string, unknown>).__GHOSTFRAME_PROFILE__ = p;
  }, profile);

  await context.addInitScript({ content: injectSrc });
}

export function resolveProxy(
  profile: DeviceProfile,
  opts: LaunchOptions,
): PlaywrightProxyConfig | undefined {
  if (opts.proxyOverride) {
    const cfg = parseProxyOverride(opts.proxyOverride);
    if (cfg) return cfg;
  }
  if (opts.useGhostProxy === false) {
    const direct = proxyManager.configFromProfile(profile);
    if (direct) return direct;
    return undefined;
  }
  return { server: ghostProxyServer };
}

function parseProxyOverride(url: string): PlaywrightProxyConfig | undefined {
  try {
    const u = new URL(url);
    if (!u.hostname || !u.port) return undefined;
    const proto = u.protocol.replace(/:$/, '');
    if (proto !== 'http' && proto !== 'https' && proto !== 'socks5' && proto !== 'socks5h') {
      return undefined;
    }
    const server = `${proto === 'https' ? 'http' : proto}://${u.hostname}:${u.port}`;
    return {
      server,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return undefined;
  }
}

export function readInjectScript(): string {
  if (!existsSync(injectScriptPath)) {
    throw new Error(
      `dist/inject.js not found at ${injectScriptPath}. Build the injection engine first: npm run build`,
    );
  }
  return readFileSync(injectScriptPath, 'utf8');
}

function buildReadbackScript(profileId: string): string {
  const idLiteral = JSON.stringify(profileId);
  return [
    '(async () => {',
    '  const profileId = ' + idLiteral + ';',
    '  const sha = (input) => {',
    '    var bytes = [];',
    '    for (var i = 0; i < input.length; i++) {',
    '      var c = input.charCodeAt(i);',
    '      if (c < 0x80) bytes.push(c);',
    '      else if (c < 0x800) bytes.push(0xc0|(c>>6), 0x80|(c&0x3f));',
    '      else bytes.push(0xe0|(c>>12), 0x80|((c>>6)&0x3f), 0x80|(c&0x3f));',
    '    }',
    '    var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];',
    '    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];',
    '    var bitLen = bytes.length * 8;',
    '    bytes.push(0x80);',
    '    while (bytes.length % 64 !== 56) bytes.push(0);',
    '    bytes.push(0,0,0,0, (bitLen>>>24)&0xff,(bitLen>>>16)&0xff,(bitLen>>>8)&0xff,bitLen&0xff);',
    '    var rr = (x,n) => ((x>>>n)|(x<<(32-n)))>>>0;',
    '    for (var off = 0; off < bytes.length; off += 64) {',
    '      var w = new Array(64);',
    '      for (var t = 0; t < 16; t++) w[t] = ((bytes[off+t*4]<<24)|(bytes[off+t*4+1]<<16)|(bytes[off+t*4+2]<<8)|bytes[off+t*4+3])>>>0;',
    '      for (var t = 16; t < 64; t++) {',
    '        var s0 = rr(w[t-15],7)^rr(w[t-15],18)^(w[t-15]>>>3);',
    '        var s1 = rr(w[t-2],17)^rr(w[t-2],19)^(w[t-2]>>>10);',
    '        w[t] = (w[t-16]+s0+w[t-7]+s1)>>>0;',
    '      }',
    '      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];',
    '      for (var t = 0; t < 64; t++) {',
    '        var S1 = rr(e,6)^rr(e,11)^rr(e,25);',
    '        var ch = (e&f)^((~e)&g);',
    '        var t1 = (h+S1+ch+K[t]+w[t])>>>0;',
    '        var S0 = rr(a,2)^rr(a,13)^rr(a,22);',
    '        var mj = (a&b)^(a&c)^(b&c);',
    '        var t2 = (S0+mj)>>>0;',
    '        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;',
    '      }',
    '      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;',
    '      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;',
    '    }',
    '    var hex = "";',
    '    for (var i = 0; i < 8; i++) { var s = H[i].toString(16); while (s.length < 8) s = "0"+s; hex += s; }',
    '    return hex;',
    '  };',
    '  const canvas = document.createElement("canvas");',
    '  canvas.width = 280; canvas.height = 60;',
    '  const ctx = canvas.getContext("2d");',
    '  if (ctx) {',
    '    ctx.textBaseline = "top";',
    '    ctx.font = "14px \'Arial\'";',
    '    ctx.fillStyle = "#f60"; ctx.fillRect(125, 1, 62, 20);',
    '    ctx.fillStyle = "#069"; ctx.fillText("GhostFrame fingerprint test", 2, 15);',
    '    ctx.fillStyle = "rgba(102, 204, 0, 0.7)"; ctx.fillText("GhostFrame fingerprint test", 4, 17);',
    '  }',
    '  const canvasHash = await sha(canvas.toDataURL());',
    '  let webglVendor = "", webglRenderer = "";',
    '  try {',
    '    const glCanvas = document.createElement("canvas");',
    '    const gl = glCanvas.getContext("webgl") || glCanvas.getContext("experimental-webgl");',
    '    if (gl) {',
    '      const dbg = gl.getExtension("WEBGL_debug_renderer_info");',
    '      if (dbg) { webglVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)); webglRenderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)); }',
    '      else { webglVendor = String(gl.getParameter(gl.VENDOR)); webglRenderer = String(gl.getParameter(gl.RENDERER)); }',
    '    }',
    '  } catch (e) { webglVendor = "error"; webglRenderer = String(e); }',
    '  let audioHash = "";',
    '  try {',
    '    const Ctor = window.OfflineAudioContext || window.webkitOfflineAudioContext;',
    '    if (Ctor) {',
    '      const ac = new Ctor(1, 5000, 44100);',
    '      const osc = ac.createOscillator(); osc.type = "triangle"; osc.frequency.value = 10000;',
    '      const comp = ac.createDynamicsCompressor(); osc.connect(comp); comp.connect(ac.destination); osc.start(0);',
    '      const buf = await ac.startRendering();',
    '      const data = buf.getChannelData(0);',
    '      const slice = Array.from(data.slice(0, 5000)).map((x) => x.toFixed(6)).join(",");',
    '      audioHash = await sha(slice);',
    '    } else { audioHash = "no-offline-audio"; }',
    '  } catch (e) { audioHash = "error:" + String(e); }',
    '  let webrtcLocalIP = "";',
    '  try {',
    '    const pc = new RTCPeerConnection({ iceServers: [] });',
    '    pc.createDataChannel("ghostframe");',
    '    const cand = await new Promise((resolve) => {',
    '      const timer = setTimeout(() => resolve(null), 2000);',
    '      pc.onicecandidate = (ev) => {',
    '        if (ev.candidate == null) { clearTimeout(timer); resolve(null); return; }',
    '        clearTimeout(timer); resolve(ev.candidate.candidate);',
    '      };',
    '    });',
    '    pc.close();',
    '    if (cand) {',
    '      const m = cand.match(/((?:\\d{1,3}\\.){3}\\d{1,3}|[0-9a-fA-F:]+)\\s+\\d+\\s+typ\\s+host/);',
    '      webrtcLocalIP = m ? m[1] : "";',
    '    }',
    '  } catch (e) { webrtcLocalIP = ""; }',
    '  return {',
    '    profileId,',
    '    userAgent: navigator.userAgent,',
    '    platform: navigator.platform,',
    '    languages: navigator.languages,',
    '    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,',
    '    hardwareConcurrency: navigator.hardwareConcurrency,',
    '    deviceMemory: navigator.deviceMemory || 0,',
    '    canvasHash,',
    '    webglVendor,',
    '    webglRenderer,',
    '    audioHash,',
    '    webrtcLocalIP,',
    '  };',
    '})()',
  ].join('\n');
}

export async function readFingerprint(
  context: BrowserContext,
  profile: DeviceProfile,
): Promise<FingerprintReadback> {
  const page: Page = await context.newPage();
  try {
    await page.goto('about:blank', { waitUntil: 'load' }).catch(() => {});
    const result = await page.evaluate<FingerprintReadback>(buildReadbackScript(profile.id));
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function close(context: BrowserContext): Promise<void> {
  try {
    await context.close();
  } catch {
    // already closed
  }
}

export { profileManager, proxyManager };
