/* Structure follows sakura-crossing's src/main.js (renderer setup, the
 * two-light anime rig, the dev `__shot` capture).  Copyright (c) 2026
 * Kenton Wang, MIT License -- see THIRD_PARTY_LICENSES.md. */
import * as THREE from 'three';
import { PAL } from './core/palette.js';
import { Pipeline } from './core/post.js';
import { buildSky } from './core/sky.js';
import { setOutlineResolution } from './core/outline.js';
import { createPerf } from './core/perf.js';
import { clamp } from './core/util.js';
import { sunPosition, localDate } from './core/sun.js';
import { data, spineAt, azimuthDir, yawForAzimuth, azimuthForYaw, LAKE_CENTRE, nearestS } from './world/frame.js';
import { LAYER } from './world/chunks.js';
import { buildWorld } from './world/index.js';

/* ------------------------------------------------------------------ *
 * Sukhna -- entry point.
 *
 * The world is flat, real and 1:1 (plan §4): ENU metres about the
 * promenade midpoint, x = east, z = -north, y = metres above the lake.
 *
 * Two render passes share one frame (core/post.js): a far camera
 * (300 m - 45 km) draws the terrain, water and sky, then a near camera
 * (0.5 m - 1.2 km) draws everything close over a cleared depth buffer.
 *
 * Phase 2: a plain dev viewer (drag to look, WASD to move) and the P
 * overview.  The jogger and its camera replace the viewer in Phase 4; the
 * sun is the real one, fixed at the bright-morning preset until time of
 * day arrives in Phase 6.
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the pipeline asks for the near pass only
renderer.setClearColor(new THREE.Color(PAL.fog), 1);

const scene = new THREE.Scene();
// aerial haze: ~2% at 1 km, ~90% at 12 km (bright morning; Phase 6 keys it to the sun)
scene.fog = new THREE.FogExp2(PAL.fog, 1.3e-4);

const NEAR = { near: 0.5, far: 1200 };
const camera = new THREE.PerspectiveCamera(50, 1, NEAR.near, NEAR.far);
camera.rotation.order = 'YXZ';
camera.layers.set(LAYER.NEAR);
const farCamera = new THREE.PerspectiveCamera(50, 1, 300, 45000);
farCamera.layers.set(LAYER.FAR);

/* --------------------------------- light --------------------------------- */
const SHADOW_HALF = 40;
const sun = new THREE.DirectionalLight(PAL.sun, 2.25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
// cool bounce from the other side, and a weak one from below: coloured shadows, never black
const fill = new THREE.DirectionalLight(PAL.fill, 1.08);
const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.34);
const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.12);
for (const l of [sun, fill, bounce, hemi]) { l.layers.enableAll(); scene.add(l); }
scene.add(sun.target, fill.target, bounce.target);

// the real sun for Sukhna, at the bright-morning preset (09:15, 15 Jan)
const [Y, M, D] = data.sun.date;
const SUN_POS = sunPosition(localDate(Y, M, D, data.sun.presets.bright), data.sun.lat, data.sun.lon);
const SUN_DIR = azimuthDir(SUN_POS.azimuth, SUN_POS.elevation);
const FILL_DIR = azimuthDir(SUN_POS.azimuth + 180, 22);
const BOUNCE_DIR = azimuthDir(SUN_POS.azimuth + 150, -25);

/* --------------------------------- world --------------------------------- */
const sky = buildSky(scene);
const world = buildWorld(scene);
const pipeline = new Pipeline(renderer, scene, camera, { farCamera });
const perf = createPerf(renderer, { show: params.has('stats') });

/* ------------------------------ dev viewer ------------------------------ */
// spawn on the walk near the west end, looking ESE along the dam toward the sunrise
const SPAWN = (() => {
  const f = spineAt(2300);
  return { e: f.e, n: f.n, yaw: yawForAzimuth(data.sun.sunriseAz), pitch: -0.04 };
})();
const EYE = 1.7;
const view = { ...SPAWN };
const keys = new Set();

function applyCamera() {
  camera.position.set(view.e, world.heightAt(view.e, view.n) + EYE, -view.n);
  camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
}

let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || overview) return;
  view.yaw -= e.movementX * 0.0035;
  view.pitch = clamp(view.pitch - e.movementY * 0.0035, -1.3, 1.2);
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyP') setOverview(!overview);
  if (e.code === 'KeyR') Object.assign(view, SPAWN);
  if (e.code === 'KeyO') pipeline.enabled.ink = !pipeline.enabled.ink;
  if (e.code === 'KeyG') pipeline.enabled.grade = !pipeline.enabled.grade;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function moveView(dt) {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 4;
  // camera forward on the ground is (-sin yaw, -cos yaw) in (x, z); n = -z
  const fx = -Math.sin(view.yaw), fz = -Math.cos(view.yaw);
  view.e += (fx * f - fz * s) * speed * dt;
  view.n -= (fz * f + fx * s) * speed * dt;
}

/* ------------------------------ P overview ------------------------------ */
/* An aerial orbit of the whole lake (plan §4): ~1.1 km up, ~2.4 km out. */
let overview = false;
let orbit = 3.6; // radians; starts looking north-east over the dam at the hills
const OV = { radius: 2400, height: 1100 };

function setOverview(on) {
  overview = on;
  // nothing is close from up there, so the near pass can reach much further
  camera.near = on ? 5 : NEAR.near;
  camera.far = on ? 6000 : NEAR.far;
  camera.updateProjectionMatrix();
}

function placeOverview(angle = orbit) {
  const [ce, cn] = LAKE_CENTRE;
  camera.position.set(ce + Math.sin(angle) * OV.radius, OV.height, -(cn + Math.cos(angle) * OV.radius));
  camera.lookAt(ce, 0, -cn);
}

/* -------------------------------- lights -------------------------------- */
const _target = new THREE.Vector3();
function placeLights() {
  // the shadow box follows the viewer; the light keeps the real sun's direction
  if (overview) _target.set(LAKE_CENTRE[0], 0, -LAKE_CENTRE[1]);
  else _target.set(view.e, world.heightAt(view.e, view.n), -view.n);
  const put = (light, dir, dist) => { light.target.position.copy(_target); light.position.copy(_target).addScaledVector(dir, dist); };
  put(sun, SUN_DIR, 200);
  put(fill, FILL_DIR, 100);
  put(bounce, BOUNCE_DIR, 100);
  sky.dome.position.copy(camera.position);
  sky.clouds.position.copy(camera.position);
}

/* ------------------------------- pipeline ------------------------------- */
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline.setSize(w, h);
  setOutlineResolution(pipeline.size.x, pipeline.size.y);
}
window.addEventListener('resize', resize);
resize();

/* --------------------------------- loop --------------------------------- */
const clock = new THREE.Clock();
let flatPanel = null;

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  perf.begin();
  if (overview) {
    orbit += dt * 0.05;
    placeOverview();
  } else {
    moveView(dt);
    applyCamera();
  }
  placeLights();
  world.update(dt, camera.position);
  pipeline.render();
  perf.end(dt);
  flatPanel?.update(camera, dt);
  requestAnimationFrame(frame);
}
frame();

if (params.has('flat')) {
  import('./world/flat.js').then(({ createFlatPanel }) => { flatPanel = createFlatPanel(world); });
}

// expose a little for tuning from the console
window.__scene = { scene, camera, farCamera, renderer, pipeline, world, sky, view, perf, sun, fill, bounce, hemi, THREE, data };

/** GPU-inclusive frame time from the current camera (see core/perf.js). */
window.__bench = (n = 120) => ({
  ...perf.bench(() => pipeline.render(), n),
  internal: `${pipeline.size.x}x${pipeline.size.y}`,
  view: overview ? 'overview' : `s ${nearestS(view.e, view.n).s.toFixed(0)}, az ${azimuthForYaw(view.yaw).toFixed(0)}`,
});

if (import.meta.env?.DEV) {
  /**
   * Dev capture: render one frame at a fixed size and post it to the dev
   * server, which writes `.shots/<name>.jpg`.
   *
   *   __shot('name', 1600, 900, { s: 1200, d: 0, az: 20, pitch: -4 })   on the walk
   *   __shot('name', 1600, 900, { e, n, az, pitch, h })                 anywhere (h: eye height)
   *   __shot('name', 1600, 900, { overview: 200 })                      aerial, from that bearing
   */
  window.__shot = async (name = 'shot', W = 1600, H = 900, opts = {}) => {
    const wasOverview = overview;
    if (opts.overview !== undefined) {
      if (!overview) setOverview(true);
      placeOverview(THREE.MathUtils.degToRad(opts.overview));
    } else {
      if (overview) setOverview(false);
      if (opts.s !== undefined) {
        const f = spineAt(opts.s), d = opts.d || 0;
        view.e = f.e + f.ne * d; view.n = f.n + f.nn * d;
      }
      if (opts.e !== undefined) { view.e = opts.e; view.n = opts.n; }
      if (opts.az !== undefined) view.yaw = yawForAzimuth(opts.az);
      if (opts.pitch !== undefined) view.pitch = THREE.MathUtils.degToRad(opts.pitch);
      applyCamera();
      if (opts.h !== undefined) camera.position.y = world.heightAt(view.e, view.n) + opts.h;
    }
    placeLights();
    world.update(0, camera.position);
    if (opts.ink !== undefined) pipeline.enabled.ink = opts.ink;
    if (opts.grade !== undefined) pipeline.enabled.grade = opts.grade;
    pipeline.forceScale = opts.scale || 1;

    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    pipeline.setSize(W, H);
    setOutlineResolution(pipeline.size.x, pipeline.size.y);
    camera.updateMatrixWorld();
    perf.begin();
    pipeline.render();
    const counts = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };

    const off = document.createElement('canvas');
    const outW = opts.outW || W;
    off.width = outW;
    off.height = Math.round((outW * H) / W);
    off.getContext('2d').drawImage(canvas, 0, 0, off.width, off.height);
    const dataUrl = off.toDataURL('image/jpeg', opts.quality || 0.86);

    // hand the canvas back to the window
    pipeline.forceScale = 0;
    if (overview !== wasOverview) setOverview(wasOverview);
    resize();
    const r = await fetch('/__shot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, data: dataUrl }),
    });
    return { ...(await r.json()), ...counts };
  };
}
