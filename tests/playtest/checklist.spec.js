// 12. The first-minute checklist ("Things to do at Sukhna", core/checklist.js): open at Start,
// two items ticked for real (a chai, the laughter club) with their toasts and the counter,
// folded into the pill after 20 s of play, L and the pill to open and fold it, H to hide it,
// and the analytics events it sends (checklist_done, checklist_toggled; the dev build's
// window.__analytics log).
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const state = (page) => page.evaluate(() => {
  const box = document.querySelector('.todo');
  const vis = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
  return {
    shown: !!box && !box.classList.contains('waiting'), open: !!box?.classList.contains('open'), hidden: !!box?.classList.contains('off'),
    card: vis(box?.querySelector('.todo-card')), pill: vis(box?.querySelector('.todo-pill')),
    pillText: box?.querySelector('.todo-pill')?.textContent.replace(/\s+/g, ' ').trim(),
    count: box?.querySelector('.todo-head b')?.textContent,
    items: [...(box?.querySelectorAll('li') || [])].map((li) => ({ text: li.textContent.trim(), done: li.classList.contains('done') })),
    toast: document.querySelector('.toast.on')?.textContent || '',
    events: (window.__analytics || []).filter(([n]) => n.startsWith('checklist')),
  };
});

test('checklist', async ({ page }) => {
  const api = T(page), rep = reporter('checklist'), c = checks();
  await openGame(page, { query: 't=golden' });
  let s = await state(page);
  c.ok(s.shown && s.open && s.card && !s.pill, `not open at Start: ${JSON.stringify(s)}`);
  c.ok(s.items.length === 6 && s.items.every((i) => !i.done) && s.count === '0/6', `six unticked items and 0/6 expected: ${JSON.stringify(s.items)} ${s.count}`);
  await rep.shot(page, 'open-at-start');

  // 1: a cutting chai at the stall
  await api.toSpot('chai');
  await api.advance(0.2, { dt: 1 / 60 });
  await page.keyboard.press('KeyE');
  await api.advance(0.3, { dt: 1 / 60 });
  s = await state(page);
  c.ok(s.items.find((i) => i.text.includes('chai'))?.done && s.count === '1/6', `chai didn't tick: ${JSON.stringify(s.items)} ${s.count}`);
  c.ok(/Cutting chai · 1\/6/.test(s.toast), `no tick toast for the chai (toast: "${s.toast}")`);
  await rep.shot(page, 'tick-chai');
  await api.advance(4.5, { dt: 1 / 60 }); // (the chai finishes)

  // 2: the laughter club
  await api.toSpot('laugh');
  await api.advance(0.2, { dt: 1 / 60 });
  const offer = await api.nearestInteractable();
  c.ok(offer?.kind === 'join', `the laughter club isn't offered (${JSON.stringify(offer)})`);
  await page.keyboard.press('KeyE');
  await api.advance(0.4, { dt: 1 / 60 });
  s = await state(page);
  c.ok(s.items.find((i) => i.text.includes('laughter'))?.done && s.count === '2/6', `the laughter club didn't tick: ${s.count}`);
  // (its toast may wait for the chai's "stamina refilled" to clear)
  let toasted = /laughter club · 2\/6/.test(s.toast);
  for (let i = 0; i < 30 && !toasted; i++) { await page.waitForTimeout(100); toasted = /laughter club · 2\/6/.test((await state(page)).toast); await api.advance(0.05, { dt: 1 / 60 }); }
  c.ok(toasted, 'no tick toast for the laughter club');
  await page.evaluate(() => window.__scene.interact.cancel());
  // doing it again doesn't tick it twice
  await api.toSpot('chai');
  await api.advance(0.2, { dt: 1 / 60 });
  await page.keyboard.press('KeyE');
  await api.advance(0.3, { dt: 1 / 60 });
  c.ok((await state(page)).count === '2/6', 'a second chai counted again');

  // the analytics: one checklist_done per item, with its count and time
  s = await state(page);
  const ev = s.events.filter(([n]) => n === 'checklist_done').map(([n, p]) => `${n}:${p.item}:${p.done_count}`);
  c.ok(ev.join(',') === 'checklist_done:chai:1,checklist_done:laugh:2', `checklist events: ${JSON.stringify(s.events)}`);
  c.ok(s.events.filter(([n]) => n === 'checklist_done').every(([, p]) => Number.isFinite(p.seconds_since_start)), 'seconds_since_start missing');
  c.ok(!s.events.some(([n]) => n === 'checklist_toggled'), `a checklist_toggled before any toggle: ${JSON.stringify(s.events)}`);

  // folds into the pill after 20 s of play
  await api.advance(21, { dt: 1 / 30 });
  s = await state(page);
  c.ok(!s.open && s.pill && !s.card, `still open after 20 s of play: ${JSON.stringify(s)}`);
  c.ok(s.pillText === 'Things to do 2/6', `the pill reads "${s.pillText}"`);
  await rep.shot(page, 'folded');

  // L opens and folds it; a click on the pill opens it; H hides it with the HUD
  await page.keyboard.press('KeyL'); await api.advance(0.05, { dt: 1 / 60 });
  c.ok((await state(page)).open, 'L did not open it');
  await page.keyboard.press('KeyL'); await api.advance(0.05, { dt: 1 / 60 });
  c.ok(!(await state(page)).open, 'L did not fold it');
  await page.click('.todo-pill');
  c.ok((await state(page)).open, 'a click on the pill did not open it');
  await api.advance(25, { dt: 1 / 30 });
  c.ok((await state(page)).open, 'opened by hand, it folded again on its own');
  await page.keyboard.press('KeyH'); await api.advance(0.05, { dt: 1 / 60 });
  c.ok((await state(page)).hidden, 'H did not hide it');
  await page.keyboard.press('KeyH'); await api.advance(0.05, { dt: 1 / 60 });
  c.ok(!(await state(page)).hidden, 'H did not bring it back');

  // checklist_toggled: the fold after 20 s (auto), L open and fold, the pill (tap)
  const toggles = (await state(page)).events.filter(([n]) => n === 'checklist_toggled').map(([, p]) => `${p.open ? 'open' : 'fold'}:${p.via}`);
  c.ok(toggles.join(',') === 'fold:auto,open:L,fold:L,open:tap', `checklist_toggled events: ${JSON.stringify(toggles)}`);

  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails, events: s.events });
  c.done(expect);
});
