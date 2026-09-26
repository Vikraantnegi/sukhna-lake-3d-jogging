// 3. Sitting: every free bench and every flight to the water.  E to sit, then: no body
// part below the surface under it, feet resting on the tread (or ground) below, the jogger
// in the seated camera's frame and not hidden, the music fading in; any movement key
// stands up cleanly and the music fades out.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

async function sitAndCheck(page, api, rep, c, tag, file) {
  await api.advance(0.2, { dt: 1 / 60 });
  const offer = await api.nearestInteractable();
  const kind = tag.startsWith('bench') ? 'bench' : 'steps';
  if (!c.ok(offer?.kind === kind, `${tag}: E doesn't offer to sit (nearest: ${JSON.stringify(offer)})`)) return null;
  await page.keyboard.press('KeyE');
  await api.advance(3.6, { dt: 1 / 60 }); // the camera settles
  await page.waitForTimeout(3300); // the music fades in over 3 s of *audio* time (real time)
  const p = await api.getPlayer();
  c.ok(p.state === 'sitting', `${tag}: not sitting after E (state ${p.state})`);
  c.ok(p.finite, `${tag}: position non-finite`);

  // every body part on or above whatever is under it (seat, tread, ground)
  const lows = await api.bodyLows();
  const worst = { part: null, by: 0 };
  for (const [part, lo] of Object.entries(lows)) {
    const under = await api.groundProbe(lo.e, lo.n);
    if (!under) continue;
    const by = under.y - lo.y;
    if (by > worst.by) { worst.part = `${part} (${under.name})`; worst.by = by; }
  }
  c.ok(worst.by <= 0.02, `${tag}: ${worst.part} is ${worst.by.toFixed(3)} m below the surface under it`);
  // feet resting on the tread / ground below: not sunk, not hovering
  for (const foot of ['footL', 'footR']) {
    const lo = lows[foot];
    if (!lo) { c.ok(false, `${tag}: no ${foot}`); continue; }
    const under = await api.groundProbe(lo.e, lo.n);
    const gap = lo.y - (under?.y ?? lo.y);
    c.ok(gap > -0.02 && gap < 0.05, `${tag}: ${foot} ${gap >= 0 ? 'hovers' : 'is sunk'} ${Math.abs(gap).toFixed(3)} m ${gap >= 0 ? 'above' : 'into'} ${under?.name}`);
  }
  const frame = await api.joggerInFrame();
  c.ok(frame.inFrame, `${tag}: the jogger is out of the seated camera's frame (head ${frame.head}, hips ${frame.hips})`);
  c.ok(!frame.occluded, `${tag}: the jogger is hidden behind ${frame.by}`);
  const m = await api.music();
  c.ok(!m.enabled || (m.music && m.gain > 0.25), `${tag}: the music didn't fade in (gain ${m.gain}, ctx ${m.ctx})`);
  const shot = await rep.shot(page, file);

  // any movement key stands up
  await page.keyboard.down('KeyS');
  await api.advance(0.35, { dt: 1 / 60 });
  await page.keyboard.up('KeyS');
  await api.advance(0.4, { dt: 1 / 60 });
  const q = await api.getPlayer();
  c.ok(q.state !== 'sitting' && !q.frozen, `${tag}: still sitting after a movement key (state ${q.state})`);
  c.ok(q.finite && Math.abs(q.heightAboveGround) < 0.12, `${tag}: stood up badly (height above ground ${q.heightAboveGround})`);
  await api.advance(0.5, { dt: 1 / 60 });
  await page.waitForTimeout(2600); // and fades out over 2 s of audio time
  const m2 = await api.music();
  c.ok(m2.gain < 0.06, `${tag}: the music didn't fade out (gain ${m2.gain})`);
  return { tag, worst, frame, music: m.gain, shot };
}

test('sit', async ({ page }) => {
  const api = T(page), rep = reporter('sit'), c = checks();
  await openGame(page, { query: 't=golden' });
  const benches = (await api.benches()).filter((b) => !b.occupied);
  c.ok(benches.length > 10, `only ${benches.length} free benches`);
  for (const b of benches) {
    await api.toBench(b.i);
    const r = await sitAndCheck(page, api, rep, c, `bench ${b.i} (s ${Math.round(b.s)})`, `bench-${String(b.i).padStart(2, '0')}`);
    if (r) rep.add(r);
  }
  const flights = (await api.flights()).filter((f) => f.side === 'lake');
  for (const fl of flights) {
    await api.teleport(fl.s, 4.6, 'lake');
    const r = await sitAndCheck(page, api, rep, c, `steps ${fl.kind} s${Math.round(fl.s)}`, `steps-${Math.round(fl.s)}`);
    if (r) rep.add(r);
  }
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
