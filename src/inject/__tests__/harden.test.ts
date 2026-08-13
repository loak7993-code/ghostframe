// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import {
  installToStringTrap,
  hardenFn,
  defineNativeGetter,
  nativeToStringString,
} from '../harden.js';
import { makePRNG } from '../prng.js';

// Minimal DOM stubs so spoofCanvas can run in a plain node environment
// (jsdom is not required). We only need enough surface to assert the override
// is installed, hardened, and consistent across calls.
function stubCanvasEnv(): void {
  const globalRef = globalThis as any;
  if (!globalRef.HTMLCanvasElement) {
    globalRef.HTMLCanvasElement = class HTMLCanvasElement {
      width = 10;
      height = 10;
      getContext() {
        return null;
      }
    };
  }
  globalRef.HTMLCanvasElement.prototype.toDataURL = function toDataURL(): string {
    return 'data:image/png;base64,AAAA';
  };
  globalRef.HTMLCanvasElement.prototype.toBlob = function toBlob(cb: any): void {
    if (typeof cb === 'function') cb({});
  };
  if (!globalRef.CanvasRenderingContext2D) {
    globalRef.CanvasRenderingContext2D = class CanvasRenderingContext2D {};
  }
  globalRef.CanvasRenderingContext2D.prototype.getImageData = function getImageData(): any {
    return { data: new Uint8ClampedArray(10 * 10 * 4) };
  };
  globalRef.CanvasRenderingContext2D.prototype.putImageData = function putImageData(): void {
    /* no-op */
  };
}
stubCanvasEnv();

import { spoofCanvas } from '../canvas.js';

beforeAll(() => {
  installToStringTrap();
});

describe('harden + prng + canvas', () => {
  it('hardenFn makes fn.toString() return the native form', () => {
    const fn = function (): void {
      /* spoiler */
    };
    const wrapped = hardenFn(fn, 'getAttribute');
    expect(wrapped.toString()).toBe('function getAttribute() { [native code] }');
  });

  it('hardenFn wrapper has no own "prototype" property (anti-disclosure)', () => {
    const fn = function (): void {
      /* spoiler */
    };
    const wrapped = hardenFn(fn, 'forEach');
    expect(Object.prototype.hasOwnProperty.call(wrapped, 'prototype')).toBe(false);
    expect(wrapped.name).toBe('forEach');
  });

  it('nativeToStringString builds the native string', () => {
    expect(nativeToStringString('foo')).toBe('function foo() { [native code] }');
  });

  it('toString trap falls through for non-spoofed functions (no leak)', () => {
    const plain = function leakSource(): number {
      return 42;
    };
    // Should return the real source, not a native string.
    expect(plain.toString()).toContain('leakSource');
    expect(plain.toString()).not.toContain('[native code]');
  });

  it('defineNativeGetter: configurable getter, native toString, returns value', () => {
    const obj: any = {};
    defineNativeGetter(obj, 'userAgent', 'GhostFrameUA');
    const d = Object.getOwnPropertyDescriptor(obj, 'userAgent');
    expect(d).toBeDefined();
    expect(d!.configurable).toBe(true);
    expect(d!.enumerable).toBe(true);
    expect(typeof d!.get).toBe('function');
    expect(d!.get!.toString()).toBe('function get userAgent() { [native code] }');
    expect(obj.userAgent).toBe('GhostFrameUA');
  });

  it('makePRNG: same seed yields identical 100-value sequence', () => {
    const a = makePRNG(123456);
    const b = makePRNG(123456);
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 100; i++) {
      seqA.push(a());
      seqB.push(b());
    }
    expect(seqA).toEqual(seqB);
    // values are in [0, 1)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('spoofCanvas installs a hardened, consistent toDataURL', () => {
    const profile: any = {
      canvas: { noiseSeed: 42, noiseStrength: 1 },
    };
    spoofCanvas(profile);

    const fn = (globalThis as any).HTMLCanvasElement.prototype.toDataURL;
    expect(fn.toString()).toBe('function toDataURL() { [native code] }');

    const Canvas = (globalThis as any).HTMLCanvasElement;
    const canvas = new Canvas();
    const r1 = canvas.toDataURL();
    const r2 = canvas.toDataURL();
    expect(typeof r1).toBe('string');
    expect(r1).toEqual(r2);
  });

  it('spoofCanvas getImageData override is hardened and deterministic', () => {
    const profile: any = {
      canvas: { noiseSeed: 7, noiseStrength: 1 },
    };
    spoofCanvas(profile);
    const proto = (globalThis as any).CanvasRenderingContext2D.prototype;
    expect(proto.getImageData.toString()).toBe('function getImageData() { [native code] }');
    const ctx = new (globalThis as any).CanvasRenderingContext2D();
    const a = ctx.getImageData();
    const b = ctx.getImageData();
    // fresh PRNG per call seeded the same → identical bytes for identical input
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });
});
