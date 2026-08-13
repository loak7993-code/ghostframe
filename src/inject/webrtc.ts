// WebRTC IP-leak defense — wraps RTCPeerConnection to strip real local IPs and
// substitute the profile's fakeLocalIP; optionally forces relay-only candidates
// and mangles SDP on createOffer/createAnswer.

import type { DeviceProfile } from '../types/profile.js';
import { registerNativeFn, hardenFn } from './harden.js';

const g = globalThis as any;

const IPV4_RE = /((?:\d{1,3}\.){3}\d{1,3})/g;
const IPV6_RE = /([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{0,4}){1,7}(?::[0-9a-fA-F]{1,4})?)/g;
const HOST_TYPE_RE = /typ\s+(host|srflx|prflx|relay)/;
const CANDIDATE_LINE_RE = /^a=candidate:/i;

function mangleCandidateString(candidateStr: string, profile: DeviceProfile): string | null {
  if (!candidateStr || typeof candidateStr !== 'string') return candidateStr;
  const typeMatch = candidateStr.match(HOST_TYPE_RE);
  const candType = typeMatch ? typeMatch[1] : 'host';

  // forceRelay: drop any non-relay candidate entirely.
  if (profile.webrtc.forceRelay && candType !== 'relay') {
    return null;
  }

  // Replace any real local IP with the fake local IP (for host / srflx candidates).
  let out = candidateStr;
  if (candType !== 'relay') {
    out = out.replace(IPV4_RE, profile.webrtc.fakeLocalIP);
    // Only touch link-local-ish/private IPv6 if present; keep it simple — replace all v6 host addrs.
    out = out.replace(IPV6_RE, profile.webrtc.fakeLocalIP.includes(':') ? profile.webrtc.fakeLocalIP : '::1');
  }
  return out;
}

function rewriteCandidate(candidate: any, profile: DeviceProfile): boolean {
  if (!candidate) return true;
  try {
    const raw = typeof candidate.candidate === 'string' ? candidate.candidate : String(candidate.candidate ?? '');
    const rewritten = mangleCandidateString(raw, profile);
    if (rewritten === null) return false; // drop candidate
    if (rewritten !== raw) {
      Object.defineProperty(candidate, 'candidate', {
        value: rewritten,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    }
  } catch {
    /* ignore */
  }
  return true;
}

function mangleSDP(sdp: string, profile: DeviceProfile): string {
  if (!profile.webrtc.mangleSDP || typeof sdp !== 'string') return sdp;
  const lines = sdp.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (CANDIDATE_LINE_RE.test(line)) {
      if (profile.webrtc.forceRelay && !/typ\s+relay/.test(line)) {
        // drop non-relay candidate lines
        continue;
      }
      out.push(line.replace(IPV4_RE, profile.webrtc.fakeLocalIP));
      continue;
    }
    // c= and o= lines may carry the local IP.
    if (/^c=IN IP4 /i.test(line)) {
      out.push(`c=IN IP4 ${profile.webrtc.fakeLocalIP}`);
      continue;
    }
    if (/^o=/.test(line)) {
      out.push(line.replace(IPV4_RE, profile.webrtc.fakeLocalIP));
      continue;
    }
    out.push(line);
  }
  return out.join('\r\n');
}

export function spoofWebRTC(profile: DeviceProfile): void {
  const NativeRTC = g.RTCPeerConnection;
  if (typeof NativeRTC !== 'function') return;

  function wrapInstance(pc: any): any {
    // Intercept onicecandidate so we can rewrite/drop candidates before the page sees them.
    let userHandler: ((ev: any) => void) | null = null;
    const realAdd = pc.addEventListener.bind(pc);
    try {
      Object.defineProperty(pc, 'onicecandidate', {
        configurable: true,
        get(): any {
          return userHandler;
        },
        set(fn: any): void {
          userHandler = typeof fn === 'function' ? fn : null;
          const wrapped = (ev: any): void => {
            if (ev && ev.candidate) {
              const keep = rewriteCandidate(ev.candidate, profile);
              if (!keep) {
                return; // suppress this candidate
              }
            }
            if (typeof userHandler === 'function') {
              try {
                userHandler.call(pc, ev);
              } catch {
                /* ignore */
              }
            }
          };
          realAdd('icecandidate', wrapped as any);
        },
      });
    } catch {
      /* ignore */
    }

    // Wrap addEventListener for 'icecandidate'.
    const wrappedAdd = function (this: any, type: string, listener: any, options?: any): void {
      if (type === 'icecandidate' && typeof listener === 'function') {
        const wrapped = (ev: any): void => {
          if (ev && ev.candidate) {
            const keep = rewriteCandidate(ev.candidate, profile);
            if (!keep) return;
          }
          try {
            listener.call(pc, ev);
          } catch {
            /* ignore */
          }
        };
        return realAdd(type, wrapped as any, options);
      }
      return realAdd(type, listener, options);
    };
    pc.addEventListener = hardenFn(wrappedAdd, 'addEventListener');

    // createOffer / createAnswer — mangle returned SDP.
    for (const method of ['createOffer', 'createAnswer']) {
      if (typeof pc[method] === 'function') {
        const orig = pc[method].bind(pc);
        const wrapped = function (this: any, ...args: any[]): Promise<any> {
          return orig(...args).then((desc: any) => {
            if (desc && typeof desc.sdp === 'string') {
              desc.sdp = mangleSDP(desc.sdp, profile);
            }
            return desc;
          });
        };
        pc[method] = hardenFn(wrapped, method);
      }
    }

    return pc;
  }

  function GhostRTC(this: any, config: any, constraints: any): any {
    const pc = new NativeRTC(config, constraints);
    return wrapInstance(pc);
  }

  // Genuine constructor — must keep .prototype === NativeRTC.prototype, so register-only.
  try {
    GhostRTC.prototype = NativeRTC.prototype;
  } catch {
    /* ignore */
  }
  for (const key of Object.keys(NativeRTC)) {
    try {
      (GhostRTC as any)[key] = (NativeRTC as any)[key];
    } catch {
      /* ignore */
    }
  }
  registerNativeFn(GhostRTC as any, 'RTCPeerConnection');

  g.RTCPeerConnection = GhostRTC;
  if (g.webkitRTCPeerConnection === NativeRTC) {
    g.webkitRTCPeerConnection = GhostRTC;
  }
}
