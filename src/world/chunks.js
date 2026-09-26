/* ------------------------------------------------------------------ *
 * Distance culling and LOD (plan §4), replacing the planet's horizon
 * culling.
 *
 * An item is a centre plus a list of levels, each an Object3D shown up to
 * a distance.  `update(pos)` picks one level per item (or none, past the
 * last level's distance), with 8% hysteresis so nothing flickers at a
 * boundary.  Frustum culling is still three's own, per mesh, so every
 * level should carry real bounds (chunked geometry does).
 * ------------------------------------------------------------------ */

const HYST = 0.08;

export class LodSet {
  constructor(name = 'lod') {
    this.name = name;
    this.items = [];
    this.scale = 1; // quality tiers multiply every distance
  }

  /** levels: [{ dist, obj }] in increasing dist; obj may be null (nothing drawn). */
  add(center, levels, tag = '') {
    const item = { center, levels, cur: -2, tag };
    for (const l of levels) if (l.obj) l.obj.visible = false;
    this.items.push(item);
    return item;
  }

  update(pos) {
    let shown = 0;
    for (const it of this.items) {
      const d = Math.hypot(it.center.x - pos.x, it.center.z - pos.z);
      let lv = it.levels.length; // past every level: hidden
      for (let i = 0; i < it.levels.length; i++) {
        let lim = it.levels[i].dist * this.scale;
        // stay on the current level a little longer, whichever way we move
        if (i === it.cur) lim *= 1 + HYST; else if (i === it.cur - 1) lim *= 1 - HYST;
        if (d <= lim) { lv = i; break; }
      }
      if (lv !== it.cur) {
        if (it.cur >= 0 && it.cur < it.levels.length && it.levels[it.cur].obj) it.levels[it.cur].obj.visible = false;
        if (lv < it.levels.length && it.levels[lv].obj) it.levels[lv].obj.visible = true;
        it.cur = lv;
      }
      if (lv < it.levels.length) shown++;
    }
    return shown;
  }

  /** Per-item state, for the ?flat=1 map panel. */
  states() {
    return this.items.map((it) => ({ c: it.center, lv: it.cur, n: it.levels.length, tag: it.tag }));
  }
}

/** Render layers for the two-pass frame (plan §4). */
export const LAYER = { NEAR: 0, FAR: 1 };

/** Put an object (and its subtree) on exactly the given layers. */
export function setLayers(obj, ...layers) {
  obj.traverse((o) => {
    o.layers.disableAll();
    for (const l of layers) o.layers.enable(l);
  });
  return obj;
}
