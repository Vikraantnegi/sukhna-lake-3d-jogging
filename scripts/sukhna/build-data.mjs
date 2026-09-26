/* ------------------------------------------------------------------ *
 * Build the flat world's data from the raw OSM and terrain.
 *
 *   node scripts/sukhna/build-data.mjs
 *
 * Reads scripts/sukhna/raw/* only (run fetch-osm.mjs and
 * fetch-terrain.mjs first).  Writes:
 *   src/data/sukhna.data.json     vectors in ENU metres (runtime)
 *   src/data/sukhna.terrain.json  height and cover grids (runtime)
 *   scripts/sukhna/report.md      measurements and checks
 *   scripts/sukhna/debug/*.png    a picture of the data (git-ignored)
 *
 * Every coordinate is [east, north] in metres about the origin (the
 * promenade midpoint); heights are metres above the lake level.  The
 * runtime maps ENU to three.js as x = east, z = -north, y = up.
 * OSM data © OpenStreetMap contributors, ODbL 1.0.
 * ------------------------------------------------------------------ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, TERRAIN, PROMENADE_WAYS, GRIDS, KEEP, RIDGES, SPINE_STEP, DATE } from './config.mjs';
import {
  enuProjector, arcLengths, pointAt, nearestOnPolyline, simplify, simplifyRing, signedArea,
  pointInRing, centroid, stitchRings, polyLength, dist,
} from './lib/geo.mjs';
import { demSampler } from './lib/terrarium.mjs';
import { Raster } from './lib/pngenc.mjs';
import { sunPosition, localDate, crossing, hhmm } from '../../src/core/sun.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const t0 = Date.now();
const log = (...a) => console.log(...a);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const rp = (pts) => pts.map(([a, b]) => [r1(a), r1(b)]);
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); log(`  check ${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); };

/* ------------------------------- load ------------------------------- */
const rawDir = path.join(here, 'raw');
const osmFile = fs.readdirSync(rawDir).filter((f) => f.startsWith(`osm-${BBOX.join('_')}-`)).sort().pop();
if (!osmFile) throw new Error('no raw OSM file: run node scripts/sukhna/fetch-osm.mjs');
const osm = JSON.parse(fs.readFileSync(path.join(rawDir, osmFile), 'utf8'));
const ELS = osm.elements;
const byId = new Map(ELS.map((e) => [e.type + '/' + e.id, e]));
log(`OSM: ${osmFile}, ${ELS.length} elements`);

/* ------------------------ promenade and origin ------------------------ */
const lakeRel = ELS.find((e) => e.type === 'relation' && e.tags?.water === 'lake' && /Sukhna/.test(e.tags?.name || ''));
const promGeo = PROMENADE_WAYS.flatMap((id, i) => {
  const w = byId.get('way/' + id);
  if (!w) throw new Error(`promenade way/${id} missing from the OSM data`);
  return i ? w.geometry.slice(1) : w.geometry;
});
let spineLL = promGeo.map((g) => [g.lat, g.lon]);
{
  // s runs from the east end (Garden of Silence) to the west end (boat club):
  // with the lake to the north of the bund, that is the lake on the right
  const tmp = enuProjector(spineLL[0][0], spineLL[0][1]);
  const sp = spineLL.map(([la, lo]) => tmp.toENU(la, lo));
  const lc = centroid(lakeRel.members.find((m) => m.role === 'outer').geometry.map((g) => tmp.toENU(g.lat, g.lon)));
  const S = arcLengths(sp), L = S[S.length - 1];
  const a = pointAt(sp, S, L / 2), b = pointAt(sp, S, L / 2 + 1);
  const right = [b[1] - a[1], -(b[0] - a[0])];
  if ((lc[0] - a[0]) * right[0] + (lc[1] - a[1]) * right[1] < 0) spineLL.reverse();
}
const originLL = (() => {
  const tmp = enuProjector(spineLL[0][0], spineLL[0][1]);
  const sp = spineLL.map(([la, lo]) => tmp.toENU(la, lo));
  const S = arcLengths(sp);
  return tmp.toLatLon(...pointAt(sp, S, S[S.length - 1] / 2));
})();
const proj = enuProjector(originLL[0], originLL[1]);
const P = (g) => proj.toENU(g.lat, g.lon);
const spineRaw = spineLL.map(([la, lo]) => proj.toENU(la, lo));
const L_OSM = polyLength(spineRaw);

/* The smoothed centreline: a centripetal Catmull-Rom spline through the OSM
 * nodes (it passes through every node, so the walk never leaves the mapped
 * line), resampled every SPINE_STEP metres of arc length. */
function catmullRom(pts, perSeg = 24) {
  const out = [];
  const ext = [[2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]], ...pts, [2 * pts.at(-1)[0] - pts.at(-2)[0], 2 * pts.at(-1)[1] - pts.at(-2)[1]]];
  const tj = (ti, a, b) => ti + Math.sqrt(dist(a, b)) + 1e-9;
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
    for (let k = 0; k < perSeg; k++) {
      const t = t1 + ((t2 - t1) * k) / perSeg;
      const lerp = (a, b, ta, tb) => [(a[0] * (tb - t) + b[0] * (t - ta)) / (tb - ta), (a[1] * (tb - t) + b[1] * (t - ta)) / (tb - ta)];
      const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
      out.push(lerp(B1, B2, t1, t2));
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}
const dense = catmullRom(spineRaw);
const denseS = arcLengths(dense);
const L = denseS[denseS.length - 1];
const spine = [];
for (let s = 0; s < L; s += SPINE_STEP) spine.push(pointAt(dense, denseS, s));
spine.push(dense[dense.length - 1]);
const SPS = arcLengths(spine);
let maxDev = 0;
for (const p of spine) maxDev = Math.max(maxDev, nearestOnPolyline(p, spineRaw).d);
log(`promenade: OSM ${spineRaw.length} nodes, ${L_OSM.toFixed(2)} m; smoothed ${L.toFixed(2)} m (${spine.length} pts, max lateral offset ${maxDev.toFixed(2)} m)`);
check('smoothed walk length within 1 m of OSM', Math.abs(L - L_OSM) < 1, `${(L - L_OSM).toFixed(2)} m`);
const nearS = (p) => nearestOnPolyline(p, spine, SPS);

/* ------------------------------ areas ------------------------------ */
const wayPts = (w) => (w.geometry || []).filter(Boolean).map(P);
const isClosed = (pts) => pts.length > 3 && dist(pts[0], pts[pts.length - 1]) < 0.01;
function areaRings(e) {
  if (e.type === 'way') { const p = wayPts(e); return isClosed(p) ? { outer: [p.slice(0, -1)], inner: [] } : null; }
  if (e.type === 'relation' && e.members) {
    const get = (role) => stitchRings(e.members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry.filter(Boolean).map(P)))
      .filter(isClosed).map((r) => r.slice(0, -1));
    return { outer: get('outer'), inner: get('inner') };
  }
  return null;
}
const lakeRings = areaRings(lakeRel);
const lakeOuter = lakeRings.outer.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
const lakeInner = lakeRings.inner;
const lakeArea = Math.abs(signedArea(lakeOuter)) - lakeInner.reduce((a, r) => a + Math.abs(signedArea(r)), 0);
const lakePerim = polyLength([...lakeOuter, lakeOuter[0]]);
const inLake = (p) => pointInRing(p, lakeOuter) && !lakeInner.some((r) => pointInRing(p, r));
{
  // simple polygon: no two non-adjacent edges cross
  const ring = lakeOuter, n = ring.length;
  let crossings = 0;
  const segX = (a, b, c, d) => {
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segX(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) crossings++;
  }
  check('lake outline is a simple closed polygon', crossings === 0, `${n} vertices, ${crossings} self-crossings, ${lakeInner.length} islands`);
}
{
  let wet = 0;
  for (let s = 0; s <= L; s += 2) if (inLake(pointAt(spine, SPS, s))) wet++;
  check('the walk centreline never enters the lake polygon', wet === 0, `${wet} of ${Math.floor(L / 2) + 1} samples inside`);
}

/* --------------------------- the grids --------------------------- */
let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
for (const p of [...lakeOuter, ...spine]) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
const NG = GRIDS.near;
const snap = (v, s, up) => (up ? Math.ceil(v / s) : Math.floor(v / s)) * s;
const nearRect = [snap(bx0 - NG.margin, 100, false), snap(by0 - NG.margin, 100, false), snap(bx1 + NG.margin, 100, true), snap(by1 + NG.margin, 100, true)];
const HG = GRIDS.hills;

const demSets = Object.fromEntries(TERRAIN.sets.map((s) => [s.name, demSampler(path.join(rawDir, 'terrarium'), s.zoom)]));
const demAt = (p, prefer = ['near', 'hills', 'ridges']) => {
  const [la, lo] = proj.toLatLon(p[0], p[1]);
  for (const k of prefer) { const h = demSets[k](la, lo); if (Number.isFinite(h)) return h; }
  return NaN;
};

// lake level: median DEM over the water
const lakeSamples = [];
for (let y = by0; y <= by1; y += 25) for (let x = bx0; x <= bx1; x += 25) if (inLake([x, y])) lakeSamples.push(demAt([x, y]));
lakeSamples.sort((a, b) => a - b);
const LAKE_LEVEL = lakeSamples[Math.floor(lakeSamples.length / 2)];
log(`lake level: ${LAKE_LEVEL.toFixed(1)} m (DEM median of ${lakeSamples.length} samples)`);

function sampleGrid(rect, step, prefer) {
  const nx = Math.round((rect[2] - rect[0]) / step) + 1, ny = Math.round((rect[3] - rect[1]) / step) + 1;
  const h = new Int16Array(nx * ny);
  let lo = Infinity, hi = -Infinity, missing = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let v = demAt([rect[0] + i * step, rect[1] + j * step], prefer);
    if (!Number.isFinite(v)) { missing++; v = LAKE_LEVEL; }
    const d = v - LAKE_LEVEL;
    lo = Math.min(lo, d); hi = Math.max(hi, d);
    h[j * nx + i] = Math.max(-32000, Math.min(32000, Math.round(d * 10)));
  }
  return { rect, step, nx, ny, h, lo, hi, missing };
}
const near = sampleGrid(nearRect, NG.step, ['near', 'hills', 'ridges']);
const hills = sampleGrid(HG.rect, HG.step, ['hills', 'ridges']);
log(`near grid ${near.nx}x${near.ny} @ ${near.step} m over [${nearRect.join(', ')}]: ${near.lo.toFixed(1)} .. ${near.hi.toFixed(1)} m, ${near.missing} missing`);
log(`hill grid ${hills.nx}x${hills.ny} @ ${hills.step} m: ${hills.lo.toFixed(1)} .. ${hills.hi.toFixed(1)} m, ${hills.missing} missing`);

/* ------------------------------ cover ------------------------------ */
const COVER = ['land', 'lake', 'water', 'forest', 'scrub', 'park', 'golf', 'built', 'parking', 'pitch', 'wetland', 'commercial', 'grass'];
const coverClass = (t) => {
  if (!t) return null;
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') return 'water';
  if (t.natural === 'wood' || t.landuse === 'forest') return 'forest';
  if (t.natural === 'scrub' || t.natural === 'heath' || t.natural === 'grassland') return 'scrub';
  if (t.natural === 'wetland') return 'wetland';
  if (t.leisure === 'golf_course' || ['fairway', 'green', 'rough', 'tee'].includes(t.golf)) return 'golf';
  if (['park', 'garden', 'nature_reserve', 'common'].includes(t.leisure) || t.landuse === 'recreation_ground') return 'park';
  if (['grass', 'meadow', 'village_green'].includes(t.landuse)) return 'grass';
  if (t.amenity === 'parking') return 'parking';
  if (['pitch', 'track', 'playground'].includes(t.leisure)) return 'pitch';
  if (['residential', 'institutional', 'education'].includes(t.landuse)) return 'built';
  if (['commercial', 'retail', 'industrial'].includes(t.landuse)) return 'commercial';
  return null;
};
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
    if (x1 < nearRect[0] || x0 > nearRect[2] || y1 < nearRect[1] || y0 > nearRect[3]) continue;
    areas.push({ cls, outer, inner: rings.inner, box: [x0, y0, x1, y1], ref: e.type + '/' + e.id, name: e.tags.name });
  }
}
areas.sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls));
function coverAt(p) {
  if (inLake(p)) return 'lake';
  let c = 'land';
  for (const a of areas) {
    const b = a.box;
    if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
    if (pointInRing(p, a.outer) && !a.inner.some((r) => pointInRing(p, r))) c = a.cls;
  }
  return c;
}
const CG = GRIDS.cover;
const cnx = Math.round((nearRect[2] - nearRect[0]) / CG.step), cny = Math.round((nearRect[3] - nearRect[1]) / CG.step);
const cover = new Uint8Array(cnx * cny);
const coverCount = {};
for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
  const c = coverAt([nearRect[0] + (i + 0.5) * CG.step, nearRect[1] + (j + 0.5) * CG.step]);
  cover[j * cnx + i] = COVER.indexOf(c);
  coverCount[c] = (coverCount[c] || 0) + 1;
}
const rle = [];
for (let k = 0; k < cover.length;) { let n = 1; while (k + n < cover.length && cover[k + n] === cover[k] && n < 255) n++; rle.push(n, cover[k]); k += n; }
log(`cover grid ${cnx}x${cny} @ ${CG.step} m: ${rle.length / 2} runs; ${Object.entries(coverCount).map(([k, v]) => `${k} ${((v * CG.step * CG.step) / 1e6).toFixed(2)} km²`).join(', ')}`);

/* ----------------------------- ridgelines ----------------------------- */
/* Only what lies beyond the hill grid: along each azimuth the ray starts
 * where it leaves the grid's rectangle, so nearer hills stay real terrain. */
function exitDist(p, dir, rect) {
  let t = Infinity;
  if (dir[0] > 0) t = Math.min(t, (rect[2] - p[0]) / dir[0]); else if (dir[0] < 0) t = Math.min(t, (rect[0] - p[0]) / dir[0]);
  if (dir[1] > 0) t = Math.min(t, (rect[3] - p[1]) / dir[1]); else if (dir[1] < 0) t = Math.min(t, (rect[1] - p[1]) / dir[1]);
  return Math.max(0, t);
}
const ridgeViews = RIDGES.at.map((f) => {
  const s = f * L, p = pointAt(spine, SPS, s), h0 = RIDGES.eye;
  const ang = new Array(360), far = new Array(360);
  for (let az = 0; az < 360; az++) {
    const dir = [Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180)];
    let best = -90, bestD = 0;
    for (let d = exitDist(p, dir, HG.rect); d <= RIDGES.maxDist; d += 150) {
      const h = demAt([p[0] + dir[0] * d, p[1] + dir[1] * d], ['ridges']);
      if (!Number.isFinite(h)) continue;
      const drop = (d * d * (1 - 0.13)) / (2 * 6371000); // earth curvature less refraction
      const a = (Math.atan2(h - LAKE_LEVEL - drop - h0, d) * 180) / Math.PI;
      if (a > best) { best = a; bestD = d; }
    }
    ang[az] = r2(best); far[az] = Math.round(bestD / 100) / 10;
  }
  return { s: r1(s), at: rp([p])[0], angle: ang, km: far };
});
{
  const v = ridgeViews[1];
  const top = v.angle.map((a, i) => [a, i]).sort((a, b) => b[0] - a[0])[0];
  log(`far ridges: highest ${top[0]}° at azimuth ${top[1]}° (${v.km[top[1]]} km) from mid-walk`);
}

/* ------------------------------ features ------------------------------ */
const distWalk = (p) => nearS(p).d;
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
for (const e of ELS) {
  if (!e.tags?.building || (e.type !== 'way' && e.type !== 'relation')) continue;
  const rings = areaRings(e);
  if (!rings) continue;
  for (const outer of rings.outer) {
    if (Math.abs(signedArea(outer)) < 25) continue;
    const ob = orientedBox(outer);
    const d = distWalk(ob.c);
    if (d > KEEP.building) continue;
    const lv = parseFloat(e.tags['building:levels']);
    // a: angle of the long axis, radians anticlockwise from east (ENU)
    const rec = { c: rp([ob.c])[0], l: r1(ob.l), w: r1(ob.w), a: r2(ob.a % Math.PI), k: e.tags.building };
    if (Number.isFinite(lv)) rec.lv = lv;
    if (d < KEEP.buildingOutline) rec.p = rp(simplifyRing(outer, 0.3));
    buildings.push(rec);
  }
}
const ROADS = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'secondary_link', 'tertiary_link', 'track']);
const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);
const roads = [], paths = [];
for (const e of ELS) {
  if (e.type !== 'way' || !e.tags?.highway || !e.geometry || PROMENADE_WAYS.includes(e.id)) continue;
  const k = e.tags.highway;
  const target = ROADS.has(k) ? roads : PATHS.has(k) ? paths : null;
  if (!target) continue;
  const pts = wayPts(e);
  if (Math.min(...pts.map(distWalk)) > KEEP.road) continue;
  target.push({ k, p: rp(simplify(pts, 0.5)), ...(e.tags.lanes ? { lanes: +e.tags.lanes } : {}), ...(e.tags.bridge ? { bridge: 1 } : {}), ...(e.tags.surface ? { surf: e.tags.surface } : {}), ...(e.tags.name && !e.tags.brand ? { name: e.tags.name } : {}) });
}
const waterways = ELS.filter((e) => e.type === 'way' && e.tags?.waterway && e.tags.waterway !== 'dam' && e.geometry)
  .map((e) => ({ k: e.tags.waterway, p: rp(simplify(wayPts(e), 1)), ...(e.tags.tunnel ? { tunnel: 1 } : {}) }));
const polyFeat = (pred, tol = 0.5) => {
  const out = [];
  for (const e of ELS) {
    if (!pred(e)) continue;
    const rings = areaRings(e);
    if (!rings) continue;
    for (const outer of rings.outer) out.push({ p: rp(simplifyRing(outer, tol)), ref: e.type + '/' + e.id, ...(e.tags.sport ? { sport: e.tags.sport } : {}), ...(e.tags.name ? { name: e.tags.name } : {}) });
  }
  return out;
};
const parking = polyFeat((e) => e.tags?.amenity === 'parking');
const pitches = polyFeat((e) => e.tags?.leisure === 'pitch');
const piers = polyFeat((e) => e.tags?.man_made === 'pier', 0.2);
const golf = polyFeat((e) => e.tags?.leisure === 'golf_course', 1);
const gardens = polyFeat((e) => ['park', 'garden'].includes(e.tags?.leisure) && e.tags?.name, 1);
const ponds = polyFeat((e) => e !== lakeRel && (e.tags?.natural === 'water' || e.tags?.water), 0.5);
const landuse = areas.filter((a) => ['forest', 'scrub', 'park', 'golf', 'grass', 'wetland', 'built', 'commercial'].includes(a.cls)).map((a) => {
  const d = Math.min(distWalk(centroid(a.outer)), ...a.outer.filter((_, i) => i % 5 === 0).map(distWalk));
  const tol = d < 200 ? 0.5 : d < 1500 ? 2 : 5;
  return { c: a.cls, p: rp(simplifyRing(a.outer, tol)), ...(a.inner.length ? { holes: a.inner.map((r) => rp(simplifyRing(r, tol))) } : {}), ...(a.name ? { name: a.name } : {}) };
});
const trees = ELS.filter((e) => e.type === 'node' && e.tags?.natural === 'tree').map((e) => rp([P(e)])[0]);
log(`features: ${buildings.length} buildings (${buildings.filter((b) => b.p).length} with outlines), ${roads.length} roads, ${paths.length} paths, ${landuse.length} landuse, ${parking.length} parking, ${pitches.length} pitches, ${piers.length} piers, ${ponds.length} ponds`);

/* ------------------------------ landmarks ------------------------------ */
/* Real, from OSM.  Business names are dropped (the brief: no real brands);
 * public place names are kept. */
const landmarks = [];
const el = (ref) => byId.get(ref);
const elCentroid = (e) => (e.type === 'node' ? P(e) : centroid(e.type === 'way' ? wayPts(e) : areaRings(e).outer[0]));
function sideOf(p, s) {
  const a = pointAt(spine, SPS, Math.max(0, s - 2)), b = pointAt(spine, SPS, Math.min(L, s + 2));
  const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  return cr < 0 ? 'lake' : 'city'; // the lake is to the right of the direction of travel
}
function addLandmark(id, name, kind, p, source, ref, extra = {}) {
  const n = nearS(p);
  landmarks.push({ id, name, kind, at: rp([p])[0], s: r1(n.s), d: r1(n.d), side: sideOf(p, n.s), source, ref, ...extra });
}
const NAMED = [
  ['garden_of_silence', 'way/360443301', 'garden', 'Garden of Silence'],
  ['buddha_statue', 'node/3649893943', 'statue', 'Buddha statue'],
  ['regulator', 'way/1284688290', 'regulator', 'Regulator (dam spillway)'],
  ['regulator_bridge', 'way/360443306', 'bridge', 'Footbridge over the regulator'],
  ['nature_centre', 'node/11918222870', 'information', 'Nature Interpretation Centre'],
  ['viewpoint_west', 'node/5839948187', 'viewpoint', 'Sukhna Lake viewpoint'],
  ['viewpoint_bend', 'node/1846558866', 'viewpoint', 'Viewpoint'],
  ['boating', 'node/3653659880', 'boat_rental', 'Boating'],
  ['golf_club', 'way/129585863', 'golf', 'Chandigarh Golf Club'],
];
for (const [id, ref, kind, name] of NAMED) {
  const e = el(ref);
  if (!e) { log(`  landmark ${id}: ${ref} missing`); continue; }
  addLandmark(id, name, kind, elCentroid(e), 'osm', ref, e.tags?.['name:hi'] ? { hi: e.tags['name:hi'] } : {});
}
const AMEN = { toilets: 'toilets', drinking_water: 'drinking_water', shelter: 'shelter', food_court: 'food_court', bicycle_parking: 'bicycle_parking', bench: 'bench', waste_basket: 'bin' };
let ai = 0;
for (const e of ELS) {
  const t = e.tags || {};
  const kind = AMEN[t.amenity] || (t.leisure === 'fitness_station' ? 'fitness' : t.tourism === 'information' ? 'information' : null);
  if (!kind) continue;
  const ref = e.type + '/' + e.id;
  if (NAMED.some((n) => n[1] === ref)) continue;
  const p = elCentroid(e);
  if (distWalk(p) > 250) continue;
  addLandmark(`${kind}_${++ai}`, t.name && !t.brand ? t.name : null, kind, p, 'osm', ref);
}
{
  // the entrance plaza is not tagged in OSM: the centroid of the west-end amenities
  const west = landmarks.filter((l) => l.s > L - 250 && ['food_court', 'information', 'toilets', 'drinking_water', 'bicycle_parking', 'viewpoint', 'boat_rental'].includes(l.kind));
  addLandmark('entrance_plaza', 'Entrance plaza', 'plaza', centroid(west.map((l) => l.at)), 'osm-derived', west.map((l) => l.ref).join(' '));
  const courts = ELS.filter((e) => e.tags?.leisure === 'pitch' && e.tags?.sport === 'tennis').map(elCentroid);
  if (courts.length) addLandmark('lake_club_courts', 'Lake club courts', 'club', centroid(courts), 'osm-derived', 'leisure=pitch sport=tennis');
}
const steps = [];
for (const e of ELS) {
  if (e.type !== 'way' || e.tags?.highway !== 'steps' || !e.geometry) continue;
  const pts = wayPts(e);
  const ends = [pts[0], pts[pts.length - 1]].map((p) => ({ p, n: nearS(p) })).sort((a, b) => a.n.d - b.n.d);
  if (ends[0].n.d > 45) continue;
  steps.push({ s: r1(ends[0].n.s), top: rp([ends[0].p])[0], bottom: rp([ends[1].p])[0], len: r1(polyLength(pts)), name: e.tags.name || null, ref: 'way/' + e.id, side: sideOf(ends[1].p, ends[1].n.s) });
}
steps.sort((a, b) => a.s - b.s);
landmarks.sort((a, b) => a.s - b.s);

/* ------------------------------ measures ------------------------------ */
const bendWay = el('way/544678270');
const bendS = bendWay ? Math.max(...[wayPts(bendWay)[0], wayPts(bendWay).at(-1)].map((p) => nearS(p).s)) : null;
let lx0 = Infinity, lx1 = -Infinity, ly0 = Infinity, ly1 = -Infinity;
for (const p of lakeOuter) { lx0 = Math.min(lx0, p[0]); lx1 = Math.max(lx1, p[0]); ly0 = Math.min(ly0, p[1]); ly1 = Math.max(ly1, p[1]); }
let maxSpan = 0;
for (let i = 0; i < lakeOuter.length; i += 2) for (let j = i + 1; j < lakeOuter.length; j += 2) maxSpan = Math.max(maxSpan, dist(lakeOuter[i], lakeOuter[j]));
// across the water from the walk: shoreline distance along the lake-side normal
const across = [];
for (let s = 100; s < L - 100; s += 100) {
  const a = pointAt(spine, SPS, s - 5), b = pointAt(spine, SPS, s + 5), p = pointAt(spine, SPS, s);
  const t = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)], n = [t[1], -t[0]];
  let wet = false, dFar = null;
  for (let d = 2; d < 3000; d += 2) {
    const q = [p[0] + n[0] * d, p[1] + n[1] * d];
    const w = inLake(q);
    if (w) wet = true; else if (wet) { dFar = d; break; }
  }
  if (dFar) across.push(dFar);
}
across.sort((a, b) => a - b);

/* -------------------------------- sun -------------------------------- */
const { y, m, d } = DATE;
const lat = originLL[0], lon = originLL[1];
const sr = crossing(y, m, d, -0.833, true, lat, lon);
const cdawn = crossing(y, m, d, -6, true, lat, lon);
const ss = crossing(y, m, d, -0.833, false, lat, lon);
const srPos = sunPosition(localDate(y, m, d, sr), lat, lon);
const rm = (h) => Math.round(h * 60) / 60;
const presets = { predawn: rm(cdawn), sunrise: rm(sr), golden: rm(sr + 26 / 60), bright: 9.25 };
const sun = {
  lat: +lat.toFixed(6), lon: +lon.toFixed(6), tz: 5.5, date: [y, m, d],
  civilDawn: +cdawn.toFixed(4), sunrise: +sr.toFixed(4), sunriseAz: r1(srPos.azimuth), sunset: +ss.toFixed(4),
  presets, clock: Object.fromEntries(Object.entries(presets).map(([k, h]) => [k, hhmm(h)])),
  elevation: Object.fromEntries(Object.entries(presets).map(([k, h]) => [k, r1(sunPosition(localDate(y, m, d, h), lat, lon).elevation)])),
};
log(`sun ${y}-${m}-${d}: civil dawn ${hhmm(cdawn)}, sunrise ${hhmm(sr)} at ${srPos.azimuth.toFixed(1)}°, sunset ${hhmm(ss)}; presets ${JSON.stringify(sun.clock)}`);

/* ------------------------------- write ------------------------------- */
const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
const attribution = '© OpenStreetMap contributors (ODbL 1.0); terrain: Mapzen / AWS Terrain Tiles (SRTM and others)';
const data = {
  version: 2,
  generated: new Date().toISOString(),
  attribution,
  frame: 'ENU metres [east, north] about the origin; heights above the lake level; three.js x = east, z = -north',
  source: { osm: osmFile, osmFetched: osm.__source?.fetched, bbox: BBOX, promenadeWays: PROMENADE_WAYS },
  origin: { lat: +originLL[0].toFixed(7), lon: +originLL[1].toFixed(7) },
  lakeLevelASL: r1(LAKE_LEVEL),
  promenade: { length: r2(L), osmLength: r2(L_OSM), step: SPINE_STEP, pts: rp(spine), osm: rp(spineRaw), westBendS: bendS && r1(bendS) },
  lake: { outer: rp(lakeOuter), inner: lakeInner.map(rp), area: Math.round(lakeArea), perimeter: Math.round(lakePerim) },
  sun,
  ridges: { note: 'far layer only: rays start where they leave the hill grid', views: ridgeViews },
  landmarks,
  steps,
  features: { buildings, roads, paths, waterways, landuse, parking, pitches, piers, golf, gardens, ponds, trees },
  measures: {
    promenadeLength: r2(L), osmLength: r2(L_OSM), bundLength: bendS && r1(bendS), westShoreStretch: bendS && r1(L - bendS),
    lakeArea: Math.round(lakeArea), lakePerimeter: Math.round(lakePerim), lakeExtentEN: [Math.round(lx1 - lx0), Math.round(ly1 - ly0)],
    lakeMaxSpan: Math.round(maxSpan), lakeIslands: lakeInner.length,
    acrossWater: { min: across[0], median: across[Math.floor(across.length / 2)], max: across[across.length - 1] },
  },
  checks,
};
const terrain = {
  version: 2,
  attribution,
  unit: 0.1,
  ref: 'lake level',
  near: { rect: near.rect, step: near.step, nx: near.nx, ny: near.ny, data: b64(near.h) },
  hills: { rect: hills.rect, step: hills.step, nx: hills.nx, ny: hills.ny, data: b64(hills.h) },
  cover: { classes: COVER, rect: nearRect, step: CG.step, nx: cnx, ny: cny, rle: Buffer.from(Uint8Array.from(rle)).toString('base64') },
};
const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
const dataJson = JSON.stringify(data), terrainJson = JSON.stringify(terrain);
fs.writeFileSync(path.join(outDir, 'sukhna.data.json'), dataJson);
fs.writeFileSync(path.join(outDir, 'sukhna.terrain.json'), terrainJson);

/* ------------------------------ debug PNG ------------------------------ */
{
  const dbg = path.join(here, 'debug');
  fs.mkdirSync(dbg, { recursive: true });
  const COL = { land: [238, 236, 226], lake: [120, 160, 200], water: [140, 180, 215], forest: [70, 120, 70], scrub: [150, 170, 110], park: [150, 200, 130], golf: [180, 215, 140], built: [215, 205, 195], parking: [190, 190, 200], pitch: [200, 170, 140], wetland: [120, 170, 160], commercial: [220, 190, 190], grass: [170, 210, 150] };
  const sc = 0.3, W = Math.round((nearRect[2] - nearRect[0]) * sc), H = Math.round((nearRect[3] - nearRect[1]) * sc);
  const img = new Raster(W, H);
  const T = ([e, n]) => [(e - nearRect[0]) * sc, H - (n - nearRect[1]) * sc];
  const hh = (a, b) => near.h[b * near.nx + a] / 10;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = Math.floor(px / sc / CG.step), j = Math.floor((H - py) / sc / CG.step);
    if (i >= cnx || j >= cny || j < 0) continue;
    const c = COL[COVER[cover[j * cnx + i]]];
    const gi = Math.min(near.nx - 2, Math.floor(px / sc / near.step)), gj = Math.min(near.ny - 2, Math.max(0, Math.floor((H - py) / sc / near.step)));
    const sh = Math.max(0.6, Math.min(1.3, 1 + ((hh(gi + 1, gj) - hh(gi, gj)) - (hh(gi, gj + 1) - hh(gi, gj))) * 0.06));
    img.set(px, py, c.map((v) => Math.min(255, v * sh)));
  }
  for (const r of roads) img.poly(r.p.map(T), [120, 120, 120]);
  for (const b of buildings) if (b.p) img.poly(b.p.map(T), [140, 50, 50], true);
  img.poly(spine.map(T), [230, 110, 0]);
  for (const l of landmarks) img.dot(...T(l.at), 2, [200, 0, 140]);
  for (const s of steps) img.dot(...T(s.top), 2, [0, 0, 0]);
  fs.writeFileSync(path.join(dbg, 'world.png'), img.png());
}

/* ------------------------------- report ------------------------------- */
const key = landmarks.filter((l) => ['garden', 'statue', 'regulator', 'bridge', 'viewpoint', 'boat_rental', 'plaza', 'club', 'golf', 'information'].includes(l.kind));
const report = `# Sukhna data report

Generated by \`node scripts/sukhna/build-data.mjs\` on ${data.generated}.
OSM: \`${osmFile}\` (fetched ${osm.__source?.fetched || '?'} from ${osm.__source?.url || '?'}), © OpenStreetMap contributors, ODbL 1.0.
Terrain: Mapzen / AWS Terrain Tiles (Terrarium): ${TERRAIN.sets.map((s) => `z${s.zoom} ${s.name}`).join(', ')}.

The world is flat and real: ENU metres about the promenade midpoint (${originLL[0].toFixed(6)} N, ${originLL[1].toFixed(6)} E); three.js x = east, z = −north, y = up, y = 0 at the lake level (${LAKE_LEVEL.toFixed(1)} m ASL, the DEM median over the water).

## Checks

${checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail}`).join('\n')}

## Real measurements

| | |
|---|---|
| Promenade (OSM \`way/${PROMENADE_WAYS.join(', ')}\`), end to end | **${L_OSM.toFixed(2)} m** (smoothed centreline ${L.toFixed(2)} m, never more than ${maxDev.toFixed(2)} m off the OSM line) |
| Bund (east end → west bend, where the downstream footways \`way/544678270\` meet the walk) | ${bendS ? bendS.toFixed(0) + ' m' : '?'} |
| West-shore stretch (bend → boat-club end) | ${bendS ? (L - bendS).toFixed(0) + ' m' : '?'} |
| Lake area (outer ring minus ${lakeInner.length} islands) | ${(lakeArea / 1e6).toFixed(3)} km² |
| Lake perimeter | ${(lakePerim / 1000).toFixed(2)} km |
| Lake extent (E × N) / longest span | ${Math.round(lx1 - lx0)} × ${Math.round(ly1 - ly0)} m / ${Math.round(maxSpan)} m |
| Across the water from the walk (along its normal, every 100 m) | ${across[0]} – ${across[across.length - 1]} m, median ${across[Math.floor(across.length / 2)]} m |

**Landmarks** (s from the east end; d from the walk; side of the walk):

| Landmark | Kind | s (m) | d (m) | side | E, N (m) | Source |
|---|---|---|---|---|---|---|
${key.map((l) => `| ${l.name || l.kind} | ${l.kind} | ${l.s.toFixed(0)} | ${l.d.toFixed(0)} | ${l.side} | ${l.at[0].toFixed(0)}, ${l.at[1].toFixed(0)} | ${l.source} \`${l.ref.length > 40 ? l.ref.slice(0, 40) + '…' : l.ref}\` |`).join('\n')}

**Steps off the walk** (OSM \`highway=steps\` within 45 m): ${steps.map((s) => `s = ${s.s.toFixed(0)} (${s.side}${s.name ? ', ' + s.name : ''}, ${s.len.toFixed(0)} m)`).join('; ')}. OSM maps no steps down to the water.

## Grids

| Grid | Extent (E, N m) | Step | Size | Range above the lake |
|---|---|---|---|---|
| near (z13) | ${near.rect.join(', ')} | ${near.step} m | ${near.nx} × ${near.ny} | ${near.lo.toFixed(1)} … ${near.hi.toFixed(1)} m |
| hills (z12) | ${hills.rect.join(', ')} | ${hills.step} m | ${hills.nx} × ${hills.ny} | ${hills.lo.toFixed(1)} … ${hills.hi.toFixed(1)} m |
| cover | as near | ${CG.step} m | ${cnx} × ${cny} (${rle.length / 2} runs) | ${Object.entries(coverCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((v * CG.step * CG.step) / 1e6).toFixed(2)} km²`).join(', ')} |

Far ridge rings from s = ${ridgeViews.map((v) => v.s.toFixed(0)).join(', ')} (beyond the hill grid, to ${RIDGES.maxDist / 1000} km).

## Sun (${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}, IST)

Civil dawn ${hhmm(cdawn)} · sunrise **${hhmm(sr)}** at azimuth **${srPos.azimuth.toFixed(1)}°** · sunset ${hhmm(ss)}.
T presets: ${Object.keys(presets).map((k) => `${k} ${sun.clock[k]} (${sun.elevation[k]}°)`).join(', ')}.

## Output

- \`src/data/sukhna.data.json\`: ${(dataJson.length / 1024).toFixed(0)} KB (${buildings.length} buildings, ${roads.length} roads, ${paths.length} paths, ${landuse.length} landuse polygons, ${landmarks.length} landmarks, ${steps.length} steps).
- \`src/data/sukhna.terrain.json\`: ${(terrainJson.length / 1024).toFixed(0)} KB.
- Built in ${((Date.now() - t0) / 1000).toFixed(1)} s.
`;
fs.writeFileSync(path.join(here, 'report.md'), report);
log(`wrote sukhna.data.json (${(dataJson.length / 1024).toFixed(0)} KB), sukhna.terrain.json (${(terrainJson.length / 1024).toFixed(0)} KB), report.md in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (checks.some((c) => !c.ok)) { console.error('some checks failed'); process.exitCode = 2; }
