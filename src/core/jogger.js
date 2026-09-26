import * as THREE from 'three';
import { cel } from './toon.js';
import { hullOutline } from './outline.js';
import { makeBody, poseBody, partGeometries, headwearGeometry, partColours, PARTS, P, OUTFITS } from '../people/body.js';
import { createGait } from '../people/gait.js';
import { L, spineAt, nearestS } from '../world/frame.js';
import { LAYER, setLayers } from '../world/chunks.js';

/* ------------------------------------------------------------------ *
 * The jogger (plan §6): movement, stamina, auto-jog, the run's numbers,
 * and the visible body.  Adapted from the reference's player (pointer-lock
 * look, key handling, collision against the world) with a third-person
 * body and a jogging model instead of a first-person walk.
 *
 *   walk 1.5 m/s   jog 3.0 m/s (W, the default)   sprint 5.2 m/s (Shift)
 *   stamina: sprint -9/s, jog +1.5/s, walk or stand +10/s
 *   releasing W eases down through a walk to a stop
 *   V: auto-jog along the walk; turns round at each end; WASD cancels
 * ------------------------------------------------------------------ */

export const SPEED = { walk: 1.5, jog: 3.0, sprint: 5.2, stairs: 1.6 };

const tmpM = () => new THREE.Matrix4();

export class Jogger {
  constructor({ scene, collider, spawn, outfit = 0 }) {
    this.collider = collider;
    this.e = spawn.e; this.n = spawn.n; this.y = collider.surfaceAt(spawn.e, spawn.n);
    this.heading = spawn.heading ?? 0; // three yaw: 0 faces -z (north)
    this.speed = 0;
    this.stamina = 100;
    this.spent = false; // sprinted out: no sprint until stamina is back to 30
    this.auto = false;
    this.autoDir = 1;
    this.distance = 0;
    this.elapsed = 0;
    this.lengths = 0;
    this.lastEnd = null;
    this.sprinting = false;
    this.sitting = 0; // 0..1, driven by interactions
    this.frozen = false; // interactions hold the jogger still
    this.override = null; // interactions bend the pose (a cup of chai, a high five, yoga)
    this.lane = -1.6; // auto-jog keeps a little to the city side of the centre
    this.avoid = null; // (e, n, heading) -> lateral offset; the crowd provides it
    this.keys = new Set();
    this.gait = createGait();
    this.group = new THREE.Group();
    this.group.name = 'jogger';
    this.parts = [];
    this.poseM = PARTS.map(() => tmpM());
    this.setOutfit(outfit);
    scene.add(this.group);
  }

  /** Build (or rebuild) the body for one of the three outfits. */
  setOutfit(i) {
    // part geometries are shared with every other body: remove the meshes, keep the geometry
    for (const m of this.parts) if (m) this.group.remove(m);
    this.parts = [];
    this.outfit = i;
    this.body = makeBody(OUTFITS[i].row);
    const geos = partGeometries(), cols = partColours(this.body);
    PARTS.forEach((name, k) => {
      const geo = name === 'headwear' ? headwearGeometry(this.body.headwear) : geos[k];
      if (!geo || (name === 'dupatta' && this.body.headwear !== 'dupatta')) { this.parts.push(null); return; }
      const m = new THREE.Mesh(geo, cel({ color: cols[k], bands: 3, flat: false }));
      m.matrixAutoUpdate = false;
      m.castShadow = true;
      m.name = `jogger.${name}`;
      if (name !== 'eyes') hullOutline(m, { thickness: 0.0032 });
      else m.castShadow = false;
      setLayers(m, LAYER.NEAR);
      this.group.add(m);
      this.parts.push(m);
    });
  }

  set visible(v) { this.group.visible = v; }

  /** Where the jogger is on the walk: { s, d, side }. */
  where() { return nearestS(this.e, this.n); }

  toggleAuto() {
    this.auto = !this.auto;
    if (this.auto) {
      // head whichever way along the walk we are already facing
      const w = this.where(), f = spineAt(w.s);
      const fx = -Math.sin(this.heading), fn = Math.cos(this.heading); // facing, in (e, n)
      this.autoDir = fx * f.te + fn * f.tn >= 0 ? 1 : -1;
    }
    return this.auto;
  }

  /**
   * One step.  `camYaw` is the camera's yaw (W runs away from the camera);
   * returns the ground speed.
   */
  update(dt, camYaw) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const shift = k.has('ShiftLeft') || k.has('ShiftRight');
    if ((f || s) && this.auto) this.auto = false;
    if (this.stamina <= 0.5) this.spent = true;
    else if (this.stamina >= 30) this.spent = false;
    const canSprint = shift && !this.spent;
    if (this.frozen) { this.speed = 0; this.gait.update(dt, 0, this.sitting); this.override?.(this.gait.pose); this.pose(); return 0; }

    let target = 0, want = null;
    if (this.auto) {
      const w = this.where(), fr = spineAt(w.s);
      // turn round at each end of the walk
      if (this.autoDir > 0 && w.s > L - 7) this.autoDir = -1;
      else if (this.autoDir < 0 && w.s < 7) this.autoDir = 1;
      // steer back to the lane (d measured toward the lake), round anyone ahead
      const dNow = w.side * w.d;
      const avoid = this.avoid ? this.avoid(this.e, this.n, this.heading) : 0;
      const lateral = THREE.MathUtils.clamp((this.lane + avoid - dNow) * 0.35, -0.8, 0.8);
      const de = fr.te * this.autoDir + fr.ne * lateral, dn = fr.tn * this.autoDir + fr.nn * lateral;
      want = Math.atan2(-de, dn);
      target = canSprint ? SPEED.sprint : SPEED.jog;
    } else if (f || s) {
      // camera-relative direction, in (e, n): forward is (-sin yaw, cos yaw)
      const fe = -Math.sin(camYaw), fn = Math.cos(camYaw);
      const de = fe * f + fn * s, dn = fn * f - fe * s;
      want = Math.atan2(-de, dn);
      target = f < 0 && !s ? SPEED.walk : canSprint ? SPEED.sprint : SPEED.jog;
    }
    // on a flight of steps nobody jogs: a stair-walking pace, so the feet land on every tread
    const onStairs = this.collider.onFlight?.(this.e, this.n);
    if (onStairs) target = Math.min(target, SPEED.stairs);
    this.sprinting = target === SPEED.sprint;

    // speed: quick to pick up, and on release easing down through a walk to a stop
    const rate = target > this.speed ? 2.6 : (this.speed > SPEED.walk ? 1.6 : 1.1);
    this.speed += (target - this.speed) * (1 - Math.exp(-rate * dt));
    if (target === 0 && this.speed < 0.05) this.speed = 0;
    if (want !== null) {
      let dh = want - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      const turn = (this.auto ? 1.6 : 7) * dt;
      this.heading += THREE.MathUtils.clamp(dh, -turn, turn);
    }

    // stamina
    if (this.sprinting && this.speed > SPEED.jog + 0.3) this.stamina = Math.max(0, this.stamina - 9 * dt);
    else if (this.speed > SPEED.walk + 0.4) this.stamina = Math.min(100, this.stamina + 1.5 * dt);
    else this.stamina = Math.min(100, this.stamina + 10 * dt);

    // move, sliding along whatever is in the way
    const step = this.speed * dt;
    if (step > 0) {
      const de = -Math.sin(this.heading) * step, dn = Math.cos(this.heading) * step;
      const [e2, n2] = this.collider.move(this.e, this.n, de, dn);
      const moved = Math.hypot(e2 - this.e, n2 - this.n);
      this.e = e2; this.n = n2;
      this.distance += moved;
      if (moved < step * 0.2 && this.auto) this.autoDir *= -1; // walked into something: turn back
    }
    if (this.speed > 0.2) this.elapsed += dt;
    // follow the surface; on steps, fast enough to land on each tread (the playtest found the
    // feet sinking 0.13-0.21 m into the step above when climbing at jog speed)
    // (on stairs *now*, after the move: the first step onto a flight snaps too)
    const surface = this.collider.surfaceAt(this.e, this.n), stairsNow = this.collider.onFlight?.(this.e, this.n);
    if (stairsNow && surface > this.y) this.y = surface;
    else this.y += (surface - this.y) * (1 - Math.exp(-(stairsNow ? 40 : 18) * dt));

    // lengths: every arrival at one end of the walk after touching the other
    const w = this.where();
    if (w.d < 12) {
      // 25 m end zones: a jog that starts just off an end still counts its first length
      // (the playtest's there-and-back from s 12 only counted 1)
      if (w.s < 25) { if (this.lastEnd === 'west') this.lengths++; this.lastEnd = 'east'; }
      else if (w.s > L - 25) { if (this.lastEnd === 'east') this.lengths++; this.lastEnd = 'west'; }
    }

    this.gait.update(dt, this.speed, this.sitting);
    this.override?.(this.gait.pose);
    this.pose();
    return this.speed;
  }

  pose() {
    const root = new THREE.Matrix4().compose(new THREE.Vector3(this.e, this.y, -this.n), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading), new THREE.Vector3(1, 1, 1));
    poseBody(this.body, this.gait.pose, this.poseM);
    this.parts.forEach((m, k) => { if (m) m.matrix.multiplyMatrices(root, this.poseM[k]); });
    this.group.updateMatrixWorld(true);
  }

  /** The head, for the first-person camera (world). */
  eye(out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.parts[P.head]?.matrixWorld ?? new THREE.Matrix4()).add(new THREE.Vector3(0, 0.06, 0));
  }

  /** Current pace as "m:ss" per km, or "--:--" when (nearly) still. */
  pace() {
    if (this.speed < 0.4) return '--:--';
    const secs = 1000 / this.speed, m = Math.floor(secs / 60), s = Math.round(secs % 60);
    return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`;
  }
}
