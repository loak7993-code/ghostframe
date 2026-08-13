// GhostFrame profile validator — coherence checks. Run: npx tsx scripts/validate-profiles.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = resolve(__dirname, '../data/profiles');

const REQUIRED_TOP: (keyof import('../src/types/profile.ts').DeviceProfile)[] = [
  'id', 'label', 'os', 'osVersion', 'browser', 'browserVersion', 'userAgent', 'platform',
  'userAgentData', 'languages', 'timezone', 'screen', 'window', 'hardware', 'navigator',
  'gpu', 'fonts', 'mediaDevices', 'speechVoices', 'permissions', 'geolocation', 'battery',
  'webrtc', 'canvas', 'audio', 'math', 'tls', 'http2', 'httpHeaders', 'proxy', 'createdAt', 'updatedAt',
];

const OS_PLATFORM: Record<string, string> = {
  windows: 'Win32', macos: 'MacIntel', linux: 'Linux x86_64', android: 'Linux armv8l', ios: 'iPhone',
};
const OS_UA_TOKEN: Record<string, string[]> = {
  windows: ['Windows NT'], macos: ['Macintosh', 'Mac OS X'], linux: ['Linux', 'X11'], android: ['Android'], ios: ['iPhone'],
};
const OS_GPU_BACKEND: Record<string, string[]> = {
  windows: ['Direct3D', 'D3D11'], macos: ['Metal', 'OpenGL'], linux: ['OpenGL', 'OpenGL ES'], android: ['OpenGL ES', 'Adreno'], ios: ['Metal', 'A16', 'Apple'],
};

interface CheckResult { profileId: string; errors: string[]; warnings: string[]; }

function checkProfile(p: any): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_TOP) {
    if (!(field in p)) errors.push(`missing top-level field "${field}"`);
  }
  if (errors.length) return { profileId: p.id ?? '<unknown>', errors, warnings };

  // platform matches os
  if (OS_PLATFORM[p.os] && p.platform !== OS_PLATFORM[p.os]) errors.push(`navigator.platform "${p.platform}" != expected "${OS_PLATFORM[p.os]}" for os "${p.os}"`);

  // userAgent contains browser name + OS token
  const ua = String(p.userAgent);
  const uaBrowser: Record<string, string> = { chrome: 'Chrome', firefox: 'Firefox', safari: 'Safari', edge: 'Edg' };
  if (!ua.includes(uaBrowser[p.browser])) errors.push(`userAgent missing browser token "${uaBrowser[p.browser]}"`);
  const osTokens = OS_UA_TOKEN[p.os] || [];
  if (!osTokens.some((t) => ua.includes(t))) errors.push(`userAgent missing OS token for "${p.os}" (expected one of ${osTokens.join('/')})`);

  // userAgentData.platform matches os
  const uadPlat: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS' };
  if (p.userAgentData && p.userAgentData.platform !== uadPlat[p.os]) errors.push(`userAgentData.platform "${p.userAgentData?.platform}" != expected "${uadPlat[p.os]}"`);

  // userAgentData.brands contains browser
  const brandMap: Record<string, string> = { chrome: 'Google Chrome', firefox: 'Firefox', safari: 'Safari', edge: 'Microsoft Edge' };
  const brands = (p.userAgentData?.brands || []).map((b: any) => b.brand);
  if (!brands.includes(brandMap[p.browser])) errors.push(`userAgentData.brands missing "${brandMap[p.browser]}" (has ${brands.join(',')})`);

  // timezone.locale === languages[0]
  if (p.timezone?.locale !== p.languages?.[0]) errors.push(`timezone.locale "${p.timezone?.locale}" != languages[0] "${p.languages?.[0]}"`);

  // gpu.unmaskedRenderer contains OS-appropriate backend
  const backends = OS_GPU_BACKEND[p.os] || [];
  if (backends.length && !backends.some((b) => String(p.gpu?.unmaskedRenderer).includes(b))) {
    errors.push(`gpu.unmaskedRenderer "${p.gpu?.unmaskedRenderer}" lacks OS-appropriate backend (expected one of ${backends.join('/')})`);
  }

  // mobile coherence
  if (p.os === 'android' || p.os === 'ios') {
    if (p.userAgentData?.mobile !== true) errors.push(`mobile OS but userAgentData.mobile is ${p.userAgentData?.mobile} (expected true)`);
    if (p.navigator?.maxTouchPoints <= 0) errors.push(`mobile OS but maxTouchPoints is ${p.navigator?.maxTouchPoints} (expected >0)`);
  } else {
    if (p.userAgentData?.mobile === true) errors.push(`desktop OS but userAgentData.mobile is true`);
  }

  // webdriver MUST be false
  if (p.navigator?.webdriver !== false) errors.push(`navigator.webdriver is ${p.navigator?.webdriver} (MUST be false)`);

  // tls.ja3 === md5(ja3Full)
  if (p.tls?.ja3Full && p.tls?.ja3) {
    const computed = createHash('md5').update(p.tls.ja3Full).digest('hex');
    if (p.tls.ja3 !== computed) errors.push(`tls.ja3 "${p.tls.ja3}" != md5(ja3Full) "${computed}"`);
  } else {
    errors.push(`tls.ja3 or tls.ja3Full missing`);
  }

  // warnings: detection fonts presence sanity
  const detFonts = p.fonts?.detectionFonts || [];
  for (const df of detFonts) {
    if (df.present && !(p.fonts?.fonts || []).includes(df.family)) {
      warnings.push(`detection font "${df.family}" marked present but not in fonts list`);
    }
  }

  return { profileId: p.id, errors, warnings };
}

function main() {
  if (!existsSync(PROFILES_DIR)) {
    console.error(`profiles dir not found: ${PROFILES_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No profiles found.');
    process.exit(0);
  }

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;
  for (const file of files) {
    const path = resolve(PROFILES_DIR, file);
    let p: any;
    try {
      p = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e: any) {
      console.log(`FAIL: ${file} — invalid JSON: ${e.message}`);
      failCount++;
      continue;
    }
    const result = checkProfile(p);
    if (result.errors.length === 0) {
      const w = result.warnings.length ? ` (warnings: ${result.warnings.join('; ')})` : '';
      console.log(`PASS: ${result.profileId}${w}`);
      passCount++;
      if (result.warnings.length) warnCount++;
    } else {
      console.log(`FAIL: ${result.profileId} — ${result.errors.join('; ')}`);
      failCount++;
    }
  }

  console.log(`\n${passCount} passed, ${failCount} failed, ${warnCount} with warnings (of ${files.length} profiles)`);
  process.exit(failCount === 0 ? 0 : 1);
}

main();
