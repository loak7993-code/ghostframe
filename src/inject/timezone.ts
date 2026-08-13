// Timezone spoofing — Intl + Date surfaces locked to profile.timezone.
// Offset is COMPUTED via the engine's real tz database (never hardcoded),
// so DST transitions and toString()/getTimezoneOffset stay coherent.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

// Compute the getTimezoneOffset() value (minutes WEST of UTC, native convention)
// for `tzid` at the instant `date`, using the page's own ICU data.
function computeOffsetMinutes(date: Date, tzid: string, origDTF: any): number {
  try {
    const dtf = new origDTF('en-US', {
      timeZone: tzid,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, hourCycle: 'h23',
    });
    const map: Record<string, string> = {};
    for (const part of dtf.formatToParts(date)) map[part.type] = part.value;
    if (!map.year) return new Date().getTimezoneOffset();
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const asUTC = Date.UTC(
      parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10),
      hour, parseInt(map.minute, 10), parseInt(map.second, 10),
    );
    // offset (ms) between the wall-clock shown in tz and the real instant
    const offsetMs = asUTC - Math.floor(date.getTime() / 1000) * 1000;
    return -offsetMs / 60000; // native convention: minutes east of UTC is negative
  } catch {
    return new Date().getTimezoneOffset();
  }
}

export function spoofTimezone(profile: DeviceProfile): void {
  const tz = profile.timezone;
  const origDTF = g.Intl && g.Intl.DateTimeFormat;
  const DateCtor = g.Date;

  if (origDTF && origDTF.prototype) {
    const origResolved = origDTF.prototype.resolvedOptions;
    if (typeof origResolved === 'function') {
      const impl = function (this: any, ...args: any[]): any {
        let opts: any;
        try {
          opts = origResolved.apply(this, args);
        } catch {
          opts = {};
        }
        const merged: any = { ...opts, timeZone: tz.id, locale: tz.locale };
        return merged;
      };
      wrapNative(origDTF.prototype, 'resolvedOptions', impl, 'resolvedOptions');
    }
  }

  if (DateCtor && DateCtor.prototype) {
    const impl = function (this: Date): number {
      try {
        return computeOffsetMinutes(this, tz.id, origDTF);
      } catch {
        return -tz.offsetMinutes;
      }
    };
    wrapNative(DateCtor.prototype, 'getTimezoneOffset', impl, 'getTimezoneOffset');

    // utcOffset-style helpers that some detectors hit
    if (typeof DateCtor.prototype.getUTCFullYear === 'function') {
      // nothing extra needed: UTC getters stay native by definition
    }
  }

  // Temporal (Chrome 120+ supports temporal): detectors increasingly read it.
  try {
    if (g.Temporal && g.Temporal.Now && g.Temporal.Now.timeZoneId) {
      const impl = function (): string { return tz.id; };
      wrapNative(g.Temporal.Now, 'timeZoneId', impl, 'timeZoneId');
    }
  } catch {
    /* Temporal unavailable — skip */
  }
}
