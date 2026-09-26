import { data, L, spineAt, nearestS, shoreDist } from './frame.js';
import { groundAt } from './terrain.js';
import { DAM, WATER_STEPS } from './dam.js';

/* ------------------------------------------------------------------ *
 * Where you can stand and what stops you (plan §6, Phase 4).
 *
 *   surfaceAt   the height you stand at: a deck (the boat-club jetty, the
 *               regulator footbridge) where there is one, else the ground
 *               (which already includes the dam)
 *   move        try a step and slide along whatever blocks it
 *
 * Blocked: the water (half a metre short of the real edge), the parapet
 * (except at the three steps down to the water), and every OSM building
 * footprint (a 100 m spatial hash of oriented boxes, 0.35 m margin).
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

  /** Is (e, n) somewhere you may stand? */
  function free(e, n) {
    if (deckAt(e, n)) return true;
    if (shoreDist(e, n, 5) < 0.5) return false;
    const ns = nearestS(e, n);
    if (ns.side > 0 && ns.s > 0.5 && ns.s < L - 0.5) {
      const d = ns.d;
      if (d > DAM.parIn - 0.2 && d < DAM.parOut + 0.1 && !WATER_STEPS.some((w) => Math.abs(w - ns.s) < 1.4)) return false;
    }
    return !inBuilding(e, n);
  }

  return {
    decks,
    free,
    /** The height you stand at. */
    surfaceAt(e, n) {
      const d = deckAt(e, n);
      if (d) return d.y;
      const g = Math.max(groundAt(e, n), 0);
      // the steps down to the water: stand on the treads, not the slope under them
      const stairs = world.dam?.waterStairs || [];
      const ns = stairs.length ? nearestS(e, n) : null;
      for (const st of stairs) {
        if (!st.treads || Math.abs(ns.s - st.s) > st.width / 2 || ns.side < 0) continue;
        const tr = st.treads.find((q) => ns.d >= q.d0 && ns.d < q.d1);
        if (tr) return Math.max(g, tr.y);
      }
      return g;
    },
    /** Move from (e, n) by (de, dn), sliding along whatever blocks the step. */
    move(e, n, de, dn) {
      if (free(e + de, n + dn)) return [e + de, n + dn, false];
      if (free(e + de, n)) return [e + de, n, true];
      if (free(e, n + dn)) return [e, n + dn, true];
      return [e, n, true];
    },
  };
}
