import * as THREE from 'three';
import { nearestS, inLake, shoreDist } from './frame.js';
import { NEAR, groundGrid, groundAt, setOverlay, setPatches, sampleNear, buildTerrain } from './terrain.js';
import { detectPatches, buildPatchGrids } from './patches.js';
import { gradeGrid, buildShoreBand } from './shore.js';
import { buildProfile, cutTerrain, damAt, buildDam, inFootprint, walkY, DAM, BENCHES } from './dam.js';
import { buildLake } from './lake.js';
import { runChecks, shoreCheck, waterMarginCheck, laneCheck, seatCheck } from './checks.js';
import * as BODY from '../people/body.js';
import { buildVegetation } from './vegetation.js';
import { buildCityside } from './cityside.js';
import { buildLandmarks } from './landmarks.js';
import { buildRidgeRing } from '../core/sky.js';
import { data } from './frame.js';
import { buildCrowd } from '../people/crowd.js';
import { buildRowing } from './rowing.js';
import { buildBirds } from './birds.js';
import { buildMist } from './mist.js';
import { buildSigns } from './signs.js';

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

export function buildWorld(scene, { npcs = 200, birdCount = 175, simpleWater = false, mistSheets = 140 } = {}) {
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
  const lake = buildLake(scene, { simple: simpleWater });
  const dam = buildDam(scene, { ground: groundAt });
  const band = buildShoreBand(scene, groundAt);
  const tVeg = performance.now();
  const vegetation = buildVegetation(scene);
  const vegMs = Math.round(performance.now() - tVeg);
  const city = buildCityside(scene);
  const landmarks = buildLandmarks(scene);
  const ridges = buildRidgeRing(scene, data.ridges);
  const tLife = performance.now();
  const crowd = buildCrowd(scene, { landmarks, dam }, { max: npcs });
  const rowing = buildRowing(scene, { landmarks });
  const birds = buildBirds(scene, { count: birdCount });
  const lifeMs = Math.round(performance.now() - tLife);
  const mist = buildMist(scene, { count: mistSheets });
  // signs wait for the fonts; they join the scene when ready
  const signs = { ready: buildSigns(scene, { plaza: landmarks.plaza, club: landmarks.club }) };

  const lods = [terrain.lod, dam.lod, city.lod, landmarks.lod];
  const timing = { shapeMs: Math.round(tShape), vegMs, buildMs: Math.round(performance.now() - t0), trees: vegetation.trees.n, lifeMs, people: crowd.people.length, birds: birds.count };
  console.info(`[world] shaped ${shaped.shore} shore + ${shaped.dam} dam grid nodes, ${shaped.patches} detail patches (${shaped.refined} spots refined); built in ${timing.buildMs} ms`, dam.stats);

  // npcWaterCheck: twenty simulated minutes of the crowd, every position
  // anyone stands on or walks through stays ≥ 1 m from the water
  const npcWaterCheck = () => {
    const pts = crowd.positions();
    for (let t = 0; t < 20 * 60; t += 0.5) { crowd.simulate(0.5); if (t % 5 === 0) pts.push(...crowd.positions()); }
    const r = waterMarginCheck('npcWaterCheck', pts, 1);
    r.detail = `20 simulated min, ${r.detail}`;
    return r;
  };
  // every water step (lowest dry tread, feet on the next) for each outfit, and every NPC on a bench
  const seatCases = () => {
    const cases = [];
    for (const st of dam.waterStairs) {
      const dry = st.treads.filter((q) => q.y > 0.12), seat = dry[dry.length - 1];
      const foot = st.treads[st.treads.indexOf(seat) + 1] || seat;
      BODY.OUTFITS.forEach((o, i) => { const body = BODY.makeBody(o.row); cases.push({ name: `steps s${st.s} outfit ${i}`, body, seatTop: seat.y, footTop: foot.y, front: BODY.stepSeat(body, seat, foot).front }); });
    }
    for (const p of crowd.people.filter((q) => q.seat)) {
      const g0 = walkY(p.bench.s);
      cases.push({ name: `bench s${Math.round(p.bench.s)} #${p.id}`, body: p.body, seatTop: g0 + 0.48, footTop: g0, front: 0.21 });
    }
    BODY.OUTFITS.forEach((o, i) => cases.push({ name: `bench (jogger) outfit ${i}`, body: BODY.makeBody(o.row), seatTop: 0.48, footTop: 0, front: 0.21 }));
    return cases;
  };
  const checks = import.meta.env?.DEV || new URLSearchParams(location.search).has('checks') ? runChecks([npcWaterCheck, () => laneCheck(rowing.laneSamples(), 30), () => seatCheck(seatCases(), BODY)]) : [];
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
    crowd,
    rowing,
    birds,
    mist,
    signs,
    lods,
    timing,
    patches: patchRects,
    /** Console access to the ground functions (dev). */
    debug: { groundGrid, groundAt, damAt, inFootprint, shoreDist, nearestS, inLake, NEAR, BENCHES },
    /** Standing height at (e, n): the dam where you are on it, else the ground (never under the water). */
    heightAt(e, n) {
      const g = groundAt(e, n);
      return inLake(e, n) ? Math.max(0, g) : g;
    },
    update(dt, viewPos, overview = false, jogger = null) {
      crowd.update(dt, viewPos, jogger);
      rowing.update(dt);
      birds.update(dt, jogger);
      lake.update(dt);
      mist.update(dt, viewPos);
      for (const l of this.lods) l.update(viewPos);
      vegetation.update(viewPos, overview);
      const ve = viewPos.x, vn = -viewPos.z;
      ridges.update(viewPos, nearestS(ve, vn).s);
    },
  };
}
