/* Structure follows sakura-crossing's src/main.js (renderer setup, the
 * two-light anime rig, the dev `__shot` capture).  Copyright (c) 2026
 * Kenton Wang, MIT License -- see THIRD_PARTY_LICENSES.md. */
import { track, deviceType, heartbeat } from './core/analytics.js';
import * as THREE from 'three';
import { PAL } from './core/palette.js';
import { Pipeline } from './core/post.js';
import { buildSky } from './core/sky.js';
import { setOutlineResolution } from './core/outline.js';
import { createPerf } from './core/perf.js';
import { Jogger } from './core/jogger.js';
import { createCameraRig } from './core/camera.js';
import { createHud } from './core/hud.js';
import { createTouch, isTouch } from './core/touch.js';
import { data, L, spineAt, azimuthDir, yawForAzimuth, azimuthForYaw, nearestS, LAKE_CENTRE } from './world/frame.js';
import { groundAt } from './world/terrain.js';
import { LAYER } from './world/chunks.js';
import { buildWorld } from './world/index.js';
import { createCollider } from './world/collide.js';
import { createInteractions } from './people/interact.js';
import { createTod, applyLook } from './core/tod.js';
import { createWeather } from './core/weather.js';
import { createSound } from './core/sound.js';
import { Q, TIERS, lower } from './core/quality.js';
import { createBoat } from './core/boat.js';
import { mulberry32 } from './core/util.js';
import { OUTFITS } from './people/body.js';

/* ------------------------------------------------------------------ *
 * Sukhna -- entry point.
 *
 * The world is flat, real and 1:1 (plan §4): ENU metres about the
 * promenade midpoint, x = east, z = -north, y = metres above the lake.
 * Two render passes share one frame (core/post.js): a far camera
 * (300 m - 45 km) draws the terrain, water and sky, then a near camera
 * (0.5 m - 1.2 km) draws everything close over a cleared depth buffer.
 *
 * Time of day (core/tod.js) runs the real sun on 15 Jan 2027 at 4x from
 * sunrise (07:19); its look (sky, lights, haze, grade, water, mist) is pushed to the
 * scene whenever it changes.  Weather (core/weather.js) folds in on top.
 * ------------------------------------------------------------------ */

const params = new URLSearchParams(location.search);
// director mode (dev only, tests/director): a scripted, recorded playback.  Everything random
// is seeded before the world is built, and the director drives the frame loop itself at a
// fixed 1/60 s step, so a shot list plays the same every time.
const DIRECTOR = import.meta.env.DEV && params.has('director');
if (DIRECTOR) Math.random = mulberry32(+(params.get('seed') || 2027));
const canvas = document.getElementById('view');
const TOUCH = isTouch();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  // no WebGL: say so on the (static) start card instead of leaving it on "Loading"
  track('webgl_unavailable', { device_type: deviceType(TOUCH) });
  const go = document.querySelector('.overlay .go');
  if (go) go.textContent = "This browser can't show 3D (WebGL is off or unsupported)";
  throw err;
}
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the pipeline asks for the near pass only
renderer.setClearColor(new THREE.Color(PAL.fog), 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(PAL.fog, 1.3e-4);

const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 1200);
camera.rotation.order = 'YXZ';
camera.layers.set(LAYER.NEAR);
const farCamera = new THREE.PerspectiveCamera(55, 1, 300, 45000);
farCamera.layers.set(LAYER.FAR);

/* --------------------------------- light --------------------------------- */
const SHADOW_HALF = 40;
const sun = new THREE.DirectionalLight(PAL.sun, 2.25);
sun.castShadow = true;
sun.shadow.mapSize.set(Q.shadow, Q.shadow);
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
const fill = new THREE.DirectionalLight(PAL.fill, 1.08);
const bounce = new THREE.DirectionalLight(0xd8cbe8, 0.34);
const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.12);
for (const l of [sun, fill, bounce, hemi]) { l.layers.enableAll(); scene.add(l); }
scene.add(sun.target, fill.target, bounce.target);

// the clock: opens at sunrise, 07:19 (the user's call; it was civil dawn, 06:55, in plan §0);
// ?t=predawn|sunrise|golden|bright|sunset overrides
// the four morning presets plus the real sunset (17:45 on 15 Jan)
const PRESET_HOURS = { ...data.sun.presets, sunset: data.sun.sunset };
const tod = createTod({ date: data.sun.date, lat: data.sun.lat, lon: data.sun.lon, presets: PRESET_HOURS, start: PRESET_HOURS[params.get('t')] ? params.get('t') : 'sunrise' });
const weather = createWeather(scene, { drops: Q.rain });
if (['rain', 'fog'].includes(params.get('w'))) weather.set(params.get('w'), true);

/* --------------------------------- world --------------------------------- */
const sky = buildSky(scene);
const world = buildWorld(scene);
const collider = createCollider(world);
const pipeline = new Pipeline(renderer, scene, camera, { farCamera, pixelBudget: Q.pixelBudget });
console.info(`[quality] ${Q.tier} (${Q.why}): ${(Q.pixelBudget / 1e6).toFixed(1)} MP, shadows ${Q.shadow}, water ${Q.water}, ${Q.npcs} people, ${Q.birds} birds`);
const perf = createPerf(renderer, { show: params.has('stats') });

/* ------------------------------ the jogger ------------------------------ */
// spawn on the walk at the west end, by the plaza, facing east along the dam
const SPAWN = (() => {
  const s = Math.min(L - 60, 2330), f = spineAt(s);
  const heading = Math.atan2(f.te, -f.tn); // facing -t: toward the east end
  return { e: f.e + f.ne * -1.6, n: f.n + f.nn * -1.6, heading };
})();
let outfit = 0;
try { outfit = Math.max(0, Math.min(2, +(localStorage.getItem('sukhna-outfit') ?? 0))); } catch { /* optional */ }
const jogger = new Jogger({ scene, collider, spawn: SPAWN, outfit });
// the camera stays above the surface you stand on (treads and decks included), not just the terrain
const rig = createCameraRig(camera, { groundAt: (e, n) => collider.surfaceAt(e, n) });
rig.yaw = SPAWN.heading;
const hud = createHud({ outfit, touch: TOUCH });

jogger.avoid = world.crowd.avoid;
// the pedal boat you can take out from the jetty (core/boat.js)
const boat = createBoat({ scene, world, collider });
const interact = createInteractions({ crowd: world.crowd, jogger, hud, camera, world, boat, weather });

/* -------------------------------- actions -------------------------------- */
/* One table for keys and touch buttons.  T, K and M are wired by the time
 * of day (Phase 6), weather (Phase 6) and sound (Phase 7). */
const actions = {
  E: () => interact.activate(),
  V: () => {
    // (no auto-jog in a boat, or standing in a circle)
    if (interact.state === 'boat' || interact.state === 'group') { hud.flash(interact.state === 'boat' ? 'no auto-jog in a boat' : 'leave the group first'); return; }
    const on = jogger.toggleAuto(); hud.flash(on ? 'auto-jog on' : 'auto-jog off');
  },
  T: () => { const p = tod.next(); hud.flash(`${tod.clock()} · ${p.label}`); track('time_preset_changed', { preset: p.key }); },
  K: () => { const w = weather.cycle(); hud.setWeather(w); hud.flash(w === 'clear' ? 'clear skies' : w === 'rain' ? 'rain' : 'winter fog'); track('weather_changed', { weather: w }); },
  P: () => {
    rig.setOverview(rig.mode !== 'overview');
    hud.flash(rig.mode === 'overview' ? 'overview · P to return' : 'back on the dam');
    if (rig.mode === 'overview') track('overview_opened');
  },
  M: () => { const on = sound.toggle(); hud.flash(on ? 'sound on' : 'sound off'); },
  H: () => hud.toggleHidden(),
};
let coordsOn = false;
window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Key') || e.code.startsWith('Arrow') || e.code.startsWith('Shift')) jogger.keys.add(e.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  const k = e.code.replace('Key', '');
  if (actions[k] && hud.started) actions[k]();
  if (e.code === 'KeyC') coordsOn = !coordsOn;
  // Esc pauses and resumes when the pointer isn't locked (with a lock, the browser's own
  // Esc releases it and pointerlockchange brings up the pause card).  In a circle, the
  // first Esc leaves it and the next one pauses; in a boat, Esc only ever pauses.
  if (e.code === 'Escape' && hud.started && !locked() && performance.now() - leftGroupAt > 250) {
    if (!hud.paused && interact.leaveGroup()) { leftGroupAt = performance.now(); hud.flash('left the group · Esc again to pause'); }
    else hud.setPaused(!hud.paused);
  }
  if (e.code === 'KeyR') { interact.cancel(); jogger.e = SPAWN.e; jogger.n = SPAWN.n; jogger.y = collider.surfaceAt(SPAWN.e, SPAWN.n); jogger.heading = SPAWN.heading; jogger.auto = false; rig.yaw = SPAWN.heading; }
  if (e.code === 'KeyO') pipeline.enabled.ink = !pipeline.enabled.ink;
  if (e.code === 'KeyG') pipeline.enabled.grade = !pipeline.enabled.grade;
});
window.addEventListener('keyup', (e) => jogger.keys.delete(e.code));
window.addEventListener('blur', () => jogger.keys.clear());
document.addEventListener('visibilitychange', () => jogger.keys.clear());
// a Shift released while the pointer lock or another window had the keyboard never sends keyup
for (const ev of ['keydown', 'keyup', 'pointerdown']) window.addEventListener(ev, (e) => { if (!TOUCH && !e.shiftKey && !(ev === 'keydown' && e.key === 'Shift')) { jogger.keys.delete('ShiftLeft'); jogger.keys.delete('ShiftRight'); } }, true);

/* ----------------------------- mouse and touch ----------------------------- */
const locked = () => document.pointerLockElement === canvas;
let leftGroupAt = -1e9;
// pointer lock may be refused (embedded browsers): the game runs without it, so swallow the rejection
// ?nolock (the playtest): never take the pointer, so a scripted run can't capture the user's mouse
const lockPointer = () => { if (params.has('nolock')) return; try { canvas.requestPointerLock?.()?.catch?.(() => {}); } catch { /* refused */ } };
canvas.addEventListener('click', () => { if (hud.started && !TOUCH && !locked()) { lockPointer(); hud.setPaused(false); } });
document.addEventListener('pointerlockchange', () => {
  if (TOUCH) return;
  // with the pointer locked, Esc arrives as the lock's release: in a circle it leaves the
  // circle (the game goes on; a click locks the mouse again, the next Esc pauses)
  if (!locked() && hud.started && !hud.paused && interact.leaveGroup()) { leftGroupAt = performance.now(); hud.flash('left the group · Esc again to pause'); return; }
  hud.setPaused(!locked());
});
document.addEventListener('mousemove', (e) => { if (locked()) rig.look(e.movementX * 0.0022, e.movementY * 0.0022); });
// Drag to look whenever the pointer is not locked (before Start, in the
// overview's absence, or in an embedded browser that refuses pointer lock).
let dragging = false;
canvas.addEventListener('pointerdown', (e) => { if (!TOUCH && e.button === 0) { dragging = true; try { canvas.setPointerCapture?.(e.pointerId); } catch { /* a pointer the browser no longer tracks */ } } });
canvas.addEventListener('pointerup', (e) => { dragging = false; try { canvas.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ } });
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => { if (dragging && !locked() && !TOUCH) rig.look(e.movementX * 0.0035, e.movementY * 0.0035); });
window.addEventListener('wheel', (e) => { if (hud.started) rig.zoom(Math.sign(e.deltaY) * 0.8); }, { passive: true });
hud.onOutfit = (i) => { outfit = i; jogger.setOutfit(i); try { localStorage.setItem('sukhna-outfit', String(i)); } catch { /* optional */ } };
let startedOnce = false;
hud.onStart = () => {
  if (!startedOnce) { startedOnce = true; track('game_started', { outfit: OUTFITS[outfit]?.name, quality_tier: tier, device_type: DEVICE }); }
  if (sound.enabled) sound.start();
  if (!TOUCH) lockPointer();
  world.onStart?.();
};
if (TOUCH) {
  createTouch({ keys: jogger.keys, onLook: (dx, dy) => rig.look(dx, dy), onZoom: (d) => rig.zoom(d), onButton: (k) => actions[k]?.() });
}

/* -------------------------------- lights -------------------------------- */
const _target = new THREE.Vector3();
function placeLights() {
  if (rig.mode === 'overview') _target.set(LAKE_CENTRE[0], 0, -LAKE_CENTRE[1]);
  else _target.set(jogger.e, jogger.y, -jogger.n);
  const put = (light, dir, dist) => { light.target.position.copy(_target); light.position.copy(_target).addScaledVector(dir, dist); };
  put(sun, tod.state.lightDir, 200);
  put(fill, tod.state.fillDir, 100);
  put(bounce, tod.state.bounceDir, 100);
  sky.dome.position.copy(camera.position);
  sky.clouds.position.copy(camera.position);
}

/* ------------------------------ time of day ------------------------------ */
const LOOK_TARGETS = { sky, sun, fill, bounce, hemi, scene, renderer, pipeline, lake: world.lake, mist: world.mist, ridges: world.ridges, lamps: world.dam.setLamps };
const SUNRISE = data.sun.sunrise, SUNSET = data.sun.sunset;
let looping = false;
hud.setWeather(weather.state.kind);
const sound = createSound({ world, jogger, tod, weather, interact, boat, onChange: () => hud.setSound(sound.enabled, sound.music) });
hud.setSound(sound.enabled, false);
interact.hooks.onTalk = (who, kind) => sound.talk(who, kind);
let density = -1, bundled = null;
/** How many people are out (plan §6): 0.3 pre-dawn, peak from sunrise −10 to +70 min, thinning after; fog x0.45. */
function crowdDensity(min, fog, evening) {
  // the evening walk is busy too (from ~16:00 to dusk)
  if (evening) return 0.9 * (1 - 0.55 * fog);
  const k = min < -30 ? 0.3 : min < -10 ? THREE.MathUtils.lerp(0.3, 1, (min + 30) / 20) : min < 70 ? 1 : min < 160 ? THREE.MathUtils.lerp(1, 0.55, (min - 70) / 90) : 0.55;
  return k * (1 - 0.55 * fog);
}
function updateTime(dt, running) {
  tod.state.running = running && !looping;
  weather.update(dt, camera.position);
  // the loop (plan: Decisions): past the morning window, or half an hour after sunset,
  // fade to black and start the next morning at sunrise, as the game does
  if (running && !looping && tod.pastWindow(SUNSET)) {
    looping = true;
    hud.nextMorning(() => { tod.set('sunrise'); hud.flash(`${tod.clock()} · sunrise`); }, () => { looping = false; });
  }
  if (tod.update(dt, weather.state)) {
    applyLook(tod.look, tod.state, LOOK_TARGETS);
    hud.setClock(tod.clock(), tod.label());
    const dns = crowdDensity(tod.sinceSunrise(SUNRISE), weather.state.fog, tod.state.hours > 12);
    if (Math.abs(dns - density) > 0.02) { density = dns; world.crowd.setDensity(dns); }
    const b = weather.state.fog > 0.5;
    if (b !== bundled) { bundled = b; world.crowd.setBundled(b); }
    // pedal boats go out after 08:30 (and not in fog or rain)
    world.rowing.showPedal = tod.state.hours >= 8.5 && tod.state.hours < 17.25 && weather.state.kind === 'clear';
  }
}
updateTime(0, false);

/* ------------------------------- pipeline ------------------------------- */
// the director renders at a fixed size (2560 x 1440 for a recording), whatever the window
let fixedSize = null;
function resize() {
  const w = fixedSize?.[0] ?? window.innerWidth, h = fixedSize?.[1] ?? window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pipeline.setSize(w, h);
  setOutlineResolution(pipeline.size.x, pipeline.size.y);
}
window.addEventListener('resize', resize);
resize();

/* ------------------------- quality fallback (plan §6) ------------------------- */
// If frames stay over 22 ms for 5 s (after a 10 s settle, only while the tab is
// visible), drop a tier for the parts that can change live -- pixel budget,
// shadow map, crowd, mist -- and remember it for the session, so a reload builds
// the lower tier throughout.
let tier = Q.tier, slow = 0, settle = 10;
function watchFrameTime(raw) {
  if (document.hidden || raw > 0.5) { slow = 0; return; }
  if (settle > 0) { settle -= raw; return; }
  slow = raw > 0.022 ? slow + raw : Math.max(0, slow - raw * 0.5);
  if (slow < 5) return;
  slow = 0; settle = 10;
  const next = lower(tier);
  if (!next) return;
  track('quality_fallback', { from: tier, to: next, device_type: DEVICE });
  tier = next;
  const T = TIERS[tier];
  pipeline.pixelBudget = T.pixelBudget;
  resize();
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(T.shadow, T.shadow);
  world.crowd.setCap(T.npcs / Q.npcs);
  world.mist.mesh.count = Math.min(world.mist.mesh.count, T.mist);
  try { sessionStorage.setItem('sukhna-q', tier); } catch { /* optional */ }
  hud.flash(`quality: ${tier} (frames were slow)`, 2600);
  console.info(`[quality] fell back to ${tier}`);
}

/* ------------------------------ usage stats ------------------------------ */
// Anonymous and cookieless (core/analytics.js, production only).  The moments worth
// counting are read off the game's own state once a frame, so no module has to know
// that anyone is counting.
const DEVICE = deviceType(TOUCH);
const seen = { state: null, ticket: false, lengths: 0, ride: null };
function countMoments() {
  const s = interact.state;
  if (s !== seen.state) {
    if (seen.state === 'boat' && seen.ride?.docking) track('boat_docked', { ride_seconds: Math.round(seen.ride.time), ride_metres: Math.round(seen.ride.distance) });
    if (s === 'steps') track('sat_on_steps');
    else if (s === 'bench') track('sat_on_bench');
    else if (s === 'group') track('joined_group', { group: interact.group?.kind === 'laugh' ? 'laughter_club' : 'chat' });
    else if (s === 'chai') track('chai');
    else if (s === 'boat') track('boat_boarded');
    seen.state = s;
    seen.ride = null;
  }
  if (s === 'boat') seen.ride = { time: boat.state.time, distance: boat.state.distance, docking: boat.phase === 'docking' || !!seen.ride?.docking };
  if (interact.ticket && !seen.ticket) track('boat_ticket');
  seen.ticket = interact.ticket;
  if (jogger.lengths > seen.lengths) { seen.lengths = jogger.lengths; track('length_completed', { lengths: jogger.lengths, run_seconds: Math.round(jogger.elapsed) }); }
}
heartbeat(() => hud.started && !hud.paused, () => ({ quality_tier: tier, device_type: DEVICE }));

/* --------------------------------- loop --------------------------------- */
const clock = new THREE.Clock();
let flatPanel = null;

/** Everything a frame does except drawing it (the playtest fast-forwards with this). */
let cameraHook = null; // the director (dev) places the camera after the rig does
function tick(dt) {
  // playing whenever the card is away; pointer lock only steers the mouse (an embedded
  // browser may refuse it), and losing it (Esc) brings the pause card back
  const playing = hud.started && !hud.paused;
  boat.update(playing ? dt : 0, jogger.keys, jogger); // (moves the seated jogger with it)
  jogger.update(playing ? dt : 0, rig.yaw);
  world.update(dt, camera.position, rig.mode === 'overview', jogger);
  updateTime(dt, playing);
  rig.update(dt, jogger, { bench: interact.benchView() });
  cameraHook?.(dt);
  if (playing) interact.update(dt); else hud.setPrompt('');
  if (playing) countMoments();
  sound.update(dt, camera, playing);
  placeLights();
  hud.setRun(jogger, boat.active ? boat : null);
  if (coordsOn) {
    const w = jogger.where();
    hud.setCoords(`E ${jogger.e.toFixed(1)}  N ${jogger.n.toFixed(1)}  y ${jogger.y.toFixed(2)}\ns ${w.s.toFixed(1)} m  d ${(w.side * w.d).toFixed(1)} m  heading ${azimuthForYaw(jogger.heading).toFixed(0)}°\n__shot('x', 1600, 900, { s: ${w.s.toFixed(0)}, d: ${(w.side * w.d).toFixed(1)}, az: ${azimuthForYaw(rig.yaw).toFixed(0)}, pitch: ${THREE.MathUtils.radToDeg(rig.pitch).toFixed(0)} })`);
  } else hud.setCoords('');
}

function frame() {
  const raw = clock.getDelta();
  const dt = Math.min(raw, 1 / 20);
  watchFrameTime(raw);
  perf.begin();
  tick(dt);
  pipeline.render();
  perf.end(dt);
  flatPanel?.update(camera, dt);
  requestAnimationFrame(frame);
}
if (!DIRECTOR) frame();

if (params.has('flat')) {
  import('./world/flat.js').then(({ createFlatPanel }) => { flatPanel = createFlatPanel(world); });
}

// the director (tests/director): scripted shots, recorded as video; dev only, ?director=<name>
if (DIRECTOR) {
  import('./dev/director.js').then(({ runDirector }) => runDirector({
    THREE, world, jogger, collider, interact, boat, hud, rig, camera, tod, weather, sound, pipeline, perf, canvas, updateTime, actions,
    tick,
    render: () => { perf.begin(); pipeline.render(); perf.end(1 / 60); },
    setSize: (w, h) => { fixedSize = [w, h]; resize(); },
    setCameraHook: (fn) => { cameraHook = fn; },
  })).catch((e) => { console.error('[director]', e); window.__director = { state: 'error', errors: [String(e?.stack || e)] }; });
}

// the playtest's API (tests/playtest): dev only, never in a production build
if (import.meta.env.DEV) {
  import('./dev/testapi.js').then(({ installTestApi }) => installTestApi({
    THREE, world, jogger, collider, interact, boat, hud, rig, camera, tod, weather, sound, pipeline, data, perf, sun, SPAWN,
    tick, updateTime, placeLights, actions,
  }));
}

window.__scene = { scene, camera, farCamera, renderer, pipeline, world, sky, jogger, rig, hud, interact, boat, tod, weather, sound, updateTime, watchFrameTime, collider, perf, sun, fill, bounce, hemi, THREE, data };

/** GPU-inclusive frame time from the current camera (see core/perf.js). */
window.__bench = (n = 120) => ({
  tier: tier,
  ...perf.bench(() => pipeline.render(), n),
  internal: `${pipeline.size.x}x${pipeline.size.y}`,
  view: rig.mode === 'overview' ? 'overview' : `s ${nearestS(jogger.e, jogger.n).s.toFixed(0)}, az ${azimuthForYaw(rig.yaw).toFixed(0)}`,
});

if (import.meta.env?.DEV) {
  /**
   * Dev capture: place the jogger and the camera, render one frame at a
   * fixed size and post it to the dev server (`.shots/<name>.jpg`).
   *
   *   { s, d, az, pitch, boom, first, heading }  on the walk (s from the east end, d toward the lake)
   *   { e, n, az, pitch, boom, h }               anywhere (h: camera height override)
   *   { overview: bearingDeg }                   the aerial orbit
   *   { hideJogger: true }                       landscape only
   */
  window.__shot = async (name = 'shot', W = 1600, H = 900, opts = {}) => {
    const wasOverview = rig.mode === 'overview';
    if (opts.overview !== undefined) {
      if (!wasOverview) rig.setOverview(true);
      rig.overview(0, THREE.MathUtils.degToRad(opts.overview));
    } else {
      if (wasOverview) rig.setOverview(false);
      if (opts.s !== undefined) { const f = spineAt(opts.s), d = opts.d || 0; jogger.e = f.e + f.ne * d; jogger.n = f.n + f.nn * d; }
      if (opts.e !== undefined) { jogger.e = opts.e; jogger.n = opts.n; }
      // no position given: shoot the jogger where they are (seated, say), untouched
      const moved = opts.s !== undefined || opts.e !== undefined;
      if (moved) jogger.y = collider.surfaceAt(jogger.e, jogger.n);
      if (opts.az !== undefined) rig.yaw = yawForAzimuth(opts.az);
      if (opts.pitch !== undefined) rig.pitch = THREE.MathUtils.degToRad(opts.pitch);
      if (moved || opts.heading !== undefined) jogger.heading = opts.heading !== undefined ? yawForAzimuth(opts.heading) : rig.yaw;
      if (opts.boom !== undefined) rig.boom = rig.boomTarget = opts.boom;
      if (opts.first) rig.boom = rig.boomTarget = 0;
      jogger.update(0, rig.yaw);
      rig.update(0.016, jogger, { snap: true, bench: moved ? null : interact.benchView() });
      if (opts.h !== undefined) camera.position.y = groundAt(camera.position.x, -camera.position.z) + opts.h;
      if (opts.hideJogger) jogger.visible = false;
    }
    // opts.time ('predawn' | 'sunrise' | 'golden' | 'bright', or hours) and opts.weather ('clear' | 'rain' | 'fog')
    if (opts.weather) weather.set(opts.weather, true);
    if (opts.time !== undefined || opts.weather) {
      if (typeof opts.time === 'number') tod.state.hours = opts.time;
      tod.set(typeof opts.time === 'string' ? opts.time : undefined);
      updateTime(0, false);
    }
    placeLights();
    world.update(0, camera.position, rig.mode === 'overview', jogger);
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
    pipeline.forceScale = 0;
    if ((rig.mode === 'overview') !== wasOverview) rig.setOverview(wasOverview);
    if (opts.hideJogger) jogger.visible = true;
    resize();
    const r = await fetch('/__shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, data: dataUrl }) });
    return { ...(await r.json()), ...counts };
  };
}
