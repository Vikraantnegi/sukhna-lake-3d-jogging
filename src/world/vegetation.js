import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { mulberry32 } from '../core/util.js';
import { data, L, spineAt, shoreDist } from './frame.js';
import { COVER, groundAt } from './terrain.js';
import { inFootprint, DAM } from './dam.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * Trees (plan §4, §6).
 *
 * Where: scattered deterministically over the real land cover (the 10 m
 * cover grid from OSM): dense in the sanctuary forest, sparse over open
 * land and the golf course, street and garden trees in the sectors, and a
 * dense belt behind the dam's land side (photos r2, r8).  Never on the
 * water, the dam, roads or buildings.
 *
 * How: every tree is a row in flat arrays; drawing is two pools of
 * instances refilled by distance, whatever the tree count --
 *
 *   near  (< ~230 m)  trunk + canopy per species, casting shadows
 *   mid   (to 1.5 km) one low-poly blob per tree, both render passes
 *
 * -- so the forest costs five draw calls.  The mid pool starts 40 m inside
 * the near radius and its blob is smaller than a near canopy, so the
 * overlap hides inside the near trees instead of leaving a gap.
 * ------------------------------------------------------------------ */

export const SPECIES = { BROAD: 0, EUCA: 1, SHRUB: 2 };
const TONES = [
  [0x3f5a2e, 0x4f6b35, 0x5f7a3a, 0x6f8a45, 0x566e3a], // broadleaf: sheesham, mango, peepal
  [0x7d8f68, 0x8a9a74, 0x74866a],                     // eucalyptus: grey-green
  [0x5f7a3a, 0x6b7f45, 0x7c8a4e],                     // shrubs and scrub
];
const TRUNK = [0x6e5a48, 0xcfc6b8, 0x6e5a48];

/* ------------------------------- shapes ------------------------------- */

function blobs(list, detail = 1) {
  const g = mergeGeometries(list.map(([x, y, z, sx, sy, sz]) => {
    const b = new THREE.IcosahedronGeometry(1, detail);
    b.scale(sx, sy, sz);
    b.translate(x, y, z);
    b.deleteAttribute('uv');
    return b;
  }), false);
  g.computeVertexNormals();
  return g;
}
// canopies at unit tree scale; trunks are scaled per instance
const CANOPY = [
  blobs([[0, 6.6, 0, 3.1, 2.4, 3.1], [1.9, 5.6, 0.6, 2.0, 1.7, 2.0], [-1.7, 5.8, -0.9, 2.1, 1.8, 2.1], [0.4, 5.4, -2.0, 1.8, 1.5, 1.8], [-0.5, 7.9, 0.6, 1.8, 1.5, 1.8]]),
  blobs([[0, 12.8, 0, 1.9, 2.4, 1.9], [0.9, 10.6, 0.4, 1.5, 1.7, 1.5], [-0.8, 11.2, -0.5, 1.4, 1.8, 1.4]]),
  blobs([[0, 1.0, 0, 1.4, 1.0, 1.4], [0.8, 0.8, 0.5, 0.9, 0.7, 0.9]]),
];
const TRUNK_GEO = (() => {
  const g = new THREE.CylinderGeometry(0.62, 1, 1, 6, 1);
  g.translate(0, 0.5, 0);
  return g;
})();
const TRUNK_SIZE = [[0.26, 5.2], [0.2, 11.0], [0.08, 0.6]]; // [radius, height] at unit scale
const MID_GEO = (() => { const g = new THREE.IcosahedronGeometry(1, 0); g.deleteAttribute('uv'); return g; })();
// the mid blob: centre height and radii at unit scale, a little inside the near canopy
const MID_SHAPE = [[6.2, 3.0, 2.6], [11.4, 1.9, 3.2], [0.9, 1.3, 0.9]];

/* ------------------------------- scatter ------------------------------- */

/** Where trees may not stand: roads, paths and buildings, rasterised at 5 m. */
function buildMask() {
  const r = COVER.rect, step = 5;
  const nx = Math.ceil((r[2] - r[0]) / step), ny = Math.ceil((r[3] - r[1]) / step);
  const m = new Uint8Array(nx * ny);
  const mark = (e, n, rad) => {
    const i0 = Math.floor((e - rad - r[0]) / step), i1 = Math.floor((e + rad - r[0]) / step);
    const j0 = Math.floor((n - rad - r[1]) / step), j1 = Math.floor((n + rad - r[1]) / step);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) m[j * nx + i] = 1;
  };
  const WIDTH = { secondary: 7, tertiary: 5, residential: 4, service: 3, unclassified: 4, secondary_link: 5, tertiary_link: 4, living_street: 3, track: 2 };
  for (const rd of data.features.roads) {
    const w = WIDTH[rd.k] ?? 3;
    for (let i = 1; i < rd.p.length; i++) {
      const a = rd.p[i - 1], b = rd.p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += 3) mark(a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len, w);
    }
  }
  for (const p of data.features.paths) {
    for (let i = 1; i < p.p.length; i++) {
      const a = p.p[i - 1], b = p.p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += 3) mark(a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len, 2);
    }
  }
  for (const b of data.features.buildings) mark(b.c[0], b.c[1], Math.max(b.l, b.w) / 2 + 2);
  // the entrance plaza's paving (world/landmarks.js lays 44 x 30 m round this point)
  const plaza = data.landmarks.find((l) => l.id === 'entrance_plaza');
  if (plaza) mark(plaza.at[0], plaza.at[1], 27);
  return (e, n) => {
    const i = Math.floor((e - r[0]) / step), j = Math.floor((n - r[1]) / step);
    return i >= 0 && j >= 0 && i < nx && j < ny && m[j * nx + i] === 1;
  };
}

/** Trees per 10 m cover cell, and the species mix [broad, euca, shrub]. */
const DENSITY = {
  forest: [0.5, [0.6, 0.25, 0.15]], scrub: [0.18, [0.4, 0, 0.6]], park: [0.12, [0.7, 0.3, 0]], golf: [0.05, [0.7, 0.3, 0]],
  built: [0.08, [0.85, 0.15, 0]], commercial: [0.04, [1, 0, 0]], grass: [0.03, [1, 0, 0]], wetland: [0.08, [0.2, 0, 0.8]],
  land: [0.06, [0.55, 0.15, 0.3]],
};

export function scatterTrees({ density = 1 } = {}) {
  const blocked = buildMask();
  const rand = mulberry32(1947);
  const T = { x: [], z: [], y: [], s: [], sp: [], tone: [], rot: [] };
  const put = (e, n, sp, scale) => {
    T.x.push(e); T.z.push(-n); T.y.push(groundAt(e, n)); T.s.push(scale); T.sp.push(sp);
    T.tone.push(Math.floor(rand() * TONES[sp].length)); T.rot.push(rand() * Math.PI * 2);
  };
  const pick = (mix) => { const r = rand(); return r < mix[0] ? 0 : r < mix[0] + mix[1] ? 1 : 2; };
  const c = COVER;
  for (let j = 0; j < c.ny; j++) {
    for (let i = 0; i < c.nx; i++) {
      const cls = c.classes[c.cells[j * c.nx + i]];
      let rule = DENSITY[cls];
      if (!rule) continue;
      const e = c.rect[0] + (i + rand()) * c.step, n = c.rect[1] + (j + rand()) * c.step;
      let p = rule[0];
      // unclassified land turning into the Shivalik scrub forest as it rises
      if (cls === 'land') { const h = groundAt(e, n); if (h > 15) { p = 0.32; rule = DENSITY.forest; } }
      if (rand() > p * density) continue;
      if (shoreDist(e, n, 12) < 4 || blocked(e, n) || inFootprint(e, n)) continue;
      put(e, n, pick(rule[1]), 0.75 + rand() * 0.55);
    }
  }
  // the dense belt behind the dam's land side (r2, r8): 4-34 m beyond the toe
  for (let s = 3; s < L - 3; s += 5) {
    const f = spineAt(s);
    for (let q = 0; q < 2; q++) {
      if (rand() > 0.75 * density) continue;
      const d = -(DAM.verge + 12 + rand() * 30);
      const e = f.e + f.ne * d + f.te * (rand() - 0.5) * 4, n = f.n + f.nn * d + f.tn * (rand() - 0.5) * 4;
      if (inFootprint(e, n) || blocked(e, n) || shoreDist(e, n, 12) < 4) continue;
      put(e, n, rand() < 0.7 ? 0 : 1, 0.85 + rand() * 0.45);
    }
  }
  const n = T.x.length;
  const out = { n, x: Float32Array.from(T.x), z: Float32Array.from(T.z), y: Float32Array.from(T.y), s: Float32Array.from(T.s), sp: Uint8Array.from(T.sp), tone: Uint8Array.from(T.tone), rot: Float32Array.from(T.rot) };
  // a 100 m spatial hash for the pool refills
  out.cell = 100;
  out.grid = new Map();
  for (let k = 0; k < n; k++) {
    const key = Math.floor(out.x[k] / 100) + ',' + Math.floor(out.z[k] / 100);
    let a = out.grid.get(key);
    if (!a) out.grid.set(key, (a = []));
    a.push(k);
  }
  return out;
}

/* -------------------------------- pools -------------------------------- */

export function buildVegetation(scene, { density = 1, nearR = 230, midR = 1500, nearMax = 5000, midMax = 36000 } = {}) {
  const trees = scatterTrees({ density });
  const group = new THREE.Group();
  group.name = 'vegetation';
  const canopyMat = cel({ color: 0xffffff, bands: 3, flat: false });
  const trunkMat = cel({ color: 0xffffff, bands: 3 });
  const mk = (geo, mat, cap, name, layers) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.name = name;
    m.frustumCulled = false; // refilled around the camera; the pool is always "in view"
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    setLayers(m, ...layers);
    group.add(m);
    return m;
  };
  const trunks = mk(TRUNK_GEO, trunkMat, nearMax, 'treeTrunks', [LAYER.NEAR]);
  trunks.castShadow = true;
  const canopies = CANOPY.map((g, i) => {
    const m = mk(g, canopyMat, nearMax, `treeCanopy${i}`, [LAYER.NEAR]);
    m.castShadow = true;
    return m;
  });
  const mid = mk(MID_GEO, canopyMat, midMax, 'treeMid', [LAYER.NEAR, LAYER.FAR]);

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const last = { near: new THREE.Vector3(1e9, 0, 0), mid: new THREE.Vector3(1e9, 0, 0), midR };
  const shown = { near: 0, mid: 0 };

  function each(pos, r0, r1, fn, stride = 1) {
    const c0 = Math.floor((pos.x - r1) / 100), c1 = Math.floor((pos.x + r1) / 100);
    const d0 = Math.floor((pos.z - r1) / 100), d1 = Math.floor((pos.z + r1) / 100);
    const r0s = r0 * r0, r1s = r1 * r1;
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const list = trees.grid.get(cx + ',' + cz);
      if (!list) continue;
      for (let q = 0; q < list.length; q += stride) {
        const k = list[q], dx = trees.x[k] - pos.x, dz = trees.z[k] - pos.z, d2 = dx * dx + dz * dz;
        if (d2 >= r0s && d2 < r1s) fn(k);
      }
    }
  }

  function fillNear(pos) {
    let nt = 0;
    const counts = [0, 0, 0];
    each(pos, 0, nearR, (k) => {
      if (nt >= nearMax) return;
      const sp = trees.sp[k], s = trees.s[k];
      Q.setFromAxisAngle(up, trees.rot[k]);
      const [tr, th] = TRUNK_SIZE[sp];
      M.compose(V.set(trees.x[k], trees.y[k] - 0.2, trees.z[k]), Q, S.set(tr * s, th * s + 0.2, tr * s));
      trunks.setMatrixAt(nt, M);
      trunks.setColorAt(nt, C.set(TRUNK[sp]));
      nt++;
      const cm = canopies[sp], ci = counts[sp]++;
      M.compose(V.set(trees.x[k], trees.y[k], trees.z[k]), Q, S.set(s, s, s));
      cm.setMatrixAt(ci, M);
      cm.setColorAt(ci, C.set(TONES[sp][trees.tone[k]]));
    });
    trunks.count = nt;
    canopies.forEach((m, i) => { m.count = counts[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; });
    trunks.instanceMatrix.needsUpdate = true;
    trunks.instanceColor.needsUpdate = true;
    shown.near = nt;
  }

  function fillMid(pos, r1, stride) {
    let n = 0;
    each(pos, Math.max(0, nearR - 40), r1, (k) => {
      if (n >= midMax) return;
      const sp = trees.sp[k], s = trees.s[k], [cy, rx, ry] = MID_SHAPE[sp];
      M.compose(V.set(trees.x[k], trees.y[k] + cy * s, trees.z[k]), Q.identity(), S.set(rx * s, ry * s, rx * s));
      mid.setMatrixAt(n, M);
      mid.setColorAt(n, C.set(TONES[sp][trees.tone[k]]));
      n++;
    }, stride);
    mid.count = n;
    mid.instanceMatrix.needsUpdate = true;
    mid.instanceColor.needsUpdate = true;
    shown.mid = n;
  }

  scene.add(group);
  return {
    group, trees, shown,
    /** Refill the pools when the camera has moved far enough. `wide` for the aerial overview. */
    update(pos, wide = false) {
      const r1 = wide ? 3800 : midR, stride = wide ? 2 : 1;
      if (pos.distanceToSquared(last.near) > 15 * 15) { fillNear(pos); last.near.copy(pos); }
      if (pos.distanceToSquared(last.mid) > 60 * 60 || last.midR !== r1) { fillMid(pos, r1, stride); last.mid.copy(pos); last.midR = r1; }
    },
  };
}
