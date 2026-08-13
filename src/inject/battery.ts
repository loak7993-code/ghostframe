// Battery API spoofing — navigator.getBattery returns a BatteryManager-like object.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative, hardenFn, type AnyFn } from './harden.js';

const g = globalThis as any;

export function spoofBattery(profile: DeviceProfile): void {
  const nav = g.navigator;
  if (!nav) return;

  const b = profile.battery;
  const buildManager = (): any => {
    const handlers: Record<string, AnyFn[]> = {};
    const mgr: any = {
      charging: b.charging,
      chargingTime: b.chargingTime,
      dischargingTime: b.dischargingTime,
      level: b.level,
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
      return false;
    };
    mgr.addEventListener = hardenFn(addEventListener, 'addEventListener');
    mgr.removeEventListener = hardenFn(removeEventListener, 'removeEventListener');
    mgr.dispatchEvent = hardenFn(dispatchEvent, 'dispatchEvent');
    return mgr;
  };

  const impl = function (this: any): Promise<any> {
    return Promise.resolve(buildManager());
  };

  // Prefer the prototype, fall back to the instance.
  const proto = g.Navigator ? g.Navigator.prototype : null;
  if (proto && typeof proto.getBattery === 'function') {
    wrapNative(proto, 'getBattery', impl, 'getBattery');
  } else {
    try {
      wrapNative(nav, 'getBattery', impl, 'getBattery');
    } catch {
      /* ignore */
    }
  }
}
