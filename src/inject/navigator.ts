// Navigator fingerprint spoofing — UA, platform, languages, hardware, plugins, mimeTypes,
// userAgentData (+ high-entropy hints), connection, and the critical webdriver=false.

import type { DeviceProfile } from '../types/profile.js';
import { defineNativeGetter, wrapNative, hardenFn } from './harden.js';

const g = globalThis as any;

function makeArrayLike(items: any[], namedKey: string | null, protoCtor: any): any {
  const base = protoCtor ? Object.create(protoCtor.prototype) : {};
  for (let i = 0; i < items.length; i++) {
    Object.defineProperty(base, i, {
      value: items[i],
      enumerable: true,
      configurable: true,
      writable: true,
    });
    if (namedKey) {
      const key = items[i][namedKey];
      if (key) {
        Object.defineProperty(base, key, {
          value: items[i],
          enumerable: false,
          configurable: true,
          writable: true,
        });
      }
    }
  }
  Object.defineProperty(base, 'length', {
    value: items.length,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const item = function (idx: number): any {
    return items[idx] ?? null;
  };
  base.item = hardenFn(item, 'item');
  if (namedKey) {
    const namedItem = function (name: string): any {
      return items.find((x) => x[namedKey] === name) ?? null;
    };
    base.namedItem = hardenFn(namedItem, 'namedItem');
  }
  return base;
}

function buildMimeTypes(mimes: any[]): any {
  const MimeType = g.MimeType;
  const items = mimes.map((m) => {
    const obj: any = {
      type: m.type,
      suffixes: m.suffixes,
      description: m.description,
    };
    return obj;
  });
  return makeArrayLike(items, 'type', MimeType);
}

function buildPlugins(plugins: any[]): any {
  const PluginArray = g.PluginArray;
  const Plugin = g.Plugin;
  const items = plugins.map((p) => {
    const mimes = (p.mimeTypes || []).map((m: any) => {
      const obj: any = { type: m.type, suffixes: m.suffixes, description: m.description };
      return obj;
    });
    const pluginObj: any = {
      name: p.name,
      filename: p.filename,
      description: p.description,
      length: mimes.length,
    };
    const itemFn = function (idx: number): any {
      return mimes[idx] ?? null;
    };
    pluginObj.item = hardenFn(itemFn, 'item');
    const namedFn = function (name: string): any {
      return mimes.find((m: any) => m.type === name) ?? null;
    };
    pluginObj.namedItem = hardenFn(namedFn, 'namedItem');
    for (let i = 0; i < mimes.length; i++) {
      Object.defineProperty(pluginObj, i, {
        value: mimes[i],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    // Re-prototype onto Plugin if available so instanceof checks pass.
    if (Plugin) {
      Object.setPrototypeOf(pluginObj, Plugin.prototype);
    }
    return pluginObj;
  });
  const arr = makeArrayLike(items, 'name', PluginArray);
  if (!PluginArray) {
    arr.refresh = hardenFn(function (): void {
      /* no-op */
    }, 'refresh');
  }
  return arr;
}

function buildUserAgentData(profile: DeviceProfile): any {
  const uad = profile.userAgentData;
  const obj: any = {
    brands: uad.brands.map((b: any) => ({ brand: b.brand, version: b.version })),
    mobile: uad.mobile,
    platform: uad.platform,
  };
  const getHighEntropyValues = async function (hints: string[]): Promise<any> {
    const requested = new Set(Array.isArray(hints) ? hints : []);
    const result: any = {
      brands: obj.brands.slice(),
      mobile: uad.mobile,
      platform: uad.platform,
    };
    const all: any = {
      architecture: uad.architecture,
      bitness: uad.bitness,
      model: uad.model,
      platformVersion: uad.platformVersion,
      uaFullVersion: uad.uaFullVersion,
      fullVersionList: uad.fullVersionList.map((b: any) => ({ brand: b.brand, version: b.version })),
      wow64: uad.wow64,
    };
    for (const key of Object.keys(all)) {
      if (requested.size === 0 || requested.has(key)) {
        result[key] = all[key];
      }
    }
    return result;
  };
  const toJSON = function (): any {
    return { brands: obj.brands, mobile: obj.mobile, platform: obj.platform };
  };
  obj.getHighEntropyValues = hardenFn(getHighEntropyValues, 'getHighEntropyValues');
  obj.toJSON = hardenFn(toJSON, 'toJSON');
  return obj;
}

export function spoofNavigator(profile: DeviceProfile): void {
  const nav = g.navigator;
  if (!nav) return;
  const proto = g.Navigator ? g.Navigator.prototype : Object.getPrototypeOf(nav);
  const n = profile.navigator;

  const defs: Record<string, unknown> = {
    userAgent: profile.userAgent,
    platform: profile.platform,
    language: profile.languages[0] ?? 'en-US',
    languages: profile.languages.slice(),
    hardwareConcurrency: profile.hardware.hardwareConcurrency,
    deviceMemory: profile.hardware.deviceMemory,
    vendor: n.vendor,
    vendorSub: n.vendorSub,
    product: n.product,
    productSub: n.productSub,
    appName: n.appName,
    appCodeName: n.appCodeName,
    appVersion: n.appVersion,
    cookieEnabled: n.cookieEnabled,
    doNotTrack: n.doNotTrack,
    maxTouchPoints: n.maxTouchPoints,
    pdfViewerEnabled: n.pdfViewerEnabled,
    connection: n.connection,
    plugins: buildPlugins(n.plugins),
    mimeTypes: buildMimeTypes(n.mimeTypes),
  };

  const NavClass = g.Navigator;
  for (const [prop, value] of Object.entries(defs)) {
    try {
      defineNativeGetter(proto, prop, value, NavClass);
    } catch {
      /* property may be readonly on instance; fall back to instance */
      try {
        defineNativeGetter(nav, prop, value, NavClass);
      } catch {
        /* ignore */
      }
    }
  }

  // webdriver MUST be false — delete any existing then redefine.
  try {
    delete nav.webdriver;
  } catch {
    /* ignore */
  }
  try {
    delete proto.webdriver;
  } catch {
    /* ignore */
  }
  try {
    defineNativeGetter(proto, 'webdriver', false);
  } catch {
    try {
      defineNativeGetter(nav, 'webdriver', false);
    } catch {
      /* ignore */
    }
  }

  // userAgentData — brands/mobile/platform getters + getHighEntropyValues.
  try {
    defineNativeGetter(proto, 'userAgentData', buildUserAgentData(profile));
  } catch {
    try {
      defineNativeGetter(nav, 'userAgentData', buildUserAgentData(profile));
    } catch {
      /* ignore */
    }
  }

  // javaEnabled / taintEnabled keep native behavior; wrap to be safe if present.
  if (typeof proto.javaEnabled === 'function') {
    const orig = proto.javaEnabled;
    const impl = function (this: any): boolean {
      try {
        return orig.call(this);
      } catch {
        return false;
      }
    };
    wrapNative(proto, 'javaEnabled', impl, 'javaEnabled');
  }
}
