// Hardening foundation — makes spoofed functions/getters report as native.
// A single Proxy on Function.prototype.toString intercepts toString calls on
// registered spoofed functions and returns `function name() { [native code] }`.
// Calls on non-spoofed functions fall through to the real toString (no leak).
//
// Critical detail (creepjs/ipfighter "lies" math): overridden methods must behave
// like built-in non-constructor functions — they must expose NO own "prototype"
// property. Plain `function(){}` wrappers DO have one; ASSIGNING undefined still
// leaves hasOwnProperty('prototype') === true. Only method-shorthand functions
// have genuinely no prototype property while keeping a dynamic `this`.

// A generic callable — the spoofed surface overrides browser-native prototypes that
// are intentionally untyped at runtime.
export type AnyFn = (...args: any[]) => any;

const spoofed: WeakMap<AnyFn, string> = new WeakMap();
let installed = false;

export function nativeToStringString(name: string): string {
  return `function ${name}() { [native code] }`;
}

export function installToStringTrap(): void {
  if (installed) return;
  const real = Function.prototype.toString as (this: AnyFn) => string;
  const trap = new Proxy(real, {
    apply(target: any, thisArg: any, args: any[]): any {
      try {
        if (thisArg !== null && thisArg !== undefined && spoofed.has(thisArg)) {
          return spoofed.get(thisArg);
        }
      } catch {
        /* ignore */
      }
      return Reflect.apply(target, thisArg, args) as string;
    },
  }) as unknown as (this: AnyFn) => string;
  // The trap itself must look native.
  spoofed.set(trap as unknown as AnyFn, nativeToStringString('toString'));
  Function.prototype.toString = trap;
  installed = true;
}

// Build an override with identical built-in surface properties:
//  - correct .name (method shorthand gives it for free)
//  - correct .length (configurable in modern JS, as on natives)
//  - no own "prototype", no "arguments"/"caller" own props
//  - dynamic `this` forwarding
export function makeNative(name: string, length: number, impl: AnyFn): AnyFn {
  const holder: Record<string, AnyFn> = {
    [name](this: unknown, ...args: any[]): any {
      return impl.apply(this, args);
    },
  };
  const fn = holder[name];
  if (fn.length !== length) {
    try { Object.defineProperty(fn, 'length', { value: length, configurable: true }); } catch { /* ignore */ }
  }
  installToStringTrap();
  spoofed.set(fn, nativeToStringString(name));
  return fn;
}

export function hardenFn(fn: AnyFn, nativeName: string): AnyFn {
  // Register and RETURN a prototype-free wrapper. Callers must use the returned fn.
  const wrapped = makeNative(nativeName, fn.length, fn);
  return wrapped;
}

// Register an existing function in the toString map WITHOUT altering its shape.
// Use for genuine constructors (e.g. RTCPeerConnection) that must keep .prototype.
export function registerNativeFn(fn: AnyFn, nativeName: string): AnyFn {
  installToStringTrap();
  spoofed.set(fn, nativeToStringString(nativeName));
  return fn;
}

export function defineNativeGetter(obj: object, prop: string, value: unknown, expectedCtor?: new (...args: any[]) => any): void {
  const getter = makeNative(`get ${prop}`, 0, function (this: unknown): unknown {
    // Real native getters throw TypeError when invoked with the wrong receiver.
    // Detectors probe c.call(null) and expect exactly this behavior.
    if (expectedCtor && typeof expectedCtor === 'function') {
      const ok = this !== null && this !== undefined && this instanceof expectedCtor;
      if (!ok) throw new TypeError('Illegal invocation');
    }
    return value;
  });
  Object.defineProperty(obj, prop, {
    get: getter,
    configurable: true,
    enumerable: true,
  });
}

export function wrapNative(
  obj: object,
  prop: string,
  impl: AnyFn,
  nativeName: string,
): AnyFn {
  // capture original to keep arity + call-through default
  let origLen: number;
  try {
    const orig = (obj as Record<string, unknown>)[prop];
    origLen = typeof orig === 'function' ? (orig as AnyFn).length : 0;
  } catch {
    origLen = 0;
  }
  const wrapper = makeNative(nativeName, origLen, impl);
  Object.defineProperty(obj, prop, {
    value: wrapper,
    configurable: true,
    writable: true,
    enumerable: true,
  });
  return wrapper;
}
