import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from './toon.js';
import { data, shoreDist } from '../world/frame.js';
import { swanParts, SWAN_SEAT } from '../world/landmarks.js';
import { seatPose, applySeat } from '../people/body.js';
import { LAYER, setLayers } from '../world/chunks.js';

/* ------------------------------------------------------------------ *
 * The player's pedal boat (a swan from the boat club's jetty).
 *
 *   W / S       pedal forward / back       Shift  pedal harder (stamina)
 *   A / D       steer (the rudder bites harder with way on, a little at rest)
 *
 * The boat has momentum (it picks up and coasts off over a couple of
 * seconds) and turning inertia.  It is a capsule, 2.9 x 1.5 m, and keeps
 * clear of:
 *
 *   the shore   its centre stays BOAT.margin (2 m) inside the real lake
 *               polygon (islands included), bow and stern 0.6 m; it bumps
 *               off softly, sliding along
 *   decks       the jetty, the pier stairs, the footbridge; the launch; the
 *               OSM piers; every moored swan; the pedal swans out on the
 *               water; the rowing boats
 *   the eight   it yields: inside the eight's lane ahead of it, the boat is
 *               pushed aside, out of its way
 *
 * Getting off is only at the jetty, into a free berth (people/interact.js
 * offers "E · dock" within BOAT.dock m).  The physics (createBoatSim) needs
 * no meshes, so boatWaterCheck (world/index.js) runs it at start-up.
 * ------------------------------------------------------------------ */

export const BOAT = {
  margin: 2.0, endMargin: 0.6, // metres inside the shoreline: the centre, and the bow and stern
  half: 0.7, radius: 0.75,     // the hull as a capsule: +/-0.7 m along the keel, 0.75 m round it
  pedal: 3.0, fast: 4.5, back: 1.2, // m/s
  turn: 0.55,                  // rad/s at pedalling speed
  dock: 6,                     // how near a free berth "E · dock" is offered
  drain: 7, rest: 5,           // stamina per second pedalling hard / easy
};

/* ------------------------------ distances ------------------------------ */

function segPoint(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
function segSeg(a0x, a0y, a1x, a1y, b0x, b0y, b1x, b1y) {
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const d1 = cross(b1x - b0x, b1y - b0y, a0x - b0x, a0y - b0y), d2 = cross(b1x - b0x, b1y - b0y, a1x - b0x, a1y - b0y);
  const d3 = cross(a1x - a0x, a1y - a0y, b0x - a0x, b0y - a0y), d4 = cross(a1x - a0x, a1y - a0y, b1x - a0x, b1y - a0y);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(segPoint(b0x, b0y, b1x, b1y, a0x, a0y), segPoint(b0x, b0y, b1x, b1y, a1x, a1y), segPoint(a0x, a0y, a1x, a1y, b0x, b0y), segPoint(a0x, a0y, a1x, a1y, b1x, b1y));
}
/** Signed distance to an oriented box { e, n, ue, un, hu, hv } (u along (ue, un)). */
function sdBox(e, n, b) {
  const de = e - b.e, dn = n - b.n;
  const qx = Math.abs(de * b.ue + dn * b.un) - b.hu, qy = Math.abs(-de * b.un + dn * b.ue) - b.hv;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}
/** Signed distance to a polygon [[e, n], ...] (negative inside). */
function sdPoly(e, n, poly) {
  let best = Infinity, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    best = Math.min(best, segPoint(a[0], a[1], b[0], b[1], e, n));
    if ((a[1] > n) !== (b[1] > n) && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -best : best;
}

/**
 * The shoreline distance, memoised on an 8 m grid: far from any shore the cell centre's
 * value is close enough (within 5.7 m, sign kept); within 12 m the exact distance.
 */
const CELL = 8, _sd = new Map();
function shoreSD(e, n) {
  const i = Math.floor(e / CELL), j = Math.floor(n / CELL), k = i * 100003 + j;
  let c = _sd.get(k);
  if (c === undefined) { c = shoreDist((i + 0.5) * CELL, (j + 0.5) * CELL, 400); _sd.set(k, c); }
  return Math.abs(c) > 12 ? c : shoreDist(e, n, 400);
}

/* ------------------------------ the physics ------------------------------ */

/**
 * The boat's physics, without meshes.  `world` gives the jetty, berths, stairs and
 * rowing boats; `decks` is the collider's list (jetty, pier stairs, footbridge).
 */
export function createBoatSim(world, decks = []) {
  const club = world.landmarks?.club;
  const boxes = decks.map((d) => ({ e: d.e, n: d.n, ue: d.ue, un: d.un, hu: d.half, hv: d.w + (d.kind === 'jetty' ? 0.2 : d.kind === 'stairs' ? 0.45 : 0.3) }));
  const polys = (data.features.piers || []).map((p) => p.p);
  const launch = club?.launch;
  const caps = []; // this step's moving and moored hulls: [ax, ay, bx, by, r]
  const s = { e: 0, n: 0, h: 0, ve: 0, vn: 0, yawRate: 0, speed: 0, distance: 0, time: 0, wheel: 0, legs: 0, bumps: 0, yielding: false, clear: 0 };

  function gatherCaps() {
    caps.length = 0;
    const hull = (e, n, fe, fn, half, r) => caps.push([e + fe * half, n + fn * half, e - fe * half, n - fn * half, r]);
    for (const b of club?.berths || []) if (b.color) hull(b.e, b.n, -Math.sin(b.yaw), Math.cos(b.yaw), BOAT.half, BOAT.radius);
    const row = world.rowing;
    if (row?.showPedal) for (const w of row.pedal || []) hull(w.e, w.n, -Math.sin(w.yaw), Math.cos(w.yaw), BOAT.half, BOAT.radius);
    // a rowing boat with its oars out: ~3 m either side
    for (const b of row?.boats || []) if (b.fe !== undefined) hull(b.e, b.n, b.fe, b.fn, b.len / 2 - 1, 3.2);
    if (launch) hull(launch.e, launch.n, launch.ue, launch.un, launch.half - launch.w, launch.w);
  }

  /** Clearance (m, negative = overlapping) of a hull at (e, n) heading h, from everything. */
  function clearance(e, n, h) {
    const fe = -Math.sin(h), fn = Math.cos(h), H = BOAT.half, R = BOAT.radius;
    const ax = e + fe * H, ay = n + fn * H, bx = e - fe * H, by = n - fn * H;
    let d = -shoreSD(e, n) - BOAT.margin;
    d = Math.min(d, Math.min(-shoreSD(e + fe * (H + R), n + fn * (H + R)), -shoreSD(e - fe * (H + R), n - fn * (H + R))) - BOAT.endMargin);
    for (let k = -1; k <= 1; k += 0.5) {
      const px = e + fe * H * k, py = n + fn * H * k;
      for (const b of boxes) d = Math.min(d, sdBox(px, py, b) - R);
      for (const p of polys) d = Math.min(d, sdPoly(px, py, p) - R);
    }
    for (const c of caps) d = Math.min(d, segSeg(ax, ay, bx, by, c[0], c[1], c[2], c[3]) - R - c[4]);
    return d;
  }
  /** Which way is clear: the clearance's gradient (unit, in e, n). */
  function away(e, n, h) {
    const k = 0.05, gx = clearance(e + k, n, h) - clearance(e - k, n, h), gy = clearance(e, n + k, h) - clearance(e, n - k, h);
    const l = Math.hypot(gx, gy) || 1;
    return [gx / l, gy / l];
  }

  /** One step: input { f: -1..1 (pedal), s: -1..1 (steer, + right), fast: bool }. */
  function step(input, dt) {
    gatherCaps();
    let fe = -Math.sin(s.h), fn = Math.cos(s.h);
    let vF = s.ve * fe + s.vn * fn, vL = s.ve * fn - s.vn * fe;
    const target = input.f > 0 ? (input.fast ? BOAT.fast : BOAT.pedal) * input.f : input.f < 0 ? -BOAT.back : 0;
    // momentum: up to speed in about a second under the pedals, a long glide off them
    vF += (target - vF) * (1 - Math.exp(-(input.f ? 1.25 : 0.25) * dt));
    vL *= Math.exp(-2.2 * dt);
    // the rudder: bites with way on (backwards, the other way round); a little at rest
    const auth = 0.35 + 0.65 * Math.min(1, Math.abs(vF) / BOAT.pedal);
    const want = -input.s * BOAT.turn * auth * (vF < -0.1 ? -1 : 1);
    s.yawRate += (want - s.yawRate) * (1 - Math.exp(-1.6 * dt));
    const c0 = clearance(s.e, s.n, s.h);
    let h1 = s.h + s.yawRate * dt;
    fe = -Math.sin(h1); fn = Math.cos(h1);
    s.ve = fe * vF + fn * vL; s.vn = fn * vF - fe * vL;
    // give way to the eight: inside its lane ahead of it, you are pushed aside
    s.yielding = false;
    const eight = world.rowing?.boats?.find((b) => b.kind === 'eight' && b.fe !== undefined);
    if (eight) {
      const rx = s.e - eight.e, ry = s.n - eight.n, along = rx * eight.fe + ry * eight.fn, lat = rx * eight.fn - ry * eight.fe;
      if (along > -eight.len / 2 - 2 && along < 40 && Math.abs(lat) < 7) {
        const side = lat >= 0 ? 1 : -1, k = (1 - Math.abs(lat) / 7) * (along < 0 ? 1 : 1 - along / 40);
        s.ve += side * eight.fn * 2.2 * k * dt; s.vn -= side * eight.fe * 2.2 * k * dt;
        s.yielding = true;
      }
    }
    let ne = s.e + s.ve * dt, nn = s.n + s.vn * dt;
    let c1 = clearance(ne, nn, h1);
    if (c1 < 0 && c1 < c0) {
      // a soft bump: the velocity into the obstacle bounces back at a third, and slows
      const [gx, gy] = away(ne, nn, h1);
      const into = s.ve * gx + s.vn * gy;
      if (into < 0) { s.ve -= 1.35 * into * gx; s.vn -= 1.35 * into * gy; }
      s.ve *= 0.8; s.vn *= 0.8;
      s.bumps++;
      ne = s.e + s.ve * dt; nn = s.n + s.vn * dt;
      c1 = clearance(ne, nn, h1);
      if (c1 < 0 && c1 < c0) {
        ne = s.e; nn = s.n;
        c1 = clearance(ne, nn, h1);
        if (c1 < 0 && c1 < c0) { h1 = s.h; s.yawRate = 0; c1 = c0; } // don't turn into it either
      }
    }
    if (c1 < 0) {
      // something came to us (the eight, a swan): ease out of it
      const [gx, gy] = away(ne, nn, h1), push = Math.min(-c1 + 0.02, 1.5 * dt);
      if (clearance(ne + gx * push, nn + gy * push, h1) > c1) { ne += gx * push; nn += gy * push; }
    }
    s.distance += Math.hypot(ne - s.e, nn - s.n);
    s.e = ne; s.n = nn; s.h = h1;
    s.time += dt;
    s.speed = s.ve * -Math.sin(h1) + s.vn * Math.cos(h1);
    s.wheel += (s.speed * dt) / 0.3; // the paddle wheel's radius
    s.legs += (s.speed * dt) / 0.6;  // the pedals, geared down from the wheel: ~0.8 strokes a second at 3 m/s
    s.clear = c1;
    return s;
  }

  return { state: s, step, clearance, gatherCaps, shoreSD };
}

/* ------------------------------ the boat ------------------------------ */

/** A small paddle wheel (six blades on a hub) behind the stern, turning about local z: one mesh. */
function paddleWheel() {
  const paint = (g, hex) => {
    g = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    g.deleteAttribute('uv');
    return g;
  };
  const parts = [paint(new THREE.CylinderGeometry(0.07, 0.07, 0.72, 8).rotateX(Math.PI / 2), 0x6b5a48)];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(paint(new THREE.BoxGeometry(0.04, 0.26, 0.62).rotateZ(a - Math.PI / 2).translate(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0), 0xf4f0e6));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, cel({ color: 0xffffff, vertexColors: true, flat: false }));
  m.castShadow = true;
  return m;
}

export function createBoat({ scene, world, collider }) {
  const club = world.landmarks?.club;
  const sim = createBoatSim(world, collider?.decks || []);
  const s = sim.state;
  const group = new THREE.Group();
  group.name = 'playerBoat';
  const hullMat = cel({ color: 0xffffff, flat: false, cache: false });
  const hull = new THREE.Mesh(swanParts(0xffffff), hullMat);
  hull.castShadow = true;
  const wheel = paddleWheel();
  wheel.position.set(-1.58, 0.24, 0);
  group.add(hull, wheel);
  group.visible = false;
  setLayers(group, LAYER.NEAR);
  scene.add(group);

  let seat = null, docking = null, splashAt = 0, foamT = 0, t = 0;
  const api = {
    group, sim, state: s,
    /** 'off' | 'on' | 'docking' */
    phase: 'off',
    color: null,
    berth: null,
    splashes: 0,
    get active() { return api.phase !== 'off'; },
    get e() { return s.e; }, get n() { return s.n; }, get heading() { return s.h; },
    get y() { return 0.02 + Math.sin(t * 1.3) * 0.03; },

    /** Take the swan at berth i: the jogger sits in it (`body` fits the seat). */
    board(i, jogger) {
      const b = club.berths[i];
      api.color = b.color;
      api.berth = i;
      hullMat.color.set(b.color);
      club.setBerth(i, null);
      Object.assign(s, { e: b.e, n: b.n, h: b.yaw, ve: 0, vn: 0, yawRate: 0, speed: 0, distance: 0, time: 0, bumps: 0 });
      seat = seatPose(jogger.body, SWAN_SEAT.top, SWAN_SEAT.deck);
      api.phase = 'on';
      group.visible = true;
      api.place(jogger, 0);
    },
    /** The nearest free berth within `r` m of the boat (for "E · dock"), or null. */
    freeBerth(r = BOAT.dock) {
      let best = null, bd = r;
      for (const b of club?.berths || []) {
        if (b.color) continue;
        const d = Math.hypot(b.e - s.e, b.n - s.n);
        if (d < bd) { bd = d; best = b; }
      }
      return best;
    },
    /**
     * Glide into berth b over ~1.4 s, then moor there -- bow out or bow in, whichever is the
     * smaller turn (no spinning round at the jetty); `done()` puts the jogger ashore.
     */
    dock(b, done) {
      const turn = (y) => Math.abs(Math.atan2(Math.sin(y - s.h), Math.cos(y - s.h)));
      const yaw = turn(b.yaw) <= turn(b.yaw + Math.PI) ? b.yaw : b.yaw + Math.PI;
      docking = { b, yaw, t: 0, from: { e: s.e, n: s.n, h: s.h }, done };
      api.phase = 'docking';
    },
    /** Out of the boat at once (a teleport, a test): it moors in the nearest free berth. */
    abort() {
      if (api.phase === 'off') return;
      const b = api.freeBerth(Infinity);
      if (b) club.setBerth(b.i, api.color);
      api.phase = 'off';
      group.visible = false;
      docking = null;
      if (world.rowing) world.rowing.player = null;
    },
    /** Move the jogger to the seat, pedalling with the wheel. */
    place(jogger, steer = 0) {
      const fe = -Math.sin(s.h), fn = Math.cos(s.h), x = SWAN_SEAT.front - 0.21;
      jogger.e = s.e + fe * x; jogger.n = s.n + fn * x;
      jogger.y = api.y + seat.rootY;
      jogger.heading = s.h;
      jogger.sitting = 1;
      const ph = s.legs, effort = 0.6 + 0.4 * Math.min(1, Math.abs(s.speed) / BOAT.fast); // (harder and faster with the speed)
      jogger.override = (pose) => {
        applySeat(pose, seat);
        // pedalling: the legs pump in turn with the wheel; the hands on the tiller
        pose.hipL += 0.2 * effort * Math.sin(ph); pose.hipR += 0.2 * effort * Math.sin(ph + Math.PI);
        pose.kneeL += 0.28 * effort * Math.sin(ph); pose.kneeR += 0.28 * effort * Math.sin(ph + Math.PI);
        pose.shoulderL = 0.8 + 0.15 * steer; pose.shoulderR = 0.8 - 0.15 * steer;
        pose.elbowL = pose.elbowR = 1.05; pose.armOutL = pose.armOutR = -0.06;
      };
    },
    /**
     * One frame while boating.  `keys` are the jogger's keys; returns the stamina change.
     */
    update(dt, keys, jogger) {
      t += dt;
      if (api.phase === 'off') { world.rowing && (world.rowing.player = null); return; }
      if (api.phase === 'docking') {
        const d = docking;
        d.t = Math.min(1, d.t + dt / 1.4);
        const k = d.t * d.t * (3 - 2 * d.t);
        let dh = d.yaw - d.from.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        s.e = d.from.e + (d.b.e - d.from.e) * k; s.n = d.from.n + (d.b.n - d.from.n) * k; s.h = d.from.h + dh * k;
        s.ve = s.vn = s.yawRate = s.speed = 0;
        api.place(jogger);
        if (d.t >= 1) {
          club.setBerth(d.b.i, api.color, d.yaw);
          api.phase = 'off';
          group.visible = false;
          docking = null;
          world.rowing && (world.rowing.player = null);
          d.done?.(d.b);
        }
      } else {
        const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        const st = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
        if (jogger.stamina <= 0.5) jogger.spent = true; else if (jogger.stamina >= 30) jogger.spent = false;
        const fast = shift && f > 0 && !jogger.spent;
        sim.step({ f, s: st, fast }, dt);
        jogger.stamina = THREE.MathUtils.clamp(jogger.stamina + (fast ? -BOAT.drain : BOAT.rest) * dt, 0, 100);
        jogger.sprinting = fast;
        api.place(jogger, st);
        if (world.rowing) world.rowing.player = { e: s.e, n: s.n };
        // the wake from the stern, and a splash each time a blade goes in
        // the wake: foam more often and wider the faster you go
        foamT -= dt;
        const v = Math.abs(s.speed);
        if (v > 0.3 && foamT <= 0) {
          foamT = 0.3 * THREE.MathUtils.clamp(1.5 / v, 0.4, 1);
          const fe = -Math.sin(s.h), fn = Math.cos(s.h);
          world.rowing?.foam(s.e - fe * 1.7 * Math.sign(s.speed), s.n - fn * 1.7 * Math.sign(s.speed), 0.25 + 0.1 * v);
        }
        // a splash on each pedal stroke (twice a turn of the pedals), louder with the speed
        const stroke = Math.floor(s.legs / Math.PI);
        if (stroke !== splashAt) { splashAt = stroke; if (v > 0.15) api.splashes++; }
      }
      // the hull rides the water with a little bob and roll; the wheel turns
      group.position.set(s.e, api.y, -s.n);
      group.rotation.set(0, s.h + Math.PI / 2, 0);
      hull.rotation.x = Math.sin(t * 1.1) * 0.02 + THREE.MathUtils.clamp(s.yawRate * 0.12, -0.05, 0.05);
      wheel.rotation.z = -s.wheel;
    },
    /** The chase camera (camera.js 'bench' view): behind the boat, the jogger and hull in frame. */
    view() {
      // the camera pulls back as the boat speeds up (up to ~2.5 m at full pelt), so it stays well in frame
      return { yaw: s.h, pitch: -0.26, boom: 5.2, extraBoom: 0.55 * Math.abs(s.speed), side: 0.15, lift: 0.3, drift: false, rate: 1.3, idle: 2.0 };
    },
  };
  return api;
}
