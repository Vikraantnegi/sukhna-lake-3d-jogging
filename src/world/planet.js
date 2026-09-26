/* Ported from sakura-crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * src/world/planet.js.  Copyright (c) 2026 Kenton Wang.  MIT License -- full
 * text in THIRD_PARTY_LICENSES.md.  Changes: R is Sukhna's (a placeholder
 * until Phase 2 derives it from the promenade length); the mapping, the edge
 * subdivision and the bake are unchanged; `buildPlanet` loses the reference's
 * street profile, relief masks and canal cut, and adds `surfaceQuat`. */
import * as THREE from 'three';
import { PAL } from '../core/palette.js';
import { cel } from '../core/toon.js';

/* ------------------------------------------------------------------ *
 * The planet.
 *
 * The whole scene is *authored* on a flat XZ plane -- every builder, every
 * collider, every height query works in flat metres.  This module is the
 * projection layer that wraps that plane onto a sphere, plus the sphere
 * itself.
 *
 * The mapping is equirectangular, with the promenade on the equator:
 *
 *     x -> longitude   (wraps at exactly one circumference)
 *     z -> latitude    (+z is the lake side, -z the city side)
 *
 * The promenade centreline is authored along X at z = 0, so it lands on a
 * great circle and closes into a single seamless loop with zero distortion.
 * x is arc length along the real promenade, 1:1.  Longitude lines converge
 * toward the poles, so content far from the promenade is squeezed in x by
 * cos(z/R); see plan §4 for how much of the lake that leaves undistorted.
 * ------------------------------------------------------------------ */

/**
 * Planet radius in metres. Everything else derives from this one number.
 *
 * PLACEHOLDER: Phase 2 replaces it with (L_prom + L_join) / 2π, where L_prom
 * is the promenade length measured from OSM and L_join the ~40 m stylised
 * join (plan §4).  320 is the agreed ballpark.
 */
export const R = 320;

export const CIRCUMFERENCE = 2 * Math.PI * R;
/** Sphere centre, chosen so the flat origin sits on the surface with +Y up. */
export const CENTER = new THREE.Vector3(0, -R, 0);

/** Visible ground horizon for an eye at height h -- useful for framing. */
export const horizonFor = (h) => Math.sqrt(2 * R * h + h * h);

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/* ------------------------------- mapping ------------------------------- */

/** Outward surface normal ("up") at flat coordinates (x, z). */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const la = x / R;
  const ph = z / R;
  const cp = Math.cos(ph);
  return out.set(Math.sin(la) * cp, Math.cos(la) * cp, Math.sin(ph));
}

/** World position of the flat point (x, z) raised y metres above the surface. */
export function positionAt(x, y, z, out = new THREE.Vector3()) {
  normalAt(x, z, out).multiplyScalar(R + y).add(CENTER);
  return out;
}

/**
 * Orthonormal tangent frame: east is +x, north is +z, up is the normal.
 * At the origin this is the identity, which is why district content near
 * the crossing needs almost no correction.
 */
export function basisAt(x, z, up = new THREE.Vector3(), east = new THREE.Vector3(), north = new THREE.Vector3()) {
  const la = x / R;
  const ph = z / R;
  const sl = Math.sin(la), cl = Math.cos(la);
  const sp = Math.sin(ph), cp = Math.cos(ph);
  up.set(sl * cp, cl * cp, sp);
  east.set(cl, -sl, 0);
  north.set(-sl * sp, -cl * sp, cp);
  return { up, east, north };
}

/** Full placement matrix for the flat point (x, z) at height y. */
export function frameAt(x, z, y = 0, out = new THREE.Matrix4()) {
  const b = basisAt(x, z);
  out.makeBasis(b.east, b.up, b.north);
  out.setPosition(positionAt(x, y, z, _v));
  return out;
}

/** Inverse mapping: a point (or direction) on the sphere back to flat (x, z). */
export function flatAt(worldPos, out = { x: 0, z: 0, y: 0 }) {
  _v.copy(worldPos).sub(CENTER);
  const r = _v.length() || 1;
  _v.multiplyScalar(1 / r);
  out.z = R * Math.asin(THREE.MathUtils.clamp(_v.z, -1, 1));
  out.x = R * Math.atan2(_v.x, _v.y);
  out.y = r - R;
  return out;
}

/** Shortest signed difference between two longitudes, in metres of arc. */
export function wrapDelta(a, b) {
  let d = a - b;
  while (d > CIRCUMFERENCE / 2) d -= CIRCUMFERENCE;
  while (d < -CIRCUMFERENCE / 2) d += CIRCUMFERENCE;
  return d;
}

/** Fold a longitude into [-C/2, C/2). */
export function wrapX(x) {
  const c = CIRCUMFERENCE;
  return ((((x + c / 2) % c) + c) % c) - c / 2;
}

/* ---------------------------- geometry wrapping ---------------------------- */

/**
 * Split any triangle with an edge longer than `maxEdge`.
 *
 * This is what makes wrapping arbitrary geometry safe.  A 1000-metre rail
 * is authored as a box with two vertices along its length; bending only
 * those two vertices would chord straight through the planet.  Bisecting
 * the long edge until every span is short means the same flat builders can
 * produce planet-scale geometry with no changes.
 */
function subdivideLongEdges(geo, maxEdge) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const max2 = maxEdge * maxEdge;

  const attrNames = Object.keys(g.attributes);
  let arrays = attrNames.map((n) => ({
    name: n,
    size: g.attributes[n].itemSize,
    src: g.attributes[n].array,
  }));
  let count = g.attributes.position.count;

  /* The material index of every triangle, carried through all the passes.
   *
   * This has to be tracked explicitly because both ends of this function
   * throw `geometry.groups` away: `toNonIndexed()` does not copy them, and
   * the geometry rebuilt at the bottom starts empty.  A mesh with a material
   * *array* and no groups contributes nothing at all to the render list -- it
   * does not fall back to material[0], it simply stops being drawn.  Every
   * sign in this world is a box with one mapped face and five plain ones, so
   * losing this took out all of them at once: nine shop fascias, the blade
   * signs, the arch over the alley mouth, the school gate notice, the
   * bathhouse name, the apartment plate.  Fifty-four meshes, and true from
   * the moment the planet went in.  Nothing threw and the console was clean;
   * what it looked like was a district where nobody had put their sign up.
   *
   * Group boundaries survive the passes for free because triangles are
   * processed in order and each one emits either one or two triangles, so the
   * per-triangle array below stays aligned with the vertex output. */
  const srcGroups = geo.groups && geo.groups.length ? geo.groups : null;
  let gid = new Int32Array(count / 3);
  if (srcGroups) {
    for (const grp of srcGroups) {
      const t0 = Math.floor(grp.start / 3);
      const t1 = Math.min(gid.length, t0 + Math.floor(grp.count / 3));
      for (let t = t0; t < t1; t++) gid[t] = grp.materialIndex ?? 0;
    }
  }

  // bounded pass count: each pass at least halves the longest edge
  for (let pass = 0; pass < 12; pass++) {
    const pos = arrays.find((a) => a.name === 'position').src;
    let splits = 0;
    const out = arrays.map((a) => ({ name: a.name, size: a.size, dst: [] }));
    const gidOut = [];

    for (let t = 0; t < count; t += 3) {
      // longest edge of this triangle
      let worst = -1, wi = 0;
      for (let e = 0; e < 3; e++) {
        const a = t + e, b = t + ((e + 1) % 3);
        const dx = pos[a * 3] - pos[b * 3];
        const dy = pos[a * 3 + 1] - pos[b * 3 + 1];
        const dz = pos[a * 3 + 2] - pos[b * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > worst) { worst = d2; wi = e; }
      }
      if (worst <= max2) {
        for (const a of out) {
          const src = arrays.find((x) => x.name === a.name).src;
          for (let e = 0; e < 3; e++) {
            for (let k = 0; k < a.size; k++) a.dst.push(src[(t + e) * a.size + k]);
          }
        }
        gidOut.push(gid[t / 3]);
        continue;
      }
      splits++;
      gidOut.push(gid[t / 3], gid[t / 3]);
      // corner indices: i0-i1 is the long edge, i2 the opposite corner
      const i0 = t + wi, i1 = t + ((wi + 1) % 3), i2 = t + ((wi + 2) % 3);
      for (const a of out) {
        const src = arrays.find((x) => x.name === a.name).src;
        const mid = [];
        for (let k = 0; k < a.size; k++) {
          mid.push((src[i0 * a.size + k] + src[i1 * a.size + k]) * 0.5);
        }
        const push = (idx) => {
          for (let k = 0; k < a.size; k++) a.dst.push(src[idx * a.size + k]);
        };
        // (i0, mid, i2) and (mid, i1, i2) preserve winding
        push(i0); a.dst.push(...mid); push(i2);
        a.dst.push(...mid); push(i1); push(i2);
      }
    }

    arrays = out.map((a) => ({ name: a.name, size: a.size, src: Float32Array.from(a.dst) }));
    gid = Int32Array.from(gidOut);
    count = arrays.find((a) => a.name === 'position').src.length / 3;
    if (!splits) break;
  }

  const result = new THREE.BufferGeometry();
  for (const a of arrays) {
    result.setAttribute(a.name, new THREE.BufferAttribute(a.src, a.size));
  }
  // one group per run of triangles sharing a material; single-material
  // geometry is left group-free, exactly as it arrived
  if (srcGroups) {
    let start = 0;
    for (let t = 1; t <= gid.length; t++) {
      if (t === gid.length || gid[t] !== gid[start]) {
        result.addGroup(start * 3, (t - start) * 3, gid[start]);
        start = t;
      }
    }
  }
  if (g !== geo) g.dispose();
  return result;
}

/**
 * Bend a geometry whose vertices are flat *world* coordinates onto the
 * sphere. Returns a new geometry; the input is left alone.
 */
export function wrapGeometry(geo, maxEdge = 3.0) {
  const g = subdivideLongEdges(geo, maxEdge);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    positionAt(pos.getX(i), pos.getY(i), pos.getZ(i), v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* -------------------------------- baking -------------------------------- */

/**
 * Project an already-built flat world onto the planet.
 *
 * Runs once, after every builder has finished, and only touches geometry
 * and transforms -- which is the point: none of the twenty-odd world
 * modules need to know the planet exists.
 *
 *  - InstancedMesh          -> each instance is re-seated rigidly on the
 *                              surface (they are all small props)
 *  - userData.planetRigid   -> left in flat space; used for animated rigs
 *                              near the origin, where the mapping is
 *                              within a couple of centimetres of identity
 *  - userData.planetSpin    -> geometry bent, then driven at runtime by a
 *                              rotation about the planet axis (the train)
 *  - everything else        -> subdivided and bent vertex by vertex
 */
export function bakeToPlanet(root, { maxEdge = 3.0 } = {}) {
  root.updateMatrixWorld(true);

  const underRigid = (o) => {
    for (let p = o.parent; p && p !== root.parent; p = p.parent) {
      if (p.userData.planetRigid) return true;
    }
    return false;
  };

  // Groups whose children sit relative to their own origin, and which are
  // driven at runtime (gate booms, shutter, cat, vending). Their pivots have
  // to survive the bake, so instead of bending their geometry we re-seat the
  // group itself onto the surface and leave the rig intact.
  const rigid = [];
  root.traverse((o) => {
    if (o.userData.planetRigid && !underRigid(o)) {
      rigid.push({ obj: o, world: o.matrixWorld.clone() });
    }
  });

  const jobs = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isLine) return;
    if (o.userData.planetRigid || underRigid(o)) return;
    jobs.push({ obj: o, world: o.matrixWorld.clone() });
  });

  const stats = { wrapped: 0, instanced: 0, rigid: rigid.length, tris: 0 };

  for (const { obj, world } of jobs) {
    if (obj.isInstancedMesh) {
      const n = obj.count;
      const im = obj.instanceMatrix;
      for (let i = 0; i < n; i++) {
        _m.fromArray(im.array, i * 16).premultiply(world);
        _m.decompose(_v, _q, _s);
        const b = basisAt(_v.x, _v.z);
        const fq = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(b.east, b.up, b.north)
        );
        const p = positionAt(_v.x, _v.y, _v.z, new THREE.Vector3());
        _m.compose(p, fq.multiply(_q), _s);
        _m.toArray(im.array, i * 16);
      }
      im.needsUpdate = true;
      /* Instanced meshes stay unculled.  Their bound would have to come from
       * the instance cloud rather than the source geometry, and most of them
       * (sleepers, petals, blossom) span the district anyway -- so there is
       * nothing to win and a moving petal field to get wrong. */
      obj.frustumCulled = false;
      stats.instanced += n;
    } else {
      const flat = obj.geometry.clone().applyMatrix4(world);
      const bent = wrapGeometry(flat, maxEdge);
      flat.dispose();
      obj.geometry = bent;
      /* Everything else *is* culled, and this matters: the bake leaves every
       * mesh with an identity transform and its geometry in root space, so the
       * geometry's own bounding sphere is already a world-space bound and the
       * frustum test is exact.  The district grew to about five thousand
       * meshes, and drawing all of them every frame regardless of where the
       * camera is pointing cost roughly 8 ms -- most of a frame. */
      obj.frustumCulled = true;
      stats.wrapped++;
      stats.tris += bent.attributes.position.count / 3;
    }
    // geometry (or instance matrices) are now in root space
    obj.position.set(0, 0, 0);
    obj.quaternion.identity();
    obj.scale.set(1, 1, 1);
    obj.matrixAutoUpdate = true;
  }

  // Baked geometry is in root space now, so every container above it must
  // become the identity or its transform would apply a second time.
  root.traverse((o) => {
    if (o === root || o.isMesh || o.isLine) return;
    if (o.userData.planetRigid || underRigid(o)) return;
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });

  // Re-seat the rigid rigs. Their parents are identity by now, so the local
  // transform is the world transform.
  const fm = new THREE.Matrix4();
  for (const { obj, world } of rigid) {
    world.decompose(_v, _q, _s);
    const b = basisAt(_v.x, _v.z);
    fm.makeBasis(b.east, b.up, b.north);
    obj.position.copy(positionAt(_v.x, _v.y, _v.z, new THREE.Vector3()));
    obj.quaternion.setFromRotationMatrix(fm).multiply(_q);
    obj.scale.copy(_s);
  }

  return stats;
}

/* ------------------------------- the sphere ------------------------------- */

const _bm = new THREE.Matrix4();
const _bu = new THREE.Vector3();
const _be = new THREE.Vector3();
const _bn = new THREE.Vector3();

/** Rotation taking the flat axes (x, y, z) to the surface frame at (x, z). */
export function surfaceQuat(x, z, out = new THREE.Quaternion()) {
  basisAt(x, z, _bu, _be, _bn);
  _bm.makeBasis(_be, _bu, _bn);
  return out.setFromRotationMatrix(_bm);
}

/** Depth of the bare sphere below the flat datum, so authored ground wins. */
export const SPHERE_DROP = 0.065;

export function buildPlanet(scene) {
  const group = new THREE.Group();
  group.name = 'planet';

  /* An icosphere rather than a UV sphere: even triangles and no pole pinching.
   *
   * The detail is derived, as in the reference: the icosahedron edge is about
   * 1.05·R, split into `detail + 1`, and a facet's centre sags below the true
   * sphere by about e²/(6R).  At R = 320, detail 40 is an 8.2 m triangle
   * sagging 35 mm -- inside the 65 mm the authored ground clears it by.
   * 33 620 triangles, one draw call. */
  const detail = Math.max(30, Math.round((1.0515 * R) / 8.2) - 1);
  const geo = new THREE.IcosahedronGeometry(R - SPHERE_DROP, detail);
  geo.translate(CENTER.x, CENTER.y, CENTER.z);

  /* Normals taken from the sphere, not from the faces: `IcosahedronGeometry`
   * is non-indexed, so `computeVertexNormals()` would give every vertex its
   * face normal, and the toon ramp would quantise the terminator into a
   * staircase of facets. */
  {
    const vp = geo.attributes.position;
    const nrm = new Float32Array(vp.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < vp.count; i++) {
      v.set(vp.getX(i), vp.getY(i), vp.getZ(i)).sub(CENTER).normalize();
      nrm[i * 3] = v.x;
      nrm[i * 3 + 1] = v.y;
      nrm[i * 3 + 2] = v.z;
    }
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  }

  /* 4 bands rather than 3: on a whole sphere the terminator sweeps through
   * every angle, and three bands make it read as a coarse polyhedron. */
  const land = new THREE.Mesh(geo, cel({ color: PAL.land, bands: 4, tint: 0x7a7396, flat: false }));
  land.receiveShadow = true;
  // Must NOT cast: a planet-sized closed sphere renders its far hemisphere
  // into the shadow map and drops the entire surface into its own shadow.
  land.castShadow = false;
  land.frustumCulled = false;
  land.name = 'planetLand';
  group.add(land);

  scene.add(group);
  return { group, land, detail };
}
