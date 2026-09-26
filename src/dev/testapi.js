/* ------------------------------------------------------------------ *
 * window.__test -- the playtest's handle on the game (tests/playtest).
 *
 * Dev only: main.js imports this inside `if (import.meta.env.DEV)`, so a
 * production build never contains it.  Everything goes through the same
 * code a player does -- key events on window, the per-frame tick() -- and
 * `advance()` fast-forwards that tick without drawing, so a full lap of
 * auto-jog takes seconds, not half an hour.
 * ------------------------------------------------------------------ */

import { spineAt, nearestS, inLake, shoreDist, azimuthForYaw, yawForAzimuth, L } from '../world/frame.js';
import { BENCHES, BENCH_SEAT, walkY, DAM } from '../world/dam.js';
import { BOAT } from '../core/boat.js';

export function installTestApi(ctx) {
  const { THREE, world, jogger, collider, interact, boat, hud, rig, camera, tod, weather, sound, pipeline, perf, tick, updateTime, placeLights } = ctx;
  const errors = [];
  const origError = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map(String).join(' ')); origError(...a); };
  window.addEventListener('error', (e) => errors.push(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${e.reason?.message ?? e.reason}`));

  const KEY = { W: 'KeyW', A: 'KeyA', S: 'KeyS', D: 'KeyD', E: 'KeyE', V: 'KeyV', T: 'KeyT', K: 'KeyK', P: 'KeyP', M: 'KeyM', H: 'KeyH', C: 'KeyC', Shift: 'ShiftLeft', Esc: 'Escape', Escape: 'Escape' };
  const code = (k) => KEY[k] || k;
  const keyName = (c) => (c.startsWith('Key') ? c.slice(3).toLowerCase() : c === 'ShiftLeft' ? 'Shift' : c);
  const send = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { code: code(k), key: keyName(code(k)), bubbles: true, shiftKey: code(k) === 'ShiftLeft' && type === 'keydown' }));
  const onDeck = (e, n) => collider.decks.some((d) => { const de = e - d.e, dn = n - d.n; const u = de * d.ue + dn * d.un, v = -de * d.un + dn * d.ue; return Math.abs(u) <= d.half && Math.abs(v) <= d.w; });
  const faceYaw = (face, s) => {
    const f = spineAt(s ?? nearestS(jogger.e, jogger.n).s);
    if (typeof face === 'number') return yawForAzimuth(face);
    if (face === 'lake') return Math.atan2(-f.ne, f.nn);
    if (face === 'city') return Math.atan2(f.ne, -f.nn);
    if (face === 'west') return Math.atan2(-f.te, f.tn); // +s
    if (face === 'east') return Math.atan2(f.te, -f.tn); // -s
    return rig.yaw;
  };

  // what's under the feet: the real meshes (dam, stairs, landmarks, terrain), by a ray
  const ray = new THREE.Raycaster();
  ray.layers.enableAll();
  const groundRoots = () => [world.dam.group, world.landmarks.group, world.band, ...(world.terrain.group ? [world.terrain.group] : [])].filter(Boolean);
  const visibleChain = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };

  const api = {
    ready: true,
    version: 1,
    gpu() {
      const gl = pipeline.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },

    /* ---------------- moving the player ---------------- */
    /** Put the jogger at arc length s, `lateral` m toward the lake (−: city), facing `face`. */
    teleport(s, lateral = 0, face = 'west') {
      interact.cancel();
      jogger.auto = false;
      jogger.keys.clear();
      jogger.speed = 0;
      const f = spineAt(s);
      jogger.e = f.e + f.ne * lateral; jogger.n = f.n + f.nn * lateral;
      jogger.y = collider.surfaceAt(jogger.e, jogger.n);
      const yaw = faceYaw(face, s);
      jogger.heading = yaw; rig.yaw = yaw; rig.pitch = -0.12;
      if (rig.mode === 'overview') rig.setOverview(false);
      return api.getPlayer();
    },
    /** Put the jogger at world (e, n). */
    teleportTo(e, n, face) { interact.cancel(); jogger.auto = false; jogger.keys.clear(); jogger.speed = 0; jogger.e = e; jogger.n = n; jogger.y = collider.surfaceAt(e, n); if (face !== undefined) { const y = faceYaw(face); jogger.heading = y; rig.yaw = y; } return api.getPlayer(); },
    /** Turn the camera (and so what W means): 'lake' | 'city' | 'west' (+s) | 'east' (−s) | azimuth°. */
    face(face) { const y = faceYaw(face); rig.yaw = y; return azimuthForYaw(y); },
    setTime(preset) { if (typeof preset === 'number') tod.state.hours = preset; tod.set(typeof preset === 'string' ? preset : undefined); updateTime(0, false); return { clock: tod.clock(), label: tod.label(), elevation: tod.state.sun.elevation }; },
    setWeather(w) { weather.set(w, true); tod.set(); updateTime(0, false); hud.setWeather(w); return weather.state.kind; },
    /** Key events, exactly as the keyboard sends them. */
    keydown(k) { send('keydown', k); },
    keyup(k) { send('keyup', k); },
    hold(k) { send('keydown', k); },
    release(k) { send('keyup', k); },
    async press(k, ms = 60) { send('keydown', k); await new Promise((r) => setTimeout(r, ms)); send('keyup', k); },
    /**
     * Run the game's own per-frame logic for `seconds` of game time at `dt`, without
     * drawing.  `every` s: record getPlayer() samples (and `probe()` extras) along the way.
     */
    advance(seconds, { dt = 1 / 30, every = 0, ground = false, crowd = false } = {}) {
      const samples = [];
      let t = 0, next = 0;
      while (t < seconds - 1e-9) {
        tick(dt);
        t += dt;
        if (every && t >= next) {
          const p = api.getPlayer();
          p.t = +t.toFixed(3);
          if (ground) p.ground = api.footProbe();
          if (crowd) p.near = api.crowdNearCamera();
          samples.push(p);
          next += every;
        }
      }
      placeLights();
      return samples;
    },

    /* ---------------- reading the game ---------------- */
    getPlayer() {
      const w = nearestS(jogger.e, jogger.n);
      const surface = collider.surfaceAt(jogger.e, jogger.n);
      const st = interact.state;
      const state = st === 'bench' || st === 'steps' ? 'sitting' : st === 'boat' ? 'boating' : st === 'yoga' || st === 'group' ? 'in-group' : st === 'chai' ? 'chai'
        : jogger.speed > 3.4 ? 'running' : jogger.speed > 2.2 ? 'jogging' : jogger.speed > 0.3 ? 'walking' : 'idle';
      return {
        e: +jogger.e.toFixed(3), n: +jogger.n.toFixed(3), y: +jogger.y.toFixed(3), s: +w.s.toFixed(2), d: +(w.side * w.d).toFixed(2),
        surface: +surface.toFixed(3), heightAboveGround: +(jogger.y - surface).toFixed(3),
        speed: +jogger.speed.toFixed(3), heading: +azimuthForYaw(jogger.heading).toFixed(1), state, activity: st,
        stamina: +jogger.stamina.toFixed(1), auto: jogger.auto, autoDir: jogger.autoDir, lengths: jogger.lengths,
        distance: +jogger.distance.toFixed(1), pace: jogger.pace(), sitting: jogger.sitting, frozen: jogger.frozen,
        onWater: inLake(jogger.e, jogger.n) && !onDeck(jogger.e, jogger.n), finite: [jogger.e, jogger.n, jogger.y].every(Number.isFinite),
      };
    },
    nearestInteractable() { return interact.current; },
    lastFive() { return interact.lastFive; },
    getHud() {
      const q = (s) => document.querySelector(s);
      const pill = (el) => ({ visible: !!el && el.classList.contains('on'), text: el?.textContent ?? '' });
      return {
        clock: q('[data-c=clock]')?.textContent, preset: q('[data-c=preset]')?.textContent, weather: q('[data-c=weather]')?.textContent, sound: q('[data-c=sound]')?.textContent,
        prompt: pill(q('.prompt')), bubble: pill(q('.bubble')), toast: pill(q('.toast')),
        hidden: !!q('.jog')?.classList.contains('off') && !!q('.cond')?.classList.contains('off') && !!q('.hintbar')?.classList.contains('off'),
        hint: q('.hintbar')?.textContent, started: hud.started, paused: hud.paused,
        ticket: !!q('.ticket')?.classList.contains('on'),
        stats: [...document.querySelectorAll('.jog-grid > div')].filter((d) => !d.classList.contains('off')).map((d) => `${d.querySelector('i')?.textContent}: ${d.querySelector('b')?.textContent}`),
        mode: q('.jog-mode')?.textContent,
        card: { visible: !q('.overlay')?.classList.contains('hidden'), mode: q('.overlay')?.dataset.mode },
        overview: rig.mode === 'overview',
      };
    },
    runChecks() { return (world.rerunChecks ? world.rerunChecks() : window.__checks || []).map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })); },
    consoleErrors() { return errors.slice(); },
    clearErrors() { errors.length = 0; },

    /* ---------------- probes for the scenarios ---------------- */
    /** The rendered surface under the player's feet (dam, stairs, jetty, terrain), by raycast. */
    /** The highest rendered surface under a foot: ±0.1 m along the way the jogger faces. */
    footProbe() {
      const fx = -Math.sin(jogger.heading), fn = Math.cos(jogger.heading);
      let best = null;
      for (const k of [-0.1, 0, 0.1]) { const g = api.groundProbe(jogger.e + fx * k, jogger.n + fn * k); if (g && (!best || g.y > best.y)) best = g; }
      return best;
    },
    groundProbe(e = jogger.e, n = jogger.n) {
      ray.set(new THREE.Vector3(e, jogger.y + 3, -n), new THREE.Vector3(0, -1, 0));
      ray.far = 12;
      const hit = ray.intersectObjects(groundRoots(), true).find((h) => visibleChain(h.object));
      return hit ? { y: +hit.point.y.toFixed(3), name: hit.object.name || hit.object.parent?.name || hit.object.type } : null;
    },
    /** Every flight: the water steps and jetty stair, and the city stairs. */
    flights() {
      const out = [];
      for (const st of world.dam.waterStairs) out.push({ side: 'lake', kind: st.pier ? (st.toWater ? 'pier' : 'jetty') : 'bank', s: st.s, width: st.width, top: st.from.y, treads: (st.treads || []).map((t) => ({ d0: t.d0, d1: t.d1, y: t.y })) });
      for (const st of world.dam.cityStairs) out.push({ side: 'city', kind: 'city', s: st.s, width: st.width, top: st.from.y, from: st.from, to: st.to, treads: (st.treads || []).map((t) => ({ d0: t.d0, d1: t.d1, y: t.y })) });
      return out;
    },
    benches() { return BENCHES.map((b, i) => ({ i, s: b.s, d: b.d, occupied: world.crowd.people.some((p) => p.bench === b), seat: walkY(b.s) + BENCH_SEAT })); },
    /** Put the jogger right at bench i (so E offers it). */
    toBench(i) { const b = BENCHES[i]; const f = spineAt(b.s); return api.teleportTo(f.e + f.ne * (b.d + 0.5), f.n + f.nn * (b.d + 0.5), 'lake'); },
    /** The lowest world-space point of each body part (the jogger as drawn). */
    bodyLows() {
      const out = {};
      const v = new THREE.Vector3();
      jogger.group.updateMatrixWorld(true);
      jogger.parts.forEach((m, k) => {
        if (!m || !m.visible || !m.geometry) return;
        const pos = m.geometry.attributes.position;
        let lo = Infinity, at = null;
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); if (v.y < lo) { lo = v.y; at = [v.x, -v.z]; } }
        if (Number.isFinite(lo) && Math.abs(m.matrixWorld.determinant()) > 1e-12) out[m.name.replace('jogger.', '')] = { y: +lo.toFixed(3), e: +at[0].toFixed(2), n: +at[1].toFixed(2) };
      });
      return out;
    },
    /** Is the jogger in frame, and not hidden behind something? (NDC of head and hips, and a ray from the camera.) */
    joggerInFrame() {
      camera.updateMatrixWorld();
      const head = new THREE.Vector3(), hips = new THREE.Vector3();
      jogger.eye(head);
      hips.set(jogger.e, jogger.y + 0.55, -jogger.n);
      const hN = head.clone().project(camera), pN = hips.clone().project(camera);
      const inside = (p) => p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
      ray.set(camera.position, head.clone().sub(camera.position).normalize());
      ray.far = camera.position.distanceTo(head) + 0.3;
      const blockers = [world.dam.group, world.landmarks.group, world.city?.group].filter(Boolean);
      const hit = ray.intersectObjects(blockers, true).find((h) => visibleChain(h.object));
      const blocked = hit && hit.distance < camera.position.distanceTo(head) - 0.25;
      return { head: [+hN.x.toFixed(2), +hN.y.toFixed(2)], hips: [+pN.x.toFixed(2), +pN.y.toFixed(2)], inFrame: inside(hN) && inside(pN), occluded: !!blocked, by: blocked ? hit.object.name : null, camDist: +camera.position.distanceTo(head).toFixed(2) };
    },
    /** People near the camera: distance and how faded (1 shown, 0 gone). */
    crowdNearCamera(r = 2.5) {
      return world.crowd.people.filter((p) => p.visible && p.camDist < r).map((p) => ({ id: p.id, dist: +p.camDist.toFixed(2), fade: +p.fade.toFixed(2) }));
    },
    crowdDensity() {
      const movers = world.crowd.people.filter((p) => p.mode === 'walk' && p.leader === undefined);
      return { active: movers.filter((p) => p.active).length, movers: movers.length, sinceSunrise: tod.sinceSunrise(ctx.data.sun.sunrise), hours: tod.state.hours, fog: weather.state.fog };
    },
    lamps() { return world.dam.lampLevel; },
    music() { const N = sound.nodes || {}, g = N.music?.gain?.value ?? 0, bus = (k) => +(N[k]?.gain?.value ?? 0).toFixed(3); return { enabled: sound.enabled, music: sound.music, gain: +g.toFixed(3), mode: sound.mode, ctx: sound.ctx?.state ?? 'none', buses: { amb: bus('amb'), rain: bus('rain'), boat: bus('boat') } }; },
    camera() { return { mode: rig.mode, yaw: +azimuthForYaw(rig.yaw).toFixed(1), pitch: +THREE.MathUtils.radToDeg(rig.pitch).toFixed(1), boom: +rig.boom.toFixed(2), pos: camera.position.toArray().map((x) => +x.toFixed(2)) } },
    bench(n = 120) { return window.__bench(n); },
    renderOnce() { placeLights(); pipeline.render(); },
    world: () => ({ L, parIn: DAM.parIn, parOut: DAM.parOut, near: world.debug.NEAR.rect, step: world.debug.NEAR.step }),
    /**
     * Stand somewhere: the chai stall, the yoga group, the laughter club or a chatting circle
     * (kind: chai | yoga | laugh | chat), the ticket counter ('counter'), the stair head over
     * the jetty ('jettyStair', facing down it), or on the jetty beside a moored swan ('berth').
     */
    toSpot(kind) {
      if (kind === 'chai') { const [e, n] = world.landmarks.plaza.kiosk; return api.teleportTo(e + 2, n + 0.5); }
      const club = world.landmarks.club, jf = spineAt(club.jetty.s);
      if (kind === 'counter') { const [e, n] = club.shack.counter; const p = api.teleportTo(e, n); api.lookAt(club.shack.e, club.shack.n); return p; }
      if (kind === 'jettyStair') return api.teleport(club.jetty.s, DAM.parIn - 0.6, 'lake');
      if (kind === 'berth') { const b = club.berths.find((x) => x.color && x.d > club.jetty.d0 + 8); const p = api.teleportTo(b.e - jf.te * b.side * 2.3, b.n - jf.tn * b.side * 2.3); api.lookAt(b.e, b.n); return { ...p, berth: b.i }; }
      if (kind === 'laugh' || kind === 'chat') {
        const c = world.crowd.circles.find((x) => x.kind === kind);
        if (!c) return null;
        // 2.5 m outside the circle's edge, on open ground, facing its middle
        for (let a = 0; a < 6.28; a += 0.3) { const e = c.ce + Math.cos(a) * (c.r + 2.5), n = c.cn + Math.sin(a) * (c.r + 2.5); if (collider.free(e, n)) { const p = api.teleportTo(e, n); api.lookAt(c.ce, c.cn); return p; } }
        return null;
      }
      const group = world.crowd.people.filter((p) => p.act === kind);
      const c = group.reduce((a, p) => [a[0] + p.e / group.length, a[1] + p.n / group.length], [0, 0]);
      // just outside the group, on open ground
      for (let r = 3; r < 7; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) { const e = c[0] + Math.cos(a) * r, n = c[1] + Math.sin(a) * r; if (collider.free(e, n) && !group.some((p) => Math.hypot(p.e - e, p.n - n) < 1)) return api.teleportTo(e, n); }
      return null;
    },
    /** A person to meet: 'walker' (walking, < 2 m/s) or 'runner' (> 2 m/s), with where they are going. */
    findPerson(kind = 'walker', minS = 200, maxS = 2300) {
      const ok = (p) => p.active && p.mode === 'walk' && p.leader === undefined && p.s > minS && p.s < maxS && (kind === 'runner' ? p.speed > 2.2 : p.speed < 1.8 && p.speed > 0.8);
      const p = world.crowd.people.find(ok);
      return p ? { id: p.id, s: p.s, d: p.d, dir: p.dir, speed: p.speed, e: p.e, n: p.n } : null;
    },
    person(id) { const p = world.crowd.people[id]; return p ? { id, e: p.e, n: p.n, s: p.s, d: p.d, dir: p.dir, speed: p.speed, hf: p.hf ?? 0, active: p.active } : null; },
    /** Is (e, n) inside a building footprint (OSM), with the collider's 0.35 m margin? */
    insideBuilding(e = jogger.e, n = jogger.n, margin = 0) {
      return ctx.data.features.buildings.some((b) => { const de = e - b.c[0], dn = n - b.c[1], ca = Math.cos(b.a), sa = Math.sin(b.a); const u = de * ca + dn * sa, v = -de * sa + dn * ca; return Math.abs(u) < b.l / 2 - margin && Math.abs(v) < b.w / 2 - margin; });
    },
    /** A building within reach of the walk: its centre, size and the free spot in front of it. */
    buildingNear(s = 1200) {
      const f = spineAt(s);
      let best = null;
      for (const b of ctx.data.features.buildings) { const d = Math.hypot(b.c[0] - f.e, b.c[1] - f.n); if (d < 400 && Math.min(b.l, b.w) > 8 && (!best || d < best.d)) best = { d, b }; }
      if (!best) return null;
      const b = best.b;
      // a free spot 8-12 m from the footprint, toward the walk
      const dir = [f.e - b.c[0], f.n - b.c[1]], l = Math.hypot(...dir);
      for (let r = Math.max(b.l, b.w) / 2 + 6; r < Math.max(b.l, b.w) / 2 + 30; r += 1) { const e = b.c[0] + dir[0] / l * r, n = b.c[1] + dir[1] / l * r; if (collider.free(e, n)) return { c: b.c, l: b.l, w: b.w, a: b.a, from: [e, n] }; }
      return null;
    },
    /** Point the camera (and so W) at world (e, n). */
    lookAt(e, n) { const y = Math.atan2(-(e - jogger.e), n - jogger.n); rig.yaw = y; jogger.heading = y; return azimuthForYaw(y); },
    setStamina(v) { jogger.stamina = v; },

    /* ---------------- boating and circles ---------------- */
    /** The pedal boat: where it is, how it moves, how far inside the water it keeps. */
    boat() {
      const s = boat.state;
      return { phase: boat.phase, e: +s.e.toFixed(2), n: +s.n.toFixed(2), heading: +azimuthForYaw(s.h).toFixed(1), speed: +s.speed.toFixed(2), distance: +s.distance.toFixed(1), time: +s.time.toFixed(1),
        shore: +(-shoreDist(s.e, s.n, 400)).toFixed(2), clear: +s.clear.toFixed(2), bumps: s.bumps, yielding: s.yielding, berth: boat.berth, color: boat.color, visible: boat.group.visible, margin: BOAT.margin };
    },
    berths() { return world.landmarks.club.berths.map((b) => ({ i: b.i, e: +b.e.toFixed(2), n: +b.n.toFixed(2), side: b.side, d: +b.d.toFixed(1), moored: !!b.color })); },
    jetty() { const j = world.landmarks.club.jetty, f = spineAt(j.s); return { s: j.s, d0: j.d0, d1: j.d1, deckY: j.deckY, e: f.e, n: f.n, ne: f.ne, nn: f.nn, te: f.te, tn: f.tn }; },
    /** Where the jogger is in the jetty's frame (u out along it, v across) and whether on its deck. */
    onJetty() { const f = spineAt(world.landmarks.club.jetty.s), de = jogger.e - f.e, dn = jogger.n - f.n, j = world.landmarks.club.jetty; const u = de * f.ne + dn * f.nn, v = de * f.te + dn * f.tn; return { u: +u.toFixed(2), v: +v.toFixed(2), deck: u > j.d0 && u < j.d1 && Math.abs(v) < 3.05 }; },
    /**
     * Pedal to (e, n) with the real keys (W, A/D, Shift): steer by the bearing each step.
     * Returns the path's worst shore margin, bumps, whether it arrived and how long it took.
     */
    driveTo(e, n, { tol = 8, maxT = 400, fast = false, dt = 1 / 30 } = {}) {
      const keys = jogger.keys;
      let t = 0, worst = Infinity, arrived = false, lastProgress = 0, best = Infinity, fails = 0, framed = 0, frames = 0, maxSpeed = 0, minStamina = 100;
      const s = boat.state;
      while (t < maxT) {
        const de = e - s.e, dn = n - s.n, dist = Math.hypot(de, dn);
        if (dist < tol) { arrived = true; break; }
        if (dist < best - 1) { best = dist; lastProgress = t; }
        if (t - lastProgress > 40) break; // stuck
        let err = Math.atan2(-de, dn) - s.h;
        err = Math.atan2(Math.sin(err), Math.cos(err));
        keys.add('KeyW');
        keys.delete('KeyA'); keys.delete('KeyD');
        if (err > 0.1) keys.add('KeyA'); else if (err < -0.1) keys.add('KeyD');
        if (fast && jogger.stamina > 35) keys.add('ShiftLeft'); else keys.delete('ShiftLeft');
        tick(dt);
        t += dt;
        const sd = -shoreDist(s.e, s.n, 400);
        worst = Math.min(worst, sd);
        maxSpeed = Math.max(maxSpeed, s.speed); minStamina = Math.min(minStamina, jogger.stamina);
        if (sd < BOAT.margin - 0.01) fails++;
        if (Math.round(t / dt) % 15 === 0) { frames++; const f = api.boatInFrame(); if (f.inFrame) framed++; }
      }
      for (const k of ['KeyW', 'KeyA', 'KeyD', 'ShiftLeft']) keys.delete(k);
      placeLights();
      return { arrived, t: +t.toFixed(1), worstShore: +worst.toFixed(2), belowMargin: fails, bumps: s.bumps, left: +Math.hypot(e - s.e, n - s.n).toFixed(1), framed, frames, maxSpeed: +maxSpeed.toFixed(2), minStamina: +minStamina.toFixed(1) };
    },
    /** Are the boat and the jogger in the camera's frame (hull centre, bow, stern, head)? */
    boatInFrame() {
      camera.updateMatrixWorld();
      const s = boat.state, fe = -Math.sin(s.h), fn = Math.cos(s.h);
      const pts = [[s.e, 0.4, s.n], [s.e + fe * 1.3, 0.5, s.n + fn * 1.3], [s.e - fe * 1.3, 0.4, s.n - fn * 1.3]].map(([e, y, n]) => new THREE.Vector3(e, y, -n).project(camera));
      const head = new THREE.Vector3(); jogger.eye(head); const h = head.project(camera);
      const inside = (p) => p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
      return { inFrame: pts.every(inside) && inside(h), hull: pts.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2)]), head: [+h.x.toFixed(2), +h.y.toFixed(2)], camDist: +camera.position.distanceTo(new THREE.Vector3(s.e, 0.5, -s.n)).toFixed(2), camY: +camera.position.y.toFixed(2) };
    },
    /** The standing circles, and the player's place in one. */
    circles() {
      return world.crowd.circles.map((c) => ({ kind: c.kind, ce: +c.ce.toFixed(2), cn: +c.cn.toFixed(2), r: c.r, joined: !!c.player, burst: c.kind === 'laugh' ? world.crowd.laughBurst() : null,
        members: c.members.map((p) => ({ id: p.id, e: +p.e.toFixed(2), n: +p.n.toFixed(2), active: p.active, home: Math.abs(Math.atan2(Math.sin(p.ang - p.ang0), Math.cos(p.ang - p.ang0))) < 0.01 })) }));
    },
    /** Stand at (e, n) and frame (te, tn) from there: the camera's pitch (°) and boom (m) for a picture. */
    frameShot(e, n, te, tn, pitch = -5, boom = 4.5) {
      api.teleportTo(e, n); api.lookAt(te, tn);
      rig.pitch = THREE.MathUtils.degToRad(pitch); rig.boom = rig.boomTarget = boom;
      rig.update(0.016, jogger, { snap: true });
      return api.camera();
    },
    /** Everything the page shows as text (the HUD, the card): to check nothing quotes a price. */
    pageText() { return document.body.innerText; },
    /** The speech bubble on screen now. */
    bubble() { const b = document.querySelector('.bubble'); return { visible: b.classList.contains('on'), text: b.textContent }; },
  };
  window.__test = api;
  return api;
}
