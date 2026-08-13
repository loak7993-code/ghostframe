import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { resolve, isAbsolute, join } from 'node:path';
import { ProfileManager } from '../profile/manager.js';
import { ProxyManager, parseProxyUrl } from '../proxy/manager.js';
import {
  launchProfile,
  readFingerprint,
  close,
  readInjectScript,
} from '../browser/launcher.js';
import {
  ghostProxyBinaryCandidates,
  ghostProxyHost,
  ghostProxyPort,
  profilesDir,
} from '../paths.js';
import type { DeviceProfile, OS, Browser } from '../types/profile.js';

const profiles = new ProfileManager();
const proxies = new ProxyManager();

interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
      } else {
        flags[name] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function flagString(flags: ParsedArgs['flags'], name: string): string | undefined {
  const v = flags[name];
  if (v === undefined || typeof v === 'boolean') return undefined;
  return v;
}

function flagBool(flags: ParsedArgs['flags'], name: string): boolean {
  return flags[name] === true || typeof flags[name] === 'string';
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printUsage();
    return sub ? 0 : 1;
  }

  try {
    switch (sub) {
      case 'profile':
        return await cmdProfile(rest);
      case 'launch':
        return await cmdLaunch(rest);
      case 'fingerprint':
        return await cmdFingerprint(rest);
      case 'proxy':
        return await cmdProxy(rest);
      default:
        console.error(`Unknown subcommand: ${sub}`);
        printUsage();
        return 1;
    }
  } catch (e) {
    console.error(e instanceof Error ? `error: ${e.message}` : String(e));
    return 1;
  }
}

function printUsage(): void {
  console.error(`usage: ghostframe <command> [args]

commands:
  profile list                       list all profiles
  profile show <id>                  print a profile as JSON
  profile create [--from <path>]     create a profile (from JSON file or interactive)
            [--label <l>] [--os <os>] [--browser <b>]
  profile delete <id>                delete a profile
  launch <id> [--headless] [--proxy <url>] [--no-ghostproxy]
                                     launch a profile's browser (blocks until closed)
  fingerprint <id>                   launch headless, read fingerprint, print JSON, exit
  proxy list                         list the proxy pool
  proxy add <url>                    add a proxy to the pool
  proxy check [url]                  health-check a proxy URL or all proxies in the pool`);
}

async function cmdProfile(args: string[]): Promise<number> {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case 'list':
      return profileList();
    case 'show': {
      const id = rest[0];
      if (!id) { console.error('usage: profile show <id>'); return 1; }
      return profileShow(id);
    }
    case 'create':
      return profileCreate(rest);
    case 'delete': {
      const id = rest[0];
      if (!id) { console.error('usage: profile delete <id>'); return 1; }
      return profileDelete(id);
    }
    default:
      console.error(`unknown profile action: ${action ?? '(none)'}`);
      return 1;
  }
}

async function profileList(): Promise<number> {
  const list = await profiles.listProfiles();
  if (list.length === 0) {
    console.log('No profiles found');
    return 0;
  }
  const rows = list.map((p) => ({
    id: p.id,
    label: p.label,
    os: p.os,
    browser: p.browser,
    browserVersion: p.browserVersion,
  }));
  console.table(rows);
  return 0;
}

async function profileShow(id: string): Promise<number> {
  const p = await profiles.getProfile(id);
  if (!p) {
    console.error(`profile not found: ${id}`);
    return 1;
  }
  console.log(JSON.stringify(p, null, 2));
  return 0;
}

async function profileCreate(rest: string[]): Promise<number> {
  const parsed = parseArgs(rest);
  const from = flagString(parsed.flags, 'from');
  const label = flagString(parsed.flags, 'label');
  const os = flagString(parsed.flags, 'os');
  const browser = flagString(parsed.flags, 'browser');

  let partial: Partial<DeviceProfile>;

  if (from) {
    const path = isAbsolute(from) ? from : resolve(process.cwd(), from);
    if (!existsSync(path)) {
      console.error(`file not found: ${path}`);
      return 1;
    }
    const { readFileSync } = await import('node:fs');
    try {
      partial = JSON.parse(readFileSync(path, 'utf8')) as Partial<DeviceProfile>;
    } catch (e) {
      console.error(`failed to parse JSON: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    const interactive = process.stdin.isTTY && !process.env.CI;
    const lbl = label ?? (interactive ? await prompt('label', 'GhostFrame Profile') : 'GhostFrame Profile');
    const osv = (os ?? (interactive ? await prompt('os (windows|macos|linux|android|ios)', 'windows') : 'windows')) as OS;
    const brw = (browser ?? (interactive ? await prompt('browser (chrome|firefox|safari|edge)', 'chrome') : 'chrome')) as Browser;
    partial = { label: lbl, os: osv, browser: brw };
  }

  if (label) partial.label = label;
  if (os) partial.os = os as OS;
  if (browser) partial.browser = browser as Browser;

  const created = await profiles.createProfile(partial);
  console.log(`created profile ${created.id} (${created.label})`);
  console.log(`  os=${created.os} browser=${created.browser} ${created.browserVersion}`);
  console.log(`  userAgent=${created.userAgent}`);
  return 0;
}

async function profileDelete(id: string): Promise<number> {
  const removed = await profiles.deleteProfile(id);
  if (!removed) {
    console.error(`profile not found: ${id}`);
    return 1;
  }
  console.log(`deleted profile ${id}`);
  return 0;
}

async function cmdLaunch(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) { console.error('usage: launch <id>'); return 1; }
  const parsed = parseArgs(args.slice(1));
  const headless = flagBool(parsed.flags, 'headless');
  const proxyOverride = flagString(parsed.flags, 'proxy');
  const noGhost = flagBool(parsed.flags, 'no-ghostproxy');

  const profile = await profiles.getProfile(id);
  if (!profile) {
    console.error(`profile not found: ${id}`);
    return 1;
  }

  let useGhost: boolean;
  let ghostProc: ChildProcess | undefined;
  if (noGhost) {
    useGhost = false;
  } else {
    const ghost = await ensureGhostProxy(id);
    if (ghost === undefined) {
      console.error('warning: ghostproxy not available; falling back to direct routing');
      useGhost = false;
    } else if (ghost === 'external') {
      console.error('note: reusing existing ghostproxy on 127.0.0.1:8421 (may be configured for another profile)');
      useGhost = true;
    } else {
      ghostProc = ghost;
      useGhost = true;
    }
  }

  const launch = await launchProfile(profile, {
    headless,
    proxyOverride,
    useGhostProxy: useGhost,
  });

  const proxyInfo = launch.proxy ? ` via proxy ${launch.proxy.server}` : ' (direct)';
  console.error(`launched ${profile.id} (${profile.label})${proxyInfo}`);

  const closing = new Promise<void>((resolveClose) => {
    launch.context.on('close', () => resolveClose());
  });

  const sigHandler = async () => {
    await close(launch.context).catch(() => {});
    if (ghostProc) ghostProc.kill('SIGTERM');
    process.exit(130);
  };
  process.once('SIGINT', sigHandler);
  process.once('SIGTERM', sigHandler);

  await closing;
  if (ghostProc) ghostProc.kill('SIGTERM');
  console.error('browser closed');
  return 0;
}

async function cmdFingerprint(args: string[]): Promise<number> {
  const id = args[0];
  if (!id) { console.error('usage: fingerprint <id>'); return 1; }

  const profile = await profiles.getProfile(id);
  if (!profile) {
    console.error(`profile not found: ${id}`);
    return 1;
  }

  try {
    readInjectScript();
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  let launch;
  try {
    launch = await launchProfile(profile, {
      headless: true,
      useGhostProxy: false,
    });
  } catch (e) {
    console.error(
      `failed to launch browser: ${e instanceof Error ? e.message : String(e)}\n` +
        'ensure playwright browsers are installed: npx playwright install chromium',
    );
    return 1;
  }

  try {
    const fp = await readFingerprint(launch.context, profile);
    console.log(JSON.stringify(fp, null, 2));
    return 0;
  } finally {
    await close(launch.context).catch(() => {});
  }
}

async function cmdProxy(args: string[]): Promise<number> {
  const action = args[0];
  const rest = args.slice(1);
  switch (action) {
    case 'list':
      return proxyList();
    case 'add': {
      const url = rest[0];
      if (!url) { console.error('usage: proxy add <url>'); return 1; }
      return proxyAdd(url);
    }
    case 'check':
      return proxyCheck(rest[0]);
    default:
      console.error(`unknown proxy action: ${action ?? '(none)'}`);
      return 1;
  }
}

async function proxyList(): Promise<number> {
  const pool = await proxies.loadPool();
  if (pool.length === 0) {
    console.log('proxy pool is empty');
    return 0;
  }
  const rows = pool.map((p) => ({
    server: `${p.type}://${p.host}:${p.port}`,
    type: p.type,
    host: p.host,
    port: p.port,
    auth: p.username ? `${p.username}` : '-',
    dead: proxies.isDead(`${p.type}://${p.host}:${p.port}`),
  }));
  console.table(rows);
  return 0;
}

async function proxyAdd(url: string): Promise<number> {
  try {
    const spec = await proxies.addProxy(url);
    console.log(`added ${spec.type}://${spec.host}:${spec.port}`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

async function proxyCheck(url?: string): Promise<number> {
  if (url) {
    const spec = parseProxyUrl(url);
    if (!spec) {
      console.error(`invalid proxy URL: ${url}`);
      return 1;
    }
    const ok = await proxies.checkProxy(spec);
    console.log(`${url}: ${ok ? 'alive' : 'dead'}`);
    return ok ? 0 : 1;
  }
  const pool = await proxies.loadPool();
  if (pool.length === 0) {
    console.log('proxy pool is empty');
    return 0;
  }
  let aliveCount = 0;
  for (const p of pool) {
    const server = `${p.type}://${p.host}:${p.port}`;
    const ok = await proxies.checkProxy(p);
    if (ok) { aliveCount++; proxies.markAlive(server); }
    else proxies.markDead(server);
    console.log(`${server}: ${ok ? 'alive' : 'dead'}`);
  }
  console.log(`${aliveCount}/${pool.length} alive`);
  return aliveCount > 0 ? 0 : 1;
}

async function ensureGhostProxy(
  profileId: string,
): Promise<ChildProcess | 'external' | undefined> {
  const bin = ghostProxyBinaryCandidates.find((p) => existsSync(p));

  if (await portReachable(ghostProxyHost, ghostProxyPort, 300)) {
    return 'external';
  }

  if (!bin) return undefined;

  const profilePath = join(profilesDir, `${profileId}.json`);
  if (!existsSync(profilePath)) return undefined;

  return new Promise<ChildProcess | undefined>((resolveSpawn) => {
    let proc: ChildProcess;
    try {
      proc = spawn(bin, ['-profile', profilePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      return resolveSpawn(undefined);
    }

    let settled = false;
    const finish = (result: ChildProcess | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveSpawn(result);
    };

    proc.on('error', () => finish(undefined));
    proc.on('exit', () => finish(undefined));
    proc.stderr?.on('data', (d) => process.stderr.write(`[ghostproxy] ${d}`));

    const timer = setTimeout(() => {
      if (!settled) {
        try { proc.kill('SIGTERM'); } catch {}
        finish(undefined);
      }
    }, 5000);

    let tries = 0;
    const probe = () => {
      if (settled) return;
      const sock = new net.Socket();
      sock.setTimeout(300);
      sock.once('connect', () => {
        sock.destroy();
        finish(proc);
      });
      sock.once('error', () => {
        sock.destroy();
        if (!settled && ++tries < 40) setTimeout(probe, 125);
      });
      sock.once('timeout', () => {
        sock.destroy();
        if (!settled && ++tries < 40) setTimeout(probe, 125);
      });
      sock.connect(ghostProxyPort, ghostProxyHost);
    };
    probe();
  });
}

function portReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(timeoutMs);
    let done = false;
    const settle = (ok: boolean) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve(ok);
    };
    sock.once('connect', () => settle(true));
    sock.once('error', () => settle(false));
    sock.once('timeout', () => settle(false));
    sock.connect(port, host);
  });
}

function prompt(field: string, def: string): Promise<string> {
  return new Promise((resolveP) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${field} [${def}]: `, (ans) => {
      rl.close();
      resolveP(ans.trim().length > 0 ? ans.trim() : def);
    });
  });
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
