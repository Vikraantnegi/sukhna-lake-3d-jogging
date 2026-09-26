import { data, L, spineAt, nearestS, shoreDist, inLake } from './frame.js';
import { groundAt, NEAR } from './terrain.js';
import { DAM, GAPS } from './dam.js';

/* ------------------------------------------------------------------ *
 * Where you can stand and what stops you (plan §6, Phase 4).
 *
 *   surfaceAt   the height you stand at: a deck (the boat-club jetty, the
 *               regulator footbridge) where there is one, else the ground
 *               (which already includes the dam)
 *   move        try a step and slide along whatever blocks it
 *
 * Blocked: the water (half a metre short of the real edge), the parapet
 * (except at the three steps down to the water), every OSM building
 * footprint (a 100 m spatial hash of oriented boxes, 0.35 m margin), and the
 * boat-ticket shack on the walk.
 * ------------------------------------------------------------------ */

export function createCollider(world) {
  // decks: rectangles in the spine frame or along a line
  const decks = [];
  const jetty = world.landmarks?.club?.jetty;
  if (jetty) {
    const f = spineAt(jetty.s);
    decks.push({ kind: 'jetty', e: f.e + f.ne * (jetty.d0 + jetty.d1) / 2, n: f.n + f.nn * (jetty.d0 + jetty.d1) / 2, ue: f.ne, un: f.nn, half: (jetty.d1 - jetty.d0) / 2, w: 3.0, y: jetty.deckY });
  }
  const bridge = data.features.paths.find((p) => p.bridge);
  if (bridge) {
    const a = bridge.p[0], b = bridge.p[bridge.p.length - 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    decks.push({ kind: 'bridge', e: (a[0] + b[0]) / 2, n: (a[1] + b[1]) / 2, ue: (b[0] - a[0]) / len, un: (b[1] - a[1]) / len, half: len / 2 + 1, w: 1.5, y: world.landmarks?.regulatorDeckY ?? 3.3 });
  }
  // a pier stair (the jetty's) stands over water: its footprint is a deck whose height is the tread's
  for (const st of world.dam?.waterStairs || []) {
    if (!st.pier) continue;
    const f = spineAt(st.s), dm = (st.from.d + st.to.d) / 2;
    decks.push({ kind: 'stairs', e: f.e + f.ne * dm, n: f.n + f.nn * dm, ue: f.ne, un: f.nn, half: (st.to.d - st.from.d) / 2, w: st.width / 2 - 0.1, y: 0 });
  }
  // a flight is built along the straight normal from its spine point (dam.js), so its treads
  // are looked up in that frame -- not by nearestS, which follows the curved spine and, on a
  // long pier over a bend, disagrees with the geometry by metres
  const frames = [...(world.dam?.waterStairs || []), ...(world.dam?.cityStairs || [])].map((st) => ({ st, f: spineAt(st.s) }));
  const FOOT = 0.1; // half a foot's length: you stand on the highest step your foot is on
  const treadAt = (e, n) => {
    for (const { st, f } of frames) {
      if (!st.treads) continue;
      const de = e - f.e, dn = n - f.n;
      const u = de * f.ne + dn * f.nn, v = -de * f.nn + dn * f.ne;
      if (Math.abs(v) > st.width / 2) continue;
      // the flight's extent along its line (city flights run toward −d, the others toward +d)
      st.span ||= [Math.min(st.landing?.d0 ?? Infinity, ...st.treads.map((q) => q.d0)), Math.max(...st.treads.map((q) => q.d1))];
      if (u < st.span[0] - FOOT - 0.05 || u > st.span[1] + FOOT + 0.05) continue; // (+ the lip)
      const dir = st.dir ?? 1;
      // the paved landing through the parapet counts too (it overhangs the first tread by 5 cm)
      // a foot, not a point: the highest tread (or landing) within ±FOOT along the flight
      let best = st.landing && u + FOOT >= st.landing.d0 && u - FOOT < st.landing.d1 ? { y: st.from.y + 0.02, d0: st.landing.d0, d1: st.landing.d1 } : null;
      for (const q of st.treads) {
        // the tread as drawn, with its 5 cm lip downhill
        const lo = dir > 0 ? q.d0 : q.d0 - 0.05, hi = dir > 0 ? q.d1 + 0.05 : q.d1;
        if (u + FOOT >= lo && u - FOOT < hi && (!best || q.y > best.y)) best = q;
      }
      if (best) return best;
    }
    return null;
  };
  const deckAt = (e, n) => {
    for (const d of decks) {
      const de = e - d.e, dn = n - d.n;
      const u = de * d.ue + dn * d.un, v = -de * d.un + dn * d.ue;
      if (Math.abs(u) <= d.half && Math.abs(v) <= d.w) return d;
    }
    return null;
  };

  // buildings: oriented boxes in a 100 m hash
  const grid = new Map();
  for (const b of data.features.buildings) {
    const r = Math.hypot(b.l, b.w) / 2 + 1;
    for (let x = Math.floor((b.c[0] - r) / 100); x <= Math.floor((b.c[0] + r) / 100); x++)
      for (let y = Math.floor((b.c[1] - r) / 100); y <= Math.floor((b.c[1] + r) / 100); y++) {
        const k = x + ',' + y;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(b);
      }
  }
  const inBuilding = (e, n) => {
    const list = grid.get(Math.floor(e / 100) + ',' + Math.floor(n / 100));
    if (!list) return false;
    for (const b of list) {
      const de = e - b.c[0], dn = n - b.c[1], ca = Math.cos(b.a), sa = Math.sin(b.a);
      const u = de * ca + dn * sa, v = -de * sa + dn * ca;
      if (Math.abs(u) < b.l / 2 + 0.35 && Math.abs(v) < b.w / 2 + 0.35) return true;
    }
    return false;
  };

  // the boat-ticket shack on the walk (landmarks.js), with a jogger's margin
  const shack = world.landmarks?.club?.shack;
  const inShack = (e, n) => {
    if (!shack) return false;
    const de = e - shack.e, dn = n - shack.n;
    return Math.abs(de * shack.ue + dn * shack.un) < shack.hu + 0.3 && Math.abs(-de * shack.un + dn * shack.ue) < shack.hv + 0.3;
  };

  /** Is (e, n) somewhere you may stand? */
  // the edge of the world: 20 m inside the detailed terrain (the playtest ran off it)
  const [ex0, ey0, ex1, ey1] = NEAR.rect;
  function free(e, n) {
    if (e < ex0 + 20 || e > ex1 - 20 || n < ey0 + 20 || n > ey1 - 20) return false;
    if (deckAt(e, n)) return true;
    if (inShack(e, n)) return false;
    if (shoreDist(e, n, 5) < 0.5) return false;
    const ns = nearestS(e, n);
    if (ns.side > 0 && ns.s > 0.5 && ns.s < L - 0.5) {
      const d = ns.d;
      if (d > DAM.parIn - 0.2 && d < DAM.parOut + 0.1 && !GAPS.some((w) => Math.abs(w - ns.s) < 1.4)) return false;
    }
    return !inBuilding(e, n);
  }

  return {
    decks,
    free,
    /** On a flight of steps (for the stair-walking pace)? */
    onFlight(e, n) { return !!treadAt(e, n); },
    /** The height you stand at. */
    surfaceAt(e, n) {
      const d = deckAt(e, n);
      // the steps first: where the jetty stair's foot overlaps the jetty, the higher wins
      const tr = treadAt(e, n);
      if (d && d.kind !== 'stairs') return tr ? Math.max(tr.y, d.y) : d.y;
      // never under the water's surface -- but dry land below lake level (the city side of the
      // dam is ~0.5-3 m lower) is where it is (the playtest caught the jogger floating there)
      const g0 = groundAt(e, n), g = inLake(e, n) ? Math.max(g0, 0) : g0;
      // the steps down to the water: stand on the treads, not the slope under them
      if (tr) return d ? tr.y : Math.max(g, tr.y);
      return g;
    },
    /** Move from (e, n) by (de, dn), sliding along whatever blocks the step. */
    move(e, n, de, dn) {
      // never onto open water (a deck is not open water), whatever else says yes
      const wet = (x, y) => inLake(x, y) && !deckAt(x, y);
      if (wet(e + de, n + dn) && !wet(e, n)) return [e, n, true];
      if (free(e + de, n + dn)) return [e + de, n + dn, false];
      // standing somewhere not free (the water's edge of a flight, after a teleport):
      // any step away from the water is allowed, so nobody is ever trapped
      if (!free(e, n) && shoreDist(e + de, n + dn, 5) > shoreDist(e, n, 5) && !inBuilding(e + de, n + dn)) return [e + de, n + dn, false];
      if (free(e + de, n)) return [e + de, n, true];
      if (free(e, n + dn)) return [e, n + dn, true];
      return [e, n, true];
    },
  };
}
