import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { mulberry32 } from '../core/util.js';
import { makeBody, poseBody, partGeometries, headwearGeometry, partColours, PARTS, P, restPose } from './body.js';
import { createGait } from './gait.js';
import { TYPES, MOVERS, personRow } from './types.js';
import { L, spineAt, nearestS } from '../world/frame.js';
import { groundAt } from '../world/terrain.js';
import { walkY, DAM, BENCHES } from '../world/dam.js';
import { LAYER, setLayers } from '../world/chunks.js';

/* ------------------------------------------------------------------ *
 * The crowd (plan §6).
 *
 * Movers walk and run the walk in lanes, in (s, d): s along the walk, d
 * across it (+ toward the lake, never past the parapet).  They keep a
 * speed from their type, change lanes to overtake anyone slower ahead
 * (some overtake the player), step round the player, and at the ends
 * either turn round or leave -- and come back in at the plaza, a stair
 * or the garden end, so nobody piles up.  Pairs (students, old couples)
 * move as one.  Stationary groups keep their anchor: stretchers at the
 * parapet, the yoga group on the grass, the laughter club in a circle,
 * people on benches, a photographer at a viewpoint, the chai vendor.
 *
 * Drawing: one InstancedMesh per body part (and per headwear shape), with
 * a colour per instance -- about 25 draw calls for the whole crowd.
 * People further than 250 m are simulated but not drawn; poses are
 * recomputed every frame within 45 m, less often further out.
 * ------------------------------------------------------------------ */

const DRAW_R = 250;
const LANES = [-3.1, -1.6, -0.1, 1.4, 2.9];
const HW_KINDS = ['patka', 'turban', 'cap', 'monkey'];
const _root = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _m = new THREE.Matrix4(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** The yaw (three) that faces along an (e, n) direction. */
const yawOf = (de, dn) => Math.atan2(-de, dn);
/** +1 if a heading points toward increasing s along the walk at s, else -1. */
function alongDir(s, heading) {
  const f = spineAt(s);
  return -Math.sin(heading) * f.te + Math.cos(heading) * f.tn >= 0 ? 1 : -1;
}

export function buildCrowd(scene, world, { max = 200, seed = 2027 } = {}) {
  const rng = mulberry32(seed);
  const people = [];

  /* ------------------------------ pools ------------------------------ */
  const geos = partGeometries();
  const mat = cel({ color: 0xffffff, bands: 3, flat: false });
  const group = new THREE.Group();
  group.name = 'crowd';
  const mkPool = (geo, name, cap) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false; // compacted around the camera every frame
    m.castShadow = true;
    m.receiveShadow = true;
    m.name = name;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    setLayers(m, LAYER.NEAR);
    group.add(m);
    return m;
  };

  /* ------------------------------ people ------------------------------ */
  const add = (type, extra = {}) => {
    const row = personRow(type, rng);
    const body = makeBody(row);
    const p = {
      id: people.length, type, T: TYPES[type], body, cols: partColours(body), gait: createGait(TYPES[type].gait || {}),
      e: 0, n: 0, y: 0, yaw: 0, s: 0, d: 0, dTarget: 0, dir: 1, speed: 0, base: 0, visible: false, active: true,
      pose: new Float32Array(PARTS.length * 16), poseAge: 99, phase: rng() * 100, lastDraw: -1, bubble: null,
      ...extra,
    };
    people.push(p);
    return p;
  };

  // movers, weighted by type
  const weights = MOVERS.map((t) => TYPES[t].weight || 1), wsum = weights.reduce((a, b) => a + b, 0);
  const pickType = () => { let r = rng() * wsum; for (let i = 0; i < MOVERS.length; i++) { r -= weights[i]; if (r <= 0) return MOVERS[i]; } return MOVERS[0]; };
  const nStationary = 36;
  let movers = 0;
  while (people.length < max - nStationary) {
    const type = pickType(), T = TYPES[type];
    const s = rng() * L, dir = rng() < 0.5 ? 1 : -1, lane = LANES[Math.floor(rng() * LANES.length)];
    const speed = T.speed[0] + (T.speed[1] - T.speed[0]) * rng();
    const lead = add(type, { mode: 'walk', s, dir, d: lane, dTarget: lane, base: speed, speed });
    movers++;
    if ((T.group || 1) > 1) {
      const side = lane > 2 ? -1 : 1;
      add(type, { mode: 'walk', s, dir, d: lane + 0.75 * side, dTarget: lane + 0.75 * side, base: speed, speed, leader: lead.id, offset: 0.75 * side });
    }
  }
  const moverCount = people.length;

  // --- stationary groups ---
  const at = (s, d) => { const f = spineAt(s); return [f.e + f.ne * d, f.n + f.nn * d, f]; };
  const facingLake = (f) => yawOf(f.ne, f.nn);
  // stretchers at the parapet, facing the water
  for (const s of [330, 780, 1160, 1700, 2230]) {
    const [e, n, f] = at(s, DAM.parIn - 0.5);
    add('stretcher', { mode: 'stand', act: 'stretch', e, n, y: walkY(s), yaw: facingLake(f) });
  }
  // the yoga group on the grass beyond the dam's toe (8 on mats facing a teacher)
  const yogaS = 560, yf = spineAt(yogaS);
  const yogaBase = at(yogaS, -(DAM.verge + 26));
  const mats = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    const u = (c - 1.5) * 2.2, v = r * 2.6;
    const e = yogaBase[0] + yf.te * u - yf.ne * v, n = yogaBase[1] + yf.tn * u - yf.nn * v;
    const y = groundAt(e, n);
    add('yoga', { mode: 'stand', act: 'yoga', e, n, y, yaw: facingLake(yf) });
    mats.push([e, n, y]);
  }
  { const e = yogaBase[0] + yf.ne * 3.2, n = yogaBase[1] + yf.nn * 3.2; add('yoga', { mode: 'stand', act: 'yoga', teacher: true, e, n, y: groundAt(e, n), yaw: facingLake(yf) + Math.PI }); mats.push([e, n, groundAt(e, n)]); }
  // the laughter club: a circle of ten on the grass near Stair n°1
  const lcS = 1950, lcBase = at(lcS, -(DAM.verge + 24));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const e = lcBase[0] + Math.cos(a) * 3.4, n = lcBase[1] + Math.sin(a) * 3.4;
    add('laugh', { mode: 'stand', act: 'laugh', e, n, y: groundAt(e, n), yaw: yawOf(lcBase[0] - e, lcBase[1] - n) });
  }
  // people on benches
  const benchPick = BENCHES.filter((_, i) => i % 4 === 1).slice(0, 10);
  for (const b of benchPick) {
    const [e, n, f] = at(b.s, b.d - 0.08);
    add('sitter', { mode: 'sit', act: 'sit', e, n, y: walkY(b.s), yaw: facingLake(f), bench: b });
  }
  // a photographer at the parapet by the bend's viewpoint, and the chai vendor
  const photoS = 2050;
  { const [e, n, f] = at(photoS, DAM.parIn - 1.4); add('photographer', { mode: 'stand', act: 'photo', e, n, y: walkY(photoS), yaw: facingLake(f) }); }
  const kiosk = world.landmarks?.plaza?.kiosk;
  if (kiosk) {
    const ns = nearestS(kiosk[0], kiosk[1]), f = spineAt(ns.s);
    add('vendor', { mode: 'stand', act: 'vend', e: kiosk[0], n: kiosk[1], y: groundAt(kiosk[0], kiosk[1]), yaw: facingLake(f) });
  }

  const cap = people.length;
  const pools = PARTS.map((name, k) => (name === 'headwear' ? null : mkPool(geos[k], `crowd.${name}`, cap)));
  const hwPools = Object.fromEntries(HW_KINDS.map((k) => [k, mkPool(headwearGeometry(k), `crowd.hw.${k}`, cap)]));

  /* --------------------------- props: mats, tripod, dogs --------------------------- */
  const props = new THREE.Group();
  const matMat = cel({ color: 0xffffff, vertexColors: false });
  const MAT_COLS = [0x3f7fd0, 0xd84a6a, 0x2fa37a, 0x8f6fb5, 0xf2c230];
  mats.forEach(([e, n, y], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 1.9), cel({ color: MAT_COLS[i % MAT_COLS.length] }));
    m.position.set(e, y + 0.02, -n);
    m.rotation.y = facingLake(yf);
    m.receiveShadow = true;
    props.add(m);
  });
  const photo = people.find((p) => p.act === 'photo');
  if (photo) {
    const f = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.5, 4), cel({ color: 0x2b2b2b }));
      leg.position.set(Math.cos(a) * 0.25, 0.72, Math.sin(a) * 0.25 - 0.9);
      leg.rotation.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18);
      f.add(leg);
    }
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), cel({ color: 0x1f1f22 }));
    camBody.position.set(0, 1.5, -0.9);
    f.add(camBody);
    f.position.set(photo.e, photo.y, -photo.n);
    f.rotation.y = photo.yaw;
    props.add(f);
  }
  // dogs for the dog walkers: a small parametric dog (body, head, snout, ears, four legs, tail)
  const dogMat = (c) => cel({ color: c });
  const makeDog = (color) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), dogMat(color)); body.scale.set(0.34, 0.3, 0.75); body.position.y = 0.42;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), dogMat(color)); head.scale.set(0.26, 0.26, 0.3); head.position.set(0, 0.62, -0.42);
    // the muzzle: a short tapered snout in the coat colour, pointing forward, with a small dark nose at the tip
    const muzzleGeo = new THREE.CylinderGeometry(0.045, 0.075, 0.16, 7);
    muzzleGeo.rotateX(-Math.PI / 2);
    const snout = new THREE.Mesh(muzzleGeo, dogMat(color)); snout.position.set(0, 0.585, -0.6);
    const nose = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), dogMat(0x1e1a1a)); nose.position.set(0, 0.6, -0.685);
    const ears = [-1, 1].map((sx) => { const e = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.1, 4), dogMat(color)); e.position.set(sx * 0.075, 0.72, -0.4); e.rotation.z = -sx * 0.35; return e; });
    // the tail grows from the rump and curves up and back
    const tailGeo = new THREE.CylinderGeometry(0.018, 0.035, 0.3, 5);
    tailGeo.translate(0, 0.15, 0);
    const tail = new THREE.Mesh(tailGeo, dogMat(color)); tail.position.set(0, 0.52, 0.33); tail.rotation.x = 0.75;
    g.add(body, head, snout, nose, ...ears, tail);
    g.legs = [];
    for (const [x, z] of [[-0.1, -0.24], [0.1, -0.24], [-0.1, 0.24], [0.1, 0.24]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.34, 5), dogMat(color));
      leg.geometry.translate(0, -0.17, 0);
      leg.position.set(x, 0.34, z);
      g.add(leg); g.legs.push(leg);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  };
  const DOGS = [0xc9a06a, 0xe8e2d6, 0x3a302a, 0x8a5a3a];
  people.filter((p) => p.T.dog).forEach((p, i) => { p.dog = makeDog(DOGS[i % DOGS.length]); p.dogIdx = i; props.add(p.dog); });
  // the leads: one line segment per dog, from the walker's hand to the dog's collar
  const leadPos = new Float32Array(people.filter((p) => p.dog).length * 6);
  const leads = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(leadPos, 3)), new THREE.LineBasicMaterial({ color: 0x2a2a30 }));
  leads.frustumCulled = false;
  leads.userData.noOutline = true;
  props.add(leads);
  setLayers(props, LAYER.NEAR);
  group.add(props);
  scene.add(group);

  /* ------------------------------ behaviour ------------------------------ */
  const entries = () => {
    const list = [{ s: L - 20, d: -3 }, { s: 15, d: -3 }];
    for (const st of world.dam?.cityStairs || []) list.push({ s: st.s, d: -DAM.half + 0.3 });
    return list;
  };
  let density = 1;
  let clock = 0;
  const player = { e: 0, n: 0, s: 0, d: 0, speed: 0 };

  function simMovers(dt) {
    // index movers by s for the look-ahead
    const walkers = people.filter((p) => p.mode === 'walk' && p.active && p.leader === undefined);
    walkers.sort((a, b) => a.s - b.s);
    for (let i = 0; i < walkers.length; i++) {
      const p = walkers[i];
      // someone slower ahead in my lane: overtake if the next lane is clear, else ease off
      let block = null;
      for (let k = 1; k <= 6; k++) {
        const q = walkers[i + p.dir * k];
        if (!q || Math.abs(q.s - p.s) > 7) break;
        if (q.dir === p.dir && Math.abs(q.d - p.d) < 0.9 && q.speed < p.speed - 0.1) { block = q; break; }
      }
      // the player counts too
      const ahead = (player.s - p.s) * p.dir;
      if (ahead > 0 && ahead < 5 && Math.abs(player.d - p.d) < 1.1 && (player.speed < p.speed - 0.2 || Math.sign(player.dir || 0) !== p.dir)) block = block || player;
      let target = p.base;
      if (block) {
        const options = LANES.filter((l) => Math.abs(l - p.d) < 1.8 && Math.abs(l - block.d) > 1.2);
        const free = options.find((l) => !walkers.some((q) => q !== p && Math.abs(q.s - p.s) < 4 && Math.abs(q.d - l) < 0.9));
        if (free !== undefined) p.dTarget = free; else target = Math.min(target, (block.speed ?? 0) * 0.95);
      } else if (rng() < dt * 0.02) {
        p.dTarget = LANES[Math.floor(rng() * LANES.length)];
      }
      p.speed += (target - p.speed) * (1 - Math.exp(-2 * dt));
      p.s += p.dir * p.speed * dt;
      p.d += THREE.MathUtils.clamp(p.dTarget - p.d, -0.9 * dt, 0.9 * dt);
      // ends: turn round, or leave and come back in somewhere else
      if (p.s < 4 || p.s > L - 4) {
        if (rng() < 0.55) { p.dir = p.s < 4 ? 1 : -1; p.s = THREE.MathUtils.clamp(p.s, 4, L - 4); }
        else { const en = entries()[Math.floor(rng() * entries().length)]; p.s = en.s; p.d = p.dTarget = en.d; p.dir = rng() < 0.5 ? 1 : -1; }
      }
    }
    // followers keep station beside their leader
    for (const p of people) {
      if (p.leader === undefined) continue;
      const l = people[p.leader];
      p.s = l.s; p.dir = l.dir; p.speed = l.speed; p.d = THREE.MathUtils.clamp(l.d + p.offset, -3.3, 3.3); p.active = l.active;
    }
    for (const p of people) {
      if (p.mode !== 'walk') continue;
      const f = spineAt(p.s);
      p.e = f.e + f.ne * p.d; p.n = f.n + f.nn * p.d; p.y = walkY(p.s);
      p.yaw = yawOf(f.te * p.dir, f.tn * p.dir);
      if (p.dog) {
        const df = spineAt(p.s + p.dir * 1.5), dd = p.d + 0.45;
        p.dog.position.set(df.e + df.ne * dd, walkY(p.s), -(df.n + df.nn * dd));
        p.dog.rotation.y = p.yaw;
        const ph = clock * 9;
        p.dog.legs.forEach((leg, k) => { leg.rotation.x = Math.sin(ph + (k % 2 ? Math.PI : 0) + (k > 1 ? Math.PI / 2 : 0)) * 0.5; });
        // the lead: from about the walker's right hand to the collar
        const o = p.dogIdx * 6, hf = spineAt(p.s + p.dir * 0.35), hd = p.d + 0.25; // the dog walks on the lake side
        leadPos[o] = hf.e + hf.ne * hd; leadPos[o + 1] = p.y + p.body.height * 0.52; leadPos[o + 2] = -(hf.n + hf.nn * hd);
        leadPos[o + 3] = p.dog.position.x; leadPos[o + 4] = p.dog.position.y + 0.58; leadPos[o + 5] = p.dog.position.z;
        p.dog.visible = p.active;
        if (!p.active) for (let k = 0; k < 6; k++) leadPos[o + k] = 0;
      }
    }
  }

  function leadsDirty() { leads.geometry.attributes.position.needsUpdate = true; }

  /** Stationary poses: stretching, yoga, laughing, sitting, photographing, stirring chai. */
  function actPose(p, t) {
    const pose = p.gait.pose;
    Object.assign(pose, restPose());
    const w = (x) => Math.sin(t * x + p.phase);
    switch (p.act) {
      case 'stretch': {
        // a routine, not a statue: hamstring reach, quad pull, arms overhead, a shake-out, ~8 s each
        const k = Math.floor((t + p.phase * 5) / 8) % 4;
        if (k === 0) { pose.lean = 0.5 + 0.1 * w(0.8); pose.shoulderL = pose.shoulderR = 1.35; pose.elbowL = pose.elbowR = 0.15; pose.hipL = -0.35; pose.hipR = 0.25; pose.kneeR = 0.3; }
        else if (k === 1) { pose.kneeL = 2.3; pose.hipL = -0.15; pose.shoulderL = -0.6; pose.elbowL = 1.6; pose.armOutR = 0.5; }
        else if (k === 2) { pose.shoulderL = pose.shoulderR = -2.9; pose.lean = -0.08 + 0.05 * w(0.6); pose.bounce = 0.01 * w(1.5); }
        else { pose.shoulderL = 0.3 * w(6); pose.shoulderR = -0.3 * w(6); pose.bounce = 0.02 * Math.abs(w(6)); }
        break;
      }
      case 'yoga': {
        const k = Math.floor((t + p.phase * 3) / 9) % 3;
        if (k === 0) { pose.shoulderL = pose.shoulderR = -2.9; pose.bounce = 0.02 * w(1.2); }
        else if (k === 1) { pose.lean = 1.1; pose.shoulderL = pose.shoulderR = 1.4; }
        else { pose.shoulderL = pose.shoulderR = -2.9; pose.hipR = 0.9; pose.kneeR = 1.8; pose.armOutL = pose.armOutR = 0.2; }
        break;
      }
      case 'laugh': {
        const burst = ((t + p.phase * 0.2) % 14) < 3.2; // the whole circle laughs together, every 14 s
        if (burst) { pose.shoulderL = pose.shoulderR = -2.6 + 0.3 * w(9); pose.lean = -0.15; pose.bounce = 0.03 * Math.abs(w(12)); }
        else { pose.shoulderL = pose.shoulderR = 0.9; pose.elbowL = pose.elbowR = 1.3 + 0.35 * Math.max(0, w(8)); pose.armOutL = pose.armOutR = -0.1; }
        p.laughing = burst;
        break;
      }
      case 'sit': pose.sit = 1; pose.shoulderL = pose.shoulderR = 0.3; pose.elbowL = pose.elbowR = 0.7; pose.headPitch = 0.1 * w(0.2); break;
      case 'photo': pose.shoulderL = pose.shoulderR = 1.25; pose.elbowL = pose.elbowR = 1.7; pose.lean = 0.12; break;
      case 'vend': pose.shoulderR = 0.7 + 0.35 * w(4); pose.elbowR = 1.2; pose.shoulderL = 0.5; pose.elbowL = 1.2; break;
      default: break;
    }
    return pose;
  }

  /* ------------------------------ drawing ------------------------------ */
  let frame = 0;
  function draw(camPos) {
    frame++;
    let v = 0;
    const hwCount = Object.fromEntries(HW_KINDS.map((k) => [k, 0]));
    for (const p of people) {
      p.visible = false;
      if (!p.active) continue;
      const dx = p.e - camPos.x, dz = -p.n - camPos.z, d2 = dx * dx + dz * dz;
      if (d2 > DRAW_R * DRAW_R) continue;
      p.visible = true;
      const dist = Math.sqrt(d2);
      const every = dist < 45 ? 1 : dist < 120 ? 3 : 6;
      if (p.poseAge >= every) {
        const pose = p.mode === 'walk' ? p.gait.pose : actPose(p, clock);
        const out = poseScratch;
        poseBody(p.body, pose, out);
        for (let k = 0; k < PARTS.length; k++) out[k].toArray(p.pose, k * 16);
        p.poseAge = 0;
      }
      p.poseAge++;
      _root.compose(_v.set(p.e, p.y, -p.n), _q.setFromAxisAngle(UP, p.yaw), _s.set(1, 1, 1));
      for (let k = 0; k < PARTS.length; k++) {
        if (k === P.headwear) {
          const kind = p.body.headwear;
          if (!hwPools[kind]) continue;
          _m.fromArray(p.pose, k * 16).premultiply(_root);
          hwPools[kind].setMatrixAt(hwCount[kind], _m);
          hwPools[kind].setColorAt(hwCount[kind]++, _c.set(p.cols[k]));
          continue;
        }
        _m.fromArray(p.pose, k * 16).premultiply(_root);
        pools[k].setMatrixAt(v, _m);
        pools[k].setColorAt(v, _c.set(p.cols[k]));
      }
      v++;
    }
    for (const m of pools) if (m) { m.count = v; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const k of HW_KINDS) { const m = hwPools[k]; m.count = hwCount[k]; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    return v;
  }
  const poseScratch = PARTS.map(() => new THREE.Matrix4());

  /* ------------------------------ API ------------------------------ */
  const api = {
    group, people, moverCount, shown: 0,
    /** Scale how many movers are out (time of day, weather): 0..1. */
    setDensity(f) {
      density = THREE.MathUtils.clamp(f, 0, 1);
      const want = Math.round(moverCount * density);
      let i = 0;
      for (const p of people) { if (p.mode !== 'walk' || p.leader !== undefined) continue; p.active = i++ < want; }
    },
    /** Winter fog: shawls and monkey caps for everyone (plan §6). */
    setBundled(on) {
      for (const p of people) {
        if (on && !p._orig) {
          p._orig = { ...p.body };
          p.body.long = true; p.body.sleeves = 'long'; p.body.top = [0x8a7a6a, 0x6b5a4a, 0xa89a88, 0x5a6a7a][p.id % 4];
          if (p.body.headwear === 'none' || p.body.headwear === 'cap') p.body.headwear = 'monkey';
        } else if (!on && p._orig) { Object.assign(p.body, p._orig); p._orig = null; }
        p.cols = partColours(p.body);
        p.poseAge = 99;
      }
    },
    update(dt, camPos, jogger) {
      clock += dt;
      if (jogger) {
        const w = jogger.where();
        Object.assign(player, { e: jogger.e, n: jogger.n, s: w.s, d: w.side * w.d, speed: jogger.speed, dir: alongDir(w.s, jogger.heading) });
      }
      simMovers(dt);
      leadsDirty();
      for (const p of people) {
        if (p.mode !== 'walk' || !p.active) continue;
        p.gait.update(dt, p.speed);
        // a high five from the player: the right hand goes up
        // a dog walker holds the lead out on the dog's side (the lake side: right going +s, left going -s)
        if (p.dog) { const sd = p.dir > 0 ? 'R' : 'L'; p.gait.pose['shoulder' + sd] = 0.5; p.gait.pose['elbow' + sd] = 0.55; p.gait.pose['armOut' + sd] = 0.12; }
        if (p.hf > 0) { p.hf -= dt; p.gait.pose.shoulderR = -2.7; p.gait.pose.elbowR = 0.2; p.poseAge = 99; }
      }
      api.shown = draw(camPos);
    },
    /** A lateral nudge for the auto-jogging player (m, + toward the lake). */
    avoid(e, n, heading) {
      const w = nearestS(e, n), dNow = w.side * w.d;
      const dir = alongDir(w.s, heading);
      let push = 0;
      for (const p of people) {
        if (!p.active || p.mode !== 'walk') continue;
        const ahead = (p.s - w.s) * dir;
        if (ahead < 0.5 || ahead > 9) continue;
        const dd = p.d - dNow;
        if (Math.abs(dd) < 1.2) push += (dd >= 0 ? -1 : 1) * (1.4 - Math.abs(dd)) * (1 - ahead / 10);
      }
      return THREE.MathUtils.clamp(push * 1.6, -2.4, 2.4);
    },
    /** People within r metres of (e, n), nearest first. */
    near(e, n, r = 3) {
      return people.filter((p) => p.active && Math.hypot(p.e - e, p.n - n) < r).sort((a, b) => Math.hypot(a.e - e, a.n - n) - Math.hypot(b.e - e, b.n - n));
    },
    /** Every position anyone stands at or walks through, for npcWaterCheck. */
    positions() { return people.filter((p) => p.active).map((p) => [p.e, p.n]); },
    simulate(dt) { clock += dt; simMovers(dt); },
  };
  api.setDensity(1);
  // stationary people keep their places; movers get positions now
  simMovers(0);
  return api;
}
