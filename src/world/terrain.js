import * as THREE from 'three';
import terrainData from '../data/sukhna.terrain.json';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { LodSet, LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * Terrain: the real DEM, as two grids (plan §3, §4).
 *
 *   near  the lake basin, ~5 x 4 km at 20 m, from z13 tiles
 *   hills the Shivalik front, ~26 x 22 km at 120 m, from z12 tiles
 *
 * Heights are metres above the lake.  Each grid is cut into chunks with
 * two LODs (every vertex, every other vertex).  Near chunks are drawn in
 * both render passes; hill chunks only in the far pass, with a hole where
 * the near grid is (their vertices under it are sunk a few metres, so the
 * finer grid always wins).
 *
 * The near grid is shaped before it is meshed (world/index.js): graded to
 * the real shoreline (world/shore.js) and cut under the dam (world/dam.js).
 * `groundAt` then asks the dam first (`setOverlay`) and the grid second, so
 * the surface drawn is the surface walked.
 * ------------------------------------------------------------------ */

function decodeGrid(g, unit) {
  const bin = atob(g.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = new Int16Array(bytes.buffer);
  const h = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) h[i] = raw[i] * unit;
  return { rect: g.rect, step: g.step, nx: g.nx, ny: g.ny, h };
}
function decodeCover(c) {
  const bin = atob(c.rle);
  const out = new Uint8Array(c.nx * c.ny);
  let k = 0;
  for (let i = 0; i < bin.length; i += 2) {
    const n = bin.charCodeAt(i);
    out.fill(bin.charCodeAt(i + 1), k, k + n);
    k += n;
  }
  return { ...c, cells: out };
}

/**
 * Separable binomial smoothing, `passes` times.  SRTM carries a few metres
 * of speckle even over the flat city, and the cel ramp turns speckle into
 * camouflage blotches; the real relief here (the Shivalik front, the
 * basin) is far broader than the ~40 m this removes on the near grid.
 */
function smoothGrid(g, passes) {
  const { nx, ny } = g;
  let a = g.h, b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, l = j * nx + Math.max(0, i - 1), r = j * nx + Math.min(nx - 1, i + 1);
      b[k] = 0.25 * a[l] + 0.5 * a[k] + 0.25 * a[r];
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, d = Math.max(0, j - 1) * nx + i, u = Math.min(ny - 1, j + 1) * nx + i;
      a[k] = 0.25 * b[d] + 0.5 * b[k] + 0.25 * b[u];
    }
  }
  return g;
}

/**
 * Upsample a grid 2x (bilinear).  No new information -- the DEM is ~30 m --
 * but the shoreline grading and the dam cut need finer vertices than 20 m
 * to put the water's edge where OSM says it is (see world/shore.js).
 */
function upsample(g) {
  const nx = g.nx * 2 - 1, ny = g.ny * 2 - 1, h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const i0 = i >> 1, j0 = j >> 1, i1 = Math.min(g.nx - 1, i0 + (i & 1)), j1 = Math.min(g.ny - 1, j0 + (j & 1));
    h[j * nx + i] = (g.h[j0 * g.nx + i0] + g.h[j0 * g.nx + i1] + g.h[j1 * g.nx + i0] + g.h[j1 * g.nx + i1]) / 4;
  }
  return { rect: g.rect, step: g.step / 2, nx, ny, h };
}

export const NEAR = upsample(smoothGrid(decodeGrid(terrainData.near, terrainData.unit), 3));
export const HILLS = smoothGrid(decodeGrid(terrainData.hills, terrainData.unit), 1);
export const COVER = decodeCover(terrainData.cover);

/**
 * Height from a grid at (e, n), interpolated over the same two triangles
 * per cell the mesh is drawn with, so the ground walked on and checked is
 * exactly the ground drawn (at full LOD).  NaN outside the grid.
 */
function sample(g, e, n) {
  const fx = (e - g.rect[0]) / g.step, fy = (n - g.rect[1]) / g.step;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
  const ax = fx - i, ay = fy - j, k = j * g.nx + i, h = g.h;
  const a = h[k], b = h[k + 1], d = h[k + g.nx], f = h[k + g.nx + 1];
  return ax + ay <= 1 ? a + (b - a) * ax + (d - a) * ay : f + (d - f) * (1 - ax) + (b - f) * (1 - ay);
}

/** Land-cover class name at (e, n). */
export function coverAt(e, n) {
  const i = Math.floor((e - COVER.rect[0]) / COVER.step), j = Math.floor((n - COVER.rect[1]) / COVER.step);
  if (i < 0 || j < 0 || i >= COVER.nx || j >= COVER.ny) return 'land';
  return COVER.classes[COVER.cells[j * COVER.nx + i]];
}

let PATCHES = [];
/** Install the detail patches (world/patches.js): fine grids that win over the near grid. */
export function setPatches(list) { PATCHES = list; }
/** The near grid as it stands, ignoring patches (for building the patches' borders). */
export const sampleNear = (e, n) => sample(NEAR, e, n);

/** The terrain grids alone (m above the lake): a detail patch, else the near grid, else the hill grid. */
export function groundGrid(e, n) {
  for (const p of PATCHES) {
    if (e >= p.rect[0] && e <= p.rect[2] && n >= p.rect[1] && n <= p.rect[3]) {
      const v = sample(p, Math.min(e, p.rect[2] - 1e-6), Math.min(n, p.rect[3] - 1e-6));
      if (Number.isFinite(v)) return v;
    }
  }
  const h = sample(NEAR, e, n);
  if (Number.isFinite(h)) return h;
  const g = sample(HILLS, e, n);
  return Number.isFinite(g) ? g : 0;
}

let overlay = null;
/** Install a surface that overrides the grids where it returns a number (the dam). */
export function setOverlay(fn) { overlay = fn; }

/** Ground height (m above the lake) at (e, n): the surface drawn is the surface walked. */
export function groundAt(e, n) {
  if (overlay) {
    const o = overlay(e, n);
    if (Number.isFinite(o)) return o;
  }
  return groundGrid(e, n);
}

/* ------------------------------- colour ------------------------------- */

const COVER_COLOR = {
  land: PAL.groundDry, lake: PAL.lakeBed, water: PAL.waterBright, forest: PAL.leafDeep, scrub: PAL.scrub,
  park: PAL.grass, golf: PAL.golf, built: PAL.built, parking: PAL.paved, pitch: PAL.pitch, wetland: PAL.wetland,
  commercial: PAL.built, grass: PAL.grass,
};
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();

/**
 * Unclassified land, the same rule for both grids so they meet without a
 * seam: dry winter grass on the plains, scrub forest as the ground rises
 * into the Shivaliks, barer on steep faces and greyer high up.
 */
function landColour(h, slope, out) {
  out.set(PAL.groundDry);
  const hill = THREE.MathUtils.smoothstep(h, 8, 40);
  if (hill > 0) out.lerp(_c2.set(PAL.leafDeep).lerp(_c3.set(PAL.scrub), THREE.MathUtils.clamp(slope * 1.4, 0, 0.8)), hill);
  if (h > 500) out.lerp(_c2.set(PAL.ridgeRock), THREE.MathUtils.clamp((h - 500) / 900, 0, 0.5));
  return out;
}
function nearColour(e, n, h, slope, out) {
  const cls = coverAt(e, n);
  if (cls === 'land') return landColour(h, slope, out);
  return out.set(COVER_COLOR[cls] ?? PAL.groundDry);
}
function hillColour(e, n, h, slope, out) {
  return landColour(h, slope, out);
}

/* ------------------------------- meshes ------------------------------- */

/**
 * One chunk of a grid as an indexed mesh: cells [i0, i1) x [j0, j1) at
 * `stride`, with a 25 m skirt all round, so neighbouring chunks at
 * different LODs never show a crack.
 */
function chunkGeometry(g, i0, j0, i1, j1, stride, { heightFn, colourFn, skip }) {
  const cols = Math.floor((i1 - i0) / stride) + 1, rows = Math.floor((j1 - j0) / stride) + 1;
  const pos = [], col = [], idx = [], H = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = Math.min(i0 + c * stride, g.nx - 1), j = Math.min(j0 + r * stride, g.ny - 1);
      const e = g.rect[0] + i * g.step, n = g.rect[1] + j * g.step;
      const h = heightFn(e, n, g.h[j * g.nx + i]);
      H.push(h);
      pos.push(e, h, -n);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const hx = H[r * cols + Math.min(cols - 1, c + 1)] - H[r * cols + Math.max(0, c - 1)];
      const hy = H[Math.min(rows - 1, r + 1) * cols + c] - H[Math.max(0, r - 1) * cols + c];
      const slope = Math.hypot(hx, hy) / (2 * g.step * stride);
      colourFn(pos[k * 3], -pos[k * 3 + 2], H[k], slope, _c);
      col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, f = d + 1;
      if (skip) {
        const ce = (pos[a * 3] + pos[f * 3]) / 2, cn = -(pos[a * 3 + 2] + pos[f * 3 + 2]) / 2;
        if (skip(ce, cn)) continue;
      }
      // grid (e, n) -> world (x, -z): this winding faces up
      idx.push(a, b, d, b, f, d);
    }
  }
  // skirts: the chunk's rim, dropped 25 m, double-sided
  const ring = [];
  for (let c = 0; c < cols; c++) ring.push(c);
  for (let r = 1; r < rows; r++) ring.push(r * cols + cols - 1);
  for (let c = cols - 2; c >= 0; c--) ring.push((rows - 1) * cols + c);
  for (let r = rows - 2; r >= 1; r--) ring.push(r * cols);
  ring.push(0);
  const nSurf = pos.length / 3;
  const base = pos.length / 3;
  for (const k of ring) {
    pos.push(pos[k * 3], pos[k * 3 + 1] - 25, pos[k * 3 + 2]);
    col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
  }
  for (let q = 0; q < ring.length - 1; q++) {
    const a = ring[q], b = ring[q + 1], a2 = base + q, b2 = base + q + 1;
    idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // a double-sided skirt's normals cancel to zero (and shade black): give
  // each skirt vertex its rim vertex's normal instead
  const nrm = geo.attributes.normal;
  ring.forEach((k, q) => nrm.setXYZ(nSurf + q, nrm.getX(k), nrm.getY(k), nrm.getZ(k)));
  geo.computeBoundingSphere();
  return geo;
}

export function buildTerrain(scene) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const lod = new LodSet('terrain');
  const mat = cel({ color: 0xffffff, vertexColors: true, bands: 'terrain', relief: true, flat: false });
  const stats = { chunks: 0, tris: 0 };

  const addGrid = (g, chunkCells, levels, opts, layers, tag) => {
    for (let j0 = 0; j0 < g.ny - 1; j0 += chunkCells) {
      for (let i0 = 0; i0 < g.nx - 1; i0 += chunkCells) {
        const i1 = Math.min(g.nx - 1, i0 + chunkCells), j1 = Math.min(g.ny - 1, j0 + chunkCells);
        if (opts.skipChunk && opts.skipChunk(g, i0, j0, i1, j1)) continue;
        const ce = g.rect[0] + ((i0 + i1) / 2) * g.step, cn = g.rect[1] + ((j0 + j1) / 2) * g.step;
        const lv = levels.map(({ dist, stride }) => {
          const geo = chunkGeometry(g, i0, j0, i1, j1, stride, opts);
          if (!geo.index.count) return { dist, obj: null };
          const m = new THREE.Mesh(geo, mat);
          m.receiveShadow = true;
          m.castShadow = false;
          m.userData.noOutline = true;
          setLayers(m, ...layers);
          group.add(m);
          stats.tris += geo.index.count / 3;
          return { dist, obj: m };
        });
        lod.add(new THREE.Vector3(ce, 0, -cn), lv, tag);
        stats.chunks++;
      }
    }
  };

  const nr = NEAR.rect;
  const insideNear = (e, n, pad = 0) => e > nr[0] + pad && e < nr[2] - pad && n > nr[1] + pad && n < nr[3] - pad;

  // the lake basin: 1 km chunks (100 cells of 10 m), full detail to 1.2 km, then 20 m, then 40 m,
  // with a hole under every detail patch (their rectangles are snapped to 40 m, so every LOD's cells align)
  const inPatch = (e, n) => PATCHES.some((p) => e > p.rect[0] && e < p.rect[2] && n > p.rect[1] && n < p.rect[3]);
  addGrid(NEAR, 100, [{ dist: 1200, stride: 1 }, { dist: 2600, stride: 2 }, { dist: 1e9, stride: 4 }], {
    heightFn: (e, n, h) => h,
    colourFn: nearColour,
    skip: inPatch,
  }, [LAYER.NEAR, LAYER.FAR], 'near');

  // the detail patches themselves, one mesh each, drawn at every distance
  for (const p of PATCHES) {
    const geo = chunkGeometry(p, 0, 0, p.nx - 1, p.ny - 1, 1, { heightFn: (e, n, h) => h, colourFn: nearColour });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'terrainPatch';
    m.receiveShadow = true;
    m.userData.noOutline = true;
    setLayers(m, LAYER.NEAR, LAYER.FAR);
    group.add(m);
    stats.patches = (stats.patches || 0) + 1;
    stats.tris += geo.index.count / 3;
  }

  // the hills: 3.6 km chunks, full detail to 9 km, with a hole under the basin
  addGrid(HILLS, 30, [{ dist: 9000, stride: 1 }, { dist: 1e9, stride: 2 }], {
    heightFn: (e, n, h) => (insideNear(e, n) ? h - 4 : h),
    colourFn: hillColour,
    skip: (e, n) => insideNear(e, n, HILLS.step * 2),
    skipChunk: (g, i0, j0, i1, j1) => insideNear(g.rect[0] + i0 * g.step, g.rect[1] + j0 * g.step, g.step * 2)
      && insideNear(g.rect[0] + i1 * g.step, g.rect[1] + j1 * g.step, g.step * 2),
  }, [LAYER.FAR], 'hills');

  scene.add(group);
  return { group, lod, stats };
}
