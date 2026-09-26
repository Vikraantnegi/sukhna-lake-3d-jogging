// 9. Performance: frame time (GPU-synced) and draw calls at the three worst views, per
// quality tier.  Budgets (plan §8): high ≤ 900 calls, low ≤ 350; every view under 16.7 ms.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const VIEWS = [
  ['spawn at sunrise', async (api) => { await api.setTime('sunrise'); await api.teleport(2330, -1.6, 114); }],
  ['the bend, across the lake', async (api) => { await api.setTime('bright'); await api.teleport(2240, 2, 60); }],
  ['P overview', async (api, page) => { await api.setTime('bright'); await page.keyboard.press('KeyP'); }],
];
const BUDGET = { high: 900, med: 600, low: 350 };

test('performance', async ({ page }) => {
  const c = checks(), rep = reporter('perf');
  const rows = [];
  for (const tier of ['high', 'med', 'low']) {
    const api = T(page);
    await openGame(page, { query: `q=${tier}` });
    for (const [name, place] of VIEWS) {
      await place(api, page);
      await api.advance(0.5, { dt: 1 / 60 });
      await page.waitForTimeout(400);
      const b = await api.bench(150);
      rows.push({ tier, view: name, calls: b.calls, triangles: b.triangles, ms: b.msPerFrame, internal: b.internal, gpu: b.gpu });
      c.ok(b.calls <= BUDGET[tier], `${tier} · ${name}: ${b.calls} draw calls (budget ${BUDGET[tier]})`);
      c.ok(b.msPerFrame < 16.7, `${tier} · ${name}: ${b.msPerFrame} ms per frame`);
      await rep.shot(page, `${tier}-${name.replace(/\W+/g, '-')}`);
    }
  }
  console.table(rows.map(({ gpu, ...r }) => r));
  rep.save({ fails: c.fails, rows });
  c.done(expect);
});
