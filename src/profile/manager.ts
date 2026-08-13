import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DeviceProfile } from '../types/profile.js';
import { buildDefaultProfile } from './defaults.js';
import { profilesDir, profilesStateDir } from '../paths.js';

export class ProfileManager {
  constructor(
    private readonly dir: string = profilesDir,
    private readonly stateDir: string = profilesStateDir,
  ) {}

  async listProfiles(): Promise<DeviceProfile[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.dir);
    } catch (e) {
      if (isErrno(e) && e.code === 'ENOENT') return [];
      throw e;
    }
    const profiles: DeviceProfile[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const full = join(this.dir, entry);
      try {
        const data = await fs.readFile(full, 'utf8');
        const parsed = JSON.parse(data) as DeviceProfile;
        if (parsed && typeof parsed.id === 'string') profiles.push(parsed);
      } catch {
        // skip malformed files
      }
    }
    return profiles.sort((a, b) => a.label.localeCompare(b.label));
  }

  async getProfile(id: string): Promise<DeviceProfile | undefined> {
    const full = join(this.dir, `${id}.json`);
    try {
      const data = await fs.readFile(full, 'utf8');
      return JSON.parse(data) as DeviceProfile;
    } catch (e) {
      if (isErrno(e) && e.code === 'ENOENT') return undefined;
      throw e;
    }
  }

  async createProfile(partial: Partial<DeviceProfile> = {}): Promise<DeviceProfile> {
    const id = partial.id && partial.id.length > 0 ? partial.id : generateId();
    const now = new Date().toISOString();
    const profile = buildDefaultProfile({
      ...partial,
      id,
      label: partial.label && partial.label.length > 0 ? partial.label : `GhostFrame ${id}`,
      createdAt: partial.createdAt && partial.createdAt.length > 0 ? partial.createdAt : now,
      updatedAt: now,
    });
    await this.saveProfile(profile);
    return profile;
  }

  async saveProfile(profile: DeviceProfile): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const full = join(this.dir, `${profile.id}.json`);
    await fs.writeFile(full, JSON.stringify(profile, null, 2), 'utf8');
  }

  async deleteProfile(id: string): Promise<boolean> {
    const full = join(this.dir, `${id}.json`);
    try {
      await fs.unlink(full);
      return true;
    } catch (e) {
      if (isErrno(e) && e.code === 'ENOENT') return false;
      throw e;
    }
  }

  userDataDir(id: string): string {
    return join(this.stateDir, id);
  }
}

export function generateId(): string {
  return 'gf_' + randomUUID().replace(/-/g, '').slice(0, 12);
}

function isErrno(e: unknown): e is NodeJS.ErrnoException {
  return typeof e === 'object' && e !== null && 'code' in e;
}
