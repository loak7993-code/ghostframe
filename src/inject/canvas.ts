// Canvas fingerprint spoofing — seeded per-pixel noise on toDataURL/toBlob/getImageData.
// Stable per session: identical input always yields identical output (fresh PRNG per call).

import type { DeviceProfile } from '../types/profile.js';
import { makePRNG } from './prng.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

function applyNoise(data: Uint8ClampedArray | Uint8Array, seed: number, strength: number): void {
  const rng = makePRNG(seed >>> 0);
  const s = Math.abs(strength);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampU8((data[i] as number) + Math.round((rng() * 2 - 1) * s));
    data[i + 1] = clampU8((data[i + 1] as number) + Math.round((rng() * 2 - 1) * s));
    data[i + 2] = clampU8((data[i + 2] as number) + Math.round((rng() * 2 - 1) * s));
    // alpha channel untouched
  }
}

function clampU8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function makeOffscreen(w: number, h: number): any {
  // MUST be a DOM canvas: its ctx is CanvasRenderingContext2D so the captured
  // CanvasRenderingContext2D.prototype.getImageData works on it. An OffscreenCanvas's
  // ctx is OffscreenCanvasRenderingContext2D — a different class — and calling the DOM
  // prototype method on it throws (silent native fallback = no spoofing).
  if (typeof g.document !== 'undefined') {
    try {
      const c = g.document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    } catch {
      /* fall through */
    }
  }
  if (typeof g.OffscreenCanvas !== 'undefined') {
    try {
      return new g.OffscreenCanvas(w, h);
    } catch {
      /* fall through */
    }
  }
  return null;
}

export function spoofCanvas(profile: DeviceProfile): void {
  const seed = profile.canvas.noiseSeed >>> 0;
  const strength = profile.canvas.noiseStrength ?? 1;

  const Canvas = g.HTMLCanvasElement;
  const ctx2dProto = g.CanvasRenderingContext2D ? g.CanvasRenderingContext2D.prototype : null;

  if (Canvas && Canvas.prototype) {
    const proto = Canvas.prototype;
    const origToDataURL = proto.toDataURL;
    const origToBlob = proto.toBlob;
    const origGetImageData = ctx2dProto ? ctx2dProto.getImageData : null;
    const origPutImageData = ctx2dProto ? ctx2dProto.putImageData : null;

    if (typeof origToDataURL === 'function') {
      const toDataURLImpl = function (this: any, ...args: any[]): any {
        try {
          const w = this.width;
          const h = this.height;
          if (w > 0 && h > 0 && origGetImageData) {
            const off = makeOffscreen(w, h);
            if (off) {
              const octx = off.getContext('2d');
              if (octx && typeof octx.drawImage === 'function') {
                octx.drawImage(this, 0, 0);
                const img = origGetImageData.call(octx, 0, 0, w, h);
                applyNoise(img.data, seed, strength);
                if (origPutImageData) origPutImageData.call(octx, img, 0, 0);
                return origToDataURL.apply(off, args as any);
              }
            }
          }
        } catch {
          /* fall back to native */
        }
        return origToDataURL.apply(this, args as any);
      };
      wrapNative(proto, 'toDataURL', toDataURLImpl, 'toDataURL');
    }

    if (typeof origToBlob === 'function') {
      const toBlobImpl = function (this: any, ...args: any[]): any {
        try {
          const w = this.width;
          const h = this.height;
          const cb = args[0];
          if (w > 0 && h > 0 && origGetImageData && typeof cb === 'function') {
            const off = makeOffscreen(w, h);
            if (off) {
              const octx = off.getContext('2d');
              if (octx && typeof octx.drawImage === 'function') {
                octx.drawImage(this, 0, 0);
                const img = origGetImageData.call(octx, 0, 0, w, h);
                applyNoise(img.data, seed, strength);
                if (origPutImageData) origPutImageData.call(octx, img, 0, 0);
                return origToBlob.call(off, cb, ...args.slice(1));
              }
            }
          }
        } catch {
          /* fall back to native */
        }
        return origToBlob.apply(this, args as any);
      };
      wrapNative(proto, 'toBlob', toBlobImpl, 'toBlob');
    }
  }

  if (ctx2dProto && typeof ctx2dProto.getImageData === 'function') {
    const origGetImageData = ctx2dProto.getImageData;
    const getImageDataImpl = function (this: any, ...args: any[]): any {
      const img = origGetImageData.apply(this, args as any);
      try {
        applyNoise(img.data, seed, strength);
      } catch {
        /* ignore */
      }
      return img;
    };
    wrapNative(ctx2dProto, 'getImageData', getImageDataImpl, 'getImageData');
  }

  // OffscreenCanvas 2D context
  if (g.OffscreenCanvas && g.OffscreenCanvasRenderingContext2D) {
    try {
      const ocProto = g.OffscreenCanvasRenderingContext2D.prototype;
      if (ocProto && typeof ocProto.getImageData === 'function') {
        const orig = ocProto.getImageData;
        const impl = function (this: any, ...args: any[]): any {
          const img = orig.apply(this, args as any);
          try {
            applyNoise(img.data, seed, strength);
          } catch {
            /* ignore */
          }
          return img;
        };
        wrapNative(ocProto, 'getImageData', impl, 'getImageData');
      }
    } catch {
      /* ignore */
    }
  }
}
