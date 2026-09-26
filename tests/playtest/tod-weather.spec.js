// 5. Every T preset × every K weather: a screenshot each; the lamps in the right state;
// the crowd's density following the rules (plan §6); no console errors.
import { test, expect } from '@playwright/test';
import { openGame, T, reporter, checks } from './helpers.js';

const PRESETS = ['predawn', 'sunrise', 'golden', 'bright', 'sunset'];
const WEATHERS = ['clear', 'rain', 'fog'];
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the rules, written out again here so the test doesn't just echo the code
const lampRule = (el, w) => Math.max(1 - smooth(el, -3, 3), w === 'rain' ? 0.85 : 0, w === 'fog' ? 1 : 0);
function densityRule(min, fog, evening) {
  if (evening) return 0.9 * (1 - 0.55 * fog);
  const k = min < -30 ? 0.3 : min < -10 ? 0.3 + 0.7 * (min + 30) / 20 : min < 70 ? 1 : min < 160 ? 1 - 0.45 * (min - 70) / 90 : 0.55;
  return k * (1 - 0.55 * fog);
}

test('time and weather', async ({ page }) => {
  const api = T(page), rep = reporter('tod-weather'), c = checks();
  await openGame(page);
  await api.teleport(1900, 2, 'lake');
  for (const p of PRESETS) {
    for (const w of WEATHERS) {
      const tag = `${p} × ${w}`;
      const t = await api.setTime(p);
      await api.setWeather(w);
      await api.advance(0.3, { dt: 1 / 60 });
      const lamps = await api.lamps();
      const want = lampRule(t.elevation, w);
      c.ok(Math.abs(lamps - want) < 0.03, `${tag}: lamps at ${lamps.toFixed(2)}, expected ${want.toFixed(2)} (sun ${t.elevation.toFixed(1)}°)`);
      const dens = await api.crowdDensity();
      const rule = densityRule(dens.sinceSunrise, dens.fog, dens.hours > 12);
      const got = dens.active / dens.movers;
      c.ok(Math.abs(got - rule) < 0.03, `${tag}: ${dens.active}/${dens.movers} people out (${got.toFixed(2)}), the rule says ${rule.toFixed(2)}`);
      const hud = await api.getHud();
      c.ok(hud.weather?.toLowerCase() === w, `${tag}: the card says "${hud.weather}"`);
      c.ok(!!hud.clock && !!hud.preset, `${tag}: the card has no clock or preset`);
      await rep.shot(page, `${p}-${w}`);
      rep.add({ tag, clock: t.clock, label: t.label, elevation: t.elevation, lamps, lampsExpected: want, density: got, densityExpected: rule });
    }
  }
  const errors = await api.consoleErrors();
  c.ok(errors.length === 0, `console errors: ${errors.slice(0, 3).join(' | ')}`);
  rep.save({ fails: c.fails });
  c.done(expect);
});
