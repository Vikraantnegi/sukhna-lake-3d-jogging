/* Structure follows sakura-crossing's src/core/hud.js (start card, prompt,
 * toast, coordinate readout).  Copyright (c) 2026 Kenton Wang, MIT License
 * -- see THIRD_PARTY_LICENSES.md.  Rewritten for Sukhna: the jogging HUD,
 * the bottom hint bar, outfits on the start card, H hides everything. */

import { OUTFITS } from '../people/body.js';

/* ------------------------------------------------------------------ *
 * The HUD (plan §6).
 *
 *   jog HUD (top left)  distance, pace, time, lengths, stamina
 *   conditions (top right)  the clock and time of day (T), weather (K), sound (M)
 *   hint bar (bottom)   exactly the line the brief asks for
 *   prompt, toast       E interactions and short messages
 *   start / pause card  title, outfit, controls, credits
 *   coordinates (C)     dev readout, off the hint bar
 *
 *   next-morning fade  black, a short card, and back at golden hour
 *
 * H hides the hint bar and both HUD cards together.
 * ------------------------------------------------------------------ */

export const HINT = 'WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · H hide';

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export function createHud({ outfit = 0, touch = false } = {}) {
  const el = (tag, cls, parent, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    (parent || document.body).appendChild(n);
    return n;
  };
  const root = el('div', 'hud');
  const prompt = el('div', 'prompt', root, '');
  const toast = el('div', 'toast', root, '');
  const bubble = el('div', 'bubble', root, '');

  // ---------------------------- jog HUD ----------------------------
  const jog = el('div', 'jog', root);
  jog.innerHTML = `
    <div class="jog-grid">
      <div><i data-l="dist">distance</i><b data-k="dist">0.00</b><small data-u="dist">km</small></div>
      <div><i data-l="pace">pace</i><b data-k="pace">--:--</b><small data-u="pace">/km</small></div>
      <div><i data-l="time">time</i><b data-k="time">0:00</b></div>
      <div data-cell="len"><i>lengths</i><b data-k="len">0</b></div>
    </div>
    <div class="stamina"><i>stamina</i><span><em data-k="stam"></em></span></div>
    <div class="jog-mode" data-k="mode"></div>
    <div class="ticket" data-k="ticket">Boat ticket · 1 ride</div>`;
  const q = (k) => jog.querySelector(`[data-k="${k}"]`);
  const refs = { dist: q('dist'), pace: q('pace'), time: q('time'), len: q('len'), stam: q('stam'), mode: q('mode'), ticket: q('ticket') };
  const labels = { dist: jog.querySelector('[data-l=dist]'), pace: jog.querySelector('[data-l=pace]'), time: jog.querySelector('[data-l=time]'), paceU: jog.querySelector('[data-u=pace]'), lenCell: jog.querySelector('[data-cell=len]') };
  const clockText = (secs) => { const t = Math.floor(secs), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };

  // ---------------------------- conditions ----------------------------
  const cond = el('div', 'cond', root);
  cond.innerHTML = `
    <div class="cond-row"><kbd>T</kbd><b data-c="clock">07:45</b><span data-c="preset">golden hour</span></div>
    <div class="cond-row"><kbd>K</kbd><span data-c="weather">Clear</span></div>
    <div class="cond-row"><kbd>M</kbd><span data-c="sound">Sound on</span></div>`;
  const cq = (k) => cond.querySelector(`[data-c="${k}"]`);
  const cref = { clock: cq('clock'), preset: cq('preset'), weather: cq('weather'), sound: cq('sound') };
  const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  // ---------------------------- next-morning fade ----------------------------
  const fade = el('div', 'fade', root);
  fade.innerHTML = '<div class="fade-card"><i>Next morning</i><b>07:45</b><span>golden hour · 15 January</span></div>';

  // ---------------------------- hint bar ----------------------------
  const hint = el('div', 'hintbar', root, HINT);

  // ---------------------------- coordinates ----------------------------
  const coords = el('div', 'coords', root, '');

  // ---------------------------- start / pause card ----------------------------
  // The card is plain HTML in index.html, with the About text and FAQ under it, so it shows
  // (and crawlers read it) before any script runs.  Here it is moved into the HUD, given the
  // outfits and the controls for this device, and its button is enabled.
  const overlay = document.querySelector('.overlay');
  root.appendChild(overlay);
  overlay.querySelector('.outfits').innerHTML = OUTFITS.map((o, i) => `<button type="button" role="radio" data-outfit="${i}" aria-checked="${i === outfit}"><span style="background:${hex(o.row.top)}"></span><span style="background:${hex(o.row.bottom)}"></span>${o.row.headwear === 'patka' ? `<span style="background:${hex(o.row.headwearColor)}"></span>` : ''}<em>${o.name.replace('&', '&amp;')}</em></button>`).join('');
  overlay.querySelector('.controls').textContent = touch ? 'Left stick jog (push to the rim to run) · drag to look · pinch to zoom · buttons for E V T K P M H' : 'WASD jog · Shift run · mouse look · wheel zoom · E interact · V auto-jog · T time · K rain · P overview · M sound · H hide · Esc pause';
  const go = overlay.querySelector('.go');
  go.textContent = touch ? 'Tap to start' : 'Start jogging';
  go.disabled = false;

  const api = {
    onStart: null,
    onOutfit: null,
    hidden: false,
    started: false,
    paused: false,
    /** The jog card: the run's numbers, or (with `boat`) the ride's: distance, speed, time. */
    setRun(j, boat = null) {
      const boating = !!boat;
      if (api.boating !== boating) {
        api.boating = boating;
        labels.dist.textContent = boating ? 'boat distance' : 'distance';
        labels.pace.textContent = boating ? 'speed' : 'pace';
        labels.paceU.textContent = boating ? 'km/h' : '/km';
        labels.time.textContent = boating ? 'ride time' : 'time';
        labels.lenCell.classList.toggle('off', boating);
      }
      if (boating) {
        const st = boat.state;
        put(refs.dist, (st.distance / 1000).toFixed(2));
        put(refs.pace, (Math.abs(st.speed) * 3.6).toFixed(1));
        put(refs.time, clockText(st.time));
        refs.mode.textContent = boat.phase === 'docking' ? 'docking' : st.speed < -0.1 ? 'pedal boat · astern' : j.sprinting ? 'pedal boat · pedalling hard' : 'pedal boat';
      } else {
        refs.dist.textContent = (j.distance / 1000).toFixed(2);
        refs.pace.textContent = j.pace();
        refs.time.textContent = clockText(j.elapsed);
        refs.len.textContent = String(j.lengths);
        refs.mode.textContent = j.auto ? 'auto-jog' : j.sprinting ? 'running' : j.speed > 2.2 ? 'jogging' : j.speed > 0.3 ? 'walking' : '';
      }
      refs.stam.style.width = `${j.stamina.toFixed(0)}%`;
      refs.stam.classList.toggle('low', j.stamina < 30);
    },
    boating: false,
    /** A boat ticket in hand (one ride). */
    setTicket(on) { api.ticket = on; refs.ticket.classList.toggle('on', on); },
    ticket: false,
    /** The hint bar's line (null: the usual one). */
    setHint(text) { put(hint, text || HINT); },
    setClock(clock, preset) { put(cref.clock, clock); put(cref.preset, preset); },
    setWeather(kind) { put(cref.weather, kind === 'rain' ? 'Rain' : kind === 'fog' ? 'Fog' : 'Clear'); },
    setSound(on, music = false) { put(cref.sound, !on ? 'Sound off' : music ? 'Music' : 'Sound on'); cond.classList.toggle('muted', !on); },
    /**
     * Fade to black, show the next-morning card, call `atBlack` (reset the clock
     * there), then fade back in and call `done`.
     */
    nextMorning(atBlack, done) {
      fade.classList.add('on');
      setTimeout(() => { atBlack?.(); fade.classList.add('card'); }, 1300);
      setTimeout(() => { fade.classList.remove('card'); }, 3600);
      setTimeout(() => { fade.classList.remove('on'); }, 4000);
      setTimeout(() => done?.(), 5300);
    },
    setPrompt(text) { prompt.textContent = text; prompt.classList.toggle('on', !!text); },
    flash(text, ms = 1800) {
      toast.textContent = text;
      toast.classList.add('on');
      clearTimeout(api._t);
      api._t = setTimeout(() => toast.classList.remove('on'), ms);
    },
    /** A small speech bubble at screen (x, y) px; empty text hides it. */
    say(text, x, y) {
      bubble.textContent = text || '';
      bubble.classList.toggle('on', !!text);
      if (text) { bubble.style.left = `${x}px`; bubble.style.top = `${y}px`; }
    },
    setHidden(h) { api.hidden = h; for (const n of [jog, cond, hint]) n.classList.toggle('off', h); },
    toggleHidden() { api.setHidden(!api.hidden); return api.hidden; },
    setCoords(text) { coords.textContent = text; coords.classList.toggle('on', !!text); },
    setPaused(paused) {
      if (!api.started) return;
      api.paused = paused;
      overlay.dataset.mode = 'paused';
      overlay.scrollTop = 0; // (the pause card has no About text under it)
      overlay.classList.toggle('hidden', !paused);
    },
    hideCard() { overlay.classList.add('hidden'); },
  };

  overlay.querySelectorAll('[data-outfit]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.querySelectorAll('[data-outfit]').forEach((x) => x.setAttribute('aria-checked', 'false'));
    b.setAttribute('aria-checked', 'true');
    api.onOutfit?.(+b.dataset.outfit);
  }));
  go.addEventListener('click', (e) => {
    e.stopPropagation();
    api.started = true;
    api.paused = false;
    overlay.classList.add('hidden');
    api.onStart?.();
  });
  return api;
}
