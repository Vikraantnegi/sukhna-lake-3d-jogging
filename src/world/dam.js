import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { cobbleTex } from '../core/textures.js';
import { rngKit } from '../core/util.js';
import { data, L, spineAt, nearestS, rayToShore, shoreDist, inLake } from './frame.js';
import { LodSet, LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The dam and its promenade, along the real curve (plan §4, §6).
 *
 * One cross-section, swept along the smoothed OSM centreline.  Offsets d
 * are metres from the centreline, + toward the lake:
 *
 *      city                                     lake
 *   toe  face 1:2  verge  |---- walk ----|  parapet  embankment  water
 *   -dToe      -6.5   -4        0         4     5.2              dShore
 *
 *   walk      y = walkY(s): the bund crest (+2.5 m over the water), or
 *             the real ground plus 0.3 m where that is higher (the west end)
 *   parapet   0.45 m of river cobble, 1.2 m wide, sittable (r2, r8)
 *   embankment stone pitching from the parapet foot straight down to the
 *             *real* shoreline, found by casting along the normal to the
 *             OSM polygon -- so the dam always meets the water exactly
 *             where OSM says the water is
 *   face      the grassed downstream face, 1:2, down to the real ground
 *
 * `damHeight(s, d)` is that surface; `groundAt` defers to it inside the
 * footprint, so what is drawn is what is walked on.  The meshes are cut
 * into 100 m sectors of s: near sectors carry every instanced detail,
 * far ones a single merged strip (the walk curves round the lake, so from
 * the bend most of it is in view 1-2 km away).
 * ------------------------------------------------------------------ */

export const DAM = { half: 4, parIn: 4.0, parOut: 5.2, parH: 0.45, verge: 6.5, crest: 2.5, face: 0.5 };
const STEP = 2;
const SECTOR = 100;
/** Where the stylised steps down to the water go (s, m).  Not in OSM: flagged generic. */
export const WATER_STEPS = [820, 1480, 2130];
const WATER_STEP_HALF = 1.6;
/** Every bench on the walk, { s, d }: the crowd sits people on them, the jogger can sit too. */
export const BENCHES = [];

let PROF = null;

/**
 * Sample the cross-section parameters every 2 m of s.  `ground(e, n)` is the
 * terrain *before* the dam is cut into it (DEM, smoothed, shore-graded).
 */
export function buildProfile(ground) {
  const n = Math.ceil(L / STEP) + 1;
  const yRaw = new Float32Array(n), yW = new Float32Array(n);
  const dShore = new Float32Array(n), dToe = new Float32Array(n), dLake = new Float32Array(n);
  const fr = [];
  for (let k = 0; k < n; k++) {
    const f = spineAt(k * STEP);
    fr.push(f);
    let h = -Infinity;
    for (const o of [-6, 0, 6]) h = Math.max(h, ground(f.e + f.ne * o, f.n + f.nn * o));
    yRaw[k] = h + 0.3;
  }
  // the walk rises and falls gently: +-40 m moving average, never below the crest
  for (let k = 0; k < n; k++) {
    let a = 0, c = 0;
    for (let d = -20; d <= 20; d++) { const q = k + d; if (q >= 0 && q < n) { a += yRaw[q]; c++; } }
    yW[k] = Math.max(DAM.crest, a / c);
  }
  // the real shoreline along the lake-side normal
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const f = fr[k];
    const t = rayToShore(f.e, f.n, f.ne, f.nn, 45);
    raw[k] = Number.isFinite(t) ? Math.max(DAM.parOut + 2, t) : NaN;
  }
  // used raw, not smoothed: the embankment has to meet the water exactly
  // where the polygon edge is along each normal, or a sliver of dry slope
  // shows below the water line (shoreCheck)
  dShore.set(raw);
  // the downstream toe, and the lake-side toe where there is no water
  const march = (f, y0, from, sign) => {
    for (let d = from; d <= 40; d += 0.5) {
      const y = y0 - (d - from) * DAM.face;
      if (y <= ground(f.e + f.ne * d * sign, f.n + f.nn * d * sign) + 0.05) return d;
    }
    return 40;
  };
  for (let k = 0; k < n; k++) {
    dToe[k] = march(fr[k], yW[k], DAM.verge, -1);
    dLake[k] = Number.isFinite(dShore[k]) ? dShore[k] + 3 : march(fr[k], yW[k], DAM.parOut, 1);
  }
  PROF = { n, yW, dShore, dToe, dLake, fr };
  return PROF;
}

const idx = (s) => THREE.MathUtils.clamp(Math.round(s / STEP), 0, PROF.n - 1);
/** Height of the walk surface at arc length s. */
export function walkY(s) {
  const f = THREE.MathUtils.clamp(s / STEP, 0, PROF.n - 1);
  const i = Math.min(PROF.n - 2, Math.floor(f)), a = f - i;
  return PROF.yW[i] * (1 - a) + PROF.yW[i + 1] * a;
}
export const shoreOffset = (s) => PROF.dShore[idx(s)];

/** The dam surface at (s, d), or NaN outside its footprint. */
export function damHeight(s, d) {
  const k = idx(s);
  const yW = walkY(s);
  if (d >= -DAM.half && d <= DAM.parOut) return yW;
  if (d > 0) {
    const dS = PROF.dShore[k];
    if (Number.isFinite(dS)) {
      if (d <= dS) return yW * (1 - (d - DAM.parOut) / (dS - DAM.parOut));
      if (d <= dS + 3) return -0.27 * (d - dS);
      return NaN;
    }
    return d <= PROF.dLake[k] ? yW - (d - DAM.parOut) * DAM.face : NaN;
  }
  const a = -d;
  if (a <= DAM.verge) return yW;
  return a <= PROF.dToe[k] ? yW - (a - DAM.verge) * DAM.face : NaN;
}

/** Footprint [dMin, dMax] at s (dMin negative, city side), including the buried aprons. */
export function footprint(s) {
  const k = idx(s);
  return [-(PROF.dToe[k] + 3), PROF.dLake[k] + 0.5];
}

/**
 * The dam's height at a world point (e, n), or NaN off the dam.  On the
 * water it is never above the surface (0.27 m down per metre in from the
 * edge), whatever the cross-section says -- where the shore runs oblique
 * to the dam the profile along the normal and the polygon can disagree by
 * a metre or two, and the water plane is the truth.
 */
export function damAt(e, n) {
  const ns = nearestS(e, n);
  if ((ns.s <= 0.01 || ns.s >= L - 0.01) && ns.d > DAM.half) return NaN; // past the ends
  const d = ns.side * ns.d;
  const y = damHeight(ns.s, d);
  if (!Number.isFinite(y) || d < DAM.parOut) return y;
  if (inLake(e, n)) return Math.min(y, 0.27 * shoreDist(e, n, 30) - 0.05);
  return y;
}

/** Is (e, n) inside the dam's footprint (aprons included)? */
export function inFootprint(e, n) {
  const ns = nearestS(e, n);
  if (ns.d > 60) return false;
  if ((ns.s <= 0.01 || ns.s >= L - 0.01) && ns.d > DAM.half + 2) return false;
  const d = ns.side * ns.d, [lo, hi] = footprint(ns.s);
  return d >= lo && d <= hi;
}

/**
 * Lower terrain under the dam so it never shows through (a decoded height
 * grid, in place): every vertex within the footprint plus one grid cell
 * stays 0.8 m under the dam's surface -- except that on land it is never
 * cut below the shore's minimum, which would leave a dry pit under the
 * water line where there is no water.
 */
export function cutTerrain(g) {
  let cut = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const e = g.rect[0] + i * g.step, n = g.rect[1] + j * g.step;
      const ns = nearestS(e, n);
      if (ns.d > 60) continue;
      if ((ns.s <= 0.01 || ns.s >= L - 0.01) && ns.d > DAM.half + 2) continue;
      const d = ns.side * ns.d;
      const [lo, hi] = footprint(ns.s);
      if (d < lo - g.step || d > hi + g.step) continue;
      const y = damHeight(ns.s, THREE.MathUtils.clamp(d, lo + 3, hi - 0.5));
      if (!Number.isFinite(y)) continue;
      const k = j * g.nx + i;
      // under the dam anything goes (the dam covers it); in the margin outside it, on land, no pits
      const floor = (d >= lo && d <= hi) || inLake(e, n) ? -Infinity : 0.35;
      const target = Math.max(y - 0.8, floor);
      if (g.h[k] > target) { g.h[k] = target; cut++; }
    }
  }
  return cut;
}

/* ------------------------------- meshes ------------------------------- */

const C = (hex) => new THREE.Color(hex);
const COL = {
  walk: C(PAL.asphalt), grass: C(PAL.grass), grassDeep: C(PAL.grassDeep), stone: C(PAL.pitching),
  draw: C(PAL.drawdown), wet: C(PAL.drawdownWet), bed: C(PAL.lakeBed), cobble: C(PAL.cobble), mortar: C(PAL.mortar),
};

/**
 * Strip rows along s from s0 to s1 at `step`: `stations(k, s)` returns
 * [{ d, y, c }] (the same count for every row).  Returns a geometry with
 * vertex colours, in world coordinates.
 */
function stripGeometry(s0, s1, step, stations) {
  const pos = [], col = [], index = [];
  let prev = -1, count = 0;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const ss = Math.min(s, L);
    const f = spineAt(ss);
    const st = stations(ss);
    count = st.length;
    const base = pos.length / 3;
    for (const { d, y, c } of st) {
      pos.push(f.e + f.ne * d, y, -(f.n + f.nn * d));
      col.push(c.r, c.g, c.b);
    }
    if (prev >= 0) {
      for (let q = 0; q < count - 1; q++) {
        const a = prev + q, b = prev + q + 1, a2 = base + q, b2 = base + q + 1;
        index.push(a, a2, b, b, a2, b2);
      }
    }
    prev = base;
    if (ss >= L) break;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // a row runs city -> lake, rows run east -> west; make sure faces point up
  const nrm = geo.attributes.normal;
  let up = 0;
  for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
  if (up < 0) { index.reverse(); geo.setIndex(index); geo.computeVertexNormals(); }
  geo.computeBoundingSphere();
  return geo;
}

const lerp = THREE.MathUtils.lerp;
function cityStations(s) {
  const k = idx(s), yW = walkY(s), toe = PROF.dToe[k];
  const out = [{ d: -(toe + 3), y: yW - (toe - DAM.verge) * DAM.face - 2, c: COL.grassDeep }];
  for (let q = 3; q >= 0; q--) {
    const a = lerp(DAM.verge, toe, q / 3);
    out.push({ d: -a, y: yW - (a - DAM.verge) * DAM.face, c: q === 3 ? COL.grassDeep : COL.grass });
  }
  out.push({ d: -DAM.half, y: yW, c: COL.grass });
  return out;
}
function lakeStations(s) {
  const k = idx(s), yW = walkY(s), dS = PROF.dShore[k];
  const out = [{ d: DAM.parIn, y: yW, c: COL.mortar }, { d: DAM.parOut, y: yW, c: COL.grass }];
  if (Number.isFinite(dS)) {
    const at = (t) => lerp(DAM.parOut, dS, t);
    out.push({ d: at(0.3), y: yW * 0.7, c: COL.grass });
    out.push({ d: at(0.45), y: yW * 0.55, c: COL.stone });
    out.push({ d: at(0.88), y: yW * 0.12, c: COL.stone });
    out.push({ d: dS - 0.4, y: yW * 0.04 + 0.02, c: COL.draw });
    out.push({ d: dS, y: 0.0, c: COL.wet });
    out.push({ d: dS + 3, y: -0.8, c: COL.bed });
  } else {
    const end = PROF.dLake[k];
    for (let q = 1; q <= 5; q++) {
      const a = lerp(DAM.parOut, end, q / 5);
      out.push({ d: a, y: yW - (a - DAM.parOut) * DAM.face, c: COL.grass });
    }
    out.push({ d: end + 3, y: yW - (end - DAM.parOut) * DAM.face - 2, c: COL.grassDeep });
  }
  return out;
}
function walkStations(s) {
  const yW = walkY(s);
  return [{ d: -DAM.half, y: yW, c: COL.walk }, { d: 0, y: yW + 0.03, c: COL.walk }, { d: DAM.half, y: yW, c: COL.walk }];
}
/** The far LOD: walk, parapet and embankment in one coarse strip. */
function farStations(s) {
  const k = idx(s), yW = walkY(s), dS = PROF.dShore[k], toe = PROF.dToe[k];
  const lake = Number.isFinite(dS)
    ? [{ d: dS * 0.6, y: yW * 0.4, c: COL.stone }, { d: dS, y: 0, c: COL.draw }, { d: dS + 3, y: -0.8, c: COL.bed }]
    : [{ d: PROF.dLake[k], y: 0.5, c: COL.grass }, { d: PROF.dLake[k] + 3, y: -1.5, c: COL.grassDeep }];
  return [
    { d: -(toe + 3), y: yW - (toe - DAM.verge) * DAM.face - 2, c: COL.grassDeep },
    { d: -toe, y: yW - (toe - DAM.verge) * DAM.face, c: COL.grass },
    { d: -DAM.verge, y: yW, c: COL.grass },
    { d: -DAM.half, y: yW, c: COL.walk },
    { d: DAM.parIn, y: yW, c: COL.walk },
    { d: DAM.parIn, y: yW + DAM.parH, c: COL.cobble },
    { d: DAM.parOut, y: yW + DAM.parH, c: COL.cobble },
    { d: DAM.parOut, y: yW, c: COL.grass },
    ...lake,
  ];
}

/* ------------------------------ dressing ------------------------------ */

function mergedParts(parts) {
  // parts: [{ geo, color, matrix }] -> one geometry with vertex colours
  const geos = parts.map(({ geo, color, matrix }) => {
    const g = geo.clone().toNonIndexed();
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color), n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  });
  const m = mergeGeometries(geos, false);
  m.computeVertexNormals();
  return m;
}
const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

/** Generic lamp (not confirmed by any photo: a plain pole with a lantern head). */
const LAMP = mergedParts([
  { geo: new THREE.CylinderGeometry(0.06, 0.09, 4.6, 6), color: PAL.lampPole, matrix: M4(0, 2.3, 0) },
  { geo: new THREE.BoxGeometry(0.08, 0.08, 0.7), color: PAL.lampPole, matrix: M4(0, 4.5, -0.3) },
  { geo: new THREE.CylinderGeometry(0.2, 0.14, 0.42, 6), color: 0xf1ead6, matrix: M4(0, 4.3, -0.62) },
  { geo: new THREE.ConeGeometry(0.26, 0.2, 6), color: PAL.lampPole, matrix: M4(0, 4.6, -0.62) },
]);
/** Red-brown wooden bench on a dark frame (photo r1), facing -z. */
const BENCH = mergedParts([
  { geo: new THREE.BoxGeometry(1.8, 0.06, 0.42), color: PAL.benchWood, matrix: M4(0, 0.45, 0) },
  { geo: new THREE.BoxGeometry(1.8, 0.32, 0.05), color: PAL.benchWood, matrix: M4(0, 0.72, 0.22, 0, 1, 1, 1, -0.2) },
  { geo: new THREE.BoxGeometry(0.06, 0.45, 0.5), color: PAL.benchFrame, matrix: M4(-0.8, 0.22, 0.02) },
  { geo: new THREE.BoxGeometry(0.06, 0.45, 0.5), color: PAL.benchFrame, matrix: M4(0.8, 0.22, 0.02) },
]);
const BIN = mergedParts([
  { geo: new THREE.CylinderGeometry(0.24, 0.21, 0.75, 8), color: 0xe4e2dc, matrix: M4(0, 0.38, 0) },
  { geo: new THREE.CylinderGeometry(0.26, 0.26, 0.06, 8), color: 0x9a9aa0, matrix: M4(0, 0.78, 0) },
]);
/** The 100 m marker: stylised, NOT a real object on the dam. */
const MARKER = mergedParts([
  { geo: new THREE.BoxGeometry(0.26, 0.9, 0.26), color: PAL.concrete, matrix: M4(0, 0.45, 0) },
  { geo: new THREE.BoxGeometry(0.28, 0.16, 0.28), color: 0xd84a3a, matrix: M4(0, 0.78, 0) },
]);
/**
 * One royal-palm frond: a tapering blade that rises from the crown and
 * arches over into a droop (a parabola, out `len`, up `rise`, down `droop`),
 * folded along its midrib so the two halves of leaflets read as a V.
 * Built along +x from the origin; the palm turns it into place.
 */
function frondGeometry(len, rise, droop, width, seg = 9) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const x = len * t, y = rise * t - (rise + droop) * t * t;
    const w = width * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * (1 - 0.6 * t);
    const fold = w * 0.35; // leaflets hang below the midrib
    pos.push(x, y, 0, x, y - fold, -w, x, y - fold, w);
    if (i) { const a = (i - 1) * 3, b = i * 3; idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 2, b, a + 2, b + 2, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Royal palm: pale grey trunk, green crownshaft, arching fronds (photo r2). */
const PALM = (() => {
  const fronds = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + (i % 2) * 0.2;
    const old = i % 3 === 0; // the older, lower fronds droop further
    fronds.push({ geo: frondGeometry(old ? 3.6 : 3.2, old ? 0.6 : 1.3, old ? 2.4 : 1.6, 0.55), color: old ? 0x6f7f3a : PAL.palmFrond, matrix: M4(0, 12.0, 0, -a) });
  }
  // two young fronds still standing up out of the crown
  for (const a of [0.6, 2.9]) fronds.push({ geo: frondGeometry(1.4, 2.6, 0.2, 0.3), color: 0x7f9a45, matrix: M4(0, 12.1, 0, -a) });
  return mergedParts([
    { geo: new THREE.CylinderGeometry(0.22, 0.34, 11.2, 7), color: PAL.palmTrunk, matrix: M4(0, 5.6, 0) },
    { geo: new THREE.CylinderGeometry(0.26, 0.24, 1.2, 7), color: 0x8a9a5a, matrix: M4(0, 11.6, 0) },
    ...fronds,
  ]);
})();

/**
 * The parapet as one continuous swept mesh along the curve (1 m steps), so
 * it bends with the walk instead of stepping at 2 m block joints.  The cobble
 * texture repeats every 2 m along s.  Broken only at the water steps
 * (`isGap(s)`), where the ends are capped.
 */
function parapetGeometry(s0, s1, isGap) {
  const pos = [], uv = [], idx = [];
  const H = DAM.parH, a = DAM.parIn, b = DAM.parOut;
  let prev = null;
  const quad = (p0, p1, p2, p3, u0, u1, v0, v1) => {
    const k = pos.length / 3;
    pos.push(...p0, ...p1, ...p2, ...p3);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2); // outward: s runs east to west with the lake on the right
  };
  const ring = (s) => {
    const f = spineAt(s), y = walkY(s);
    const P = (d, h) => [f.e + f.ne * d, y + h, -(f.n + f.nn * d)];
    return { s, ib: P(a, 0), it: P(a, H), ot: P(b, H), ob: P(b, 0) };
  };
  const cap = (r, flip) => {
    const k = pos.length / 3;
    const pts = flip ? [r.ob, r.ot, r.it, r.ib] : [r.ib, r.it, r.ot, r.ob];
    pos.push(...pts[0], ...pts[1], ...pts[2], ...pts[3]);
    uv.push(0, 0, 0, 1, 0.6, 1, 0.6, 0);
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  };
  for (let s = s0; s <= s1 + 1e-6; s += 1) {
    const ss = Math.min(s, L);
    if (isGap(ss)) { if (prev) cap(prev, false); prev = null; continue; }
    const r = ring(ss);
    if (!prev) { cap(r, true); prev = r; continue; }
    const u0 = prev.s / 2, u1 = r.s / 2;
    quad(prev.ib, r.ib, r.it, prev.it, u0, u1, 0, 1);            // walk-side face
    quad(prev.it, r.it, r.ot, prev.ot, u0, u1, 0, 2.4);          // top
    quad(prev.ot, r.ot, r.ob, prev.ob, u0, u1, 1, 0);            // lake-side face
    prev = r;
    if (ss >= L) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
const REEDS = (() => {
  const parts = [];
  const r = rngKit(31);
  for (let i = 0; i < 9; i++) {
    const h = r.range(0.9, 1.7);
    parts.push({ geo: new THREE.ConeGeometry(0.05, h, 3), color: r.chance(0.3) ? PAL.reedDry : PAL.reed, matrix: M4(r.range(-0.5, 0.5), h / 2 - 0.1, r.range(-0.5, 0.5), 0, 1, 1, 1, r.range(-0.15, 0.15), r.range(-0.15, 0.15)) });
  }
  return mergedParts(parts);
})();

function instanced(geo, mat, xforms, name) {
  if (!xforms.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, xforms.length);
  xforms.forEach((x, i) => m.setMatrixAt(i, x));
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A world transform on the promenade: (s, d), height y, yaw facing along +nL rotated by `turn`. */
function placeAt(s, d, y, turn = 0, scale = 1) {
  const f = spineAt(s);
  // facing the lake: local -z points along +nL
  const yaw = Math.atan2(-f.ne, f.nn) + turn;
  return M4(f.e + f.ne * d, y, -(f.n + f.nn * d), yaw, scale, scale, scale);
}

/* ------------------------------ stairs ------------------------------ */

function stairGeometry(steps) {
  // steps: [{ s, from:{d,y}, to:{d,y}, width }] -> merged boxes along the lake normal
  const parts = [];
  for (const st of steps) {
    const f = spineAt(st.s);
    const yaw = Math.atan2(-f.ne, f.nn);
    const rise = 0.17, count = Math.max(1, Math.round(Math.abs(st.from.y - st.to.y) / rise));
    for (let q = 0; q < count; q++) {
      const t = (q + 0.5) / count;
      const d = lerp(st.from.d, st.to.d, t), y = lerp(st.from.y, st.to.y, t);
      const run = Math.abs(st.to.d - st.from.d) / count;
      parts.push({ geo: new THREE.BoxGeometry(st.width, 0.18, run + 0.02), color: q % 2 ? PAL.concrete : PAL.concreteDark,
        matrix: M4(f.e + f.ne * d, y - 0.09, -(f.n + f.nn * d), yaw) });
    }
    // low side walls
    const len = Math.hypot(st.to.d - st.from.d, st.to.y - st.from.y), pitch = Math.atan2(st.from.y - st.to.y, Math.abs(st.to.d - st.from.d));
    const dm = (st.from.d + st.to.d) / 2, ym = (st.from.y + st.to.y) / 2;
    for (const side of [-1, 1]) {
      const off = (st.width / 2 + 0.15) * side;
      const e = f.e + f.ne * dm + f.te * off, n = f.n + f.nn * dm + f.tn * off;
      const dir = Math.sign(st.to.d - st.from.d);
      parts.push({ geo: new THREE.BoxGeometry(0.3, 0.5, len), color: PAL.concreteDark, matrix: M4(e, ym, -n, yaw, 1, 1, 1, dir * pitch) });
    }
  }
  return parts.length ? mergedParts(parts) : null;
}

/* ------------------------------- build ------------------------------- */

export function buildDam(scene, { ground }) {
  const group = new THREE.Group();
  group.name = 'dam';
  const lod = new LodSet('dam');
  const vc = cel({ color: 0xffffff, vertexColors: true, relief: true, bands: 'terrain', flat: false });
  const vcProps = cel({ color: 0xffffff, vertexColors: true, flat: false });
  const parapetMat = cel({ color: 0xffffff, map: cobbleTex() });
  const palmMat = cel({ color: 0xffffff, vertexColors: true, flat: false, side: THREE.DoubleSide });
  const stats = { sectors: 0, parapet: 0, lamps: 0, benches: 0, palms: 0, reeds: 0 };
  const rng = rngKit(2027);

  // the stairs: six real ones down the city face (OSM highway=steps), three stylised to the water
  const cityStairs = data.steps.filter((st) => st.side === 'city').map((st) => {
    const k = idx(st.s), yW = walkY(st.s), toe = PROF.dToe[k];
    return { s: st.s, from: { d: -DAM.verge + 0.2, y: yW }, to: { d: -toe, y: yW - (toe - DAM.verge) * DAM.face }, width: 3, ref: st.ref };
  });
  const waterStairs = WATER_STEPS.filter((s) => Number.isFinite(shoreOffset(s))).map((s) => ({
    s, from: { d: DAM.parOut - 0.2, y: walkY(s) }, to: { d: shoreOffset(s) + 0.6, y: -0.25 }, width: WATER_STEP_HALF * 2,
  }));
  const nearGap = (s) => waterStairs.some((w) => Math.abs(w.s - s) < WATER_STEP_HALF + 0.9);
  const nearStair = (s) => cityStairs.some((w) => Math.abs(w.s - s) < 3);

  for (let s0 = 0; s0 < L; s0 += SECTOR) {
    const s1 = Math.min(L, s0 + SECTOR);
    const near = new THREE.Group();
    near.name = `damSector${s0}`;
    const add = (m) => { if (m) near.add(m); };
    add(new THREE.Mesh(stripGeometry(s0, s1, STEP, walkStations), vc));
    add(new THREE.Mesh(stripGeometry(s0, s1, STEP, cityStations), vc));
    add(new THREE.Mesh(stripGeometry(s0, s1, STEP, lakeStations), vc));

    // the parapet: one swept mesh along the curve, broken only at the steps to the water
    const parapet = new THREE.Mesh(parapetGeometry(s0, s1, nearGap), parapetMat);
    parapet.name = 'parapet';
    parapet.castShadow = parapet.receiveShadow = true;
    stats.parapet += Math.round(s1 - s0);
    add(parapet);

    // lamps every 30 m on the city verge, benches every 45 m facing the water, a bin by every other bench
    const lamps = [], benches = [], bins = [], markers = [], palms = [], reeds = [];
    for (let s = Math.ceil(s0 / 30) * 30 + 12; s < s1; s += 30) if (!nearStair(s)) lamps.push(placeAt(s, -DAM.half - 0.6, walkY(s)));
    for (let s = Math.ceil(s0 / 45) * 45 + 25; s < s1; s += 45) {
      if (nearStair(s)) continue;
      benches.push(placeAt(s, -DAM.half - 1.1, walkY(s)));
      BENCHES.push({ s, d: -DAM.half - 1.1 });
      if (Math.round(s / 45) % 2) bins.push(placeAt(s + 2.2, -DAM.half - 0.9, walkY(s + 2.2)));
    }
    for (let s = Math.ceil(s0 / 100) * 100; s < s1; s += 100) if (s > 0) markers.push(placeAt(s, -DAM.half - 0.35, walkY(s)));
    // royal palms along the land side of the verge (r2)
    for (let s = s0 + 11; s < s1; s += 22) {
      if (nearStair(s)) continue;
      const k = idx(s);
      const d = -Math.min(PROF.dToe[k] + 2, DAM.verge + 1.6 + rng.range(0, 1.5));
      const y = ground(spineAt(s).e + spineAt(s).ne * d, spineAt(s).n + spineAt(s).nn * d);
      const yy = Number.isFinite(damHeight(s, d)) ? damHeight(s, d) : y;
      palms.push(placeAt(s + rng.range(-3, 3), d, yy - 0.1, rng.range(0, 6.28), rng.range(0.85, 1.1)));
    }
    // reeds in clumps at the water's edge
    for (let s = s0 + rng.range(2, 8); s < s1; s += rng.range(6, 16)) {
      const dS = shoreOffset(s);
      if (!Number.isFinite(dS) || nearGap(s) || !rng.chance(0.55)) continue;
      for (let q = 0; q < 3; q++) reeds.push(placeAt(s + rng.range(-2, 2), dS + rng.range(0.3, 2.2), -0.25, rng.range(0, 6.28), rng.range(0.8, 1.3)));
    }
    stats.lamps += lamps.length; stats.benches += benches.length; stats.palms += palms.length; stats.reeds += reeds.length;
    add(instanced(LAMP, vcProps, lamps, 'lamps'));
    add(instanced(BENCH, vcProps, benches, 'benches'));
    add(instanced(BIN, vcProps, bins, 'bins'));
    add(instanced(MARKER, vcProps, markers, 'markers'));
    add(instanced(PALM, palmMat, palms, 'palms'));
    const reedMesh = instanced(REEDS, vcProps, reeds, 'reeds');
    if (reedMesh) { reedMesh.castShadow = false; add(reedMesh); }
    near.traverse((o) => { if (o.isMesh && !o.isInstancedMesh) { o.receiveShadow = true; o.userData.noOutline = true; } });
    setLayers(near, LAYER.NEAR);

    const far = new THREE.Mesh(stripGeometry(s0, s1, 8, farStations), vc);
    far.name = `damFar${s0}`;
    far.userData.noOutline = true;
    setLayers(far, LAYER.NEAR, LAYER.FAR);

    group.add(near, far);
    const mid = spineAt((s0 + s1) / 2);
    lod.add(new THREE.Vector3(mid.e, 0, -mid.n), [{ dist: 380, obj: near }, { dist: 1e9, obj: far }], 'dam');
    stats.sectors++;
  }

  const stairParts = stairGeometry([...cityStairs, ...waterStairs]);
  if (stairParts) {
    const stairs = new THREE.Mesh(stairParts, vcProps);
    stairs.name = 'stairs';
    stairs.castShadow = stairs.receiveShadow = true;
    setLayers(stairs, LAYER.NEAR);
    group.add(stairs);
  }

  scene.add(group);
  return { group, lod, stats, cityStairs, waterStairs };
}
