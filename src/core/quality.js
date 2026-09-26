/* ------------------------------------------------------------------ *
 * Quality tiers (plan §6 "Quality tiers").
 *
 * `?q=low|med|high` picks a tier; otherwise it is detected: touch devices
 * and those reporting ≤ 4 GB of memory start on low, ≤ 4 cores on med,
 * everything else on high.  If frame time stays above 22 ms for 5 s the
 * game drops a tier at run time (the parts that can change live: pixel
 * budget, shadow map, crowd, mist, rain) and remembers it for the session,
 * so a reload builds the lower tier fully.
 *
 * Modules read `Q` at build time; nothing here touches the scene.
 * ------------------------------------------------------------------ */

export const TIERS = {
  //       pixels   shadow  water      dressing  NPCs  birds  trees near/mid  city   hills   mist  rain
  high: { pixelBudget: 4.6e6, shadow: 2048, water: 'shader', dressing: 1.0, npcs: 200, birds: 175, treeNear: 230, treeMid: 1500, city: 2200, hillHalf: false, mist: 140, rain: 1800 },
  med: { pixelBudget: 2.8e6, shadow: 1024, water: 'shader', dressing: 0.75, npcs: 125, birds: 100, treeNear: 150, treeMid: 1000, city: 1400, hillHalf: false, mist: 100, rain: 1200 },
  low: { pixelBudget: 1.3e6, shadow: 1024, water: 'flat', dressing: 0.45, npcs: 50, birds: 35, treeNear: 100, treeMid: 600, city: 800, hillHalf: true, mist: 50, rain: 700 },
};
export const ORDER = ['low', 'med', 'high'];

function detect() {
  const params = new URLSearchParams(location.search);
  const asked = params.get('q');
  if (TIERS[asked]) return { tier: asked, why: 'url' };
  try {
    const fell = sessionStorage.getItem('sukhna-q');
    if (TIERS[fell]) return { tier: fell, why: 'fallback' };
  } catch { /* optional */ }
  const touch = matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
  const mem = navigator.deviceMemory ?? 8, cores = navigator.hardwareConcurrency ?? 8;
  if (touch || mem <= 4) return { tier: 'low', why: touch ? 'touch' : 'memory' };
  if (cores <= 4) return { tier: 'med', why: 'cores' };
  return { tier: 'high', why: 'auto' };
}

const picked = detect();
/** The active tier's settings (read at build time), plus `tier` and `why`. */
export const Q = { ...TIERS[picked.tier], tier: picked.tier, why: picked.why };

/** The next tier down, or null on low. */
export const lower = (tier) => ORDER[Math.max(0, ORDER.indexOf(tier) - 1)] === tier ? null : ORDER[ORDER.indexOf(tier) - 1];
