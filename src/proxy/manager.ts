import { promises as fs } from 'node:fs';
import net from 'node:net';
import { URL } from 'node:url';
import { dirname } from 'node:path';
import type { DeviceProfile, ProxySpec } from '../types/profile.js';
import { ProfileManager } from '../profile/manager.js';
import {
  proxiesFile,
  ghostProxyServer,
  ghostProxyHost,
  ghostProxyPort,
} from '../paths.js';

export interface PlaywrightProxyConfig {
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
}

export class ProxyManager {
  private readonly dead = new Set<string>();

  constructor(
    private readonly poolFile: string = proxiesFile,
    private readonly profiles: ProfileManager = new ProfileManager(),
  ) {}

  async getProxyForProfile(
    id: string,
    opts: { autoRotate?: boolean } = {},
  ): Promise<PlaywrightProxyConfig | undefined> {
    const profile = await this.profiles.getProfile(id);
    if (!profile) return undefined;
    const cfg = this.configFromProfile(profile);
    if (cfg) return cfg;
    if (profile.proxy && profile.proxy.type !== 'direct' && opts.autoRotate) {
      return this.rotateProxy(id);
    }
    return undefined;
  }

  configFromProfile(profile: DeviceProfile): PlaywrightProxyConfig | undefined {
    const p = profile.proxy;
    if (!p || p.type === 'direct') return undefined;
    const server = `${p.type}://${p.host}:${p.port}`;
    if (this.dead.has(server)) return undefined;
    return { server, username: p.username, password: p.password };
  }

  ghostProxyConfig(): PlaywrightProxyConfig {
    return { server: ghostProxyServer };
  }

  async rotateProxy(id: string): Promise<PlaywrightProxyConfig | undefined> {
    const pool = await this.loadPool();
    const profile = await this.profiles.getProfile(id);
    if (!profile || pool.length === 0) return undefined;

    const current = profile.proxy;
    let chosen: ProxySpec | undefined;

    for (const cand of pool) {
      if (current && cand.host === current.host && cand.port === current.port) continue;
      const server = `${cand.type}://${cand.host}:${cand.port}`;
      if (this.dead.has(server)) continue;
      if (await this.checkProxy(cand)) {
        chosen = cand;
        break;
      }
      this.markDead(server);
    }

    if (!chosen) {
      chosen = pool.find((c) => !this.dead.has(`${c.type}://${c.host}:${c.port}`));
    }
    if (!chosen) return undefined;

    profile.proxy = chosen;
    profile.updatedAt = new Date().toISOString();
    await this.profiles.saveProfile(profile);
    return this.configFromProfile(profile);
  }

  async loadPool(): Promise<ProxySpec[]> {
    let text: string;
    try {
      text = await fs.readFile(this.poolFile, 'utf8');
    } catch (e) {
      if (isErrno(e) && e.code === 'ENOENT') return [];
      throw e;
    }
    const out: ProxySpec[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const spec = parseProxyUrl(line);
      if (spec) out.push(spec);
    }
    return out;
  }

  async addProxy(url: string): Promise<ProxySpec> {
    const spec = parseProxyUrl(url);
    if (!spec) throw new Error(`Invalid proxy URL: ${url}`);
    await fs.mkdir(dirname(this.poolFile), { recursive: true });
    let existing = '';
    try {
      existing = await fs.readFile(this.poolFile, 'utf8');
    } catch {}
    const sep = existing && !existing.endsWith('\n') ? '\n' : '';
    await fs.appendFile(this.poolFile, `${sep}${url}\n`, 'utf8');
    return spec;
  }

  async checkProxy(proxy: ProxySpec | PlaywrightProxyConfig): Promise<boolean> {
    let host: string;
    let port: number;
    if ('host' in proxy) {
      host = proxy.host;
      port = proxy.port;
    } else {
      let u: URL;
      try {
        u = new URL(proxy.server);
      } catch {
        return false;
      }
      host = u.hostname;
      const explicit = Number(u.port);
      port = Number.isFinite(explicit) && explicit > 0 ? explicit : u.protocol === 'https:' ? 443 : 80;
    }
    return tcpReachable(host, port, 5000);
  }

  markDead(server: string): void {
    this.dead.add(server);
  }

  markAlive(server: string): void {
    this.dead.delete(server);
  }

  isDead(server: string): boolean {
    return this.dead.has(server);
  }
}

export function parseProxyUrl(url: string): ProxySpec | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const proto = u.protocol.replace(/:$/, '');
  let type: ProxySpec['type'];
  if (proto === 'http' || proto === 'https') type = 'http';
  else if (proto === 'socks5' || proto === 'socks5h') type = 'socks5';
  else return undefined;
  if (!u.hostname || !u.port) return undefined;
  return {
    type,
    host: u.hostname,
    port: Number(u.port),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
  };
}

function tcpReachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {}
      resolve(ok);
    };
    const sock = net.createConnection({ host, port });
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.once('connect', () => {
      clearTimeout(timer);
      done(true);
    });
    sock.once('error', () => {
      clearTimeout(timer);
      done(false);
    });
  });
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}

export { ghostProxyHost, ghostProxyPort };
