// 4. Interactions: greet, chai, yoga, and a high five with a jogger coming the other way.
// Each: the prompt shows its text (never an empty pill), E does it, it completes, and (the
// ones that take time) any movement key cancels it.  (Circles and boating have their own.)
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

/** Advance in small steps, watching the HUD pills: a visible pill must have text. */
async function watch(api, c, tag, seconds, step = 0.1) {
  const hud = [];
  for (let t = 0; t < seconds; t += step) {
    await api.advance(step, { dt: 1 / 60 });
    const h = await api.getHud();
    for (const pill of ['prompt', 'bubble', 'toast']) if (h[pill].visible && !h[pill].text.trim()) c.ok(false, `${tag}: an empty ${pill} pill is showing`);
    hud.push(h);
  }
  return hud;
}

async function timed(page, api, c, rep, kind, label, secs, before, after) {
  await api.toSpot(kind);
  await api.advance(0.2, { dt: 1 / 60 });
  const offer = await api.nearestInteractable();
  c.ok(offer?.kind === kind, `${kind}: E doesn't offer it here (nearest: ${JSON.stringify(offer)})`);
  const hud = await api.getHud();
  c.ok(hud.prompt.visible && hud.prompt.text.includes(label), `${kind}: prompt reads "${hud.prompt.text}" (expected "E · ${label}")`);
  await before?.();
  await page.keyboard.press('KeyE');
  await watch(api, c, kind, 0.5);
  c.ok((await api.getPlayer()).activity === kind, `${kind}: didn't start`);
  await rep.shot(page, `${kind}-doing`);
  await watch(api, c, kind, secs);
  const done = await api.getPlayer();
  c.ok(done.activity === null && !done.frozen, `${kind}: didn't finish after ${secs} s (still ${done.activity})`);
  await after?.(done, false);
  // again, and cancel it with a movement key
  await api.toSpot(kind);
  await api.advance(0.2, { dt: 1 / 60 });
  await before?.();
  await page.keyboard.press('KeyE');
  await api.advance(0.8, { dt: 1 / 60 });
  await page.keyboard.down('KeyS');
  await api.advance(0.2, { dt: 1 / 60 });
  await page.keyboard.up('KeyS');
  const cancelled = await api.getPlayer();
  c.ok(cancelled.activity === null && !cancelled.frozen, `${kind}: a movement key didn't cancel it (still ${cancelled.activity})`);
  await after?.(cancelled, true);
}

test('interactions', async ({ page }) => {
  const api = T(page), rep = reporter('interactions'), c = checks();
  await openGame(page, { query: 't=golden' });

  // greet: stand beside a walker
  const who = await api.findPerson('walker');
  c.ok(!!who, 'no walker to greet');
  if (who) {
    await api.teleportTo(who.e - 0.9, who.n - 0.9);
    await api.lookAt(who.e, who.n);
    await api.advance(0.1, { dt: 1 / 60 });
    const offer = await api.nearestInteractable();
    c.ok(offer?.kind === 'greet', `greet: E doesn't offer it (nearest: ${JSON.stringify(offer)})`);
    await page.keyboard.press('KeyE');
    const seen = await watch(api, c, 'greet', 2.5);
    c.ok(seen.some((h) => h.bubble.visible && h.bubble.text.length > 2), 'greet: no speech bubble');
    const texts = [...new Set(seen.filter((h) => h.bubble.visible).map((h) => h.bubble.text))];
    c.ok(texts.length >= 2, `greet: expected a greeting and a reply, saw ${JSON.stringify(texts)}`);
    await rep.shot(page, 'greet');
  }

  // chai: stamina back to 100 when it completes, untouched when cancelled
  await timed(page, api, c, rep, 'chai', 'a cutting chai', 4.3, () => api.setStamina(40), (p, cancelled) => {
    c.ok(cancelled ? p.stamina < 60 : p.stamina >= 99, `chai: stamina ${p.stamina} after ${cancelled ? 'cancelling' : 'finishing'}`);
  });
  await timed(page, api, c, rep, 'yoga', 'join the yoga', 5.3);
  // (the laughter club is now a circle you stay in until you leave: groups.spec.js)

  // high five: meet a runner head on
  const runner = await api.findPerson('runner', 400, 2000);
  c.ok(!!runner, 'no runner to high-five');
  if (runner) {
    // 14 m ahead of them in their lane, facing them, jogging toward them
    const s = runner.s + runner.dir * 14;
    await api.teleport(s, runner.d, runner.dir > 0 ? 'east' : 'west');
    await page.keyboard.down('KeyW');
    let offered = false;
    for (let i = 0; i < 60 && !offered; i++) {
      await api.advance(0.05, { dt: 1 / 60 });
      offered = (await api.nearestInteractable())?.kind === 'five';
    }
    c.ok(offered, 'high five: never offered while passing a runner head on');
    if (offered) {
      await page.keyboard.press('KeyE');
      await api.advance(0.1, { dt: 1 / 60 });
      const who = await api.lastFive();
      const r = who === null ? null : await api.person(who);
      c.ok(r && r.hf > 0, `high five: the person you high-fived didn't raise a hand (${JSON.stringify(r)})`);
      const h = await api.getHud();
      c.ok(h.bubble.visible && h.bubble.text.length > 1, 'high five: no bubble');
      await rep.shot(page, 'high-five');
    }
    await page.keyboard.up('KeyW');
    await api.advance(1.2, { dt: 1 / 60 });
    c.ok((await api.getPlayer()).activity === null, 'high five: still busy a second later');
  }
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
