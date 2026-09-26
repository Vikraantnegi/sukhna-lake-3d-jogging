/* Structure follows sakura-crossing's src/main.js (renderer setup, the
 * two-light anime rig re-seated in the local surface frame, the P planet view
 * and the dev `__shot` capture).  Copyright (c) 2026 Kenton Wang, MIT License
 * -- see THIRD_PARTY_LICENSES.md. */
import * as THREE from 'three';
import { PAL } from './core/palette.js';
import { Pipeline } from './core/post.js';
import { buildSky } from './core/sky.js';
import { setOutlineResolution } from './core/outline.js';
import { createPerf } from './core/perf.js';
import { clamp } from './core/util.js';
import { R, CENTER, CIRCUMFERENCE, basisAt, positionAt, surfaceQuat, wrapX, flatAt } from './world/planet.js';
import { buildWorld } from './world/index.js';

/* ------------------------------------------------------------------ *
 * Sukhna -- entry point.
 *
 * Phase 1: the reference's renderer, light rig and 3D-to-2D pipeline
 * around an empty planet.  The camera here is a plain dev viewer (drag to
 * look, WASD to move along the surface); the jogger and its third-person
 * camera replace it in Phase 4.
 *
 * Lighting is the classic two-light anime setup: one warm quantised key
 * for the sun, one cool bounce fill from the opposite side, and a
 * hemisphere with a violet ground colour so nothing in shadow ever goes
 * black.  The sun is a fixed direction in the local surface frame for now;
 * Phase 6 drives it from the real sun position for Sukhna.
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
renderer.setClearColor(new THREE.Color(PAL.fog), 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PAL.fog, 60, 320);

const camera = new THREE.PerspectiveCamera(46, 1, 0.25, 600);
camera.rotation.order = 'YXZ';

/* --------------------------------- light --------------------------------- */
const SHADOW_HALF = 34;
const sun = new THREE.DirectionalLight(PAL.sun, 2.25);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 200 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

// Cool bounce from the opposite quarter: an anime background has *coloured*
// shadows, not dark ones, so this carries most of the shadow side.
const fill = new THREE.DirectionalLight(PAL.fill, 1.08);
scene.add(fill, fill.target);

// a second, weaker bounce from below-front stops undersides going flat black
const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.34);
scene.add(bounce, bounce.target);

const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.12);
scene.add(hemi);

/** Light directions in the local surface frame (x east along the promenade,
 * y up, z north toward the lake).  Placeholder sun until Phase 6. */
const SUN_LOCAL = new THREE.Vector3(-52, 62, 56);
const FILL_LOCAL = new THREE.Vector3(48, 26, -44);
const BOUNCE_LOCAL = new THREE.Vector3(10, -18, 40);
const _off = new THREE.Vector3();

/** Move a light so its direction stays fixed relative to the local surface. */
function seatLight(light, local, basis, origin) {
  _off.set(0, 0, 0)
    .addScaledVector(basis.east, local.x)
    .addScaledVector(basis.up, local.y)
    .addScaledVector(basis.north, local.z);
  light.target.position.copy(origin);
  light.position.copy(origin).add(_off);
}

/* --------------------------------- world --------------------------------- */
const sky = buildSky(scene, 500);
const world = buildWorld(scene);
const pipeline = new Pipeline(renderer, scene, camera);
const perf = createPerf(renderer, { show: params.has('stats') });

/* ------------------------------ dev viewer ------------------------------ */
/* Flat authoring coordinates, like the reference's player: yaw 0 looks toward
 * -z (the city), -π/2 looks east along the promenade, π looks at the lake. */
const EYE = 1.7;
const SPAWN = { x: 0, z: -1.5, yaw: -Math.PI / 2 + 0.35, pitch: -0.08 };
const view = { ...SPAWN };
const keys = new Set();
const _surfQ = new THREE.Quaternion();
const _localQ = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

function applyCamera() {
  surfaceQuat(view.x, view.z, _surfQ);
  _localQ.setFromEuler(_euler.set(view.pitch, view.yaw, 0, 'YXZ'));
  positionAt(view.x, world.heightAt(view.x, view.z) + EYE, view.z, camera.position);
  camera.quaternion.copy(_surfQ).multiply(_localQ);
}

let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', (e) => { dragging = false; canvas.releasePointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || planetView) return;
  view.yaw -= e.movementX * 0.0035;
  view.pitch = clamp(view.pitch - e.movementY * 0.0035, -1.15, 1.05);
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyP') setPlanetView(!planetView);
  if (e.code === 'KeyR') Object.assign(view, SPAWN);
  // two quiet toggles, handy for seeing what the ink and grade passes do
  if (e.code === 'KeyO') pipeline.enabled.ink = !pipeline.enabled.ink;
  if (e.code === 'KeyG') pipeline.enabled.grade = !pipeline.enabled.grade;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function moveView(dt) {
  const f = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (!f && !s) return;
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 12 : 4;
  // forward in the flat plane is (-sin yaw, -cos yaw); x is divided by
  // cos(z/R) so a metre walked is a metre on the sphere at any latitude
  const fx = -Math.sin(view.yaw), fz = -Math.cos(view.yaw);
  const dx = (fx * f + -fz * s) * speed * dt;
  const dz = (fz * f + fx * s) * speed * dt;
  view.z = clamp(view.z + dz, -0.24 * CIRCUMFERENCE, 0.24 * CIRCUMFERENCE);
  view.x = wrapX(view.x + dx / Math.cos(view.z / R));
}

/* ------------------------------ planet view ------------------------------ */
let planetView = false;
let orbit = 0.6;
const orbitDir = new THREE.Vector3();
const savedFog = scene.fog;
const GROUND_FAR = 600;
const DOME_R = 500;

function setPlanetView(on) {
  planetView = on;
  scene.fog = on ? null : savedFog;
  camera.far = on ? R * 10 : GROUND_FAR;
  camera.updateProjectionMatrix();
  const s = sun.shadow.camera;
  const half = on ? R * 1.15 : SHADOW_HALF;
  Object.assign(s, { left: -half, right: half, top: half, bottom: -half, far: on ? R * 6 : 200 });
  s.updateProjectionMatrix();
  sky.clouds.visible = !on;
}

function placeOrbitCamera(tilt = 0.8, dist = 3.3) {
  orbitDir.set(Math.sin(orbit) * tilt, 1.0, Math.cos(orbit) * tilt).normalize();
  camera.position.copy(CENTER).addScaledVector(orbitDir, R * dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(CENTER);
  // a fixed sun so the whole globe is lit coherently from outside
  sun.target.position.copy(CENTER);
  sun.position.copy(CENTER).add(_off.set(-1.05, 0.95, 0.75).multiplyScalar(R * 2.2));
  const axes = { east: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), north: new THREE.Vector3(0, 0, 1) };
  seatLight(fill, FILL_LOCAL, axes, CENTER);
  hemi.position.set(0, 1, 0);
  bounce.visible = false;
  // the dome becomes a backdrop around the whole planet
  sky.dome.position.copy(CENTER);
  sky.dome.quaternion.identity();
  sky.dome.scale.setScalar((R * 4.6) / DOME_R);
}

const _shadowTarget = new THREE.Vector3();
const _flat = { x: 0, z: 0, y: 0 };

function placeGroundRig() {
  applyCamera();
  bounce.visible = true;
  // Lighting is pinned to the local surface frame rather than to world
  // space, so the promenade is lit the same way wherever you are on it.
  const b = basisAt(view.x, view.z);
  positionAt(view.x, 0, view.z, _shadowTarget);
  seatLight(sun, SUN_LOCAL, b, _shadowTarget);
  seatLight(fill, FILL_LOCAL, b, _shadowTarget);
  seatLight(bounce, BOUNCE_LOCAL, b, _shadowTarget);
  hemi.position.copy(b.up);
  // The dome trails the camera *and* turns with the surface frame: the
  // loop goes all the way round, so world +Y is sideways a quarter-lap on.
  flatAt(camera.position, _flat);
  sky.dome.position.copy(camera.position);
  sky.dome.scale.setScalar(1);
  surfaceQuat(_flat.x, _flat.z, sky.dome.quaternion);
  sky.clouds.position.copy(camera.position);
  sky.clouds.quaternion.copy(sky.dome.quaternion);
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

function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  perf.begin();

  if (planetView) {
    orbit += dt * 0.09;
    placeOrbitCamera();
  } else {
    moveView(dt);
    placeGroundRig();
  }
  world.update(dt);

  pipeline.render();
  perf.end(dt);
  requestAnimationFrame(frame);
}
frame();

// expose a little for tuning from the console
window.__scene = { scene, camera, renderer, pipeline, world, sky, view, perf, sun, fill, bounce, hemi, THREE };

/** GPU-inclusive frame time from the current camera (see core/perf.js). */
window.__bench = (n = 120) => ({
  ...perf.bench(() => pipeline.render(), n),
  internal: `${pipeline.size.x}x${pipeline.size.y}`,
  view: planetView ? 'planet' : 'ground',
});

if (import.meta.env?.DEV) {
  /**
   * Dev capture: render one frame at a fixed size and post it to the dev
   * server, which writes `.shots/<name>.jpg`.  The camera is always resynced
   * here, because the rAF loop is throttled when the page is not visible.
   *
   *   __shot('name', 1600, 900, { pos: [x, 0, z], yaw, pitch })
   *   __shot('planet', 1600, 900, { orbit: 0.6, tilt: 0.8, dist: 3.3 })
   */
  window.__shot = async (name = 'shot', W = 1600, H = 900, opts = {}) => {
    if (opts.pos) { view.x = opts.pos[0]; view.z = opts.pos[2]; }
    if (opts.yaw !== undefined) view.yaw = opts.yaw;
    if (opts.pitch !== undefined) view.pitch = opts.pitch;
    if (opts.orbit !== undefined) {
      if (!planetView) setPlanetView(true);
      orbit = opts.orbit;
      placeOrbitCamera(opts.tilt ?? 0.8, opts.dist ?? 3.3);
    } else {
      if (planetView) setPlanetView(false);
      placeGroundRig();
    }
    if (opts.ink !== undefined) pipeline.enabled.ink = opts.ink;
    if (opts.grade !== undefined) pipeline.enabled.grade = opts.grade;
    pipeline.forceScale = opts.scale || 1;

    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    pipeline.setSize(W, H);
    setOutlineResolution(pipeline.size.x, pipeline.size.y);
    perf.begin();
    pipeline.render();
    const counts = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };

    const off = document.createElement('canvas');
    const outW = opts.outW || W;
    off.width = outW;
    off.height = Math.round((outW * H) / W);
    off.getContext('2d').drawImage(canvas, 0, 0, off.width, off.height);
    const data = off.toDataURL('image/jpeg', opts.quality || 0.86);

    // hand the canvas back to the window
    pipeline.forceScale = 0;
    resize();
    const r = await fetch('/__shot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    return { ...(await r.json()), ...counts };
  };
}
