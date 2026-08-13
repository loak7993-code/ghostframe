// WebGL / WebGL2 fingerprint spoofing — vendor, renderer, parameters, extensions, attributes.

import type { DeviceProfile } from '../types/profile.js';
import { wrapNative } from './harden.js';

const g = globalThis as any;

const UNMASKED_VENDOR = 37445;
const UNMASKED_RENDERER = 37446;
const VENDOR = 7936;
const RENDERER = 7937;
const MAX_TEXTURE_SIZE = 3379;
const MAX_VIEWPORT_DIMS = 3386;
const MAX_RENDERBUFFER_SIZE = 34024;
const MAX_VERTEX_ATTRIBS = 34921;
const MAX_VARYING_VECTORS = 36348;
const MAX_VERTEX_UNIFORM_VECTORS = 36347;
const MAX_FRAGMENT_UNIFORM_VECTORS = 36349;
const MAX_COMBINED_TEXTURE_IMAGE_UNITS = 35661;
const MAX_CUBE_MAP_TEXTURE_SIZE = 34076;
const MAX_TEXTURE_IMAGE_UNITS = 34930;
const ALIASED_LINE_WIDTH_RANGE = 2849;
const ALIASED_POINT_SIZE_RANGE = 28374;
const SHADING_LANGUAGE_VERSION = 35724;
const VERSION = 7938;

function buildParamMap(profile: DeviceProfile): Record<number, unknown> {
  const gpu = profile.gpu;
  return {
    [UNMASKED_VENDOR]: gpu.unmaskedVendor ?? gpu.vendor,
    [UNMASKED_RENDERER]: gpu.unmaskedRenderer ?? gpu.renderer,
    [VENDOR]: gpu.vendor,
    [RENDERER]: gpu.renderer,
    [MAX_TEXTURE_SIZE]: gpu.maxTextureSize,
    [MAX_VIEWPORT_DIMS]: new Int32Array([gpu.maxViewportDims[0], gpu.maxViewportDims[1]]),
    [MAX_RENDERBUFFER_SIZE]: gpu.maxRenderBufferSize,
    [MAX_VERTEX_ATTRIBS]: gpu.maxVertexAttribs,
    [MAX_VARYING_VECTORS]: gpu.maxVaryingVectors,
    [MAX_VERTEX_UNIFORM_VECTORS]: gpu.maxVertexUniformVectors,
    [MAX_FRAGMENT_UNIFORM_VECTORS]: gpu.maxFragmentUniformVectors,
    [MAX_COMBINED_TEXTURE_IMAGE_UNITS]: gpu.maxCombinedTextureImageUnits,
    [MAX_CUBE_MAP_TEXTURE_SIZE]: gpu.maxCubeMapTextureSize,
    [MAX_TEXTURE_IMAGE_UNITS]: gpu.maxTextureImageUnits,
    [ALIASED_LINE_WIDTH_RANGE]: new Float32Array([gpu.aliasedLineWidthRange[0], gpu.aliasedLineWidthRange[1]]),
    [ALIASED_POINT_SIZE_RANGE]: new Float32Array([gpu.aliasedPointSizeRange[0], gpu.aliasedPointSizeRange[1]]),
    [SHADING_LANGUAGE_VERSION]: gpu.shadingLanguageVersion,
    [VERSION]: gpu.version,
  };
}

function patchProto(proto: any, profile: DeviceProfile): void {
  if (!proto) return;
  const params = buildParamMap(profile);
  const gpu = profile.gpu;

  if (typeof proto.getParameter === 'function') {
    const origGetParameter = proto.getParameter;
    const getParameterImpl = function (this: any, ...args: any[]): any {
      const p = args[0];
      if (Object.prototype.hasOwnProperty.call(params, p)) {
        return params[p as number];
      }
      return origGetParameter.apply(this, args);
    };
    wrapNative(proto, 'getParameter', getParameterImpl, 'getParameter');
  }

  if (typeof proto.getExtension === 'function') {
    const origGetExtension = proto.getExtension;
    const getExtensionImpl = function (this: any, ...args: any[]): any {
      const name = args[0];
      if (name === 'WEBGL_debug_renderer_info') {
        return { UNMASKED_VENDOR_WEBGL: UNMASKED_VENDOR, UNMASKED_RENDERER_WEBGL: UNMASKED_RENDERER };
      }
      if (Array.isArray(gpu.extensions) && !gpu.extensions.includes(name)) {
        return null;
      }
      if (origGetExtension) {
        return origGetExtension.apply(this, args);
      }
      return {};
    };
    wrapNative(proto, 'getExtension', getExtensionImpl, 'getExtension');
  }

  if (typeof proto.getSupportedExtensions === 'function') {
    const getSupportedExtensionsImpl = function (): string[] | null {
      return gpu.extensions && gpu.extensions.length ? gpu.extensions.slice() : null;
    };
    wrapNative(proto, 'getSupportedExtensions', getSupportedExtensionsImpl, 'getSupportedExtensions');
  }

  if (typeof proto.getContextAttributes === 'function') {
    const origGetContextAttributes = proto.getContextAttributes;
    const getContextAttributesImpl = function (this: any): any {
      let base: any;
      try {
        base = origGetContextAttributes ? origGetContextAttributes.call(this) : {};
      } catch {
        base = {};
      }
      return { ...base, antialias: gpu.antialias };
    };
    wrapNative(proto, 'getContextAttributes', getContextAttributesImpl, 'getContextAttributes');
  }
}

export function spoofWebGL(profile: DeviceProfile): void {
  if (g.WebGLRenderingContext) patchProto(g.WebGLRenderingContext.prototype, profile);
  if (g.WebGL2RenderingContext) patchProto(g.WebGL2RenderingContext.prototype, profile);
}
