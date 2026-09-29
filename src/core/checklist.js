/* ------------------------------------------------------------------ *
 * "Things to do at Sukhna": a first-minute checklist.
 *
 * Most players left within a minute without finding the activities, so
 * the game opens with a short list of them under the jog card: shown
 * open at Start, folded into a pill ("Things to do 0/6") after 20 s of
 * play.  The pill (or L) opens it again; a click on the open list (or L)
 * folds it.  H hides it along with the rest of the HUD.
 *
 * Items tick when the player really does the thing (main.js reads the
 * game's own state and calls `done`); each tick gets a short toast, and
 * all six a last one.  In memory only: a reload starts again.
 * ------------------------------------------------------------------ */

export const TODO = [
  { key: 'chai', text: 'Grab a cutting chai', toast: 'Cutting chai' },
  { key: 'boat', text: 'Ride a swan boat', toast: 'Swan boat ride' },
  { key: 'steps', text: 'Sit on the water steps', toast: 'Sat on the water steps' },
  { key: 'laugh', text: 'Join the laughter club', toast: 'Joined the laughter club' },
  { key: 'five', text: 'High-five a jogger', toast: 'High five' },
  { key: 'length', text: 'Jog the full length of the dam', toast: 'The full length of the dam' },
];
const FOLD_AFTER = 20; // seconds of play before the open list folds into the pill

export function createChecklist({ hud, onDone }) {
  const box = document.createElement('div');
  box.className = 'todo waiting';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Things to do at Sukhna');
  box.innerHTML = `
    <button type="button" class="todo-pill" aria-expanded="false">Things to do <b data-todo="count">0/${TODO.length}</b></button>
    <div class="todo-card">
      <div class="todo-head"><i>Things to do at Sukhna</i><b data-todo="count">0/${TODO.length}</b></div>
      <ul>${TODO.map((t) => `<li data-todo="${t.key}"><span class="todo-box" aria-hidden="true"></span>${t.text}</li>`).join('')}</ul>
    </div>`;
  hud.corner.appendChild(box);
  hud.alsoHide.push(box);

  const done = new Set(), toasts = [];
  let shown = false, open = false, played = 0, touched = false, startedAt = 0;
  const count = () => `${done.size}/${TODO.length}`;
  const setOpen = (o) => {
    open = o;
    box.classList.toggle('open', o);
    box.querySelector('.todo-pill').setAttribute('aria-expanded', String(o));
  };
  // a click or tap: the pill opens the list, the open list folds (and the game never sees it)
  box.addEventListener('pointerdown', (e) => e.stopPropagation());
  box.addEventListener('click', (e) => { e.stopPropagation(); touched = true; setOpen(!open); });

  const api = {
    /** At Start: open, and the 20 s count begins. */
    show() {
      if (shown) return;
      shown = true; startedAt = performance.now();
      box.classList.remove('waiting');
      setOpen(true);
    },
    /** L: open or fold it. */
    toggle() { if (!shown) return; touched = true; setOpen(!open); },
    get open() { return open; },
    get shown() { return shown; },
    get count() { return done.size; },
    has: (key) => done.has(key),
    /** The player did an item: tick it (once), toast it, report it. */
    done(key) {
      const item = TODO.find((t) => t.key === key);
      if (!item || done.has(key) || !shown) return;
      done.add(key);
      box.querySelector(`[data-todo="${key}"]`).classList.add('done');
      box.querySelectorAll('[data-todo="count"]').forEach((n) => { n.textContent = count(); });
      box.classList.add('ticked'); setTimeout(() => box.classList.remove('ticked'), 900);
      toasts.push(`✓ ${item.toast} · ${count()}`);
      const secs = Math.round((performance.now() - startedAt) / 1000);
      onDone?.(key, done.size, secs, done.size === TODO.length);
      if (done.size === TODO.length) toasts.push('All 6 done · a proper Sukhna morning');
    },
    /** Each frame: fold after 20 s of play (unless the player opened or folded it themselves), and let toasts through one at a time. */
    update(dt, playing) {
      if (!shown) return;
      if (playing) {
        played += dt;
        if (open && !touched && played >= FOLD_AFTER) setOpen(false);
      }
      if (toasts.length && !hud.toastOn) hud.flash(toasts.shift(), 2200);
    },
  };
  return api;
}
