import * as THREE from 'three';
import { nearestS, inLake, shoreDist } from './frame.js';
import { NEAR, groundGrid, groundAt, setOverlay, setPatches, sampleNear, buildTerrain } from './terrain.js';
import { detectPatches, buildPatchGrids } from './patches.js';
import { gradeGrid, buildShoreBand } from './shore.js';
import { buildProfile, cutTerrain, damAt, buildDam, inFootprint, walkY, DAM } from './dam.js';
import { buildLake } from './lake.js';
import { runChecks, shoreCheck } from './checks.js';
import { buildVegetation } from './vegetation.js';
import { buildCityside } from './cityside.js';
import { buildLandmarks } from './landmarks.js';
import { buildRidgeRing } from '../core/sky.js';
import { data } from './frame.js';

/* ------------------------------------------------------------------ *
 * World assembly (plan §4, §6).
 *
 * The order matters, because every layer is built on the one before and
 * the ground function has to agree with every mesh:
 *
 *   1. the dam's cross-section is measured against the DEM;
 *   2. the near grid is graded to the real shoreline, outside the dam;
 *   3. the grid is cut under the dam, and the dam becomes the overlay
 *      `groundAt` consults first;
 *   4. only then are meshes built.
 * ------------------------------------------------------------------ */

export { walkY, DAM };

export function buildWorld(scene) {
  const t0 = performance.now();
  // the DEM as decoded (smoothed, upsampled), before any shaping
  const raw = { ...NEAR, h: NEAR.h.slice() };
  const sampleRaw = (e, n) => {
    const fx = (e - raw.rect[0]) / raw.step, fy = (n - raw.rect[1]) / raw.step;
    const i = Math.max(0, Math.min(raw.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(raw.ny - 2, Math.floor(fy)));
    const ax = fx - i, ay = fy - j, k = j * raw.nx + i;
    return (raw.h[k] * (1 - ax) + raw.h[k + 1] * ax) * (1 - ay) + (raw.h[k + raw.nx] * (1 - ax) + raw.h[k + raw.nx + 1] * ax) * ay;
  };
  buildProfile(groundGrid);
  const shaped = { shore: gradeGrid(NEAR, inFootprint) };
  shaped.dam = cutTerrain(NEAR);
  // detail patches where the shoreline is too narrow for the 10 m grid (world/patches.js)
  setOverlay(damAt);
  let patchRects = detectPatches();
  setPatches(buildPatchGrids(patchRects, sampleRaw, sampleNear, inFootprint));
  // one refinement pass: wherever the shoreline still is not held, patch there too
  const first = shoreCheck();
  if (first.fails.length) {
    patchRects = detectPatches(first.fails.map(([, e, n]) => [e, n]));
    setPatches(buildPatchGrids(patchRects, sampleRaw, sampleNear, inFootprint));
  }
  shaped.patches = patchRects.length;
  shaped.refined = first.fails.length;
  const tShape = performance.now() - t0;

  const terrain = buildTerrain(scene);
  const lake = buildLake(scene);
  const dam = buildDam(scene, { ground: groundAt });
  const band = buildShoreBand(scene, groundAt);
  const tVeg = performance.now();
  const vegetation = buildVegetation(scene);
  const vegMs = Math.round(performance.now() - tVeg);
  const city = buildCityside(scene);
  const landmarks = buildLandmarks(scene);
  const ridges = buildRidgeRing(scene, data.ridges);

  const lods = [terrain.lod, dam.lod, city.lod, landmarks.lod];
  const timing = { shapeMs: Math.round(tShape), vegMs, buildMs: Math.round(performance.now() - t0), trees: vegetation.trees.n };
  console.info(`[world] shaped ${shaped.shore} shore + ${shaped.dam} dam grid nodes, ${shaped.patches} detail patches (${shaped.refined} spots refined); built in ${timing.buildMs} ms`, dam.stats);

  const checks = import.meta.env?.DEV || new URLSearchParams(location.search).has('checks') ? runChecks() : [];
  window.__checks = checks;

  return {
    checks,
    terrain,
    lake,
    dam,
    band,
    vegetation,
    city,
    landmarks,
    ridges,
    lods,
    timing,
    patches: patchRects,
    /** Console access to the ground functions (dev). */
    debug: { groundGrid, groundAt, damAt, inFootprint, shoreDist, nearestS, inLake, NEAR },
    /** Standing height at (e, n): the dam where you are on it, else the ground (never under the water). */
    heightAt(e, n) {
      const g = groundAt(e, n);
      return inLake(e, n) ? Math.max(0, g) : g;
    },
    update(dt, viewPos, overview = false) {
      for (const l of this.lods) l.update(viewPos);
      vegetation.update(viewPos, overview);
      const ve = viewPos.x, vn = -viewPos.z;
      ridges.update(viewPos, nearestS(ve, vn).s);
    },
  };
}
