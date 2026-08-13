// Permissions API spoofing — query() returns profile states.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative, hardenFn, type AnyFn } from './harden.js';

const g = globalThis as any;

function buildPermissionStatus(name: string, state: string): any {
  const handlers: Record<string, AnyFn[]> = {};
  const obj: any = {
    name,
    state,
    onchange: null,
  };
  const addEventListener = function (type: string, fn: AnyFn): void {
    (handlers[type] = handlers[type] || []).push(fn);
  };
  const removeEventListener = function (type: string, fn: AnyFn): void {
    if (handlers[type]) {
      handlers[type] = handlers[type].filter((h) => h !== fn);
    }
  };
  const dispatchEvent = function (): boolean {
    return true;
  };
  obj.addEventListener = hardenFn(addEventListener, 'addEventListener');
  obj.removeEventListener = hardenFn(removeEventListener, 'removeEventListener');
  obj.dispatchEvent = hardenFn(dispatchEvent, 'dispatchEvent');
  return obj;
}

export function spoofPermissions(profile: DeviceProfile): void {
  const proto = g.Permissions ? g.Permissions.prototype : null;

  const map = new Map<string, string>();
  for (const p of profile.permissions) {
    map.set(p.name, p.state);
  }

  // Coherence with the REAL "denied"-by-default headless Permission surface:
  // Notification.permission must agree with Permissions.query('notifications').
  // Real desktop browser with never-decided setting: Notification.permission === 'default'.
  if (g.Notification && map.has('notifications')) {
    const state = map.get('notifications')!; // granted | denied | prompt
    const notifPerm = state === 'prompt' ? 'default' : state;
    try {
      Object.defineProperty(g.Notification, 'permission', {
        get: hardenFn(function (): string { return notifPerm; }, 'permission'),
        configurable: true,
        enumerable: true,
      });
    } catch {
      /* ignore */
    }
  }

  if (!proto) return;

  const impl = function (this: any, desc: any): Promise<any> {
    const name = desc && desc.name ? String(desc.name) : '';
    const state = map.has(name) ? map.get(name)! : 'prompt';
    return Promise.resolve(buildPermissionStatus(name, state));
  };
  wrapNative(proto, 'query', impl, 'query');
}
