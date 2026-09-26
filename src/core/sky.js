/* Ported from sakura-crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * src/core/sky.js.  Copyright (c) 2026 Kenton Wang.  MIT License -- full text
 * in THIRD_PARTY_LICENSES.md.  Changes: sized for a real-scale flat world
 * (a 30 km background dome that ignores depth, clouds 3-7 km out at
 * 0.8-2 km altitude), drawn in the far render pass only; the dome's colour
 * uniforms are returned so time of day can drive them; the unused
 * `buildDistantHills` is dropped (real DEM terrain and far ridge rings
 * replace it).  The sun disc, horizon glow and stars arrive in Phase 6. */
import * as THREE from 'three';
import { PAL } from './palette.js';
import { flat } from './toon.js';
import { cloudTex } from './textures.js';
import { rngKit } from './util.js';
import { LAYER, setLayers } from '../world/chunks.js';

/**
 * A three-stop painted gradient dome plus a handful of flat cel clouds.
 * Slight banding is intentional -- it reads as airbrushed background art
 * rather than a physical sky.
 */
export function buildSky(scene, radius = 30000) {
  const geo = new THREE.SphereGeometry(radius, 32, 20);
  const uniforms = {
    uTop: { value: new THREE.Color(PAL.skyTop) },
    uMid: { value: new THREE.Color(PAL.skyMid) },
    uHaze: { value: new THREE.Color(PAL.skyHaze) },
    uBands: { value: 26.0 },
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    // the background: drawn first, under everything, whatever its distance
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      void main() {
        // the dome trails the camera, so its local direction is the view direction
        vLocal = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uMid, uHaze;
      uniform float uBands;
      varying vec3 vLocal;

      void main() {
        float h = normalize( vLocal ).y;
        // soft quantisation: mostly smooth, with a faint painted step
        float t = clamp( h * 1.15 + 0.02, 0.0, 1.0 );
        float q = floor( t * uBands ) / uBands;
        t = mix( t, q, 0.35 );

        vec3 col = mix( uHaze, uMid, smoothstep( 0.0, 0.30, t ) );
        col = mix( col, uTop, smoothstep( 0.26, 0.92, t ) );

        col = mix( col, uHaze, smoothstep( 0.12, -0.05, h ) * 0.6 );
        gl_FragColor = vec4( col, 1.0 );
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  setLayers(dome, LAYER.FAR);
  scene.add(dome);

  // --- flat clouds: a ring of billboarded puffs, no depth writes ---
  const tex = cloudTex();
  const rng = rngKit(7781);
  const clouds = new THREE.Group();
  const matA = flat({ color: PAL.cloud, map: tex, transparent: true, opacity: 0.62, depthWrite: false, fog: false, cache: false });
  const matB = flat({ color: PAL.cloudShade, map: tex, transparent: true, opacity: 0.34, depthWrite: false, fog: false, cache: false });
  matA.map.wrapS = matA.map.wrapT = THREE.ClampToEdgeWrapping;

  for (let i = 0; i < 22; i++) {
    const r = rng.range(3000, 7000);
    const a = rng.range(0, Math.PI * 2);
    const w = rng.range(900, 2400);
    const h = w * rng.range(0.24, 0.34);
    const y = rng.range(800, 2000);
    const g = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matB);
    back.position.set(2, -h * 0.1, -1.5);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matA);
    g.add(back, front);
    g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    g.lookAt(0, y * 0.55, 0);
    g.renderOrder = -9;
    clouds.add(g);
  }
  clouds.frustumCulled = false;
  setLayers(clouds, LAYER.FAR);
  scene.add(clouds);

  return { dome, clouds, uniforms };
}

/* ------------------------------ Sukhna ------------------------------ */

/**
 * The far ridgeline ring (plan §3, §4): the ranges beyond the hill grid --
 * Kasauli, Morni -- as one silhouette at their real azimuths and real
 * distances (16-42 km), from the pipeline's ray-march.  The data holds a
 * horizon profile from three points on the walk; the ring blends between
 * them by where you are (the parallax over 2.5 km is several degrees for
 * the nearer ridges).  Drawn in the far pass only, behind the real hill
 * terrain, unlit and unfogged: its haze is painted in, top to bottom.
 */
export function buildRidgeRing(scene, ridges, { near = 0xa3adc0, haze = PAL.skyHaze } = {}) {
  const N = 360;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const col = new Float32Array((N + 1) * 2 * 3);
  const idx = [];
  for (let i = 0; i < N; i++) { const a = i * 2, b = a + 2; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -8;
  mesh.name = 'ridgeRing';
  setLayers(mesh, LAYER.FAR);
  scene.add(mesh);
  const cTop = new THREE.Color(near), cLow = new THREE.Color(haze);
  const views = ridges.views;
  let lastS = -1;

  function rebuild(s) {
    // blend the two nearest viewpoints by arc length
    let i = 0;
    while (i < views.length - 2 && s > views[i + 1].s) i++;
    const a = views[i], b = views[i + 1];
    const t = THREE.MathUtils.clamp((s - a.s) / (b.s - a.s), 0, 1);
    for (let az = 0; az <= N; az++) {
      const k = az % N;
      const ang = THREE.MathUtils.lerp(a.angle[k], b.angle[k], t);
      const km = THREE.MathUtils.clamp(THREE.MathUtils.lerp(a.km[k], b.km[k], t) || 30, 16, 42);
      const d = km * 1000, r = THREE.MathUtils.degToRad(az);
      const dx = Math.sin(r) * d, dz = -Math.cos(r) * d;
      const top = d * Math.tan(THREE.MathUtils.degToRad(Math.max(ang, -0.5)));
      const o = az * 6;
      pos[o] = dx; pos[o + 1] = top + 4; pos[o + 2] = dz;
      pos[o + 3] = dx; pos[o + 4] = -d * 0.06; pos[o + 5] = dz;
      // nearer, higher ridges read darker; everything sinks into the haze below
      const k2 = THREE.MathUtils.clamp((ang + 0.3) / 3.5, 0, 1) * THREE.MathUtils.clamp(1.25 - km / 45, 0.35, 1);
      const c = cLow.clone().lerp(cTop, 0.35 + 0.55 * k2);
      col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      col[o + 3] = cLow.r; col[o + 4] = cLow.g; col[o + 5] = cLow.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return {
    mesh,
    /** Follow the camera; re-blend the profile when s has moved 25 m. */
    update(camPos, s) {
      mesh.position.set(camPos.x, 0, camPos.z);
      if (Math.abs(s - lastS) > 25) { rebuild(s); lastS = s; }
    },
  };
}
