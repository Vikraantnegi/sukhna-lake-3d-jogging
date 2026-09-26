import * as THREE from 'three';
import { data, L, spineAt, shoreDist, inLake, nearestS } from './frame.js';
import { groundAt, groundGrid } from './terrain.js';
import { walkY, damHeight, shoreOffset, DAM, WATER_STEPS, GAPS } from './dam.js';

/* ------------------------------------------------------------------ *
 * Numeric self-checks (plan §8).  They run in dev on start-up, print a
 * line each, and are kept on `window.__checks`.  Each one measures the
 * functions the meshes are built from, so a pass means what is drawn is
 * right, not just what was intended.
 * ------------------------------------------------------------------ */

const fmt = (v) => (Math.round(v * 100) / 100).toFixed(2);

/**
 * shoreCheck: along every shoreline (outer ring and islands, every 2 m),
 * the ground 3 m out on land is above the water and the ground 3 m in on
 * the water is below it.  Within 2.5 m of the edge the drawdown band covers
 * the terrain's own crossing (world/shore.js), so 3 m is the honest test.
 */
export function shoreCheck({ step = 2, off = 3, landMin = 0.02, waterMax = -0.05 } = {}) {
  let n = 0, badLand = 0, badWater = 0, worstLand = Infinity, worstWater = -Infinity, at = null;
  const fails = [];
  for (const ring of [data.lake.outer, ...data.lake.inner]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let tx = (b[0] - a[0]) / len, ty = (b[1] - a[1]) / len;
      let nx = ty, ny = -tx;
      for (let d = 0; d < len; d += step) {
        const e = a[0] + tx * d, nn = a[1] + ty * d;
        // which side is land here? (islands and bays flip it)
        const land = shoreDist(e + nx * off, nn + ny * off, 20) > 0 ? 1 : -1;
        const eo = e + nx * off * land, no = nn + ny * off * land;
        const ei = e - nx * off * land, ni = nn - ny * off * land;
        // at a concave corner "3 m along the edge normal" can be much nearer
        // the water than 3 m; only test points that really are 3 m out / in
        if (shoreDist(eo, no, 20) < off * 0.9 || shoreDist(ei, ni, 20) > -off * 0.9) continue;
        const gl = groundAt(eo, no), gw = groundAt(ei, ni);
        n++;
        if (gl < landMin) { badLand++; if (gl < worstLand) at = [eo, no]; fails.push(['land', eo, no, gl]); }
        if (gw > waterMax) { badWater++; fails.push(['water', ei, ni, gw]); }
        worstLand = Math.min(worstLand, gl);
        worstWater = Math.max(worstWater, gw);
      }
    }
  }
  const ok = badLand === 0 && badWater === 0;
  return { name: 'shoreCheck', ok, samples: n, badLand, badWater, fails, worstLand: +fmt(worstLand), worstWater: +fmt(worstWater), at,
    detail: `${n} samples; land 3 m out ≥ ${landMin} m: ${badLand} fail (lowest ${fmt(worstLand)} m); water 3 m in ≤ ${waterMax} m: ${badWater} fail (highest ${fmt(worstWater)} m)` };
}

/** damCheck: the walk is ≥ 2 m above the water everywhere; the parapet is continuous except at the water steps. */
export function damCheck() {
  let low = Infinity, lowS = 0, lakeless = 0;
  for (let s = 0; s <= L; s += 2) {
    const y = walkY(s);
    if (y < low) { low = y; lowS = s; }
    if (!Number.isFinite(shoreOffset(s))) lakeless++;
  }
  const ok = low >= 2.0;
  return { name: 'damCheck', ok, lowest: +fmt(low), at: Math.round(lowS), gaps: GAPS.length,
    detail: `walk ≥ 2.00 m above the water: lowest ${fmt(low)} m at s = ${Math.round(lowS)}; parapet gaps only at the ${GAPS.length} flights (${WATER_STEPS.length} to the water, ${GAPS.length - WATER_STEPS.length} to the jetty); ${Math.round(lakeless * 2)} m of the walk has no water alongside` };
}

/**
 * hillSafety: the terrain mesh never pokes through the walk.  Samples the
 * terrain grid alone (not the dam overlay) across the walk and verge every
 * 2 m and reports the worst height of terrain above the walk surface.
 */
export function hillSafety() {
  let worst = -Infinity, at = 0, n = 0;
  for (let s = 0; s <= L; s += 2) {
    const f = spineAt(s);
    for (const d of [-DAM.verge, -DAM.half, 0, DAM.half, DAM.parOut]) {
      const g = groundGrid(f.e + f.ne * d, f.n + f.nn * d);
      const y = damHeight(s, d);
      if (!Number.isFinite(y)) continue;
      n++;
      if (g - y > worst) { worst = g - y; at = s; }
    }
  }
  const ok = worst <= 0;
  return { name: 'hillSafety', ok, worst: +fmt(Math.max(0, worst)), at: Math.round(at), detail: `${n} samples; worst terrain above the walk: ${fmt(Math.max(0, worst))} m (s = ${Math.round(at)})` };
}

/** npcWaterCheck: every given point is at least `margin` metres from the water (plan §6). */
export function waterMarginCheck(name, points, margin = 1) {
  let bad = 0, worst = Infinity;
  for (const [e, n] of points) {
    const sd = shoreDist(e, n, 50);
    if (sd < margin) bad++;
    worst = Math.min(worst, sd);
  }
  return { name, ok: bad === 0, samples: points.length, bad, worst: +fmt(worst), detail: `${points.length} samples; ${bad} closer than ${margin} m to the water (closest ${fmt(worst)} m)` };
}

/** laneCheck: every sample of every rowing lane is ≥ `margin` m inside the water. */
export function laneCheck(lanes, margin = 30) {
  let bad = 0, worst = Infinity, n = 0;
  for (const lane of lanes) {
    for (const [e, nn] of lane.pts) {
      n++;
      const sd = -shoreDist(e, nn, 400);
      if (!inLake(e, nn) || sd < margin) bad++;
      worst = Math.min(worst, inLake(e, nn) ? sd : -1);
    }
  }
  return { name: 'laneCheck', ok: bad === 0, samples: n, bad, worst: +fmt(worst), detail: `${lanes.length} lanes, ${n} samples; ${bad} closer than ${margin} m to any shore or island (closest ${fmt(worst)} m)` };
}

/**
 * seatCheck (user review after Phase 7): nobody sinks into what they sit on.
 * Poses a body with seatPose/poseBody and transforms every vertex of every
 * part: anything over the seat (up to its front edge, `front` m ahead of
 * the root) must be on or above the seat; anything beyond the edge on or
 * above the surface the feet rest on (thighs may run on over a bench's edge,
 * shins may not cut through a step's lip).
 * `cases`: [{ name, body, seatTop, footTop, front }]; tolerance 1 cm.
 */
export function seatCheck(cases, { seatPose, applySeat, poseBody, partGeometries, restPose, PARTS }) {
  const geos = partGeometries();
  const out = PARTS.map(() => new THREE.Matrix4());
  const v = new THREE.Vector3();
  let worst = Infinity, where = '', bad = 0;
  for (const c of cases) {
    const sp = seatPose(c.body, c.seatTop, c.footTop);
    poseBody(c.body, applySeat(restPose(), sp), out);
    let caseBad = false;
    PARTS.forEach((name, k) => {
      const g = geos[k];
      if (!g || name === 'headwear') return;
      const m = out[k], pos = g.attributes.position;
      if (Math.abs(m.determinant()) < 1e-12) return; // a part this body doesn't have
      let margin = Infinity;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m);
        const floor = -v.z <= c.front ? c.seatTop : c.footTop; // the root faces −z
        margin = Math.min(margin, v.y + sp.rootY - floor);
      }
      if (margin < worst) { worst = margin; where = `${c.name} ${name}`; }
      if (margin < -0.01) caseBad = true;
    });
    if (caseBad) bad++;
  }
  return { name: 'seatCheck', ok: bad === 0, cases: cases.length, bad, worst: +fmt(worst), detail: `${cases.length} seats (water steps × outfits, bench sitters); ${bad} with a body part more than 1 cm into its seat or step (closest ${fmt(worst)} m: ${where})` };
}

export function runChecks(extra = []) {
  const results = [shoreCheck(), damCheck(), hillSafety(), ...extra.map((f) => f())];
  for (const r of results) console[r.ok ? 'info' : 'warn'](`[check] ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${r.detail}`);
  return results;
}

export { nearestS };
