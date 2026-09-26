// 6. The camera through the busiest stretch on auto-jog: nobody may stand un-faded in the
// near-camera zone (within 1.5 m of the lens at least half dissolved, within 1.0 m gone).
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

test('camera', async ({ page }) => {
  const api = T(page), rep = reporter('camera'), c = checks();
  await openGame(page, { query: 't=golden' }); // the crowd at its fullest (sunrise +26 min)
  // the busiest stretch: the laughter club, the photographer, the west-end bend and the plaza
  await api.teleport(1850, -1.6, 'west');
  await page.keyboard.press('KeyV');
  let close = 0, worst = null;
  for (let k = 0; k < 8; k++) {
    const samples = await api.advance(20, { dt: 1 / 60, every: 1 / 60, crowd: true });
    for (const p of samples) for (const q of p.near) {
      if (q.dist < 1.5) close++;
      const bad = (q.dist < 1.5 && q.fade > 0.5) || (q.dist < 1.0 && q.fade > 0.02);
      if (bad && (!worst || q.fade > worst.fade)) worst = { ...q, t: p.t + k * 20, s: p.s };
    }
  }
  c.ok(!worst, `someone stood un-faded near the camera: ${JSON.stringify(worst)}`);
  await rep.shot(page, 'end');
  // and a direct test: a walker placed right in front of the lens
  const who = await api.findPerson('walker', 1800, 2300);
  if (who) {
    await api.teleportTo(who.e - 1.0, who.n, 'east');
    await api.lookAt(who.e, who.n);
    await api.advance(0.05, { dt: 1 / 60 });
    const near = await api.crowdNearCamera(1.5);
    c.ok(near.every((q) => q.fade <= 0.5), `a walker at the lens isn't faded: ${JSON.stringify(near)}`);
    await rep.shot(page, 'walker-at-lens');
  }
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails, closeEncounters: close });
  c.done(expect);
});
