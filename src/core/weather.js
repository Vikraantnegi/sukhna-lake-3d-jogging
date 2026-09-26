import * as THREE from 'three';
import { LAYER, setLayers } from '../world/chunks.js';

/* ------------------------------------------------------------------ *
 * Weather (plan §6).  K cycles clear -> rain -> winter fog.
 *
 * The state eases over ~3 s into two weights, `rain` and `fog` (0..1),
 * which core/tod.js folds into the look: rain greys the sky, thickens the
 * haze, dims the sun, desaturates the grade and rings the water; fog
 * pulls the view in to 6-70 m, mutes everything, thins the crowd (x0.45)
 * and wraps it in shawls and monkey caps, and lets the far pass be
 * skipped.  The streaks themselves are here: one LineSegments of drops in
 * a box that follows the camera, no depth writes.
 * ------------------------------------------------------------------ */

export const WEATHERS = ['clear', 'rain', 'fog'];
const DROPS = 1800, BOX = 34, TOP = 22;

export function createWeather(scene) {
  const pos = new Float32Array(DROPS * 6);
  const drops = [];
  for (let i = 0; i < DROPS; i++) drops.push({ x: (Math.random() - 0.5) * BOX * 2, y: Math.random() * TOP, z: (Math.random() - 0.5) * BOX * 2, v: 8 + Math.random() * 3 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xc8d0dc, transparent: true, opacity: 0, depthWrite: false, fog: true });
  const streaks = new THREE.LineSegments(geo, mat);
  streaks.name = 'rain';
  streaks.frustumCulled = false;
  streaks.userData.noOutline = true;
  streaks.visible = false;
  setLayers(streaks, LAYER.NEAR);
  scene.add(streaks);

  const w = { kind: 'clear', rain: 0, fog: 0 };
  const target = { rain: 0, fog: 0 };
  const WIND = new THREE.Vector2(0.9, 0.35);

  return {
    state: w,
    /** Next weather; returns its name. */
    cycle() { return this.set(WEATHERS[(WEATHERS.indexOf(w.kind) + 1) % WEATHERS.length]); },
    set(kind, instant = false) {
      w.kind = kind;
      target.rain = kind === 'rain' ? 1 : 0;
      target.fog = kind === 'fog' ? 1 : 0;
      if (instant) { w.rain = target.rain; w.fog = target.fog; }
      return kind;
    },
    update(dt, camPos) {
      const k = 1 - Math.exp(-dt / 1.0);
      w.rain += (target.rain - w.rain) * k;
      w.fog += (target.fog - w.fog) * k;
      if (Math.abs(target.rain - w.rain) < 0.002) w.rain = target.rain;
      if (Math.abs(target.fog - w.fog) < 0.002) w.fog = target.fog;
      streaks.visible = w.rain > 0.02;
      if (!streaks.visible) return;
      mat.opacity = 0.55 * w.rain;
      streaks.position.set(camPos.x, camPos.y - 6, camPos.z);
      for (let i = 0; i < DROPS; i++) {
        const d = drops[i];
        d.y -= d.v * dt;
        d.x += WIND.x * dt; d.z += WIND.y * dt;
        if (d.y < 0) { d.y += TOP; d.x = (Math.random() - 0.5) * BOX * 2; d.z = (Math.random() - 0.5) * BOX * 2; }
        if (d.x > BOX) d.x -= BOX * 2;
        if (d.z > BOX) d.z -= BOX * 2;
        const o = i * 6, len = 0.55;
        pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z;
        pos[o + 3] = d.x - WIND.x * 0.06; pos[o + 4] = d.y + len; pos[o + 5] = d.z - WIND.y * 0.06;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
