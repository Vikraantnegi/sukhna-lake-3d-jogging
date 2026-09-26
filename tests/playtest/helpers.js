// Shared helpers for the playtest scenarios.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPORT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report');

/** Open the game, check the GPU, press Start (a real click: it also unlocks audio). */
export async function openGame(page, { query = '', start = true } = {}) {
  const qs = query ? `${query.replace(/^\?/, '')}&nolock` : 'nolock';
  await page.goto(`/?${qs}`);
  await page.waitForFunction(() => window.__test?.ready && window.__scene, null, { timeout: 90_000 });
  const gpu = await page.evaluate(() => window.__test.gpu());
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) throw new Error(`No hardware GPU: WebGL renderer is "${gpu}". Stopping (the playtest must run on the real GPU).`);
  if (start) {
    await page.click('.overlay .go');
    await page.waitForFunction(() => window.__test.getHud().started);
    await page.waitForTimeout(800); // the card's fade-out, so it isn't in the first screenshots
  }
  return gpu;
}

/** window.__test.<fn>(...args) in the page. */
export const T = (page) => new Proxy({}, {
  get: (_, fn) => (...args) => page.evaluate(([f, a]) => window.__test[f](...a), [fn, args]),
});

/** A scenario's own report: details.json and screenshots under report/<scenario>/. */
export function reporter(name) {
  const dir = path.join(REPORT, name);
  fs.mkdirSync(dir, { recursive: true });
  const details = { scenario: name, started: new Date().toISOString(), items: [] };
  return {
    dir,
    add(item) { details.items.push(item); },
    async shot(page, file) {
      await page.evaluate(() => window.__test.renderOnce());
      const p = path.join(dir, file.endsWith('.jpg') ? file : `${file}.jpg`);
      await page.screenshot({ path: p, type: 'jpeg', quality: 80 });
      return path.relative(REPORT, p);
    },
    save(extra = {}) { Object.assign(details, extra, { finished: new Date().toISOString() }); fs.writeFileSync(path.join(dir, 'details.json'), JSON.stringify(details, null, 2)); },
  };
}

/** A soft-assert collector: every failure is kept, the test fails once at the end with all of them. */
export function checks() {
  const fails = [];
  return {
    fails,
    ok(cond, msg) { if (!cond) fails.push(msg); return !!cond; },
    done(expect) { expect(fails, fails.length ? `${fails.length} failed:\n- ${fails.slice(0, 40).join('\n- ')}${fails.length > 40 ? `\n… and ${fails.length - 40} more` : ''}` : '').toEqual([]); },
  };
}
