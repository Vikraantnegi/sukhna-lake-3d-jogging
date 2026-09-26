/* ------------------------------------------------------------------ *
 * Geodesy and 2D polyline helpers for the pipeline.
 *
 * ENU: east / north metres on the WGS84 tangent plane at the origin,
 * computed exactly through ECEF (not an equirectangular shortcut), with an
 * exact inverse.  At a few kilometres this is millimetre-exact, which is
 * more than the data deserves, but it costs nothing.
 * ------------------------------------------------------------------ */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const D2R = Math.PI / 180;

function ecef(lat, lon, h = 0) {
  const la = lat * D2R, lo = lon * D2R;
  const s = Math.sin(la), c = Math.cos(la);
  const N = A / Math.sqrt(1 - E2 * s * s);
  return [(N + h) * c * Math.cos(lo), (N + h) * c * Math.sin(lo), (N * (1 - E2) + h) * s];
}

/** Build a projector around an origin (lat0, lon0). */
export function enuProjector(lat0, lon0) {
  const la = lat0 * D2R, lo = lon0 * D2R;
  const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  const o = ecef(lat0, lon0, 0);
  /** [east, north] in metres. */
  const toENU = (lat, lon) => {
    const p = ecef(lat, lon, 0);
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    return [-so * dx + co * dy, -sl * co * dx - sl * so * dy + cl * dz];
  };
  /** Inverse: [lat, lon] of an ENU point on the ellipsoid (Newton on toENU). */
  const toLatLon = (e, n) => {
    let lat = lat0 + n / 110574, lon = lon0 + e / (111320 * Math.cos(la));
    for (let i = 0; i < 6; i++) {
      const [pe, pn] = toENU(lat, lon);
      const [pe2, pn2] = toENU(lat + 1e-5, lon);
      const [pe3, pn3] = toENU(lat, lon + 1e-5);
      const j = [[(pe2 - pe) / 1e-5, (pe3 - pe) / 1e-5], [(pn2 - pn) / 1e-5, (pn3 - pn) / 1e-5]];
      const det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
      const re = e - pe, rn = n - pn;
      lat += (j[1][1] * re - j[0][1] * rn) / det;
      lon += (-j[1][0] * re + j[0][0] * rn) / det;
      if (Math.abs(re) + Math.abs(rn) < 1e-4) break;
    }
    return [lat, lon];
  };
  return { toENU, toLatLon };
}

/* ------------------------------ polylines ------------------------------ */

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Cumulative arc length of a polyline. */
export function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  return s;
}

export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

/** Point at arc length s along a polyline (with precomputed arc lengths). */
export function pointAt(pts, S, s) {
  if (s <= 0) return pts[0].slice();
  if (s >= S[S.length - 1]) return pts[pts.length - 1].slice();
  let lo = 0, hi = S.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / (S[hi] - S[lo] || 1);
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t, pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t];
}

/** Nearest point on a polyline: { d, s, i, t, p }. */
export function nearestOnPolyline(p, pts, S = arcLengths(pts)) {
  let best = { d: Infinity, s: 0, i: 0, t: 0, p: pts[0] };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    const q = [a[0] + dx * t, a[1] + dy * t];
    const d = dist(p, q);
    if (d < best.d) best = { d, s: S[i - 1] + t * Math.sqrt(L2), i, t, p: q };
  }
  return best;
}

/** Douglas-Peucker simplification (keeps endpoints). */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy) || 1e-12;
    let dmax = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (pts[i][0] - A[0]) - dx * (pts[i][1] - A[1])) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Douglas-Peucker for a closed ring (no repeated end point): split at the
 * vertex farthest from the first, simplify both halves, rejoin. */
export function simplifyRing(ring, tol) {
  if (ring.length < 4) return ring.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = dist(ring[0], ring[i]); if (d > fd) { fd = d; far = i; } }
  const a = simplify(ring.slice(0, far + 1), tol);
  const b = simplify([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

/** Signed area (positive = counter-clockwise in a y-up frame). */
export function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
  return a / 2;
}

export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/**
 * Join OSM way geometries (arrays of points) into closed rings, the way a
 * multipolygon's members have to be stitched.  Endpoints are matched
 * within `eps` metres.
 */
export function stitchRings(lines, eps = 0.5) {
  const pool = lines.map((l) => l.slice());
  const rings = [];
  while (pool.length) {
    let cur = pool.pop();
    let guard = 0;
    while (dist(cur[0], cur[cur.length - 1]) > eps && guard++ < 1000) {
      const end = cur[cur.length - 1];
      let k = pool.findIndex((l) => dist(l[0], end) <= eps);
      if (k >= 0) { cur = cur.concat(pool.splice(k, 1)[0].slice(1)); continue; }
      k = pool.findIndex((l) => dist(l[l.length - 1], end) <= eps);
      if (k >= 0) { cur = cur.concat(pool.splice(k, 1)[0].reverse().slice(1)); continue; }
      break;
    }
    rings.push(cur);
  }
  return rings;
}
