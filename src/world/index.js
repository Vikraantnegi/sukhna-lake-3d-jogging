import * as THREE from 'three';
import { PAL } from '../core/palette.js';
import { cel } from '../core/toon.js';
import { data, L, spineAt, nearestS, inLake } from './frame.js';
import { buildTerrain, groundAt } from './terrain.js';
import { buildLake } from './lake.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * World assembly.
 *
 * Phase 2 (flat scaffold): the real DEM terrain, the real lake, the walk
 * as a plain ribbon at the planned crest height, and pins on the real
 * landmarks and stairs.  Phase 3 replaces the ribbon and pins with the
 * promenade, the dam and the landmarks themselves.
 * ------------------------------------------------------------------ */

/** Planned height of the walk above the water on the bund (plan §4, stylised). */
export const WALK_Y = 2.5;
const WALK_HALF = 4;

/* The walk's height along s: at least the bund crest, and never under the
 * real ground (at the west end the walk runs up onto the city's higher
 * ground).  The DEM is sampled every 4 m either side of the centreline
 * and smoothed over +-40 m, so the walk rises and falls gently. */
const WALK_PROFILE = (() => {
  const step = 4, n = Math.ceil(L / step) + 1, raw = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const f = spineAt(k * step);
    let h = -Infinity;
    for (const o of [-6, 0, 6]) h = Math.max(h, groundAt(f.e + f.ne * o, f.n + f.nn * o));
    raw[k] = h + 0.3;
  }
  const out = new Float32Array(n), w = 10;
  for (let k = 0; k < n; k++) {
    let a = 0, c = 0;
    for (let d = -w; d <= w; d++) { const q = k + d; if (q >= 0 && q < n) { a += raw[q]; c++; } }
    out[k] = Math.max(WALK_Y, a / c);
  }
  return { step, h: out };
})();
/** Height of the walk surface at arc length s. */
export function walkY(s) {
  const f = THREE.MathUtils.clamp(s / WALK_PROFILE.step, 0, WALK_PROFILE.h.length - 1);
  const i = Math.min(WALK_PROFILE.h.length - 2, Math.floor(f)), a = f - i;
  return WALK_PROFILE.h[i] * (1 - a) + WALK_PROFILE.h[i + 1] * a;
}

function buildWalkRibbon() {
  // SCAFFOLD (Phase 2): the smoothed OSM centreline, 8 m wide, at WALK_Y
  const pos = [], idx = [];
  const n = Math.ceil(L / 4);
  for (let k = 0; k <= n; k++) {
    const s = (k / n) * L, f = spineAt(s), y = walkY(s);
    for (const side of [-1, 1]) {
      const e = f.e + f.ne * WALK_HALF * side, nn = f.n + f.nn * WALK_HALF * side;
      pos.push(e, y, -nn);
    }
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure it faces up whichever way the strip was wound
  if (geo.attributes.normal.getY(0) < 0) { idx.reverse(); geo.setIndex(idx); geo.computeVertexNormals(); }
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, cel({ color: PAL.asphalt, side: THREE.DoubleSide }));
  m.name = 'walkRibbon';
  m.receiveShadow = true;
  return setLayers(m, LAYER.NEAR, LAYER.FAR);
}

const PIN_COLOUR = {
  garden: 0x3f9a4f, statue: 0xf2c230, regulator: 0x3f7fd0, bridge: 0x3f7fd0, viewpoint: 0xd84a6a,
  boat_rental: 0xf08a2e, plaza: 0xd23b35, club: 0x8f6fb5, golf: 0x8fb35a, information: 0x2f8fcf,
};
function buildPins() {
  // SCAFFOLD (Phase 2): a cone on every real landmark and at the top of every real stair
  const items = [
    ...data.landmarks.map((l) => ({ at: l.at, c: PIN_COLOUR[l.kind] ?? 0x9a9aa0, h: PIN_COLOUR[l.kind] ? 14 : 7 })),
    ...data.steps.map((s) => ({ at: s.top, c: 0x322e3b, h: 9 })),
  ];
  const geo = new THREE.ConeGeometry(1.4, 1, 8);
  geo.rotateX(Math.PI);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, cel({ color: 0xffffff }), items.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  items.forEach((it, i) => {
    const ns = nearestS(it.at[0], it.at[1]);
    const y = Math.max(groundAt(it.at[0], it.at[1]), ns.d < WALK_HALF ? walkY(ns.s) : 0);
    m.makeScale(1, it.h, 1).setPosition(it.at[0], y, -it.at[1]);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(it.c));
  });
  mesh.computeBoundingSphere();
  mesh.name = 'pins';
  mesh.castShadow = true;
  return setLayers(mesh, LAYER.NEAR, LAYER.FAR);
}

export function buildWorld(scene) {
  const terrain = buildTerrain(scene);
  const lake = buildLake(scene);
  const walk = buildWalkRibbon();
  const pins = buildPins();
  scene.add(walk, pins);

  return {
    terrain,
    lake,
    lods: [terrain.lod],
    /** Standing height at (e, n): the walk where you are on it, else the ground (never under the water). */
    heightAt(e, n) {
      const ns = nearestS(e, n);
      if (ns.d < WALK_HALF) return walkY(ns.s);
      const g = groundAt(e, n);
      return inLake(e, n) ? Math.max(0, g) : g;
    },
    update(dt, viewPos) {
      for (const l of this.lods) l.update(viewPos);
    },
  };
}
