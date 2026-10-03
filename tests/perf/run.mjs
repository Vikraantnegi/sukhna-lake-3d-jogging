// Performance measurements on a production build (docs/perf.md).  Not part of the playtest.
//
//   npm run perf                                   every profile x every tier, then the download
//   npm run perf -- --profile mid-phone --tier low one run
//   npm run perf -- --no-build                     reuse dist/
//   npm run perf -- --download-only                just the first-visit download (the live site)
//
// Each run: a fresh browser context, the CPU throttled for the profile, the page opened at
// ?perf&nolock&q=<tier>, then a fixed 60 s route driven through window.__scene (the production
// build has no __test): 25 s of auto-jog along the walk past the laughter club, a swan boat ride
// from the jetty (pedalling out), 7 s of the P overview, and pedalling on.  Frame times, draw
// calls, triangles, the JS heap and any quality fallback come from the ?perf overlay's recorder
// (src/core/perfhud.js).  Results go to tests/perf/report/ (git-ignored) as JSON, and a summary
// is printed as markdown.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'report');
const PORT = 5181;
const BASE = `http://127.0.0.1:${PORT}`;
const LIVE = 'https://sukhna-lake.trymurmur.studio/';
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = (k) => argv.includes(k);

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.60';
const GPU_ARGS = ['--ignore-gpu-blocklist', '--enable-gpu', '--enable-gpu-rasterization'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--disable-gpu'];
// Headless, on purpose: a headed window's frames hang on the display (asleep, locked or covered,
// Chrome drops it to ~1 frame a second, which measured the desktop rather than the game).  Headless
// Chrome still renders WebGL on the real GPU (ANGLE / D3D11 here), or on SwiftShader when asked.
// (Windows' occlusion tracking is switched off as well, for a headed run.)
const COMMON_ARGS = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', '--autoplay-policy=no-user-gesture-required', '--window-position=0,0'];
const PROFILES = {
  desktop: { label: 'Desktop, no throttling', ctx: { viewport: { width: 1440, height: 900 } }, cpu: 1, gpu: 'real' },
  'mid-phone': { label: 'Mid phone: 390x844, CPU 4x', ctx: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE }, cpu: 4, gpu: 'real' },
  'low-phone': { label: 'Low phone: 390x664, CPU 6x', ctx: { viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE }, cpu: 6, gpu: 'real' },
  software: { label: 'Software rendering (SwiftShader)', ctx: { viewport: { width: 1280, height: 720 } }, cpu: 1, gpu: 'software' },
};
const TIERS = ['high', 'med', 'low'];
// the route's two places (world ENU metres; deterministic data, not the random crowd)
const ROUTE = {
  club: { e: -442.01, n: 440.49, heading: 0.6087 },   // the walk at s 1880, facing west: auto-jog runs past the laughter club (s ~1946)
  berth: { e: -674.85, n: 876.38, heading: -2.9542 }, // on the jetty deck beside a moored swan
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ the build and a server ------------------------------ */
function build() {
  const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}\n${r.stderr}`);
}
async function serve() {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) return proc; } catch { /* not yet */ } await sleep(500); }
  throw new Error('vite preview did not start');
}
function stop(proc) {
  if (!proc) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill();
}

/* ------------------------------ one run ------------------------------ */
async function run(browser, profileKey, tier) {
  const P = PROFILES[profileKey];
  const ctx = await browser.newContext(P.ctx);
  const page = await ctx.newPage();
  await page.bringToFront();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  if (P.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.cpu });
  const q = new URLSearchParams({ perf: '', nolock: '' });
  if (tier !== 'auto') q.set('q', tier);
  const t0 = Date.now();
  await page.goto(`${BASE}/?${q}`, { waitUntil: 'commit', timeout: 300_000 });
  // the Start button comes up when the world is built
  await page.locator('.overlay .go:enabled').waitFor({ timeout: 300_000 });
  const load = await page.evaluate(() => ({
    startReadyMs: Math.round(performance.now()),
    firstFrameMs: window.__perf?.state.firstFrameMs,
    domContentLoadedMs: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0),
    gpu: window.__perf?.state.gpu,
    tierLine: document.querySelector('.perfhud')?.textContent.split('\n')[1] || '',
  }));
  if (P.ctx.hasTouch) await page.tap('.overlay .go'); else await page.click('.overlay .go');
  for (let i = 0; i < 100 && !(await page.evaluate(() => window.__perf.state.startToFrameMs !== null)); i++) await sleep(50);
  const startToFrameMs = await page.evaluate(() => window.__perf.state.startToFrameMs);
  await sleep(1000);

  // the route: auto-jog past the laughter club, a boat ride, the overview
  const place = (p) => page.evaluate((p) => {
    const { jogger, rig, interact } = window.__scene;
    interact.cancel?.();
    jogger.auto = false; jogger.keys.clear(); jogger.speed = 0;
    jogger.e = p.e; jogger.n = p.n; jogger.y = jogger.collider.surfaceAt(p.e, p.n); jogger.heading = p.heading; rig.yaw = p.heading;
  }, p);
  await place(ROUTE.club);
  await sleep(500);
  await page.evaluate(() => window.__perf.record.start());
  await page.keyboard.press('KeyV');           // auto-jog
  await sleep(25_000);
  await page.keyboard.press('KeyV');           // stop
  await page.evaluate(() => { window.__scene.interact.ticket = true; });
  await place(ROUTE.berth);
  await sleep(500);
  await page.keyboard.press('KeyE');           // board the swan
  await sleep(300);
  const boarded = await page.evaluate(() => window.__scene.interact.state === 'boat');
  await page.keyboard.down('KeyW');            // pedal out
  await sleep(13_200);
  await page.keyboard.press('KeyP');           // the overview
  await sleep(7000);
  await page.keyboard.press('KeyP');
  await sleep(14_000);
  await page.keyboard.up('KeyW');
  const m = await page.evaluate(() => window.__perf.record.stop());
  const wall = Date.now() - t0;
  await ctx.close();
  return { profile: profileKey, profileLabel: P.label, cpu: P.cpu, tierAsked: tier, ...load, startToFrameMs, boarded, ...m, errors: [...new Set(errors)].slice(0, 5), wallSeconds: Math.round(wall / 1000) };
}

/* ------------------------------ the download ------------------------------ */
async function download(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const reqs = new Map();
  let phase = 'before';
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, phase, type: e.type }));
  cdp.on('Network.responseReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.status = e.response.status; r.encoding = e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'] || ''; r.mime = e.response.mimeType; } });
  cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
  await page.goto(`${url}?notrack`, { waitUntil: 'load', timeout: 120_000 });
  await page.locator('.overlay .go:enabled').waitFor({ timeout: 120_000 });
  await sleep(1500);
  phase = 'after';
  await page.click('.overlay .go');
  await sleep(15_000);
  await ctx.close();
  const list = [...reqs.values()].filter((r) => r.bytes !== undefined).map((r) => ({ ...r, file: r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/' }));
  const sum = (a) => a.reduce((s, r) => s + r.bytes, 0);
  return {
    url, requests: list.length, totalBytes: sum(list), beforeStartBytes: sum(list.filter((r) => r.phase === 'before')), afterStartBytes: sum(list.filter((r) => r.phase === 'after')),
    files: list.sort((a, b) => b.bytes - a.bytes).map((r) => ({ file: r.file, bytes: r.bytes, encoding: r.encoding, phase: r.phase, host: new URL(r.url).host })),
  };
}
/** dist/ as built: each file raw, gzip -9 and brotli (what a CDN would send). */
function distSizes() {
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else out.push(p); } };
  walk(path.join(ROOT, 'dist'));
  return out.map((p) => {
    const buf = fs.readFileSync(p), text = /\.(js|html|css|json|svg|txt|xml)$/.test(p);
    return { file: path.relative(path.join(ROOT, 'dist'), p).replace(/\\/g, '/'), raw: buf.length, gzip: text ? zlib.gzipSync(buf, { level: 9 }).length : buf.length, brotli: text ? zlib.brotliCompressSync(buf).length : buf.length };
  }).sort((a, b) => b.raw - a.raw);
}

/* ------------------------------ main ------------------------------ */
fs.mkdirSync(OUT, { recursive: true });
const profiles = opt('--profile') ? [opt('--profile')] : Object.keys(PROFILES);
const tiers = opt('--tier') ? (opt('--tier') === 'all' ? TIERS : [opt('--tier')]) : TIERS;
const results = { when: new Date().toISOString(), runs: [], download: null, dist: null };
let server = null;
try {
  if (!has('--download-only')) {
    if (!has('--no-build')) { console.log('building...'); build(); }
    results.dist = distSizes();
    server = await serve();
    for (const gpu of ['real', 'software']) {
      const keys = profiles.filter((k) => PROFILES[k].gpu === gpu);
      if (!keys.length) continue;
      const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...COMMON_ARGS, ...(gpu === 'software' ? SOFTWARE_ARGS : GPU_ARGS)] });
      try {
        for (const k of keys) for (const tier of tiers) {
          process.stdout.write(`${k} / ${tier} ... `);
          try {
            const r = await run(browser, k, tier);
            results.runs.push(r);
            console.log(`${r.fps} fps, p50 ${r.p50} ms, p95 ${r.p95} ms, ${r.callsP50} calls, start ready ${r.startReadyMs} ms, fallbacks ${r.fallbacks.length}${r.boarded ? '' : ' (DID NOT BOARD)'}`);
          } catch (e) { console.log(`FAILED: ${e.message.split('\n')[0]}`); results.runs.push({ profile: k, tierAsked: tier, failed: e.message }); }
          fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(results, null, 2));
        }
      } finally { await browser.close(); }
    }
  }
  if (!has('--no-download')) {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [...COMMON_ARGS, ...GPU_ARGS] });
    try { results.download = await download(browser, opt('--url') || LIVE); } finally { await browser.close(); }
  }
} finally {
  stop(server);
}
fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify(results, null, 2));

/* ------------------------------ the summary ------------------------------ */
const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
if (results.runs.length) {
  console.log('\n| Profile | Tier | Start ready | Start→frame | FPS | p50 | p95 | Calls (p50/max) | Tris (p50) | Heap peak | Fallback |\n|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results.runs) {
    if (r.failed) { console.log(`| ${r.profile} | ${r.tierAsked} | failed: ${r.failed.split('\n')[0]} |`); continue; }
    console.log(`| ${r.profileLabel} | ${r.tierAsked} | ${(r.startReadyMs / 1000).toFixed(1)} s | ${r.startToFrameMs} ms | ${r.fps} | ${r.p50} ms | ${r.p95} ms | ${r.callsP50} / ${r.callsMax} | ${(r.trisP50 / 1e6).toFixed(2)} M | ${r.heapPeakMB ?? 'n/a'} MB | ${r.fallbacks.length ? r.fallbacks.map((f) => `${f.from}→${f.to} at ${f.atSec} s`).join(', ') : 'none'} |`);
  }
}
if (results.download) {
  const d = results.download;
  console.log(`\nFirst visit (${d.url}): ${d.requests} requests, ${kb(d.totalBytes)} on the wire (${kb(d.beforeStartBytes)} before Start, ${kb(d.afterStartBytes)} after); 100 GB fits ${Math.floor(100e9 / d.totalBytes).toLocaleString()} first visits`);
  for (const f of d.files.slice(0, 8)) console.log(`  ${kb(f.bytes).padStart(8)}  ${f.encoding || '-'}  ${f.phase}  ${f.file}`);
}
