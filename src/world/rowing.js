import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel, flat } from '../core/toon.js';
import { mulberry32 } from '../core/util.js';
import { data, shoreDist, inLake, spineAt } from './frame.js';
import { swanParts } from './landmarks.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * Boats on the real lake (plan §4, §6).
 *
 * Lanes are closed loops at a fixed distance in from the real shoreline:
 * the lake's signed distance is sampled on a 10 m grid, the level set at
 * the lane's offset is traced with marching squares, the longest loop is
 * kept (so the lane never enters a narrow arm or rounds an islet), then
 * smoothed and resampled every 5 m.  `laneCheck` (world/checks.js) proves
 * every sample is >= 30 m from any shore.
 *
 *   the eight   90 m in from the shore, 4.6 m/s with a surge on every
 *               stroke, 22 strokes a minute, a cox at the stern (r6: slim
 *               white shell, rowers dark against the glare)
 *   sculls      three singles on 50 / 140 / 210 m lanes, varied speeds,
 *               some the other way round
 *   pedal boats swans (r7) wandering off the real boating jetty
 *   wake        foam discs dropped at the stern, spreading and fading
 *
 * Everything is instanced: about eight draw calls.
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/* -------------------------------- lanes -------------------------------- */

function traceLane(offset) {
  const o = data.lake.outer;
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const [e, n] of o) { e0 = Math.min(e0, e); n0 = Math.min(n0, n); e1 = Math.max(e1, e); n1 = Math.max(n1, n); }
  const step = 10, nx = Math.ceil((e1 - e0) / step) + 3, ny = Math.ceil((n1 - n0) / step) + 3;
  const ox = e0 - step, oy = n0 - step;
  const f = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) f[j * nx + i] = -shoreDist(ox + i * step, oy + j * step, 1e9) - offset;
  // marching squares: segments where f crosses 0, keyed by edge for linking
  const P = (i, j) => [ox + i * step, oy + j * step];
  const lerpE = (a, b, fa, fb) => { const t = fa / (fa - fb); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
  const segs = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v = [f[j * nx + i], f[j * nx + i + 1], f[(j + 1) * nx + i + 1], f[(j + 1) * nx + i]];
    const c = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
    const pts = [];
    const keys = [];
    for (let k = 0; k < 4; k++) {
      const a = k, b = (k + 1) % 4;
      if ((v[a] > 0) !== (v[b] > 0)) {
        pts.push(lerpE(c[a], c[b], v[a], v[b]));
        // a shared edge key, the same from both neighbouring cells
        const ea = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]][a], eb = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]][b];
        keys.push([ea, eb].map(([x, y]) => x + ',' + y).sort().join('|'));
      }
    }
    if (pts.length === 2) segs.push([pts[0], pts[1], keys[0], keys[1]]);
    else if (pts.length === 4) { segs.push([pts[0], pts[1], keys[0], keys[1]]); segs.push([pts[2], pts[3], keys[2], keys[3]]); }
  }
  // link segments into loops through their shared edge keys
  const byKey = new Map();
  segs.forEach((s, i) => { for (const k of [s[2], s[3]]) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); } });
  const used = new Uint8Array(segs.length);
  let best = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const loop = [segs[i][0]];
    let cur = i, key = segs[i][3], pt = segs[i][1];
    used[i] = 1;
    for (let guard = 0; guard < 20000; guard++) {
      loop.push(pt);
      const next = (byKey.get(key) || []).find((q) => !used[q]);
      if (next === undefined) break;
      used[next] = 1;
      const s = segs[next];
      if (s[2] === key) { key = s[3]; pt = s[1]; } else { key = s[2]; pt = s[0]; }
      cur = next;
    }
    if (loop.length > best.length) best = loop;
  }
  // smooth (Chaikin twice) and resample every 5 m
  let pts = best;
  for (let it = 0; it < 3; it++) {
    const out = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  const res = [];
  let acc = 0;
  res.push(pts[0]);
  for (let k = 1; k <= pts.length; k++) {
    const a = pts[k - 1], b = pts[k % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = 5 - acc;
    while (t <= len) { res.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]); t += 5; }
    acc = (acc + len) % 5;
  }
  const S = [0];
  for (let k = 1; k < res.length; k++) S.push(S[k - 1] + Math.hypot(res[k][0] - res[k - 1][0], res[k][1] - res[k - 1][1]));
  const total = S[S.length - 1] + Math.hypot(res[0][0] - res.at(-1)[0], res[0][1] - res.at(-1)[1]);
  return { offset, pts: res, S, length: total };
}

/** Position and tangent on a closed lane at arc length s. */
function laneAt(lane, s) {
  const L = lane.length;
  s = ((s % L) + L) % L;
  let lo = 0, hi = lane.S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lane.S[m] <= s) lo = m; else hi = m; }
  if (s >= lane.S[lane.S.length - 1]) lo = lane.S.length - 1;
  const a = lane.pts[lo], b = lane.pts[(lo + 1) % lane.pts.length];
  const seg = lo === lane.S.length - 1 ? L - lane.S[lo] : lane.S[lo + 1] - lane.S[lo];
  const t = (s - lane.S[lo]) / (seg || 1);
  const te = b[0] - a[0], tn = b[1] - a[1], tl = Math.hypot(te, tn) || 1;
  return { e: a[0] + te * t, n: a[1] + tn * t, te: te / tl, tn: tn / tl };
}

/* ------------------------------- shapes ------------------------------- */

function tint(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
const shell = (len, w) => { const g = new THREE.IcosahedronGeometry(0.5, 2); g.scale(w, 0.32, len); g.translate(0, 0.05, 0); return tint(g, 0xf4f2ec); };
function rowerGeo(cox = false) {
  // a seated rower, facing +z (the stern), dark against the glare (r6); hips at the origin
  const parts = [];
  const torso = new THREE.CapsuleGeometry(0.17, 0.42, 3, 8); torso.translate(0, 0.38, 0); parts.push(tint(torso, 0x2b3040));
  const head = new THREE.IcosahedronGeometry(0.12, 1); head.translate(0, 0.85, 0.02); parts.push(tint(head, 0x5a4033));
  const legs = new THREE.BoxGeometry(0.3, 0.14, 0.7); legs.translate(0, 0.05, 0.35); parts.push(tint(legs, 0x1f2430));
  if (!cox) for (const s of [-1, 1]) { const arm = new THREE.CapsuleGeometry(0.05, 0.45, 2, 5); arm.rotateX(Math.PI / 2 - 0.3); arm.translate(s * 0.16, 0.48, 0.3); parts.push(tint(arm, 0x5a4033)); }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  g.computeVertexNormals();
  return g;
}
function oarGeo() {
  // along +x from the gate: 1 m of handle inboard, 2.9 m out to a blade
  const shaft = new THREE.CylinderGeometry(0.02, 0.025, 3.9, 5); shaft.rotateZ(Math.PI / 2); shaft.translate(0.95, 0, 0);
  const blade = new THREE.BoxGeometry(0.5, 0.03, 0.2); blade.translate(2.7, 0, 0);
  const g = mergeGeometries([tint(shaft, 0xe8e4da), tint(blade, 0xd23b35)], false);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------- stroke ------------------------------- */

/** Stroke phase 0..1: the drive is the first 35%, then the recovery. */
function stroke(ph) {
  if (ph < 0.35) { const t = ph / 0.35; return { sweep: 0.75 - 1.3 * t, lift: -0.12, lean: 0.35 - 0.6 * t, drive: 1 }; }
  const t = (ph - 0.35) / 0.65, e = t * t * (3 - 2 * t);
  return { sweep: -0.55 + 1.3 * e, lift: 0.22 * Math.sin(Math.PI * t), lean: -0.25 + 0.6 * e, drive: 0 };
}

/* -------------------------------- build -------------------------------- */

export function buildRowing(scene, world) {
  const rng = mulberry32(22);
  const group = new THREE.Group();
  group.name = 'rowing';
  const vc = cel({ color: 0xffffff, vertexColors: true, flat: false });

  const lanes = [traceLane(90), traceLane(50), traceLane(140), traceLane(210)];
  const boats = [
    { kind: 'eight', lane: lanes[0], s: 0, speed: 4.6, dir: 1, rate: 22 / 60, seats: 8, len: 17.5, width: 0.58 },
    { kind: 'scull', lane: lanes[1], s: lanes[1].length * 0.3, speed: 3.6, dir: -1, rate: 28 / 60, seats: 1, len: 8.2, width: 0.36 },
    { kind: 'scull', lane: lanes[2], s: lanes[2].length * 0.6, speed: 3.2, dir: 1, rate: 26 / 60, seats: 1, len: 8.2, width: 0.36 },
    { kind: 'scull', lane: lanes[3], s: lanes[3].length * 0.1, speed: 3.8, dir: -1, rate: 30 / 60, seats: 1, len: 8.2, width: 0.36 },
  ];
  boats.forEach((b) => { b.phase = rng(); });

  // hulls, rowers, oars: one instanced mesh each
  const hullEight = new THREE.InstancedMesh(shell(17.5, 0.58), vc, 1);
  const hullScull = new THREE.InstancedMesh(shell(8.2, 0.36), vc, 3);
  const rowerCount = boats.reduce((a, b) => a + b.seats, 0) + 1;
  const rowers = new THREE.InstancedMesh(rowerGeo(), vc, rowerCount);
  const cox = new THREE.InstancedMesh(rowerGeo(true), vc, 1);
  const oarCount = boats.reduce((a, b) => a + (b.kind === 'eight' ? b.seats : b.seats * 2), 0);
  const oars = new THREE.InstancedMesh(oarGeo(), vc, oarCount);
  for (const m of [hullEight, hullScull, rowers, cox, oars]) { m.frustumCulled = false; m.castShadow = true; group.add(m); }

  // wake: foam discs that spread and shrink away
  const WAKE = 160;
  const wakeGeo = new THREE.CircleGeometry(1, 10); wakeGeo.rotateX(-Math.PI / 2);
  const wake = new THREE.InstancedMesh(wakeGeo, flat({ color: 0xf4f6f8, transparent: true, opacity: 0.45, depthWrite: false }), WAKE);
  wake.frustumCulled = false;
  wake.userData.noOutline = true;
  const wakeLife = new Float32Array(WAKE).fill(99), wakePos = new Float32Array(WAKE * 3);
  let wakeNext = 0;
  group.add(wake);

  // pedal boats off the real boating jetty, after 08:30 (plan §6)
  const jetty = world.landmarks?.club?.jetty;
  const swanGeo = swanParts(0xffffff);
  const SWAN_COLS = [0x3f7fd0, 0x62a8e6, 0xf2c230, 0xd23b35, 0xf08a2e, 0x62a8e6];
  const swans = new THREE.InstancedMesh(swanGeo, cel({ color: 0xffffff, flat: false }), SWAN_COLS.length);
  swans.frustumCulled = false;
  swans.castShadow = true;
  const pedal = [];
  if (jetty) {
    const f = spineAt(jetty.s);
    const ce = f.e + f.ne * (jetty.d1 + 70), cn = f.n + f.nn * (jetty.d1 + 70);
    SWAN_COLS.forEach((c, i) => {
      const a = rng() * TAU, r = 15 + rng() * 50;
      pedal.push({ e: ce + Math.cos(a) * r, n: cn + Math.sin(a) * r, yaw: rng() * TAU, te: ce, tn: cn, ce, cn, wait: rng() * 5 });
      swans.setColorAt(i, new THREE.Color(c));
    });
    group.add(swans);
  }

  setLayers(group, LAYER.NEAR);
  scene.add(group);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), E = new THREE.Euler();
  const hullM = new THREE.Matrix4(), local = new THREE.Matrix4();
  let t = 0;

  const api = {
    group, lanes, boats, showPedal: true,
    /** The eight's world position and stroke, for the oar and cox sounds (Phase 7). */
    eight: { e: 0, n: 0, phase: 0, catchCount: 0 },
    update(dt) {
      t += dt;
      let hs = 0, ri = 0, oi = 0;
      for (const b of boats) {
        const before = b.phase;
        b.phase = (b.phase + b.rate * dt) % 1;
        const st = stroke(b.phase);
        // the boat surges on the drive
        const v = b.speed * (1 + 0.12 * (st.drive ? 1 : -0.55));
        b.s += b.dir * v * dt;
        const p = laneAt(b.lane, b.s);
        const fe = p.te * b.dir, fn = p.tn * b.dir;
        const yaw = Math.atan2(-fe, fn);
        b.e = p.e; b.n = p.n;
        hullM.compose(V.set(p.e, 0.02, -p.n), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), S1);
        if (b.kind === 'eight') {
          hullEight.setMatrixAt(0, hullM);
          Object.assign(api.eight, { e: p.e, n: p.n, phase: b.phase });
          if (before > b.phase) api.eight.catchCount++;
        } else hullScull.setMatrixAt(hs++, hullM);
        // rowers face the stern (+z local); seats from bow (-z) to stern
        for (let k = 0; k < b.seats; k++) {
          const z = b.kind === 'eight' ? -6.8 + k * 1.45 : 0.3;
          local.compose(V.set(0, 0.12, z), Q.setFromEuler(E.set(st.lean, 0, 0)), S1);
          rowers.setMatrixAt(ri++, M.multiplyMatrices(hullM, local));
          const sides = b.kind === 'eight' ? [k % 2 ? 1 : -1] : [-1, 1];
          for (const side of sides) {
            // the oar pivots at the rigger; sweep toward the bow at the catch, lift on the recovery
            local.compose(V.set(side * (b.kind === 'eight' ? 0.78 : 0.72), 0.28, z + 0.15), Q.setFromEuler(E.set(0, side > 0 ? side * st.sweep : Math.PI + side * st.sweep, side * st.lift, 'YXZ')), S1);
            oars.setMatrixAt(oi++, M.multiplyMatrices(hullM, local));
          }
        }
        if (b.kind === 'eight') {
          local.compose(V.set(0, 0.12, 7.4), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), S1);
          cox.setMatrixAt(0, M.multiplyMatrices(hullM, local));
        }
        // foam at the stern on each drive
        if (st.drive && Math.random() < dt * 8) {
          const k = wakeNext++ % WAKE;
          wakeLife[k] = 0;
          const off = b.len * 0.5;
          wakePos[k * 3] = p.e - fe * off; wakePos[k * 3 + 1] = p.n - fn * off;
        }
      }
      for (let k = 0; k < WAKE; k++) {
        wakeLife[k] += dt;
        const life = wakeLife[k], sc = life < 7 ? (0.6 + life * 0.9) * (1 - life / 7) : 0;
        M.compose(V.set(wakePos[k * 3], 0.05, -wakePos[k * 3 + 1]), Q.identity(), new THREE.Vector3(sc, 1, sc * 0.6));
        wake.setMatrixAt(k, M);
      }
      // pedal boats: drift to a new spot, rest, drift again; never within 20 m of a shore
      pedal.forEach((w, i) => {
        w.wait -= dt;
        if (w.wait <= 0) {
          const a = Math.random() * TAU, r = 10 + Math.random() * 80;
          const te = w.ce + Math.cos(a) * r, tn = w.cn + Math.sin(a) * r;
          if (inLake(te, tn) && shoreDist(te, tn, 60) < -20) { w.te = te; w.tn = tn; }
          w.wait = 12 + Math.random() * 14;
        }
        const de = w.te - w.e, dn = w.tn - w.n, dd = Math.hypot(de, dn);
        if (dd > 1) {
          let want = Math.atan2(-de, dn) - w.yaw;
          want = Math.atan2(Math.sin(want), Math.cos(want));
          w.yaw += THREE.MathUtils.clamp(want, -0.5 * dt, 0.5 * dt);
          const sp = 0.8 * Math.max(0, Math.cos(want));
          const ne = w.e - Math.sin(w.yaw) * sp * dt, nn = w.n + Math.cos(w.yaw) * sp * dt;
          if (shoreDist(ne, nn, 60) < -18) { w.e = ne; w.n = nn; }
        }
        M.compose(V.set(w.e, 0.02 + Math.sin(t * 1.3 + i) * 0.03, -w.n), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.yaw + Math.PI / 2), S1);
        swans.setMatrixAt(i, M);
      });
      swans.count = api.showPedal ? pedal.length : 0;
      for (const m of [hullEight, hullScull, rowers, cox, oars, wake, swans]) m.instanceMatrix.needsUpdate = true;
    },
    /** Every lane sample, for laneCheck. */
    laneSamples() { return lanes.map((l) => ({ offset: l.offset, pts: l.pts })); },
  };
  return api;
}
