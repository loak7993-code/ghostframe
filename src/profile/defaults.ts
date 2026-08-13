import { randomBytes } from 'node:crypto';
import type {
  DeviceProfile,
  GPUSpec,
  NavigatorSpec,
  FontSpec,
  MediaDevice,
  SpeechVoice,
  PermissionState,
  TLSFingerprint,
  HTTP2Fingerprint,
  HTTPHeaderSpec,
  UserAgentData,
} from '../types/profile.js';

function randUint32(): number {
  return randomBytes(4).readUInt32BE(0);
}

function randHex(n: number): string {
  return randomBytes(n).toString('hex');
}

const CHROME_120_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CHROME_120_UA_DATA: UserAgentData = {
  brands: [
    { brand: 'Not_A Brand', version: '8' },
    { brand: 'Chromium', version: '120' },
    { brand: 'Google Chrome', version: '120' },
  ],
  mobile: false,
  platform: 'Windows',
  architecture: 'x86',
  bitness: '64',
  model: '',
  platformVersion: '15.0.0',
  uaFullVersion: '120.0.6099.110',
  fullVersionList: [
    { brand: 'Not_A Brand', version: '8.0.0.0' },
    { brand: 'Chromium', version: '120.0.6099.110' },
    { brand: 'Google Chrome', version: '120.0.6099.110' },
  ],
  wow64: false,
};

const DEFAULT_NAVIGATOR: NavigatorSpec = {
  vendor: 'Google Inc.',
  vendorSub: '',
  product: 'Gecko',
  productSub: '20030107',
  appName: 'Netscape',
  appCodeName: 'Mozilla',
  appVersion:
    '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  cookieEnabled: true,
  doNotTrack: null,
  maxTouchPoints: 0,
  pdfViewerEnabled: true,
  webdriver: false,
  connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false },
  plugins: [
    {
      name: 'PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
        { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
      ],
    },
    {
      name: 'Chrome PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [],
    },
    {
      name: 'Chromium PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [],
    },
    {
      name: 'Microsoft Edge PDF Viewer',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [],
    },
    {
      name: 'WebKit built-in PDF',
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      mimeTypes: [],
    },
  ],
  mimeTypes: [
    { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
    { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
  ],
};

const DEFAULT_GPU: GPUSpec = {
  vendor: 'Google Inc. (NVIDIA)',
  renderer:
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  unmaskedVendor: 'Google Inc. (NVIDIA)',
  unmaskedRenderer:
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  maxTextureSize: 16384,
  maxViewportDims: [16384, 16384],
  maxRenderBufferSize: 16384,
  maxVertexAttribs: 16,
  maxVaryingVectors: 30,
  maxVertexUniformVectors: 4095,
  maxFragmentUniformVectors: 1024,
  aliasedLineWidthRange: [1, 1],
  aliasedPointSizeRange: [1, 1024],
  maxCombinedTextureImageUnits: 32,
  maxCubeMapTextureSize: 16384,
  maxTextureImageUnits: 16,
  shadingLanguageVersion: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
  version: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
  antialias: true,
  extensions: [
    'ANGLE_instanced_arrays',
    'EXT_blend_minmax',
    'EXT_color_buffer_half_float',
    'EXT_disjoint_timer_query',
    'EXT_float_blend',
    'EXT_frag_depth',
    'EXT_shader_texture_lod',
    'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc',
    'EXT_texture_filter_anisotropic',
    'EXT_sRGB',
    'KHR_parallel_shader_compile',
    'OES_element_index_uint',
    'OES_fbo_render_mipmap',
    'OES_standard_derivatives',
    'OES_texture_float',
    'OES_texture_float_linear',
    'OES_texture_half_float',
    'OES_texture_half_float_linear',
    'OES_vertex_array_object',
    'WEBGL_color_buffer_float',
    'WEBGL_compressed_texture_s3tc',
    'WEBGL_compressed_texture_s3tc_srgb',
    'WEBGL_debug_renderer_info',
    'WEBGL_debug_shaders',
    'WEBGL_depth_texture',
    'WEBGL_draw_buffers',
    'WEBGL_lose_context',
    'WEBGL_multi_draw',
  ],
};

const WINDOWS_FONTS: string[] = [
  'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
  'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New',
  'Ebrima', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia', 'Impact',
  'Javanese Text', 'Leelawadee UI', 'Lucida Console', 'Lucida Sans Unicode',
  'MS Gothic', 'MS PGothic', 'MS Sans Serif', 'MS Serif', 'Malgun Gothic',
  'Microsoft Himalaya', 'Microsoft JhengHei', 'Microsoft New Tai Lue',
  'Microsoft PhagsPa', 'Microsoft Sans Serif', 'Microsoft Tai Le',
  'Microsoft YaHei', 'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti',
  'MV Boli', 'Myanmar Text', 'Nirmala UI', 'Palatino Linotype', 'Segoe Print',
  'Segoe Script', 'Segoe UI', 'Segoe UI Emoji', 'Segoe UI Historic',
  'Segoe UI Symbol', 'SimSun', 'Sylfaen', 'Tahoma', 'Times New Roman',
  'Trebuchet MS', 'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic',
];

const DEFAULT_FONTS: FontSpec = {
  fonts: WINDOWS_FONTS,
  detectionFonts: [
    { family: 'Arial', present: true },
    { family: 'Calibri', present: true },
    { family: 'Cambria', present: true },
    { family: 'Courier New', present: true },
    { family: 'Georgia', present: true },
    { family: 'Segoe UI', present: true },
    { family: 'Tahoma', present: true },
    { family: 'Times New Roman', present: true },
    { family: 'Verdana', present: true },
    { family: 'Consolas', present: true },
  ],
};

function defaultMediaDevices(): MediaDevice[] {
  const g1 = randHex(8);
  const g2 = randHex(8);
  return [
    { kind: 'audioinput', label: 'Default - Microphone Array (Realtek(R) Audio)', deviceId: randHex(8), groupId: g1 },
    { kind: 'audioinput', label: 'Microphone Array (Realtek(R) Audio)', deviceId: randHex(8), groupId: g1 },
    { kind: 'audiooutput', label: 'Default - Speakers (Realtek(R) Audio)', deviceId: randHex(8), groupId: g2 },
    { kind: 'audiooutput', label: 'Speakers (Realtek(R) Audio)', deviceId: randHex(8), groupId: g2 },
    { kind: 'audiooutput', label: 'Default - Headphones (Realtek(R) Audio)', deviceId: randHex(8), groupId: g2 },
    { kind: 'videoinput', label: 'Integrated Camera', deviceId: randHex(8), groupId: randHex(8) },
  ];
}

const DEFAULT_VOICES: SpeechVoice[] = [
  { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US', localService: true, default: true, voiceURI: 'Microsoft David Desktop - English (United States)' },
  { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US', localService: true, default: false, voiceURI: 'Microsoft Zira Desktop - English (United States)' },
  { name: 'Microsoft Mark Desktop - English (United States)', lang: 'en-US', localService: true, default: false, voiceURI: 'Microsoft Mark Desktop - English (United States)' },
];

const DEFAULT_PERMISSIONS: PermissionState[] = [
  { name: 'geolocation', state: 'prompt' },
  { name: 'notifications', state: 'prompt' },
  { name: 'camera', state: 'prompt' },
  { name: 'microphone', state: 'prompt' },
  { name: 'persistent-storage', state: 'granted' },
];

const DEFAULT_TLS: TLSFingerprint = {
  clientHelloId: 'HelloChrome_120',
  ja3: 'cd08e31494f9531f560d93c1e91f798c',
  ja3Full:
    '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0',
  ja4: 't13d1516h2_8daaf6152771_b0da82dd165e',
  cipherSuites: [
    4865, 4866, 4867, 49195, 49199, 49196, 49200, 52393, 52392, 49171, 49172,
    156, 157, 47, 53,
  ],
  extensions: [0, 23, 65281, 10, 11, 35, 16, 5, 13, 18, 51, 45, 43, 27, 17513],
  curves: [29, 23, 24],
  signatureAlgorithms: [1027, 2052, 1025, 1281, 2055, 2057, 2058, 2059, 2053, 513],
  alpn: ['h2', 'http/1.1'],
};

const DEFAULT_HTTP2: HTTP2Fingerprint = {
  settings: [
    { id: 1, value: 65536 },
    { id: 3, value: 1000 },
    { id: 4, value: 6291456 },
    { id: 2, value: 0 },
  ],
  windowUpdate: 15663105,
  headerOrder: [
    ':method', ':authority', ':scheme', ':path', 'accept', 'accept-encoding',
    'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform',
    'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'sec-fetch-user',
    'upgrade-insecure-requests', 'user-agent',
  ],
  pseudoHeaderOrder: [':method', ':authority', ':scheme', ':path'],
  priority: [{ streamId: 0, weight: 256, exclusive: false, depStreamId: 0 }],
};

const DEFAULT_HTTP_HEADERS: HTTPHeaderSpec = {
  order: [
    'Host', 'Connection', 'Content-Length', 'sec-ch-ua', 'sec-ch-ua-mobile',
    'sec-ch-ua-platform', 'upgrade-insecure-requests', 'User-Agent', 'Accept',
    'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-User', 'Accept-Encoding',
    'Accept-Language', 'Cookie',
  ],
  casing: {
    Host: 'Host',
    Connection: 'Connection',
    'Content-Length': 'Content-Length',
    'sec-ch-ua': 'sec-ch-ua',
    'sec-ch-ua-mobile': 'sec-ch-ua-mobile',
    'sec-ch-ua-platform': 'sec-ch-ua-platform',
    'upgrade-insecure-requests': 'upgrade-insecure-requests',
    'User-Agent': 'User-Agent',
    Accept: 'Accept',
    'Sec-Fetch-Site': 'Sec-Fetch-Site',
    'Sec-Fetch-Mode': 'Sec-Fetch-Mode',
    'Sec-Fetch-User': 'Sec-Fetch-User',
    'Accept-Encoding': 'Accept-Encoding',
    'Accept-Language': 'Accept-Language',
    Cookie: 'Cookie',
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (override === undefined || override === null) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override)) {
    const b = (base as Record<string, unknown>)[key];
    const o = (override as Record<string, unknown>)[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? deepMerge(b, o) : o;
  }
  return out as T;
}

export function buildDefaultProfile(overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  const now = new Date().toISOString();
  const fakeLanIp = `192.168.1.${2 + (randUint32() % 252)}`;

  const base: DeviceProfile = {
    id: '',
    label: 'GhostFrame Profile',
    os: 'windows',
    osVersion: '11',
    browser: 'chrome',
    browserVersion: '120.0.6099.110',

    userAgent: CHROME_120_UA,
    platform: 'Win32',
    userAgentData: CHROME_120_UA_DATA,
    languages: ['en-US', 'en'],
    timezone: { id: 'America/New_York', offsetMinutes: -300, locale: 'en-US' },

    screen: {
      width: 1920,
      height: 1080,
      availWidth: 1920,
      availHeight: 1040,
      colorDepth: 24,
      pixelDepth: 24,
      orientation: { angle: 0, type: 'landscape-primary' },
    },
    window: {
      innerWidth: 1536,
      innerHeight: 760,
      outerWidth: 1536,
      outerHeight: 816,
      devicePixelRatio: 1.25,
      screenX: 0,
      screenY: 0,
    },
    hardware: { hardwareConcurrency: 8, deviceMemory: 8 },
    navigator: DEFAULT_NAVIGATOR,
    gpu: DEFAULT_GPU,
    fonts: DEFAULT_FONTS,
    mediaDevices: defaultMediaDevices(),
    speechVoices: DEFAULT_VOICES,
    permissions: DEFAULT_PERMISSIONS,
    geolocation: {
      latitude: 40.7128,
      longitude: -74.006,
      accuracy: 100,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    battery: { charging: true, chargingTime: 0, dischargingTime: 0, level: 0.87 },
    webrtc: {
      iceCandidatePolicy: 'default',
      forceRelay: false,
      mangleSDP: true,
      fakeLocalIP: fakeLanIp,
    },
    canvas: { noiseSeed: randUint32(), noiseStrength: 1 },
    audio: { noiseSeed: randUint32(), sampleRate: 48000, noiseStrength: 0.0000001 },
    math: { performanceNowResolutionMs: 0.005 },

    tls: DEFAULT_TLS,
    http2: DEFAULT_HTTP2,
    httpHeaders: DEFAULT_HTTP_HEADERS,
    proxy: null,

    createdAt: now,
    updatedAt: now,
  };

  return deepMerge(base, overrides);
}
