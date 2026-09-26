import * as THREE from 'three';
import { PAL } from '../core/palette.js';
import { cel } from '../core/toon.js';
import { trs } from '../core/util.js';
import { CIRCUMFERENCE, bakeToPlanet, buildPlanet } from './planet.js';

/* ------------------------------------------------------------------ *
 * World assembly.
 *
 * Phase 1: an empty planet.  Everything is authored flat and baked onto the
 * sphere once, exactly as the reference does it.  The two debug pieces below
 * exist only to prove the bake works on this planet -- a long bent strip and
 * instanced props re-seated on the surface -- and are replaced by the real
 * promenade in Phase 3.
 * ------------------------------------------------------------------ */

export function buildWorld(scene) {
  const root = new THREE.Group();
  root.name = 'world';

  /* DEBUG (Phase 1 only): the equator.  One flat plane a full circumference
   * long and 8 m wide, centred on z = 0 where the promenade will run.
   *
   * Authored in 4 m segments rather than as one quad.  `subdivideLongEdges`
   * would close a single 2 km quad too, but by bisecting 2011 x 8 m triangles,
   * which leaves long slivers whose bent depth the ink pass picks up as
   * scratches toward the horizon.  Long loop structures should arrive
   * pre-segmented; the subdivision is the safety net. */
  const stripGeo = new THREE.PlaneGeometry(CIRCUMFERENCE, 8, Math.ceil(CIRCUMFERENCE / 4), 1);
  stripGeo.rotateX(-Math.PI / 2);
  const strip = new THREE.Mesh(stripGeo, cel({ color: PAL.asphalt }));
  strip.position.y = 0.02;
  strip.receiveShadow = true;
  strip.name = 'debugEquator';
  root.add(strip);

  /* DEBUG (Phase 1 only): a post every 100 m on the lake-side edge, taller at
   * x = 0.  Instanced, so each one is re-seated rigidly by the bake.  The
   * stylised 100 m markers of Phase 3 are placed the same way. */
  const count = Math.floor(CIRCUMFERENCE / 100);
  const postGeo = new THREE.BoxGeometry(0.22, 1.2, 0.22);
  postGeo.translate(0, 0.6, 0);
  const posts = new THREE.InstancedMesh(postGeo, cel({ color: PAL.cobbleLight }), count);
  for (let i = 0; i < count; i++) {
    const h = i === 0 ? 3 : 1;
    posts.setMatrixAt(i, trs(i * 100, 0, 4.4, 0, 0, 0, 1, h, 1));
  }
  posts.castShadow = true;
  posts.receiveShadow = true;
  posts.name = 'debugPosts';
  root.add(posts);

  scene.add(root);
  const stats = bakeToPlanet(root, { maxEdge: 4 });
  const planet = buildPlanet(scene);

  return {
    root,
    planet,
    stats,
    /** Ground height at flat (x, z).  Flat datum until the terrain arrives. */
    heightAt: () => 0,
    update() {},
  };
}
