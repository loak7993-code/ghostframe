// Worker-context spoofing — Page.addScriptToEvaluateOnNewDocument does NOT run in
// web workers, so detectors that measure canvas/audio/etc. in a `new Worker(...)`
// see the unspoofed fingerprint and flag divergence. We intercept JS Blob creation:
// `new Blob([workerCode], {type:'...javascript...'})` passed to URL.createObjectURL
// gets our profile + the entire core bundle prepended, so the worker boots inside
// the same spoofed environment as the page.

import type { DeviceProfile } from '../types/profile.js';
import { WORKER_SOURCE } from './worker-source.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

const JS_TYPE_RE = /(java|ecma)script/i;

export function spoofWorkers(profile: DeviceProfile): void {
  if (!WORKER_SOURCE || WORKER_SOURCE.length === 0) return; // core embed missing: skip safely

  const prefix =
    'globalThis.__GHOSTFRAME_PROFILE__=' + JSON.stringify(profile) + ';\n' +
    WORKER_SOURCE +
    '\n// -- ghostframe core injected; worker payload follows --\n';

  const URLCtor = g.URL;
  if (URLCtor && typeof URLCtor.createObjectURL === 'function') {
    const origCreate = URLCtor.createObjectURL;
    const impl = function (this: any, obj: any): string {
      try {
        const BlobCtor = g.Blob;
        if (BlobCtor && obj instanceof BlobCtor) {
          const t = (obj as Blob).type || '';
          if (JS_TYPE_RE.test(t)) {
            return origCreate.call(URLCtor, new BlobCtor([prefix + '\n', obj], { type: t }));
          }
        }
      } catch {
        /* fall through to native */
      }
      return origCreate.call(URLCtor, obj);
    };
    wrapNative(URLCtor, 'createObjectURL', impl, 'createObjectURL');
  }

  // Belt & braces: service worker registration with inline code is rare; skip.
  // Inline string workers (var src = "...js..."; new Worker(URL.createObjectURL(new Blob([src],{type})))
  // are covered above. Direct same-origin file workers (new Worker('a.js')) cannot be rewritten client-side.
}

export default spoofWorkers;
