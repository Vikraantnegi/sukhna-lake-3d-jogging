# Performance: how Sukhna runs on weak devices

Measured 2026-10-04 on the production build, before Show HN. Repeat with `npm run perf` (see
[Repeating it](#repeating-it)). **Nothing here changes a tier or a threshold yet**: the
recommendations at the end wait for a go.

## 1. Quality tiers today

`src/core/quality.js` picks a tier once, at load; modules read it while the world is built.

| | high | med | low |
|---|---|---|---|
| Pixel budget (render size cap) | 4.6 MP | 2.8 MP | 1.3 MP |
| Shadow map | 2048 | 1024 | 1024 |
| Water | shader | shader | flat colour |
| Walk dressing (lamps, benches, reeds...) | 100 % | 75 % | 45 % |
| People | 200 | 125 | 50 |
| Birds | 175 | 100 | 35 |
| Trees, near / mid LOD | 230 / 1500 | 150 / 1000 | 100 / 600 |
| City blocks | 2200 | 1400 | 800 |
| Hill terrain | full | full | half resolution |
| Mist sheets / rain drops | 140 / 1800 | 100 / 1200 | 50 / 700 |

**Which tier:** `?q=low|med|high` wins; then a tier this session already fell back to
(`sessionStorage`); then **any touch device → low**, ≤ 4 GB of memory (`navigator.deviceMemory`,
Chrome only) **→ low**, ≤ 4 CPU cores **→ med**, everything else **→ high**. So every phone
starts on low, and every non-touch machine with more than 4 cores on high.

**The fallback** (`watchFrameTime` in `src/main.js`): after a 10 s settle, every frame slower
than **22 ms** (under ~45 fps) adds its time to a counter and faster frames drain it at half
rate; at **5 s** the game drops **one** tier, then settles another 10 s. The drop changes only
what can change live: the pixel budget, the shadow map, the crowd (capped to the new count) and
the mist. Water, dressing, trees, city, hills, birds and rain stay as built until a reload, which
builds the lower tier fully because the tier is remembered for the session. Low is the floor.
(`quality.js`'s comment says rain drops too; the code doesn't.) Each drop flashes "quality: med
(frames were slow)" and sends `quality_fallback` to PostHog.

## 2. `?perf`: an overlay for real phones

Add `?perf` to the URL (e.g. `https://sukhna-lake.trymurmur.studio/?perf&notrack`). Top centre,
four lines: FPS · frame time p50 and p95 over the last 5 s (the real frame time, not the capped
step the game simulates with) · tier and why (`url`, `auto`, `touch`, `memory`, `cores`,
`fallback`) and any fallback · draw calls, triangles (the last frame, summed over every pass) and
the JS heap (Chrome; "n/a" in Safari) · the GPU. Never shown without `?perf`
(`src/core/perfhud.js`).

## 3. Method

- **Production build** (`vite build`, served by `vite preview`), Chrome 154, one machine: an
  Intel desktop with an **RTX 4080 SUPER**. **Headless** Chrome on the real GPU (ANGLE/D3D11),
  or on SwiftShader for the software profile: a headed window's frames hang on the display (a
  sleeping or covered screen drops Chrome to ~1 frame a second, which spoiled the first attempt).
- **Profiles:**

  | Profile | Viewport | CPU | GPU |
  |---|---|---|---|
  | Desktop | 1440×900, DPR 1 | 1× | RTX 4080 |
  | Mid phone | 390×844, DPR 3, touch, iPhone UA | **4× slower** | RTX 4080 |
  | Low phone | 390×664 (X's in-app browser), DPR 3, touch | **6× slower** | RTX 4080 |
  | Software rendering | 1280×720 | 1× | **SwiftShader** (stands in for a weak integrated GPU) |

- **Each tier forced** with `?q=`, a fresh browser context each run, then a fixed **60 s route**
  driven through `window.__scene`: 25 s of auto-jog along the walk from s 1880 past the laughter
  club (the busiest stretch: the club, walkers, joggers), a swan boat from the jetty pedalled out
  for 13 s, 7 s of the P overview (the widest view), 14 s more pedalling. Golden hour, clear.
- **Measured:** time from navigation to the Start button (= the world built, the first frame
  drawn), Start to the next frame, frames over the route (FPS = frames ÷ 60 s; frame time p50 and
  p95), draw calls and triangles per frame (p50 / max), the peak JS heap, and any fallback.
- **Caveats.** CPU throttling slows the JavaScript like a phone's CPU but the GPU stays an RTX
  4080, so the phone rows are **CPU-bound phones with a fast GPU** (roughly modern iPhones, which
  have strong GPUs); a weak phone GPU is closer to the software row. Headless frames aren't capped
  at a phone's 60 Hz: read the phone rows as frame **cost** against the 16.7 ms budget of a 60 Hz
  screen. The desktop rows sit at the browser's ~240 frames a second cap, so they only say "far
  inside the budget". The crowd isn't seeded, so who walks past differs a little between runs.

## 4. Results: frames over the 60 s route

| Profile | Tier | Start ready | Start → frame | FPS | p50 | p95 | Draw calls p50 / max | Triangles p50 | Heap peak | Fallback |
|---|---|---|---|---|---|---|---|---|---|---|
| Desktop | high | 1.9 s | 36 ms | 240* | 4.2 ms* | 4.3 ms* | 379 / 579 | 1.68 M | 126 MB | none |
| Desktop | med | 1.4 s | 14 ms | 240* | 4.2 ms* | 4.3 ms* | 335 / 454 | 1.24 M | 118 MB | none |
| Desktop | low | 1.4 s | 14 ms | 240* | 4.2 ms* | 4.3 ms* | 297 / 381 | 0.90 M | 107 MB | none |
| Mid phone (CPU 4×) | high | 6.3 s | 43 ms | 115 | 8.3 ms | 11.2 ms | 270 / 341 | 1.35 M | 140 MB | none |
| Mid phone (CPU 4×) | med | 6.3 s | 41 ms | 132 | 7.3 ms | 9.4 ms | 254 / 309 | 0.90 M | 153 MB | none |
| Mid phone (CPU 4×) | low | 5.8 s | 40 ms | 149 | 6.5 ms | 8.3 ms | 236 / 283 | 0.57 M | 142 MB | none |
| Low phone (CPU 6×) | high | 9.5 s | 70 ms | 65 | 14.7 ms | 20.3 ms | 281 / 356 | 1.37 M | 162 MB | none |
| Low phone (CPU 6×) | med | 9.8 s | 56 ms | 75 | 12.7 ms | 17.7 ms | 264 / 313 | 0.97 M | 158 MB | none |
| Low phone (CPU 6×) | low | 12.5 s | 72 ms | 69 | 13.8 ms | 20.7 ms | 241 / 286 | 0.61 M | 139 MB | none |
| Software (SwiftShader) | high | 3.8 s | 37 ms | 3.3 | 301 ms | 351 ms | 380 / 566 | 1.59 M | 98 MB | high→med at 7.7 s, med→low at 22.9 s |
| Software (SwiftShader) | med | 3.5 s | 20 ms | 4.7 | 209 ms | 254 ms | 336 / 449 | 1.20 M | 99 MB | med→low at 9.3 s |
| Software (SwiftShader) | low | 2.8 s | 15 ms | 6.4 | 153 ms | 181 ms | 307 / 385 | 0.91 M | 97 MB | none (low is the floor) |

\* At the browser's frame cap (~240 a second): the real cost is lower.

**What it says:**

- **A fast GPU with a slow CPU is fine.** At 4× CPU every tier is well inside 60 fps (p95 8–11
  ms). At 6× CPU the frame cost sits right at the 60 Hz line (p50 13–15 ms, p95 18–21 ms), and the
  tier hardly matters (low isn't faster than med): **on CPU-starved phones the per-frame
  JavaScript is the cost, not the drawing.** No fallback triggered on either phone profile.
- **A weak GPU is the problem.** On SwiftShader even low runs at ~6 fps (153 ms a frame): the cost
  is filling pixels and running the shaders, and it falls with the tier roughly in step with the
  pixel budget (high → low: 3.5× fewer pixels, 2× faster). The fallback works (high→med at 7.7 s,
  med→low at 22.9 s) but it is slow, and low is as far as it goes.
- **Load is the bigger wait on phones.** The Start button comes up after the world is built: 1.4–
  1.9 s on the desktop, ~6 s at 4× CPU, 9.5–12.5 s at 6× CPU. The download is small (below); the
  time is JavaScript building the world. (The start card and the About text show at once, as
  plain HTML, so the page is never empty meanwhile.) Start to the first frame is 14–72 ms.
- **Memory is fine:** 97–162 MB of JS heap at the peak.
- **Draw calls** stay far under the 900 budget: 236–379 at p50, 579 at most (high, in the
  overview).

## 5. The download

A first visit to the live site (cold cache, brotli from Vercel's CDN), measured with the Chrome
DevTools protocol (bytes on the wire):

| What | When | On the wire | Raw |
|---|---|---|---|
| `assets/data-*.js` (the lake, the walk, the terrain) | before Start | 206 KB | 469 KB |
| `assets/three-*.js` (three.js) | before Start | 183 KB | 710 KB |
| `assets/main-*.js` (the game) | before Start | 86 KB | 213 KB |
| `index.html` (the card, the About text, the FAQ) | before Start | 10 KB | 34 KB |
| `assets/index-*.js` (the boot script, analytics) | before Start | 5 KB | 5 KB |
| `favicon.ico` (fetched twice) | before / after | 4 + 4 KB | 4 KB |
| `/audio/list.json`, `/audio/playlist.json` | after Start | 0.4 KB (**404s**) | |
| **Total, 9 requests** | | **499 KB** (494 KB before Start, 5 KB after) | 1.4 MB |

- **100 GB of Vercel bandwidth ≈ 195,000 first visits** (100 × 10⁹ ÷ 511,121 bytes). Repeat visits
  cost ~10 KB: the assets are content-hashed and cached.
- Not counted: PostHog's script, **~100 KB** brotli, loads from PostHog's CDN (not Vercel's
  bandwidth) for tracked visitors only; the 84 KB link-preview image is fetched by X, WhatsApp
  and the like, not by players.
- **The two 404s:** after Start the sound module asks for `audio/list.json` and
  `audio/playlist.json`, the dev-only "drop your own music in public/audio/" feature
  (`src/core/sound.js`). In production they're always 404, and each puts a "Failed to load
  resource" line in the console.

## 6. Recommendations (none applied yet)

**Tier defaults by device class**

1. **Desktop (non-touch, > 4 cores): keep high.** Every tier is far inside the budget on a real
   GPU; a weak integrated GPU is what the fallback is for (see 4 and 5).
2. **Phones: consider med instead of low, after a real-phone check.** CPU-starved phones gain
   nothing from low (it isn't faster than med at 6× CPU), and med shows twice the people and
   trees. Before switching, open `?perf&notrack` on two or three real phones (an iPhone in X's
   in-app browser, a mid Android) at med and at low: if med's p95 stays under ~16 ms, make med
   the touch default and let the fallback catch the rest.
3. **Keep the memory rule** (≤ 4 GB → low): the heap peaks at 160 MB, but the GPU memory of a
   low-memory device is the likelier limit.

**Fallback thresholds**

4. **Keep 22 ms / 5 s** for ordinary slowness: it sits between the 60 Hz (16.7 ms) and 30 Hz
   (33 ms) frame steps, so a phone that holds 60 doesn't fall back and one stuck at 30 does.
5. **Add a fast path for very slow frames:** when the median over 2 s is above ~50 ms, drop at
   once (and settle 3 s instead of 10). On SwiftShader that reaches low in ~4 s instead of 23 s.
6. **Add a floor below low** for weak GPUs (the cost there is pixels): pixel budget ~0.6 MP,
   shadows off, the ink and FXAA post passes off, mist off. Low still runs at 153 ms a frame on
   SwiftShader; this is the lever that moves it.
7. Fix the comment in `quality.js` (rain doesn't drop live), or make rain drop with the rest.

**Cheapest wins**

8. **Stop the two production 404s:** fetch `audio/list.json` / `playlist.json` only in dev (or
   ship an empty list). Two requests and two console errors per visit, for nothing.
9. **Load time on slow CPUs** (6–12 s before Start): show progress on the Start button
   ("Building the lake… 60 %"), then build the far detail after the first frame or after Start
   (city blocks beyond ~1 km, mid-LOD trees, far ridges). Next step: a CPU profile of the 6× load.
10. **Frame time on slow CPUs:** profile the 6× run. Since the tier barely moves it, the cost is
    per-frame JavaScript that doesn't scale with the tier (likely the crowd update, chunk culling
    and the sound graph), not draw calls.
11. **Download** (already lean at ~500 KB): the data chunk (206 KB) is JSON inside JavaScript;
    shipping the terrain grids as binary (typed arrays) would cut its size and parse time; three.js
    (183 KB) doesn't tree-shake much further.

## Repeating it

```bash
npm run perf                                    # every profile x every tier, then the download (~25 min)
npm run perf -- --profile low-phone --tier med  # one run
npm run perf -- --no-build                      # reuse dist/
npm run perf -- --download-only                 # just the first-visit download
```

`tests/perf/run.mjs` builds, serves `dist/` on port 5181, runs the route and prints the tables;
the full results go to `tests/perf/report/latest.json` (git-ignored). It isn't part of
`npm run playtest`.
