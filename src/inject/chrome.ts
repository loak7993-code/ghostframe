// Chrome object spoofing — full Chrome exposes window.chrome (id, csi, loadTimes, runtime).
// Bundled/headless Chromium omits it entirely, which detectors treat as a bot tell.
// Inject a faithful stub on Chromium-family profiles only (chrome, edge). Safari/Firefox: skip.

import type { DeviceProfile } from '../types/profile.js';
import { hardenFn } from './harden.js';

const g = globalThis as any;

export function spoofChromeObject(profile: DeviceProfile): void {
  if (profile.browser !== 'chrome' && profile.browser !== 'edge') return;
  if (g.chrome && g.chrome.runtime) return; // real full Chrome — don't touch

  const noop = hardenFn(function (): void {}, 'noop');
  const retUndefined = hardenFn(function (): undefined { return undefined; }, '');
  const retFalse = hardenFn(function (): boolean { return false; }, '');
  const retZero = hardenFn(function (): number { return 0; }, '');

  const chromeObj: any = {};
  chromeObj.app = {
    isInstalled: false,
    getIsInstalled: hardenFn(retFalse, 'getIsInstalled'),
    getDetails: hardenFn(retUndefined, 'getDetails'),
    getIsInstalledAsync: hardenFn(function (cb: any): void {
      if (typeof cb === 'function') setTimeout(() => cb(false), 0);
    }, 'getIsInstalledAsync'),
    installState: hardenFn(function (cb: any): void { if (typeof cb === 'function') setTimeout(() => cb('not_installed'), 0); }, 'installState'),
    runningState: hardenFn(function (): string { return 'cannot_run'; }, 'runningState'),
  };
  chromeObj.csi = hardenFn(function (): any {
    return { onloadT: Date.now(), startE: Date.now(), pageT: 0, tran: 0 };
  }, 'csi');
  chromeObj.loadTimes = hardenFn(function (): any {
    const now = performance.timeOrigin / 1000;
    return {
      commitLoadTime: now, connectionInfo: 'h2', finishDocumentLoadTime: now,
      finishLoadTime: now, firstPaintAfterLoadTime: 0, firstPaintTime: now,
      navigationType: 'Other', npnNegotiatedProtocol: 'h2', requestTime: now - 0.5,
      startLoadTime: now, wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    };
  }, 'loadTimes');

  chromeObj.runtime = {
    id: undefined,
    getManifest: hardenFn(function (): any { return {}; }, 'getManifest'),
    getURL: hardenFn(function (p: string): string { return p; }, 'getURL'),
    sendMessage: hardenFn(function (): void { /* no-op: throws in real chrome w/o id but detectors only probe existence */ }, 'sendMessage'),
    connect: hardenFn(function (arg?: any): any {
      return {
        name: arg && typeof arg === 'object' && 'name' in arg ? arg.name : '',
        onDisconnect: { hasListeners: hardenFn(retFalse, 'hasListeners'), addListener: hardenFn(noop, 'addListener') },
        onMessage: { hasListeners: hardenFn(retFalse, 'hasListeners'), addListener: hardenFn(noop, 'addListener') },
        postMessage: hardenFn(noop, 'postMessage'),
        disconnect: hardenFn(noop, 'disconnect'),
        sender: undefined,
      };
    }, 'connect'),
    lastError: null,
    onConnect: { addListener: hardenFn(noop, 'addListener'), hasListeners: hardenFn(retFalse, 'hasListeners') },
    onMessage: { addListener: hardenFn(noop, 'addListener'), hasListeners: hardenFn(retFalse, 'hasListeners') },
    onInstalled: { addListener: hardenFn(noop, 'addListener') },
    platformInfo: { os: 'android', arch: 'arm', nacl_arch: 'arm' },
  };
  // platform info must match claimed platform
  const osMap: Record<string, string> = { windows: 'win', macos: 'mac', linux: 'linux', android: 'android', ios: 'ios' };
  chromeObj.runtime.platformInfo = { os: osMap[profile.os] || 'linux', arch: profile.os === 'windows' ? 'x86-64' : 'arm', nacl_arch: profile.os === 'windows' ? 'x86-64' : 'arm' };

  // real window.chrome is an own DATA property (not an accessor): keep it that way.
  Object.defineProperty(g, 'chrome', {
    value: chromeObj,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export default spoofChromeObject;
