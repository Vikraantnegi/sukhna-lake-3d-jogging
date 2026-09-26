# Sukhna: a sunrise jog around Sukhna Lake (plan)

Status: **approved plan; implementation is running locally** (Claude Code Desktop on the user's Windows machine). Overpass (overpass-api.de, fallback overpass.kumi.systems) and the AWS terrain tiles are reachable; no allowlist. Reference engine lives at `.ref/sakura-crossing/` (git-ignored, read-only): `git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing .ref/sakura-crossing`.

Source of truth: `docs/brief.md` (the user's brief, verbatim) + this file. Each new phase starts by re-reading both, then Progress and Working rules below.

## Progress

| Phase | Status | Branch | Commit |
|---|---|---|---|
| 0 Plan | done | `claude/charming-hawking-lsp0mx` (PR #1, merged) | `f2ffc9a` |
| 1 Scaffold + engine port | done | `phase-1-scaffold` (PR #2, merged) | `4c528c4` |
| 2 Real-data pipeline + `?flat=1` | **in progress** | `build` | — |
| 3 Planet layout + self-checks | — | `build` | — |
| 4 Jogger, camera, HUD, controls, touch | — | `build` | — |
| 5 NPCs, interactions, rowing, birds | — | `build` | — |
| 6 Time of day, mist, weather, signage | — | `build` | — |
| 7 Sound | — | `build` | — |
| 8 Quality tiers, verification, compare.md | — | `build` | — |

**Decisions made during the run** (newest last; each one is something the plan left open or that the data forced):
- (none yet)

**Notes for a fresh session:**
- Dev server: `npm run dev` → http://127.0.0.1:5178 (config in `.claude/launch.json`, name `dev`). Keep one running; check with the Browser pane's server list before starting another.
- `.ref/` is not in git. If it is missing, clone it with the command in the status line.
- **State after Phase 1:**
  - Vite 6.4 + three 0.180.0 (the only deps). `npm run build` passes.
  - Ported with MIT headers: `core/toon.js`, `post.js`, `outline.js`, `util.js`, `sky.js`, `textures.js` (helpers, plus Latin/Devanagari/Gurmukhi font stacks), `palette.js` (structure; colours from plan §2), and `world/planet.js`. New: `core/perf.js`, `world/index.js`, `main.js` (dev viewer, not the jogger).
  - `R = 320` is a **placeholder constant** in `src/world/planet.js`. Phase 2 replaces it with `(L_prom + L_join) / 2π` from the data.
  - `world/index.js` holds two **DEBUG pieces** (an equator strip, and a post every 100 m) that prove the bake. Phase 3 deletes them.
  - The sun is the reference's fixed `SUN_LOCAL` (in `main.js`). The real sun arrives in Phase 6.
  - Deviations from the reference, all documented in file headers:
    - `toon.js` drops the `flatShading` option, which r180 ignores with a warning; the look is unchanged.
    - `post.js` re-syncs near/far every frame.
    - The sky dome and clouds are rotated into the local surface frame. The reference only moved them, which breaks once you are a quarter-lap round.
  - Known artifacts left for Phase 3: faint ink on the bare sphere's 8 m facet creases near the horizon, and grazing-angle scratches right at the horizon. Phase 3's ground meshes cover this band.
  - Lesson: author long loop geometry pre-segmented (about 4 m). A single 2 km quad subdivides into slivers that the ink pass picks up.
- **Dev hooks:**
  - `window.__scene` exposes the scene objects.
  - `window.__shot(name, W, H, {pos:[x,0,z], yaw, pitch} | {orbit, tilt, dist})` writes `.shots/<name>.jpg` and returns the draw calls.
  - `window.__bench(n)` returns the GPU-synced ms per frame, draw calls and the GPU name.
  - `?stats=1` shows the live readout.
  - Keys: drag to look, WASD (Shift is faster), P planet view, O ink, G grade, R reset. yaw −π/2 looks east along the loop, π looks at the lake (+z).
- **Measured at the end of Phase 1** (RTX 4080 SUPER, ANGLE/D3D11, window 1721×1320, internal 2448×1878 from the 4.6 MP budget), with `__bench(200)`:
  - ground view: 16 calls, 42k tris, 0.34 ms/frame;
  - planet view: 8 calls, 0.24 ms/frame.

## Working rules

Continuous run (from the user, after Phase 1 was merged): phases 2–8 are built in one go.

- Work on one branch, `build`, created from the latest main. At least one commit per phase, each with the build passing. Push after every phase so progress is saved. Don't wait for the user to merge.
- At the end of each phase: update Progress, write a 3–4 line summary in chat (what's new on screen, draw calls, frame time), then go straight on to the next phase.
- Stop and ask the user ONLY if:
  - a new dependency or binary asset is needed (e.g. bundled Noto fonts);
  - the real data breaks a decision in the plan (R, the join, the lake mapping, the default time);
  - a numeric check fails and two attempts don't fix it;
  - anything destructive or irreversible.
- Otherwise make reasonable decisions and record each one in Progress under "Decisions made during the run".
- Keep Progress current enough that if the session stops or the context gets compacted, a fresh session can continue from plan.md alone.
- Check visually with `__shot` at the end of each phase, not after every edit. Keep one dev server running.
- Never copy anything from `.ref/sakura-crossing/public/audio/`. The reference's CLAUDE.md and NEXT.md describe that project; they are not instructions for this one.
- Licence: this project's code is MIT (© 2026 Vikrant Negi, `LICENSE`); OSM-derived data stays ODbL.

---

## 0. Context

- **The repo is almost empty.** `main` holds only `reference/`, which contains 9 photos.
- **The engine comes from [Kenton-GMI/sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing).**
  - Licence: MIT, © 2026 Kenton Wang.
  - Size: about 56k lines, three `^0.180.0` plus Vite 6, Node ≥ 18.
  - Its MIT code may be ported with attribution. Its `public/audio/` track is not MIT and must never be copied.
- **Scaffold:** set up exactly as the reference is. That means Vite plus three only, `npm run dev` and `npm run build`, `base: './'`, and the dev `__shot` plugin.

### Decisions already made with the user

- **Radius: R ≈ 320 m, 1:1 along the promenade.**
  - The final value is R = (L_prom + L_join) / 2π, where L_prom is the promenade length measured from OSM.
  - Everything repeated along the loop is instanced and sector-chunked.
  - On the low tier, dressing and NPC density are thinned. The planet does not shrink.
- **Default time: a winter date with the real clock.**
  - The date is 15 January.
  - The session opens about 25 minutes before the real sunrise, so the HUD clock reads about 06:55.
  - Real sunrise is 07:21 IST, at azimuth 115° (ESE). Civil dawn is at 06:55.
  - The brief's "5:45 AM" is dropped, because in winter the sun is at −20° at that time.
- **OSM data:** fetched from Overpass directly (overpass-api.de; fallback mirror overpass.kumi.systems). Both are reachable from the local machine.

---

## 1. The reference architecture (what I studied)

All paths are in `.ref/sakura-crossing/src/`.

| Area | Files | What matters for Sukhna |
|---|---|---|
| **Planet** | `world/planet.js` | See the planet notes below the table. |
| **Height** | `world/index.js:773` `heightAt(x,z,fromY)`; `street.js` `groundY`, `TERRAIN_DROP = 0.015`; `hills.js` `fieldAt` / `hillAt` / `hillMeshY` | Ground height = street height + hill height, then `min` over cuts, then `max` over platforms. The hill field is a 1.5 m triangular lattice (`NODES`), and it is the same surface for walking and for drawing. |
| **Hills** | `world/hills.js` | `SUMMITS` → `keepAt` masks → a slope-limiter pass → a roughness pass → trail benching. `hillSafety(world)` must report worst-built = 0.00. A DEM plugs in at pass 1 (`:1615`). |
| **Perched lake** | `world/lakeform.js`, `world/lake.js` | See the lake notes below the table. |
| **Dam** | `world/lakeroad.js` | The dam lives in the height field (`DAMS`, `damAt`). `buildDam` adds riprap (520 merged stones), kerbs, a spillway, an intake and a gauge. Reusable pieces: `groundRail`, `hillLine`, `finger`. |
| **Lakeside** | `world/kohan.js` | `timberDeck` (pier and jetty with a platform), `boardwalk`, `makeBoat`, lamps, benches, a boat station and a pedal boat. |
| **Loop rule** | `world/railway.js:29-38`, `canal.js:42-46` | "The structure runs the whole way round; the dressing appears only where the district is." |
| **Train** | `world/train.js:376-430` | Baked once on the rail, then turned each frame by `T(C)·Rz(−x/R)·T(−C)`. Wheels sit on a `planetRigid` hub and spin on inner pivots. |
| **Look** | `core/toon.js` | `MeshToonMaterial` patched through `onBeforeCompile`: the ramp bands are tinted violet, `uShadowTint` 0x6c5f8c, and materials are cached. |
| | `core/post.js` | A HalfFloat target plus a depth texture. The ink pass is the second difference of linearised depth (it fades over 40–98 m). Then a grade pass (split-tone, lift, saturation, vignette, sRGB), then FXAA. It supersamples to a pixel budget of 4.6 MP. |
| | `core/outline.js` | Inverted-hull outline for hero props, one extra draw call each. |
| | `core/palette.js` | `PAL` is one fixed look. |
| | `core/sky.js` | A gradient dome and 22 static clouds. `buildDistantHills` exists but is never called. There is no sun disc. |
| **Canvas2D signage** | `core/textures.js` | `make`, `cached`, `fitText`, `centered`, all private. The font stack is Japanese only. |
| **Utilities** | `core/util.js` | `bake(parts)` merges per material bucket, plus `trs`, `rngKit`, `shadowify` and `sstep`. There is no instancing helper; instancing is done inline. |
| **Player** | `core/player.js` | First person only, on the flat plane. Axis-aligned box collision against `world.colliders`, with x speed divided by `cos(z/R)`. `applyCamera` works from `basisAt`. Walk 2.55 m/s, run 5.1 m/s, look sensitivity 0.0022. |
| **HUD** | `core/hud.js` | Start card, prompt, toast, hint (`H` fades only the hint), coordinates (`C`). |
| **Audio** | `core/audio.js` | An mp3 playlist on an `HTMLAudioElement`, with no WebAudio. |
| **Main loop** | `main.js` | Sets up the lights, and `seatLight` re-seats them in the player's tangent frame each frame. Handles the P orbit, `__scene`, and `__shot`. |
| **Parametric vehicles** | `world/vehicles.js` | A kind is a row in `SPEC`. `makeVehicle` derives every part; `panel` draws between two points; `emit` bakes per material. |
| **Trees and particles** | `world/trees.js`, `world/petals.js` | Districts return tree spots, and each species is merged into one trunk mesh plus instanced canopies. Petals are instanced quads with `depthWrite: false`. |
| **Dev screenshots** | `vite.config.js` `frameGrabber` | `POST /__shot` writes `.shots/<name>.jpg`. `window.__shot(name,W,H,{pos,yaw,pitch,orbit,…})`. Because the browser pane does not composite, animation has to be stepped by hand. |

**Planet notes (`world/planet.js`):**
- The world is built flat, then bent onto the sphere once by `bakeToPlanet(root, {maxEdge:4})`. `R` drives `CIRCUMFERENCE`, `CENTER=(0,−R,0)` and `horizonFor(h)`.
- The mapping is equirectangular: `x`→longitude (`x/R`, wrapped) and `z`→latitude (`z/R`). The loop is at z = 0.
- Helpers: `positionAt`, `basisAt`, `frameAt`, `flatAt`, `wrapX`, `wrapDelta`.
- `subdivideLongEdges` bisects triangles until every edge is ≤ `maxEdge`, keeping material groups.
- The bake treats objects three ways:
  - `planetRigid` groups are re-seated as a whole, not bent.
  - Instances are re-seated one by one and left unculled.
  - Everything else is bent and gets exact frustum culling.
- The sphere is `Icosahedron(R, 30)` with radial normals. It never casts shadows.
- The latitude band: x shrinks by `cos(z/R)`, and the player's z is clamped to ±0.24·C.

**Lake notes (`world/lakeform.js`, `world/lake.js`):**
- The water is a flat surface at `groundY + LEVEL`. The shoreline is the contour where `field = LEVEL`, and depth is `LEVEL − fieldAt`.
- `SHORE` is a polygon with a treatment on every vertex. `lakeNear` gives the signed distance to it.
- `lakeGround()` is the one hook `hills.js` calls. The rim is built into the ground, so the lake cannot spill.
- Water layers are drawn by marching squares (`contourFill`) as unlit `flat()` layers. Reflections are merged slabs, and ripples are a `planetRigid` hub with inner pivots.
- Checks (none run automatically; you call them from the console):
  - `lakeLeakCheck`: flood fill from inside the lake; passes when `escaped < 30`.
  - `lakeSpillCheck`
  - `lakeStats`

**Performance rules (measured in the reference's `CLAUDE.md`):**
- The scene is limited by draw calls: about 1 400 calls take 11 ms, and about 3 050 take 20 ms. Triangles and fill rate barely matter.
- Merge per material with `bake`, and instance anything repeated.
- Trees are merged world-wide at the end.
- Bent meshes are frustum-culled. Switching that off costs about 8 ms.
- Thin or transparent sheets get `depthWrite: false` and `noOutline`.
- Canopies never receive shadows.

### What the reference lacks and Sukhna needs

- People and NPCs. The reference has none, by design.
- A visible player body and a third-person camera.
- Time-of-day cycling. The reference's sun, sky, palette and grade are all fixed.
- Weather (rain, fog).
- Auto-move.
- A jogging HUD and stamina.
- A sun disc and sky that react to the sun.
- Ridgeline rings.
- Touch controls.
- WebAudio ambience.
- Quality tiers.
- Indic fonts.
- URL parameters.
- A draw-call and frame-time readout.
- Automatic self-checks.
- Horizon culling. Visibility on a small planet is limited by the curve, and the reference never exploits that.

---

## 2. Reference photos: the look list

**Real photographs, full weight:**
- r1 `23913875383_…_b.jpg`: garden end at sunrise.
- r2 `Sukhna_Lake_in_Chandigarh.jpg`: bright winter promenade. This is the key reference.
- r6 `images (1).jfif`: sculls at sunrise.
- r7 `sukhna-lake (1).jpg`: boat club jetty.
- r8 `…attr-hero.jfif`: the dam at low sun.
- r9 `sukhna-lake.jpg`: fisheye aerial.

**Probably AI-generated or heavily stylised (mood only; never layout or detail):**
- r3 `abef7c…690x460.jpeg`
- r4 `images (2).jfif`
- r5 `images.jfif`: palms under a starfield.

### What I will reproduce (hex values are sampled estimates, tuned in grade)

**The promenade (r2, r8)**
- **Surface:** a wide, pale-grey asphalt walk (#8e9096) with no kerb paint.
- **Lakeside edge:** there is no metal railing on the dam. The edge is a low, flat-topped parapet about 0.45 m high and about 1.2 m wide, made of rounded grey river cobbles set in darker mortar (stones #9a978d / #b9b3a4, mortar #6f6b63). People sit on it, so it will be sittable.
- **Embankment:** below the parapet, a grassed slope of stone pitching falls about 1:2 to the water (grass #7fa04f, stones #a5a39a). At the waterline sits a pale drawdown band of cream boulders (#d8cdb5).
- **Land side:** a grass verge with royal palms (pale grey trunks #bdb8ad) and dense broadleaf and eucalyptus trees (#3f5a2e / #5f7a3a).

**Gardens and the plaza (r1)**
- Terracotta interlocking pavers (#c77d5e / #b0664a).
- Flower beds.
- A low dark-green chain-link fence (#2f4a33). This is the only "railing" seen.
- A thatched gazebo (#5a4a3a).
- Carved grey stone seats and sculptures.
- A blue signboard with white text (#2f8fcf).
- Red-brown wooden benches on dark frames (#8a4a32).
- A small white or grey dustbin.

**Boat club (r7, r9, r2)**
- A jetty edge of grey-blue pavers (#8ea0b3) with a red-pink border pattern.
- A long row of pedal boats in blue #3f7fd0, sky-blue #62a8e6, yellow #f2c230, red #d23b35 and orange #f08a2e, some with swan or dragon heads. These will be stylised swans; no brands.
- A pink-red launch (#d84a6a).
- A white gateway frame with red posts (r2, left).

**Sculls and rowing (r6)**
- Slim white shells, low in the water, rowers as dark silhouettes against the glare.

**Water**
- At dawn: silver-peach, carrying the sun's glitter path (r1, r6).
- In bright morning: steel grey-mauve (#8c96a6) with long treeline reflections (#5d6b4a) (r2).
- At low sun: turbid khaki (#c9b27a) (r8).

**Sky and hills**
- **Sunrise:** the sun is a hard disc (#ffd55a) in orange haze (sky #e7a35a → #d9a066). At dawn the far shore shows only as a treeline in haze and the hills disappear (r1).
- **Hills in clearer light:** layered, low-contrast blue-grey ridges (#7d8aa3 near, #a9b3c6 far), as in r6 and r7.
- **Bright morning:** zenith #6fa3f5 fading to a very pale horizon #c9e0f7 (r2).

**Not confirmed by any photo (kept generic and flagged in code):**
- Lamp posts: a simple tall pole with a lantern head.
- Distance markers: invented, stylised.
- The statue: a generic seated figure on a plinth, unless OSM names it.
- The lake-club building.
- Modernist concrete on the city side: stylised, not a copy of any real building.

---

## 3. Real-data pipeline (`scripts/sukhna/`, run at build time, never at runtime)

The scripts are plain Node 18 `.mjs` files with **no new dependencies**:
- PNG decoding: a small decoder built on `zlib`.
- Sun position: the NOAA equations in `src/core/sun.js`, shared with the runtime.

| File | Does |
|---|---|
| `config.mjs` | The bounding box (30.72–30.77 N, 76.79–76.84 E; tightened after the first fetch), the origin (the promenade's midpoint), the date, the simplification tolerances, and manual overrides. Each override gives an OSM id and a `source: 'osm' \| 'photo' \| 'generic'` for landmarks whose tags are missing. |
| `fetch-osm.mjs` | Sends `overpass.ql` to overpass-api.de (on failure or timeout, retries against overpass.kumi.systems) and saves the result to `raw/osm-<bbox>-<date>.json`. It never overwrites an existing file; `--refresh` forces a fetch. |
| `overpass.ql` | See the query contents below this table. Output is `out body geom`. |
| `fetch-terrain.mjs` | Downloads Terrarium tiles (`elevation-tiles-prod`, z11–12) for about 30.70–31.05 N, 76.70–77.15 E, which covers the Shivalik front and the Morni and Kasauli ridges. It saves them to `raw/terrarium/z/x/y.png`. |
| `lib/png.mjs`, `lib/terrarium.mjs` | Decode a tile; height = (R·256 + G + B/256) − 32768. |
| `lib/project.mjs` | Converts lat/lon to local ENU metres about the origin (the local-tangent formula, which is accurate to under 1 cm at this size). Also holds the Douglas–Peucker simplification and the curvilinear (s, d) mapping described in §4. |
| `build-data.mjs` | Reads `raw/*` and writes **`src/data/sukhna.data.json`** (target under 300 KB). See the build steps below this table. |
| `README.md` | How to re-run the pipeline, provenance, and licences. |

**What `overpass.ql` pulls from the bounding box:**
- `natural=water` / `water=lake` (ways and relations), and `place=islet`.
- `waterway=dam`, `man_made=dyke|embankment|pier|breakwater`, `leisure=slipway|marina`.
- `highway=footway|pedestrian|path|cycleway|service|track|steps`.
- `amenity=parking|boat_rental|cafe|toilets|bench|waste_basket|drinking_water`.
- `leisure=park|garden|golf_course|pitch`, and `golf=*`.
- `building=*`.
- `landuse=forest|grass|recreation_ground`, and `natural=wood|scrub|tree_row|wetland`.
- `node[natural=tree]`.
- `tourism=attraction|viewpoint|artwork`, `historic=memorial`, and any named node.

**What `build-data.mjs` does:**
1. Projects everything, then picks and chains the promenade: footway or pedestrian ways that lie on or along the dam (`waterway=dam`/`man_made=dyke`) next to the water polygon's dam edge. The chain can be pinned with way ids in the config.
2. Measures and records these facts:
   - `promenadeLength`
   - lake area, perimeter, and extents
   - dam length
   - each landmark's **arc position s** along the promenade, and the distance between each consecutive pair
3. Sets R = (L_prom + L_join) / 2π, with L_join about 40 m (see §4).
4. Maps every feature into planet authoring coordinates (x, z) and simplifies it: 1 m tolerance near the promenade, 4 m in the far field.
5. **Hill field:** resamples the DEM into the (x, z) lattice of the hill band (§4) as a `Float32` grid, stored base64 in the JSON.
6. **Ridgelines:** ray-marches the DEM from 5 viewpoints on the dam over 0–360° in 1° steps, as the elevation-angle horizon profile. It splits the result into near, mid and far layers by distance, and stores them as azimuth → angle arrays per layer. `sky.js` draws these as rings.
7. **Sun:** stores lat/lon, the default date, and that day's precomputed sunrise, sunset, civil dawn and preset times. The runtime computes the full sun path from `core/sun.js`, so T can scrub to any time.
8. **Report:** prints a summary (lengths, scales, the distortion table from §4, a fold check) and writes it to `scripts/sukhna/report.md`.

**Licensing and attribution:**
- **OSM data is ODbL.** `sukhna.data.json` is a derivative database, so the README, `THIRD_PARTY_LICENSES.md` and the start card will carry "© OpenStreetMap contributors, ODbL".
- **Terrain tiles** carry the attribution their documentation asks for: the Mapzen/AWS terrain tiles, and SRTM and other sources.

**Verification:**
- `?flat=1` puts a flat plane beside the planet. It shows:
  - (a) the OSM data in real ENU metres, as polygons and lines;
  - (b) the same data in planet authoring coordinates (x, z);
  - landmark pins and the join marked on both, with scale readouts.
- With both side by side, both the projection and the mapping can be checked by eye.

---

## 4. Planet sizing and mapping

**Radius:** R = (L_prom + L_join) / 2π. If L_prom is about 2.0 km, then R is about 325 m and the circumference C is about 2.04 km.

- A lap at jog speed (3.0 m/s) takes about 11 minutes.
- **x maps 1:1 to arc length along the real promenade.** Landmarks sit in real order at their real distances. Scale factor s_x = 1.000.
- The report prints the exact figure.

**The join:**
- The real promenade is not a loop. It runs from the west end (the lake club, the entrance plaza and the boat club) to the east end (the regulator, and the garden with the statue).
- The loop closes at **x = C − L_join … C: a stylised stretch of about 40 m after the east-end garden.** There the walkway runs through a dense tree screen and a **wooded headland** reaches about 45 m into the lake. From the promenade you therefore never see the east and west shorelines meet.
- This is documented in `docs/plan.md`, marked in `?flat=1`, and noted in the code comment at the join.

**Cross-section in latitude z** (a "perched" dam, following the reference's approach; the heights are stylised and tuned against the DEM and the photos):

| z (m) | What |
|---|---|
| −∞ … −12 | City side, at datum 0: a green belt, then the golf course, the plaza, parking and stylised modernist concrete. Positions come from OSM (x) with compressed d (below). |
| −12 … −6 | Downstream face of the dam, grassed, 1:2. |
| −6 … +4 | **The promenade on the crest**, at +5.5 m. Real width from OSM if tagged, otherwise 8 m, plus a 1.2 m parapet on the lake side. **The equator, z = 0, is the walkway centreline.** |
| +4 … ~+12 | Stone-pitched embankment down to the water. `LEVEL` is +3.0 m, so the parapet top sits about 3 m above the water. |
| +12 … ~+190 | **The lake.** It is a ring band all the way round, broken only by the join headland (which ends at z ≈ +45). |
| ~+190 … +330 | Far shore, forest, then the **DEM hill field**: the Shivalik front, compressed in z and exaggerated vertically so its tops clear the horizon. |
| > +330 … pole (+503) | Bare forest and hill field. Nothing important goes here. |

**Mapping from real coordinates to (x, z):** a curvilinear frame (s, d) around the promenade spine.

- s = arc length along the spine, which gives x = s.
- d = signed normal distance (positive toward the lake), which gives z = f(d).
- f is 1:1 for |d| ≤ 60 m. That covers the embankment, jetty, near water, plaza, parking and garden.
- Beyond 60 m, f is a smooth monotone compression: the real far shore (d ≈ 1.2–1.8 km) lands at z ≈ 170–190, and the city side's golf course lands at z ≈ −80 … −160.
- Near the spine, the exact promenade polyline is used. Further out the spine blends into a heavily smoothed version, so the normals never cross.
- **The script checks that no fold occurs** (the Jacobian sign over the whole grid) and fails the build if one does.
- Trees, buildings and props are **re-seated rigidly**, so they never look squashed. Only the ground and water meshes carry the cos(z/R) squeeze, and on flat water that squeeze cannot be seen.

**How much of the lake fits in the low-distortion band** (lake band z = 18…190):

| | R = 320 | R = 240 |
|---|---|---|
| Circumference C | 2 011 m | 1 508 m |
| z inside 5% compression | ≤ 102 m | ≤ 76 m |
| z inside 10% compression | ≤ 144 m | ≤ 108 m |
| Lake area inside 5% | **51%** | 37% |
| Lake area inside 10% | **75%** | 57% |
| x-squeeze at the far shore (z = 190) | 0.83 | 0.70 |
| Water horizon from the promenade (eye 5.6 m above water) | 60 m | 52 m |
| Tops of 15 m far-shore trees visible to | 158 m | 137 m |
| Tops of 60 m hills visible to | 256 m | 222 m |

So at R = 320:
- All near-shore action sits under 2% compression: the rowing lane at z = 55, the jetty, the reeds and the birds.
- The far shore sits just over the curve, so tree tops and hills peek above the bent water. That is the "planet curve toward the horizon" look.
- The real Shivaliks (5–25 km away) are ridgeline rings in `sky.js`. They sit at their true azimuths, so they are on the correct side relative to the sun.

**Sun and ridges in the local frame:**
- `seatLight` (from the reference) re-seats the sun in the player's tangent frame each frame.
- I extend it so that at the player's x, the local "east" axis is aligned with the **real promenade tangent at arc length s = x**.
- So the real sun azimuth and the ridgeline azimuths turn relative to you exactly as they would on the real curved dam.
- At the start position, sunrise at 115° appears over the east end of the lake.

**The rowing eight (this world's train):**
- It rows a constant-latitude lane at z = +55. That lane sits outside the headland tip and within 2% compression.
- It uses the train's own trick: the hull is baked once, then rotated about the planet's polar Z axis each frame.
- The oars sit on `planetRigid` hubs with inner pivots, swinging at 22 strokes per minute.
- Its speed is 4.6 m/s. The lane is 2 000 m, so a lap takes about 7.2 minutes. Because that is faster than a jog, it passes you regularly.
- Its wake is instanced V-shaped foam quads that fade out.
- Single sculls take lanes at z = 30–90 at varied speeds.
- Pedal boats are runtime objects, re-seated each frame in the same way as the reference's `ebike.js`. They stay inside a box off the jetty and only appear after 08:30.

---

## 5. Port, adapt, or new

Target layout mirrors the reference: `src/core`, `src/world`, plus `src/people`, `src/data` and `scripts/sukhna`.

### Port as-is (MIT header kept, credited)

- `core/toon.js`
- `core/post.js`
- `core/outline.js`
- `core/util.js`
- `world/planet.js`: port the mechanics; R comes from the data.
- `world/trees.js`: `buildGrove`, shrubs and palms. Palms are a new form in the same style.
- The `__shot` plugin in `vite.config.js`, plus `window.__shot`.

### Adapt

| File | Change |
|---|---|
| `core/palette.js` | Becomes the base palette **plus time-of-day keyframes** (pre-dawn, sunrise, golden hour, bright) for sky, fog, lights, grade, water and ridges. A `tod` registry holds every material or uniform whose colour depends on the time, so the flat and cel caches stay valid. |
| `core/sky.js` | Adds a sun disc, a horizon glow toward the sun, stars before dawn, drifting cel clouds, and **ridgeline rings** built from the data. |
| `core/textures.js` | Export `make`, `cached`, `fitText` and `centered`. Add `signTex({lines:[{text,script:'latn'\|'deva'\|'guru'}]})` with three font stacks (below). Indic text gets no per-character tracking. |
| `core/player.js` | Becomes `core/jogger.js`: walk / jog / sprint states, stamina, V auto-jog, and flat-plane movement with collision kept. |
| `core/hud.js` | Keeps the prompt and toast. Adds the bottom hint bar (§6) and the jog HUD. H hides both. |
| `core/audio.js` | Becomes WebAudio `core/sound.js` (§6). |
| `world/lakeform.js` | `SHORE` comes from the mapped OSM shoreline. The treatment rows (bank, dr, dm, cr) are per stretch: embankment, natural shore, jetty. |
| `world/lake.js` | High tier: a new water `ShaderMaterial` with a fresnel sky gradient, quantised cel ripples, a sun-glint path and a mist tint. Low tier: the reference's flat layers. |
| `world/hills.js` | The lattice is fed by the DEM grid. The slope limiter is kept; roughness is lighter. `hillSafety` is kept. |
| `world/lakeroad.js` | Becomes `world/promenade.js`: the equator structure (§6). |
| `world/kohan.js` | Becomes `world/boatclub.js`: `timberDeck` jetty, `makeBoat`, and pedal boats as a parametric table. |
| `world/vehicles.js` | Its pattern is reused for parked scooters and cars at the plaza (a row of numbers per type), and for human bodies (§6). |

### New

- **Core:** `core/sun.js` (NOAA), `core/timeofday.js`, `core/weather.js`, `core/quality.js`, `core/camera.js` (third-person boom plus first person), `core/touch.js`, `core/perf.js` (draw calls and frame time, `?stats=1`).
- **World:** `world/index.js` (assembly, sectors, horizon culling), `world/promenade.js`, `world/plaza.js`, `world/garden.js`, `world/cityside.js`, `world/rowing.js`, `world/birds.js`, `world/mist.js`, `world/flat.js` (`?flat=1`), `world/checks.js`.
- **People:** `people/body.js`, `people/types.js`, `people/gait.js`, `people/crowd.js`, `people/interact.js`.
- **Data and scripts:** `src/data/sukhna.data.json` and `scripts/sukhna/*`.
- **Docs:** `THIRD_PARTY_LICENSES.md`, `README.md`, `docs/compare.md`.

---

## 6. System designs (the parts that are new)

### Promenade: the equator structure

These run the whole way round the loop:
- the asphalt walk;
- the cobble parapet;
- the grass verge;
- the embankment pitching;
- the drawdown band.

**Instanced parts, cut into 16 sectors (about 125 m each):**
- The parapet is laid as 2 m instanced blocks.
- Lamps, benches, bins, markers, reeds, palms and trees are instanced per sector.
- The loop is divided into sectors because three r180's `InstancedMesh.computeBoundingSphere` includes the instances, so each sector gets real bounds and **can be culled**. The reference never culls instances.

**Horizon culling:** a sector is hidden when its angular distance from the camera exceeds the horizon angle plus an allowance for object height. On this planet the curve hides most of the loop, and this turns that into saved draw calls.

**Dressing appears only in the districts:**
- steps down to the water at 3 or 4 real-ish spots;
- benches facing the water;
- dustbins;
- lamps;
- **a 100 m distance marker**, with a code comment saying it is stylised and not real;
- trilingual signs.

The **low tier thins** benches, trees and reeds per sector, following a density table.

### Landmarks (real order, real s)

The **west end** comes first:
- the lake club, built generically;
- the **entrance plaza**: terracotta pavers, a gateway frame, kiosks (a chai and nimbu-paani stall, a vendor), and parking with parametric scooters and cars;
- the **boat club jetty**, with its pedal-boat row and launch.

Then:
- the **long open bund**;
- the **regulator** (gates and a gauge, from the reference's `lakeroad.js` works);
- the **garden with the statue**, at the east end: a gazebo, chain-link fence, flower beds and stone seats (r1);
- then the join.

The golf course, green belt and modernist blocks sit on the city side at their OSM positions. The modernist blocks are brise-soleil walls and exposed-concrete (béton brut) pavilions, stylised.

### Jogger (`core/jogger.js`, `core/camera.js`, `people/*`)

**Movement:**

| Mode | Speed | Pace |
|---|---|---|
| Walk | 1.5 m/s | — |
| Jog (default, W) | 3.0 m/s | 5:33 /km |
| Sprint (Shift) | 5.2 m/s | 3:12 /km |

- Speed changes are smoothed with an exponential approach.
- Releasing W decays to a walk, then to a stop.

**Stamina (0–100):**

| Mode | Rate |
|---|---|
| Sprint | −9 /s |
| Jog | +1.5 /s |
| Walk | +10 /s |
| Chai | set to 100 |

- Breathing is audibly heavier below 30.

**Camera:**
- A third-person boom in the player's tangent frame, with a lagged slerp of the surface basis so it follows the planet's curve.
- A gentle bob tied to the jog cadence.
- The mouse wheel zooms the boom from 5.5 m down to 0, which is first person. In first person the body is hidden.
- Mouse look works through pointer lock, as in the reference.

**V (auto-jog):**
- Follows the promenade's centre lane.
- Steers smoothly around NPCs with a lateral potential field and a lookahead of 8 m.
- The camera slowly orbits toward the lake side.
- Any WASD input cancels it.

**Body:** the player uses the same parametric body as the NPCs, with an inverted-hull outline (the only hero outline). Outfit presets are chosen on the start card:
1. t-shirt and track pants;
2. patka, t-shirt and shorts over tights;
3. hoodie and joggers.

**Gait (`people/gait.js`):** procedural and phase-driven.
- Stride length and cadence scale with speed.
- The arms swing opposite the legs.
- There is a vertical bounce, a forward lean that grows with speed, and a slight twist.

### NPCs (`people/body.js`, `types.js`, `crowd.js`)

**A type is a row of numbers:**
- height;
- shoulder and hip width;
- girth;
- limb ratios;
- posture (stoop);
- gait (cadence, stride, arm swing, and "hands behind the back");
- top (tee / kurta / tracksuit / hoodie / shawl);
- bottom (track pants / salwar / trousers / tights);
- headwear (none / cap / patka / turban / dupatta / monkey cap);
- a colour table index.

**Rendering:**
- **Instanced by part.** About 16 part meshes (torso variants, pelvis, upper and lower arm and leg, hands, feet and shoes, head, each headwear), each one `InstancedMesh` with `instanceColor`.
- **The whole crowd costs about 16 draw calls, however many people there are.**
- Parts use the `cel()` material. Only the player gets a hull outline.

**LOD:**

| Distance | Treatment |
|---|---|
| < 45 m | Full forward kinematics, updated every frame. |
| 45–110 m | 6 parts, updated at 20 Hz. |
| Beyond the horizon | Culled. NPCs are simulated on the flat plane but not submitted. |

**Pathing:** lane-based on the equator.
- Each NPC has an x, a lane z, a speed and a direction.
- Joggers overtake by changing lanes when there is a gap. Some of them overtake the player.
- The plaza and garden have small waypoint graphs.
- Stationary groups stand at anchor spots: yoga on mats on a grass patch, the laughter club in a circle, a stretcher at the parapet, bench sitters, the photographer with a tripod at the steps, the chai kiosk vendor.
- A dog walker (with a small parametric dog) and college students jogging in pairs are also included.

**Density by time:** relative to the actual sunrise. Pre-dawn is at 0.3, the peak runs from sunrise −10 minutes to +70 minutes, and it thins after that. Fog multiplies density by 0.45 and puts everyone into a shawl or monkey cap.

| Tier | Maximum NPCs |
|---|---|
| High | 160 |
| Med | 100 |
| Low | 50 |

**Water check:** `npcWaterCheck()` in `world/checks.js` runs automatically in dev and prints its result.
- It simulates 20 minutes at 0.5 s steps, sampling every NPC, every lane and every anchor.
- It **asserts** that `lakeDepthAt ≤ 0` and that each point is at least 1 m from the waterline, and reports the worst value.
- The same file runs `lakeLeakCheck` and `hillSafety` on startup in dev.

**Interactions (E), short and non-blocking:**
- **Greet:** "Good morning!", "Sat Sri Akal ji", "Namaste ji", shown in a small speech bubble.
- **Chai at the kiosk:** the player holds a cup for 4 s and stamina refills.
- **Join yoga:** the player holds a pose for 5 s.
- **Bench:** the player sits, and the camera settles on the lake view until they move.
- **High-five a passing jogger.**

**Birds (`world/birds.js`), about 8 draw calls in total** (instanced bodies plus wing pairs):

| Tier | Birds |
|---|---|
| High | 140 |
| Med | 80 |
| Low | 35 |

- Egrets and cormorants on posts and at the water's edge.
- Ducks paddling.
- Crows and pigeons on the parapet.
- Flocks that lift off the water and wheel around when the player comes close, then settle again.
- A parakeet flock that periodically crosses overhead.

### Morning, weather and signage

**T** jumps between presets, and time also runs at 4× real speed:

| Preset | Time |
|---|---|
| Pre-dawn | 06:55 |
| Sunrise | 07:21 |
| Golden hour | 07:45 |
| Bright | 09:15 |

- The keyframes are keyed to **sun elevation**, not clock time. They drive the sky, lights, shadow tint, grade uniforms, fog, water and ridge haze.
- **Mist** (`world/mist.js`): soft instanced sheets over the water plus low haze on the hills. Its opacity falls as the sun climbs and is gone by about 10° of elevation.

**K** cycles clear → rain → winter fog:
- **Rain:** instanced streaks around the camera with `depthWrite: false`, more ripples, a desaturated grade, and a rain sound bed.
- **Fog:** `scene.fog` 6–70 m, with the ink fade distances pulled in to match, a muted palette, fewer NPCs, and shawls.

**Signs:**
- Canvas2D, in English, Hindi and Punjabi.
- Content: "Sukhna Lake / सुखना झील / ਸੁਖਨਾ ਝੀਲ", the boat club, "Please keep the lake clean", distance markers, and the kiosk's "Chai · Nimbu Paani". No brands.
- Font stacks, all system fonts: Latin `'Segoe UI','Helvetica Neue',Arial,sans-serif`; Devanagari `'Noto Sans Devanagari','Nirmala UI','Mangal','Kohinoor Devanagari',sans-serif`; Gurmukhi `'Noto Sans Gurmukhi','Nirmala UI','Raavi','Gurmukhi MN',sans-serif`.
- Textures are drawn after `document.fonts.ready`.

### Sound (`core/sound.js`, WebAudio, all generated in code, M toggles)

The layers:
- birdsong (FM chirp voices whose species mix changes with time of day);
- water lapping (filtered noise, with the envelope tied to the distance to shore);
- the oars (a catch thunk plus a splash, in sync with the eight's strokes) and **the cox's calls**;
- footsteps and breathing tied to cadence and stamina;
- wind in the trees (low-passed noise with gusts);
- a distant scooter horn from the city side;
- the laughter club (formant "ha-ha" bursts);
- chatter as you pass (formant babble).

How it is mixed:
- Everything is spatialised with `PannerNode`s, crossfaded, and randomised so no loop repeats audibly.
- **Honest limitation:** synthesised speech isn't intelligible. The Punjabi, Hindi and English chatter and the cox's calls are therefore shown as small text bubbles over the formant babble.
- CC0 recordings can be dropped in later. Each would be listed in `THIRD_PARTY_LICENSES.md`.

### Controls, HUD and quality

**Hint bar:** fixed to the bottom, full width, `rgba(14,16,22,.58)`, with a 1 px top line in `rgba(255,255,255,.16)`, grey text `#b9bdc7` at 12.5 px, centred. It reads exactly:
`WASD jog · Shift run · E interact · V auto · T time · K rain · P planet · M sound · H hide`

**Keys:**
- P orbits out to the whole-planet view, as in the reference, scaled with R. P again returns.
- H hides the hint bar and the HUD.
- Esc releases the cursor.
- The dev keys C, R, O and G stay, but are left out of the hint.

**Jog HUD (top left, compact):**
- distance
- pace (min/km)
- elapsed time
- laps
- a stamina bar
- the clock and the preset name

**Touch (`core/touch.js`):**
- A left virtual stick: jogs, and pushing to the rim runs.
- Dragging on the right half looks around, and pinching zooms.
- A button row for E, V, T, K, P, M and H.

**Quality tiers (`?q=low|med|high`, auto-detected: mobile or low-memory devices start on low):**

| | Pixel budget | Shadows | Water | Dressing | NPCs | Birds |
|---|---|---|---|---|---|---|
| High | 4.6 MP | 2048 | shader | 100% | 160 | 140 |
| Med | 2.8 MP | 1024 | shader | 75% | 100 | 80 |
| Low | 1.3 MP | 1024 at a 40 m range | flat layers | 45% | 50 | 35 |

- A simple fallback drops one tier if frame time stays above 22 ms for 5 s.

**Page metadata:**
- Title: "Sukhna — a sunrise jog around Sukhna Lake".
- A meta description.
- `lang="en"`.

---

## 7. Commits (one per phase)

| Phase | Contents |
|---|---|
| 0 | **Plan (this session):** `docs/plan.md` and `.gitignore`. |
| 1 | Scaffold and engine port, `THIRD_PARTY_LICENSES.md`, README credit, `__shot`, an empty planet rendering. |
| 2 | The real-data scripts, their raw data, `sukhna.data.json`, the report, and `?flat=1`. |
| 3 | Planet layout: promenade, lake, hills, ridges, city side, landmarks, vegetation, and the self-checks. |
| 4 | The jogger, camera, jog HUD, hint bar, controls and touch. |
| 5 | NPCs, interactions, the rowing eight and sculls, pedal boats, and birds. |
| 6 | Time of day, mist, weather and signage. |
| 7 | Sound. |
| 8 | Quality tiers and performance, metadata, verification, `docs/compare.md`, and the final summary. |

---

## 8. Verification (Phase 8, actually run)

**Pages to open (dev server and preview):**
- `npm run dev`, then open `/`, `/?flat=1`, `/?q=low` and `/?stats=1`.
- `npm run build && npm run preview` must pass.

**Screenshots:**
- Taken in the Claude Desktop Browser pane (a real browser on the user's GPU) by calling `window.__shot` from fixed camera spots that match the photos r1, r2, r6, r7, r8 and a bench view. `__shot` writes `.shots/<name>.jpg` through the dev server; the chosen frames are copied to `docs/shots/`.
- No Playwright. It is installed only if a phase really needs automated screenshots, and only after asking the user.
- Each spot is shot at pre-dawn, sunrise, bright morning and in fog.
- They go into `docs/shots/` and are laid out beside the matching `reference/` photo in `docs/compare.md`, with a list of what still doesn't match.

**Numeric checks, printed and recorded:**
- `lakeLeakCheck`: `contained`.
- `hillSafety`: worst-built = 0.00.
- `npcWaterCheck`: 0 violations.
- The mapping's fold check.

**Performance:**
- `renderer.info.render.calls`, triangle count, and frame time per camera spot and tier.
- Timings come from the user's real GPU and are reported as real numbers: `window.__bench(n)` renders n frames and forces GPU completion with a 1-pixel `readPixels`, so the figure includes GPU time, not just CPU submit time. The GPU name (from `WEBGL_debug_renderer_info`) is recorded next to every figure.
- Targets:

| Tier | Draw calls | Frame time |
|---|---|---|
| High | ≤ 900 | ~16 ms on a mid-range laptop |
| Low | ≤ 350 | — |

**Final summary:** what was built, the file list, what is real-data or photo-based versus stylised or invented, known limitations, and next steps.

---

## 9. Risks

1. **OSM gaps.** The promenade may be mapped as several ways or tagged inconsistently, and landmarks may be missing tags.
   - Mitigation: overrides in `config.mjs` with provenance. The report lists everything that is not from OSM.
2. **The mapping could fold far from the dam.** Mitigation: blend to a smoothed spine, and have the fold check fail the build.
3. **Visibility on a small planet.** The water horizon is only about 60 m away, so the far shore and hills rely on elevation and ridge rings. Their vertical exaggeration will be tuned with screenshots.
4. **Retrofitting time of day onto cached materials.** Mitigation: the `tod` registry. Without it, colours stay stale.
5. **Draw calls grow with the 2 km loop, NPCs and birds.** Mitigation: sectors, horizon culling, part-instanced crowds, and a hull outline on the player only. Draw calls are counted per phase.
6. **The toon patch matches a line of three's shader source.** It would silently fail on another three version. Mitigation: pin `three@^0.180.0`, as the reference does.
7. **Audio realism.** Laughter and chatter are formant synthesis, and speech appears as text bubbles. Real CC0 recordings would need you to supply the files.
8. **Fonts.** Linux may lack Devanagari and Gurmukhi (tofu boxes). Bundling Noto (OFL) would be a binary asset, and I'll ask before adding it.
9. **Ink through fog.** The ink fade has to follow the fog distance, or lines float in the fog.
10. **One GPU only.** Timings are from the user's machine. They are real, but they are one data point; the low tier is still sized from draw-call counts, not from that one GPU.
11. **Three photos (r3, r4, r5) appear AI-generated.** They are used for mood only.
12. **Not confirmed by OSM or the photos yet:** the statue's identity, the lake-club building, the lamp posts and the regulator's appearance. All are kept generic until confirmed.
