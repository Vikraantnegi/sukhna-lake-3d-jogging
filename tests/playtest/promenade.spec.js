// 1. The full promenade on auto-jog (V), east end to west end and back.  Asserts: never on
// open water, never stuck, the turnaround at each end, the lengths counter going up at each
// end, a plausible pace, and the feet on the ground.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

test('promenade', async ({ page }) => {
  const api = T(page), rep = reporter('promenade'), c = checks();
  await openGame(page, { query: 't=golden' });
  const { L } = await api.world();
  await api.teleport(12, -1.6, 'west');
  await page.keyboard.press('KeyV');
  const first = await api.getPlayer();
  c.ok(first.auto, 'V did not start auto-jog');

  // ~1 700 s of game time for there and back, in 100 s chunks
  const samples = [];
  for (let k = 0; k < 19; k++) samples.push(...(await api.advance(100, { dt: 1 / 30, every: 0.5 })).map((p) => ({ ...p, t: p.t + k * 100 })));
  await rep.shot(page, 'end');

  let turns = 0, prevDir = first.autoDir, maxSinceMove = 0, lastProgressT = 0, lastS = first.s;
  const lengthsAt = [];
  let prevLen = first.lengths;
  const speeds = [];
  for (const p of samples) {
    if (!p.finite) { c.ok(false, `non-finite position at t=${p.t}`); break; }
    c.ok(!p.onWater, `on open water at t=${p.t} (s ${p.s} d ${p.d})`);
    c.ok(p.auto, `auto-jog switched itself off at t=${p.t} (s ${p.s})`);
    if (Math.abs(p.heightAboveGround) > 0.3) c.ok(false, `feet ${p.heightAboveGround} m off the ground at t=${p.t} (s ${p.s})`);
    if (p.autoDir !== prevDir) { turns++; c.ok(p.s < 20 || p.s > L - 20, `turned round mid-walk at s ${p.s} (t=${p.t})`); prevDir = p.autoDir; }
    if (p.lengths !== prevLen) { lengthsAt.push({ t: p.t, s: p.s, lengths: p.lengths }); c.ok(p.s < 27 || p.s > L - 27, `a length was counted mid-walk at s ${p.s}`); /* the end zones are 25 m */ prevLen = p.lengths; }
    // stuck: no progress along s for 8 s (turnarounds take a few seconds at the ends)
    if (Math.abs(p.s - lastS) > 2) { lastS = p.s; lastProgressT = p.t; }
    maxSinceMove = Math.max(maxSinceMove, p.t - lastProgressT);
    if (p.s > 40 && p.s < L - 40) speeds.push(p.speed);
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
  const last = samples[samples.length - 1];
  c.ok(maxSinceMove < 8, `stuck: no progress along the walk for ${maxSinceMove.toFixed(1)} s`);
  c.ok(turns >= 2, `expected a turnaround at each end, saw ${turns}`);
  c.ok(last.lengths >= 2, `lengths counter reached ${last.lengths} after there-and-back (expected ≥ 2)`);
  c.ok(mean > 2.7 && mean < 3.3, `mean auto-jog speed ${mean.toFixed(2)} m/s (5:33 /km is 3.0)`);
  const mid = samples.find((p) => p.s > 1000 && p.s < 1100 && p.speed > 2.5);
  c.ok(!mid || /^5:[2-4]\d$/.test(mid.pace), `pace reads ${mid?.pace} mid-walk (expected about 5:33 /km)`);
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails, turns, lengthsAt, meanSpeed: +mean.toFixed(3), maxStuck: maxSinceMove, samples: samples.length, finalLengths: last.lengths });
  c.done(expect);
});
