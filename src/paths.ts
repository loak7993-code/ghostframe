import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

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

const here = dirname(fileURLToPath(import.meta.url));

export const projectRoot: string = findProjectRoot(here);

export const profilesDir: string = join(projectRoot, 'data', 'profiles');
export const profilesStateDir: string = join(projectRoot, 'profiles-state');
export const proxiesFile: string = join(projectRoot, 'data', 'proxies.txt');
export const injectScriptPath: string = join(projectRoot, 'dist', 'inject.js');
export const dataDir: string = join(projectRoot, 'data');

export const ghostProxyHost = '127.0.0.1';
export const ghostProxyPort = 8421;
export const ghostProxyServer = `http://${ghostProxyHost}:${ghostProxyPort}`;

export const ghostProxyBinaryCandidates: string[] = [
  join(projectRoot, 'netlayer', 'ghostproxy'),
  join(projectRoot, 'netlayer', 'ghostproxy.exe'),
  process.env.GHOSTPROXY_PATH ?? '',
].filter(Boolean);
