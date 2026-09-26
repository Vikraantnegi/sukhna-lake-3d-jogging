import * as THREE from 'three';
import data from '../data/sukhna.data.json';

/* ------------------------------------------------------------------ *
 * The world frame.
 *
 * Sukhna is built flat, at its real shape and 1:1 (plan §4).  The data is
 * in ENU metres [east, north] about the promenade midpoint, with heights
 * above the lake level; three.js gets
 *
 *     x = east,   y = up,   z = -north
 *
 * which is a proper rotation of ENU (nothing is mirrored).  This module
 * owns that convention, plus the promenade's spine frame: arc length s
 * runs from the east end (s = 0, Garden of Silence) to the west end
 * (s = L, boat club), and the lake is on the right of that direction.
 * ------------------------------------------------------------------ */

export { data };

export const L = data.promenade.length;
export const LAKE_LEVEL_ASL = data.lakeLevelASL;

/** ENU (e, n) and height y -> world vector. */
export const toWorld = (e, n, y = 0, out = new THREE.Vector3()) => out.set(e, y, -n);
/** World vector -> [e, n]. */
export const toENU = (v) => [v.x, -v.z];

/** Unit vector toward a compass azimuth (degrees clockwise from north), world axes. */
export function azimuthDir(azDeg, elevDeg = 0, out = new THREE.Vector3()) {
  const a = THREE.MathUtils.degToRad(azDeg), e = THREE.MathUtils.degToRad(elevDeg);
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
}
/** Camera yaw (rotation about +y, three convention) that looks along an azimuth. */
export const yawForAzimuth = (azDeg) => -THREE.MathUtils.degToRad(azDeg);
/** Azimuth (degrees) a camera yaw looks along. */
export const azimuthForYaw = (yaw) => ((-THREE.MathUtils.radToDeg(yaw) % 360) + 360) % 360;

/* -------------------------------- spine -------------------------------- */

const SP = data.promenade.pts;
const STEP = data.promenade.step;

/**
 * The spine frame at arc length s: position [e, n], unit tangent t
 * (direction of travel, east end -> west end) and unit normal nL toward
 * the lake (the right-hand side of t).
 */
export function spineAt(s) {
  const f = THREE.MathUtils.clamp(s, 0, L) / STEP;
  const i = Math.min(SP.length - 2, Math.floor(f)), a = Math.min(1, f - i);
  const p0 = SP[i], p1 = SP[i + 1];
  const e = p0[0] + (p1[0] - p0[0]) * a, n = p0[1] + (p1[1] - p0[1]) * a;
  // tangent from a +-6 m chord, so it turns smoothly between samples
  const q0 = SP[Math.max(0, i - 1)], q1 = SP[Math.min(SP.length - 1, i + 2)];
  let te = q1[0] - q0[0], tn = q1[1] - q0[1];
  const tl = Math.hypot(te, tn) || 1;
  te /= tl; tn /= tl;
  return { e, n, te, tn, ne: tn, nn: -te };
}

/** Nearest point on the spine to (e, n): { s, d, side } with d >= 0 and side +1 lake / -1 city. */
export function nearestS(e, n) {
  let best = Infinity, bi = 0;
  for (let i = 0; i < SP.length; i += 4) {
    const d = (SP[i][0] - e) ** 2 + (SP[i][1] - n) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  best = Infinity;
  let bs = 0, bd = 0;
  for (let i = Math.max(0, bi - 5); i < Math.min(SP.length - 1, bi + 5); i++) {
    const a = SP[i], b = SP[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = THREE.MathUtils.clamp(((e - a[0]) * dx + (n - a[1]) * dy) / l2, 0, 1);
    const px = a[0] + dx * t, py = a[1] + dy * t;
    const d = (px - e) ** 2 + (py - n) ** 2;
    if (d < best) {
      best = d; bs = (i + t) * STEP;
      bd = (dx * (n - a[1]) - dy * (e - a[0])) < 0 ? 1 : -1; // right of travel = lake
    }
  }
  return { s: Math.min(L, bs), d: Math.sqrt(best), side: bd };
}

/* -------------------------------- lake -------------------------------- */

const OUTER = data.lake.outer;
const INNER = data.lake.inner;
const bbox = (ring) => ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const OB = bbox(OUTER);

function inRing(e, n, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > n) !== (b[1] > n) && e < ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Is (e, n) on the real lake's water? */
export function inLake(e, n) {
  if (e < OB[0] || e > OB[2] || n < OB[1] || n > OB[3]) return false;
  return inRing(e, n, OUTER) && !INNER.some((r) => inRing(e, n, r));
}

/** Every shoreline edge (outer ring and islands) as [ax, ay, bx, by]. */
const EDGES = [];
for (const ring of [OUTER, ...INNER]) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) EDGES.push([ring[j][0], ring[j][1], ring[i][0], ring[i][1]]);
}
export const SHORE_EDGES = EDGES;

/**
 * Signed distance (m) from (e, n) to the real shoreline: negative on the
 * water, positive on land.  Beyond `cap` metres from the lake's bounding
 * box it just returns `cap`, which is all the callers need.
 */
export function shoreDist(e, n, cap = 200) {
  if (e < OB[0] - cap || e > OB[2] + cap || n < OB[1] - cap || n > OB[3] + cap) return cap;
  let best = Infinity;
  for (const [ax, ay, bx, by] of EDGES) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    const d = (ax + dx * t - e) ** 2 + (ay + dy * t - n) ** 2;
    if (d < best) best = d;
  }
  best = Math.sqrt(best);
  return inLake(e, n) ? -best : Math.min(best, cap);
}

/** Distance along the ray (e, n) + t (de, dn) to the first shoreline crossing, or NaN within maxT. */
export function rayToShore(e, n, de, dn, maxT = 60) {
  let best = NaN;
  for (const [ax, ay, bx, by] of EDGES) {
    const sx = bx - ax, sy = by - ay;
    const den = de * sy - dn * sx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - e) * sy - (ay - n) * sx) / den;
    const u = ((ax - e) * dn - (ay - n) * de) / den;
    if (t > 0 && t <= maxT && u >= 0 && u <= 1 && !(t >= best)) best = t;
  }
  return best;
}

/** The lake's centroid (area-weighted), for the overview camera. */
export const LAKE_CENTRE = (() => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = OUTER.length - 1; i < OUTER.length; j = i++) {
    const f = OUTER[j][0] * OUTER[i][1] - OUTER[i][0] * OUTER[j][1];
    a += f; cx += (OUTER[j][0] + OUTER[i][0]) * f; cy += (OUTER[j][1] + OUTER[i][1]) * f;
  }
  return [cx / (3 * a), cy / (3 * a)];
})();
