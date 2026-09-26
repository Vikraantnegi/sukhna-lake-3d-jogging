/* Ported from sakura-crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * src/core/toon.js.  Copyright (c) 2026 Kenton Wang.  MIT License -- full text in
 * THIRD_PARTY_LICENSES.md.  One change: the `flatShading` constructor option
 * is dropped.  three r180's MeshToonMaterial has no such property, so it was
 * already ignored (with a console warning per material); `flat` stays in the
 * signature and the cache key, and the look is unchanged.  Added for Sukhna: a
 * `relief` mode and a `terrain` ramp for real terrain under a low sun (see
 * RELIEF_PATCH). */
import * as THREE from 'three';
import { PAL } from './palette.js';

/* ------------------------------------------------------------------ *
 * Cel shading
 *
 * Everything in the scene uses MeshToonMaterial with a hand-authored
 * gradient ramp, so direct sunlight is quantised into 2-4 flat bands
 * instead of a smooth falloff.  On top of that we patch the toon BRDF so
 * the darker bands are *tinted* toward a cool violet rather than simply
 * being a darker version of the base colour -- that hue shift in shadow
 * is most of what separates "anime cel" from "low-poly 3D".
 * ------------------------------------------------------------------ */

const RAMPS = {
  2: [96, 255],
  3: [92, 178, 255],
  4: [80, 142, 202, 255],
  5: [74, 124, 172, 214, 255],
  // high-key ramps: for blossom and other pale masses that must stay light
  // even on the shadow side
  soft: [180, 255],
  soft3: [172, 214, 255],
  // Sukhna: real terrain in relief mode -- flat sunlit ground at full light,
  // only slopes turned away from the sun drop (and take the cool tint)
  terrain: [150, 246, 255],
};

const rampCache = new Map();

export function gradientMap(bands = 3) {
  const key = bands;
  if (rampCache.has(key)) return rampCache.get(key);
  const stops = RAMPS[bands] || RAMPS[3];
  const data = new Uint8Array(stops.length * 4);
  for (let i = 0; i < stops.length; i++) {
    data[i * 4 + 0] = stops[i];
    data[i * 4 + 1] = stops[i];
    data[i * 4 + 2] = stops[i];
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

const TOON_CHUNK = 'lights_toon_pars_fragment';
const TOON_LINE =
  'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;';
const TOON_PATCH = `
	vec3 celBand = getGradientIrradiance( geometryNormal, directLight.direction );
	vec3 irradiance = celBand * mix( uShadowTint, vec3( 1.0 ), celBand ) * directLight.color;`;

/* Relief mode (Sukhna).  A January morning sun is 0-20° up, which puts flat
 * ground at N·L = sin(elevation) -- right on the default ramp's band edge at
 * 1/3 -- so a 2% wobble in real DEM terrain flips bands and the ground turns
 * to camouflage.  In relief mode the band is picked from N·L *minus* up·L:
 * flat ground always lands mid-ramp whatever the sun's height, and only real
 * slopes turned toward or away from the sun change band.  The light's
 * intensity and colour still come from the sun, so a low sun still dims. */
const RELIEF_PATCH = `
	vec3 celUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
	float celD = dot( geometryNormal, directLight.direction ) - dot( celUp, directLight.direction );
	vec3 celBand = vec3( texture2D( gradientMap, vec2( celD * 0.5 + 0.5, 0.0 ) ).r );
	vec3 irradiance = celBand * mix( uShadowTint, vec3( 1.0 ), celBand ) * directLight.color;`;

let patchAvailable = false;
let patchedChunk = '';
let reliefChunk = '';
{
  const src = THREE.ShaderChunk[TOON_CHUNK];
  if (src && src.includes(TOON_LINE)) {
    patchedChunk = 'uniform vec3 uShadowTint;\n' + src.replace(TOON_LINE, TOON_PATCH);
    reliefChunk = 'uniform vec3 uShadowTint;\n' + src.replace(TOON_LINE, RELIEF_PATCH);
    patchAvailable = true;
  }
}

/** Tint the shadow side of a toon material toward a cool hue. */
function applyShadowTint(mat, tint, relief = false) {
  if (!patchAvailable) return mat;
  const uni = { value: new THREE.Color(tint) };
  mat.userData.shadowTint = uni;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShadowTint = uni;
    shader.fragmentShader = shader.fragmentShader.replace(
      `#include <${TOON_CHUNK}>`,
      relief ? reliefChunk : patchedChunk
    );
  };
  const hex = new THREE.Color(tint).getHexString();
  mat.customProgramCacheKey = () => 'celTint_' + hex + (relief ? '_relief' : '');
  return mat;
}

const matCache = new Map();

/**
 * Cel-shaded material factory.  Results are cached by parameter signature so
 * the whole street ends up sharing a few dozen shader programs.
 */
export function cel(opts = {}) {
  const {
    color = 0xffffff,
    bands = 3,
    tint = 0x6c5f8c,
    flat = true,
    map = null,
    emissive = null,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    alphaTest = 0,
    depthWrite = null,
    fog = true,
    alphaMap = null,
    vertexColors = false,
    relief = false,
    cache = true,
  } = opts;

  const key = cache && !map && !alphaMap
    ? [color, bands, tint, flat, emissive, emissiveIntensity, transparent,
       opacity, side, alphaTest, depthWrite, fog, vertexColors, relief].join('|')
    : null;
  if (key && matCache.has(key)) return matCache.get(key);

  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(bands),
    map,
    alphaMap,
    transparent,
    opacity,
    side,
    alphaTest,
    fog,
    vertexColors,
    emissive: emissive === null ? 0x000000 : emissive,
    emissiveIntensity,
  });
  if (depthWrite !== null) mat.depthWrite = depthWrite;
  applyShadowTint(mat, tint, relief);
  if (key) matCache.set(key, mat);
  return mat;
}

const flatCache = new Map();

/** Unlit flat colour -- for sky, distant silhouettes, glowing panels, glass. */
export function flat(opts = {}) {
  const {
    color = 0xffffff,
    map = null,
    transparent = false,
    opacity = 1,
    side = THREE.FrontSide,
    alphaTest = 0,
    depthWrite = null,
    fog = true,
    cache = true,
    toneMapped = true,
  } = opts;
  const key = cache && !map
    ? [color, transparent, opacity, side, alphaTest, depthWrite, fog, toneMapped].join('|')
    : null;
  if (key && flatCache.has(key)) return flatCache.get(key);
  const mat = new THREE.MeshBasicMaterial({
    color, map, transparent, opacity, side, alphaTest, fog, toneMapped,
  });
  if (depthWrite !== null) mat.depthWrite = depthWrite;
  if (key) flatCache.set(key, mat);
  return mat;
}

/** Shared material shorthands used all over the world builders. */
export const MAT = {
  get ink() { return flat({ color: PAL.ink, fog: false }); },
  get glassDark() { return flat({ color: PAL.glassDark }); },
};
