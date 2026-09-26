import * as THREE from 'three';
import { spineAt, nearestS } from '../world/frame.js';
import { walkY, BENCHES } from '../world/dam.js';

/* ------------------------------------------------------------------ *
 * E interactions (plan §6): short and non-blocking.
 *
 *   greet      "Sat Sri Akal ji" / "Namaste ji" / "Good morning!" to
 *              whoever is near, and they answer in kind
 *   chai       a cutting chai at the plaza stall: 4 s, stamina back to 100
 *   yoga       join the group on the grass for 5 s, arms up
 *   bench      sit; the camera settles on the lake view until you move
 *   steps      at a water step: sit on the lowest dry tread, facing the
 *              lake, the camera low and close to the water
 *   (sitting on either plays the music: core/sound.js)
 *   high five  a jogger coming the other way, as you pass
 *
 * One prompt at a time, the nearest thing that can be done; the prompt
 * shows the key (E) and what it does.  Bubbles are projected over heads.
 * ------------------------------------------------------------------ */

const GREET = {
  sikh: ['Sat Sri Akal ji!', 'Sat Sri Akal!'],
  auntie: ['Namaste ji!', 'Namaste, beta!'],
  default: ['Good morning!', 'Morning!', 'Namaste!', 'Nice day for it!'],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function createInteractions({ crowd, jogger, hud, camera, world }) {
  const plaza = world.landmarks?.plaza;
  const steps = (world.dam?.waterStairs || []).filter((w) => w.treads?.length);
  const yogaPeople = crowd.people.filter((p) => p.act === 'yoga');
  const yogaCentre = yogaPeople.length ? yogaPeople.reduce((a, p) => [a[0] + p.e / yogaPeople.length, a[1] + p.n / yogaPeople.length], [0, 0]) : null;
  let busy = null; // { kind, t, until, ... }
  let bubbles = []; // { who: {e,n,y,height} | 'player', text, until }
  let current = null;
  const _v = new THREE.Vector3();

  const kindOf = (p) => (['patka', 'turban'].includes(p.body.headwear) ? 'sikh' : p.type === 'auntie' || p.body.headwear === 'dupatta' ? 'auntie' : 'default');

  function find() {
    if (busy) return null;
    const e = jogger.e, n = jogger.n;
    // a bench (a real one on the walk) within 1.8 m, if nobody is on it
    for (const b of BENCHES) {
      const f = spineAt(b.s), be = f.e + f.ne * b.d, bn = f.n + f.nn * b.d;
      if (Math.hypot(be - e, bn - n) < 1.8 && !crowd.people.some((p) => p.bench === b)) return { kind: 'bench', label: 'sit on the bench', bench: b, be, bn, f };
    }
    // a water step: anywhere on its landing or its flight
    {
      const w = nearestS(e, n), d = w.side * w.d;
      for (const st of steps) {
        const last = st.treads[st.treads.length - 1].d;
        if (Math.abs(w.s - st.s) < st.width / 2 + 0.6 && d > st.landing.d0 - 1.2 && d < last + 0.5) {
          // the lowest tread that is still dry (its top at least 12 cm over the lake)
          const dry = st.treads.filter((tr) => tr.y > 0.12);
          const seat = dry[dry.length - 1];
          if (seat) return { kind: 'steps', label: 'sit on the steps', st, seat, f: spineAt(st.s) };
        }
      }
    }
    if (plaza?.kiosk && Math.hypot(plaza.kiosk[0] - e, plaza.kiosk[1] - n) < 4.5) return { kind: 'chai', label: 'a cutting chai' };
    if (yogaCentre && Math.hypot(yogaCentre[0] - e, yogaCentre[1] - n) < 7) return { kind: 'yoga', label: 'join the yoga' };
    const near = crowd.near(e, n, 3.2);
    for (const p of near) {
      if (p.mode === 'walk' && p.speed > 2 && jogger.speed > 1.2) {
        // coming the other way: facing each other
        const dot = Math.cos(p.yaw - jogger.heading);
        if (dot < -0.3) return { kind: 'five', label: 'high five', p };
      }
    }
    if (near.length) return { kind: 'greet', label: 'say hello', p: near[0] };
    return null;
  }

  function say(who, text, secs = 2.2, delay = 0) {
    bubbles.push({ who, text, from: performance.now() / 1000 + delay, until: performance.now() / 1000 + delay + secs });
  }

  function activate() {
    const c = current;
    if (!c) return;
    const now = performance.now() / 1000;
    switch (c.kind) {
      case 'greet': {
        const k = kindOf(c.p);
        say('player', pick(k === 'sikh' ? GREET.sikh : k === 'auntie' ? GREET.auntie : GREET.default));
        say(c.p, pick(GREET[k]), 2.2, 0.9);
        break;
      }
      case 'five':
        c.p.hf = 0.9;
        busy = { kind: 'five', until: now + 0.9 };
        jogger.override = (pose) => { pose.shoulderR = -2.7; pose.elbowR = 0.2; };
        say('player', 'Up top!', 1.4);
        break;
      case 'chai': {
        busy = { kind: 'chai', until: now + 4 };
        jogger.frozen = true;
        jogger.override = (pose) => { pose.shoulderR = 1.2; pose.elbowR = 2.2; };
        say('player', 'Ek cutting chai, bhaiya!', 1.8);
        const v = crowd.people.find((p) => p.act === 'vend');
        if (v) say(v, 'Garam hai, dhyaan se!', 2, 1.4);
        break;
      }
      case 'yoga':
        busy = { kind: 'yoga', until: now + 5 };
        jogger.frozen = true;
        jogger.override = (pose) => { pose.shoulderL = pose.shoulderR = -2.9; pose.elbowL = pose.elbowR = 0; };
        say('player', 'Namaste!', 1.6);
        break;
      case 'bench': {
        busy = { kind: 'bench', until: Infinity, f: c.f };
        jogger.frozen = true;
        jogger.e = c.be; jogger.n = c.bn;
        jogger.y = walkY(c.bench.s);
        jogger.heading = Math.atan2(-c.f.ne, c.f.nn);
        jogger.sitting = 1;
        hud.flash('move to get up', 1400);
        break;
      }
      case 'steps': {
        // seated on the tread: the hips just over it, the feet down the flight
        busy = { kind: 'steps', until: Infinity, f: c.f };
        jogger.frozen = true;
        const back = 0.12; // sit toward the back of the tread
        jogger.e = c.f.e + c.f.ne * (c.seat.d - back); jogger.n = c.f.n + c.f.nn * (c.seat.d - back);
        jogger.y = c.seat.y - 0.4;
        jogger.heading = Math.atan2(-c.f.ne, c.f.nn);
        jogger.sitting = 1;
        hud.flash('move to get up', 1400);
        break;
      }
      default: break;
    }
  }

  function end() {
    if (!busy) return;
    jogger.frozen = false;
    jogger.override = null;
    if (busy.kind === 'chai') { jogger.stamina = 100; hud.flash('stamina refilled', 1200); }
    jogger.sitting = 0;
    busy = null;
  }

  function project(who) {
    if (who === 'player') _v.set(jogger.e, jogger.y + 2.15, -jogger.n);
    else _v.set(who.e, who.y + (who.body?.height ?? 1.7) + 0.35, -who.n);
    _v.project(camera);
    if (_v.z > 1) return null;
    return [(_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight];
  }

  return {
    activate,
    /** A speech bubble over someone ('player', a person, or anything with e, n, y), after `delay` s. */
    say,
    /** The bench's lake view for the camera, while sitting. */
    benchView() {
      if (busy?.kind === 'bench') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn) };
      // the steps: low and close, just over the water
      if (busy?.kind === 'steps') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn), pitch: -0.03, boom: 2.2 };
      return null;
    },
    /** Sitting on a bench or the water steps (the music plays). */
    get seated() { return busy?.kind === 'bench' || busy?.kind === 'steps'; },
    update() {
      const now = performance.now() / 1000;
      if (busy) {
        const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => jogger.keys.has(k));
        if (now > busy.until || ((busy.kind === 'bench' || busy.kind === 'steps') && moving)) end();
      }
      current = find();
      hud.setPrompt(current ? `E · ${current.label}` : '');
      // the newest live bubble wins the one bubble slot
      bubbles = bubbles.filter((b) => b.until > now);
      const live = bubbles.filter((b) => b.from <= now).pop();
      const at = live ? project(live.who) : null;
      hud.say(at ? live.text : '', at?.[0], at?.[1]);
    },
  };
}
