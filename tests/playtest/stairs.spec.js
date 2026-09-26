// 2. Stairs: every flight -- the city-side stairs and every flight to the water -- walked
// down and back up with W, the camera turned the way a player would.  The player's height
// is compared, sample by sample, with the rendered surface under the feet (a ray against
// the real meshes), so "follows the treads" means what you see.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const ON_FLIGHT = /waterSteps|stairs/;

// the surface a foot stands on: the highest rendered surface within ±0.1 m along the way you face
function footSurface(p) { return p.ground; }

function analyse(tag, samples, c) {
  const stats = { n: samples.length, onFlight: 0, maxSink: 0, maxFloat: 0, maxJump: 0, meanErr: 0 };
  let sum = 0, prev = null;
  for (const p of samples) {
    if (!p.finite) { c.ok(false, `${tag}: position went non-finite at t=${p.t}`); break; }
    if (p.onWater) c.ok(false, `${tag}: on open water at t=${p.t} (s ${p.s} d ${p.d})`);
    if (prev) {
      const jump = Math.abs(p.y - prev.y);
      stats.maxJump = Math.max(stats.maxJump, jump);
      if (jump > 0.5) c.ok(false, `${tag}: height jumped ${jump.toFixed(2)} m at t=${p.t}`);
    }
    prev = p;
    if (!p.ground || !ON_FLIGHT.test(p.ground.name)) continue;
    stats.onFlight++;
    const err = p.y - p.ground.y;
    sum += Math.abs(err);
    if (-err > stats.maxSink) stats.sinkAt = { t: p.t, s: p.s, d: p.d, y: p.y, surface: p.surface, ground: p.ground };
    stats.maxSink = Math.max(stats.maxSink, -err);
    stats.maxFloat = Math.max(stats.maxFloat, err);
  }
  stats.meanErr = stats.onFlight ? +(sum / stats.onFlight).toFixed(3) : null;
  // feet on the treads: never sunk into one (falling through), never hovering a step above
  c.ok(stats.maxSink <= 0.1, `${tag}: sank ${stats.maxSink.toFixed(2)} m into the treads (fell through / buried) at ${JSON.stringify(stats.sinkAt)}`);
  c.ok(stats.maxFloat <= 0.2, `${tag}: floated ${stats.maxFloat.toFixed(2)} m above the treads`);
  c.ok(stats.meanErr === null || stats.meanErr <= 0.06, `${tag}: height off the treads by ${stats.meanErr} m on average`);
  return stats;
}

test('stairs', async ({ page }) => {
  const api = T(page), rep = reporter('stairs'), c = checks();
  await openGame(page, { query: 't=bright' });
  const flights = await api.flights();
  c.ok(flights.filter((f) => f.side === 'city').length === 6, `expected 6 city-side stairs, found ${flights.filter((f) => f.side === 'city').length}`);
  c.ok(flights.filter((f) => f.side === 'lake').length >= 3, 'expected at least 3 flights to the water');

  for (const [i, fl] of flights.entries()) {
    const tag = `${fl.side} ${fl.kind} s${Math.round(fl.s)}`;
    const long = fl.kind === 'jetty' ? 24 : fl.kind === 'pier' ? 16 : 11;
    const down = fl.side === 'lake' ? 'lake' : 'city', upDir = fl.side === 'lake' ? 'city' : 'lake';
    // on the walk, at the head of the flight, facing down it
    await api.teleport(fl.s, fl.side === 'lake' ? 1.5 : -1.5, down);
    const start = await api.getPlayer();
    await page.keyboard.down('KeyW');
    const goingDown = await api.advance(long, { dt: 1 / 60, every: 1 / 30, ground: true });
    await page.keyboard.up('KeyW');
    await api.advance(0.6, { dt: 1 / 60 });
    const bottom = await api.getPlayer();
    const shotBottom = await rep.shot(page, `${String(i).padStart(2, '0')}-${fl.side}-${Math.round(fl.s)}-bottom`);
    const sDown = analyse(`${tag} (down)`, goingDown, c);

    // how far down did we get? (the lowest tread you may stand on, or the toe of the city face)
    const lowestTread = fl.treads.length ? Math.min(...fl.treads.map((t) => t.y)) : null;
    // the lowest point reached on the flight vs the lowest tread you may stand on
    const onFl = goingDown.filter((p) => p.ground && ON_FLIGHT.test(p.ground.name));
    const lowestReached = onFl.length ? Math.min(...onFl.map((p) => p.y)) : start.y;
    const standable = fl.side === 'city' ? lowestTread : fl.kind === 'jetty' ? 0.745 : fl.kind === 'pier' ? 0.3 : Math.min(...fl.treads.filter((t) => t.y > 0.12).map((t) => t.y));
    c.ok(lowestReached <= standable + 0.2, `${tag}: stuck on the way down: lowest point reached on the flight y ${lowestReached.toFixed(2)}, lowest tread you can stand on y ${standable.toFixed(2)} (ended at s ${bottom.s} d ${bottom.d})`);
    c.ok(sDown.onFlight > 5, `${tag}: never on the treads going down (${sDown.onFlight} samples on a flight)`);

    // and back up
    await api.face(upDir);
    await page.keyboard.down('KeyW');
    const goingUp = await api.advance(long + 6, { dt: 1 / 60, every: 1 / 30, ground: true });
    await page.keyboard.up('KeyW');
    await api.advance(0.4, { dt: 1 / 60 });
    // back on the walk = within its 8 m and at its height; judge the climb up to that moment
    const onWalk = (p) => Math.abs(p.d) <= 4 && Math.abs(p.y - start.y) < 0.15;
    const reached = goingUp.findIndex(onWalk);
    const climb = reached >= 0 ? goingUp.slice(0, reached + 1) : goingUp;
    const top = reached >= 0 ? goingUp[reached] : await api.getPlayer();
    const sUp = analyse(`${tag} (up)`, climb, c);
    c.ok(reached >= 0, `${tag}: didn't get back up to the walk (ended at d ${top.d}, y ${top.y}; the walk is at y ${start.y})`);
    rep.add({ tag, lowestTread, start: { y: start.y, d: start.d }, bottom: { y: bottom.y, d: bottom.d }, top: { y: top.y, d: top.d }, down: sDown, up: sUp, shot: shotBottom });
  }
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
