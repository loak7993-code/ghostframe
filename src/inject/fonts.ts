// Font detection spoofing — CanvasRenderingContext2D.measureText returns dimensions
// consistent with the profile's stated font presence.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

function parseFontFamily(fontStr: string): string | null {
  if (!fontStr || typeof fontStr !== 'string') return null;
  // CSS font shorthand: [style] [variant] [weight] size[/line-height] family, family2, ...
  let rest = fontStr;
  // strip everything up to and including the first size token (contains a digit + unit or /).
  const sizeMatch = rest.match(/(^|\s)\d+(\.\d+)?(px|em|rem|pt|%)?(\/\d+(\.\d+)?)?(\s+|$)/i);
  if (sizeMatch) {
    rest = rest.slice(rest.indexOf(sizeMatch[0]) + sizeMatch[0].length);
  } else {
    // fallback: split on whitespace, drop tokens without a comma until we find a family
    const parts = rest.split(/\s+/);
    if (parts.length > 1) parts.shift();
    rest = parts.join(' ');
  }
  rest = rest.trim();
  if (!rest) return null;
  // take the first family in the list
  const first = rest.split(',')[0].trim();
  // strip quotes
  return first.replace(/^['"]|['"]$/g, '').toLowerCase();
}

function substituteFallback(fontStr: string): string {
  if (!fontStr || typeof fontStr !== 'string') return '12px monospace';
  // replace the family portion with a generic monospace.
  const sizeMatch = fontStr.match(/\d+(\.\d+)?(px|em|rem|pt)?/i);
  const size = sizeMatch ? sizeMatch[0] : '12px';
  return `${size} monospace`;
}

export function spoofFonts(profile: DeviceProfile): void {
  const proto = g.CanvasRenderingContext2D ? g.CanvasRenderingContext2D.prototype : null;
  if (!proto || typeof proto.measureText !== 'function') return;

  const detectionMap = new Map<string, boolean>();
  for (const f of profile.fonts.detectionFonts) {
    detectionMap.set(f.family.toLowerCase(), f.present);
  }

  const orig = proto.measureText;
  const impl = function (this: any, text: string): any {
    let base: any;
    try {
      base = orig.call(this, text);
    } catch {
      base = { width: 0 };
    }
    if (!base || typeof base !== 'object') return base;
    const family = parseFontFamily(this.font);
    if (family && detectionMap.has(family)) {
      const present = detectionMap.get(family);
      if (!present) {
        // return fallback-family metrics so candidate == fallback (font "absent").
        const savedFont = this.font;
        try {
          this.font = substituteFallback(this.font);
          const fm = orig.call(this, text);
          return mergeMetrics(base, fm);
        } catch {
          return base;
        } finally {
          try {
            this.font = savedFont;
          } catch {
            /* ignore */
          }
        }
      }
    }
    return base;
  };
  wrapNative(proto, 'measureText', impl, 'measureText');
}

function mergeMetrics(base: any, fm: any): any {
  const w = typeof fm.width === 'number' ? fm.width : 0;
  return {
    ...base,
    width: w,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: w,
    actualBoundingBoxAscent: typeof fm.actualBoundingBoxAscent === 'number' ? fm.actualBoundingBoxAscent : 0,
    actualBoundingBoxDescent: typeof fm.actualBoundingBoxDescent === 'number' ? fm.actualBoundingBoxDescent : 0,
    fontBoundingBoxAscent: typeof fm.fontBoundingBoxAscent === 'number' ? fm.fontBoundingBoxAscent : 0,
    fontBoundingBoxDescent: typeof fm.fontBoundingBoxDescent === 'number' ? fm.fontBoundingBoxDescent : 0,
  };
}
