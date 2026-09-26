// 7. Boundaries: into the water (from the foot of a flight, off the jetty, over the parapet),
// into buildings, and off the edge of the world -- all blocked.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

async function push(page, api, seconds) {
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  const s = await api.advance(seconds, { dt: 1 / 60, every: 0.1 });
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  return s;
}

test('boundaries', async ({ page }) => {
  const api = T(page), rep = reporter('boundaries'), c = checks();
  await openGame(page, { query: 't=bright' });
  const W = await api.world();

  // the water: from the foot of every flight, straight on into the lake
  for (const fl of (await api.flights()).filter((f) => f.side === 'lake')) {
    await api.teleport(fl.s, 4.6, 'lake');
    const s = await push(page, api, fl.kind === 'jetty' ? 30 : 12);
    const wet = s.find((p) => p.onWater || !p.finite);
    c.ok(!wet, `into the water at the ${fl.kind} flight s${Math.round(fl.s)}: reached ${JSON.stringify(wet && { s: wet.s, d: wet.d, y: wet.y })}`);
    // and sideways along the lake from the foot
    await api.face('west');
    const side = await push(page, api, 4);
    c.ok(!side.some((p) => p.onWater), `sideways off the ${fl.kind} flight s${Math.round(fl.s)} onto the water`);
  }
  // over the parapet, anywhere but a flight
  for (const s of [100, 700, 1300, 1950, 2250]) {
    await api.teleport(s, 2.5, 'lake');
    const t = await push(page, api, 4);
    c.ok(t.every((p) => p.d < W.parIn + 0.1), `over the parapet at s ${s}: reached d ${Math.max(...t.map((p) => p.d)).toFixed(2)}`);
  }
  // off the jetty's end and sides
  const jetty = (await api.flights()).find((f) => f.kind === 'jetty');
  if (jetty) {
    await api.teleport(jetty.s, 30, 'lake');
    c.ok(!(await push(page, api, 8)).some((p) => p.onWater), 'off the end of the jetty onto the water');
    await api.teleport(jetty.s, 30, 'west');
    c.ok(!(await push(page, api, 4)).some((p) => p.onWater), 'off the side of the jetty onto the water');
  }

  // into buildings
  for (const s of [400, 1200, 1700]) {
    const b = await api.buildingNear(s);
    if (!b) continue;
    await api.teleportTo(b.from[0], b.from[1]);
    await api.lookAt(b.c[0], b.c[1]);
    const t = await push(page, api, 8);
    const inside = [];
    for (const p of t) if (await api.insideBuilding(p.e, p.n, 0.05)) inside.push(p);
    c.ok(inside.length === 0, `into a building near s ${s} (${inside.length} samples inside)`);
  }

  // off the edge of the world: from inside the detailed terrain, run outward for 30 s
  const [x0, y0, x1, y1] = W.near;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const [e, n, tag] of [[x0 + 25, cy, 'west'], [x1 - 25, cy, 'east'], [cx, y0 + 25, 'south'], [cx, y1 - 25, 'north']]) {
    await api.teleportTo(e, n);
    await api.lookAt(e + (e - cx), n + (n - cy));
    const t = await push(page, api, 30);
    const out = t.find((p) => p.e < x0 || p.e > x1 || p.n < y0 || p.n > y1 || !p.finite);
    c.ok(!out, `off the ${tag} edge of the world: reached (${out?.e}, ${out?.n})`);
  }
  await rep.shot(page, 'world-edge');
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
