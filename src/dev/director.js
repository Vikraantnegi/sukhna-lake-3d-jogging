/* ------------------------------------------------------------------ *
 * The director (dev only): scripted cinematic shots, recorded as video.
 *
 * Open with ?director=<name>: it loads tests/director/<name>.json -- a
 * timed shot list -- and plays it:
 *
 *   events    time and weather changes, key presses, and player actions
 *             (place, walk to a point, auto-jog, sit on the steps, join a
 *             circle, buy a ticket, board, pedal a path, dock, greet, high
 *             five, chai), each at a set second
 *   shots     the camera: the game's own rig, or keyframes (position and
 *             look-at, eased, in world terms or relative to the player or
 *             the boat), with hard cuts or eased blends between shots
 *   captions  and an end card, drawn over the frame in the recording only
 *
 * Playback is deterministic: main.js seeds Math.random before the world is
 * built (?seed=), and this drives the frame loop itself -- one fixed 1/60 s
 * step per rendered frame, whatever the display's refresh rate -- so the
 * same list gives the same video.
 *
 * Recording (?record=1): each frame is composited onto a 2D canvas (the
 * game at 2560 x 1440 or 1920 x 1080, plus captions, the end card, speech
 * bubbles, the ?stats readout, the start card), captured with
 * captureStream(60) together with the WebAudio master output, and encoded
 * by MediaRecorder (H.264 + AAC in MP4) in 1 s parts streamed to the dev
 * server (/__recording -> recordings/).  window.__director reports progress
 * and a frame log for tests/director/record.mjs.
 *
 * Never in a production build: main.js imports this only when
 * import.meta.env.DEV and ?director are both set.
 * ------------------------------------------------------------------ */

import { spineAt, nearestS, LAKE_CENTRE, azimuthForYaw } from '../world/frame.js';
import { stepSeat as flightSeat } from '../world/dam.js';
import { stepSeat as bodySeat } from '../people/body.js';

const STEP = 1 / 60;
const EASE = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - (1 - k) ** 3,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
};
const FONT = `"Segoe UI", "Segoe UI Emoji", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif`;

// Captions: Nunito Bold (OFL, tests/director/fonts/), fetched by URL at run time so nothing
// reaches dist/. Sizes are fractions of the frame's height, set for a phone in the X feed (a
// 16:9 video there is ~390 px wide); the line sits at 0.83 H, clear of the feed's own controls.
const CAPTION = { family: `"Director Nunito", "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`, weight: 700, size: 0.052, track: 0.02, y: 0.83, color: '#fff8ec' };

export async function runDirector(ctx) {
  const { THREE, world, jogger, collider, interact, boat, hud, rig, camera, tod, weather, sound, pipeline, tick, render, setSize, updateTime, actions, canvas, setCameraHook } = ctx;
  const params = new URLSearchParams(location.search);
  const name = params.get('director');
  const list = await (await fetch(`/tests/director/${name}.json`, { cache: 'no-store' })).json();
  const recording = params.get('record') === '1';
  // portrait (1080 x 1920, for Shorts, Reels and TikTok): ?portrait, or a list made for it
  // ("portrait": true).  Shots, captions and events may carry a "portrait" block whose fields
  // replace theirs in portrait, so a shot gets its own framing instead of a crop of the landscape one.
  const PORTRAIT = params.has('portrait') || !!list.portrait;
  const size = PORTRAIT ? [1080, 1920] : params.get('size') === '1080' ? [1920, 1080] : list.size || [2560, 1440];
  const [W, H] = size;
  const framed = (o) => (PORTRAIT && o.portrait ? { ...o, ...o.portrait } : o);
  for (const k of ['events', 'shots', 'captions']) if (list[k]) list[k] = list[k].map(framed);
  // the camera's vertical field of view: the game's 55 degrees, or wider in portrait (a tall frame
  // at 55 is only ~32 degrees across); a shot's "fov" overrides it
  const BASE_FOV = PORTRAIT ? list.portraitFov ?? 68 : camera.fov;
  // recordings/<tag>.mp4: -1080 for the smaller landscape size, -portrait for a landscape list shot tall
  const TAG = `${name}${W === 1920 ? '-1080' : ''}${PORTRAIT && !list.portrait ? '-portrait' : ''}`;
  const status = { name, state: 'loading', t: 0, duration: list.duration, size, portrait: PORTRAIT, tag: TAG, frames: [], renders: 0, lateTicks: 0, maxGapMs: 0, errors: [] };
  window.__director = status;

  /* ------------------------------ the stage ------------------------------ */
  setSize(W, H);
  hud.started = true; hud.paused = false; hud.hideCard(); hud.setHidden(true);
  world.onStart?.();
  if (sound.enabled) sound.start();
  const start = list.start || {};
  if (start.time !== undefined) setTime(start.time);
  if (start.weather) { weather.set(start.weather, true); hud.setWeather(start.weather); tod.set(); updateTime(0, false); }

  // the composite: what the recording (and the window) shows
  const comp = document.createElement('canvas');
  comp.width = W; comp.height = H;
  Object.assign(comp.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', objectFit: 'contain', background: '#000', zIndex: 1000 });
  document.body.appendChild(comp);
  const g = comp.getContext('2d', { alpha: false });
  const gl = pipeline.renderer.getContext();

  try { document.fonts.add(await new FontFace('Director Nunito', 'url(/tests/director/fonts/Nunito.ttf)', { weight: '200 1000' }).load()); }
  catch (e) { status.errors.push(`font: ${e.message}`); }
  // how bright the frame is behind the caption: sampled small (a 48 x 12 read-back every 4th
  // step while a caption shows) and eased, so the gradient behind the text never flickers
  const probe = Object.assign(document.createElement('canvas'), { width: 48, height: 12 }).getContext('2d', { willReadFrequently: true });
  const scrim = { level: 0, target: 0, n: 0 };

  /* ------------------------------ where things are ------------------------------ */
  const V = (e, y, n) => new THREE.Vector3(e, y, -n);
  const club = world.landmarks.club;
  const jf = spineAt(club.jetty.s);
  function frame(h) { return { fe: -Math.sin(h), fn: Math.cos(h), re: Math.cos(h), rn: Math.sin(h) }; }
  /** A point spec -> world Vector3.  See tests/director/README.md. */
  function point(spec, out = new THREE.Vector3()) {
    if (Array.isArray(spec)) return out.copy(V(spec[0], spec[1], spec[2]));
    if (spec.walk) {
      const [s, d] = spec.walk, f = spineAt(s), e = f.e + f.ne * d, n = f.n + f.nn * d;
      return out.copy(V(e, spec.y ?? collider.surfaceAt(e, n) + (spec.h ?? 1.6), n));
    }
    if (spec.player || spec.boat) {
      const [r, u, fw] = spec.player || spec.boat, onBoat = !!spec.boat;
      const h = onBoat ? boat.state.h : jogger.heading, f = frame(h);
      const e0 = onBoat ? boat.state.e : jogger.e, n0 = onBoat ? boat.state.n : jogger.n, y0 = onBoat ? 0 : jogger.y;
      return out.copy(V(e0 + f.re * r + f.fe * fw, y0 + u, n0 + f.rn * r + f.fn * fw));
    }
    if (spec.lake) return out.copy(V(LAKE_CENTRE[0] + spec.lake[0], spec.lake[1], LAKE_CENTRE[1] + spec.lake[2]));
    if (spec.azFrom) {
      // `dist` m from a spot along a compass bearing, `h` m over the surface there (or at `y`)
      const [e0, n0] = spot(spec.azFrom), a = THREE.MathUtils.degToRad(spec.az), e = e0 + Math.sin(a) * spec.dist, n = n0 + Math.cos(a) * spec.dist;
      return out.copy(V(e, spec.y ?? Math.max(0, collider.surfaceAt(e, n)) + (spec.h ?? 1.6), n));
    }
    if (spec.spot) { const [e, n] = spot(spec.spot); return out.copy(V(e, spec.y ?? Math.max(0, collider.surfaceAt(e, n)) + (spec.h ?? 1.6), n)); }
    throw new Error(`director: unknown point ${JSON.stringify(spec)}`);
  }
  const flightOf = (s) => world.dam.waterStairs.find((w) => Math.abs(w.s - s) < 1);
  /** Where the jogger sits on flight s (the lowest dry tread), in (e, n). */
  function seatSpot(s) {
    const st = flightOf(s), pick = flightSeat(st), f = spineAt(st.s);
    const { d } = bodySeat(jogger.body, pick.seat, pick.foot);
    return [f.e + f.ne * d, f.n + f.nn * d];
  }
  function spot(spec) {
    if (Array.isArray(spec)) return spec;
    if (spec.walk) { const f = spineAt(spec.walk[0]); return [f.e + f.ne * spec.walk[1], f.n + f.nn * spec.walk[1]]; }
    if (spec.flight !== undefined) {
      if (spec.at === 'seat') {
        // the seat, or `back` m up the flight from it (toward the walk)
        const [e, n] = seatSpot(spec.flight), f = spineAt(spec.flight), k = spec.back || 0;
        return [e - f.ne * k, n - f.nn * k];
      }
      const f = spineAt(spec.flight);
      return [f.e + f.ne * spec.u, f.n + f.nn * spec.u];
    }
    if (spec.jetty) return [jf.e + jf.ne * spec.jetty[0] + jf.te * spec.jetty[1], jf.n + jf.nn * spec.jetty[0] + jf.tn * spec.jetty[1]];
    if (spec.counter) return club.shack.counter;
    if (spec.lake) return [LAKE_CENTRE[0] + spec.lake[0], LAKE_CENTRE[1] + spec.lake[1]];
    if (spec.freeBerth !== undefined) {
      // off the free berth furthest out along the jetty, `freeBerth` m off its bow
      const b = club.berths.filter((x) => !x.color).sort((x, y) => y.d - x.d)[0];
      return [b.e - Math.sin(b.yaw) * spec.freeBerth, b.n + Math.cos(b.yaw) * spec.freeBerth];
    }
    throw new Error(`director: unknown spot ${JSON.stringify(spec)}`);
  }
  const yawTo = (e, n) => Math.atan2(-(e - jogger.e), n - jogger.n);
  const faceYaw = (face, s) => {
    const f = spineAt(s ?? nearestS(jogger.e, jogger.n).s);
    if (typeof face === 'number') return -THREE.MathUtils.degToRad(face);
    return face === 'lake' ? Math.atan2(-f.ne, f.nn) : face === 'city' ? Math.atan2(f.ne, -f.nn) : face === 'west' ? Math.atan2(-f.te, f.tn) : face === 'east' ? Math.atan2(f.te, -f.tn) : jogger.heading;
  };

  /* ------------------------------ time ------------------------------ */
  function setTime(v) {
    if (typeof v === 'number') tod.state.hours = v;
    tod.set(typeof v === 'string' ? v : undefined);
    updateTime(0, false);
  }

  /* ------------------------------ player actions ------------------------------ */
  const keys = jogger.keys;
  let task = null; // one player task at a time: { step(dt) -> true when done }
  let pace = null; // 'walk' caps the jogger's speed at a walk (applied after each tick)
  const press = (k) => { if (k === 'E') interact.activate(); else if (actions[k]) actions[k](); else if (k === 'Esc') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); };
  function place(e, n, yaw) {
    interact.cancel();
    jogger.auto = false; keys.clear(); jogger.speed = 0;
    jogger.e = e; jogger.n = n; jogger.y = collider.surfaceAt(e, n);
    jogger.heading = yaw; rig.yaw = yaw; rig.pitch = -0.12;
    if (rig.mode === 'overview') rig.setOverview(false);
  }
  /** Walk (or jog) through a list of spots, steering by the bearing, then `then()`. */
  function walkPath(spots, { walk = true, tol = 0.35, then } = {}) {
    let i = 0;
    return {
      step() {
        const [e, n] = spots[i];
        if (Math.hypot(e - jogger.e, n - jogger.n) < tol) {
          if (++i >= spots.length) { keys.delete('KeyW'); pace = null; then?.(); return true; }
          return false;
        }
        const y = yawTo(e, n);
        rig.yaw = y;
        keys.add('KeyW');
        pace = walk ? 'walk' : null;
        return false;
      },
    };
  }
  /** Wait for E to offer `kind`, then press it (up to `limit` s). */
  function whenOffered(kind, limit = 4, then) {
    let t = 0;
    return { step(dt) { t += dt; if (interact.current?.kind === kind) { interact.activate(); then?.(); return true; } return t > limit; } };
  }
  const chain = (...tasks) => { let k = 0; return { step(dt) { while (k < tasks.length && tasks[k].step(dt)) k++; return k >= tasks.length; } }; };
  /** Pedal the boat through spots with the real keys; `fast` holds Shift. */
  function pedalPath(spots, { fast = false, tol = 6 } = {}) {
    let i = 0;
    return {
      step() {
        const s = boat.state, [e, n] = spots[i];
        if (Math.hypot(e - s.e, n - s.n) < tol) { if (++i >= spots.length) { for (const k of ['KeyW', 'KeyA', 'KeyD', 'ShiftLeft']) keys.delete(k); return true; } return false; }
        let err = Math.atan2(-(e - s.e), n - s.n) - s.h;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        keys.add('KeyW'); keys.delete('KeyA'); keys.delete('KeyD');
        if (err > 0.08) keys.add('KeyA'); else if (err < -0.08) keys.add('KeyD');
        if (fast) keys.add('ShiftLeft'); else keys.delete('ShiftLeft');
        return false;
      },
    };
  }
  function boardNow(berth) {
    const b = berth ?? club.berths.find((x) => x.color && x.d > club.jetty.d0 + 8);
    interact.ticket = true;
    place(b.e - jf.te * b.side * 2.3, b.n - jf.tn * b.side * 2.3, yawTo(b.e, b.n));
    jogger.heading = Math.atan2(-(b.e - jogger.e), b.n - jogger.n);
    interact.update(0);
    if (interact.current?.kind === 'board') interact.activate();
  }
  /** Put a rowing boat (the eight, or a scull) on its lane so it passes the spot (e, n) after `lead` m. */
  function eightNear([e, n], lead = 60, which = 'eight') {
    const b = which === 'eight' ? world.rowing.boats.find((x) => x.kind === 'eight') : world.rowing.boats.filter((x) => x.kind === 'scull')[+(which.slice(5) || 0)], lane = b.lane;
    let best = 0, bd = Infinity;
    lane.pts.forEach(([pe, pn], k) => { const d = Math.hypot(pe - e, pn - n); if (d < bd) { bd = d; best = k; } });
    b.s = lane.S[best] - b.dir * lead;
  }
  /** A runner coming the other way: stand in their lane `ahead` m in front, jogging toward them. */
  function meetRunner(minS, maxS, ahead = 14) {
    const p = world.crowd.people.find((q) => q.active && q.mode === 'walk' && q.leader === undefined && q.speed > 2.4 && q.s > minS && q.s < maxS);
    if (!p) return false;
    const f = spineAt(p.s + p.dir * ahead);
    place(f.e + f.ne * p.d, f.n + f.nn * p.d, faceYaw(p.dir > 0 ? 'east' : 'west', p.s));
    keys.add('KeyW');
    return true;
  }
  /** Stand beside a walker, facing them. */
  function besideWalker(minS, maxS) {
    const p = world.crowd.people.find((q) => q.active && q.mode === 'walk' && q.leader === undefined && q.speed < 1.8 && q.speed > 0.8 && q.s > minS && q.s < maxS);
    if (!p) return false;
    const f = spineAt(p.s + p.dir * 1.2);
    place(f.e + f.ne * (p.d - 0.9), f.n + f.nn * (p.d - 0.9), 0);
    jogger.heading = rig.yaw = yawTo(p.e, p.n);
    interact.update(0);
    return true;
  }

  const ACTIONS = {
    time: (e) => setTime(e.value),
    timeLapse: (e) => { const from = tod.state.hours, to = e.to, over = e.over; let t = 0; lapses.push((dt) => { t += dt; tod.state.hours = from + (to - from) * EASE[e.ease || 'inOut'](Math.min(1, t / over)); return t >= over; }); },
    weather: (e) => { weather.set(e.value, !!e.instant); hud.setWeather(e.value); if (e.instant) { tod.set(); updateTime(0, false); } },
    key: (e) => press(e.key),
    // ("speed": already moving at that speed, so a video can open mid-stride rather than from a standstill)
    place: (e) => { const [pe, pn] = spot(e.spot || { walk: [e.s, e.d ?? -1.6] }); place(pe, pn, faceYaw(e.face ?? 'west', e.s ?? nearestS(pe, pn).s)); if (e.speed) jogger.speed = e.speed; },
    walkTo: (e) => { task = walkPath((e.path || [e.to]).map(spot), { walk: e.pace !== 'jog', tol: e.tol ?? 0.35 }); },
    auto: () => { if (!jogger.auto) press('V'); },
    hold: (e) => { for (const k of e.keys) keys.add(k); },
    release: (e) => { for (const k of e.keys || [...keys]) keys.delete(k); },
    sitSteps: (e) => {
      // down the flight to the seat (through the landing first, when coming from the walk)
      const f = spineAt(e.flight), onFlight = (jogger.e - f.e) * f.ne + (jogger.n - f.n) * f.nn > 5.5;
      task = walkPath([...(onFlight ? [] : [[f.e + f.ne * 4.6, f.n + f.nn * 4.6]]), seatSpot(e.flight)], { walk: true, tol: 0.3, then: () => { keys.clear(); } });
      task = chain(task, whenOffered('steps', 3));
    },
    join: (e) => {
      const c = world.crowd.circles.find((x) => x.kind === (e.kind || 'laugh'));
      const a = e.angle ?? Math.atan2(jogger.n - c.cn, jogger.e - c.ce), r = c.r + 2.5;
      if (e.teleport !== false) place(c.ce + Math.cos(a) * r, c.cn + Math.sin(a) * r, 0);
      jogger.heading = rig.yaw = yawTo(c.ce, c.cn);
      interact.update(0);
      task = whenOffered('join', 3);
    },
    ticket: () => { task = chain(walkPath([club.shack.counter], { walk: true, tol: 0.4 }), whenOffered('ticket', 3)); },
    board: (e) => { if (e.teleport) { boardNow(); return; } const b = club.berths.find((x) => x.color && x.d > club.jetty.d0 + (e.along ?? 8)); task = chain(walkPath([[b.e - jf.te * b.side * 2.3, b.n - jf.tn * b.side * 2.3]], { walk: e.pace !== 'jog', tol: 0.4 }), { step() { jogger.heading = rig.yaw = yawTo(b.e, b.n); interact.update(0); return true; } }, whenOffered('board', 3)); },
    boatAt: (e) => { if (boat.phase !== 'on') boardNow(); const [be, bn] = spot(e.spot), s = boat.state; s.e = be; s.n = bn; const nf = spineAt(nearestS(be, bn).s); const fb = club.berths.filter((x) => !x.color).sort((x, y) => y.d - x.d)[0];
      s.h = e.heading !== undefined ? -THREE.MathUtils.degToRad(e.heading) : e.face === 'berth' ? Math.atan2(-(fb.e - be), fb.n - bn) : e.face === 'dam' ? Math.atan2(nf.ne, -nf.nn) : e.face === 'lake' ? Math.atan2(-nf.ne, nf.nn) : Math.atan2(-(jf.e - be), jf.n - bn) + Math.PI; s.ve = s.vn = s.yawRate = s.speed = 0; s.distance = Math.max(s.distance, 20); },
    pedal: (e) => { task = pedalPath(e.path.map(spot), { fast: !!e.fast, tol: e.tol ?? 6 }); },
    dock: () => {
      const b = boat.freeBerth(Infinity) || club.berths.find((x) => !x.color);
      const f = frame(b.yaw);
      // (straight in if the boat is already off the berth's bow; else round to it first)
      const s = boat.state, off = (s.e - b.e) * f.fe + (s.n - b.n) * f.fn;
      task = chain(pedalPath(off > 5 ? [[b.e + f.fe * 4, b.n + f.fn * 4]] : [[b.e + f.fe * 9, b.n + f.fn * 9], [b.e + f.fe * 4, b.n + f.fn * 4]], { tol: 2.5 }), whenOffered('dock', 6), { step: () => boat.phase === 'off' });
    },
    say: (e) => interact.say(e.who === 'nearest' ? world.crowd.near(jogger.e, jogger.n, 6)[0] || 'player' : 'player', e.text, e.secs ?? 2.4),
    greet: (e) => { besideWalker(e.minS ?? 300, e.maxS ?? 2300); task = whenOffered('greet', 2); },
    five: (e) => { if (meetRunner(e.minS ?? 400, e.maxS ?? 2200)) task = chain(whenOffered('five', 6), { step() { return true; } }); },
    chai: () => { const [ke, kn] = world.landmarks.plaza.kiosk; place(ke + 2, kn + 0.5, 0); jogger.heading = rig.yaw = yawTo(ke, kn); interact.update(0); task = whenOffered('chai', 2); },
    rowers: (e) => eightNear(spot(e.near), e.lead ?? 60, e.which || 'eight'),
    outfit: (e) => { hud.onOutfit?.(e.value); card.pick = e.value; },
    card: (e) => { Object.assign(card, e); if (e.press) card.pressAt = t; if (e.hide) card.hideAt = t; },
    stats: (e) => { statsOn = e.on !== false; },
    // the "Things to do at Sukhna" list, as the game draws it (core/checklist.js), in or out
    todo: (e) => { if (e.show !== false) { todo.from = t; todo.to = null; } else todo.to = t; },
    rigView: (e) => { if (e.pitch !== undefined) rig.pitch = THREE.MathUtils.degToRad(e.pitch); if (e.boom !== undefined) rig.boom = rig.boomTarget = e.boom; if (e.yaw === 'player') rig.yaw = jogger.heading; },
  };
  const lapses = [];

  /* ------------------------------ the camera ------------------------------ */
  const shots = [...(list.shots || [])].sort((a, b) => a.at - b.at);
  let shot = null, shotStart = 0;
  const from = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }, last = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  const _p = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
  let keyFrom = null, fovFrom = BASE_FOV, lastFov = BASE_FOV; // the camera pose when a keyframed shot starts, for a key at "current"
  let first = true; // the first shot has nothing to blend from
  function keyPose(sh, tt) {
    const ks = sh.keys;
    let i = 0;
    while (i < ks.length - 1 && tt > ks[i + 1].t) i++;
    const a = ks[i], b = ks[Math.min(i + 1, ks.length - 1)];
    const k = b === a ? 1 : EASE[b.ease || sh.ease || 'inOut'](THREE.MathUtils.clamp((tt - a.t) / (b.t - a.t), 0, 1));
    const pa = a.pos === 'current' ? keyFrom.pos.clone() : point(a.pos), pb = b.pos === 'current' ? keyFrom.pos.clone() : point(b.pos);
    const la = a.look === 'current' ? keyFrom.look.clone() : point(a.look), lb = b.look === 'current' ? keyFrom.look.clone() : point(b.look);
    return { pos: pa.lerp(pb, k), look: la.lerp(lb, k) };
  }
  function setFov(fov) { lastFov = fov; if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); } }
  // called by main.js's tick() right after the rig has placed the camera: the director's
  // camera replaces it (so sound, bubbles and shadows follow what the video shows)
  setCameraHook(() => {
    const now = t;
    while (shots.length && shots[0].at <= now + 1e-6) {
      shot = shots.shift(); shotStart = shot.at;
      from.pos.copy(last.pos); from.quat.copy(last.quat); fovFrom = lastFov;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(last.quat);
      keyFrom = { pos: last.pos.clone(), look: last.pos.clone().addScaledVector(fwd, 20) };
      if (shot.mode === 'overview' && rig.mode !== 'overview') rig.setOverview(true);
      if (shot.mode !== 'overview' && rig.mode === 'overview') rig.setOverview(false);
      if (shot.orbit !== undefined) rig.orbit = shot.orbit;
    }
    if (!shot) { last.pos.copy(camera.position); last.quat.copy(camera.quaternion); setFov(BASE_FOV); return; }
    const tt = now - shotStart;
    let fov = shot.fov ?? BASE_FOV;
    if (shot.mode === 'keys') {
      const p = keyPose(shot, tt);
      camera.position.copy(p.pos);
      _m.lookAt(p.pos, p.look, UP);
      camera.quaternion.setFromRotationMatrix(_m);
    }
    // 'rig' and 'overview' keep the game's own camera
    const blend = first ? 0 : shot.blend ?? 0;
    if (blend > 0 && tt < blend) {
      const k = EASE[shot.blendEase || 'inOut'](tt / blend);
      _p.copy(camera.position); _q.copy(camera.quaternion);
      camera.position.copy(from.pos).lerp(_p, k);
      camera.quaternion.copy(from.quat).slerp(_q, k);
      fov = THREE.MathUtils.lerp(fovFrom, fov, k);
    }
    setFov(fov);
    camera.updateMatrixWorld();
    last.pos.copy(camera.position); last.quat.copy(camera.quaternion);
    if (tt >= (shot.blend ?? 0)) first = false;
  });

  /* ------------------------------ the overlay ------------------------------ */
  const captions = list.captions || [];
  const card = { show: false, pick: 0, pressAt: -1 };
  let statsOn = !!list.stats && !params.has('nostats'), renderMs = 1, fpsText = '60';
  const todo = { from: null, to: null };
  // a clip to show first (before-after: the Phase 1 build): its H.264 frames, decoded with
  // WebCodecs a few frames ahead and drawn frame n at step n (a playing <video> element handed
  // over only ~30 distinct frames a second, so half the clip's frames came out doubled)
  let clip = null;
  if (list.clip) {
    const base = list.clip.frames;
    const meta = await (await fetch(`${base}.json`, { cache: 'no-store' })).json();
    const data = new Uint8Array(await (await fetch(`${base}.h264`, { cache: 'no-store' })).arrayBuffer());
    const offs = []; let o = 0;
    for (const [size] of meta.samples) { offs.push(o); o += size; }
    const frames = new Map(), first = Math.round((list.clip.from || 0) * 60);
    // (decoded frames are handed back promptly: the decoder has only a few to lend)
    const dec = new VideoDecoder({ output: (f) => { const i = Math.round((f.timestamp * 60) / 1e6); if (i < first) f.close(); else frames.set(i, f); }, error: (e) => status.errors.push(`clip: ${e.message}`) });
    dec.configure({ codec: meta.codec, codedWidth: meta.width, codedHeight: meta.height, description: Uint8Array.from(atob(meta.avcC), (c) => c.charCodeAt(0)) });
    let fed = 0;
    const feed = (upTo) => {
      for (; fed <= Math.min(upTo, meta.samples.length - 1); fed++) {
        const [size, key, ts] = meta.samples[fed];
        dec.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: ts, data: data.subarray(offs[fed], offs[fed] + size) }));
      }
    };
    // decode up to the first frame shown (and a few past it), then wait for it
    for (let i = 0; i <= first + 6; i++) { feed(i); while (dec.decodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1)); }
    for (let w = 0; w < 500 && !frames.has(first); w++) await new Promise((r) => setTimeout(r, 4));
    clip = { frames, feed, count: meta.samples.length, first, shown: -1 };
  }
  /** The clip's frame for this step (older frames are let go of); a missing one reuses the last, and is counted. */
  function clipFrame() {
    const k = Math.min(clip.first + frames, clip.count - 1);
    clip.feed(k + 6);
    for (const [i, f] of clip.frames) if (i < k - 1) { f.close(); clip.frames.delete(i); }
    let f = clip.frames.get(k);
    if (!f) { status.clipRepeats = (status.clipRepeats || 0) + 1; f = clip.frames.get(clip.shown); } else clip.shown = k;
    return f;
  }

  // In portrait the apps draw their own buttons and text over the bottom ~20 % and the right-hand
  // ~15 % of the frame, so the caption sits in the rest: centred in the left 85 %, the block's
  // middle at 0.73 H (two lines still end above 0.78 H), wrapped to 74 % of the width, 6.2 % of
  // the width tall; subjects are framed above it, in the upper two thirds.
  const CAP = PORTRAIT ? { px: Math.round(W * 0.062), x: W * 0.455, y: H * 0.73, maxW: W * 0.74 } : { px: Math.round(H * CAPTION.size), x: W / 2, y: H * CAPTION.y, maxW: W * 0.9 };
  function wrap(text, maxW) {
    const lines = [];
    for (const word of text.split(' ')) {
      const joined = lines.length ? `${lines[lines.length - 1]} ${word}` : null;
      if (joined && g.measureText(joined).width <= maxW) lines[lines.length - 1] = joined;
      else lines.push(word);
    }
    // two lines: break where they come out most even ("I rebuilt Sukhna / Lake in 3D", not
    // "I rebuilt Sukhna Lake in / 3D")
    if (lines.length === 2) {
      const words = text.split(' ');
      let best = lines, worst = Infinity;
      for (let i = 1; i < words.length; i++) {
        const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
        const wide = Math.max(g.measureText(a).width, g.measureText(b).width);
        if (wide <= maxW && wide < worst) { worst = wide; best = [a, b]; }
      }
      return best;
    }
    return lines;
  }
  // where a caption sits: its own "y" (a fraction of the height), else the list's "captionY",
  // else the default above (a list can put its captions in the sky, say, clear of the subject)
  // (opts, from the caption: `x` a left edge as a fraction of the width with `align: "left"`, for a
  // small corner label such as "SUNRISE · SPED UP"; `size` scales the type)
  function caption(text, alpha, yFrac, opts = {}) {
    const c = CAPTION, left = opts.align === 'left', x = opts.x !== undefined ? W * opts.x : CAP.x;
    let px = Math.round(CAP.px * (opts.size ?? 1));
    const sc = opts.scrim ?? scrim; // (a corner label keeps its own, beside a caption)
    g.save();
    const setFont = () => { g.font = `${c.weight} ${px}px ${c.family}`; g.letterSpacing = `${c.track * px}px`; };
    setFont();
    const y = yFrac !== undefined ? H * yFrac : CAP.y;
    const lines = wrap(text, CAP.maxW);
    // a line that can't break (a web address) and is wider than the safe width: smaller, to fit
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > CAP.maxW) { px = Math.floor((px * CAP.maxW) / widest); setFont(); }
    const lineH = px * 1.22, top = y - ((lines.length - 1) * lineH) / 2;
    const halfW = Math.max(...lines.map((l) => g.measureText(l).width)) / 2, cx = left ? x + halfW : x; // (the block's centre)
    const rx = halfW + px * 2.4, ry = px * 1.6 + ((lines.length - 1) * lineH) / 2;
    // a bright background (fog, pale water, sky) fades in a soft dark gradient behind the text:
    // an ellipse that falls off to nothing, no edge and no plate
    const fresh = sc.n === 0;
    if (sc.n++ % 4 === 0) {
      probe.drawImage(comp, cx - rx, y - ry, rx * 2, ry * 2, 0, 0, 48, 12);
      const d = probe.getImageData(0, 0, 48, 12).data;
      // the brighter pixels decide (the 75th percentile): half the line over a pale lake is
      // hard to read even when the other half is over dark stone
      const ls = [];
      for (let i = 0; i < d.length; i += 4) ls.push((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255);
      ls.sort((p, q) => p - q);
      const lum = ls[Math.floor(ls.length * 0.75)];
      status.scrimLum = Math.round(lum * 100) / 100;
      sc.target = Math.min(1, Math.max(0, (lum - 0.42) / 0.22));
    }
    sc.level = fresh ? sc.target : sc.level + (sc.target - sc.level) * 0.06; // (the caption's own fade covers its start)
    status.scrim = Math.round(sc.level * 100) / 100;
    if (sc.level > 0.01) {
      g.save();
      g.translate(cx, y); g.scale(rx / ry, 1);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, ry);
      const a = 0.24 * sc.level * alpha, stop = (k, f) => grad.addColorStop(k, `rgba(12,10,16,${a * f})`);
      stop(0, 1); stop(0.3, 0.9); stop(0.55, 0.55); stop(0.8, 0.18); stop(1, 0); // (a long, smooth falloff: no edge)
      g.fillStyle = grad; g.fillRect(-ry, -ry, ry * 2, ry * 2);
      g.restore();
    }
    // two shadows: a wide soft one for mood, a tight one so the edges hold
    g.globalAlpha = alpha;
    g.textAlign = left ? 'left' : 'center'; g.textBaseline = 'middle';
    g.fillStyle = c.color;
    g.shadowColor = 'rgba(30,18,8,0.5)'; g.shadowBlur = px * 0.6; g.shadowOffsetY = px * 0.04;
    lines.forEach((l, i) => g.fillText(l, x, top + i * lineH));
    g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = px * 0.08; g.shadowOffsetY = px * 0.02;
    lines.forEach((l, i) => g.fillText(l, x, top + i * lineH));
    g.restore();
  }
  function endCard(text, k) {
    g.save();
    g.fillStyle = `rgba(10,12,18,${0.58 * k})`;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = k;
    g.font = `600 ${Math.round(H * 0.048)}px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = H * 0.016;
    g.fillStyle = '#fff';
    g.fillText(text, W / 2, H * 0.5);
    g.restore();
  }
  function bubble() {
    const el = document.querySelector('.bubble');
    if (!el || !el.classList.contains('on') || !el.textContent) return;
    const x = (parseFloat(el.style.left) / window.innerWidth) * W, y = (parseFloat(el.style.top) / window.innerHeight) * H;
    const s = H / 900;
    g.save();
    g.font = `600 ${Math.round(13.5 * s)}px ${FONT}`;
    const w = g.measureText(el.textContent).width + 22 * s, h = 27 * s;
    g.shadowColor = 'rgba(20,20,30,0.25)'; g.shadowBlur = 8 * s; g.shadowOffsetY = 2 * s;
    g.fillStyle = '#fbfaf6';
    g.beginPath(); g.roundRect(x - w / 2, y - h, w, h, 12 * s); g.fill();
    g.beginPath(); g.moveTo(x - 6 * s, y - 1); g.lineTo(x, y + 7 * s); g.lineTo(x + 6 * s, y - 1); g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = '#2a2d38'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(el.textContent, x, y - h / 2);
    g.restore();
  }
  function stats() {
    const s = H / 900, info = pipeline.renderer.info.render;
    const lines = [`${fpsText} fps  ${renderMs.toFixed(1)} ms`, `${info.calls} calls  ${(info.triangles / 1000).toFixed(1)}k tris`];
    g.save();
    g.font = `${Math.round(12 * s)}px ui-monospace, "Cascadia Mono", Consolas, monospace`;
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 20 * s, h = (lines.length * 17.4 + 12) * s;
    g.fillStyle = 'rgba(14,16,22,0.58)';
    g.beginPath(); g.roundRect(12 * s, H - 40 * s - h, w, h, 6 * s); g.fill();
    g.fillStyle = '#d9dce4'; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, 22 * s, H - 40 * s - h + (6 + i * 17.4) * s));
    g.restore();
  }
  /** The things-to-do list, as the game draws it under the jog card (read from its DOM: items, ticks, count). */
  function todoList(alpha) {
    const box = document.querySelector('.todo');
    if (!box) return;
    // (1.5x the game's size: a video is watched small, on a phone in a feed)
    const s = (H / 900) * 1.5, x = 14 * s, y = 12 * s, pad = 11 * s;
    const items = [...box.querySelectorAll('li')].map((li) => ({ text: li.textContent.trim(), done: li.classList.contains('done') }));
    const title = (box.querySelector('.todo-head i')?.textContent || 'Things to do at Sukhna').toUpperCase();
    const count = box.querySelector('.todo-head b')?.textContent || `0/${items.length}`;
    g.save();
    g.globalAlpha = alpha;
    g.font = `${Math.round(13 * s)}px ${FONT}`;
    const w = Math.max(240 * s, ...items.map((i) => g.measureText(i.text).width + 46 * s));
    const rowH = 21 * s, h = pad * 2 + 18 * s + items.length * rowH;
    g.fillStyle = 'rgba(14,16,22,0.55)'; g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = Math.max(1, s);
    g.beginPath(); g.roundRect(x, y, w, h, 8 * s); g.fill(); g.stroke();
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round(10.5 * s)}px ${FONT}`; g.fillStyle = '#9aa0ad';
    g.fillText(title.split('').join(String.fromCharCode(8202)), x + pad, y + pad + 7 * s);
    g.font = `600 ${Math.round(12.5 * s)}px ui-monospace, "Cascadia Mono", Consolas, monospace`; g.fillStyle = '#f2c230'; g.textAlign = 'right';
    g.fillText(count, x + w - pad, y + pad + 7 * s);
    g.textAlign = 'left';
    items.forEach((it, k) => {
      const cy = y + pad + 18 * s + rowH * k + rowH / 2, r = 6.5 * s, cx = x + pad + r;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2);
      if (it.done) { g.fillStyle = '#f2c230'; g.fill(); g.strokeStyle = '#2a2d38'; g.lineWidth = 1.8 * s; g.beginPath(); g.moveTo(cx - 3 * s, cy); g.lineTo(cx - 0.8 * s, cy + 2.4 * s); g.lineTo(cx + 3.2 * s, cy - 2.6 * s); g.stroke(); }
      else { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.6 * s; g.stroke(); }
      g.font = `${Math.round(13 * s)}px ${FONT}`; g.fillStyle = it.done ? '#9aa0ad' : '#e8eaf0';
      g.fillText(it.text, cx + r + 9 * s, cy + 0.5 * s);
    });
    g.restore();
  }
  /** The start card, as the game draws it (read from its DOM), over the frame. */
  function startCard() {
    const s = Math.min(H / 900, W / 820), cw = 760 * s, ch = 400 * s, x = (W - cw) / 2, y = (H - ch) / 2;
    const q = (sel) => document.querySelector(sel);
    const grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(40,48,78,.55)'); grad.addColorStop(0.55, 'rgba(231,163,90,.28)'); grad.addColorStop(1, 'rgba(201,224,247,.35)');
    g.save();
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(47,51,70,.25)'; g.fillRect(x + 8 * s, y + 10 * s, cw, ch);
    g.fillStyle = '#fbf7ee'; g.fillRect(x, y, cw, ch);
    // the art panel
    const aw = 200 * s;
    const sky = g.createLinearGradient(0, y, 0, y + ch);
    sky.addColorStop(0, '#e7a35a'); sky.addColorStop(0.55, '#f4d7a8'); sky.addColorStop(0.56, '#c9d7e6'); sky.addColorStop(1, '#8c96a6');
    g.fillStyle = sky; g.fillRect(x, y, aw, ch);
    g.save(); g.beginPath(); g.rect(x, y, aw, ch); g.clip();
    g.fillStyle = '#ffd55a'; g.shadowColor = 'rgba(255,213,90,.6)'; g.shadowBlur = 40 * s;
    g.beginPath(); g.arc(x + aw * 0.58, y + ch * 0.4, 23 * s, 0, Math.PI * 2); g.fill(); g.shadowColor = 'transparent';
    g.fillStyle = '#a9b3c6'; g.beginPath(); g.ellipse(x + aw * 0.5, y + ch * 0.44 + 45 * s, aw * 0.84, 45 * s, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#7d8aa3'; g.beginPath(); g.ellipse(x + aw * 0.3, y + ch * 0.49 + 45 * s, aw * 0.75, 45 * s, 0, Math.PI, 0); g.fill();
    const water = g.createLinearGradient(0, y + ch * 0.56, 0, y + ch); water.addColorStop(0, '#d7b99a'); water.addColorStop(1, '#8c96a6');
    g.fillStyle = water; g.fillRect(x, y + ch * 0.56, aw, ch * 0.44);
    g.translate(x + aw / 2, y + ch * 0.82); g.rotate(-0.1); g.fillStyle = '#b9b3a4'; g.fillRect(-aw, -9 * s, aw * 2, 5 * s); g.fillStyle = '#9a978d'; g.fillRect(-aw, -4 * s, aw * 2, 18 * s);
    g.restore();
    g.strokeStyle = '#2f3346'; g.lineWidth = 2 * s; g.strokeRect(x, y, cw, ch); g.beginPath(); g.moveTo(x + aw, y); g.lineTo(x + aw, y + ch); g.stroke();
    // the copy
    let cy = y + 36 * s; const cx = x + aw + 30 * s, tw = cw - aw - 60 * s;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#8a6a4a'; g.font = `700 ${11 * s}px ${FONT}`;
    g.fillText((q('.kicker .start-only')?.textContent || '').toUpperCase().split('').join(String.fromCharCode(8202)), cx, cy); cy += 50 * s;
    g.fillStyle = '#2f3346'; g.font = `700 ${46 * s}px ${FONT}`; g.fillText(q('#card-title')?.textContent || 'Sukhna', cx, cy); cy += 30 * s;
    g.fillStyle = '#5a5f73'; g.font = `400 ${17 * s}px "Nirmala UI", ${FONT}`; g.fillText(q('.names')?.textContent || '', cx, cy); cy += 28 * s;
    g.fillStyle = '#4a4f60'; g.font = `400 ${13.5 * s}px ${FONT}`;
    const words = (q('p.start-only')?.textContent || '').split(' ');
    let line = '';
    for (const wd of words) { if (g.measureText(line + wd).width > tw) { g.fillText(line, cx, cy); cy += 21 * s; line = ''; } line += wd + ' '; }
    g.fillText(line, cx, cy); cy += 22 * s;
    // outfits
    let bx = cx;
    [...document.querySelectorAll('.outfits button')].forEach((b, i) => {
      const label = b.querySelector('em')?.textContent || '', sw = [...b.querySelectorAll('span')].map((sp) => sp.style.background);
      g.font = `400 ${12 * s}px ${FONT}`;
      const bw = g.measureText(label).width + (26 + sw.length * 16) * s, bh = 28 * s;
      const on = card.pick === i;
      if (on) { g.fillStyle = '#2f3346'; g.fillRect(bx + 2 * s, cy + 2 * s, bw, bh); }
      g.fillStyle = '#fff'; g.fillRect(bx, cy, bw, bh);
      g.strokeStyle = on ? '#2f3346' : '#c9c2b2'; g.lineWidth = 1.5 * s; g.strokeRect(bx, cy, bw, bh);
      sw.forEach((c, k) => { g.fillStyle = c; g.beginPath(); g.arc(bx + (16 + k * 16) * s, cy + bh / 2, 6 * s, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = '#3a3f50'; g.textBaseline = 'middle'; g.fillText(label, bx + (12 + sw.length * 16 + 4) * s, cy + bh / 2); g.textBaseline = 'alphabetic';
      bx += bw + 8 * s;
    });
    cy += 44 * s;
    g.fillStyle = '#6a6f80'; g.font = `400 ${11.5 * s}px ${FONT}`;
    const ctl = q('.controls')?.textContent || '';
    g.fillText(ctl.length > 90 ? ctl.slice(0, ctl.lastIndexOf('·', 90)) : ctl, cx, cy); cy += 18 * s;
    // the button (pressed in for a moment when "clicked")
    const pressed = card.pressAt >= 0 && t - card.pressAt < 0.18, off = pressed ? 3 * s : 0;
    g.fillStyle = '#2f3346'; g.fillRect(cx + 4 * s, cy + 4 * s, tw, 42 * s);
    g.fillStyle = '#e8542f'; g.fillRect(cx + off, cy + off, tw, 42 * s);
    g.strokeStyle = '#2f3346'; g.lineWidth = 2 * s; g.strokeRect(cx + off, cy + off, tw, 42 * s);
    g.fillStyle = '#fff'; g.font = `700 ${15 * s}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(q('.overlay .go')?.textContent || 'Start jogging', cx + off + tw / 2, cy + off + 21 * s);
    g.restore();
  }
  function composite() {
    const t0 = list.clip && t < list.clip.until;
    if (t0 && clip) {
      const f = clipFrame();
      if (f) g.drawImage(f, 0, 0, W, H);
    }
    else g.drawImage(canvas, 0, 0, W, H);
    if (!t0) bubble();
    if (statsOn) stats();
    if (todo.from !== null && t >= todo.from) {
      const k = Math.min(1, (t - todo.from) / 0.35, todo.to === null ? 1 : (todo.to + 0.35 - t) / 0.35);
      if (k > 0) todoList(k);
    }
    if (card.show) {
      const k = card.hideAt !== undefined ? 1 - (t - card.hideAt) / 0.45 : 1; // the card's own 0.45 s fade
      if (k > 0) { g.save(); g.globalAlpha = k; startCard(); g.restore(); } else card.show = false;
    }
    if (!captions.some((c) => t >= c.from && t <= c.to)) { scrim.level = 0; scrim.n = 0; } // (each caption judges its own background)
    for (const c of captions) {
      if (t < c.from || t > c.to) continue;
      const k = Math.min(1, (t - c.from) / 0.35, (c.to - t) / 0.35);
      if (c.align === 'left') c.scrim ??= { level: 0, target: 0, n: 0 };
      caption(c.text, Math.max(0, k), c.y ?? list.captionY, c);
    }
    if (list.endCard && t >= list.endCard.at) endCard(list.endCard.text, Math.min(1, (t - list.endCard.at) / (list.endCard.fade ?? 0.8)));
  }

  /* ------------------------------ recording ------------------------------ */
  // The video is encoded here with WebCodecs (H.264), every frame stamped with the game clock
  // -- frame n at n/60 s -- so the file is exactly 60 fps: MediaRecorder on captureStream(60)
  // (the first plan) lost 1-5% of the frames on this machine, one in about every 101, whatever
  // the resolution or the way frames were fed to it.  The encoded frames stream to the dev server
  // (recordings/<name>.video.h264, with a sample table in <name>.video.json); the WebAudio master
  // is recorded alongside by MediaRecorder as AAC (<name>.audio.mp4).  tests/director/record.mjs
  // then writes the two into one MP4, its index at the front (+faststart).
  // ?capture=mediarecorder records the old way (one MediaRecorder on captureStream(60) + audio).
  const MODE = params.get('capture') === 'mediarecorder' || typeof VideoEncoder !== 'function' ? 'mediarecorder' : 'webcodecs';
  let recorder = null, audioRec = null, encoder = null, uploads = Promise.resolve(), file = null, recFrames = 0;
  const parts = {};
  const video = { samples: [], avcC: null, bytes: 0, maxQueue: 0 };
  let pending = [], pendingBytes = 0;
  const upload = (name, blob) => {
    const n = (parts[name] = (parts[name] ?? -1) + 1);
    uploads = uploads.then(() => fetch(`/__recording?name=${encodeURIComponent(name)}&part=${n}`, { method: 'POST', body: blob })).catch((e) => status.errors.push(String(e)));
  };
  const flushVideo = () => { if (pending.length) { upload(`${TAG}.video.h264`, new Blob(pending)); pending = []; pendingBytes = 0; } };
  const frameWait = () => new Promise((r) => setTimeout(r, 16));
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
  function audioStream() {
    if (!sound.ctx || !sound.nodes?.comp || params.has('noaudio')) return null;
    const dest = sound.ctx.createMediaStreamDestination();
    sound.nodes.comp.connect(dest);
    return dest.stream;
  }
  async function startRecording() {
    const tag = TAG;
    if (MODE === 'mediarecorder') {
      const stream = comp.captureStream(60);
      for (const tr of audioStream()?.getAudioTracks() || []) stream.addTrack(tr);
      const mimeType = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4', 'video/webm;codecs=h264,opus'].find((m) => MediaRecorder.isTypeSupported(m));
      file = `${tag}.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: W >= 2560 ? 40e6 : 24e6, audioBitsPerSecond: 256000 });
      recorder.ondataavailable = (ev) => { if (ev.data.size) upload(file, ev.data); };
      recorder.start(1000);
      Object.assign(status, { mode: MODE, mimeType, file });
      return;
    }
    const codec = W >= 2560 ? 'avc1.640033' : 'avc1.64002A';
    const config = { codec, width: W, height: H, bitrate: W >= 2560 ? 40e6 : 24e6, framerate: 60, latencyMode: 'quality', avc: { format: 'avc' },
      // the hardware H.264 encoder only goes to 1080p here; 1440p is encoded in software (~85 fps)
      hardwareAcceleration: W > 1920 ? 'no-preference' : 'prefer-hardware' };
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description && !video.avcC) video.avcC = b64(new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer));
        const buf = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buf);
        video.samples.push([chunk.byteLength, chunk.type === 'key' ? 1 : 0, chunk.timestamp]);
        video.bytes += chunk.byteLength;
        pending.push(buf); pendingBytes += buf.length;
        if (pendingBytes > 4e6) flushVideo();
      },
      error: (e) => status.errors.push(`encoder: ${e.message}`),
    });
    encoder.configure(config);
    // warm the encoder up (its first frames are slow) on a throwaway encoder of the same kind
    {
      const warm = new VideoEncoder({ output: () => {}, error: () => {} });
      warm.configure(config);
      for (let i = 0; i < 30; i++) { render(); composite(); const vf = new VideoFrame(comp, { timestamp: Math.round((i * 1e6) / 60) }); warm.encode(vf, { keyFrame: i === 0 }); vf.close(); await frameWait(); }
      await warm.flush(); warm.close();
    }
    const as = audioStream();
    const audioOpts = { mimeType: 'audio/mp4;codecs=mp4a.40.2', audioBitsPerSecond: 256000 };
    if (as) {
      // the audio recorder's start hitches the page too: warm one up and throw it away
      const warm = new MediaRecorder(as, audioOpts);
      warm.start(250);
      for (let i = 0; i < 30; i++) { render(); composite(); await frameWait(); }
      await new Promise((r) => { warm.onstop = r; warm.stop(); });
    }
    // settle: a few frames of nothing new, so any hitch lands before the first recorded frame
    for (let i = 0; i < 20; i++) { render(); composite(); await frameWait(); }
    if (as) {
      audioRec = new MediaRecorder(as, audioOpts);
      audioRec.ondataavailable = (ev) => { if (ev.data.size) upload(`${tag}.audio.mp4`, ev.data); };
      audioRec.start(1000);
    }
    file = `${tag}.mp4`;
    Object.assign(status, { mode: MODE, codec, file, hardware: config.hardwareAcceleration });
  }
  /** After each composited frame: encode it, stamped n/60 s. */
  function record() {
    if (!encoder) return;
    const n = recFrames++;
    const vf = new VideoFrame(comp, { timestamp: Math.round((n * 1e6) / 60), duration: Math.round(1e6 / 60) });
    encoder.encode(vf, { keyFrame: n % 120 === 0 });
    vf.close();
    video.maxQueue = Math.max(video.maxQueue, encoder.encodeQueueSize);
  }
  async function stopRecording() {
    if (recorder) { await new Promise((res) => { recorder.onstop = res; recorder.stop(); }); await uploads; return; }
    if (audioRec) await new Promise((res) => { audioRec.onstop = res; audioRec.stop(); });
    await encoder.flush(); encoder.close();
    flushVideo();
    const tag = TAG;
    upload(`${tag}.video.json`, new Blob([JSON.stringify({ width: W, height: H, fps: 60, codec: status.codec, avcC: video.avcC, samples: video.samples, frames: recFrames, audio: !!audioRec })]));
    await uploads;
    Object.assign(status, { encoded: video.samples.length, encoderMaxQueue: video.maxQueue, videoBytes: video.bytes });
  }

  /* ------------------------------ the loop ------------------------------ */
  const events = [...(list.events || [])].sort((a, b) => a.at - b.at);
  let t = 0, acc = 0, lastNow = 0, frames = 0;
  const total = Math.round(list.duration / STEP);
  function step() {
    while (events.length && events[0].at <= t + 1e-6) {
      const e = events.shift();
      const fn = ACTIONS[e.do];
      if (!fn) throw new Error(`director: unknown action "${e.do}"`);
      try { fn(e); } catch (err) { status.errors.push(`${e.do} @${e.at}: ${err.message}`); }
    }
    try { if (task && task.step(STEP)) task = null; } catch (err) { status.errors.push(`task @${t.toFixed(2)}: ${err.message}`); task = null; }
    for (let i = lapses.length - 1; i >= 0; i--) if (lapses[i](STEP)) lapses.splice(i, 1);
    tick(STEP);
    if (pace === 'walk' && jogger.speed > 1.5) jogger.speed = 1.5;
    t = ++frames * STEP;
  }
  // the readout's "ms": the GPU's time for the frame, from a timer query (it never stalls the
  // frame, unlike reading pixels back); without the extension, the CPU time of the render call
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const queries = [];
  status.statsSource = tq ? 'gpu timer query' : 'cpu';
  function draw() {
    const timing = statsOn && tq && queries.length < 8;
    let q = null;
    if (timing) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
    const t0 = performance.now();
    render();
    const cpu = performance.now() - t0;
    if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); queries.push(q); }
    while (queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const done = queries.shift(), ns = gl.getQueryParameter(done, gl.QUERY_RESULT);
      gl.deleteQuery(done);
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) renderMs += (ns / 1e6 - renderMs) * 0.1;
    }
    if (statsOn && !tq) renderMs += (cpu - renderMs) * 0.1;
    composite();
    record();
  }
  status.state = 'ready';
  // settle a moment before recording (textures, shaders, the first frames' weather and look)
  for (let i = 0; i < 20; i++) { render(); }
  if (recording) await startRecording();
  status.state = recording ? 'recording' : 'playing';
  await new Promise((done) => {
    // paced by a timer on performance.now(), not by animation frames: frames are encoded
    // straight from the canvas, so the video must not depend on the window being on screen
    // (with the display asleep, Chrome gave the page one animation frame a second, and a
    // recording's 15 s took 114 s of real time against its real-time audio)
    const next = (fn) => setTimeout(() => fn(performance.now()), 2);
    function loop(now) {
      try { frameStep(now); } catch (err) { status.errors.push(`frame @${t.toFixed(2)}: ${err.stack || err}`); status.state = 'error'; done(); return; }
      if (frames >= total) { done(); return; }
      next(loop);
    }
    function frameStep(now) {
      if (lastNow) {
        const gap = now - lastNow;
        status.maxGapMs = Math.max(status.maxGapMs, gap);
        acc += gap / 1000;
      } else acc = STEP;
      lastNow = now;
      if (acc > 0.5) acc = 0.5; // a long stall is caught up over the next frames (8 steps a frame at most)
      let n = 0;
      // one frame per step: after a hitch (a cut to a new place refills the trees, the crowd and
      // the shadows) the steps it owes are each drawn and recorded, so the video misses nothing
      // and stays in step with the real-time audio; they only show late in the window
      while (acc >= STEP - 1e-4 && n < 8 && frames < total) {
        step(); draw(); acc -= STEP; n++;
        status.renders++;
      }
      if (n) {
        if (n > 1) { status.lateTicks += n - 1; (status.lateAt ||= []).push(+t.toFixed(2)); }
        status.frames.push(Math.round(now * 10) / 10);
        status.t = t;
      }
    }
    next(loop);
  });
  if (recording) await stopRecording();
  status.state = 'done';
  return status;
}
