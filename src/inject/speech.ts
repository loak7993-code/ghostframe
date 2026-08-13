// SpeechSynthesis voice list spoofing + voiceschanged handling.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

export function spoofSpeech(profile: DeviceProfile): void {
  const ss = g.speechSynthesis;
  if (!ss) return;

  const voices = profile.speechVoices.map((v) => {
    const obj: any = {
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
      voiceURI: v.voiceURI,
    };
    return obj;
  });

  const proto = Object.getPrototypeOf(ss);
  if (!proto) return;

  if (typeof proto.getVoices === 'function') {
    const impl = function (this: any): any[] {
      return voices.slice();
    };
    wrapNative(proto, 'getVoices', impl, 'getVoices');
  }

  // If a script has already attached onvoiceschanged, ensure it still fires.
  // We do not need to synthesize an event; native voiceschanged continues to work.
  // Override getVoices on the instance too, in case the prototype override is shadowed.
  try {
    const impl = function (): any[] {
      return voices.slice();
    };
    wrapNative(ss, 'getVoices', impl, 'getVoices');
  } catch {
    /* ignore */
  }
}
