import * as THREE from 'three';
import { spineAt, nearestS, shoreDist } from '../world/frame.js';

/* ------------------------------------------------------------------ *
 * Sound (plan §6, Phase 7): WebAudio, every sound generated in code --
 * no recordings ship with the project.  M toggles everything.
 *
 *   beds       water lapping at the real shoreline (louder the nearer you
 *              are, panned to the water), wind and leaves, rain on the
 *              ground and rain on the water
 *   one-shots  birdsong (FM chirps; the species mix and density follow the
 *              sun: lapwings before dawn, the dawn chorus, mynas and crows
 *              later, a dusk chorus), parakeets screeching overhead when
 *              their flock crosses, wings when a resting flock lifts off,
 *              the eight's oars on every catch and the cox's calls,
 *              footsteps and breathing from the jogger's own gait and
 *              stamina, a scooter horn from the city now and then, the
 *              laughter club, and chatter as you pass people (formant
 *              babble: synthesised speech isn't intelligible, so the words
 *              appear as speech bubbles)
 *   music      while you sit (a bench or the water steps): a soft lo-fi
 *              loop generated live -- warm chords, keys, a little melody,
 *              a gentle swung beat and vinyl crackle, varied bar by bar so
 *              it never repeats audibly -- fading in as you sit and out as
 *              you stand, ducking the ambience (not the rain).  If the
 *              user has put tracks in public/audio/ (git-ignored, never
 *              built into dist/), those play instead.
 *
 * Everything positional goes through an equal-power PannerNode at its real
 * place; the listener is the camera.  Fog muffles the world a little.
 * ------------------------------------------------------------------ */

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = THREE.MathUtils.clamp;

const CHATTER = [
  'Aaj thand bahut hai!', 'Ki haal aa?', 'Bas, ek round aur!', 'Chalo, chai peete hain',
  'Kal milte hain!', 'Good morning ji!', 'Tez chalo, tez!', 'Aaj dhoop niklegi',
  'Wah, kya mausam hai!', 'Sat Sri Akal!', 'Namaste ji!', 'Kitne round hue?',
];
const COX = ['Ready… row!', 'Power ten!', 'Long and strong!', 'Sit ready!', 'Easy there!', 'Hands away!'];

// lo-fi harmony: four-bar loops in D major (MIDI chord tones), chosen afresh every four bars
const LOOPS = [
  [[50, 54, 57, 61], [47, 50, 54, 57], [52, 55, 59, 62], [45, 49, 52, 55]], // Dmaj7 Bm7 Em7 A7
  [[43, 47, 50, 54], [42, 45, 49, 52], [47, 50, 54, 57], [52, 55, 59, 62]], // Gmaj7 F#m7 Bm7 Em7
  [[52, 55, 59, 62], [45, 49, 52, 55], [50, 54, 57, 61], [47, 50, 54, 57]], // Em7 A7 Dmaj7 Bm7
  [[43, 47, 50, 54], [45, 49, 52, 55], [42, 45, 49, 52], [47, 50, 54, 57]], // Gmaj7 A7 F#m7 Bm7
];
const PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81]; // D major pentatonic, for the melody

export function createSound({ world, jogger, tod, weather, interact, onChange }) {
  let ctx = null;
  let enabled = true;
  try { enabled = localStorage.getItem('sukhna-sound') !== '0'; } catch { /* optional */ }
  let noise = null;
  const N = {}; // nodes
  const B = {}; // beds
  let t = 0;
  let music = { want: false, on: false, mode: 'gen', tracks: [], el: null, idx: 0, sched: null };
  const timers = { bird: 1, horn: rand(15, 30), chat: 0.5, lap: 0, crackle: 0 };
  const chatted = new Set();
  let lastPhase = 0, stepCount = 0, lastCatch = 0, flockPrev = [];
  const _v = new THREE.Vector3(), _f = new THREE.Vector3();

  /* ------------------------------ setup ------------------------------ */
  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 3;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    N.master = ctx.createGain(); N.master.gain.value = 0;
    N.muffle = ctx.createBiquadFilter(); N.muffle.type = 'lowpass'; N.muffle.frequency.value = 18000;
    N.comp = ctx.createDynamicsCompressor(); N.comp.threshold.value = -14; N.comp.ratio.value = 3;
    N.master.connect(N.muffle).connect(N.comp).connect(ctx.destination);
    N.amb = ctx.createGain(); N.amb.connect(N.master);   // ducked under the music
    N.rain = ctx.createGain(); N.rain.connect(N.master); // never ducked
    N.music = ctx.createGain(); N.music.gain.value = 0;
    // the lo-fi colour: a gentle low-pass and a soft saturation
    N.musicTone = ctx.createBiquadFilter(); N.musicTone.type = 'lowpass'; N.musicTone.frequency.value = 5200;
    N.musicSat = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    N.musicSat.curve = curve;
    N.musicIn = ctx.createGain(); N.musicIn.gain.value = 0.9;
    N.musicIn.connect(N.musicTone).connect(N.musicSat).connect(N.music).connect(N.master);
    // a soft echo for keys and melody
    N.echo = ctx.createDelay(1); N.echo.delayTime.value = 0.405;
    N.echoFb = ctx.createGain(); N.echoFb.gain.value = 0.32;
    N.echoTone = ctx.createBiquadFilter(); N.echoTone.type = 'lowpass'; N.echoTone.frequency.value = 2400;
    N.echo.connect(N.echoTone).connect(N.echoFb).connect(N.echo);
    N.echoTone.connect(N.musicIn);

    // beds
    B.water = bed([['bandpass', 520, 0.8], ['lowpass', 1500, 0.7]], true);
    B.wind = bed([['lowpass', 380, 0.7]], false);
    B.leaves = bed([['bandpass', 3200, 0.6]], true);
    B.rain = bed([['highpass', 1300, 0.7], ['lowpass', 8000, 0.7]], false, N.rain);
    B.rainWater = bed([['bandpass', 5200, 0.9]], true, N.rain);
    B.crackle = bed([['highpass', 2500, 0.7]], false, N.musicIn);
    loadTracks();
  }

  /** A looping noise bed: filters -> gain -> (panner) -> bus. */
  function bed(filters, spatial, bus = N.amb) {
    const src = ctx.createBufferSource();
    src.buffer = noise; src.loop = true; src.loopStart = 0; src.loopEnd = noise.duration;
    src.playbackRate.value = rand(0.93, 1.07);
    let node = src;
    for (const [type, f, q] of filters) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; node.connect(b); node = b; }
    const g = ctx.createGain(); g.gain.value = 0;
    node.connect(g);
    let pan = null;
    if (spatial) { pan = panner(8); g.connect(pan); pan.connect(bus); } else g.connect(bus);
    src.start(ctx.currentTime + Math.random() * 0.5, Math.random() * 2.5);
    return { src, g, pan };
  }

  function panner(ref = 6) {
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = 2000; p.rolloffFactor = 1;
    return p;
  }
  function place(p, x, y, z) {
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
  }
  /** A one-shot's output, placed at (e, y, n) in the world, cleaned up after `dur` s. */
  function voice(e, y, n, dur, ref = 6, bus = N.amb) {
    const g = ctx.createGain();
    const p = panner(ref);
    place(p, e, y, -n);
    g.connect(p).connect(bus);
    setTimeout(() => { try { g.disconnect(); p.disconnect(); } catch { /* gone */ } }, (dur + 0.5) * 1000);
    return g;
  }
  const env = (g, at, peak, a, d) => {
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
  };
  function noiseBurst(out, at, dur, type, f, q, peak, a = 0.004) {
    const s = ctx.createBufferSource(); s.buffer = noise;
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    const g = ctx.createGain();
    s.connect(b).connect(g).connect(out);
    env(g, at, peak, a, dur);
    s.start(at, Math.random() * 2); s.stop(at + a + dur + 0.05);
  }
  function tone(out, at, dur, freq, { type = 'sine', peak = 0.1, a = 0.005, glide = 1, fmRatio = 0, fmIndex = 0 } = {}) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, at + a + dur);
    const g = ctx.createGain();
    o.connect(g).connect(out);
    let m = null;
    if (fmRatio) {
      m = ctx.createOscillator(); m.frequency.value = freq * fmRatio;
      const mg = ctx.createGain(); mg.gain.value = fmIndex;
      m.connect(mg).connect(o.frequency);
      m.start(at); m.stop(at + a + dur + 0.05);
    }
    env(g, at, peak, a, dur);
    o.start(at); o.stop(at + a + dur + 0.05);
  }

  /* ------------------------------ birds ------------------------------ */
  const SONG = {
    bulbul: () => ({ notes: Math.round(rand(3, 5)), f: [1500, 2600], dur: [0.09, 0.16], gap: 0.05, glide: [0.8, 1.3], fm: [2, 70], peak: 0.07 }),
    myna: () => ({ notes: Math.round(rand(4, 8)), f: [900, 2200], dur: [0.05, 0.12], gap: 0.04, glide: [0.7, 1.4], fm: [1.5, 420], peak: 0.05 }),
    sparrow: () => ({ notes: Math.round(rand(3, 7)), f: [3500, 4800], dur: [0.035, 0.05], gap: 0.06, glide: [0.75, 0.85], fm: [0, 0], peak: 0.04 }),
    lapwing: () => ({ notes: 4, f: [2500, 2800], dur: [0.07, 0.09], gap: 0.07, glide: [0.95, 1.05], fm: [3, 60], peak: 0.07, last: 0.7 }),
    parakeet: () => ({ notes: Math.round(rand(2, 5)), f: [3000, 4200], dur: [0.05, 0.08], gap: 0.05, glide: [0.8, 1.2], fm: [1.3, 900], peak: 0.05 }),
  };
  function sing(kind, e, y, n) {
    if (kind === 'crow') return caw(e, y, n);
    const s = SONG[kind]();
    const out = voice(e, y, n, 3, 10);
    let at = ctx.currentTime + 0.02;
    for (let i = 0; i < s.notes; i++) {
      const dur = rand(...s.dur), last = s.last && i === s.notes - 1;
      tone(out, at, last ? dur * 2.2 : dur, rand(...s.f), { peak: s.peak, glide: last ? s.last : rand(...s.glide), fmRatio: s.fm[0], fmIndex: s.fm[1] });
      at += dur + s.gap * rand(0.7, 1.4);
    }
  }
  function caw(e, y, n) {
    const out = voice(e, y, n, 2, 12);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 2.2; bp.connect(out);
    let at = ctx.currentTime + 0.02;
    for (let i = 0, k = Math.round(rand(2, 3)); i < k; i++) { tone(bp, at, 0.22, rand(480, 560), { type: 'sawtooth', peak: 0.12, a: 0.02, glide: 0.8 }); at += rand(0.32, 0.45); }
  }
  function birdMix(el, evening) {
    if (el < -3) return evening ? [['myna', 1], ['crow', 1]] : [['lapwing', 3], ['bulbul', 1]];
    if (el < 4) return [['bulbul', 3], ['myna', 3], ['sparrow', 2], ['lapwing', 1], ['crow', 1]];
    return [['myna', 3], ['bulbul', 2], ['sparrow', 2], ['crow', 2]];
  }
  function birdRate(el, evening) {
    const base = el < -3 ? 0.35 : el < 4 ? 2.2 : el < 10 ? 1.5 : 0.9;
    return base * (evening && el < 6 && el > -4 ? 1.2 : 1) * (1 - 0.8 * weather.state.rain) * (1 - 0.5 * weather.state.fog);
  }

  /* ------------------------------ people ------------------------------ */
  const VOWELS = [[800, 1200], [500, 1900], [320, 2300], [520, 900], [360, 800]];
  function babble(e, y, n, dur, pitch = rand(120, 230), peak = 0.06) {
    const out = voice(e, y, n, dur + 0.5, 3);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f1 = ctx.createBiquadFilter(), f2 = ctx.createBiquadFilter();
    f1.type = f2.type = 'bandpass'; f1.Q.value = 6; f2.Q.value = 8;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(out);
    const t0 = ctx.currentTime + 0.02;
    for (let at = t0; at < t0 + dur; at += rand(0.1, 0.19)) {
      const v = pick(VOWELS);
      o.frequency.setTargetAtTime(pitch * rand(0.85, 1.2), at, 0.03);
      f1.frequency.setTargetAtTime(v[0], at, 0.02); f2.frequency.setTargetAtTime(v[1], at, 0.02);
      g.gain.setTargetAtTime(peak * rand(0.5, 1), at, 0.015);
      g.gain.setTargetAtTime(0.0001, at + 0.07, 0.03);
    }
    o.start(t0); o.stop(t0 + dur + 0.3);
  }
  function laugh(e, y, n) {
    const out = voice(e, y, n, 1, 5);
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 850; f1.Q.value = 3;
    f1.connect(out);
    let at = ctx.currentTime + 0.02;
    const p = rand(170, 280);
    for (let i = 0; i < 4; i++) { tone(f1, at, 0.09, p * rand(0.95, 1.1), { type: 'sawtooth', peak: 0.1, a: 0.012 }); noiseBurst(f1, at, 0.06, 'bandpass', 1400, 1, 0.03); at += 0.17; }
  }

  /* ------------------------------ music ------------------------------ */
  const M = { bpm: 74, step: 0, next: 0, loop: LOOPS[0], bars: 0, lastNote: 70 };
  function scheduleMusic() {
    const eighth = 60 / M.bpm / 2;
    while (M.next < ctx.currentTime + 0.3) {
      const s = M.step % 8, bar = Math.floor(M.step / 8);
      if (s === 0) {
        if (bar % 4 === 0) M.loop = pick(LOOPS);
        M.chord = M.loop[bar % 4];
        M.bars = bar;
      }
      const swing = s % 2 ? eighth * 0.16 : 0;
      const at = M.next + swing;
      const breakdown = bar % 16 === 15; // every sixteenth bar the beat drops out
      musicStep(at, s, bar, breakdown);
      M.next += eighth;
      M.step++;
    }
  }
  function musicStep(at, s, bar, breakdown) {
    const out = N.musicIn, ch = M.chord;
    if (s === 0) {
      // a pad: the chord, detuned triangles, slow in and out
      for (const note of ch) for (const det of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(note); o.detune.value = det + rand(-3, 3);
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = rand(900, 1300);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(0.016, at + 1.1);
        g.gain.setValueAtTime(0.016, at + 2.6);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 4.4);
        o.connect(f).connect(g).connect(out);
        o.start(at); o.stop(at + 4.5);
      }
      // bass on the root
      tone(out, at, 0.9, mtof(ch[0] - 12), { type: 'triangle', peak: 0.12, a: 0.01 });
    }
    // keys: soft electric-piano stabs, on 1 and sometimes the and-of-2 / 3
    if (s === 0 || (s === 3 && Math.random() < 0.5) || (s === 4 && Math.random() < 0.35)) {
      const k = ctx.createGain(); k.gain.value = 1; k.connect(out); k.connect(N.echo);
      for (const note of ch.slice(1)) tone(k, at + rand(0, 0.02), 1.4, mtof(note + 12), { peak: 0.028, a: 0.006, fmRatio: 1, fmIndex: 60 });
    }
    if (s === 4 && Math.random() < 0.5) tone(out, at, 0.5, mtof(ch[0] - 12 + (Math.random() < 0.5 ? 7 : 12)), { type: 'triangle', peak: 0.08, a: 0.01 });
    // melody: a sparse pentatonic line that moves in small steps
    if (Math.random() < (breakdown ? 0.35 : 0.2)) {
      const near = PENTA.filter((p) => Math.abs(p - M.lastNote) <= 5);
      const note = pick(near.length ? near : PENTA);
      M.lastNote = note;
      const g = ctx.createGain(); g.connect(out); g.connect(N.echo);
      tone(g, at, 0.55, mtof(note), { peak: 0.035, a: 0.02, fmRatio: 2, fmIndex: 8 });
    }
    if (breakdown) return;
    // drums: soft kick on 1 and 3 (sometimes the and-of-3), brushed snare on 2 and 4, swung hats
    if (s === 0 || s === 4 || (s === 5 && Math.random() < 0.25)) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(105, at); o.frequency.exponentialRampToValueAtTime(44, at + 0.13);
      const g = ctx.createGain(); env(g, at, 0.32, 0.003, 0.28);
      o.connect(g).connect(out); o.start(at); o.stop(at + 0.35);
    }
    if (s === 2 || s === 6) { noiseBurst(out, at, 0.16, 'bandpass', 1900, 0.7, 0.05, 0.006); tone(out, at, 0.08, 185, { peak: 0.03 }); }
    if (Math.random() < 0.85) noiseBurst(out, at, rand(0.02, 0.045), 'highpass', 7200, 0.7, rand(0.012, 0.024), 0.002);
  }

  async function loadTracks() {
    // optional: the user's own tracks in public/audio/ (dev server lists the folder; or a playlist.json)
    for (const url of ['audio/list.json', 'audio/playlist.json']) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) continue;
        const list = await r.json();
        const files = (Array.isArray(list) ? list : list.tracks || []).filter((f) => /\.(mp3|ogg|m4a|wav|flac|opus)$/i.test(f));
        if (files.length) { music.tracks = files; music.mode = 'tracks'; }
        break; // the first answer that parses is the answer (the dev listing may be empty)
      } catch { /* none */ }
    }
    if (music.mode === 'tracks') {
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'none';
      el.addEventListener('ended', () => { music.idx = (music.idx + 1) % music.tracks.length; el.src = `audio/${music.tracks[music.idx]}`; if (music.want) el.play().catch(() => {}); });
      music.el = el;
      music.idx = Math.floor(Math.random() * music.tracks.length);
      el.src = `audio/${music.tracks[music.idx]}`;
      ctx.createMediaElementSource(el).connect(N.music);
    }
  }

  function setMusic(on) {
    if (on === music.want) return;
    music.want = on;
    const now = ctx.currentTime;
    N.music.gain.cancelScheduledValues(now);
    N.music.gain.setValueAtTime(N.music.gain.value, now);
    N.music.gain.linearRampToValueAtTime(on ? 0.42 : 0, now + (on ? 3 : 2)); // soft: under the lapping, not over it
    N.amb.gain.setTargetAtTime(on ? 0.55 : 1, now, 0.8); // duck the ambience, not the rain
    B.crackle.g.gain.setTargetAtTime(on && music.mode === 'gen' ? 0.012 : 0, now, 0.5);
    if (on) {
      music.on = true;
      if (music.mode === 'tracks') music.el.play().catch(() => { music.mode = 'gen'; });
      if (music.mode === 'gen' && !music.sched) { M.next = now + 0.1; M.step = 0; music.sched = setInterval(scheduleMusic, 60); }
    } else {
      setTimeout(() => {
        if (music.want) return;
        music.on = false;
        if (music.sched) { clearInterval(music.sched); music.sched = null; }
        music.el?.pause();
        onChange?.();
      }, 2200);
    }
    onChange?.();
  }

  /* ------------------------------ per frame ------------------------------ */
  function update(dt, camera, playing) {
    if (!ctx || ctx.state !== 'running') return;
    t += dt;
    const now = ctx.currentTime;
    // the listener is the camera
    const L = ctx.listener;
    camera.getWorldDirection(_f);
    if (L.positionX) {
      L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z;
      L.forwardX.value = _f.x; L.forwardY.value = _f.y; L.forwardZ.value = _f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(camera.position.x, camera.position.y, camera.position.z); L.setOrientation(_f.x, _f.y, _f.z, 0, 1, 0); }
    N.master.gain.setTargetAtTime(enabled && playing ? 1 : 0, now, 0.25);
    N.muffle.frequency.setTargetAtTime(18000 - 12500 * weather.state.fog, now, 0.5);
    if (!playing) return;

    const ce = camera.position.x, cn = -camera.position.z;
    const w = nearestS(ce, cn), f = spineAt(w.s);
    const el = tod.state.sun.elevation, evening = tod.state.hours > 12;
    const rain = weather.state.rain;

    // water: distance to the real shoreline, panned toward it, lapping in slow swells
    const sd = Math.max(0, shoreDist(ce, cn, 120));
    const near = clamp(1 - sd / 70, 0.04, 1);
    const swell = Math.pow(Math.max(0, Math.sin(t * 1.05 + 1.8 * Math.sin(t * 0.23))), 1.5);
    B.water.g.gain.setTargetAtTime(0.5 * near * (0.35 + 0.65 * swell), now, 0.08);
    place(B.water.pan, ce + f.ne * (sd + 2), 0, -(cn + f.nn * (sd + 2)));
    // wind and leaves: a slow random gust, more in rain
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13 + Math.sin(t * 0.041) * 3);
    B.wind.g.gain.setTargetAtTime(0.05 + 0.07 * gust + 0.08 * rain, now, 0.6);
    B.leaves.g.gain.setTargetAtTime((0.012 + 0.03 * gust) * (1 + rain), now, 0.6);
    place(B.leaves.pan, ce - f.ne * 25, 8, -(cn - f.nn * 25));
    // rain: on the ground everywhere, on the water from the lake side (kept under the music)
    B.rain.g.gain.setTargetAtTime(0.14 * rain, now, 0.4);
    B.rainWater.g.gain.setTargetAtTime(0.11 * rain * (0.4 + 0.6 * near), now, 0.4);
    place(B.rainWater.pan, ce + f.ne * (sd + 4), 0, -(cn + f.nn * (sd + 4)));

    // birds
    timers.bird -= dt;
    if (timers.bird <= 0) {
      const rate = birdRate(el, evening);
      timers.bird = rand(0.4, 1.6) / Math.max(0.05, rate);
      const mix = birdMix(el, evening), tot = mix.reduce((a, [, k]) => a + k, 0);
      let r = Math.random() * tot, kind = mix[0][0];
      for (const [k, wgt] of mix) { if ((r -= wgt) <= 0) { kind = k; break; } }
      const lake = kind === 'lapwing' || Math.random() < 0.2;
      const side = lake ? 1 : -1, off = rand(12, 60) * side, along = rand(-60, 60);
      sing(kind, ce + f.ne * off + f.te * along, lake ? rand(2, 9) : rand(6, 13), cn + f.nn * off + f.tn * along);
    }
    // parakeets: the crossing flock, screeching as it goes
    const pk = world.birds.parakeets;
    if (pk?.active) {
      const pe = pk.e0 + pk.de * pk.pos, pn = pk.n0 + pk.dn * pk.pos;
      if (Math.hypot(pe - ce, pn - cn) < 320 && Math.random() < dt * 5) sing('parakeet', pe + rand(-8, 8), 26, pn + rand(-8, 8));
    }
    // resting flocks lifting off: a rush of wings
    world.birds.flocks?.forEach((fl, i) => {
      if (fl.state === 'fly' && flockPrev[i] !== 'fly' && Math.hypot(fl.ce - ce, fl.cn - cn) < 250) {
        const out = voice(fl.ce, 1, fl.cn, 2, 20);
        for (let k = 0; k < 10; k++) noiseBurst(out, now + k * 0.07 + rand(0, 0.03), 0.09, 'bandpass', rand(350, 700), 1.2, 0.25);
      }
      flockPrev[i] = fl.state;
    });

    // the eight: oars on every catch, the cox every few strokes
    const e8 = world.rowing.eight;
    const d8 = Math.hypot(e8.e - ce, e8.n - cn);
    if (e8.catchCount !== lastCatch) {
      lastCatch = e8.catchCount;
      if (d8 < 500) {
        const out = voice(e8.e, 0.3, e8.n, 1, 14);
        noiseBurst(out, now, 0.14, 'bandpass', 950, 0.8, 0.35);
        tone(out, now + 0.02, 0.05, 190, { peak: 0.2 });
        if (lastCatch % 7 === 0) {
          babble(e8.e, 0.8, e8.n, 0.7, rand(190, 240), 0.09);
          if (d8 < 160) interact.say({ e: e8.e, n: e8.n, y: 0.2, body: { height: 0.9 } }, pick(COX), 1.6);
        }
      }
    }

    // footsteps and breathing, from the jogger's own gait
    const ph = jogger.gait.phase;
    const crossed = (lastPhase < 0.5 && ph >= 0.5) || ph < lastPhase;
    lastPhase = ph;
    if (crossed && jogger.speed > 0.3 && !jogger.frozen) {
      stepCount++;
      const run = clamp((jogger.speed - 1.5) / 3.5, 0, 1);
      const out = voice(jogger.e, jogger.y, jogger.n, 0.6, 2);
      noiseBurst(out, now, 0.06 + 0.03 * run, 'lowpass', 320 + 200 * run, 0.7, 0.18 + 0.2 * run);
      noiseBurst(out, now + 0.005, 0.02, 'bandpass', 2500, 1, 0.02 + 0.03 * run);
      if (jogger.speed > 2 && stepCount % 2 === 0) {
        const tired = 1 - jogger.stamina / 100;
        const b = voice(jogger.e, jogger.y + 1.6, jogger.n, 1, 2);
        noiseBurst(b, now, 0.3, 'bandpass', stepCount % 4 === 0 ? 1300 : 900, 1.2, 0.02 + 0.05 * tired + 0.03 * (jogger.sprinting ? 1 : 0), 0.08);
      }
    }

    // a scooter horn from the city side, now and then
    timers.horn -= dt;
    if (timers.horn <= 0) {
      timers.horn = rand(25, 60) * (el < -3 ? 2 : 1);
      const off = -rand(180, 380), along = rand(-200, 200);
      const out = voice(ce + f.ne * off + f.te * along, 1, cn + f.nn * off + f.tn * along, 1.5, 30);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700; lp.connect(out);
      for (let k = 0, n = Math.random() < 0.5 ? 2 : 1; k < n; k++) for (const hz of [420, 530]) tone(lp, now + k * 0.28, 0.17, hz, { type: 'square', peak: 0.05, a: 0.01 });
    }

    // the laughter club
    const club = world.crowd.people.filter((p) => p.act === 'laugh');
    if (club.length) {
      const le = club.reduce((a, p) => a + p.e, 0) / club.length, ln = club.reduce((a, p) => a + p.n, 0) / club.length;
      if (club.some((p) => p.laughing) && Math.hypot(le - ce, ln - cn) < 180 && Math.random() < dt * 6) laugh(le + rand(-3, 3), 1.5, ln + rand(-3, 3));
    }

    // chatter as you pass
    timers.chat -= dt;
    if (timers.chat <= 0) {
      timers.chat = 0.5;
      for (const p of world.crowd.near(jogger.e, jogger.n, 2.8)) {
        if (chatted.has(p.id) || p.mode !== 'walk') continue;
        chatted.add(p.id);
        if (Math.random() < 0.3) {
          babble(p.e, p.y + 1.55, p.n, rand(0.7, 1.3));
          interact.say(p, pick(CHATTER), 1.8);
        }
        break;
      }
      if (chatted.size > 60) chatted.clear();
    }

    // the music follows sitting
    setMusic(!!interact.seated);
    if (music.on && music.mode === 'gen') {
      // vinyl crackle: a few clicks
      timers.crackle -= dt;
      if (timers.crackle <= 0) { timers.crackle = rand(0.08, 0.3); noiseBurst(N.musicIn, now, 0.004, 'highpass', 3000, 0.7, rand(0.01, 0.04), 0.001); }
    }
  }

  return {
    get enabled() { return enabled; },
    /** Music playing (for the conditions card). */
    get music() { return enabled && (music.want || music.on); },
    get mode() { return music.mode; },
    /** Call from a user gesture (Start, M): browsers only start audio then. */
    start() {
      if (!ctx) init();
      if (ctx.state !== 'running') ctx.resume();
    },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('sukhna-sound', enabled ? '1' : '0'); } catch { /* optional */ }
      if (enabled) this.start();
      onChange?.();
      return enabled;
    },
    update,
    get ctx() { return ctx; },
    /** Dev: the node graph (for an analyser in the console). */
    get nodes() { return N; },
  };
}
