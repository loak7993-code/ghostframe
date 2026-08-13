// performance.now resolution clamping — quantize to the profile's claimed resolution.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative, hardenFn } from './harden.js';

const g = globalThis as any;

export function spoofPerformance(profile: DeviceProfile): void {
  const perf = g.performance;
  if (!perf) return;
  const res = profile.math.performanceNowResolutionMs;
  if (!res || res <= 0) return;

  const orig = typeof perf.now === 'function' ? perf.now.bind(perf) : null;
  const impl = function (this: any): number {
    let t: number;
    if (orig) {
      t = orig();
    } else {
      t = g.Date && typeof g.Date.now === 'function' ? g.Date.now() : 0;
    }
    return Math.round(t / res) * res;
  };

  try {
    Object.defineProperty(perf, 'now', {
      value: hardenFn(impl, 'now'),
      configurable: true,
      writable: true,
    });
  } catch {
    /* ignore */
  }

  const PerfProto = g.Performance ? g.Performance.prototype : null;
  if (PerfProto && typeof PerfProto.now === 'function') {
    wrapNative(PerfProto, 'now', impl, 'now');
  }
}
