// GhostFrame — DeviceProfile master contract
// EVERY component (profiles DB, injection engine, launcher, net layer, GUI) MUST import from here.
// Adding a field here is the only way new fingerprint vectors enter the system.

export type OS = 'windows' | 'macos' | 'linux' | 'android' | 'ios';
export type Browser = 'chrome' | 'firefox' | 'safari' | 'edge';

export interface UADataBrand {
  brand: string;
  version: string;
}

export interface UserAgentData {
  brands: UADataBrand[];
  mobile: boolean;
  platform: string;
  // high-entropy hint values returned by getHighEntropyValues()
  architecture: string;
  bitness: string;
  model: string;
  platformVersion: string;
  uaFullVersion: string;
  fullVersionList: UADataBrand[];
  wow64: boolean;
}

export interface ScreenSpec {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelDepth: number;
  orientation: { angle: number; type: 'landscape-primary' | 'portrait-primary' | 'landscape-secondary' | 'portrait-secondary' };
}

export interface WindowSpec {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  devicePixelRatio: number;
  screenX: number;
  screenY: number;
}

export interface HardwareSpec {
  hardwareConcurrency: number;
  deviceMemory: number; // GB, rounded power of 2 (Chrome exposes only 0.25/0.5/1/2/4/8)
}

export interface NavigatorSpec {
  vendor: string;
  vendorSub: string;
  product: string;
  productSub: string;
  appName: string;
  appCodeName: string;
  appVersion: string;
  cookieEnabled: boolean;
  doNotTrack: string | null;
  maxTouchPoints: number;
  pdfViewerEnabled: boolean;
  webdriver: boolean; // MUST be false
  connection: {
    effectiveType: '4g' | '3g' | '2g' | 'slow-2g';
    downlink: number;
    rtt: number;
    saveData: boolean;
  } | null;
  plugins: { name: string; filename: string; description: string; mimeTypes: { type: string; suffixes: string; description: string }[] }[];
  mimeTypes: { type: string; suffixes: string; description: string }[];
}

export interface GPUSpec {
  vendor: string; // e.g. "Google Inc. (NVIDIA)"
  renderer: string; // e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)"
  unmaskedVendor: string;
  unmaskedRenderer: string;
  // WebGL context parameters
  maxTextureSize: number;
  maxViewportDims: [number, number];
  maxRenderBufferSize: number;
  maxVertexAttribs: number;
  maxVaryingVectors: number;
  maxVertexUniformVectors: number;
  maxFragmentUniformVectors: number;
  aliasedLineWidthRange: [number, number];
  aliasedPointSizeRange: [number, number];
  maxCombinedTextureImageUnits: number;
  maxCubeMapTextureSize: number;
  maxTextureImageUnits: number;
  shadingLanguageVersion: string;
  version: string;
  antialias: boolean;
  extensions: string[];
}

export interface FontSpec {
  fonts: string[]; // OS-appropriate installed fonts (used for enumeration spoofing)
  // detection fonts measured via measureText to confirm presence — keep these consistent with OS
  detectionFonts: { family: string; present: boolean }[];
}

export interface MediaDevice {
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  deviceId: string; // hashed stable per profile
  groupId: string;
}

export interface SpeechVoice {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  voiceURI: string;
}

export interface PermissionState {
  name: string;
  state: 'granted' | 'denied' | 'prompt';
}

export interface GeolocationSpec {
  latitude: number;
  longitude: number;
  accuracy: number; // meters
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
}

export interface BatterySpec {
  charging: boolean;
  chargingTime: number; // seconds, 0 if charging else Infinity
  dischargingTime: number; // seconds, Infinity if charging
  level: number; // 0..1
}

export interface TimezoneSpec {
  id: string; // IANA tz, e.g. "America/New_York"
  offsetMinutes: number; // minutes east of UTC (negative for west) at "now"
  locale: string; // e.g. "en-US"
}

export interface WebRTCSpec {
  iceCandidatePolicy: 'default' | 'relay' | 'no-ice';
  forceRelay: boolean;
  mangleSDP: boolean;
  // fake local IP returned in ICE candidates
  fakeLocalIP: string;
}

export interface CanvasSpec {
  noiseSeed: number; // seeded PRNG → deterministic per-profile pixel noise
  noiseStrength: number; // per-channel delta magnitude
}

export interface AudioSpec {
  noiseSeed: number;
  sampleRate: number; // e.g. 44100 or 48000
  noiseStrength: number; // float domain perturbation magnitude
}

export interface MathSpec {
  // stable FP behavior; mathfingerprint must match claimed CPU class
  // we keep native math but pin performance.now resolution
  performanceNowResolutionMs: number;
}

export interface TLSFingerprint {
  // for uTLS ClientHello construction
  clientHelloId: string; // uTLS spec id, e.g. "HelloChrome_120"
  ja3: string; // expected JA3 hash (for validation)
  ja3Full: string; // full JA3 string
  ja4: string; // expected JA4 string
  cipherSuites: number[];
  extensions: number[];
  curves: number[];
  signatureAlgorithms: number[];
  alpn: string[];
}

export interface HTTP2Fingerprint {
  settings: { id: number; value: number }[];
  windowUpdate: number;
  headerOrder: string[];
  pseudoHeaderOrder: string[];
  priority: { streamId: number; weight: number; exclusive: boolean; depStreamId: number }[];
}

export interface HTTPHeaderSpec {
  // exact order + casing for HTTP/1.1 fallback
  order: string[];
  // per-header casing map
  casing: Record<string, string>;
}

export interface ProxySpec {
  type: 'http' | 'socks5' | 'direct';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface DeviceProfile {
  id: string;
  label: string;
  os: OS;
  osVersion: string;
  browser: Browser;
  browserVersion: string;

  userAgent: string;
  platform: string; // navigator.platform — matches os
  userAgentData: UserAgentData;
  languages: string[];
  timezone: TimezoneSpec;

  screen: ScreenSpec;
  window: WindowSpec;
  hardware: HardwareSpec;
  navigator: NavigatorSpec;
  gpu: GPUSpec;
  fonts: FontSpec;
  mediaDevices: MediaDevice[];
  speechVoices: SpeechVoice[];
  permissions: PermissionState[];
  geolocation: GeolocationSpec;
  battery: BatterySpec;
  webrtc: WebRTCSpec;
  canvas: CanvasSpec;
  audio: AudioSpec;
  math: MathSpec;

  // network layer
  tls: TLSFingerprint;
  http2: HTTP2Fingerprint;
  httpHeaders: HTTPHeaderSpec;
  proxy: ProxySpec | null;

  createdAt: string;
  updatedAt: string;
}

// Minimal fingerprint result returned by the API / read by detection suite
export interface FingerprintReadback {
  profileId: string;
  userAgent: string;
  platform: string;
  languages: string[];
  timezone: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  canvasHash: string; // sha256 of toDataURL output
  webglVendor: string;
  webglRenderer: string;
  audioHash: string;
  webrtcLocalIP: string;
}
