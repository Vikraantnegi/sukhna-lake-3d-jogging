import * as THREE from 'three';
import { sunPosition, localDate, hhmm } from './sun.js';
import { azimuthDir } from '../world/frame.js';

/* ------------------------------------------------------------------ *
 * Time of day (plan §6).
 *
 * A clock on the real date (15 Jan 2027), running at 4x real time; T jumps
 * between the four presets.  The look is a set of keyframes keyed to the
 * *sun's elevation* (from core/sun.js, NOAA), not to the clock, so the
 * light always matches where the sun really is.  Each keyframe holds the
 * sky, the lights, the haze (colour and density: the view distance), the
 * grade, the water, the ridges, the clouds, the mist and the stars; the
 * look between keyframes is a straight blend, and weather (core/weather.js)
 * is folded in on top.
 *
 * The look is then pushed to everything that depends on the time -- the
 * `targets` below.  Nothing else in the scene needs to know the time.
 * ------------------------------------------------------------------ */

export const PRESETS = [
  { key: 'predawn', label: 'pre-dawn' },
  { key: 'sunrise', label: 'sunrise' },
  { key: 'golden', label: 'golden hour' },
  { key: 'bright', label: 'bright morning' },
];

// colours as hex, amounts 0..1; `fog` is FogExp2 density (per metre)
const KEYS = [
  { el: -10,
    skyTop: 0x121a38, skyMid: 0x2e3764, skyHaze: 0x5d5f86, glow: 0x9a6a7a, glowAmt: 0.25, glowPow: 3, sunAmt: 0, stars: 1,
    cloud: 0x4a4e70, cloudShade: 0x33385a, fogCol: 0x444a6c, fog: 3.6e-4,
    sun: 0xff9a5a, sunI: 0, fill: 0x6f7fc0, fillI: 0.55, bounceI: 0.15, hemiSky: 0x6a74a8, hemiGround: 0x3a3650, hemiI: 0.6,
    shadowTint: 0x7f80b8, lightTint: 0xd8dcf0, sat: 0.9, lift: 0.05, warmth: 0.0, vignette: 0.26,
    water: 0x3c4466, waterSky: 0x5d5f86, glitter: 0, ridge: 0x2f3656, ridgeHaze: 0x5d5f86, mist: 1 },
  { el: -5.9, // pre-dawn, civil dawn (06:55)
    skyTop: 0x2c3a6a, skyMid: 0x7a7fa8, skyHaze: 0xd6a088, glow: 0xf09060, glowAmt: 0.55, glowPow: 3, sunAmt: 0, stars: 0.35,
    cloud: 0xa895b0, cloudShade: 0x77709a, fogCol: 0xa598b0, fog: 3.8e-4,
    sun: 0xff9a5a, sunI: 0, fill: 0x8090cc, fillI: 0.8, bounceI: 0.22, hemiSky: 0x9aa0cc, hemiGround: 0x5e5874, hemiI: 0.85,
    shadowTint: 0x8f8cc0, lightTint: 0xece2ee, sat: 0.95, lift: 0.05, warmth: 0.03, vignette: 0.22,
    water: 0x6f7090, waterSky: 0xc2a4b0, glitter: 0, ridge: 0x6b6a8c, ridgeHaze: 0xb89aa4, mist: 1 },
  { el: -0.9, // sunrise, upper limb on the horizon (07:19)
    skyTop: 0x5d7fc4, skyMid: 0xd9a57a, skyHaze: 0xe7a35a, glow: 0xff9a4a, glowAmt: 0.9, glowPow: 5, sunAmt: 1, stars: 0,
    cloud: 0xf4c6a0, cloudShade: 0xb89ab0, fogCol: 0xdca47a, fog: 3.4e-4,
    sun: 0xff9a5a, sunI: 0.9, fill: 0x8f9fd8, fillI: 0.9, bounceI: 0.26, hemiSky: 0xd0b8c8, hemiGround: 0x8a7a9a, hemiI: 0.9,
    shadowTint: 0x9d98c8, lightTint: 0xffe8d0, sat: 1.05, lift: 0.04, warmth: 0.16, vignette: 0.18,
    water: 0xc9a898, waterSky: 0xe7b08a, glitter: 1, ridge: 0x9a8fa8, ridgeHaze: 0xe0a070, mist: 0.9 },
  { el: 4.0, // golden hour (07:45)
    skyTop: 0x7fa6e0, skyMid: 0xe0c4a8, skyHaze: 0xf2c894, glow: 0xffc070, glowAmt: 0.6, glowPow: 7, sunAmt: 1, stars: 0,
    cloud: 0xfbe6cc, cloudShade: 0xd8c0c4, fogCol: 0xe8cfb0, fog: 2.2e-4,
    sun: 0xffc88a, sunI: 1.9, fill: 0x9fb0e8, fillI: 1.0, bounceI: 0.3, hemiSky: 0xf0d8c8, hemiGround: 0xa89ab8, hemiI: 1.0,
    shadowTint: 0xa9a0d0, lightTint: 0xfff0d8, sat: 1.1, lift: 0.035, warmth: 0.12, vignette: 0.16,
    water: 0xb8a88a, waterSky: 0xf2d0a8, glitter: 0.8, ridge: 0xa89cb0, ridgeHaze: 0xf0c898, mist: 0.35 },
  { el: 10,
    skyTop: 0x6d9eea, skyMid: 0xbcd0ec, skyHaze: 0xe2dcd6, glow: 0xffe0b0, glowAmt: 0.3, glowPow: 8, sunAmt: 1, stars: 0,
    cloud: 0xfbf4ea, cloudShade: 0xe0dce6, fogCol: 0xd8d8de, fog: 1.6e-4,
    sun: 0xffe2b8, sunI: 2.15, fill: 0xa6b8f0, fillI: 1.05, bounceI: 0.32, hemiSky: 0xe0e8f8, hemiGround: 0xb0a2c0, hemiI: 1.08,
    shadowTint: 0xaba6d0, lightTint: 0xfff4e0, sat: 1.12, lift: 0.032, warmth: 0.08, vignette: 0.15,
    water: 0x9a9ea6, waterSky: 0xd6dce6, glitter: 0.6, ridge: 0xa3a8bc, ridgeHaze: 0xdadce2, mist: 0.02 },
  { el: 19.8, // bright morning (09:15): the base palette, photo r2
    skyTop: 0x6fa3f5, skyMid: 0xa9cdf5, skyHaze: 0xc9e0f7, glow: 0xfff1d8, glowAmt: 0.15, glowPow: 10, sunAmt: 1, stars: 0,
    cloud: 0xfbfaf6, cloudShade: 0xe2e6f0, fogCol: 0xc9dcee, fog: 1.3e-4,
    sun: 0xfff1d8, sunI: 2.25, fill: 0xa9bdf5, fillI: 1.08, bounceI: 0.34, hemiSky: 0xdcecff, hemiGround: 0xb6a6c6, hemiI: 1.12,
    shadowTint: 0xada8d0, lightTint: 0xfff7e8, sat: 1.12, lift: 0.032, warmth: 0.05, vignette: 0.15,
    water: 0x8c96a6, waterSky: 0xc9dcee, glitter: 0.45, ridge: 0xa3adc0, ridgeHaze: 0xc9e0f7, mist: 0 },
];
const isColour = (k) => /sky|glow$|cloud|fogCol|^sun$|fill$|hemiSky|hemiGround|Tint|water|ridge/.test(k) && !/Amt|Pow|I$/.test(k);

// weather colours
const RAIN = { sky: 0x8e949e, haze: 0xa4a8ae, cloud: 0x9a9ea6 };
const FOG = { col: 0xc4c4c6 };

/** Blend the keyframes at elevation `el` into `out` (colours as THREE.Color). */
function lookAt(el, out) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((el - a.el) / (b.el - a.el), 0, 1);
  for (const k in a) {
    if (k === 'el') continue;
    if (isColour(k)) (out[k] ||= new THREE.Color()).set(a[k]).lerp(_cb.set(b[k]), t);
    else if (k === 'fog') out[k] = Math.exp(THREE.MathUtils.lerp(Math.log(a[k]), Math.log(b[k]), t));
    else out[k] = THREE.MathUtils.lerp(a[k], b[k], t);
  }
  return out;
}
const _cb = new THREE.Color();
const _c = new THREE.Color();

export function createTod({ date, lat, lon, presets, start = 'predawn', rate = 4 }) {
  const [Y, M, D] = date;
  const look = {};
  const state = {
    hours: presets[start] ?? presets.predawn,
    rate, // game seconds per real second
    running: true,
    sun: { azimuth: 0, elevation: 0 },
    sunDir: new THREE.Vector3(), lightDir: new THREE.Vector3(), fillDir: new THREE.Vector3(), bounceDir: new THREE.Vector3(),
    look,
  };
  let lastApplied = -1;

  function compute(weather) {
    const p = sunPosition(localDate(Y, M, D, state.hours), lat, lon);
    state.sun = p;
    state.sunDir.copy(azimuthDir(p.azimuth, p.elevation));
    // lights: the key light never drops under 3° (shadows stay sane at the horizon;
    // below the horizon its intensity is already 0)
    state.lightDir.copy(azimuthDir(p.azimuth, Math.max(3, p.elevation)));
    state.fillDir.copy(azimuthDir(p.azimuth + 180, 22));
    state.bounceDir.copy(azimuthDir(p.azimuth + 150, -25));
    lookAt(p.elevation, look);

    // weather on top
    const r = weather?.rain ?? 0, f = weather?.fog ?? 0;
    if (r > 0) {
      for (const k of ['skyTop', 'skyMid']) look[k].lerp(_c.set(RAIN.sky).multiplyScalar(0.55 + 0.45 * lum(look.skyMid)), 0.7 * r);
      look.skyHaze.lerp(_c.set(RAIN.haze).multiplyScalar(0.5 + 0.5 * lum(look.skyHaze)), 0.7 * r);
      look.fogCol.lerp(look.skyHaze, 0.8 * r);
      look.cloud.lerp(_c.set(RAIN.cloud).multiplyScalar(0.5 + 0.5 * lum(look.cloud)), 0.8 * r);
      look.cloudShade.lerp(_c.set(RAIN.cloud).multiplyScalar(0.35 + 0.4 * lum(look.cloud)), 0.8 * r);
      look.fog *= 1 + 2.2 * r;
      look.sunI *= 1 - 0.7 * r; look.sunAmt *= 1 - r; look.glowAmt *= 1 - 0.8 * r; look.stars *= 1 - r;
      look.sat *= 1 - 0.28 * r; look.warmth *= 1 - 0.8 * r;
      look.glitter *= 1 - r;
      look.waterSky.lerp(look.skyHaze, r);
      look.water.lerp(_c.set(0x7a808a).multiplyScalar(0.5 + 0.5 * lum(look.water)), 0.6 * r);
      look.ridge.lerp(look.skyHaze, 0.6 * r); look.ridgeHaze.lerp(look.skyHaze, r);
    }
    look.ripple = r;
    if (f > 0) {
      const dim = 0.45 + 0.55 * lum(look.fogCol) / 0.75; // the fog is as bright as the morning allows
      _c.set(FOG.col).multiplyScalar(Math.min(1, dim));
      for (const k of ['skyTop', 'skyMid', 'skyHaze', 'fogCol', 'cloud', 'cloudShade', 'waterSky', 'ridge', 'ridgeHaze']) look[k].lerp(_c, f);
      look.water.lerp(_c, 0.5 * f);
      // 6-70 m: exp2 density 0.028 leaves ~3% at 6 m and ~98% at 70 m
      look.fog = Math.exp(THREE.MathUtils.lerp(Math.log(look.fog), Math.log(0.028), f));
      look.sunI *= 1 - 0.75 * f; look.sunAmt *= 1 - f; look.glowAmt *= 1 - f; look.stars *= 1 - f;
      look.sat *= 1 - 0.3 * f; look.warmth *= 1 - 0.7 * f; look.glitter *= 1 - f;
      look.fillI *= 1 - 0.2 * f;
      look.hemiI *= 1 + 0.15 * f;
      look.mist *= 1 - f; // the fog *is* the mist now
    }
    look.fogAmt = f;
    return look;
  }

  return {
    state,
    look,
    /** hh:mm on the clock. */
    clock() { return hhmm(state.hours); },
    /** What the HUD calls this part of the morning. */
    label() {
      const el = state.sun.elevation;
      return el < -3 ? 'pre-dawn' : el < 1.5 ? 'sunrise' : el < 9 ? 'golden hour' : 'bright morning';
    },
    /** T: the next preset after the current time (wrapping round to pre-dawn). */
    next() {
      const order = PRESETS.map((p) => ({ ...p, h: presets[p.key] }));
      const nxt = order.find((p) => p.h > state.hours + 1 / 120) || order[0];
      state.hours = nxt.h;
      lastApplied = -1;
      return nxt;
    },
    set(key) { state.hours = presets[key] ?? state.hours; lastApplied = -1; },
    /** Minutes relative to the real sunrise (for the crowd's density). */
    sinceSunrise(sunrise) { return (state.hours - sunrise) * 60; },
    /**
     * Advance the clock and recompute the look.  Returns true when the look
     * changed enough to push to the scene (every ~0.1 game-minute, or when
     * the weather is still easing).
     */
    update(dt, weather) {
      if (state.running) state.hours += (dt * state.rate) / 3600;
      const easing = weather && ((weather.rain > 0 && weather.rain < 1) || (weather.fog > 0 && weather.fog < 1));
      const key = Math.round(state.hours * 600);
      if (key === lastApplied && !easing) return false;
      lastApplied = key;
      compute(weather);
      return true;
    },
    compute,
  };
}

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Push a look to the scene.  `t` holds the targets; any may be missing.
 */
export function applyLook(look, st, t) {
  const { sky, sun, fill, bounce, hemi, scene, renderer, pipeline, lake, mist, ridges } = t;
  if (sky) {
    const u = sky.uniforms;
    u.uTop.value.copy(look.skyTop); u.uMid.value.copy(look.skyMid); u.uHaze.value.copy(look.skyHaze);
    u.uSunDir.value.copy(st.sunDir);
    u.uSunAmt.value = look.sunAmt * THREE.MathUtils.smoothstep(st.sun.elevation, -1.6, -0.6);
    u.uGlow.value.copy(look.glow); u.uGlowAmt.value = look.glowAmt; u.uGlowPow.value = look.glowPow;
    u.uStars.value = look.stars;
    sky.setClouds(look.cloud, look.cloudShade, 1 + 0.4 * (look.ripple || 0));
  }
  if (sun) { sun.color.copy(look.sun); sun.intensity = look.sunI; sun.castShadow = look.sunI > 0.05; }
  if (fill) { fill.color.copy(look.fill); fill.intensity = look.fillI; }
  if (bounce) bounce.intensity = look.bounceI;
  if (hemi) { hemi.color.copy(look.hemiSky); hemi.groundColor.copy(look.hemiGround); hemi.intensity = look.hemiI; }
  if (scene?.fog) { scene.fog.color.copy(look.fogCol); scene.fog.density = look.fog; }
  // three encodes a clear colour set outside a render-target pass to sRGB, but the
  // scene target is linear: pre-decode it, so the background (all you see of the sky
  // in fog, when the far pass is skipped) matches the fogged world exactly
  renderer?.setClearColor(_cb.copy(look.fogCol).convertSRGBToLinear(), 1);
  if (pipeline) {
    const g = pipeline.grade.mat.uniforms;
    g.uShadowTint.value.copy(look.shadowTint); g.uLightTint.value.copy(look.lightTint);
    g.uSaturation.value = look.sat; g.uLift.value = look.lift; g.uWarmth.value = look.warmth; g.uVignette.value = look.vignette;
    // ink fades out nearer in fog, where the world ends at ~70 m
    const i = pipeline.ink.mat.uniforms, f = look.fogAmt || 0;
    i.uFadeStart.value = THREE.MathUtils.lerp(40, 10, f);
    i.uFadeEnd.value = THREE.MathUtils.lerp(98, 55, f);
    pipeline.skipFar = f > 0.97;
  }
  lake?.set({ body: look.water, sky: look.waterSky, sunDir: st.sunDir, sunCol: look.sun, glitter: look.glitter * THREE.MathUtils.smoothstep(st.sun.elevation, -1.5, 0.5), ripple: look.ripple || 0 });
  mist?.set(look.mist, _c.copy(look.fogCol).lerp(_cb.set(0xffffff), 0.35));
  ridges?.setColors(look.ridge.getHex(), look.ridgeHaze.getHex());
}
