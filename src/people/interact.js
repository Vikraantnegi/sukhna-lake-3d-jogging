import * as THREE from 'three';
import { data, spineAt } from '../world/frame.js';
import { walkY, BENCHES, DAM } from '../world/dam.js';

/* ------------------------------------------------------------------ *
 * E interactions (plan §6): short and non-blocking.
 *
 *   greet      "Sat Sri Akal ji" / "Namaste ji" / "Good morning!" to
 *              whoever is near, and they answer in kind
 *   chai       a cutting chai at the plaza stall: 4 s, stamina back to 100
 *   yoga       join the group on the grass for 5 s, arms up
 *   bench      sit; the camera settles on the lake view until you move
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
    benchView() { return busy?.kind === 'bench' ? { yaw: Math.atan2(-busy.f.ne, busy.f.nn) } : null; },
    update() {
      const now = performance.now() / 1000;
      if (busy) {
        const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => jogger.keys.has(k));
        if (now > busy.until || (busy.kind === 'bench' && moving)) end();
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
