// 13. Touch: the action button (places beat people: a person nearer than the kiosk still gets
// "Grab chai"; with no place in range, "Say hello").  On a phone (390 x 844, touch) there is no E key; walking up to
// an activity with the stick brings up one big button labelled with the action, clear of the
// stick, the touch buttons and the checklist, and a tap on it does what E does.  Here: walk to
// the chai stall and tap "Grab chai"; the chai starts, the checklist ticks, and the usage stats
// get action_prompt_shown and action_prompt_used with input "touch".
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const ui = (page) => page.evaluate(() => {
  const box = (s) => { const n = document.querySelector(s); if (!n) return null; const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.5) return null; const b = n.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
  const hit = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b);
  const act = box('.act.on');
  return {
    act: !!act, label: document.querySelector('.act')?.textContent || '', pill: !!document.querySelector('.prompt.on'),
    clear: act ? { stick: !hit(act, box('.stick')), buttons: !hit(act, box('.tbuttons')), todo: !hit(act, box('.todo.open .todo-card') || box('.todo-pill')), inView: act.r <= innerWidth && act.b <= innerHeight && act.l >= 0 && act.t >= 0 } : null,
    events: (window.__analytics || []).filter(([n]) => n.startsWith('action_prompt')),
  };
});

test('touch', async ({ page }) => {
  const api = T(page), rep = reporter('touch'), c = checks();
  await openGame(page, { query: 't=golden' });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  c.ok(await page.evaluate(() => !!document.querySelector('.touch .stick') && !!document.querySelector('.act')), 'no touch controls or no action button on a touch phone');
  c.ok(!(await ui(page)).act, 'the action button shows with nothing in range');

  // 9 m from the chai stall, facing it
  const k = await page.evaluate(() => window.__scene.world.landmarks.plaza.kiosk);
  await api.toSpot('chai');
  const p0 = await api.getPlayer();
  const dx = p0.e - k[0], dn = p0.n - k[1], L = Math.hypot(dx, dn);
  await api.teleportTo(k[0] + (dx / L) * 9, k[1] + (dn / L) * 9);
  await api.lookAt(k[0], k[1]);
  await api.advance(0.3, { dt: 1 / 60 });
  c.ok(!(await ui(page)).act, 'the action button shows 9 m from the stall');

  // walk up with the stick (a real touch drag), until the button comes up
  const stick = await page.locator('.touch .stick').boundingBox();
  const sx = stick.x + stick.width / 2, sy = stick.y + stick.height / 2;
  await touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: sx, y: sy - i * 5, id: 1 }]);
  let s = await ui(page);
  for (let i = 0; i < 80 && !s.act; i++) { await api.advance(0.1, { dt: 1 / 60 }); s = await ui(page); }
  await touch('touchEnd', []);
  await api.advance(0.4, { dt: 1 / 60 }); // (stop)
  s = await ui(page);
  const d = await page.evaluate(([ke, kn]) => Math.hypot(window.__scene.jogger.e - ke, window.__scene.jogger.n - kn), k);
  c.ok(d < 9 - 3, `the stick didn't walk the jogger toward the stall (${d.toFixed(1)} m away)`);
  c.ok(s.act && s.label === 'Grab chai', `no "Grab chai" button at the stall (${JSON.stringify(s)})`);
  c.ok(!s.pill, 'the E prompt pill shows on touch as well as the button');
  c.ok(s.clear && Object.values(s.clear).every(Boolean), `the button overlaps something or leaves the screen: ${JSON.stringify(s.clear)}`);
  await rep.shot(page, 'action-button');

  // places beat people: someone standing nearer than the kiosk doesn't take the button (the
  // photographer, a standing extra, moved to 0.9 m on the far side from the kiosk)
  const putPerson = (dist) => page.evaluate(([ke, kn, dist]) => {
    const { jogger, world } = window.__scene;
    const p = world.crowd.people.find((q) => q.act === 'photo' && q.active);
    const ue = jogger.e - ke, un = jogger.n - kn, L = Math.hypot(ue, un) || 1;
    p.e = jogger.e + (ue / L) * dist; p.n = jogger.n + (un / L) * dist;
    return { person: Math.hypot(p.e - jogger.e, p.n - jogger.n), kiosk: Math.hypot(jogger.e - ke, jogger.n - kn) };
  }, [k[0], k[1], dist]);
  // (the jogger 3 m from the kiosk, back along the way they came; the person 0.9 m beyond them)
  await api.teleportTo(k[0] + (dx / L) * 3, k[1] + (dn / L) * 3);
  await api.lookAt(k[0], k[1]);
  const dists = await putPerson(0.9);
  await api.advance(0.1, { dt: 1 / 60 });
  await page.waitForTimeout(300); // (the button's fade runs in real time)
  s = await ui(page);
  c.ok(dists.person < dists.kiosk && dists.kiosk < 4.5, `the setup is off: a person ${dists.person.toFixed(2)} m and the kiosk ${dists.kiosk.toFixed(2)} m away`);
  c.ok(s.act && s.label === 'Grab chai', `with a person nearer than the kiosk the button reads "${s.label}" (places beat people: expected "Grab chai")`);
  await rep.shot(page, 'person-nearer-than-kiosk');

  // a tap on it is E
  const b = await page.locator('.act').boundingBox();
  await touch('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 2 }]);
  await touch('touchEnd', []);
  await api.advance(0.3, { dt: 1 / 60 });
  const pl = await api.getPlayer();
  c.ok(pl.activity === 'chai', `the tap didn't start the chai (activity ${pl.activity})`);
  s = await ui(page);
  c.ok(!s.act, 'the button is still up while the chai is being made');
  c.ok(await page.evaluate(() => document.querySelector('[data-todo="chai"]')?.classList.contains('done')), 'the checklist did not tick the chai');
  const ev = s.events.map(([n, p]) => `${n}:${p.action}:${p.input}`);
  c.ok(ev.includes('action_prompt_shown:chai:touch') && ev.includes('action_prompt_used:chai:touch'), `usage events: ${JSON.stringify(ev)}`);
  await rep.shot(page, 'tapped');

  // ...and with no place in range, the person is the offer: "Say hello"
  await page.evaluate(() => window.__scene.interact.cancel());
  await api.teleport(1200, -1.6, 'east');
  await api.advance(0.2, { dt: 1 / 60 });
  await page.evaluate(() => { const { jogger, world } = window.__scene; const p = world.crowd.people.find((q) => q.act === 'photo' && q.active); p.e = jogger.e + 1.0; p.n = jogger.n; });
  await api.advance(0.1, { dt: 1 / 60 });
  await page.waitForTimeout(300); // (the button's fade runs in real time)
  const hello = await ui(page);
  c.ok(hello.act && hello.label === 'Say hello', `with no place in range and a person beside you the button reads "${hello.label}"`);

  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails, events: s.events });
  c.done(expect);
});
