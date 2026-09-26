import { data, shoreDist, rayToShore, inLake, nearestS, L } from './frame.js';
import { gradeShore } from './shore.js';

/* ------------------------------------------------------------------ *
 * Detail patches: fine terrain where the shoreline is too narrow for the
 * 10 m grid (the user's call, after shoreCheck failed three times).
 *
 * Three OSM islets are 15-32 m across and one arm of the lake near the
 * regulator narrows to an 8-12 m channel.  A 10 m height grid cannot hold
 * either: triangles span the water and the land, so islets sink and the
 * channel's banks dip under the water line.  So around each narrow
 * feature the terrain is re-sampled on a 4 m grid (two cells across the
 * narrowest channel), graded with the exact
 * shoreline distance, and drawn as its own mesh.  The patch rectangles are
 * snapped to 40 m (the coarsest terrain LOD cell) so the base terrain can
 * leave a clean hole under them; on the border the patch takes the base
 * grid's own values, so the seam is exact.
 * ------------------------------------------------------------------ */

const SNAP = 40, STEP = 4, BLEND = 8;

/**
 * Rectangles [e0, n0, e1, n1] around the narrow features, merged where
 * they overlap.  `extra` adds a patch around each given [e, n] -- the
 * world build passes the points where a first shoreline pass found the
 * 10 m grid still wrong (world/index.js), so patches go wherever the grid
 * cannot hold the real edge, not just where a width rule guessed.
 */
export function detectPatches(extra = []) {
  const rects = [];
  const grow = (e0, n0, e1, n1, m) => [Math.floor((e0 - m) / SNAP) * SNAP, Math.floor((n0 - m) / SNAP) * SNAP, Math.ceil((e1 + m) / SNAP) * SNAP, Math.ceil((n1 + m) / SNAP) * SNAP];
  // every islet (the largest is 143 m across but has thin arms)
  for (const ring of data.lake.inner) {
    let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
    for (const [e, n] of ring) { e0 = Math.min(e0, e); n0 = Math.min(n0, n); e1 = Math.max(e1, e); n1 = Math.max(n1, n); }
    rects.push(grow(e0, n0, e1, n1, 20));
  }
  // narrow water and narrow land: along every shoreline every 4 m, how far is it
  // across the water to the next shore, and across the land to the next water?
  for (const ring of [data.lake.outer]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len;
      for (let d = 0; d < len; d += 4) {
        const e = a[0] + tx * d, n = a[1] + ty * d;
        // the dam builds its own edge
        const ns = nearestS(e, n);
        if (ns.d < 30 && ns.s > 0.5 && ns.s < L - 0.5) continue;
        let nx = ty, ny = -tx;
        if (!inLake(e + nx * 0.5, n + ny * 0.5)) { nx = -nx; ny = -ny; }
        for (const sgn of [1, -1]) { // +1 across the water, -1 across the land
          const t = rayToShore(e + sgn * nx * 0.3, n + sgn * ny * 0.3, sgn * nx, sgn * ny, 45);
          if (!(t < 40)) continue;
          const fe = e + sgn * nx * t, fn = n + sgn * ny * t;
          rects.push(grow(Math.min(e, fe), Math.min(n, fn), Math.max(e, fe), Math.max(n, fn), 20));
        }
      }
    }
  }
  for (const [e, n] of extra) rects.push(grow(e, n, e, n, 16));
  // merge overlapping rectangles until none overlap
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rects.length && !merged; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i], B = rects[j];
        if (A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]) {
          rects[i] = [Math.min(A[0], B[0]), Math.min(A[1], B[1]), Math.max(A[2], B[2]), Math.max(A[3], B[3])];
          rects.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }
  return rects;
}

/**
 * Build each patch's 2 m height grid.  `raw(e, n)` is the DEM before any
 * grading; `base(e, n)` is the finished base terrain (used on the border,
 * blended in over 6 m).
 */
export function buildPatchGrids(rects, raw, base, onDam = () => false) {
  return rects.map((rect) => {
    const nx = Math.round((rect[2] - rect[0]) / STEP) + 1, ny = Math.round((rect[3] - rect[1]) / STEP) + 1;
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const e = rect[0] + i * STEP, n = rect[1] + j * STEP;
        const edge = Math.min(i, j, nx - 1 - i, ny - 1 - j) * STEP;
        // inside the dam's footprint the base grid is already cut to the dam
        const fine = onDam(e, n) ? base(e, n) : gradeShore(raw(e, n), shoreDist(e, n, 80));
        const w = Math.min(1, edge / BLEND);
        h[j * nx + i] = w >= 1 ? fine : base(e, n) * (1 - w) + fine * w;
      }
    }
    return { rect, step: STEP, nx, ny, h };
  });
}

/** Is (e, n) inside any patch? Returns the patch or null. */
export function patchAt(patches, e, n) {
  for (const p of patches) if (e >= p.rect[0] && e <= p.rect[2] && n >= p.rect[1] && n <= p.rect[3]) return p;
  return null;
}
