import { restPose } from './body.js';

/* ------------------------------------------------------------------ *
 * Procedural gait (plan §6), phase-driven.
 *
 * One phase per stride (two steps).  Cadence and stride length both grow
 * with speed, so a walk and a sprint are the same code; the joint curves
 * blend from a walk's shape (straight-ish knees, relaxed arms, no flight)
 * to a run's (high heel recovery, elbows at ~90°, a bounce with a flight
 * phase, more lean).  `style` rows let NPCs differ: an uncle's stiff brisk
 * walk, hands behind the back, a slow shuffle.
 * ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Steps per second at a speed (m/s): ~1.8 at a stroll, ~2.7 jogging, ~3.1 sprinting. */
export function cadence(speed) {
  if (speed < 0.05) return 0;
  return Math.min(3.3, 1.55 + speed * 0.42 - Math.max(0, speed - 3) * 0.12);
}

export function createGait(style = {}) {
  const st = { armSwing: 1, stride: 1, stiff: 0, handsBehind: false, bounce: 1, lean: 1, ...style };
  const pose = restPose();
  let phase = Math.random();
  let breath = Math.random() * TAU;
  return {
    pose,
    get phase() { return phase; },
    /** Advance by dt at `speed`; `sit` 0..1 folds into a seated pose. */
    update(dt, speed, sit = 0) {
      const run = smooth(2.1, 2.9, speed);            // 0 walk shape .. 1 run shape
      const cad = cadence(speed) * (st.cadence ?? 1);
      phase = (phase + (cad / 2) * dt) % 1;           // one stride = two steps
      breath += dt * (1.4 + speed * 0.5);
      const moving = smooth(0.05, 0.5, speed);
      const a = phase * TAU, aR = a + Math.PI;

      // legs: hip swing grows with speed; knee flexion peaks as the leg recovers behind
      const hipAmp = (0.32 + 0.3 * run + Math.min(0.2, Math.max(0, speed - 3.5) * 0.12)) * st.stride * moving * (1 - st.stiff * 0.4);
      const kneeRec = (0.35 + 1.35 * run) * moving * (1 - st.stiff * 0.5);
      const knee = (x) => kneeRec * Math.pow(Math.max(0, Math.sin(x - 0.9)), 1.6) + (0.08 + 0.18 * run) * moving;
      pose.hipL = Math.sin(a) * hipAmp;
      pose.hipR = Math.sin(aR) * hipAmp;
      pose.kneeL = knee(a + Math.PI);
      pose.kneeR = knee(aR + Math.PI);
      pose.ankleL = -Math.sin(a) * 0.25 * moving;
      pose.ankleR = -Math.sin(aR) * 0.25 * moving;

      // arms swing opposite the legs; runners carry their elbows bent
      const armAmp = (0.25 + 0.35 * run) * st.armSwing * moving;
      if (st.handsBehind) {
        pose.shoulderL = pose.shoulderR = -0.5;
        pose.elbowL = pose.elbowR = 0.9;
        pose.armOutL = pose.armOutR = 0.25;
      } else {
        pose.shoulderL = -Math.sin(a) * armAmp;
        pose.shoulderR = -Math.sin(aR) * armAmp;
        const elbow = 0.18 + 1.25 * run + 0.15 * moving;
        pose.elbowL = elbow + Math.max(0, Math.sin(a)) * 0.25 * run;
        pose.elbowR = elbow + Math.max(0, Math.sin(aR)) * 0.25 * run;
        pose.armOutL = pose.armOutR = 0.07 + 0.05 * run;
      }

      // body: a bounce twice per stride (with flight when running), lean and twist
      pose.bounce = (Math.cos(a * 2) * 0.5 + 0.5) * (0.018 + 0.05 * run) * st.bounce * moving - 0.02 * run * moving;
      pose.lean = (0.04 + 0.12 * run + Math.max(0, speed - 4) * 0.04) * st.lean * moving;
      pose.twist = Math.sin(a) * 0.07 * moving * (1 - st.stiff * 0.5);
      pose.sway = Math.sin(a) * 0.012 * moving;
      // standing: breathing
      pose.bounce += (1 - moving) * Math.sin(breath) * 0.004;
      pose.sit = sit;
      if (sit > 0) {
        pose.hipL = pose.hipR = pose.kneeL = pose.kneeR = pose.ankleL = pose.ankleR = 0;
        pose.shoulderL = pose.shoulderR = 0.25 * sit;
        pose.elbowL = pose.elbowR = 0.6 * sit;
        pose.lean = -0.05 * sit;
      }
      return pose;
    },
  };
}
