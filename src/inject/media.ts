// MediaDevices.enumerates spoofing — stable deviceIds/groupIds + labels.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative, hardenFn } from './harden.js';

const g = globalThis as any;

export function spoofMedia(profile: DeviceProfile): void {
  const proto = g.MediaDevices ? g.MediaDevices.prototype : null;
  if (!proto) return;

  const devices = profile.mediaDevices.map((d) => {
    const info: any = {
      kind: d.kind,
      label: d.label,
      deviceId: d.deviceId,
      groupId: d.groupId,
    };
    const toJSON = function (): any {
      return {
        kind: d.kind,
        label: d.label,
        deviceId: d.deviceId,
        groupId: d.groupId,
      };
    };
    info.toJSON = hardenFn(toJSON, 'toJSON');
    return info;
  });

  const impl = function (this: any): Promise<any[]> {
    return Promise.resolve(devices.slice());
  };
  wrapNative(proto, 'enumerateDevices', impl, 'enumerateDevices');

  if (typeof proto.getSupportedConstraints === 'function') {
    // keep native; leave as-is
  }
}
