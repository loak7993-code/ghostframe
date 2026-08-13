import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

function findProjectRoot(fromDir: string): string {
  let dir = fromDir;
  for (let i = 0; i < 24; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg && pkg.name === 'ghostframe') return dir;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromDir;
}

function resolveProjectRoot(): string {
  // 1) explicit override (packaged app sets this before loading the bundle)
  if (process.env.GHOSTFRAME_PROJECT_ROOT) return process.env.GHOSTFRAME_PROJECT_ROOT;
  // 2) walk from the current working directory (CLI usage / packaged app)
  const fromCwd = findProjectRoot(process.cwd());
  if (existsSync(join(fromCwd, 'src')) || existsSync(join(fromCwd, 'package.json'))) return fromCwd;
  // 3) walk from the CJS bundle location if available, else the TS module location
  try {
    const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath((import.meta as any).url));
    return findProjectRoot(here);
  } catch {
    try {
      return findProjectRoot(dirname(fileURLToPath((import.meta as any).url)));
    } catch {
      return process.cwd();
    }
  }
}

const projectRoot: string = resolveProjectRoot();

// The packaged Electron app can't write into its install dir: GHOSTFRAME_STATE_DIR
// relocates writable state into the OS user-data dir (set by the GUI setup).
export { projectRoot };
export const dataRoot: string = process.env.GHOSTFRAME_DATA_ROOT || projectRoot;

export const profilesDir: string = process.env.GHOSTFRAME_PROFILES_DIR || join(dataRoot, 'data', 'profiles');
export const profilesStateDir: string = process.env.GHOSTFRAME_STATE_DIR || join(dataRoot, 'profiles-state');
export const proxiesFile: string = process.env.GHOSTFRAME_STATE_DIR
  ? join(profilesStateDir, 'proxies.txt')
  : join(dataRoot, 'data', 'proxies.txt');
export const injectScriptPath: string = process.env.GHOSTFRAME_INJECT_SOURCE || join(dataRoot, 'dist', 'inject.js');
export const dataDir: string = join(dataRoot, 'data');

export const ghostProxyHost = '127.0.0.1';
export const ghostProxyPort = 8421;
export const ghostProxyServer = `http://${ghostProxyHost}:${ghostProxyPort}`;

export const ghostProxyBinaryCandidates: string[] = [
  join(dataRoot, 'netlayer', 'ghostproxy'),
  join(dataRoot, 'netlayer', 'ghostproxy.exe'),
  process.env.GHOSTPROXY_PATH ?? '',
].filter(Boolean);
