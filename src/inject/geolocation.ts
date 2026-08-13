// Geolocation spoofing — getCurrentPosition/watchPosition with deterministic jitter.

import type { DeviceProfile } from '../types/profile.js';
import { makePRNG } from './prng.js';
import { wrapNative, type AnyFn } from './harden.js';

const g = globalThis as any;

export function spoofGeolocation(profile: DeviceProfile): void {
  const proto = g.Geolocation ? g.Geolocation.prototype : null;
  if (!proto) return;

  const geo = profile.geolocation;
  // Stable per-session jitter computed once.
  const jitter = makePRNG((profile.canvas.noiseSeed ^ 0x9e3779b9) >>> 0);
  const dLat = (jitter() - 0.5) * 0.0001;
  const dLon = (jitter() - 0.5) * 0.0001;

  const buildPosition = (): any => {
    return {
      coords: {
        latitude: geo.latitude + dLat,
        longitude: geo.longitude + dLon,
        accuracy: geo.accuracy,
        altitude: geo.altitude,
        altitudeAccuracy: geo.altitudeAccuracy,
        heading: geo.heading,
        speed: geo.speed,
      },
      timestamp: Date.now(),
    };
  };

  if (typeof proto.getCurrentPosition === 'function') {
    const impl = function (this: any, success: AnyFn, error?: AnyFn, options?: any): void {
      if (typeof success === 'function') {
        const timeout = options && typeof options.timeout === 'number' ? options.timeout : 0;
        setTimeout(() => success(buildPosition()), Math.min(timeout, 1000));
      }
    };
    wrapNative(proto, 'getCurrentPosition', impl, 'getCurrentPosition');
  }

  if (typeof proto.watchPosition === 'function') {
    const impl = function (this: any, success: AnyFn, error?: AnyFn, options?: any): number {
      if (typeof success === 'function') {
        const interval = Math.max((options && options.timeout) || 1000, 1000);
        return g.setInterval(() => success(buildPosition()), interval) as number;
      }
      return 0;
    };
    wrapNative(proto, 'watchPosition', impl, 'watchPosition');
  }

  if (typeof proto.clearWatch === 'function') {
    const impl = function (this: any, id: number): void {
      try {
        g.clearInterval(id);
      } catch {
        /* ignore */
      }
    };
    wrapNative(proto, 'clearWatch', impl, 'clearWatch');
  }
}
