/* ------------------------------------------------------------------ *
 * The straightening map: real ENU metres  ->  planet authoring (x, z).
 *
 * Why not the plan's normal projection
 * ------------------------------------
 * The dam promenade is concave toward the lake, so its normals meet
 * 600-1000 m out, well short of the far shore (1.2-1.8 km).  Projecting
 * along normals folds the lake over itself there, however much the spine
 * is smoothed; projecting along rays through one centre point avoids the
 * fold but mirrors the far shore left-to-right.
 *
 * What this does instead
 * ----------------------
 * The promenade, extended at both ends along the line joining its ends,
 * cuts a disc of radius Rb into two halves: D+ (the lake side) and D-
 * (the city side).  Each half is mapped onto the rectangle
 * [0, L] x [0, 1] by a *harmonic* map (X, Psi):
 *
 *     promenade      ->  X = s (arc length, 1:1),  Psi = 0
 *     end rays       ->  X = 0 (east end) or L (west end), Psi = t
 *     the outer arc  ->  X = L(1 - tau),           Psi = 1
 *
 * By the Rado-Kneser-Choquet theorem a harmonic map of a Jordan domain
 * onto a convex one with a homeomorphic boundary map is a diffeomorphism:
 * it cannot fold, and left stays left on both shores.  The discrete
 * version is checked, not assumed (`foldCheck`).
 *
 * Psi is then calibrated into metres: c(s) = dPsi/dn at the promenade, and
 * u = Psi / c(X) is a "harmonic distance" equal to real distance near the
 * walk.  Finally z = +-f(u), with f the identity to 60 m and compressive
 * beyond (see `compression`).  For fixed X, z is monotone in Psi, so the
 * calibration cannot introduce a fold either.
 *
 * Solved by SOR on three nested grids (100 m -> 25 m -> 5 m), each level
 * seeded from the one before.  Nodes just across the cut are Dirichlet
 * "ghosts" carrying the boundary value of their nearest cut point; on the
 * finest level the Psi ghosts are corrected to -c * distance so the
 * zero line sits on the promenade and not half a cell off it.
 * ------------------------------------------------------------------ */
import { arcLengths, pointAt, nearestOnPolyline, dist } from './geo.mjs';

class Grid {
  constructor(x0, y0, h, nx, ny) {
    Object.assign(this, { x0, y0, h, nx, ny });
    this.n = nx * ny;
  }
  x(i) { return this.x0 + i * this.h; }
  y(j) { return this.y0 + j * this.h; }
}

/** Bilinear sample of a field on a grid; returns NaN outside. */
function bilinear(g, F, px, py) {
  const fx = (px - g.x0) / g.h, fy = (py - g.y0) / g.h;
  const i = Math.floor(fx), j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return NaN;
  const ax = fx - i, ay = fy - j, k = j * g.nx + i;
  return (F[k] * (1 - ax) + F[k + 1] * ax) * (1 - ay) + (F[k + g.nx] * (1 - ax) + F[k + g.nx + 1] * ax) * ay;
}

export function buildStraightener({ spine, Rb = 6000, levels = [100, 25, 5], fineBox, log = () => {} }) {
  const S = arcLengths(spine);
  const L = S[S.length - 1];
  const E = spine[0], W = spine[spine.length - 1];
  const M = [(E[0] + W[0]) / 2, (E[1] + W[1]) / 2];
  const dEW = dist(E, W);
  const u = [(E[0] - W[0]) / dEW, (E[1] - W[1]) / dEW];
  const AE = [M[0] + u[0] * Rb, M[1] + u[1] * Rb];
  const AW = [M[0] - u[0] * Rb, M[1] - u[1] * Rb];
  const rayLen = Rb - dEW / 2;

  // the lake side is to the right of the direction of travel (E -> W)
  const mid = pointAt(spine, S, L / 2), mid2 = pointAt(spine, S, L / 2 + 1);
  const rightN = [mid2[1] - mid[1], -(mid2[0] - mid[0])];
  let v = [-u[1], u[0]];
  if (v[0] * rightN[0] + v[1] * rightN[1] < 0) v = [-v[0], -v[1]];
  const thW = Math.atan2(-u[1], -u[0]);
  // sweep from A_W through +v (side +1) or -v (side -1) to A_E
  const thV = Math.atan2(v[1], v[0]);
  let dPlus = thV - thW;
  while (dPlus <= 0) dPlus += 2 * Math.PI;
  while (dPlus > 2 * Math.PI) dPlus -= 2 * Math.PI;
  const sweep = { 1: dPlus < Math.PI ? Math.PI : -Math.PI };
  sweep[-1] = -sweep[1];

  /** Polygon of D+ (for the side test). */
  const arcPts = (side, n = 720) => {
    const a = [];
    for (let k = 0; k <= n; k++) {
      const th = thW + sweep[side] * (k / n);
      a.push([M[0] + Rb * Math.cos(th), M[1] + Rb * Math.sin(th)]);
    }
    return a; // A_W ... A_E
  };
  const polyPlus = [AW, ...spine.slice().reverse().map((p) => p), AE, ...arcPts(1).reverse().slice(1, -1)];
  // (AW -> W -> spine reversed -> E -> AE -> arc back to AW)

  /** Side of the cut: +1 lake side, -1 city side, 0 outside the disc. */
  function sideOf(p) {
    if (dist(p, M) >= Rb) return 0;
    let inside = false;
    const r = polyPlus;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? 1 : -1;
  }

  // the cut as one polyline, with a parameter at every vertex
  const cut = [AW, ...spine.slice().reverse(), AE];
  const cutS = arcLengths(cut);
  /** Boundary value (X, Psi) at the nearest cut point, and its distance. */
  function cutValue(p) {
    const nr = nearestOnPolyline(p, cut, cutS);
    const s = nr.s;
    if (s <= rayLen) return { X: L, P: (rayLen - s) / rayLen, d: nr.d, onSpine: false, sp: L };
    if (s >= rayLen + L) return { X: 0, P: (s - rayLen - L) / rayLen, d: nr.d, onSpine: false, sp: 0 };
    const sp = L - (s - rayLen);
    return { X: sp, P: 0, d: nr.d, onSpine: true, sp };
  }
  /** Boundary value on the outer arc for a point outside the disc. */
  function arcValue(p, side) {
    let th = Math.atan2(p[1] - M[1], p[0] - M[0]) - thW;
    // fold into the sweep direction
    const sgn = Math.sign(sweep[side]);
    th *= sgn;
    while (th < 0) th += 2 * Math.PI;
    while (th >= 2 * Math.PI) th -= 2 * Math.PI;
    let tau = th / Math.PI;
    if (tau > 1) tau = tau > 1.5 ? 0 : 1; // the other half: clamp to the nearer end
    return { X: L * (1 - tau), P: 1 };
  }

  /* ---------------------------- solving ---------------------------- */

  const fields = { 1: [], [-1]: [] };
  let prev = null;
  const calib = { 1: null, [-1]: null };

  for (let li = 0; li < levels.length; li++) {
    const h = levels[li];
    let g;
    if (li < levels.length - 1 || !fineBox) {
      const half = Rb + 2 * h;
      const n = Math.ceil((2 * half) / h) + 1;
      g = new Grid(M[0] - half, M[1] - half, h, n, n);
    } else {
      const [x0, y0, x1, y1] = fineBox;
      g = new Grid(x0, y0, h, Math.ceil((x1 - x0) / h) + 1, Math.ceil((y1 - y0) / h) + 1);
    }
    const isFine = li === levels.length - 1;
    const side = new Int8Array(g.n);
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) side[j * g.nx + i] = sideOf([g.x(i), g.y(j)]);

    for (const sg of [1, -1]) {
      const X = new Float64Array(g.n), P = new Float64Array(g.n);
      const fixed = new Uint8Array(g.n);
      const active = [];
      const ghostInfo = new Map();
      for (let j = 0; j < g.ny; j++) {
        for (let i = 0; i < g.nx; i++) {
          const k = j * g.nx + i;
          const border = i === 0 || j === 0 || i === g.nx - 1 || j === g.ny - 1;
          if (side[k] === sg && !border) { active.push(k); continue; }
          // a ghost if any of the 8 neighbours is on this side
          let near = side[k] === sg;
          for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1 && !near; di++) {
            const ii = i + di, jj = j + dj;
            if (ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny && side[jj * g.nx + ii] === sg) near = true;
          }
          if (!near) continue;
          fixed[k] = 1;
          const p = [g.x(i), g.y(j)];
          if (side[k] === sg && prev) {
            // a border node of a nested grid: take the coarser solution
            X[k] = bilinear(prev.g, prev.f[sg].X, p[0], p[1]);
            P[k] = bilinear(prev.g, prev.f[sg].P, p[0], p[1]);
          } else if (side[k] === 0) {
            const b = arcValue(p, sg); X[k] = b.X; P[k] = b.P;
          } else {
            const b = cutValue(p); X[k] = b.X; P[k] = b.P;
            if (b.onSpine) ghostInfo.set(k, b);
          }
        }
      }
      const act = Int32Array.from(active);
      // seed from the coarser level
      for (const k of act) {
        const i = k % g.nx, j = (k / g.nx) | 0;
        if (prev) {
          const x = bilinear(prev.g, prev.f[sg].X, g.x(i), g.y(j));
          const y = bilinear(prev.g, prev.f[sg].P, g.x(i), g.y(j));
          X[k] = Number.isFinite(x) ? x : L / 2;
          P[k] = Number.isFinite(y) ? y : 0.5;
        } else { X[k] = L / 2; P[k] = 0.5; }
      }
      const nx = g.nx;
      const sor = (maxIt, tol) => {
        const nside = Math.sqrt(act.length);
        const w = 2 / (1 + Math.sin(Math.PI / Math.max(8, nside)));
        let it = 0, dmax = 0;
        for (; it < maxIt; it++) {
          dmax = 0;
          for (let a = 0; a < act.length; a++) {
            const k = act[a];
            const xn = (X[k - 1] + X[k + 1] + X[k - nx] + X[k + nx]) * 0.25;
            const pn = (P[k - 1] + P[k + 1] + P[k - nx] + P[k + nx]) * 0.25;
            const dx = w * (xn - X[k]), dp = w * (pn - P[k]);
            X[k] += dx; P[k] += dp;
            const m = Math.abs(dx) / L + Math.abs(dp);
            if (m > dmax) dmax = m;
          }
          if (dmax < tol) break;
        }
        return { it, dmax, w };
      };
      const t0 = Date.now();
      let r = sor(isFine ? 4000 : 6000, 1e-9);
      if (isFine) {
        // ghost correction: put Psi's zero line on the promenade itself
        const c = calibrate(g, X, P, sg);
        for (const [k, b] of ghostInfo) P[k] = -b.d * c(b.sp);
        r = sor(4000, 1e-10);
        calib[sg] = calibrate(g, X, P, sg);
      }
      log(`  level ${h} m, side ${sg > 0 ? '+' : '-'}: ${g.nx}x${g.ny}, ${act.length} active, ${r.it} its, resid ${r.dmax.toExponential(1)}, ${Date.now() - t0} ms`);
      fields[sg][li] = { X, P, fixed };
    }
    prev = { g, f: { 1: fields[1][li], [-1]: fields[-1][li] } };
    fields[1][li].g = g; fields[-1][li].g = g;
    fields[1][li].side = side; fields[-1][li].side = side;
  }

  /** dPsi/dn along the promenade, sampled every 5 m and smoothed; returns c(s). */
  function calibrate(g, X, P, sg) {
    const step = 5, n = Math.ceil(L / step) + 1, raw = new Float64Array(n);
    const probe = 15;
    for (let k = 0; k < n; k++) {
      const s = Math.min(L, k * step);
      const a = pointAt(spine, S, Math.max(0, s - 15)), b = pointAt(spine, S, Math.min(L, s + 15));
      const t = [b[0] - a[0], b[1] - a[1]], tl = Math.hypot(t[0], t[1]) || 1;
      const nr = [(t[1] / tl) * sg, (-t[0] / tl) * sg]; // right normal for +, left for -
      const p = pointAt(spine, S, s);
      const q = [p[0] + nr[0] * probe, p[1] + nr[1] * probe];
      raw[k] = bilinear(g, P, q[0], q[1]) / probe;
    }
    // moving average over +-40 m
    const sm = new Float64Array(n), win = 8;
    for (let k = 0; k < n; k++) {
      let acc = 0, cnt = 0;
      for (let d = -win; d <= win; d++) { const kk = k + d; if (kk >= 0 && kk < n && raw[kk] > 0) { acc += raw[kk]; cnt++; } }
      sm[k] = acc / (cnt || 1);
    }
    return (s) => {
      const f = Math.max(0, Math.min(n - 1, s / step));
      const i = Math.min(n - 2, Math.floor(f)), a = f - i;
      return sm[i] * (1 - a) + sm[i + 1] * a;
    };
  }

  /** Raw harmonic coordinates of a real point: { side, X, P } (finest grid available). */
  function harmonic(p) {
    const sg = sideOf(p);
    if (!sg) return null;
    for (let li = levels.length - 1; li >= 0; li--) {
      const f = fields[sg][li];
      const X = bilinear(f.g, f.X, p[0], p[1]);
      if (!Number.isFinite(X)) continue;
      return { side: sg, X, P: bilinear(f.g, f.P, p[0], p[1]), level: li };
    }
    return null;
  }

  /** Harmonic distance in metres (signed: + lake side). */
  function uOf(p) {
    const hmc = harmonic(p);
    if (!hmc) return null;
    const c = calib[hmc.side](Math.max(0, Math.min(L, hmc.X)));
    return { side: hmc.side, x: hmc.X, u: hmc.side * Math.max(0, hmc.P) / c, P: hmc.P, level: hmc.level };
  }

  /** Harmonic coordinates with the side forced (ghost values continue a cell past the cut). */
  function harmonicSide(p, sg) {
    for (let li = levels.length - 1; li >= 0; li--) {
      const f = fields[sg][li];
      const X = bilinear(f.g, f.X, p[0], p[1]);
      if (!Number.isFinite(X)) continue;
      return { X, P: bilinear(f.g, f.P, p[0], p[1]) };
    }
    return null;
  }

  /** The outer-arc point for a given X on a side, and its outward normal. */
  function arcPoint(X, sg) {
    const th = thW + sweep[sg] * (1 - X / L);
    const d = [Math.cos(th), Math.sin(th)];
    return { p: [M[0] + Rb * d[0], M[1] + Rb * d[1]], out: d };
  }

  return { L, S, E, W, M, u, Rb, sideOf, cutValue, harmonic, harmonicSide, uOf, calib, fields, levels, AE, AW, arcPoint };
}

/* ---------------------------- compression ---------------------------- */

/**
 * z = f(u): the identity for |u| <= 60, then logarithmic,
 *     f(u) = 60 + A ln(1 + (u - 60) / A),
 * which is C1 at 60 m (slope 1).  A is chosen per side so a target real
 * distance lands at a target z (the far shore's median on the lake side).
 */
export function compression(A) {
  const f = (u) => (u <= 60 ? u : 60 + A * Math.log(1 + (u - 60) / A));
  const inv = (z) => (z <= 60 ? z : 60 + A * (Math.exp((z - 60) / A) - 1));
  return { f, inv, A };
}

/** Solve A so that f(u) = z (bisection; f is monotone in A). */
export function fitCompression(u, z) {
  if (u <= z) return compression(1e9);
  let lo = 0.1, hi = 1e6;
  for (let i = 0; i < 100; i++) {
    const m = Math.sqrt(lo * hi);
    if (compression(m).f(u) > z) hi = m; else lo = m;
  }
  return compression(Math.sqrt(lo * hi));
}

/**
 * Inverse of the straightening map: planet (x, z) -> real ENU point.
 * Newton iteration on the harmonic coordinates, seeded from a bucket
 * lookup of every grid node's image.  Beyond the outer arc (Psi >= 1) the
 * Past Psi = Pmax (near the outer arc, where the discrete map is least
 * trustworthy) the point is extrapolated radially from the Pmax point and
 * flagged `beyond`.
 */
export function makeInverse(st, comp, Pmax = 0.95) {
  const B = 8;
  const buckets = { 1: new Map(), [-1]: new Map() };
  for (const sg of [1, -1]) {
    for (let li = 0; li < st.levels.length; li++) {
      const F = st.fields[sg][li], g = F.g;
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
        const k = j * g.nx + i;
        if (F.side[k] !== sg || F.fixed[k]) continue;
        const X = F.X[k];
        const c = st.calib[sg](Math.max(0, Math.min(st.L, X)));
        const z = sg * comp.f(Math.max(0, F.P[k]) / c);
        buckets[sg].set(Math.floor(X / B) + ',' + Math.floor(z / B), [g.x(i), g.y(j)]);
      }
    }
  }
  function seed(sg, x, z) {
    const bx = Math.floor(x / B), bz = Math.floor(z / B);
    for (let r = 0; r < 60; r++) {
      let best = null, bd = Infinity;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const p = buckets[sg].get((bx + dx) + ',' + (bz + dz));
        if (p) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = p; } }
      }
      if (best) return best;
    }
    return null;
  }
  return function inverse(x, z) {
    if (x < 0 || x > st.L) return null;
    // the side edges X = 0 and X = L are whole rays; stay a hair inside them
    x = Math.max(0.25, Math.min(st.L - 0.25, x));
    const sg = z >= 0 ? 1 : -1;
    const u = comp.inv(Math.abs(z));
    const c = st.calib[sg](x);
    const Pt = u * c;
    if (Pt >= Pmax) {
      const base = solve(sg, x, Pmax, c, seed(sg, x, sg * comp.f(Pmax / c)));
      if (!base) return null;
      const o = [base.p[0] - st.M[0], base.p[1] - st.M[1]], ol = Math.hypot(o[0], o[1]) || 1;
      const ext = u - Pmax / c;
      return { p: [base.p[0] + (o[0] / ol) * ext, base.p[1] + (o[1] / ol) * ext], beyond: true, err: base.err };
    }
    return solve(sg, x, Pt, c, seed(sg, x, z));
  };

  function solve(sg, x, Pt, c, p) {
    if (!p) return null;
    let err = Infinity;
    for (let it = 0; it < 30; it++) {
      const h0 = st.harmonicSide(p, sg);
      if (!h0) return null;
      const fx = h0.X - x, fp = h0.P - Pt;
      err = Math.abs(fx) + Math.abs(fp) / c;
      if (err < 0.01) break;
      const hx = st.harmonicSide([p[0] + 0.5, p[1]], sg), hy = st.harmonicSide([p[0], p[1] + 0.5], sg);
      if (!hx || !hy) return null;
      const a = (hx.X - h0.X) / 0.5, b = (hy.X - h0.X) / 0.5, cc = (hx.P - h0.P) / 0.5, d = (hy.P - h0.P) / 0.5;
      const det = a * d - b * cc;
      if (!det) break;
      let de = -(d * fx - b * fp) / det, dn = -(-cc * fx + a * fp) / det;
      const len = Math.hypot(de, dn);
      if (len > 250) { de *= 250 / len; dn *= 250 / len; }
      p = [p[0] + de, p[1] + dn];
    }
    return { p, beyond: false, err };
  }
}
