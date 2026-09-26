import * as THREE from 'three';
import { flat } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { data } from './frame.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The water: the real lake polygon from OSM (relation 8421510) with its
 * islands, as one flat surface at y = 0, the lake level.
 *
 * The shader (plan §2 "Water", §6): a body colour that time of day sets
 * (silver-peach at dawn, khaki at low sun, steel grey-mauve in bright
 * morning), the sky's haze reflected toward the horizon by a Fresnel term
 * in painted steps, and the sun's glitter path: small wave normals that
 * catch the sun's reflection as hard sparkles, strongest along the line
 * between you and the sun.  Rain adds rings.  Fogged like everything else.
 * `simple` (the low tier) is a flat colour that time of day still drives.
 * ------------------------------------------------------------------ */

const WATER = {
  uniforms: {
    uBody: { value: new THREE.Color(PAL.waterBright) },
    uSky: { value: new THREE.Color(PAL.skyHaze) },
    uSunDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
    uSunCol: { value: new THREE.Color(0xffe6b0) },
    uGlitter: { value: 0.6 },
    uRipple: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * vec4( position, 1.0 );
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBody, uSky, uSunDir, uSunCol;
    uniform float uGlitter, uRipple, uTime;
    varying vec3 vWorld;
    #include <fog_pars_fragment>

    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    float noise( vec2 p ) {
      vec2 i = floor( p ), f = fract( p );
      f = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
    }

    void main() {
      vec2 p = vWorld.xz;
      vec3 toCam = cameraPosition - vWorld;
      float dist = length( toCam );
      vec3 V = toCam / dist;

      // small wind waves: two drifting noise octaves, flattened with distance
      float calm = 1.0 / ( 1.0 + dist * 0.004 );
      vec2 q = p * 0.35 + vec2( uTime * 0.07, uTime * 0.04 );
      vec2 r = p * 1.3 - vec2( uTime * 0.12, -uTime * 0.09 );
      vec2 w = vec2( noise( q ) - 0.5, noise( q + 17.3 ) - 0.5 ) * 0.14 + vec2( noise( r ) - 0.5, noise( r + 5.1 ) - 0.5 ) * 0.07;
      vec3 n = normalize( vec3( w.x * calm, 1.0, w.y * calm ) );

      // rain: rings from a 1.2 m grid of drops, near the camera only
      if ( uRipple > 0.001 ) {
        vec2 g = p / 1.2, c = floor( g ), f = fract( g ) - 0.5;
        float ph = fract( uTime * 0.9 + hash( c ) );
        vec2 o = ( vec2( hash( c + 3.3 ), hash( c + 8.1 ) ) - 0.5 ) * 0.5;
        float d = length( f - o );
        float ring = smoothstep( 0.05, 0.0, abs( d - ph * 0.45 ) ) * ( 1.0 - ph );
        n = normalize( n + vec3( ( f - o ).x, 0.0, ( f - o ).y ) * ring * 1.6 * uRipple / ( 1.0 + dist * 0.05 ) );
      }

      // Fresnel toward the sky's haze, in soft painted steps
      float fr = pow( 1.0 - max( dot( n, V ), 0.0 ), 4.0 );
      fr = mix( fr, floor( fr * 5.0 ) / 5.0, 0.35 );
      vec3 col = mix( uBody, uSky, clamp( fr * 0.85, 0.0, 0.85 ) );

      // the glitter path: the sun's reflection off the wave facets, as hard sparkles
      vec3 R = reflect( -V, n );
      float s = max( dot( R, uSunDir ), 0.0 );
      float broad = pow( s, 40.0 );
      float spark = step( 0.9965, s ) * step( 0.45, noise( p * 2.2 + uTime * 0.6 ) );
      col += uSunCol * ( broad * 0.35 + spark * 0.9 ) * uGlitter;

      gl_FragColor = vec4( col, 1.0 );
      #include <fog_fragment>
    }
  `,
};

export function buildLake(scene, { simple = false } = {}) {
  const shape = new THREE.Shape(data.lake.outer.map(([e, n]) => new THREE.Vector2(e, n)));
  for (const ring of data.lake.inner) shape.holes.push(new THREE.Path(ring.map(([e, n]) => new THREE.Vector2(e, n))));
  const geo = new THREE.ShapeGeometry(shape);
  // shape space is (e, n); rotating -90° about x sends (e, n, 0) to (e, 0, -n)
  geo.rotateX(-Math.PI / 2);
  geo.computeBoundingSphere();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, WATER.uniforms]);
  const mat = simple
    ? flat({ color: PAL.waterBright, cache: false })
    : new THREE.ShaderMaterial({ uniforms, vertexShader: WATER.vertexShader, fragmentShader: WATER.fragmentShader, fog: true });
  const water = new THREE.Mesh(geo, mat);
  water.name = 'lake';
  water.userData.noOutline = true;
  water.receiveShadow = false;
  setLayers(water, LAYER.NEAR, LAYER.FAR);
  scene.add(water);
  return {
    water,
    uniforms: simple ? null : mat.uniforms,
    /** Time of day and weather (core/tod.js). */
    set({ body, sky, sunDir, sunCol, glitter, ripple }) {
      if (simple) { mat.color.set(body).lerp(new THREE.Color(sky), 0.3); return; }
      const u = mat.uniforms;
      u.uBody.value.set(body); u.uSky.value.set(sky);
      u.uSunDir.value.copy(sunDir); u.uSunCol.value.set(sunCol);
      u.uGlitter.value = glitter; u.uRipple.value = ripple;
    },
    update(dt) { if (!simple) mat.uniforms.uTime.value += dt; },
  };
}
