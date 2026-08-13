// Screen + Window fingerprint spoofing — dimensions, color/pixel depth, orientation, DPR.

import type { DeviceProfile } from '../types/profile.js';
import { defineNativeGetter, hardenFn } from './harden.js';

const g = globalThis as any;

function buildOrientation(orientation: any): any {
  const obj: any = {
    angle: orientation.angle,
    type: orientation.type,
    onchange: null,
  };
  const addEventListener = function (): void {
    /* no-op */
  };
  const removeEventListener = function (): void {
    /* no-op */
  };
  const dispatchEvent = function (): boolean {
    return false;
  };
  obj.addEventListener = hardenFn(addEventListener, 'addEventListener');
  obj.removeEventListener = hardenFn(removeEventListener, 'removeEventListener');
  obj.dispatchEvent = hardenFn(dispatchEvent, 'dispatchEvent');
  return obj;
}

export function spoofScreenWindow(profile: DeviceProfile): void {
  const ScreenClass = g.Screen;
  const screenProto = ScreenClass ? ScreenClass.prototype : null;
  if (screenProto) {
    const s = profile.screen;
    defineNativeGetter(screenProto, 'width', s.width, ScreenClass);
    defineNativeGetter(screenProto, 'height', s.height, ScreenClass);
    defineNativeGetter(screenProto, 'availWidth', s.availWidth, ScreenClass);
    defineNativeGetter(screenProto, 'availHeight', s.availHeight, ScreenClass);
    defineNativeGetter(screenProto, 'availLeft', 0, ScreenClass);
    defineNativeGetter(screenProto, 'availTop', 0, ScreenClass);
    defineNativeGetter(screenProto, 'colorDepth', s.colorDepth, ScreenClass);
    defineNativeGetter(screenProto, 'pixelDepth', s.pixelDepth, ScreenClass);
    defineNativeGetter(screenProto, 'orientation', buildOrientation(s.orientation), ScreenClass);
  }

  const w = profile.window;
  const targets: Record<string, unknown> = {
    innerWidth: w.innerWidth,
    innerHeight: w.innerHeight,
    outerWidth: w.outerWidth,
    outerHeight: w.outerHeight,
    devicePixelRatio: w.devicePixelRatio,
    screenX: w.screenX,
    screenY: w.screenY,
    screenLeft: w.screenX,
    screenTop: w.screenY,
  };
  for (const [prop, value] of Object.entries(targets)) {
    try {
      defineNativeGetter(g, prop, value, g.Window);
    } catch {
      /* ignore */
    }
  }
}
