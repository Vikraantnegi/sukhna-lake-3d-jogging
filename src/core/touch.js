/* ------------------------------------------------------------------ *
 * Touch controls (plan §6): the same actions as the keyboard.
 *
 *   left stick   jog; pushed to the rim it runs (sprint)
 *   right half   drag to look; pinch to zoom the camera boom
 *   buttons      E V T K P M H
 *
 * The stick writes the same key codes the keyboard does (W A S D and
 * Shift), so the jogger doesn't know which one it is listening to.
 * ------------------------------------------------------------------ */

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function createTouch({ keys, onLook, onZoom, onButton }) {
  const root = document.createElement('div');
  root.className = 'touch';
  root.innerHTML = `
    <div class="stick"><div class="knob"></div></div>
    <div class="tbuttons">${['E', 'V', 'T', 'K', 'P', 'M', 'H'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>`;
  document.body.appendChild(root);
  const stick = root.querySelector('.stick'), knob = root.querySelector('.knob');
  let stickId = null, sx = 0, sy = 0;
  const lookTouches = new Map();
  let pinch = null;

  const setKeys = (dx, dy) => {
    const r = Math.hypot(dx, dy), R = 55;
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) keys.delete(k);
    if (r < 10) return;
    const ux = dx / r, uy = dy / r;
    if (uy < -0.38) keys.add('KeyW');
    if (uy > 0.38) keys.add('KeyS');
    if (ux < -0.38) keys.add('KeyA');
    if (ux > 0.38) keys.add('KeyD');
    if (r > R * 0.92) keys.add('ShiftLeft');
  };

  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const b = stick.getBoundingClientRect();
    sx = b.left + b.width / 2; sy = b.top + b.height / 2;
    e.preventDefault();
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sx, dy = t.clientY - sy;
        const r = Math.hypot(dx, dy), R = 55;
        if (r > R) { dx *= R / r; dy *= R / r; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        setKeys(dx, dy);
      } else if (lookTouches.has(t.identifier)) {
        const p = lookTouches.get(t.identifier);
        if (lookTouches.size === 1) onLook((t.clientX - p.x) * 0.006, (t.clientY - p.y) * 0.006);
        p.x = t.clientX; p.y = t.clientY;
      }
    }
    if (lookTouches.size === 2) {
      const [a, b] = [...lookTouches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch !== null) onZoom((pinch - d) * 0.02);
      pinch = d;
    }
  }, { passive: true });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; knob.style.transform = ''; setKeys(0, 0); }
      lookTouches.delete(t.identifier);
    }
    if (lookTouches.size < 2) pinch = null;
  };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);
  window.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.target.closest?.('.stick, .tbuttons, .overlay')) continue;
      if (t.clientX > window.innerWidth * 0.4) lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }, { passive: true });
  root.querySelectorAll('.tbuttons button').forEach((b) => b.addEventListener('touchstart', (e) => {
    e.preventDefault();
    onButton(b.dataset.k);
  }, { passive: false }));
  return { root, show(on) { root.style.display = on ? '' : 'none'; } };
}
