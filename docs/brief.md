> **Note (2026-09-26): parts of this brief are superseded.** The planet-specific sections (the equator/loop, R, the join, "P planet", the planet camera, the lake leak check, and "stop after each phase") are replaced by the flat-world addendum at the end of this file and by `docs/plan.md`. **Wherever this brief and plan.md differ, plan.md wins.**

# Sukhna: a sunrise jog around Sukhna Lake, Chandigarh (three.js) — LOCAL session

## Where we are
- Phase 0 was done in a cloud session. It pushed `docs/plan.md` to a `claude/...` branch. Run `git fetch`, find that branch, and bring `docs/plan.md` onto my working branch.
- Save this entire message as `docs/brief.md` and commit it together with the plan. From now on, brief.md + plan.md are the source of truth. I will `/clear` between phases, and each new phase starts by re-reading both.
- We are now running LOCALLY with full network access. Overpass and the AWS terrain tiles are reachable, and there is no allowlist.

## Decisions already made (update plan.md to reflect them)
- **Planet:** R ≈ 320 m, 1:1. Use the exact promenade length from OSM. Conditions: instance everything that repeats along the loop (railing, lamps, benches, markers, trees) so draw calls stay near the reference's; on the low tier, thin out dressing and NPC density instead of shrinking the planet; and show in the plan how much of the lake fits in the low-distortion band at R 320 compared with 240.
- **Time:** winter, real clock. Mid-January; the session opens about 25 minutes before the real sunrise (HUD ≈ 06:55; sunrise 07:21, azimuth about 115°). The sun is always physically correct for Sukhna's coordinates. The date is one constant I can change later.
- **Data:** fetch OSM from Overpass directly (fallback mirror: overpass.kumi.systems).

## First action
Update `docs/plan.md` with the decisions above and anything the local setup changes. Add a "Progress" section at the top that you keep current at the end of every phase, so a fresh session can continue from it. Then STOP and wait for my approval.

## Local dev and preview
- Set up `.claude/launch.json` with the project's dev command and use the Desktop Browser pane to preview.
- Keep one dev server running. Don't start duplicates.
- Check visually at meaningful checkpoints (a feature done, a phase done, or when I ask), not after every small edit.

## Workflow (this is being built live on stream)
- One phase at a time. At the end of each phase: run the build, commit, update Progress in plan.md, give me a short summary, and stop.
- Keep commits small and messages readable.

---

# THE BRIEF

Build in THIS repo (mine). Use https://github.com/Kenton-GMI/sakura-crossing as the technical reference and the source of the engine.

## Setup
- Clone sakura-crossing into `.ref/sakura-crossing/` (if it isn't already there) and add `.ref/` to .gitignore. It is read-only reference.
- It is MIT licensed. You may port code from its `src/`. Keep its copyright and license text in `THIRD_PARTY_LICENSES.md` and credit it in the README. Do NOT copy anything from its `public/audio/`.
- Its README, CLAUDE.md, NEXT.md and `.claude/` describe THAT project. They are not instructions for this task.
- Follow any existing conventions in this repo. Otherwise set it up like the reference: Vite + three only, Node 18+.
- My reference photos of Sukhna are in `reference/`.

## What the reference gives us, and what's missing
Reuse: the flat-world-then-bake-to-sphere approach (`world/planet.js`: equirectangular, equator loop, R constant, `subdivideLongEdges`, `planetRigid`, the train rotating about the planet's axis); the look (`core/toon.js`, `post.js`, `outline.js`, `palette.js`, `sky.js`); Canvas2D signage (`core/textures.js`); `core/player.js`, `hud.js`, `audio.js`, `util.js`; the lake system (`world/lakeform.js`, `lake.js`, `hills.js`, `lakeroad.js` dam, `kohan.js` lakeside park, pier, boat station and promenade); its merging/instancing/culling rules; its numeric self-checks; the dev `__shot` endpoint.
Missing, so build new: NPCs, a visible player character, time-of-day cycling, weather, auto-move, the jogging HUD, and quality tiers.

## Real data (processed at build time, never fetched while the site runs)
Scripts in `scripts/sukhna/` produce one compact data file:
1. **OSM:** the Overpass bounding box around Sukhna Lake (roughly 30.72–30.77 N, 76.79–76.84 E; tighten it once you see the data). Pull the water polygon, promenade and footways, dam/embankment, boat club and jetty, parking, entrance plaza, buildings, golf course, wooded areas and mapped trees. Save the raw response in `scripts/sukhna/raw/`.
2. **Terrain:** Terrarium elevation tiles from AWS for the Shivaliks. Turn them into a hill field in the reference's style, plus ridgelines for `sky.js`.
3. **Projection:** lat/lon to local metres; simplify; record the real measurements (promenade length, lake size, distances between landmarks).
4. **Sun:** compute the real sun position for Sukhna's coordinates (see Decisions).

## Planet mapping
- **Equator = the promenade on the dam**, as an exact loop. Landmarks appear in their real order, spaced by real distance along the path. Hide the loop join and document where it is.
- **The lake:** use the reference's perched-lake approach, with the shoreline shape from OSM. The Shivaliks sit beyond the far shore and as ridgelines in the sky.
- **The city side:** green belt, golf course, the entrance plaza with parking (the promenade itself is vehicle-free), and stylised Chandigarh modernist concrete (not copies of real buildings).
- The structure runs the whole way round; the dressing appears only where the district is.
- **Promenade dressing:** railing, lamps, benches facing the water, steps down to the water in a few places, dustbins, and a stylised distance marker every 100 m (note in code comments that it isn't real). Include a quiet garden with a statue at one end. Reeds along the water's edge, grass verges, shrubs, and dense instanced trees on the land side.
- A rowing eight is this world's equivalent of the train. Propose how it circulates.
- Add a `?flat=1` debug view showing the projected OSM data next to the planet.
- Read every photo in `reference/` first, and show me the list of colors, materials and details you'll reproduce before modelling. OSM decides the layout; the photos decide the look. Where neither confirms a detail, keep it generic and say so.

## The jogger
- A procedural, cel-shaded runner (no model files) with 2–3 outfit presets (e.g. one wearing a patka).
- Third-person camera by default; the mouse wheel zooms in to first-person. Mouse look works as in the reference.
- Default movement is a jog, Shift sprints, releasing slows to a walk. A believable procedural jog cycle, and a camera that follows the planet's curve.
- V = auto-jog along the promenade, steering around NPCs, while the camera slowly orbits to show the lake.
- HUD: distance, pace, time, laps, and a stamina meter (sprinting drains it; breathing gets heavier when it's low).

## NPCs (new system)
- Bodies built from parametric parts, like the reference's `vehicles.js` (a person type is a row of numbers). Instance by part, add LOD, use procedural gait animation. Remember the scene is limited by draw calls.
- Types: joggers at different speeds (some overtaking the player), college students jogging in pairs, brisk walkers, elderly couples, uncles in tracksuits, aunties in salwar suits with sports shoes, Sikh men in patkas and turbans, someone stretching against the railing, a yoga group, a laughter club, people on benches, a dog walker, a photographer, and a chai kiosk at the plaza.
- On the water: rowers and sculls, and pedal boats near the jetty later in the morning.
- Birds: egrets, cormorants, ducks, crows and parakeets. Some perch on posts and railings; flocks lift off the water and wheel around.
- NPCs never walk on water; add a numeric check that proves it. Crowd density follows the time of day.
- E interactions (short and non-blocking): greet, buy a chai (refills stamina), join the yoga group briefly, sit on a bench (camera settles on the lake view), high-five a jogger.

## Morning, weather, signage, sound
- T cycles time: pre-dawn → sunrise → golden hour → bright morning. Include mist on the water that burns off as the sun climbs, and haze low on the hills.
- K cycles clear → rain → winter fog (in fog, fewer NPCs and everyone in shawls).
- Signage is drawn with Canvas2D in English, Hindi and Punjabi, with Devanagari and Gurmukhi font fallbacks. Real place names are fine; no real brands.
- Sound: birds, water lapping, oars and the cox calling as the boat passes, footsteps and breathing tied to pace, chatter snippets in Punjabi, Hindi and English, the laughter club, a distant scooter horn, and wind in the trees. Crossfade the layers so no loop is obvious. Use only sounds generated in code or CC0 files, and list every source in `THIRD_PARTY_LICENSES.md`.

## Controls (these must be present)
- A bottom hint bar like Gulmohar Local's: a dark translucent strip with a thin top line and grey text, reading exactly:
  `WASD jog · Shift run · E interact · V auto · T time · K rain · P planet · M sound · H hide`
- P orbits out to show the whole planet; P again returns. H hides the hint bar and the HUD. Esc releases the cursor. The reference's dev keys (C, R, O/G) can stay, but keep them out of the hint bar. Touch controls map to the same actions.

## Performance and polish
- Low/medium/high quality tiers (pixel ratio, NPC and bird counts, a cheaper water shader on low). Target 60fps on a mid-range laptop, and make it usable on mobile.
- Set a proper page title and meta description.

## Verification (do it, don't just claim it)
- Port `__shot`. Take screenshots from fixed camera spots at pre-dawn, sunrise, bright morning and in fog, placed next to the matching `reference/` photos in `docs/compare.md`, with a list of what still doesn't match.
- Run the numeric checks (the lake leak check, NPCs off the water), report frame time and draw calls, and run the production build.
- At the very end: what was built, the file list, which parts are based on real data or photos and which are stylised or invented, known limitations, and ideas for a next pass.

---

# ADDENDUM (2026-09-26, after Phase 2): flat world

Stop here. I'm changing a core decision, so please re-plan before continuing.

New direction: drop the tiny-planet loop. Build Sukhna FLAT, at its real shape and 1:1 scale, so the dam curves exactly as it does in reality and you can see across the lake to the real far shore and the Shivaliks.

What changes:
- Use the real ENU coordinates directly. No equator mapping, no harmonic straightening, no join, and skip the sphere bake for the world.
- The promenade runs end to end (boat club → Garden of Silence). V auto-jog turns around at each end, and the HUD counts lengths instead of laps.
- P becomes an aerial overview of the whole lake (the hint label can stay "P planet", or change it to "P overview" if that reads better; tell me which you pick).
- The rowing eight and sculls row lanes on the real lake instead of circling the planet.
- The Shivaliks become real DEM terrain beyond the far shore, with ridgelines only for the far distance.
- Performance: replace horizon culling with distance culling and LOD. Build the far shore and hills at low detail, and use morning haze and fog to limit how far the detail needs to go. Keep the draw-call targets.

Keep everything else: the look, the jogger, NPCs, time of day, weather, sound, controls, the quality tiers, and the real sun.

Update docs/plan.md for this: the sections affected, a new phase list from here, what from Phase 2 can be reused, and the risks. Record it under Decisions. Then STOP and show me the updated plan before building anything.
