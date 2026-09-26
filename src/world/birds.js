import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { mulberry32 } from '../core/util.js';
import { L, spineAt, inLake, shoreDist } from './frame.js';
import { walkY, shoreOffset, DAM } from './dam.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * Birds (plan §6): three instanced meshes -- bodies, left wings, right
 * wings -- however many birds.
 *
 *   perch    crows and pigeons on the parapet; they scatter and resettle
 *            further along when you come within a few metres
 *   wade     egrets and cormorants at the dam's waterline
 *   swim     ducks paddling off the embankment
 *   flock    three mixed flocks resting on the water; as you jog past
 *            they lift off, wheel round over the lake and settle again
 *   cross    a flock of parakeets that crosses overhead now and then
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const SPECIES = {
  egret: { body: 0xf6f4ee, wing: 0xf1efe8, scale: [1.0, 1.35, 1.25], flap: 2.4 },
  cormorant: { body: 0x23262b, wing: 0x2c3036, scale: [0.9, 1.0, 1.2], flap: 3.2 },
  duck: { body: 0x7a5e44, wing: 0x6a5a48, scale: [0.8, 0.7, 0.85], flap: 4.5 },
  crow: { body: 0x2b2b30, wing: 0x303036, scale: [0.6, 0.62, 0.7], flap: 4.0 },
  pigeon: { body: 0x8a8f9a, wing: 0x9aa0aa, scale: [0.5, 0.5, 0.55], flap: 5.0 },
  parakeet: { body: 0x4fae4a, wing: 0x3f9a3a, scale: [0.42, 0.42, 0.62], flap: 6.0 },
};

function bodyGeo() {
  const parts = [];
  const body = new THREE.IcosahedronGeometry(0.5, 1); body.scale(0.32, 0.3, 0.6); body.translate(0, 0.3, 0);
  const neck = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 5); neck.rotateX(0.5); neck.translate(0, 0.5, -0.2);
  const head = new THREE.IcosahedronGeometry(0.09, 1); head.translate(0, 0.66, -0.28);
  const beak = new THREE.ConeGeometry(0.03, 0.14, 4); beak.rotateX(-Math.PI / 2); beak.translate(0, 0.65, -0.42);
  const tail = new THREE.BoxGeometry(0.14, 0.03, 0.2); tail.translate(0, 0.3, 0.36);
  const legs = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 3); legs.translate(0, 0.09, 0.02);
  for (const g of [body, neck, head, beak, tail, legs]) { parts.push(g.index ? g.toNonIndexed() : g); if (g.attributes.uv) g.deleteAttribute('uv'); }
  const g = mergeGeometries(parts.map((p) => { if (p.attributes.uv) p.deleteAttribute('uv'); return p; }), false);
  g.computeVertexNormals();
  return g;
}
function wingGeo(side) {
  // a swept triangle from the shoulder outward (+x for the right wing)
  const g = new THREE.BufferGeometry();
  const s = side;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.1, s * 0.55, 0, 0.08, 0, 0, 0.16, s * 0.55, 0, 0.08, s * 0.3, 0, 0.2, 0, 0, 0.16], 3));
  g.computeVertexNormals();
  return g;
}

export function buildBirds(scene, { count = 175 } = {}) {
  const rng = mulberry32(99);
  const birds = [];
  const add = (sp, props) => birds.push({ sp, S: SPECIES[sp], e: 0, n: 0, y: 0, yaw: rng() * TAU, flap: rng() * TAU, state: 'rest', ...props });
  const share = (f) => Math.round(count * f);

  // perched on the parapet
  for (let i = 0; i < share(0.17); i++) {
    const s = 20 + rng() * (L - 40), f = spineAt(s);
    add(rng() < 0.6 ? 'crow' : 'pigeon', { mode: 'perch', s, home: s, e: f.e + f.ne * 4.6, n: f.n + f.nn * 4.6, y: walkY(s) + DAM.parH, yaw: Math.atan2(-f.te, f.tn) + (rng() - 0.5) });
  }
  // waders at the waterline
  for (let i = 0; i < share(0.14); i++) {
    const s = 30 + rng() * (L - 60), dS = shoreOffset(s);
    if (!Number.isFinite(dS)) continue;
    const f = spineAt(s), d = dS + 0.6 + rng() * 1.5;
    add(rng() < 0.6 ? 'egret' : 'cormorant', { mode: 'wade', e: f.e + f.ne * d, n: f.n + f.nn * d, y: -0.15, yaw: Math.atan2(-f.ne, f.nn) + (rng() - 0.5) * 2 });
  }
  // ducks paddling 15-60 m off the embankment
  for (let i = 0; i < share(0.23); i++) {
    const s = 60 + rng() * (L - 120), dS = shoreOffset(s);
    if (!Number.isFinite(dS)) continue;
    const f = spineAt(s), d = dS + 15 + rng() * 45;
    if (!inLake(f.e + f.ne * d, f.n + f.nn * d)) continue;
    add('duck', { mode: 'swim', e: f.e + f.ne * d, n: f.n + f.nn * d, y: -0.12, vx: 0, vn: 0 });
  }
  // three flocks resting on the water
  const flocks = [];
  for (const s of [620, 1380, 2000]) {
    const dS = shoreOffset(s) || 20, f = spineAt(s), d = dS + 28; // inside the rowing lanes (≥ 50 m out)
    const ce = f.e + f.ne * d, cn = f.n + f.nn * d;
    const fl = { ce, cn, s, state: 'rest', t: 0, members: [] };
    for (let i = 0; i < Math.round(count * 0.12); i++) {
      const a = rng() * TAU, r = 3 + rng() * 14;
      const sp = rng() < 0.65 ? 'duck' : 'cormorant'; // swimmers only: egrets wade at the edge
      add(sp, { mode: 'flock', flock: fl, re: ce + Math.cos(a) * r, rn: cn + Math.sin(a) * r, e: ce + Math.cos(a) * r, n: cn + Math.sin(a) * r, y: -0.12, orbitA: rng() * TAU, orbitR: 30 + rng() * 40, alt: 12 + rng() * 18 });
      fl.members.push(birds.length - 1);
    }
    flocks.push(fl);
  }
  // parakeets
  const pk = { active: false, t: 20, e0: 0, n0: 0, de: 0, dn: 0, members: [] };
  for (let i = 0; i < share(0.1); i++) { add('parakeet', { mode: 'cross', off: [(rng() - 0.5) * 18, (rng() - 0.5) * 6, (rng() - 0.5) * 10] }); pk.members.push(birds.length - 1); }

  const n = birds.length;
  const mat = cel({ color: 0xffffff, flat: false });
  const mk = (g, name) => {
    const m = new THREE.InstancedMesh(g, cel({ color: 0xffffff, flat: false, side: name === 'body' ? THREE.FrontSide : THREE.DoubleSide }), n);
    m.frustumCulled = false; m.castShadow = true; m.name = `birds.${name}`;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    return m;
  };
  const bodies = mk(bodyGeo(), 'body'), wingL = mk(wingGeo(-1), 'wingL'), wingR = mk(wingGeo(1), 'wingR');
  const col = new THREE.Color();
  birds.forEach((b, i) => { bodies.setColorAt(i, col.set(b.S.body)); wingL.setColorAt(i, col.set(b.S.wing)); wingR.setColorAt(i, col.set(b.S.wing)); });
  const group = new THREE.Group();
  group.name = 'birds';
  group.add(bodies, wingL, wingR);
  setLayers(group, LAYER.NEAR);
  scene.add(group);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), SC = new THREE.Vector3(), E = new THREE.Euler(), W = new THREE.Matrix4();
  let t = 0;

  return {
    group, birds, count: n,
    /** For the sound (core/sound.js): the parakeet pass and the resting flocks. */
    parakeets: pk, flocks,
    update(dt, player) {
      t += dt;
      const pe = player ? player.e : 1e9, pn = player ? player.n : 1e9;
      // flocks: lift off when the jogger passes within 110 m, wheel for ~25 s, settle
      for (const fl of flocks) {
        const d = Math.hypot(fl.ce - pe, fl.cn - pn);
        fl.t += dt;
        if (fl.state === 'rest' && d < 110 && fl.t > 30) { fl.state = 'fly'; fl.t = 0; }
        else if (fl.state === 'fly' && fl.t > 25) { fl.state = 'land'; fl.t = 0; }
        else if (fl.state === 'land' && fl.t > 6) { fl.state = 'rest'; fl.t = 0; }
      }
      // parakeets: every ~70 s a pass straight over the jogger
      pk.t -= dt;
      if (!pk.active && pk.t <= 0 && player) {
        const a = Math.random() * TAU;
        pk.e0 = pe - Math.cos(a) * 260; pk.n0 = pn - Math.sin(a) * 260; pk.de = Math.cos(a); pk.dn = Math.sin(a); pk.active = true; pk.pos = 0;
      }
      if (pk.active) { pk.pos += 14 * dt; if (pk.pos > 520) { pk.active = false; pk.t = 60 + Math.random() * 30; } }

      birds.forEach((b, i) => {
        let flying = false, bank = 0;
        if (b.mode === 'perch') {
          const d = Math.hypot(b.e - pe, b.n - pn);
          if (b.state === 'rest' && d < 3.5) { b.state = 'fly'; b.ft = 0; b.dest = THREE.MathUtils.clamp(b.s + (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 40), 10, L - 10); }
          if (b.state === 'fly') {
            b.ft += dt;
            const u = Math.min(1, b.ft / 4), s = THREE.MathUtils.lerp(b.s, b.dest, u), f = spineAt(s);
            b.e = f.e + f.ne * 4.6; b.n = f.n + f.nn * 4.6; b.y = walkY(s) + DAM.parH + Math.sin(Math.PI * u) * 5;
            b.yaw = Math.atan2(-(f.te * Math.sign(b.dest - b.s)), f.tn * Math.sign(b.dest - b.s));
            flying = true;
            if (u >= 1) { b.s = b.dest; b.state = 'rest'; }
          }
        } else if (b.mode === 'swim') {
          if (Math.random() < dt * 0.3) { b.vx = (Math.random() - 0.5) * 0.5; b.vn = (Math.random() - 0.5) * 0.5; }
          const ne = b.e + b.vx * dt, nn = b.n + b.vn * dt;
          if (shoreDist(ne, nn, 30) < -8) { b.e = ne; b.n = nn; if (b.vx || b.vn) b.yaw = Math.atan2(-b.vx, b.vn); }
          b.y = -0.12 + Math.sin(t * 2 + i) * 0.02;
        } else if (b.mode === 'flock') {
          const fl = b.flock;
          if (fl.state === 'fly' || fl.state === 'land') {
            b.orbitA += dt * (0.35 + (i % 5) * 0.02);
            const tx = fl.ce + Math.cos(b.orbitA) * b.orbitR, tn = fl.cn + Math.sin(b.orbitA) * b.orbitR;
            const land = fl.state === 'land' ? Math.min(1, fl.t / 6) : 0;
            const ty = THREE.MathUtils.lerp(b.alt * Math.min(1, fl.t / 3 + (fl.state === 'land' ? 1 : 0)), -0.12, land);
            const ex = THREE.MathUtils.lerp(tx, b.re, land), en = THREE.MathUtils.lerp(tn, b.rn, land);
            const de = ex - b.e, dn = en - b.n;
            if (Math.hypot(de, dn) > 0.01) b.yaw = Math.atan2(-de, dn);
            b.e += de * Math.min(1, dt * 3); b.n += dn * Math.min(1, dt * 3); b.y += (ty - b.y) * Math.min(1, dt * 2);
            flying = b.y > 0.3; bank = 0.35;
          } else { b.y = -0.12 + Math.sin(t * 1.7 + i) * 0.02; }
        } else if (b.mode === 'cross') {
          if (pk.active) {
            b.e = pk.e0 + pk.de * pk.pos + b.off[0] * -pk.dn + b.off[2] * pk.de;
            b.n = pk.n0 + pk.dn * pk.pos + b.off[0] * pk.de + b.off[2] * pk.dn;
            b.y = 26 + b.off[1] + Math.sin(t * 3 + i) * 0.6;
            b.yaw = Math.atan2(-pk.de, pk.dn);
            flying = true;
          } else b.y = -999;
        }
        const S = b.S.scale;
        const hidden = b.y < -100;
        M.compose(V.set(b.e, b.y, -b.n), Q.setFromEuler(E.set(0, b.yaw, flying ? bank * Math.sin(t + i) : 0, 'YXZ')), SC.set(hidden ? 0 : S[0], hidden ? 0 : S[1], hidden ? 0 : S[2]));
        bodies.setMatrixAt(i, M);
        // wings: folded at rest, flapping in flight
        b.flap += dt * b.S.flap * TAU;
        const fold = flying ? Math.sin(b.flap) * 0.9 : 0.12; // folded: flat along the back
        for (const [mesh, side] of [[wingL, -1], [wingR, 1]]) {
          W.compose(V.set(side * 0.1, 0.42, -0.05), Q.setFromEuler(E.set(0, 0, side * fold, 'XYZ')), SC.set(flying ? 1.5 : 0.38, 1, flying ? 1.2 : 1.0));
          mesh.setMatrixAt(i, W.premultiply(M));
        }
      });
      for (const m of [bodies, wingL, wingR]) m.instanceMatrix.needsUpdate = true;
    },
  };
}
