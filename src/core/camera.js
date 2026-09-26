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
 *   bench         settles on the lake view while you sit
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
    // bench: settle on the lake view
    if (bench) {
      let dy = bench.yaw - rig.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      rig.yaw += dy * (1 - Math.exp(-1.2 * dt));
      rig.pitch += ((bench.pitch ?? -0.05) - rig.pitch) * (1 - Math.exp(-1.2 * dt));
      // the bench keeps the boom at least 3.2 m; the steps ask for a close 2.2 m
      if (bench.boom !== undefined) rig.boomTarget += (bench.boom - rig.boomTarget) * (1 - Math.exp(-1.5 * dt));
      else rig.boomTarget = Math.max(rig.boomTarget, 3.2);
    }

    j.visible = !rig.isFirstPerson();
    // the look target: chest height, with a little of the stride's bob
    const bob = j.gait.pose.bounce * 0.5;
    _t.set(j.e, j.y + 1.45 + bob, -j.n);
    const fwd = _v.set(-Math.sin(rig.yaw) * Math.cos(rig.pitch), Math.sin(rig.pitch), -Math.cos(rig.yaw) * Math.cos(rig.pitch));
    const right = new THREE.Vector3(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw));
    if (rig.isFirstPerson()) {
      j.eye(_eye);
      rig.pos.copy(_eye);
    } else {
      const over = 0.45 * Math.min(1, rig.boom / 3);
      _eye.copy(_t).addScaledVector(fwd, -rig.boom).addScaledVector(right, over);
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
