import * as THREE from 'three';
import { flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { data } from './frame.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The water: the real lake polygon from OSM (relation 8421510) with its
 * islands, as one flat surface at y = 0, the lake level.
 *
 * Phase 2 scaffold: a single unlit colour.  Phase 3 adds the shore band
 * and the drawdown edge; Phase 6 the time-of-day water shader.
 * ------------------------------------------------------------------ */

export function buildLake(scene) {
  const shape = new THREE.Shape(data.lake.outer.map(([e, n]) => new THREE.Vector2(e, n)));
  for (const ring of data.lake.inner) shape.holes.push(new THREE.Path(ring.map(([e, n]) => new THREE.Vector2(e, n))));
  const geo = new THREE.ShapeGeometry(shape);
  // shape space is (e, n); rotating -90° about x sends (e, n, 0) to (e, 0, -n)
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingSphere();
  const water = new THREE.Mesh(geo, flat({ color: PAL.waterBright }));
  water.name = 'lake';
  water.userData.noOutline = true;
  water.receiveShadow = false;
  setLayers(water, LAYER.NEAR, LAYER.FAR);
  scene.add(water);
  return { water };
}
