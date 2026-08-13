// Audio fingerprint spoofing — seeded noise on AnalyserNode reads + sampleRate override.

import type { DeviceProfile } from '../types/profile.js';
import { makePRNG } from './prng.js';
import { wrapNative, defineNativeGetter } from './harden.js';

const g = globalThis as any;

function patchAnalyser(proto: any, seed: number, strength: number): void {
  if (!proto) return;
  for (const name of [
    'getFloatTimeDomainData',
    'getFloatFrequencyData',
    'getByteTimeDomainData',
    'getByteFrequencyData',
  ]) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    const impl = function (this: any, array: any): void {
      try {
        orig.call(this, array);
      } catch {
        /* leave array as-is */
      }
      if (!array || typeof array.length !== 'number') return;
      const rng = makePRNG(seed >>> 0);
      const s = Math.abs(strength);
      const len = array.length;
      for (let i = 0; i < len; i++) {
        array[i] = array[i] + (rng() * 2 - 1) * s;
      }
    };
    wrapNative(proto, name, impl, name);
  }
}

function patchSampleRate(ctor: any, sampleRate: number): void {
  if (!ctor || !ctor.prototype) return;
  installGetter(ctor.prototype, ctor, sampleRate);
}

function installGetter(proto: any, ctor: any, sampleRate: number): void {
  defineNativeGetter(proto, 'sampleRate', sampleRate, ctor);
}

function patchStartRendering(ctor: any, seed: number, strength: number): void {
  if (!ctor || !ctor.prototype) return;
  const orig = ctor.prototype.startRendering;
  if (typeof orig !== 'function') return;
  const impl = function (this: any): Promise<any> {
    return Promise.resolve(orig.call(this)).then((buf: any) => {
      try {
        if (!buf || typeof buf.numberOfChannels !== 'number') return buf;
        const rng = makePRNG(seed >>> 0);
        const s = Math.abs(strength);
        if (s === 0) return buf;
        const nch = buf.numberOfChannels;
        for (let c = 0; c < nch; c++) {
          const data = buf.getChannelData(c);
          if (!data || !data.length) continue;
          for (let i = 0; i < data.length; i++) {
            data[i] = data[i] + (rng() * 2 - 1) * s;
          }
        }
      } catch {
        /* leave buffer as-is on any error */
      }
      return buf;
    });
  };
  wrapNative(ctor.prototype, 'startRendering', impl, 'startRendering');
}

export function spoofAudio(profile: DeviceProfile): void {
  const seed = profile.audio.noiseSeed >>> 0;
  const strength = profile.audio.noiseStrength ?? 0;
  const sampleRate = profile.audio.sampleRate;

  if (g.AnalyserNode) patchAnalyser(g.AnalyserNode.prototype, seed, strength);

  if (g.AudioContext) patchSampleRate(g.AudioContext, sampleRate);
  if (g.webkitAudioContext) patchSampleRate(g.webkitAudioContext, sampleRate);
  if (g.OfflineAudioContext) {
    patchSampleRate(g.OfflineAudioContext, sampleRate);
    patchStartRendering(g.OfflineAudioContext, seed, strength);
  }
  if (g.webkitOfflineAudioContext) {
    patchStartRendering(g.webkitOfflineAudioContext, seed, strength);
  }
}
