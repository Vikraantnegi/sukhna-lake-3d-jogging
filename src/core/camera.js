import * as THREE from 'three';
import { spineAt, LAKE_CENTRE } from '../world/frame.js';

/* ------------------------------------------------------------------ *
 * The camera (plan §6).
 *
 *   third person  a boom behind and a little over the right shoulder,
 *                 lagging behind the jogger, with a small bob on the
 *                 stride; the mouse wheel shortens it from 5.5 m to 0,
 *                 where it becomes first person (the body hides)
 *   auto-jog (V)  the camera drifts slowly round toward the lake side
 *   seated        (a bench or the water steps) over the shoulder: ~3 m
 *                 behind, a little to one side and above the head, looking
 *                 past the jogger to the lake, with a very slow drift; the
 *                 mouse and wheel still work (it settles back when idle)
 *   boating       the same view as a chase camera: behind the pedal boat,
 *                 following its heading (core/boat.js view())
 *   in a circle   behind the jogger, outside the circle, looking across it
 *   overview (P)  an aerial orbit of the whole lake, ~1.1 km up
 *
 * The view never dips under the ground or the water.
 * ------------------------------------------------------------------ */

const BOOM_MAX = 5.5;

export function createCameraRig(camera, { groundAt }) {
  const rig = {
    yaw: 0, pitch: -0.12, boom: 4.2, boomTarget: 4.2,
    mode: 'third', // third | first | overview | bench
    orbit: 3.6,
    lookIdle: 0, // seconds since the last manual look input
    pos: new THREE.Vector3(), target: new THREE.Vector3(),
    near: { near: 0.5, far: 1200 },
  };
  const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _eye = new THREE.Vector3();
  let first = true;

  rig.look = (dx, dy) => {
    rig.yaw -= dx;
    rig.pitch = THREE.MathUtils.clamp(rig.pitch - dy, -1.25, 0.9);
    rig.lookIdle = 0;
  };
  rig.zoom = (delta) => {
    rig.boomTarget = THREE.MathUtils.clamp(rig.boomTarget + delta, 0, BOOM_MAX);
  };
  rig.setOverview = (on) => {
    rig.mode = on ? 'overview' : 'third';
    camera.near = on ? 5 : rig.near.near;
    camera.far = on ? 6000 : rig.near.far;
    camera.updateProjectionMatrix();
    first = true;
  };
  rig.isFirstPerson = () => rig.mode !== 'overview' && rig.boom < 0.35;

  function overview(dt, angle) {
    const [ce, cn] = LAKE_CENTRE;
    rig.orbit = angle ?? rig.orbit + dt * 0.05;
    camera.position.set(ce + Math.sin(rig.orbit) * 2400, 1100, -(cn + Math.cos(rig.orbit) * 2400));
    camera.lookAt(ce, 0, -cn);
  }

  /**
   * Place the camera for this frame.  `j` is the jogger; `bench` (optional)
   * is { e, n, y, yaw } when sitting.
   */
  rig.update = (dt, j, { bench = null, snap = false } = {}) => {
    if (rig.mode === 'overview') { overview(dt); return; }
    rig.lookIdle += dt;
    rig.boom += (rig.boomTarget - rig.boom) * (1 - Math.exp(-8 * dt));

    // auto-jog: drift round toward the lake side, unless the mouse is in use
    if (j.auto && rig.lookIdle > 2.5) {
      const w = j.where(), f = spineAt(w.s);
      const lakeYaw = Math.atan2(-(f.te * j.autoDir * 0.55 + f.ne), f.tn * j.autoDir * 0.55 + f.nn);
      // look *from* the land side toward the lake: the camera yaw faces the lake
      let dy = lakeYaw - rig.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      rig.yaw += dy * (1 - Math.exp(-0.18 * dt));
      rig.pitch += (-0.1 - rig.pitch) * (1 - Math.exp(-0.3 * dt));
    }
    // seated: frame once (the wheel may change it after), then settle with a slow drift
    if (bench) {
      if (!rig.seated) { rig.seated = true; rig.seatT = 0; rig.boomTarget = bench.boom ?? Math.max(rig.boomTarget, 3.2); rig.lookIdle = 99; }
      rig.seatT += dt;
      // (a boat's chase view follows its heading faster, and sooner after the mouse lets go)
      const rate = bench.rate ?? 0.9;
      if (rig.lookIdle > (bench.idle ?? 2.5)) {
        const drift = bench.drift ? Math.sin(rig.seatT * 0.09) * 0.08 + Math.sin(rig.seatT * 0.031) * 0.05 : 0;
        let dy = bench.yaw + drift - rig.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        rig.yaw += dy * (1 - Math.exp(-rate * dt));
        const wantPitch = (bench.pitch ?? -0.05) + (bench.drift ? Math.sin(rig.seatT * 0.057) * 0.02 : 0);
        rig.pitch += (wantPitch - rig.pitch) * (1 - Math.exp(-rate * dt));
      }
    } else rig.seated = false;
    // a view may ask to stand further back than the boom (the boat, with its speed): eased, on top of the wheel's zoom
    rig.extra = (rig.extra ?? 0) + ((bench?.extraBoom ?? 0) - (rig.extra ?? 0)) * (1 - Math.exp(-1.5 * dt));

    j.visible = !rig.isFirstPerson();
    // the look target: chest height, with a little of the stride's bob
    const bob = j.gait.pose.bounce * 0.5;
    // seated: aim a little above the head, so the jogger sits in the lower third
    if (bench && bench.lift !== undefined) { j.eye(_t); _t.y += bench.lift; } else _t.set(j.e, j.y + 1.45 + bob, -j.n);
    const fwd = _v.set(-Math.sin(rig.yaw) * Math.cos(rig.pitch), Math.sin(rig.pitch), -Math.cos(rig.yaw) * Math.cos(rig.pitch));
    const right = new THREE.Vector3(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw));
    if (rig.isFirstPerson()) {
      j.eye(_eye);
      rig.pos.copy(_eye);
    } else {
      const over = (bench?.side ?? 0.45) * Math.min(1, rig.boom / 3);
      _eye.copy(_t).addScaledVector(fwd, -(rig.boom + rig.extra)).addScaledVector(right, over);
      // lag the boom a touch; snap on teleports
      if (first || snap) rig.pos.copy(_eye); else rig.pos.lerp(_eye, 1 - Math.exp(-14 * dt));
    }
    first = false;
    // never under the ground or the water
    const g = Math.max(groundAt(rig.pos.x, -rig.pos.z), 0) + 0.35;
    if (rig.pos.y < g) rig.pos.y = g;
    camera.position.copy(rig.pos);
    camera.quaternion.setFromEuler(new THREE.Euler(rig.pitch, rig.yaw, 0, 'YXZ'));
    rig.target.copy(_t);
  };
  rig.overview = overview;
  return rig;
}
