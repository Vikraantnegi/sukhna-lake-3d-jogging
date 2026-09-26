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
 *   join       a standing circle (the laughter club, the chatting groups in
 *              the park) within ~4 m: step into a gap they open, face the
 *              middle and join in -- laughing and clapping with the club,
 *              nodding and chatting with the others -- until you leave
 *              (Esc, or any movement key)
 *   boating    a ticket at the shack by the Boating gateway (clear or fog;
 *              "Closed · rain" in rain) -> down the jetty stair -> E at a
 *              moored swan -> pedal (core/boat.js) -> "E · dock" near a free
 *              berth; anywhere else E says to dock at the jetty.  Esc only
 *              pauses: nothing drops you out of the boat.
 *
 * Chai and yoga finish on their own; they, a seat and a circle end with any
 * movement key.  Time here is game time (update(dt)), so it pauses with the
 * game and fast-forwards with it.
 *
 * One prompt at a time, the nearest thing that can be done; the prompt
 * shows the key (E) and what it does (or, when it can't be done, why).
 * Bubbles are projected over heads.
 * ------------------------------------------------------------------ */

const GREET = {
  sikh: ['Sat Sri Akal ji!', 'Sat Sri Akal!'],
  auntie: ['Namaste ji!', 'Namaste, beta!'],
  default: ['Good morning!', 'Morning!', 'Namaste!', 'Nice day for it!'],
};
const CHAT = ['Aaj dhoop achhi nikli hai.', 'Kal toh bahut dhund thi!', 'Walk ke baad chai?', 'Mere ghutne ab pehle jaise nahi.', 'Beta, roz aaya karo!', 'Itne log aaj Sukhna pe!', 'Pani kitna saaf lag raha hai.', 'Das chakkar ho gaye aaj.'];
const NODS = ['Haan ji!', 'Sahi baat hai.', 'Bilkul!', 'Hmm, haan.'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const HINTS = {
  boat: 'W/S pedal · A/D steer · Shift pedal hard · E dock · T time · K rain · P overview · M sound · H hide · Esc pause',
  group: 'Esc · leave the group · WASD leave · T time · K rain · M sound · H hide',
};

export function createInteractions({ crowd, jogger, hud, camera, world, boat = null, weather = null }) {
  const plaza = world.landmarks?.plaza;
  const club = world.landmarks?.club;
  const jf = club?.jetty ? spineAt(club.jetty.s) : null;
  const steps = (world.dam?.waterStairs || []).filter((w) => w.treads?.length);
  const yogaPeople = crowd.people.filter((p) => p.act === 'yoga');
  const yogaCentre = yogaPeople.length ? yogaPeople.reduce((a, p) => [a[0] + p.e / yogaPeople.length, a[1] + p.n / yogaPeople.length], [0, 0]) : null;
  let clock = 0; // game seconds
  let lastFive = null;
  let ticket = false;
  let busy = null; // { kind, t, until, ... }
  let bubbles = []; // { who: {e,n,y,height} | 'player', text, until }
  let current = null;
  const _v = new THREE.Vector3();
  const hooks = { onTalk: null, onLeave: null };

  const kindOf = (p) => (['patka', 'turban'].includes(p.body.headwear) ? 'sikh' : p.type === 'auntie' || p.body.headwear === 'dupatta' ? 'auntie' : 'default');
  /** On the jetty's deck (in the jetty's own frame: u out along it, v across)? */
  const onJetty = (e, n) => {
    if (!jf) return false;
    const de = e - jf.e, dn = n - jf.n, u = de * jf.ne + dn * jf.nn, v = de * jf.te + dn * jf.tn;
    return u > club.jetty.d0 - 0.5 && u < club.jetty.d1 + 0.5 && Math.abs(v) < 3.3;
  };

  function find() {
    // in the boat: dock near a free berth; anywhere else E only says where to get off
    if (busy?.kind === 'boat') {
      if (boat.phase !== 'on') return null;
      // (not the berth you've only just left: pedal off a few metres first)
      const b = boat.state.distance > 8 ? boat.freeBerth() : null;
      return b ? { kind: 'dock', label: 'dock', berth: b } : { kind: 'say', text: 'Dock at the jetty to get off', silent: true };
    }
    if (busy) return null;
    const e = jogger.e, n = jogger.n;
    // the ticket counter, at the shack's window
    const shack = club?.shack;
    if (shack && Math.hypot(shack.counter[0] - e, shack.counter[1] - n) < 1.8) {
      if (weather?.state.kind === 'rain') return { kind: 'say', text: 'Closed · rain' };
      if (ticket) return { kind: 'say', text: 'Ticket in hand · the jetty is down the steps' };
      return { kind: 'ticket', label: 'a boat ticket' };
    }
    // a moored swan, from the jetty's deck
    if (boat && onJetty(e, n)) {
      let best = null, bd = 2.8;
      for (const b of club.berths) { if (!b.color) continue; const d = Math.hypot(b.e - e, b.n - n); if (d < bd) { bd = d; best = b; } }
      if (best) return ticket ? { kind: 'board', label: 'take this swan out', berth: best } : { kind: 'say', text: 'Tickets at the counter, up on the walk' };
    }
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
      if (Math.abs(v) < st.width / 2 + 0.6 && u > st.landing.d0 - 1.2 && u < last + 0.5) {
        // the lowest tread that is dry and that you may stand on (world/dam.js stepSeat)
        const seatPick = stairSeat(st);
        if (seatPick) return { kind: 'steps', label: 'sit on the steps', st, seat: seatPick.seat, foot: seatPick.foot, f: seatPick.f };
      }
    }
    if (plaza?.kiosk && Math.hypot(plaza.kiosk[0] - e, plaza.kiosk[1] - n) < 4.5) return { kind: 'chai', label: 'a cutting chai' };
    if (yogaCentre && Math.hypot(yogaCentre[0] - e, yogaCentre[1] - n) < 7) return { kind: 'yoga', label: 'join the yoga' };
    // a standing circle within ~4 m of its edge
    const circle = crowd.circleNear?.(e, n, 4);
    if (circle) return { kind: 'join', label: circle.kind === 'laugh' ? 'join the laughter club' : 'join the group', circle };
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
      case 'say': hud.flash(c.text, 2200); break;
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
      case 'join': {
        // they shuffle round to open a gap; the jogger steps into it and faces the middle
        const slot = crowd.joinCircle(c.circle, jogger.e, jogger.n);
        busy = { kind: 'group', until: Infinity, circle: c.circle, slot, from: [jogger.e, jogger.n, jogger.heading], t: 0, next: now + 2.5, turns: 0, last: null, wasBurst: false };
        jogger.frozen = true;
        jogger.auto = false;
        jogger.override = (pose) => groupPose(pose);
        hud.setHint(HINTS.group);
        say('player', c.circle.kind === 'laugh' ? 'Ha ha, can I join?' : 'Namaste ji!', 1.8);
        break;
      }
      case 'ticket':
        ticket = true;
        hud.setTicket(true);
        say('player', 'One boat, please!', 1.6);
        if (club?.shack) say({ e: club.shack.e, n: club.shack.n, y: club.shack.y + 0.3, body: { height: 1.6 } }, 'Yeh lo, ek ride. Aaram se!', 2.2, 1.1);
        hud.flash('boat ticket · one ride', 1800);
        break;
      case 'board':
        ticket = false;
        hud.setTicket(false);
        busy = { kind: 'boat', until: Infinity };
        jogger.frozen = true;
        jogger.auto = false;
        jogger.speed = 0;
        boat.board(c.berth.i, jogger);
        hud.setHint(HINTS.boat);
        hud.flash('W pedal · A/D steer · dock back at the jetty', 2600);
        break;
      case 'dock':
        boat.dock(c.berth, (b) => {
          // step out onto the deck beside the berth, facing back up the jetty
          jogger.e = b.e - jf.te * b.side * 2.2; jogger.n = b.n - jf.tn * b.side * 2.2;
          jogger.y = jogger.collider.surfaceAt(jogger.e, jogger.n);
          jogger.heading = Math.atan2(jf.ne, -jf.nn);
          busy = null;
          jogger.frozen = false; jogger.override = null; jogger.sitting = 0; jogger.sprinting = false;
          hud.setHint(null);
          hud.flash('moored · thanks for the ride', 1800);
        });
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

  /** The jogger's pose in a circle: with the club, laughing on its bursts and clapping between. */
  function groupPose(pose) {
    const g = busy;
    if (!g || g.kind !== 'group') return;
    const t = clock;
    if (g.circle.kind === 'laugh') {
      if (crowd.laughBurst(crowd.clock)) { const k = Math.sin(t * 11); pose.shoulderL = pose.shoulderR = -2.5 + 0.3 * k; pose.elbowL = pose.elbowR = 0.3; pose.lean = -0.12; pose.bounce = 0.03 * Math.abs(k); }
      else { const clap = Math.abs(Math.sin(t * 5.5)); pose.shoulderL = pose.shoulderR = 1.0; pose.elbowL = pose.elbowR = 1.2; pose.armOutL = pose.armOutR = -0.08 - 0.22 * clap; }
    } else {
      // listening: a nod now and then, hands loosely together; a gesture when it's your turn
      pose.headPitch = 0.12 * Math.max(0, Math.sin(t * 1.7));
      if (g.talking > 0) { pose.shoulderR = 0.5 + 0.25 * Math.sin(t * 4.4); pose.elbowR = 1.3; }
      else { pose.shoulderL = pose.shoulderR = 0.25; pose.elbowL = pose.elbowR = 0.9; pose.armOutL = pose.armOutR = -0.12; }
    }
  }

  /** The group goes on while you're in it: the club's laughs and chants, the others' turns to talk. */
  function groupTick(dt) {
    const g = busy, c = g.circle;
    // step into the gap over ~0.9 s, turning to face the middle
    if (g.t < 1) {
      g.t = Math.min(1, g.t + dt / 0.9);
      const k = g.t * g.t * (3 - 2 * g.t);
      jogger.e = g.from[0] + (g.slot.e - g.from[0]) * k; jogger.n = g.from[1] + (g.slot.n - g.from[1]) * k;
      jogger.y = jogger.collider.surfaceAt(jogger.e, jogger.n);
      let dh = g.slot.yaw - g.from[2];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      jogger.heading = g.from[2] + dh * k;
    }
    if (g.talking > 0) g.talking -= dt;
    const members = c.members.filter((p) => p.active);
    if (!members.length) return;
    if (c.kind === 'laugh') {
      const burst = crowd.laughBurst(crowd.clock);
      if (burst && !g.wasBurst) {
        say('player', pick(['Ha ha ha ha!', 'Ho ho, ha ha ha!', 'Hahaha!']), 2.4);
        say(pick(members), 'Ho ho, ha ha ha!', 2.2, 1.0);
        hooks.onTalk?.('player', 'laugh');
      }
      if (!burst && g.wasBurst) say(pick(members), 'Very good, very good, yay!', 2.4, 1.5);
      g.wasBurst = burst;
      return;
    }
    // a chatting circle: someone says something every few seconds, and now and then it's you
    if (clock >= g.next) {
      g.turns++;
      if (g.turns % 3 === 0) { say('player', pick(NODS), 1.8); g.talking = 1.8; hooks.onTalk?.('player', 'chat'); }
      else {
        const who = pick(members.filter((p) => p !== g.last).length ? members.filter((p) => p !== g.last) : members);
        g.last = who;
        who.talking = 2.6;
        say(who, pick(CHAT), 2.6);
        hooks.onTalk?.(who, 'chat');
      }
      g.next = clock + 3.2 + Math.random() * 2.4;
    }
  }

  function end(cancelled = false) {
    if (!busy) return;
    // stand up where you sat, on the surface there
    if (busy.kind === 'bench' || busy.kind === 'steps') jogger.y = jogger.collider.surfaceAt(jogger.e, jogger.n);
    if (busy.kind === 'group') {
      // step back out of the circle, so it can close up again
      const c = busy.circle, a = Math.atan2(jogger.n - c.cn, jogger.e - c.ce);
      const e = jogger.e + Math.cos(a) * 0.9, n = jogger.n + Math.sin(a) * 0.9;
      if (jogger.collider.free(e, n)) { jogger.e = e; jogger.n = n; jogger.y = jogger.collider.surfaceAt(e, n); }
      crowd.leaveCircle(c);
      hud.setHint(null);
      hooks.onLeave?.();
    }
    if (busy.kind === 'boat') { boat.abort(); hud.setHint(null); }
    jogger.frozen = false;
    jogger.override = null;
    if (busy.kind === 'chai' && !cancelled) { jogger.stamina = 100; hud.flash('stamina refilled', 1200); }
    jogger.sitting = 0;
    busy = null;
  }

  function project(who) {
    if (who === 'player') _v.set(jogger.e, jogger.y + (jogger.sitting ? 1.75 : 2.15), -jogger.n);
    else _v.set(who.e, who.y + (who.body?.height ?? 1.7) + 0.35, -who.n);
    _v.project(camera);
    if (_v.z > 1) return null;
    return [(_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight];
  }

  return {
    activate,
    hooks,
    /** A speech bubble over someone ('player', a person, or anything with e, n, y), after `delay` s. */
    say,
    /** The bench's lake view for the camera, while sitting (and the boat's and the circle's views). */
    benchView() {
      // over the shoulder: ~3 m behind, a little to one side and above the head, looking
      // past the jogger to the lake (the jogger in the lower third), drifting slowly
      if (busy?.kind === 'bench') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn), pitch: -0.1, boom: 3.0, side: 0.75, lift: 0.3, drift: true };
      // on a flight the camera sits up the steps behind you: tilt down with the flight so it
      // clears the treads (on the jetty's steep stair it was level with them and lost you)
      if (busy?.kind === 'steps') return { yaw: Math.atan2(-busy.f.ne, busy.f.nn), pitch: -Math.max(0.1, Math.atan(busy.grade) * 0.9 + 0.08), boom: 3.0, side: 0.75, lift: 0.3, drift: true };
      if (busy?.kind === 'boat') return boat.view();
      // in a circle: behind you, outside the circle, looking across it at the others
      if (busy?.kind === 'group') return { yaw: busy.slot.yaw, pitch: -0.24, boom: 4.4, side: 0.35, lift: 0.25, drift: true };
      return null;
    },
    /** Sitting on a bench or the water steps (the music plays). */
    get seated() { return busy?.kind === 'bench' || busy?.kind === 'steps'; },
    /** What the player is doing (null, or bench / steps / chai / yoga / group / boat / five). */
    get state() { return busy?.kind ?? null; },
    /** The circle you're standing in ({ kind: 'laugh' | 'chat', ... }), or null. */
    get group() { return busy?.kind === 'group' ? busy.circle : null; },
    get ticket() { return ticket; },
    set ticket(v) { ticket = !!v; hud.setTicket(ticket); },
    /** The nearest thing E would do right now. */
    get current() { return current ? { kind: current.kind, label: current.label ?? null, text: current.text ?? null } : null; },
    /** Who you last high-fived (a crowd id). */
    get lastFive() { return lastFive; },
    /** Leave the circle you're in (Esc); false if you weren't in one. */
    leaveGroup() { if (busy?.kind !== 'group') return false; end(true); return true; },
    /** Leave whatever you're doing (teleports, tests). */
    cancel() { end(true); },
    update(dt = 1 / 60) {
      clock += dt;
      const now = clock;
      if (busy) {
        const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some((k) => jogger.keys.has(k));
        // everything but a seat, a circle and the boat ends on its own; a movement key
        // ends it too (the keys pedal and steer the boat, so nothing ends that but docking)
        if (now > busy.until) end();
        else if (moving && busy.kind !== 'five' && busy.kind !== 'boat') end(true);
        else if (busy.kind === 'group') groupTick(dt);
      }
      current = find();
      hud.setPrompt(current ? (current.label ? `E · ${current.label}` : current.silent ? '' : current.text) : '');
      // the newest live bubble wins the one bubble slot
      bubbles = bubbles.filter((b) => b.until > now);
      const live = bubbles.filter((b) => b.from <= now).pop();
      if (live) camera.updateMatrixWorld(); // this frame's camera (it has moved since the last render)
      const at = live ? project(live.who) : null;
      hud.say(at ? live.text : '', at?.[0], at?.[1]);
    },
  };
}
