import * as THREE from 'three';
import { spineAt } from '../world/frame.js';
import { walkY, BENCHES, BENCH_SEAT, stepSeat as stairSeat } from '../world/dam.js';
import { seatPose, stepSeat, applySeat } from './body.js';

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
 *   laugh      join the laughter club's circle for a round (6 s)
 *
 * Chai, yoga and the laughter club finish on their own and can be cancelled
 * with any movement key, like standing up from a seat.  Time here is game time
 * (update(dt)), so it pauses with the game and fast-forwards with it.
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
  const club = crowd.people.filter((p) => p.act === 'laugh');
  const clubCentre = club.length ? club.reduce((a, p) => [a[0] + p.e / club.length, a[1] + p.n / club.length], [0, 0]) : null;
  let clock = 0; // game seconds
  let lastFive = null;
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
    // a water step: anywhere on its landing or its flight, measured in the flight's own
    // straight frame (it runs straight out from its spine point, not along the curve)
    for (const st of steps) {
      const f = spineAt(st.s), de = e - f.e, dn = n - f.n;
      const u = de * f.ne + dn * f.nn, v = -de * f.nn + dn * f.ne;
      const last = st.treads[st.treads.length - 1].d1;
      {
        if (Math.abs(v) < st.width / 2 + 0.6 && u > st.landing.d0 - 1.2 && u < last + 0.5) {
          // the lowest tread that is dry and that you may stand on (world/dam.js stepSeat)
          const pick = stairSeat(st);
          if (pick) return { kind: 'steps', label: 'sit on the steps', st, seat: pick.seat, foot: pick.foot, f: pick.f };
        }
      }
    }
    if (plaza?.kiosk && Math.hypot(plaza.kiosk[0] - e, plaza.kiosk[1] - n) < 4.5) return { kind: 'chai', label: 'a cutting chai' };
    if (yogaCentre && Math.hypot(yogaCentre[0] - e, yogaCentre[1] - n) < 7) return { kind: 'yoga', label: 'join the yoga' };
    if (clubCentre && Math.hypot(clubCentre[0] - e, clubCentre[1] - n) < 7) return { kind: 'laugh', label: 'join the laughter club' };
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
    bubbles.push({ who, text, from: clock + delay, until: clock + delay + secs });
  }

  function activate() {
    const c = current;
    if (!c) return;
    const now = clock;
    switch (c.kind) {
      case 'greet': {
        const k = kindOf(c.p);
        const mine = pick(k === 'sikh' ? GREET.sikh : k === 'auntie' ? GREET.auntie : GREET.default);
        say('player', mine);
        // they answer in kind -- in their own words, not an echo of yours
        const replies = GREET[k].filter((g) => g !== mine);
        say(c.p, pick(replies.length ? replies : GREET.default.filter((g) => g !== mine)), 2.2, 0.9);
        break;
      }
      case 'five':
        c.p.hf = 0.9;
        lastFive = c.p.id;
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
      case 'laugh':
        // a round with the club: arms up, rocking with the laughter
        busy = { kind: 'laugh', until: now + 6 };
        jogger.frozen = true;
        jogger.heading = Math.atan2(-(clubCentre[0] - jogger.e), clubCentre[1] - jogger.n);
        jogger.override = (pose) => { const k = Math.sin(clock * 11); pose.shoulderL = pose.shoulderR = -2.5 + 0.3 * k; pose.elbowL = pose.elbowR = 0.3; pose.lean = -0.12; pose.bounce = 0.03 * Math.abs(k); };
        say('player', 'Ha ha ha ha!', 2.2);
        if (club[0]) say(club[0], 'Ho ho, ha ha ha!', 2, 1.2);
        break;
      case 'bench': {
        busy = { kind: 'bench', until: Infinity, f: c.f };
        jogger.frozen = true;
        jogger.e = c.be; jogger.n = c.bn;
        // hips on the seat, feet on the ground (seatPose fits the jogger's own proportions)
        const ground = walkY(c.bench.s), sp = seatPose(jogger.body, ground + BENCH_SEAT, ground);
        jogger.y = sp.rootY;
        jogger.override = (pose) => applySeat(pose, sp);
        jogger.heading = Math.atan2(-c.f.ne, c.f.nn);
        jogger.sitting = 1;
        hud.flash('move to get up', 1400);
        break;
      }
      case 'steps': {
        // seated on the tread: the hips just over it, the feet down the flight
        // how steep the flight is: the seated camera looks down enough to clear the treads behind
        const tr = c.st.treads, grade = tr.length > 1 ? (tr[0].y - tr[tr.length - 1].y) / Math.max(0.5, tr[tr.length - 1].d1 - tr[0].d0) : 0.3;
        busy = { kind: 'steps', until: Infinity, f: c.f, grade };
        jogger.frozen = true;
        // the hips on this tread, the feet on the one below: place the root so the
        // ankles land mid-way down the lower tread, keeping the hips on the seat
        const { sp, d } = stepSeat(jogger.body, c.seat, c.foot);
        jogger.e = c.f.e + c.f.ne * d; jogger.n = c.f.n + c.f.nn * d;
        jogger.y = sp.rootY;
        jogger.override = (pose) => applySeat(pose, sp);
        jogger.heading = Math.atan2(-c.f.ne, c.f.nn);
        jogger.sitting = 1;
        hud.flash('move to get up', 1400);
        break;
      }
      default: break;
    }
  }

  function end(cancelled = false) {
    if (!busy) return;
    // stand up where you sat, on the surface there
    if (busy.kind === 'bench' || busy.kind === 'steps') jogger.y = jogger.collider.surfaceAt(jogger.e, jogger.n);
    jogger.frozen = false;
    jogger.override = null;
    if (busy.kind === 'chai' && !cancelled) { jogger.stamina = 100; hud.flash('stamina refilled', 1200); }
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
      // over the shoulder: ~3 m behind, a little to one side and above the head, looking
      // past the jogger to the lake (the jogger in the lower third), drifting slowly
      if (busy?.kind === 'bench') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn), pitch: -0.1, boom: 3.0, side: 0.75, lift: 0.3, drift: true };
      // on a flight the camera sits up the steps behind you: tilt down with the flight so it
      // clears the treads (on the jetty's steep stair it was level with them and lost you)
      if (busy?.kind === 'steps') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn), pitch: -Math.max(0.1, Math.atan(busy.grade) * 0.9 + 0.08), boom: 3.0, side: 0.75, lift: 0.3, drift: true };
      return null;
    },
    /** Sitting on a bench or the water steps (the music plays). */
    get seated() { return busy?.kind === 'bench' || busy?.kind === 'steps'; },
    /** What the player is doing (null, or bench / steps / chai / yoga / laugh / five). */
    get state() { return busy?.kind ?? null; },
    /** The nearest thing E would do right now. */
    get current() { return current ? { kind: current.kind, label: current.label } : null; },
    /** Who you last high-fived (a crowd id). */
    get lastFive() { return lastFive; },
    /** Leave whatever you're doing (teleports, tests). */
    cancel() { end(true); },
    update(dt = 1 / 60) {
      clock += dt;
      const now = clock;
      if (busy) {
        const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => jogger.keys.has(k));
        // everything ends on its own (seats never do), and any movement key cancels it
        if (now > busy.until) end();
        else if (moving && busy.kind !== 'five') end(true);
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
