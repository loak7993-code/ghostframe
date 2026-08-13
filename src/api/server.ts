// GhostFrame Stage 7 — REST API (Fastify). Integrates ProfileManager + launcher + readFingerprint
// with live browser session management. Auth: x-api-key header.
// Run: npm run api   (env: GHOSTFRAME_API_KEY, GHOSTFRAME_API_PORT)

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launchProfile, readFingerprint, close, type LaunchOptions } from '../browser/launcher.js';
import { ProfileManager } from '../profile/manager.js';
import { ProxyManager } from '../proxy/manager.js';
import type { DeviceProfile } from '../types/profile.js';
import type { BrowserContext } from 'playwright';

interface Session {
  id: string;
  profile: DeviceProfile;
  context: BrowserContext;
  launchedAt: string;
  headless: boolean;
  proxy?: { server: string; username?: string };
}

const sessions = new Map<string, Session>();

const GHOST_HOME = join(homedir(), '.ghostframe');
const KEY_FILE = join(GHOST_HOME, 'api-key');

function loadApiKey(): string {
  if (process.env.GHOSTFRAME_API_KEY) return process.env.GHOSTFRAME_API_KEY;
  try {
    if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim();
  } catch {}
  const key = randomBytes(24).toString('hex');
  try {
    mkdirSync(GHOST_HOME, { recursive: true });
    writeFileSync(KEY_FILE, key, { mode: 0o600 });
  } catch {}
  return key;
}

const API_KEY = loadApiKey();
const PORT = Number(process.env.GHOSTFRAME_API_PORT || 8420);

const profileManager = new ProfileManager();
const proxyManager = new ProxyManager();

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  // auth hook — everything except /health requires the key
  app.addHook('onRequest', async (req: FastifyRequest, reply) => {
    if (req.url === '/health') return;
    const key = (req.headers['x-api-key'] as string | undefined) || '';
    if (!API_KEY || key !== API_KEY) {
      return reply.code(401).send({ error: 'unauthorized: bad or missing x-api-key' });
    }
  });

  // ---- health ----
  app.get('/health', async () => ({ ok: true, service: 'ghostframe', sessions: sessions.size, profilesDirReady: true }));

  // ---- profiles ----
  app.get('/profiles', async () => {
    const profiles = await profileManager.listProfiles();
    return {
      count: profiles.length,
      profiles: profiles.map((p) => ({
        id: p.id, label: p.label, os: p.os, osVersion: p.osVersion,
        browser: p.browser, browserVersion: p.browserVersion,
        userAgent: p.userAgent, timezone: p.timezone.id,
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/profiles/:id', async (req, reply) => {
    const p = await profileManager.getProfile(req.params.id);
    if (!p) return reply.code(404).send({ error: 'profile not found' });
    return p;
  });

  app.post<{ Body: Partial<DeviceProfile> }>('/profiles', async (req, reply) => {
    const body = (req.body ?? {}) as Partial<DeviceProfile>;
    const created = await profileManager.createProfile(body);
    return reply.code(201).send(created);
  });

  app.delete<{ Params: { id: string } }>('/profiles/:id', async (req, reply) => {
    const ok = await profileManager.deleteProfile(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'profile not found' });
    return { ok: true, id: req.params.id };
  });

  // one-shot fingerprint: launch headless, read, close
  app.get<{ Params: { id: string } }>('/profiles/:id/fingerprint', async (req, reply) => {
    const p = await profileManager.getProfile(req.params.id);
    if (!p) return reply.code(404).send({ error: 'profile not found' });
    const query = req.query as Record<string, string>;
    const opts: LaunchOptions = { headless: true, useGhostProxy: query.ghostproxy !== 'false' };
    if (query.proxy) opts.proxyOverride = query.proxy;
    let session: Awaited<ReturnType<typeof launchProfile>> | null = null;
    try {
      session = await launchProfile(p, opts);
      const rb = await readFingerprint(session.context, p);
      return rb;
    } catch (e) {
      return reply.code(500).send({ error: 'fingerprint failed', detail: String(e) });
    } finally {
      if (session) await close(session.context).catch(() => {});
    }
  });

  // ---- sessions ----
  app.post<{ Body: { profileId: string; headless?: boolean; useGhostProxy?: boolean; proxyOverride?: string } }>(
    '/sessions',
    async (req, reply) => {
      const { profileId, headless = false, useGhostProxy = true, proxyOverride } = req.body ?? {};
      const p = await profileManager.getProfile(profileId);
      if (!p) return reply.code(404).send({ error: 'profile not found' });
      const opts: LaunchOptions = { headless, useGhostProxy };
      if (proxyOverride) opts.proxyOverride = proxyOverride;
      try {
        const result = await launchProfile(p, opts);
        const id = 'sess_' + randomBytes(8).toString('hex');
        sessions.set(id, { id, profile: p, context: result.context, launchedAt: new Date().toISOString(), headless, proxy: result.proxy ? { server: result.proxy.server, username: result.proxy.username } : undefined });
        return reply.code(201).send({ sessionId: id, profileId: p.id, label: p.label, os: p.os, browser: p.browser, proxy: result.proxy?.server ?? 'direct', headless });
      } catch (e) {
        return reply.code(500).send({ error: 'launch failed', detail: String(e) });
      }
    },
  );

  app.get('/sessions', async () => ({
    count: sessions.size,
    sessions: Array.from(sessions.values()).map((s) => ({
      id: s.id, profileId: s.profile.id, label: s.profile.label, os: s.profile.os,
      browser: s.profile.browser, launchedAt: s.launchedAt, headless: s.headless, proxy: s.proxy?.server ?? 'direct',
    })),
  }));

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = sessions.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'session not found' });
    return { id: s.id, profileId: s.profile.id, label: s.profile.label, os: s.profile.os, browser: s.profile.browser, launchedAt: s.launchedAt, headless: s.headless, proxy: s.proxy?.server ?? 'direct' };
  });

  app.post<{ Params: { id: string }; Body: { url: string } }>('/sessions/:id/navigate', async (req, reply) => {
    const s = sessions.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'session not found' });
    const url = (req.body?.url || '').trim();
    if (!url) return reply.code(400).send({ error: 'url required' });
    try {
      const page = s.context.pages()[0] ?? (await s.context.newPage());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const title = await page.title();
      return { ok: true, url: page.url(), title };
    } catch (e) {
      return reply.code(500).send({ error: 'navigate failed', detail: String(e) });
    }
  });

  app.get<{ Params: { id: string } }>('/sessions/:id/fingerprint', async (req, reply) => {
    const s = sessions.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'session not found' });
    try {
      const rb = await readFingerprint(s.context, s.profile);
      return rb;
    } catch (e) {
      return reply.code(500).send({ error: 'fingerprint failed', detail: String(e) });
    }
  });

  app.delete<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const s = sessions.get(req.params.id);
    if (!s) return reply.code(404).send({ error: 'session not found' });
    sessions.delete(req.params.id);
    await close(s.context).catch(() => {});
    return { ok: true, id: req.params.id };
  });

  // ---- proxy ----
  app.get('/proxy/pool', async () => {
    const pool = await proxyManager.loadPool();
    return { count: pool.length, pool };
  });

  app.post<{ Body: { url: string } }>('/proxy/pool', async (req, reply) => {
    const url = (req.body?.url || '').trim();
    if (!url) return reply.code(400).send({ error: 'url required' });
    await proxyManager.addProxy(url);
    return reply.code(201).send({ ok: true, added: url });
  });

  app.get<{ Params: { id: string } }>('/proxy/check/:id', async (req, reply) => {
    const p = await profileManager.getProfile(req.params.id);
    if (!p) return reply.code(404).send({ error: 'profile not found' });
    const cfg = proxyManager.configFromProfile(p);
    if (!cfg) return { profileId: p.id, proxy: 'direct', reachable: null };
    const ok = await proxyManager.checkProxy(cfg);
    return { profileId: p.id, proxy: cfg.server, reachable: ok };
  });

  app.addHook('onClose', async () => {
    for (const s of sessions.values()) await close(s.context).catch(() => {});
    sessions.clear();
  });

  return app;
}

const isMain = /api[/\\]server\.(js|ts)$/.test(process.argv[1] ?? '');

if (isMain || process.env.GHOSTFRAME_API_AUTOSTART === '1') {
  const app = buildServer();
  app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`GhostFrame API listening on ${address}`);
    console.log(`API key: ${API_KEY}`);
    console.log(`(persisted at ${KEY_FILE})`);
  });
}
