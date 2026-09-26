import * as THREE from 'three';
import { data, inLake, shoreDist } from './frame.js';
import { make, cached } from '../core/textures.js';
import { rngKit } from '../core/util.js';
import { LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * Morning mist (plan §6): soft upright banks standing on the real lake,
 * 3-7 m tall and 40-90 m wide, turned to face the camera, drifting slowly
 * (flat sheets were invisible edge-on from the walk).  Time of day sets their opacity (full at
 * pre-dawn, gone by ~10° of sun) and colour (the haze, a little lighter).
 * One instanced mesh; transparent, no depth writes, no outline.
 * ------------------------------------------------------------------ */

const puffTex = () => cached('mistPuff', () => make(256, 256, (c, w, h) => {
  // a soft, lumpy blob: a few overlapping radial gradients
  const rng = rngKit(91);
  c.clearRect(0, 0, w, h);
  for (let i = 0; i < 7; i++) {
    const x = w * (0.3 + rng.next() * 0.4), y = h * (0.3 + rng.next() * 0.4), r = w * (0.22 + rng.next() * 0.2);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
}, { srgb: false }));

export function buildMist(scene, { count = 140 } = {}) {
  const rng = rngKit(4242);
  const [minE, minN, maxE, maxN] = data.lake.outer.reduce((b, [e, n]) => [Math.min(b[0], e), Math.min(b[1], n), Math.max(b[2], e), Math.max(b[3], n)], [Infinity, Infinity, -Infinity, -Infinity]);
  const sheets = [];
  for (let tries = 0; sheets.length < count && tries < count * 40; tries++) {
    const e = minE + rng.next() * (maxE - minE), n = minN + rng.next() * (maxN - minN);
    if (!inLake(e, n) || -shoreDist(e, n, 60) < 25) continue;
    sheets.push({ e, n, h: 4 + rng.next() * 5, w: 60 + rng.next() * 70, rot: rng.next() * Math.PI * 2, drift: 0.2 + rng.next() * 0.35 });
  }
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.32, 0); // the blob's soft lower edge sits just under the water line
  const mat = new THREE.MeshBasicMaterial({ map: puffTex(), color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const mesh = new THREE.InstancedMesh(geo, mat, sheets.length);
  mesh.name = 'mist';
  mesh.userData.noOutline = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  setLayers(mesh, LAYER.NEAR, LAYER.FAR);
  scene.add(mesh);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  let t = 0, amount = 0;
  const cam = new THREE.Vector3();
  const place = () => {
    sheets.forEach((s, i) => {
      // drift with a light easterly and back, never leaving the water; face the camera
      const dx = Math.sin(t * 0.01 * s.drift + s.rot) * 18;
      P.set(s.e + dx, 0, -s.n);
      Q.setFromAxisAngle(UP, Math.atan2(cam.x - P.x, cam.z - P.z));
      S.set(s.w, s.h, 1);
      mesh.setMatrixAt(i, M.compose(P, Q, S));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  place();
  return {
    mesh,
    /** 0..1 how misty (time of day and weather), and the haze colour. */
    set(a, color) {
      amount = a;
      mat.opacity = 0.9 * a;
      mat.color.set(color);
      mesh.visible = a > 0.01;
    },
    update(dt, camPos) {
      if (amount <= 0.01) return;
      t += dt;
      if (camPos) cam.copy(camPos);
      place();
    },
  };
}
