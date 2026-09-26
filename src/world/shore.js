import * as THREE from 'three';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { data, L, shoreDist, nearestS } from './frame.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The shoreline: where the real lake polygon meets the DEM.
 *
 * The water is the OSM polygon at y = 0; the 30 m DEM knows nothing of
 * where exactly it ends.  So the ground is graded against the polygon's
 * signed distance (plan §4):
 *
 *   on land, within 20 m    at least +0.35 m, rising 0.15 m per metre,
 *                           then easing back to the DEM by 60 m
 *   on the water            falling 0.15 m per metre to a bed at -3 m
 *
 * 0.15 m/m is what it takes, on the 10 m grid, for linear interpolation
 * between a land vertex and a water vertex to keep the ground above the
 * water 3 m out and below it 3 m in (shoreCheck asserts exactly that).
 *
 * Between grid vertices the terrain's own zero crossing still lands a
 * metre or two either side of the true edge, so a thin drawdown band
 * (the pale margin every monsoon reservoir has in January) is laid along
 * the whole shoreline from 1.5 m out on the water to 2.5 m up the bank.
 * `shoreCheck` (world/checks.js) proves the result.
 * ------------------------------------------------------------------ */

export const BED = -3;

/** The graded height for a DEM height h at signed shore distance sd. */
export function gradeShore(h, sd) {
  if (sd < 0) return Math.min(h, Math.max(BED, -0.5 + 0.15 * sd));
  // on land: at least 0.15 m/m up from the edge, and at most 1:5 for the
  // first 20 m -- a steep real bank (the north shore climbs 9 m in a few
  // metres) would otherwise drag the ground above the water inside the
  // polygon when a triangle spans the edge
  if (sd < 20) return THREE.MathUtils.clamp(h, 0.35 + 0.15 * sd, 0.6 + 0.2 * sd);
  if (sd < 60) {
    const t = (sd - 20) / 40;
    return THREE.MathUtils.clamp(h, THREE.MathUtils.lerp(0.35 + 0.15 * 20, -1e9, t), THREE.MathUtils.lerp(0.6 + 0.2 * 20, 1e9, t * t));
  }
  return h;
}

/**
 * Grade a decoded height grid in place (the near grid).  `onDam(e, n)`
 * says whether a point is inside the dam's footprint, which the dam
 * shapes itself.
 */
export function gradeGrid(g, onDam = () => false) {
  let changed = 0;
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const k = j * g.nx + i;
      const e = g.rect[0] + i * g.step, n = g.rect[1] + j * g.step;
      const sd = shoreDist(e, n, 70);
      if (sd >= 60) continue;
      // the dam's footprint on land is shaped by the dam itself (world/dam.js);
      // on the water the grading always applies
      if (sd > 0 && onDam(e, n)) continue;
      const h2 = gradeShore(g.h[k], sd);
      if (h2 !== g.h[k]) { g.h[k] = h2; changed++; }
    }
  }
  return changed;
}

/**
 * The drawdown band along every shoreline (outer ring and islands), except
 * where the dam's own embankment already meets the water.  `groundAt` is
 * the finished ground function, so the band's upper edge sits on the bank.
 */
export function buildShoreBand(scene, groundAt, damReach = 16) {
  const pos = [], col = [], idx = [];
  const c0 = new THREE.Color(PAL.drawdown), c1 = new THREE.Color(PAL.drawdownWet), c2 = new THREE.Color(PAL.lakeBed);
  const addRing = (ring, outerIsLand) => {
    // walk the ring in 3 m steps; each step adds a row of three vertices
    const pts = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 3));
      for (let q = 0; q < k; q++) pts.push([a[0] + ((b[0] - a[0]) * q) / k, a[1] + ((b[1] - a[1]) * q) / k]);
    }
    // outward normal (toward land) by testing a probe
    let run = null;
    const flush = () => { run = null; };
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      let nx = ty, ny = -tx;
      if (shoreDist(p[0] + nx * 2, p[1] + ny * 2, 20) < 0) { nx = -nx; ny = -ny; }
      // the dam builds its own waterline
      const ns = nearestS(p[0], p[1]);
      if (ns.d < damReach && ns.s > 0.5 && ns.s < data.promenade.length - 0.5) { flush(); continue; }
      const rows = [
        [p[0] - nx * 1.5, p[1] - ny * 1.5, -0.3, c2],
        [p[0], p[1], 0.06, c1],
        [p[0] + nx * 2.5, p[1] + ny * 2.5, null, c0],
      ];
      const base = pos.length / 3;
      for (const [e, n, y, c] of rows) {
        const yy = y ?? Math.max(groundAt(e, n) + 0.04, 0.3);
        pos.push(e, yy, -n);
        col.push(c.r, c.g, c.b);
      }
      if (run !== null) {
        const pb = run;
        idx.push(pb, base, pb + 1, base, base + 1, pb + 1, pb + 1, base + 1, pb + 2, base + 1, base + 2, pb + 2);
      }
      run = base;
    }
  };
  addRing(data.lake.outer, true);
  for (const r of data.lake.inner) addRing(r, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, cel({ color: 0xffffff, vertexColors: true, relief: true, bands: 'terrain', flat: false, side: THREE.DoubleSide }));
  mesh.name = 'shoreBand';
  mesh.receiveShadow = true;
  mesh.userData.noOutline = true;
  setLayers(mesh, LAYER.NEAR, LAYER.FAR);
  scene.add(mesh);
  return mesh;
}
