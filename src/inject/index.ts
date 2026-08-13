// GhostFrame injection engine entry.
// Reads the profile set by the launcher on globalThis.__GHOSTFRAME_PROFILE__ and
// installs every spoof module. Idempotent; silent per-module failure.

import type { DeviceProfile } from '../types/profile.js';
import { installToStringTrap } from './harden.js';
import { spoofNavigator } from './navigator.js';
import { spoofScreenWindow } from './screen-window.js';
import { spoofTimezone } from './timezone.js';
import { spoofCanvas } from './canvas.js';
import { spoofWebGL } from './webgl.js';
import { spoofAudio } from './audio.js';
import { spoofFonts } from './fonts.js';
import { spoofMedia } from './media.js';
import { spoofSpeech } from './speech.js';
import { spoofPermissions } from './permissions.js';
import { spoofGeolocation } from './geolocation.js';
import { spoofBattery } from './battery.js';
import { spoofWebRTC } from './webrtc.js';
import { spoofPerformance } from './performance.js';
import { spoofChromeObject } from './chrome.js';
import { spoofWorkers } from './worker.js';

const g = globalThis as any;

type SpoofFn = (profile: DeviceProfile) => void;

const SPOOF_ORDER: SpoofFn[] = [
  spoofNavigator,
  spoofScreenWindow,
  spoofTimezone,
  spoofCanvas,
  spoofWebGL,
  spoofAudio,
  spoofFonts,
  spoofMedia,
  spoofSpeech,
  spoofPermissions,
  spoofGeolocation,
  spoofBattery,
  spoofWebRTC,
  spoofPerformance,
  spoofChromeObject,
  spoofWorkers,
];

export function runInjection(profile?: DeviceProfile): void {
  if (g.__GHOSTFRAME_INSTALLED__) return;
  g.__GHOSTFRAME_INSTALLED__ = true;

  const p: DeviceProfile | undefined = profile ?? g.__GHOSTFRAME_PROFILE__;
  if (!p) return;

  try {
    installToStringTrap();
  } catch {
    /* hardening failure must not break the page */
  }

  if (!g.__GHOSTFRAME_LOG__) {
    try {
      g.__GHOSTFRAME_LOG__ = [];
    } catch {
      /* ignore */
    }
  }

  for (const step of SPOOF_ORDER) {
    try {
      step(p);
    } catch (e) {
      try {
        if (g.__GHOSTFRAME_LOG__) g.__GHOSTFRAME_LOG__.push(`${step.name}: ${String(e)}`);
      } catch {
        /* ignore */
      }
    }
  }
}

// Auto-run when injected as the esbuild IIFE entry.
runInjection();
