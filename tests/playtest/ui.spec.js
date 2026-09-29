// 8. UI: the start card, P overview and back, H, M, T, K, and Esc to pause and resume.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const HINT = 'WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · L list · H hide';

test('ui', async ({ page }) => {
  const api = T(page), rep = reporter('ui'), c = checks();
  await openGame(page, { start: false });
  let h = await api.getHud();
  c.ok(h.card.visible && h.card.mode === 'start', `the start card isn't up (${JSON.stringify(h.card)})`);
  c.ok(!h.started, 'the game started before Start');
  c.ok(h.hint === HINT, `the hint bar reads "${h.hint}"`);
  await rep.shot(page, 'start-card');
  // the jogger doesn't move before Start
  const before = await api.getPlayer();
  await page.keyboard.down('KeyW'); await api.advance(1, { dt: 1 / 60 }); await page.keyboard.up('KeyW');
  c.ok(Math.hypot((await api.getPlayer()).e - before.e, (await api.getPlayer()).n - before.n) < 0.01, 'the jogger moved under the start card');
  await page.click('.overlay .go');
  h = await api.getHud();
  c.ok(h.started && !h.card.visible, 'Start did not close the card');

  const key = async (k) => { await page.keyboard.press(k); await api.advance(0.1, { dt: 1 / 60 }); return api.getHud(); };
  // P overview and back
  h = await key('KeyP');
  c.ok(h.overview, 'P did not open the overview');
  await rep.shot(page, 'overview');
  h = await key('KeyP');
  c.ok(!h.overview, 'P did not return from the overview');
  // H hides and shows the HUD
  h = await key('KeyH');
  c.ok(h.hidden, 'H did not hide the HUD');
  await rep.shot(page, 'hud-hidden');
  h = await key('KeyH');
  c.ok(!h.hidden, 'H did not bring the HUD back');
  // M toggles sound, and the card says so
  const s0 = h.sound;
  h = await key('KeyM');
  c.ok(h.sound !== s0 && /Sound (on|off)/.test(h.sound), `M: the card went from "${s0}" to "${h.sound}"`);
  h = await key('KeyM');
  c.ok(h.sound === s0, `M twice: "${h.sound}" (was "${s0}")`);
  // T and K
  const t0 = h.clock;
  h = await key('KeyT');
  c.ok(h.clock !== t0, `T didn't change the time (${t0} → ${h.clock})`);
  const w0 = h.weather;
  h = await key('KeyK');
  c.ok(h.weather !== w0, `K didn't change the weather (${w0} → ${h.weather})`);
  await key('KeyK'); await key('KeyK');
  // Esc pauses (the card comes back, the world stops), Esc resumes
  h = await key('Escape');
  c.ok(h.paused && h.card.visible && h.card.mode === 'paused', `Esc did not pause (${JSON.stringify({ paused: h.paused, card: h.card })})`);
  await rep.shot(page, 'paused');
  const p0 = await api.getPlayer();
  await page.keyboard.down('KeyW'); await api.advance(1, { dt: 1 / 60 }); await page.keyboard.up('KeyW');
  const p1 = await api.getPlayer();
  c.ok(Math.hypot(p1.e - p0.e, p1.n - p0.n) < 0.01, 'the jogger moved while paused');
  h = await key('Escape');
  c.ok(!h.paused && !h.card.visible, 'Esc did not resume');
  // and resuming with the card's button
  await key('Escape');
  await page.click('.overlay .go');
  h = await api.getHud();
  c.ok(!h.paused && !h.card.visible, 'the card\'s button did not resume');
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
