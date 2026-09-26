/* ------------------------------------------------------------------ *
 * Build src/data/sukhna.data.json from the raw OSM and terrain.
 *
 *   node scripts/sukhna/build-data.mjs
 *
 * Reads scripts/sukhna/raw/* only (run fetch-osm.mjs and
 * fetch-terrain.mjs first).  Writes:
 *   src/data/sukhna.data.json   the compact planet data (runtime)
 *   src/data/sukhna.flat.json   real-space geometry for ?flat=1 (debug)
 *   scripts/sukhna/report.md    measurements, mapping stats, checks
 *   scripts/sukhna/debug/*.png  pictures of the mapping (git-ignored)
 *
 * Exits non-zero if the fold check finds a single inverted triangle.
 * OSM data © OpenStreetMap contributors, ODbL 1.0.
 * ------------------------------------------------------------------ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, TERRAIN, PROMENADE_WAYS, L_JOIN, MAP, LATTICE, RIDGES, DATE } from './config.mjs';
import {
  enuProjector, arcLengths, pointAt, nearestOnPolyline, simplify, signedArea,
  pointInRing, centroid, stitchRings, polyLength, dist, simplifyRing,
} from './lib/geo.mjs';
import { buildStraightener, fitCompression, makeInverse } from './lib/straighten.mjs';
import { demSampler } from './lib/terrarium.mjs';
import { Raster } from './lib/pngenc.mjs';
import { sunPosition, localDate, crossing, hhmm } from '../../src/core/sun.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const t0 = Date.now();
const log = (...a) => console.log(...a);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

/* ------------------------------- load ------------------------------- */
const rawDir = path.join(here, 'raw');
const osmFile = fs.readdirSync(rawDir).filter((f) => f.startsWith(`osm-${BBOX.join('_')}-`)).sort().pop();
if (!osmFile) throw new Error('no raw OSM file: run node scripts/sukhna/fetch-osm.mjs');
const osm = JSON.parse(fs.readFileSync(path.join(rawDir, osmFile), 'utf8'));
const ELS = osm.elements;
const byId = new Map(ELS.map((e) => [e.type + '/' + e.id, e]));
log(`OSM: ${osmFile}, ${ELS.length} elements`);

/* ---------------------------- promenade ---------------------------- */
const promGeo = PROMENADE_WAYS.flatMap((id, i) => {
  const w = byId.get('way/' + id);
  if (!w) throw new Error(`promenade way/${id} missing from the OSM data`);
  return i ? w.geometry.slice(1) : w.geometry;
});
// provisional projection to find the midpoint, then the real origin there
const tmp = enuProjector(promGeo[0].lat, promGeo[0].lon);
let spineLL = promGeo.map((g) => [g.lat, g.lon]);
{
  const sp = spineLL.map(([la, lo]) => tmp.toENU(la, lo));
  const lakeRel = ELS.find((e) => e.type === 'relation' && e.tags?.water === 'lake' && /Sukhna/.test(e.tags?.name || ''));
  const lc = centroid(lakeRel.members.find((m) => m.role === 'outer').geometry.map((g) => tmp.toENU(g.lat, g.lon)));
  // orientation: the lake must be on the right of the direction of travel
  const S = arcLengths(sp), L = S[S.length - 1];
  const a = pointAt(sp, S, L / 2), b = pointAt(sp, S, L / 2 + 1);
  const right = [b[1] - a[1], -(b[0] - a[0])];
  if ((lc[0] - a[0]) * right[0] + (lc[1] - a[1]) * right[1] < 0) spineLL.reverse();
}
const originLL = (() => {
  const sp = spineLL.map(([la, lo]) => tmp.toENU(la, lo));
  const S = arcLengths(sp);
  return tmp.toLatLon(...pointAt(sp, S, S[S.length - 1] / 2));
})();
const proj = enuProjector(originLL[0], originLL[1]);
const P = (g) => proj.toENU(g.lat, g.lon);
const spine = spineLL.map(([la, lo]) => proj.toENU(la, lo));
const SPS = arcLengths(spine);
const L_PROM = SPS[SPS.length - 1];
const C = L_PROM + L_JOIN;
const R = C / (2 * Math.PI);
log(`promenade: ${spine.length} nodes, L = ${L_PROM.toFixed(2)} m -> C = ${C.toFixed(2)} m, R = ${R.toFixed(2)} m`);

/* ------------------------------ geometry ------------------------------ */
const wayPts = (w) => (w.geometry || []).filter(Boolean).map(P);
const isClosed = (pts) => pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 0.01;
/** Rings of an area element (closed way or multipolygon relation). */
function areaRings(e) {
  if (e.type === 'way') { const p = wayPts(e); return isClosed(p) ? { outer: [p.slice(0, -1)], inner: [] } : null; }
  if (e.type === 'relation' && e.members) {
    const get = (role) => stitchRings(e.members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry.filter(Boolean).map(P)))
      .filter(isClosed).map((r) => r.slice(0, -1));
    return { outer: get('outer'), inner: get('inner') };
  }
  return null;
}

const lakeRel = ELS.find((e) => e.type === 'relation' && e.tags?.water === 'lake' && /Sukhna/.test(e.tags?.name || ''));
const lakeRings = areaRings(lakeRel);
const lakeOuter = lakeRings.outer.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
const lakeInner = lakeRings.inner;
const lakeArea = Math.abs(signedArea(lakeOuter)) - lakeInner.reduce((a, r) => a + Math.abs(signedArea(r)), 0);
const lakePerim = polyLength([...lakeOuter, lakeOuter[0]]);

/* ------------------------------ the map ------------------------------ */
const allX = [...lakeOuter, ...spine].map((p) => p[0]), allY = [...lakeOuter, ...spine].map((p) => p[1]);
const fineBox = [Math.min(...allX) - MAP.fineMargin, Math.min(...allY) - MAP.fineMargin, Math.max(...allX) + MAP.fineMargin, Math.max(...allY) + MAP.fineMargin];
log('straightening map:');
const st = buildStraightener({ spine, Rb: MAP.Rb, levels: MAP.levels, fineBox, log });

// far-shore distance: shoreline points more than 150 m from the walk
const shoreU = lakeOuter.map((p) => st.uOf(p)).filter((q) => q && q.u > 150).map((q) => q.u).sort((a, b) => a - b);
const uMed = shoreU[Math.floor(shoreU.length / 2)];
const comp = fitCompression(uMed, MAP.farShoreZ);
log(`compression: far-shore median u = ${uMed.toFixed(0)} m -> z = ${MAP.farShoreZ}; A = ${comp.A.toFixed(2)}`);
const inverse = makeInverse(st, comp, 0.95);

/** Real point -> planet { x, z, side } (or null outside the disc). */
function toPlanet(p, forceSide = 0) {
  let sg = forceSide || st.sideOf(p);
  if (!sg) return null;
  const h = st.harmonicSide(p, sg);
  if (!h) return null;
  const X = Math.max(0, Math.min(L_PROM, h.X));
  const u = Math.max(0, h.P) / st.calib[sg](X);
  return { x: X, z: sg * comp.f(u), side: sg, u: sg * u };
}

/* ---------------------------- fold check ---------------------------- */
/* Checked over everything the map is used for: Psi < P_MAX.  Past that
 * (within ~5% of the 8 km arc) the inverse extrapolates radially instead. */
const P_MAX = 0.95;
const fold = { tris: 0, bad: 0, pMax: P_MAX };
for (const sg of [1, -1]) for (let li = 0; li < st.levels.length; li++) {
  const F = st.fields[sg][li], g = F.g;
  for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
    const k = j * g.nx + i, ks = [k, k + 1, k + g.nx + 1, k + g.nx];
    if (!ks.every((q) => F.side[q] === sg && !F.fixed[q] && F.P[q] < P_MAX)) continue;
    for (const [a, b, c] of [[ks[0], ks[1], ks[2]], [ks[0], ks[2], ks[3]]]) {
      const det = (F.X[b] - F.X[a]) * (F.P[c] - F.P[a]) - (F.X[c] - F.X[a]) * (F.P[b] - F.P[a]);
      fold.tris++;
      // a correctly oriented (unmirrored) cell has det * side < 0 (see straighten.mjs)
      if (!(det * sg < 0)) fold.bad++;
    }
  }
}
log(`fold check: ${fold.tris} triangles, ${fold.bad} inverted`);
if (fold.bad) { console.error('FOLD CHECK FAILED'); process.exitCode = 2; }

/* ----------------------------- sampling helpers ----------------------------- */
function densify(pts, step, closed = false) {
  const out = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
/* Features further out than this are dropped.  From the promenade (eye ~7 m
 * over the city ground) the horizon is ~75 m and a 10 m building sinks below
 * it at ~165 m, so nothing past |z| = 175 is ever seen except from orbit. */
const Z_KEEP = 175;
/** Map a ring (polygon) onto the planet: one side only, densified, simplified. */
function mapRing(ring, tol = 0.4, step = 6, zKeep = Z_KEEP) {
  const d = densify(ring, step, true);
  const sides = d.map((p) => st.sideOf(p));
  const nearSpine = d.some((p) => nearestOnPolyline(p, spine, SPS).d < 30);
  const mixed = new Set(sides).size > 1;
  if (sides.includes(0)) return null;
  let sg = sides[0];
  if (mixed) {
    if (!nearSpine) return null;
    sg = st.sideOf(centroid(ring));
  }
  const m = d.map((p) => toPlanet(p, sg));
  if (m.some((q) => !q)) return null;
  const pts = m.map((q) => [q.x, q.z]);
  if (pts.every((q) => Math.abs(q[1]) > zKeep)) return null;
  const s = simplifyRing(pts, tol);
  return s.length >= 3 ? s : null;
}
/** Map a polyline, splitting it wherever it crosses the cut. */
function mapLine(line, tol = 0.5, step = 6) {
  const d = densify(line, step, false);
  const parts = [];
  let cur = [], curSide = 0;
  for (const p of d) {
    const sg = st.sideOf(p);
    if (!sg) { if (cur.length > 1) parts.push(cur); cur = []; curSide = 0; continue; }
    if (curSide && sg !== curSide) { if (cur.length > 1) parts.push(cur); cur = []; }
    curSide = sg;
    const q = toPlanet(p, sg);
    if (q) cur.push([q.x, q.z]);
  }
  if (cur.length > 1) parts.push(cur);
  return parts.map((pp) => simplify(pp.filter((q) => Math.abs(q[1]) <= Z_KEEP + 10), tol)).filter((pp) => pp.length > 1);
}
const rp = (pts) => pts.map(([x, z]) => [r1(x), r1(z)]);

/* ------------------------------- the lake ------------------------------- */
const lakeOuterMapped = mapRing(lakeOuter, 0.35, 4, Infinity);
const lakeInnerMapped = lakeInner.map((r) => mapRing(r, 0.35, 3, Infinity)).filter(Boolean);
log(`lake: outer ${lakeOuter.length} -> ${lakeOuterMapped.length} mapped pts, ${lakeInnerMapped.length} islands`);

/* --------------------------- classify areas --------------------------- */
const COVER = ['land', 'lake', 'water', 'forest', 'scrub', 'park', 'golf', 'built', 'parking', 'pitch', 'wetland', 'commercial', 'grass'];
const coverClass = (t) => {
  if (!t) return null;
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland') return 'scrub';
  if (t.natural === 'wetland') return 'wetland';
  if (t.leisure === 'golf_course' || t.golf === 'fairway' || t.golf === 'green' || t.golf === 'rough' || t.golf === 'tee') return 'golf';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'nature_reserve' || t.landuse === 'recreation_ground' || t.leisure === 'common') return 'park';
  if (t.landuse === 'grass' || t.landuse === 'meadow' || t.landuse === 'village_green') return 'grass';
  if (t.amenity === 'parking') return 'parking';
  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'playground') return 'pitch';
  if (t.landuse === 'residential' || t.landuse === 'institutional' || t.landuse === 'education') return 'built';
  if (t.landuse === 'commercial' || t.landuse === 'retail' || t.landuse === 'industrial') return 'commercial';
  return null;
};
// paint order: broad classes first, specific ones over them
const ORDER = ['built', 'commercial', 'grass', 'park', 'scrub', 'forest', 'golf', 'wetland', 'pitch', 'parking', 'water'];
const areas = [];
for (const e of ELS) {
  if (e === lakeRel || (e.type !== 'way' && e.type !== 'relation')) continue;
  const cls = coverClass(e.tags);
  if (!cls) continue;
  const rings = areaRings(e);
  if (!rings || !rings.outer.length) continue;
  for (const outer of rings.outer) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of outer) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    areas.push({ cls, outer, inner: rings.inner, box: [x0, y0, x1, y1], id: e.type + '/' + e.id, tags: e.tags });
  }
}
areas.sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls));
log(`cover polygons: ${areas.length}`);
function coverAt(p) {
  if (pointInRing(p, lakeOuter) && !lakeInner.some((r) => pointInRing(p, r))) return 'lake';
  let c = 'land';
  for (const a of areas) {
    const b = a.box;
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    if (pointInRing(p, a.outer) && !a.inner.some((r) => pointInRing(p, r))) c = a.cls;
  }
  return c;
}

/* ------------------------------ lattices ------------------------------ */
const demNear = demSampler(path.join(rawDir, 'terrarium'), TERRAIN.nearZoom);
const demFar = demSampler(path.join(rawDir, 'terrarium'), TERRAIN.zoom);
const demAt = (p) => {
  const [la, lo] = proj.toLatLon(p[0], p[1]);
  const h = demNear(la, lo);
  return Number.isFinite(h) ? h : demFar(la, lo);
};
// lake level: median DEM over the water
const lakeSamples = [];
for (let k = 0; k < 400; k++) {
  const q = [fineBox[0] + ((k * 7919) % 400) / 400 * (fineBox[2] - fineBox[0]), fineBox[1] + ((k * 104729) % 397) / 397 * (fineBox[3] - fineBox[1])];
  if (coverAt(q) === 'lake') lakeSamples.push(demAt(q));
}
lakeSamples.sort((a, b) => a - b);
const LAKE_LEVEL = lakeSamples[Math.floor(lakeSamples.length / 2)];
log(`lake level (DEM median of ${lakeSamples.length} samples): ${LAKE_LEVEL.toFixed(1)} m`);

function latticeCols(dx) { return Math.round(C / dx); }
// cover lattice (RLE, row-major by z then x)
const cv = LATTICE.cover;
const cnx = latticeCols(cv.dx), cnz = Math.round((cv.z1 - cv.z0) / cv.dz) + 1;
const cover = new Uint8Array(cnx * cnz);
let beyondCount = 0, invFail = 0, invErr = 0, invBad = 0;
for (let j = 0; j < cnz; j++) {
  const z = cv.z0 + j * cv.dz;
  for (let i = 0; i < cnx; i++) {
    const x = (i * C) / cnx;
    let cls = 'land';
    if (x <= L_PROM) {
      const r = inverse(x, z);
      if (!r) invFail++;
      else { if (r.beyond) beyondCount++; if (r.err > 1) invBad++; else invErr = Math.max(invErr, r.err); cls = coverAt(r.p); }
    }
    cover[j * cnx + i] = COVER.indexOf(cls);
  }
}
// the join (x > L): blend by copying the nearer end
for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) {
  const x = (i * C) / cnx;
  if (x > L_PROM) {
    const src = x - L_PROM < L_JOIN / 2 ? Math.floor((L_PROM * cnx) / C) : 0;
    cover[j * cnx + i] = cover[j * cnx + src];
  }
}
const rle = [];
for (let k = 0; k < cover.length;) { let n = 1; while (k + n < cover.length && cover[k + n] === cover[k] && n < 255) n++; rle.push(n, cover[k]); k += n; }
log(`cover lattice ${cnx} x ${cnz}: ${rle.length / 2} runs, inverse failures ${invFail}, beyond-disc ${beyondCount}, ${invBad} nodes with Newton residual > 1 m, worst otherwise ${invErr.toFixed(3)} m`);

// DEM lattice (lake side), decimetres relative to the lake level, Int16
const dm = LATTICE.dem;
const dnx = latticeCols(dm.dx), dnz = Math.round((dm.z1 - dm.z0) / dm.dz) + 1;
const dem = new Int16Array(dnx * dnz).fill(-32768);
let demBeyond = 0;
for (let j = 0; j < dnz; j++) {
  const z = dm.z0 + j * dm.dz;
  for (let i = 0; i < dnx; i++) {
    const x = (i * C) / dnx;
    if (x > L_PROM) continue;
    const r = inverse(x, z);
    if (!r) continue;
    if (r.beyond) { demBeyond++; continue; }
    const h = demAt(r.p);
    if (Number.isFinite(h)) dem[j * dnx + i] = Math.max(-32000, Math.min(32000, Math.round((h - LAKE_LEVEL) * 10)));
  }
}
// fill gaps (beyond the disc, the join) from the nearest valid value in the column, then the row
for (let i = 0; i < dnx; i++) {
  let last = -32768;
  for (let j = 0; j < dnz; j++) { const k = j * dnx + i; if (dem[k] !== -32768) last = dem[k]; else if (last !== -32768) dem[k] = last; }
}
for (let j = 0; j < dnz; j++) {
  for (let i = 0; i < dnx; i++) {
    const k = j * dnx + i;
    if (dem[k] !== -32768) continue;
    // nearest valid along the row, wrapping round the loop
    for (let d = 1; d < dnx; d++) {
      const a = j * dnx + ((i + d) % dnx), b = j * dnx + ((i - d + dnx) % dnx);
      if (dem[a] !== -32768) { dem[k] = dem[a]; break; }
      if (dem[b] !== -32768) { dem[k] = dem[b]; break; }
    }
  }
}
log(`DEM lattice ${dnx} x ${dnz}: ${demBeyond} nodes beyond the disc (filled)`);

/* ----------------------------- ridgelines ----------------------------- */
const ridgeViews = RIDGES.at.map((f) => {
  const s = f * L_PROM;
  const p = pointAt(spine, SPS, s);
  const h0 = LAKE_LEVEL + RIDGES.eye;
  const layers = RIDGES.layers.map(() => new Array(360).fill(-90));
  const dists = RIDGES.layers.map(() => new Array(360).fill(0));
  for (let az = 0; az < 360; az++) {
    const dir = [Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180)];
    for (let d = 200; d <= 40000; d += d < 3000 ? 30 : d < 12000 ? 80 : 200) {
      const q = [p[0] + dir[0] * d, p[1] + dir[1] * d];
      const h = demAt(q);
      if (!Number.isFinite(h)) continue;
      const drop = (d * d * (1 - 0.13)) / (2 * 6371000);
      const ang = (Math.atan2(h - drop - h0, d) * 180) / Math.PI;
      RIDGES.layers.forEach((Ly, li) => {
        if (d >= Ly.d0 && d < Ly.d1 && ang > layers[li][az]) { layers[li][az] = ang; dists[li][az] = d; }
      });
    }
  }
  return { s: r1(s), layers: layers.map((a) => a.map(r1)), meanDist: dists.map((a) => Math.round(a.reduce((p, q) => p + q, 0) / a.length)) };
});
log(`ridgelines: ${ridgeViews.length} viewpoints x ${RIDGES.layers.length} layers x 360 az`);

/* --------------------------- spine heading --------------------------- */
// bearing (deg, clockwise from north) of the direction of travel, every 10 m, smoothed over +-25 m
const heading = [];
for (let s = 0; s <= L_PROM + 0.01; s += 10) {
  const a = pointAt(spine, SPS, Math.max(0, s - 25)), b = pointAt(spine, SPS, Math.min(L_PROM, s + 25));
  heading.push(r1(((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360));
}

/* ------------------------------ features ------------------------------ */
const nearS = (p) => nearestOnPolyline(p, spine, SPS);
/* Buildings are re-seated rigidly at runtime (plan §4), so what matters is
 * where the centroid lands and the real footprint: an oriented box (the
 * minimum-area rectangle, to 1°) with its long axis turned into the planet
 * frame.  Buildings near the walk (|z| < 90) also keep their mapped outline. */
function orientedBox(ring) {
  let best = null;
  for (let deg = 0; deg < 90; deg += 1) {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const u = p[0] * ca + p[1] * sa, v = -p[0] * sa + p[1] * ca; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, a, l: u1 - u0, w: v1 - v0, c: [((u0 + u1) / 2) * ca - ((v0 + v1) / 2) * sa, ((u0 + u1) / 2) * sa + ((v0 + v1) / 2) * ca] };
  }
  if (best.w > best.l) { const t = best.l; best.l = best.w; best.w = t; best.a += Math.PI / 2; }
  return best;
}
const buildings = [];
let bSkipped = 0;
for (const e of ELS) {
  if (!e.tags?.building || (e.type !== 'way' && e.type !== 'relation')) continue;
  const rings = areaRings(e);
  if (!rings) continue;
  for (const outer of rings.outer) {
    const area = Math.abs(signedArea(outer));
    if (area < 25) { bSkipped++; continue; }
    const ob = orientedBox(outer);
    const c = toPlanet(ob.c);
    if (!c) { bSkipped++; continue; }
    // the long axis in the planet frame: map a 2 m step along it
    const ax = [Math.cos(ob.a), Math.sin(ob.a)];
    const c2 = toPlanet([ob.c[0] + ax[0] * 2, ob.c[1] + ax[1] * 2], c.side);
    const ang = c2 ? Math.atan2(c2.z - c.z, c2.x - c.x) : 0;
    const lv = parseFloat(e.tags['building:levels']);
    if (Math.abs(c.z) > Z_KEEP) { bSkipped++; continue; }
    const rec = { c: [r1(c.x), r1(c.z)], l: r1(ob.l), w: r1(ob.w), a: r2(ang), k: e.tags.building };
    if (Number.isFinite(lv)) rec.lv = lv;
    if (Math.abs(c.z) < 90) { const m = mapRing(outer, 0.3, 4); if (m) rec.p = rp(m); }
    buildings.push(rec);
  }
}
log(`buildings: ${buildings.length} (${buildings.filter((q) => q.p).length} with mapped outlines near the walk; ${bSkipped} skipped: under 25 m², outside the map or past |z| = ${Z_KEEP})`);

const ROADS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'secondary_link', 'tertiary_link', 'track']);
const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);
const roads = [], paths = [];
for (const e of ELS) {
  if (e.type !== 'way' || !e.tags?.highway || !e.geometry) continue;
  if (PROMENADE_WAYS.includes(e.id)) continue;
  const k = e.tags.highway;
  const target = ROADS.has(k) ? roads : PATHS.has(k) ? paths : null;
  if (!target) continue;
  for (const part of mapLine(wayPts(e), 0.5, 6)) {
    target.push({ k, p: rp(part), ...(e.tags.lanes ? { lanes: +e.tags.lanes } : {}), ...(e.tags.bridge ? { bridge: 1 } : {}) });
  }
}
const waterways = [];
for (const e of ELS) {
  if (e.type !== 'way' || !e.tags?.waterway || !e.geometry || e.tags.waterway === 'dam') continue;
  for (const part of mapLine(wayPts(e), 1, 8)) waterways.push({ k: e.tags.waterway, p: rp(part), ...(e.tags.tunnel ? { tunnel: 1 } : {}) });
}
const areaFeat = (pred, name) => {
  const out = [];
  for (const e of ELS) {
    if (!pred(e)) continue;
    const rings = areaRings(e);
    if (!rings) continue;
    for (const outer of rings.outer) {
      const m = mapRing(outer, 0.5, 5);
      if (m) out.push({ p: rp(m), id: e.type + '/' + e.id, ...(e.tags.sport ? { sport: e.tags.sport } : {}), ...(e.tags.name ? { name: e.tags.name } : {}) });
    }
  }
  log(`${name}: ${out.length}`);
  return out;
};
const parking = areaFeat((e) => e.tags?.amenity === 'parking', 'parking areas');
const pitches = areaFeat((e) => e.tags?.leisure === 'pitch', 'pitches');
const piers = areaFeat((e) => e.tags?.man_made === 'pier', 'piers');
const golf = areaFeat((e) => e.tags?.leisure === 'golf_course', 'golf courses');
const gardens = areaFeat((e) => (e.tags?.leisure === 'park' || e.tags?.leisure === 'garden') && e.tags?.name, 'named parks/gardens');
const trees = ELS.filter((e) => e.type === 'node' && e.tags?.natural === 'tree').map((e) => toPlanet(P(e))).filter(Boolean).map((q) => [r1(q.x), r1(q.z)]);

/* ------------------------------ landmarks ------------------------------ */
/* Real, from OSM.  Business names are dropped (the brief: no real brands);
 * public place names are kept. */
const landmarks = [];
function addLandmark(id, name, kind, p, source, ref, extra = {}) {
  const q = toPlanet(p);
  const ns = nearS(p);
  landmarks.push({ id, name, kind, s: r1(ns.s), dProm: r1(ns.d), x: q ? r1(q.x) : null, z: q ? r1(q.z) : null, real: [r1(p[0]), r1(p[1])], source, ref, ...extra });
}
const el = (ref) => byId.get(ref);
const elCentroid = (e) => (e.type === 'node' ? P(e) : centroid(e.type === 'way' ? wayPts(e) : areaRings(e).outer[0]));
const named = [
  ['garden_of_silence', 'way/360443301', 'garden'],
  ['buddha_statue', 'node/3649893943', 'statue'],
  ['regulator', 'way/1284688290', 'regulator'],
  ['regulator_bridge', 'way/360443306', 'bridge'],
  ['nature_centre', 'node/11918222870', 'information'],
  ['viewpoint_west', 'node/5839948187', 'viewpoint'],
  ['viewpoint_bend', 'node/1846558866', 'viewpoint'],
  ['boating', 'node/3653659880', 'boat_rental'],
  ['golf_club', 'way/129585863', 'golf'],
];
for (const [id, ref, kind] of named) {
  const e = el(ref);
  if (!e) { log(`  landmark ${id}: ${ref} missing`); continue; }
  const nm = { buddha_statue: 'Buddha statue', regulator: 'Regulator (dam spillway)', regulator_bridge: 'Footbridge over the regulator', nature_centre: 'Nature Interpretation Centre', viewpoint_west: 'Sukhna Lake viewpoint', viewpoint_bend: 'Viewpoint', boating: 'Boating', golf_club: 'Chandigarh Golf Club', garden_of_silence: 'Garden of Silence' }[id];
  addLandmark(id, nm, kind, elCentroid(e), 'osm', ref, e.tags?.['name:hi'] ? { hi: e.tags['name:hi'] } : {});
}
// amenities along the walk (within 250 m): toilets, water, shelters, fitness, food court, info, parking
const AMEN = { toilets: 'toilets', drinking_water: 'drinking_water', shelter: 'shelter', food_court: 'food_court', bicycle_parking: 'bicycle_parking', bench: 'bench', waste_basket: 'bin' };
let ai = 0;
for (const e of ELS) {
  const t = e.tags || {};
  const kind = AMEN[t.amenity] || (t.leisure === 'fitness_station' ? 'fitness' : t.tourism === 'information' ? 'information' : null);
  if (!kind) continue;
  const ref = e.type + '/' + e.id;
  if (named.some((n) => n[1] === ref)) continue;
  const p = elCentroid(e);
  if (nearS(p).d > 250) continue;
  addLandmark(`${kind}_${++ai}`, t.name && !t.brand ? t.name : null, kind, p, 'osm', ref);
}
// the entrance plaza: not tagged in OSM; the centroid of the west-end amenities
{
  const west = landmarks.filter((l) => l.s > L_PROM - 250 && ['food_court', 'information', 'toilets', 'drinking_water', 'bicycle_parking', 'viewpoint', 'boat_rental'].includes(l.kind));
  const c = centroid(west.map((l) => l.real));
  addLandmark('entrance_plaza', 'Entrance plaza', 'plaza', c, 'osm-derived', west.map((l) => l.ref).join(' '));
}
// the lake club: the tennis courts cluster north of the west end
{
  const courts = ELS.filter((e) => e.tags?.leisure === 'pitch' && e.tags?.sport === 'tennis').map(elCentroid);
  if (courts.length) addLandmark('lake_club_courts', 'Lake club courts', 'club', centroid(courts), 'osm-derived', 'leisure=pitch sport=tennis');
}
// steps: highway=steps whose top is within 45 m of the walk
const steps = [];
for (const e of ELS) {
  if (e.type !== 'way' || e.tags?.highway !== 'steps' || !e.geometry) continue;
  const pts = wayPts(e);
  const ends = [pts[0], pts[pts.length - 1]].map((p) => ({ p, n: nearS(p) })).sort((a, b) => a.n.d - b.n.d);
  if (ends[0].n.d > 45) continue;
  const top = toPlanet(ends[0].p), bottom = toPlanet(ends[1].p);
  steps.push({ s: r1(ends[0].n.s), top: top && [r1(top.x), r1(top.z)], bottom: bottom && [r1(bottom.x), r1(bottom.z)], side: top && top.side > 0 ? 'lake' : 'city', len: r1(polyLength(pts)), name: e.tags.name || null, ref: 'way/' + e.id });
}
steps.sort((a, b) => a.s - b.s);
log(`landmarks: ${landmarks.length}, steps: ${steps.length}`);

/* ------------------------------ measures ------------------------------ */
// the bund: from the east end to the west bend, where the downstream footways meet the walk
const bendRef = 'way/544678270';
const bendWay = el(bendRef);
// the footway runs the length of the bund; its west end (larger s) is the bend
const bendS = bendWay ? Math.max(...[wayPts(bendWay)[0], wayPts(bendWay).at(-1)].map((p) => nearS(p).s)) : null;
const bundLen = bendS;
let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
for (const p of lakeOuter) { lx0 = Math.min(lx0, p[0]); lx1 = Math.max(lx1, p[0]); ly0 = Math.min(ly0, p[1]); ly1 = Math.max(ly1, p[1]); }
let maxSpan = 0;
for (let i = 0; i < lakeOuter.length; i += 2) for (let j = i + 1; j < lakeOuter.length; j += 2) maxSpan = Math.max(maxSpan, dist(lakeOuter[i], lakeOuter[j]));
// mapped lake area and its share inside 5% / 10% x-compression (cos(z/R))
const shoelaceClip = (ring, zmax) => {
  // area of ring ∩ {z <= zmax}, by scanline sampling (1 m rows)
  let a = 0;
  let zlo = Infinity, zhi = -Infinity;
  for (const p of ring) { zlo = Math.min(zlo, p[1]); zhi = Math.max(zhi, p[1]); }
  for (let z = Math.floor(zlo) + 0.5; z < Math.min(zhi, zmax); z += 1) {
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const A = ring[i], B = ring[j]; if ((A[1] > z) !== (B[1] > z)) xs.push(A[0] + ((z - A[1]) * (B[0] - A[0])) / (B[1] - A[1])); }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) a += (xs[k + 1] - xs[k]) * Math.cos(z / R);
  }
  return a;
};
const mapArea = (zmax) => shoelaceClip(lakeOuterMapped, zmax) - lakeInnerMapped.reduce((s, r) => s + shoelaceClip(r, zmax), 0);
const mappedLakeArea = mapArea(1e9);
const z5 = R * Math.acos(0.95), z10 = R * Math.acos(0.9);
const lakeIn5 = mapArea(z5) / mappedLakeArea, lakeIn10 = mapArea(z10) / mappedLakeArea;
// scale factors along the walk's near field: planet metres per real metre
function scaleAt(s, d) {
  const a = pointAt(spine, SPS, Math.max(0, s - 10)), b = pointAt(spine, SPS, Math.min(L_PROM, s + 10));
  const t = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
  const n = [t[1] * Math.sign(d), -t[0] * Math.sign(d)];
  const p = pointAt(spine, SPS, s), q = [p[0] + n[0] * Math.abs(d), p[1] + n[1] * Math.abs(d)];
  const q2 = [q[0] + t[0] * 2, q[1] + t[1] * 2], q3 = [q[0] + n[0] * 2, q[1] + n[1] * 2];
  const A = toPlanet(q), B = toPlanet(q2), Cc = toPlanet(q3);
  if (!A || !B || !Cc) return null;
  return { sx: Math.hypot(B.x - A.x, B.z - A.z) / 2, sz: Math.hypot(Cc.x - A.x, Cc.z - A.z) / 2, zAt: A.z };
}
const scaleRows = [];
for (const d of [-60, -30, 15, 30, 60]) {
  const v = [];
  for (let s = 100; s < L_PROM - 100; s += 50) { const r = scaleAt(s, d); if (r) v.push(r); }
  const q = (arr, k) => arr.slice().sort((a, b) => a - b)[Math.floor(k * (arr.length - 1))];
  scaleRows.push({ d, sx: [q(v.map((r) => r.sx), 0.05), q(v.map((r) => r.sx), 0.5), q(v.map((r) => r.sx), 0.95)], sz: [q(v.map((r) => r.sz), 0.05), q(v.map((r) => r.sz), 0.5), q(v.map((r) => r.sz), 0.95)] });
}

/* -------------------------------- sun -------------------------------- */
const { y, m, d } = DATE;
const lat = originLL[0], lon = originLL[1];
const sr = crossing(y, m, d, -0.833, true, lat, lon);
const cdawn = crossing(y, m, d, -6, true, lat, lon);
const ss = crossing(y, m, d, -0.833, false, lat, lon);
const srPos = sunPosition(localDate(y, m, d, sr), lat, lon);
const presets = {
  predawn: Math.round((sr - 25 / 60) * 60) / 60,
  sunrise: Math.round(sr * 60) / 60,
  golden: Math.round((sr + 26 / 60) * 60) / 60,
  bright: 9.25,
};
const sun = {
  lat: +lat.toFixed(6), lon: +lon.toFixed(6), tz: 5.5, date: [y, m, d],
  civilDawn: +cdawn.toFixed(4), sunrise: +sr.toFixed(4), sunriseAz: r1(srPos.azimuth), sunset: +ss.toFixed(4),
  presets,
  clock: Object.fromEntries(Object.entries(presets).map(([k, h]) => [k, hhmm(h)])),
};
log(`sun ${y}-${m}-${d}: civil dawn ${hhmm(cdawn)}, sunrise ${hhmm(sr)} at ${srPos.azimuth.toFixed(1)}°, sunset ${hhmm(ss)}; presets ${JSON.stringify(sun.clock)}`);

/* ------------------------------- write ------------------------------- */
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const data = {
  version: 1,
  generated: new Date().toISOString(),
  attribution: '© OpenStreetMap contributors (ODbL 1.0); terrain: Mapzen / AWS Terrain Tiles (SRTM and others)',
  source: { osm: osmFile, osmFetched: osm.__source?.fetched, bbox: BBOX, promenadeWays: PROMENADE_WAYS },
  origin: { lat: +originLL[0].toFixed(7), lon: +originLL[1].toFixed(7) },
  planet: { L: r2(L_PROM), join: L_JOIN, C: r2(C), R: +R.toFixed(3) },
  map: { A: +comp.A.toFixed(3), farShoreZ: MAP.farShoreZ, farShoreU: Math.round(uMed), Rb: MAP.Rb, note: 'x = arc length east->west; z = +-f(u), f identity to 60 m then 60 + A ln(1 + (u-60)/A); lake at +z' },
  lakeLevel: r1(LAKE_LEVEL),
  sun,
  spine: { step: 10, heading },
  lake: { outer: rp(lakeOuterMapped), inner: lakeInnerMapped.map(rp) },
  cover: { classes: COVER, x0: 0, dx: C / cnx, nx: cnx, z0: cv.z0, dz: cv.dz, nz: cnz, rle: Buffer.from(Uint8Array.from(rle)).toString('base64') },
  dem: { x0: 0, dx: C / dnx, nx: dnx, z0: dm.z0, dz: dm.dz, nz: dnz, unit: 0.1, ref: 'lake level', data: b64(dem) },
  ridges: { layers: RIDGES.layers, eye: RIDGES.eye, views: ridgeViews },
  landmarks,
  steps,
  features: { buildings, roads, paths, waterways, parking, pitches, piers, golf, gardens, trees },
  measures: {
    promenadeLength: r2(L_PROM), bundLength: bundLen && r1(bundLen), westBendS: bendS && r1(bendS),
    lakeArea: Math.round(lakeArea), lakePerimeter: Math.round(lakePerim), lakeExtentEN: [Math.round(lx1 - lx0), Math.round(ly1 - ly0)], lakeMaxSpan: Math.round(maxSpan),
    lakeIslands: lakeInner.length, mappedLakeArea: Math.round(mappedLakeArea), lakeIn5: +lakeIn5.toFixed(3), lakeIn10: +lakeIn10.toFixed(3),
    fold,
  },
};
const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
const dataJson = JSON.stringify(data);
fs.writeFileSync(path.join(outDir, 'sukhna.data.json'), dataJson);

/* ------------------------- ?flat=1 debug data ------------------------- */
const rr = (pts) => pts.map(([a, b]) => [r1(a), r1(b)]);
const isoX = [], isoU = [];
for (let X = 0; X <= L_PROM + 0.1; X += 250) {
  for (const sg of [1, -1]) {
    const line = [];
    for (let z = 0; z <= Z_KEEP; z += 4) { const r = inverse(Math.min(X, L_PROM), sg * z); if (r && !r.beyond) line.push(r.p); }
    if (line.length > 1) isoX.push({ x: r1(X), side: sg, real: rr(simplify(line, 1)) });
  }
}
for (const z of [-250, -150, -60, -20, 20, 60, 120, 170, 220, 300]) {
  const line = [];
  for (let X = 0; X <= L_PROM; X += 10) { const r = inverse(X, z); if (r && !r.beyond) line.push(r.p); }
  if (line.length > 1) isoU.push({ z, real: rr(simplify(line, 1)) });
}
const flat = {
  spine: rr(spine),
  lake: { outer: rr(lakeOuter), inner: lakeInner.map(rr) },
  areas: areas.filter((a) => a.box[2] - a.box[0] < 20000).map((a) => ({ c: a.cls, p: rr(simplifyRing(a.outer, 2)) })),
  buildings: buildings.map((b) => { const e = el(b.id); const r = e && areaRings(e); return r && r.outer[0] ? rr(simplifyRing(r.outer[0], 1)) : null; }).filter(Boolean),
  roads: ELS.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry).map((e) => ({ k: e.tags.highway, p: rr(simplify(wayPts(e), 1.5)) })),
  isoX, isoU,
  cut: { AE: rr([st.AE])[0], AW: rr([st.AW])[0], E: rr([st.E])[0], W: rr([st.W])[0] },
};
fs.writeFileSync(path.join(outDir, 'sukhna.flat.json'), JSON.stringify(flat));

/* ------------------------------ debug PNGs ------------------------------ */
const dbg = path.join(here, 'debug');
fs.mkdirSync(dbg, { recursive: true });
const COL = { land: [238, 236, 226], lake: [120, 160, 200], water: [140, 180, 215], forest: [70, 120, 70], scrub: [150, 170, 110], park: [150, 200, 130], golf: [180, 215, 140], built: [215, 205, 195], parking: [190, 190, 200], pitch: [200, 170, 140], wetland: [120, 170, 160], commercial: [220, 190, 190], grass: [170, 210, 150] };
{
  const img = new Raster(cnx, cnz);
  for (let j = 0; j < cnz; j++) for (let i = 0; i < cnx; i++) img.set(i, cnz - 1 - j, COL[COVER[cover[j * cnx + i]]]);
  const T = ([x, z]) => [(x / C) * cnx, cnz - 1 - (z - cv.z0) / cv.dz];
  img.poly(lakeOuterMapped.map(T), [20, 40, 90], true);
  for (const b of buildings) { if (b.p) img.poly(b.p.map(T), [120, 60, 60], true); else img.dot(...T(b.c), 0, [120, 60, 60]); }
  for (const r of roads) img.poly(r.p.map(T), [90, 90, 90]);
  img.line(0, T([0, 0])[1], cnx, T([0, 0])[1], [230, 120, 0]);
  for (const l of landmarks) if (l.x != null) img.dot(...T([l.x, l.z]), 2, [200, 0, 120]);
  fs.writeFileSync(path.join(dbg, 'planet-cover.png'), img.png());
}

/* ------------------------------- report ------------------------------- */
const fmtS = (l) => `| ${l.name || l.kind} | ${l.kind} | ${l.s.toFixed(0)} | ${l.dProm.toFixed(0)} | ${l.x == null ? '—' : `${l.x.toFixed(0)}, ${l.z.toFixed(0)}`} | ${l.source} \`${l.ref}\` |`;
const key = landmarks.filter((l) => ['garden', 'statue', 'regulator', 'bridge', 'viewpoint', 'boat_rental', 'plaza', 'club', 'golf', 'information'].includes(l.kind)).sort((a, b) => a.s - b.s);
let gaps = '';
for (let i = 1; i < key.length; i++) gaps += `${key[i - 1].name || key[i - 1].kind} → ${key[i].name || key[i].kind}: ${(key[i].s - key[i - 1].s).toFixed(0)} m; `;
const report = `# Sukhna data report

Generated by \`node scripts/sukhna/build-data.mjs\` on ${data.generated}.
OSM: \`${osmFile}\` (fetched ${osm.__source?.fetched || '?'} from ${osm.__source?.url || '?'}), © OpenStreetMap contributors, ODbL 1.0.
Terrain: Mapzen / AWS Terrain Tiles (Terrarium), z${TERRAIN.nearZoom} near the lake and z${TERRAIN.zoom} for the ridges.

## Planet

| | |
|---|---|
| Promenade (OSM \`way/${PROMENADE_WAYS.join(', ')}\`) | **${L_PROM.toFixed(2)} m** |
| Join (stylised) | ${L_JOIN} m, at x = ${L_PROM.toFixed(1)} … ${C.toFixed(1)} (between the boat-club end and the Garden of Silence end) |
| Circumference C | ${C.toFixed(2)} m |
| **Radius R** | **${R.toFixed(2)} m** |
| Direction | x = arc length from the east end (Garden of Silence, regulator bridge) westward to the boat club; the lake is at +z |
| Origin (ENU) | promenade midpoint, ${originLL[0].toFixed(6)} N, ${originLL[1].toFixed(6)} E |
| Lake level (DEM median) | ${LAKE_LEVEL.toFixed(1)} m |

## Real measurements

| | |
|---|---|
| Bund (east end → west bend, where the downstream footways \`${bendRef}\` meet the walk) | ${bundLen ? bundLen.toFixed(0) + ' m' : '?'} |
| West-shore stretch (bend → boat-club end) | ${bundLen ? (L_PROM - bundLen).toFixed(0) + ' m' : '?'} |
| Lake area (outer ring minus ${lakeInner.length} islands) | ${(lakeArea / 1e6).toFixed(3)} km² |
| Lake perimeter | ${(lakePerim / 1000).toFixed(2)} km |
| Lake extent (E × N) / longest span | ${Math.round(lx1 - lx0)} × ${Math.round(ly1 - ly0)} m / ${Math.round(maxSpan)} m |
| Far-shore median harmonic distance | ${uMed.toFixed(0)} m → z = ${MAP.farShoreZ} |

**Landmarks along the walk** (s = arc length from the east end; d = distance from the walk; x, z = planet):

| Landmark | Kind | s (m) | d (m) | x, z | Source |
|---|---|---|---|---|---|
${key.map(fmtS).join('\n')}

Consecutive distances: ${gaps}

**Steps off the walk** (OSM \`highway=steps\` within 45 m): ${steps.map((s) => `s = ${s.s.toFixed(0)} (${s.side}${s.name ? ', ' + s.name : ''}, ${s.len.toFixed(0)} m long)`).join('; ')}.
All of them go down the **downstream (city) face** to the parking lots; OSM maps no steps to the water.

## The mapping

Harmonic straightening (see \`lib/straighten.mjs\`), disc radius ${MAP.Rb} m, grids ${MAP.levels.join(' → ')} m.
z = ±f(u), f(u) = u to 60 m, then 60 + A ln(1 + (u − 60)/A), **A = ${comp.A.toFixed(2)}**.

- **Fold check: ${fold.tris} triangles (every grid cell with Ψ < ${P_MAX}, i.e. everything the map is used for), ${fold.bad} inverted.** ${fold.bad ? '**FAILED**' : 'Passed.'}
- Inverse map over the cover lattice (${cnx * cnz} nodes): ${invFail} failures; ${invBad} nodes with a Newton residual over 1 m (the extrapolated corner beyond the east end, |z| > 300 on the city side); worst residual elsewhere ${invErr.toFixed(3)} m.
- Mapped lake area ${(mappedLakeArea / 1e6).toFixed(3)} km² (planet), against ${(lakeArea / 1e6).toFixed(3)} km² real.
- Lake area inside 5% x-compression (z ≤ ${z5.toFixed(0)} m): **${(lakeIn5 * 100).toFixed(0)}%**; inside 10% (z ≤ ${z10.toFixed(0)} m): **${(lakeIn10 * 100).toFixed(0)}%**.

Near-field scale factors (planet metres per real metre, 5th / 50th / 95th percentile along the walk):

| d (real, + lake) | along x | across z |
|---|---|---|
${scaleRows.map((r) => `| ${r.d} m | ${r.sx.map((v) => v.toFixed(3)).join(' / ')} | ${r.sz.map((v) => v.toFixed(3)).join(' / ')} |`).join('\n')}

## Sun (${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}, IST)

Civil dawn ${hhmm(cdawn)} · sunrise **${hhmm(sr)}** at azimuth **${srPos.azimuth.toFixed(1)}°** · sunset ${hhmm(ss)}.
T presets: pre-dawn ${sun.clock.predawn}, sunrise ${sun.clock.sunrise}, golden hour ${sun.clock.golden}, bright ${sun.clock.bright}.

## Output

- \`src/data/sukhna.data.json\`: ${(dataJson.length / 1024).toFixed(0)} KB (${buildings.length} buildings, ${roads.length} road and ${paths.length} path pieces, ${landmarks.length} landmarks, cover ${cnx}×${cnz} in ${rle.length / 2} runs, DEM ${dnx}×${dnz}).
- \`src/data/sukhna.flat.json\`: ${(JSON.stringify(flat).length / 1024).toFixed(0)} KB (debug, loaded only by \`?flat=1\`).
- Built in ${((Date.now() - t0) / 1000).toFixed(1)} s.
`;
fs.writeFileSync(path.join(here, 'report.md'), report);
log(`wrote sukhna.data.json (${(dataJson.length / 1024).toFixed(0)} KB), sukhna.flat.json, report.md in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
