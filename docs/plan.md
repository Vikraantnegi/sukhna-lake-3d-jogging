# Sukhna: a sunrise jog around Sukhna Lake (plan)

Status: **re-planned after Phase 2: the world is now FLAT, at Sukhna's real shape and 1:1 scale** (the user's decision; see Decisions). **The re-plan is approved; the continuous run resumes at Phase 2 (flat).** Implementation runs locally (Claude Code Desktop on the user's Windows machine). Overpass (overpass-api.de, fallback overpass.kumi.systems) and the AWS terrain tiles are reachable; no allowlist. Reference engine lives at `.ref/sakura-crossing/` (git-ignored, read-only): `git clone --depth 1 https://github.com/Kenton-GMI/sakura-crossing .ref/sakura-crossing`.

Source of truth: `docs/brief.md` (the user's brief, verbatim, plus the flat-world addendum at its end) + this file. Where they disagree, the Decisions below win. Each new phase starts by re-reading both, then Progress and Working rules.

## Progress

| Phase | Status | Branch | Commit |
|---|---|---|---|
| 0 Plan | done | `claude/charming-hawking-lsp0mx` (PR #1, merged) | `f2ffc9a` |
| 1 Scaffold + engine port | done | `phase-1-scaffold` (PR #2, merged) | `4c528c4` |
| 2 (planet version) | **superseded**, kept in history | `build` | `27ca69a` |
| 2 Flat real-data pipeline + flat scaffold | **done** | `build` | "Phase 2: flat real-data pipeline and world scaffold" |
| 3 World layout, LOD and self-checks | **done** | `build` | `1d299d4` (part 1) + "Phase 3: world layout …" |
| 4 Jogger, camera, HUD, controls, touch | **done** | `build` | "Phase 4: the jogger …" |
| 5 NPCs, interactions, rowing, birds | **done** | `build` | "Phase 5: NPCs, interactions, rowing, birds" |
| 6 Time of day, haze, mist, weather, signage | **done** | `build` | "Phase 6: time of day, haze, mist, weather, signage" + "Phase 6 additions: conditions card, next-morning loop, lamps, sunset" |
| 7 Sound | **done** | `build` | "Phase 7: sound, music on the water steps" + "Phase 7 fixes: seated framing and pose, steps, NPC fade, ink" |
| 8 Quality tiers, verification, compare.md | **done** | `build` | "Phase 8: quality tiers, verification, compare.md" |
| Playtest: automated bot, 9 scenarios, fixes | **done**, 9/9 green | `playtest` (from `main` after merging `build`) | "Playtest: automated bot and the fixes it found" |
| Boating and joining a group | **done**, 11/11 green | `boating` (from `main` after PR #4) | "Boating from the jetty, and joining a circle" |
| Polish: the view from the boat | **done** | `polish-boat-view` (from `boating`: `main` doesn't have the boat yet) | "The view from the boat: stone-pitched embankment, a swan that reads as one" |
| Launch polish: link previews, favicon, production and phone checks | **done**, merged (PR #6) | `launch-polish` (from `main`) | "Launch polish: link previews, favicon, touch controls off the start card" |
| Director mode: scripted shots recorded as video | **done**, 7 videos | `director` (from `main` after PR #5) | "Director mode: scripted cinematic shots, recorded as video" |
| Director style: no end card, Nunito captions | **done**, merged (PR #7); the seven videos re-rendered since | `director` | "Director: drop the end card, Nunito captions with a soft gradient on bright frames" |
| SEO: page text, FAQ, structured data, custom domain, PostHog | **done**, merged (PR #8) | `seo` (from `main` after PRs #6 and #7) | "SEO: About and FAQ in the page, structured data, custom domain, cookieless PostHog" |
| Sunrise as the default start | **done**, merged (PR #9) | `default-sunrise` (from `main` after PR #8) | "Open at sunrise (07:19) instead of pre-dawn" |
| Error reports: only our own scripts; a clean stop without WebGL | **done** | `error-filter` (from `main` after PR #9) | "Report only our own errors; stop cleanly without WebGL" |

**Polish notes from the user's review (after Phase 4), folded into Phase 5:**
- [x] The parapet zigzags at curves: now one continuous swept mesh along the curve (1 m steps, cobble texture every 2 m), capped at the water steps (`parapetGeometry` in `world/dam.js`).
- [x] Palm fronds: each is now an arching blade that rises and droops (older ones further), folded along the midrib, plus two young upright fronds (`frondGeometry`).
- [x] Plaza paving: one draped surface with shared corner heights and checkered 1.5 m tiles, instead of separate boxes; trees are kept off it.
- [x] Mouse drag-to-orbit was lost in Phase 4 (look needed pointer lock, which the Browser pane refuses): drag-to-look restored whenever the pointer isn't locked.

**Notes on Phase 4 from the user's review (second round), folded into Phase 5:**
- [x] Gaps at the knees and elbows: thighs, shins, upper and lower arms are now round-ended rods whose end caps are centred on the joints (`limb(aspect)` in `people/body.js`), so the next segment's cap fills the same spot and a bent knee or elbow stays closed. Shared by the player and every NPC.
- [x] Stride too big for a jog: hip swing and heel recovery now split into a jog part and a sprint part (`sprint = smooth(3.4, 5.2, speed)` in `people/gait.js`). At 3 m/s: hip ±0.40 rad (was ±0.62), knee recovery 1.1 rad (was 1.7); the long reach and high back-kick only come in towards 5.2 m/s.
- [x] Auto-jog pace 3:31–4:09 /km: measured, auto-jog alone is exactly 3.0 m/s (5:33 /km) and the pace formula is right. Those readings are what happens with Shift held (or stuck) while auto-jogging: sprint drained stamina to 5, then speed flickered between sprint and jog at ~4.0–4.7 m/s. Fixed both ways: sprinting to empty now leaves you **spent** (no sprint until stamina is back to 30), and a Shift whose keyup was lost (pointer lock, another window) is cleared by the next key or click event that reports Shift up, and every key is cleared when the tab is hidden.
- [x] Start card said "K weather": now "K rain", as on the hint bar.
- [x] Parapet still stepped at the joints: confirmed the Phase 3 note above, and found two more causes. (1) `spineAt` returned one normal per 4 m spine segment, so anything offset from the spine jumped at every vertex (up to ~1.2 m at d = 4 m on the 33°-per-10 m bend at s ≈ 2 280); the tangent now blends between the vertices' central chords, so every offset curve (parapet, verges, lanes, placements) is continuous. (2) The swept parapet's faces were wound inside out, so from the walk you looked through a missing top to the far face (it read as set back behind a green strip) and each 100 m sector's end cap showed as a step. Both fixed; the parapet is a solid, continuous cobble wall.

**Notes on Phase 5 from the user's review, folded into Phase 6:**
- [x] Turban rendered as a solid sphere over the whole head and face: rebuilt (`wrapShell` in `people/body.js`, in head units) as a dastar that sits on the forehead just above the brows, covers the tops of the ears and the back of the head to the nape, rises well above the crown with a slight front peak, with wrap lines crossing in a V at the front; the face is clear. A new `beard` part (one more instanced draw) gives a full beard below the cheekbones to 85% of turbaned men and 35% of those in a patka (never with a salwar kameez; Sikh women may wear a turban). The patka is now a snug cloth over the upper head with the top-knot as a round lump on the crown.
- [x] Water steps: the cheek walls beside *every* stair (the three to the water and the six real ones down the city face) were pitched the wrong way, rising toward the far end, so at the water steps they stuck out over the lake as two long dark beams (the smaller stray stick seen in Phase 3 was a city-stair wall). Fixed; the water steps also get a paved landing through the parapet at walk level with cheek walls as high as the parapet, and the parapet gap is now exactly the stair's width. Checked at s 820, 1 480 and 2 130 (s 2130 was later dropped; see the review after Phase 8).
- [x] The dog's snout was a black box: now a tapered muzzle in the coat colour with a small dark nose, pointed ears, and a tail that grows from the rump. The dog walkers were measured walking normally (upright, lean 0.04); the bent-over figure beside one was most likely a parapet stretcher, which held a 31° forward bend indefinitely. Stretchers now run a routine (hamstring reach, quad pull, arms overhead, shake-out, ~8 s each), and dog walkers hold the lead out on the dog's side, with a lead drawn to the collar.

**Additions from the user's Phase 6 review (done before Phase 7, at the user's request):**
- [x] Conditions card, top right, in the jog card's style: the clock with the time-of-day label (T), the weather (K: Clear / Rain / Fog) and sound on/off (M), updated live; H hides it with the rest. The clock row moved here from the jog card. The `?stats=1` readout moved to the bottom left. The hint bar is unchanged.
- [x] Time after the morning: past the bright-morning window the screen fades to black, a short "Next morning · 06:55 · pre-dawn · 15 January" card shows, and the clock restarts at 06:55, still at 4×. (Loop point under Decisions.)
- [x] Lamps follow time and weather: the lanterns glow before sunrise, fade out between −3° and +3° of sun (gone by ~07:38), come back on at dusk, and glow in rain (85%) and fog (100%) at any hour.
- [x] Sunset preset on T at the real sunset for 15 Jan (17:45, sun at 246°), with the lamps coming on at dusk. It was cheap: the look is keyed to sun elevation, so dusk runs the dawn palette with the sun in the WSW.
- M only toggles a stored on/off preference (shown on the card) until the sound itself arrives in Phase 7.

**The user's Phase 7 idea (sit on the water steps and listen to music), folded into Phase 7:**
- [x] E at a water step (anywhere on its landing or flight): the jogger sits on the lowest dry tread (top at least 12 cm over the lake), facing the lake; the camera settles low and close (boom 2.2 m, level), just over the water. Any movement key stands up. Built on the bench-sit logic (`steps` in `people/interact.js`).
- [x] Music while seated, on a bench or the steps: a soft lo-fi loop generated live in WebAudio (`core/sound.js`): 74 BPM, four-bar chord loops in D major chosen afresh every four bars, a detuned pad, soft electric-piano stabs, root bass, a sparse pentatonic melody moving in small steps with an echo, a swung brushed beat that drops out every sixteenth bar, vinyl crackle, and a gentle low-pass and saturation. It fades in over 3 s on sitting and out over 2 s on standing, and ducks the ambience to 55%; the rain (on the ground and on the water) is on its own bus and is never ducked. Measured seated: music ~0.10 RMS, rain-on-water ~0.06. No new key: M toggles all sound. The conditions card's M row reads "Music" while it plays.
- [x] Optional user tracks: audio files in `public/audio/` (git-ignored; only its README is tracked) play, shuffled, instead of the generated loop. The dev server lists the folder at `/audio/list.json` (a `playlist.json` there also works); the build deletes `dist/audio`, so nothing is ever shipped. Tested with a generated 440 Hz tone (played through the music bus, then deleted).
- [x] The water steps looked like flat grey slabs with a wedge. The cause: every tread sat half a step *under* the embankment slope, so only fragments showed. Rebuilt (`waterStairGeometry` in `world/dam.js`): each tread's upper edge sits on the slope, so treads and risers stand clear; solid river-cobble blocks like the parapet (same texture and mapping), pale dressed-stone treads with a 6 cm lip, stepped cobble cheek walls at parapet height above each tread, a paved landing through the parapet, the flight running on into the water (~18 treads of ~0.14 m). The collider stands you on the treads, not the slope under them.

**Fixes to the water-step sit from the user's Phase 7 review (before Phase 8):**
- [x] Seated camera: over the shoulder, ~3 m behind, 0.75 m to one side, aimed 0.3 m above the head, so the jogger sits in the lower third with the water, the far shore and the hills behind; a very slow drift (two slow sines on yaw, one on pitch). The framing is applied once when you sit, so the wheel still zooms; mouse look works and it settles back after 2.5 s idle. Same framing on benches.
- [x] Seated pose: `seatPose` / `stepSeat` in `people/body.js` fit the pose to the seat from the body's own proportions: the hips on the surface (pelvis and thighs 1 cm clear), thighs forward over the edge, shins down to the next tread (swinging forward when the drop is short) or thighs angled down to put the feet on the ground from a bench, shoes flat, hands on the knees (two-link reach). The root is placed so the ankles land on the lower tread. The cause of the sinking: the old seat put the root 0.4 m under the tread and the feet 0.27 m into the step below, and the first seatPose also missed that the hip joints hang 3 cm under the pelvis. NPC bench sitters use the same fit. **seatCheck** (dev start-up) poses every water step × every outfit, every NPC sitter and the jogger on a bench, transforms every vertex, and requires everything over the seat to be on or above it and everything beyond its edge on or above the foot surface: 22 seats, 0 violations (closest 0.00 m, a shoe flat on the ground).
- [x] The steps up close: treads are now dressed-stone slabs with joints and a faint speckle (`slabTex`), 3 cm over the embankment slope (the slope was coplanar with each tread's upper edge and z-fought), a 5 cm lip that stops short of the next riser (no overlapping treads), the landing 2 cm proud of the walk (it was coplanar with it). The user's screenshot of a jogger sunk into a flat plane was the committed Phase 7 build; a raycast down every tread of the new flight hits the tread first, down to the water.
- [x] NPCs through the camera: people within ~1.7 m of the camera dissolve with a 4×4 ordered dither (a per-instance `aFade` in the crowd's shader, 0.8–1.7 m), instead of filling the view. No extra draw calls.
- [x] Found on the way: the ink pass inked the lake as a dark band when seen from low (a camera 1.3 m over the water). It took a second difference of *linear* depth, which isn't zero across a plane at a grazing angle; it now uses *inverse* depth, which is exactly affine across any plane, so planes never ink. Walk views are unchanged.

**The user's review after Phase 8 (the water steps were still broken):**
- [x] Sunk into a flat plane, and "can't even go up". Three causes, all found by testing every flight, not just s 1480:
  - **The flight at s 2130 was a ladder.** The walk there is on the west end's higher ground, 6.1 m over the water with the shore 6.6 m away, so it had 39 treads about 0.2 m deep, and the shore band covered its lower treads (the flat plane). The third flight moves to **s 240**, on the 2.5 m crest with the shore 13.4 m out, like the other two. `buildDam` now builds a flight only where the walk is ≤ 3.2 m over the water.
  - **Trapped at the foot.** The seat (the lowest dry tread) sat inside the collider's 0.5 m keep-off-the-water margin, so after standing up every step was refused. Now `collider.move` always allows a step away from the water when you stand somewhere not free, and the seat is the lowest tread that is both dry and standable. `stepSeat` in `world/dam.js` is shared by the E interaction and seatCheck, so they agree.
  - **Standing on the water** (user screenshot near the west end): not reproduced (162 random 20 s walks from the flights, the jetty and the west end never reached open water), but made impossible anyway: `collider.move` never accepts a step onto open water unless it is a deck, whatever else says yes.
  - **Stairs down to the jetty** (the user: "steps to enter here … and go on that floating thing"). The parapet now opens under the Boating board, which becomes a gateway on the stair's cheek walls. A pier stair runs down to the floating jetty: the walk there is 7.6 m over the water on a 1:1.2 embankment, so the stair keeps comfortable 0.16 m risers and 0.32 m treads, with a 1.2 m landing every sixteenth tread (43 treads), and runs out over the water. The jetty now starts at its foot (d 20.4, out to 42 m). The collider treats the stair's footprint as a deck at tread height. Tested: from the walk to the end of the jetty in ~12 s; stepping off the jetty's side or end is refused. E on the stair sits you on the tread above the deck. damCheck counts 4 flights (3 to the water, 1 to the jetty); seatCheck covers 25 seats.
  - **More flights** (the user: "add these stairs multiple times on the jogging path"): one about every 300 m, eight in all. s 240, 530, 820, 1150 and 1480 are on the 2.5 m crest and follow the embankment into the water. s 1790 and 2090 are on the west end's higher ground (5.8 and 6.3 m over the water, banks of 1:1.5 and 1:1), so they are pier stairs like the jetty's, 34 and 37 treads, ending in a 2.2 m stone landing 0.3 m over the water; E there sits you on the tread above it. The jetty's stair (2395) completes the set. Perching birds keep off the openings.
  - **Found while testing the piers:** the collider and the sit prompt looked treads up by `nearestS`, which follows the curved spine, but a flight runs straight out from its spine point; on a 20 m pier over a bend they disagreed by metres, so a tread could be missed (the height went to −∞, then NaN), and the prompt at a pier's foot never showed. Both now measure in the flight's own straight frame. Tested at all eight: walk down, E to sit, stand, walk back up and over the walk; no bad heights. seatCheck: 37 seats, 0 violations.
  - **Tested at every flight:** 0 of 15 dry treads covered; seated; standing up and walking toward land climbs the flight, crosses the walk and goes on down the city side. seatCheck still 22 seats, 0 violations.

**The automated playtest (user, after merging `build` into `main`; branch `playtest`):**
- The user's brief: a bot that roams Sukhna and asserts (screenshots alone aren't a test), and it must catch the two bugs found by hand: the water-step sit glitch and "can't climb up or down the stairs". Playwright was approved as a devDependency. How to run it: `tests/playtest/README.md`.
- The first runs failed in most scenarios; every item below was found by the bot, then fixed and rerun. Final run: **9/9 pass** (stairs 270 s, sit 248 s, the rest under 30 s each).
- Before/after shots of the city stairs and the jetty-stair sit: `docs/shots/playtest/`.
- [x] **Stairs, climbing: the jogger sank 0.13–0.21 m into each tread going up.** Root cause: the height eased toward the surface at rate 18/s, too slow for 0.16 m risers at 3 m/s, so each riser was half-climbed inside the tread; the tread was also looked up at the old position, before the move. Fix: on a flight the pace is capped at 1.6 m/s, the height snaps up to a higher tread at once and eases down at 40/s, and the surface is read after the move.
- [x] **Stairs, city side: the six real stairs floated up to 0.52 m over the grass or were buried, and at s 1524 and 1898 the collider never touched them** (you walked down the slope through them). Root cause: they were drawn from a straight line between the verge and a guess of the ground at the foot, while the ground under them bends; and the collider only knew the water flights. Fix: `groundFlight` in `world/dam.js` lays each tread on the real ground (0.17 m risers, 0.3–1.6 m runs, never more than one riser down per tread, ≥ 3 cm over the ground), and the collider looks city treads up like the water ones. The flight-extent check assumed every flight runs toward the lake; it now uses the span's min/max.
- [x] **Stairs, one-sample sinks** at the tread lip, the landing, and the jetty stair's foot. Root causes: the collider ignored the 5 cm lip and the landing, returned the jetty deck before the treads, and tested a point, not a foot. Fix: treads are looked up in the flight's frame over the foot (±0.1 m, `FOOT`), with the lip, and the landing counts as a tread; the jetty deck no longer hides the treads above it.
- [x] **Ground: the jogger floated above land that lies below lake level** (the city side near the golf course is ~3 m under the lake). Root cause: `surfaceAt` clamped all ground to ≥ 0 (the water surface). Fix: the clamp applies only inside the lake.
- [x] **Sit: on the jetty stair the jogger was hidden behind the treads above.** Root cause: the seated camera was level, and on the steep pier stair (1:2) the treads above filled the view. Fix: the seated pitch follows the flight's grade (`busy.grade` from the treads), so the camera looks down the flight. Every bench and flight now passes: nothing under the seat, feet on the tread below, head and hips in frame and unoccluded, music in over ~3 s and out over ~2 s, W stands up.
- [x] **Promenade: the lengths counter missed the first length** when a jog starts 12 m from an end. Root cause: the end zones were 10 m and the auto-jog turns 7 m short, so starting inside the zone never registered it. Fix: 25 m end zones.
- [x] **Time and weather: the crowd ran ~15% over the density rule** (e.g. 0.30 before dawn read 0.35). Root cause: `setDensity` scaled by the count of all walkers, followers in pairs and groups included, then showed leaders with their followers. Fix: it counts leaders.
- [x] **Interactions: chai and yoga couldn't be cancelled, and the laughter club wasn't joinable.** Fix: any movement key ends an interaction (chai only refills stamina if finished); "E · join the laughter club" within 7 m of the club (6 s, frozen, laughing, the club answers). The greeting's reply could repeat your own words; it now never does. Interaction timers ran on the wall clock (so pause didn't hold them); they run on game time.
- [x] **Camera: people inside 1.5 m of the lens were not faded enough.** The dissolve is now 2.0 m → 1.0 m (half gone at 1.5 m, fully gone by 1.0 m).
- [x] **Boundaries: there was no edge to the world**; the bot walked off the detailed terrain. Fix: `collider.free` refuses anything within 20 m of the near grid's edge.
- [x] **UI: Esc didn't pause when the pointer wasn't locked** (the Browser pane, touch, `?nolock`), and `setPointerCapture` threw an uncaught error when the pointer had already gone. Fix: Esc toggles pause when unlocked; the capture calls are guarded.
- Test-side fixes (not game bugs): music fades run on the audio clock, so the sit spec waits in real time; the climb stops once back on the walk; the camera spec's thresholds match the brief (1.5 / 1.0 m).
- Performance (RTX 4080 SUPER, 1920×1080, three worst views: spawn at sunrise, the bend across the lake, P overview): high 315–398 calls / 1.19–1.34 ms at 2859×1608; med 272–329 / 0.65–0.90 ms at 2231×1254; low 249–322 / 0.58–0.63 ms at 1520×855. All within targets (high ≤ 900, low ≤ 350).

**Boating and joining a group (user, after the playtest was merged; branch `boating`):**
- [x] **A ticket shack** on the walk against the parapet, 4 m east of the Boating gateway (s ≈ 2391; generic, stylised: cream booth, blue band, striped awning, a counter at the window facing the walk). Its board reads "Boating Tickets / नौका विहार टिकट / ਬੋਟਿੰਗ ਟਿਕਟ" in the signs' style; **the Hindi and Punjabi are for the user's review** (they follow the Boating board's words). No money and no prices anywhere: E at the counter gives a one-ride ticket, shown on the jog card ("Boat ticket · 1 ride"). In rain the counter reads "Closed · rain"; it's open in clear weather and fog, at any hour (the NPC swans keep their 08:30 rule).
- [x] **The berths:** the moored swans now lie side by side with their sterns to the deck and bows out (they lay nose to tail along the jetty, overlapping by 0.8 m), 16 berths, about one in eight empty. Every swan has a bench seat with a low back.
- [x] **The pedal boat** (`core/boat.js`): E at a moored swan (from the deck, with a ticket) seats the jogger in it (the seat fitted by `seatPose`, feet on the deck, legs pumping with the wheel, hands on the tiller) and the camera goes behind it (the seated view as a chase camera, following the heading). W/S pedal forward and back (1.5 m/s, 0.7 back), Shift pedals hard (2.4 m/s, stamina −7/s, +5/s otherwise), A/D steer (the rudder bites with way on, a little at rest, reversed going astern); a couple of seconds to pick up and a long coast, and turning inertia. A turning paddle wheel at the stern, a wake (foam from the rowing's pool: no extra draw call), water rushing along the hull with the speed and a splash as each paddle goes in (the ambience bus; the water laps at the hull anywhere on the lake).
- [x] **Where it may go:** a 2.9 × 1.5 m capsule. Its centre stays 2 m inside the real lake polygon (islands too), bow and stern 0.6 m; it bumps softly off the shore (a third of the speed back, sliding along), and off the jetty, the pier stairs, the footbridge, the launch, the OSM piers, every moored swan, the pedal swans and the rowing boats (with their oars out). Inside the eight's lane ahead of it the boat is pushed aside: it yields. The pedal swans keep out of your way.
- [x] **Getting off:** only at the jetty. Within 6 m of a free berth (once you've pedalled 8 m from where you set off), "E · dock": the boat glides into the berth over 1.4 s (bow in or bow out, whichever is the smaller turn), moors there, and you step onto the deck beside it; then walk back up the jetty stair. Anywhere else E says "Dock at the jetty to get off". Esc only pauses. While boating the jog card shows the ride (boat distance, speed in km/h, ride time; no lengths), the hint bar the boat's keys, V does nothing; the conditions card is unchanged.
- [x] **Joining a group:** the laughter club (was a fixed 6 s round) and two new chatting circles on the grass beyond the dam's toe (s ≈ 830 and 1330, four and five people, placed clear of trees and buildings; high and medium tiers). Within ~4 m of a circle: "E · join the laughter club" / "E · join the group". The members shuffle round to open an even gap where you stand, you step in and face the middle, and join in until you leave: with the club, laughing on its bursts (every 14 s, the whole circle together now) and clapping between, "Ha ha ha!" / "Ho ho, ha ha ha!" and the "Very good, very good, yay!" chant, your claps and laughs in the sound; with the others, they take turns to talk (a bubble and babble each, hands moving), and every third turn you nod along ("Haan ji!", "Bilkul!"). The camera stands behind you, outside the circle, looking across it. The hint bar reads "Esc · leave the group · …". The first Esc leaves (you step back out and the circle closes up), the next Esc pauses; any movement key leaves too.
- [x] **Checks and tests:** `boatWaterCheck` at start-up drives the boat's own physics at random from 12 berths and 16 open-water points (half of them flat out at the nearest shore): 36 028 positions, 4.3 km, 7 792 soft bumps, 0 closer than 2 m to the shore. New playtest scenarios `boating` and `groups`; the laughter club left `interactions` (it no longer ends by itself). Full run: **11/11 pass**.
- [x] **Boating, second pass (user):** a faster boat — pedalling 3.0 m/s, Shift 4.5 m/s (still on stamina), astern 1.2 m/s; up to speed in about a second (was two), the same long glide off the pedals and the same turning inertia. The pedals are geared down from the paddle wheel (~0.8 strokes a second at 3 m/s) and pump harder with speed; the wake foams more often and wider, the water along the hull rushes louder and brighter, and each pedal stroke splashes (louder with speed). The chase camera stands up to ~2.5 m further back at full speed (`extraBoom` in camera.js, on top of the wheel's zoom). The lo-fi now plays while boating too: it fades in as you board and out as you dock, with the same generator and fades as sitting, and the card's M row reads "Music". It ducks the ambience as before; the boat's water (hull and splashes, now on their own `N.boat` bus) and the rain on the water are never ducked. Results: boatWaterCheck 36 028 positions over 9.0 km, 0 closer than 2 m to the shore; playtest `boating` and `sit` pass (boating now also checks the pick-up, both top speeds, the stamina drain, the glide, and the music in and out).
- Found on the way: a speech bubble was placed with the camera of the last *drawn* frame, so while fast-forwarding (the playtest) it could sit off screen; it now uses this frame's camera.
- Performance unchanged (high 304–398 calls, 0.6–0.7 ms at 2859×1608; low 250–322). Boating adds two draw calls while you're in the boat (the hull and the wheel); the tickets board is one more sign.

**Polish: the view from the pedal boat (user: "it will be filmed"; branch `polish-boat-view`, cut from `boating` because `main` has no boat yet):**
- [x] **The embankment from the water** was a flat mauve band. Now: a textured face of hand-set stone pitching (`pitchingTex`: ~36 cm irregular stones in joints, tinted by the rows' colours: grassed over the upper half, grey stone below), laid 2 cm over the plain strip in each near sector (`bankGeometry`, one draw call a sector, on exactly the same slope); the drawdown band at the waterline in cream, with **6 700 faceted pale boulders** bedded along it, half in the water (`boulderMesh`, one instanced draw for the whole dam, thinned on lower tiers, none at the flights); and the **reeds** rebuilt as fanned flat blades with bulrush heads (thin round stems read as black ink lines from a boat), in clumps every 3-9 m in among the boulders. The far LOD strip is unchanged. Checked from the chase camera mid-lake and 9 m off the dam at golden hour and bright morning (before/after in `docs/shots/boat-view/`).
- [x] **The swan from behind** read as a blue ball with a box on its back. `swanParts` is rebuilt to read as a swan pedal boat from the chase camera: a smoother hull with a dark rubbing strake at the waterline, **wings folded along the sides** with feather tips raised toward the stern, an **upswept tail** of flat feathers, the **paddle wheel under a domed housing faired into the stern** (the wheel turns inside it), a cream cockpit sole, the bench seat with a red cushion and a **curved backrest shell**, and a curving tube neck to a head with an orange beak and eyes. Still one geometry and **one draw call** per swan mesh: a per-vertex `aKeep` (`swanMaterial`) lets the seat, cushion, beak and strake keep their own colours while the hull takes the boat's colour and the wings, tail and neck a lighter shade of it -- for the player's boat and the moored and pedal swans alike.
- Playtest `boating` and `performance` pass. Performance: 2-7 more draw calls per view (the bank a sector, the boulders), high 309-404 / 0.7-1.1 ms, low 251-329 (under the 350 budget); about 300 k more triangles (boulders, reeds, the finer swans).

**Launch polish (user; branch `launch-polish`; production URL then https://sukhna-lake-3d-jogging.vercel.app, now https://sukhna-lake.trymurmur.studio (see SEO below); deployed by Vercel from GitHub, never by hand):**
- [x] **Link previews:** Open Graph and Twitter card tags in `index.html` (`summary_large_image`, the title, a one-line description, `og:url`, image size and alt text), all with absolute URLs since X won't resolve relative ones. The image is `public/og-image.jpg` (1200 x 630, 84 KB): golden hour at s 2262 looking along the dam toward the low sun, the jogger mid-stride, shot with `__shot` at 2400 x 1260 and scaled down (the canvas only, so no HUD).
- [x] **Favicon:** `public/favicon.svg` (the sun coming up over the lake, in the start card's colours), plus `favicon.ico` (16/32/48, PNG entries) and `apple-touch-icon.png` (180) rendered from it. The old console error (a 404 for `/favicon.ico`) is gone.
- [x] **Production check** (`npm run build` + `npm run preview` on 5179, headed Chrome): no console errors or failed requests, desktop on high, the credits line (OSM ODbL, Mapzen / AWS Terrain Tiles, sakura-crossing MIT) visible on the start card. `dist/` holds only `index.html`, four JS chunks, the three icons and the preview image: no `__test` or director code (the one `__shot` in the bundle is the text of the C-key coordinate readout, not the dev hook), no fonts, no audio (`localTracks` still deletes `dist/audio`).
- [x] **Phone check** (Chrome emulating 390 x 844 at 3x, touch, a mobile user agent): the low tier starts (`touch`), the start card fits (16-374 x 120-724 px, no sideways scroll), "Tap to start" works, the stick jogs (3 m/s while held, stops on release), a drag on the right turns the camera, V starts auto-jog. **Fixed:** the stick and buttons were drawn over the start card and covered its credits; they now fade out while the start or pause card is up (CSS `body:has(.overlay:not(.hidden)) .touch`).

**Director mode (user: scripted cinematic shots, recorded as video; branch `director`):**
- [x] **The director** (`src/dev/director.js`, dev only, like `__test`: imported only when `import.meta.env.DEV` and `?director=<name>`; not in `dist/`). It plays a timed shot list from `tests/director/<name>.json`: events at set seconds (time and weather, time-lapses, key presses, and player actions: place, walk to, auto-jog, sit on the steps, join a circle, ticket, board, pedal a path, dock, greet, high five, chai, speech bubbles, the rowers on cue), camera shots (the game's own rig, P's overview, or eased keyframes in world terms or relative to the jogger or the boat, with cuts or blends), captions and an optional end card. The HUD is hidden.
- [x] **Deterministic:** `main.js` seeds `Math.random` before the world is built (`?seed=`) and, in director mode, doesn't run its own loop: the director steps the game at a fixed 1/60 s, one rendered frame per step (a `cameraHook` in `tick()` lets its camera replace the rig's, so sound, bubbles and shadows follow the shot).
- [x] **Captions, end card, bubbles, the `?stats` readout and the start card** are drawn onto a 2D composite canvas (2560 x 1440) in the recording only, never in the game HUD: bottom-centre, with a soft shadow (now Nunito, see the style pass below); the end card's text comes from the list. The readout's "ms" is the GPU's frame time from a timer query (`EXT_disjoint_timer_query_webgl2`), which reads ~1 ms; a pixel read-back sync had shown 2-5 ms.
- [x] **Recording, changed from the brief's plan (and why):** `canvas.captureStream(60)` into MediaRecorder lost 1-5 % of the frames on this machine (Chrome 154, a 240 Hz display): one frame in about every 101, at 1440p and at 1080p alike, whether the capture was capped, uncapped, fed by `requestFrame()` or by a track generator. So the video is encoded with **WebCodecs** (H.264 High, 4:2:0, 40 Mbit/s at 1440p; Chrome's hardware encoder stops at 1080p here, the software one runs ~85 fps at 1440p), every frame stamped n/60 s; after a hitch (a cut to a new place refills the trees, the crowd and the shadows) the owed steps are each still drawn and recorded. The **WebAudio master** is recorded next to it by MediaRecorder as **AAC**, and `tests/director/record.mjs` writes both into **one MP4 with its index at the front** (the `+faststart` layout): H.264 + AAC, yuv420p, constant 60 fps, ready for X. **No ffmpeg was installed or needed** (it isn't on this machine; Playwright's bundled one only does VP8). The old path stays as `&capture=mediarecorder`.
- [x] **Frame check:** `record.mjs` reads each MP4's own sample table back: frames against the list's length, every frame's duration (a gap = a dropped frame, a short one = a doubled frame), resolution, audio length; and falls back to 1080p if 1440p drops frames (none did).
- [x] **before-after:** `record.mjs` checks out 4c528c4 (Phase 1) in a git worktree (`../sukhna-phase1`, its node_modules a junction to this one), serves it on port 5191, records 5 s of its P orbit (at 1080p scaled to 1440p: the old build has no pixel budget and crashed the page at 1440p), and removes the server, the junction and the worktree. The director plays that clip for the first 4 s, then cuts to today.
- Dev-server plumbing: `vite.config.js` gains `/__recording` (POSTed parts appended to `recordings/<file>`), and `.gitignore` gains `recordings/`. The page's only console error was a missing `favicon.ico`, ignored in the reports.
- How to add a video and render it: `tests/director/README.md` (the list format, every event, shot and point kind).
- [x] **Style pass (user):** the end card is out of every list (the feature stays in the code). Endings: before-after 10 s → 9 s and full-tour 128 s → 125 s (it ends on the overview as the fog settles); the others keep their length, their last camera move finishing ~0.5 s early so the last frame holds. Captions are now **Nunito Bold** (OFL, `tests/director/fonts/`, fetched at run time, not in `dist/`), picked from three previews (Inter, Nunito, Selawik on a start-card plate): warm white, 5.2 % of the frame tall at 0.83 H, for a phone in the X feed. On a bright background a very soft dark gradient fades in behind the text (the patch's 75th-percentile brightness, read back small every 4th step and eased; it comes on over the sunrise water, the open lake from the boat and Phase 1's pale backdrop, and stays off elsewhere). **The seven videos in `recordings/` were re-rendered by the user after this** (`node tests/director/record.mjs --all`), so they are current.

**SEO and analytics (user; branch `seo`; production URL https://sukhna-lake.trymurmur.studio):**
- [x] **Domain:** every absolute URL (`og:url`, `og:image`, `twitter:image`, the canonical link, the JSON-LD, `robots.txt`, `sitemap.xml`, README, `package.json` `homepage`) is on the custom domain. `vercel.json` sends `sukhna-lake-3d-jogging.vercel.app/*` to the custom domain with a **301** (a `redirects` rule matched on that host only, so preview deployments stay reachable).
- [x] **The start card is plain HTML now** (`index.html`), with the About text and FAQ under it in the same scrollable overlay (start card only; the pause card has none). It paints before any script: on a phone with the CPU slowed 4x on ~4 Mbit/s, the card and the whole text are up at ~0.44 s and "Start" is ready at ~8 s, when the world is built. Its button says "Loading the lake…" (disabled) until `hud.js` takes the card over: it moves it into the HUD, fills in the outfits and this device's controls, and enables the button. Without JavaScript the page still shows the card, a `<noscript>` line and all the text (~930 words). If WebGL can't start, the button says so.
- [x] **Text** (written for this page, nothing copied): what the game is, what you can do, how it was made (OSM, elevation data, the solar calculation, three.js, built live on stream at kick.com/asumagg with Claude Code), credits, links to the trailer and the source, and one line on anonymous, cookieless usage stats. **FAQ:** six questions (real lake? phone? free / install? how made? time of day? boating?).
- [x] **Structured data:** one JSON-LD graph in the head (WebSite; the game as VideoGame + WebApplication, free, WebGL 2, single player; Sukhna Lake as a LakeBodyOfWater at 30.7414 N, 76.8199 E, the area-weighted centroid of the OSM polygon, with its Hindi and Punjabi names, Wikipedia and OSM links; the author; the YouTube trailer as a VideoObject, 30 s, uploaded 2026-09-27). The **FAQPage** is generated at build time from the FAQ's own `<h3>`/`<p>` pairs (`faqSchema()` in `vite.config.js`), so the markup and the page can't disagree.
- [x] **Basics:** canonical link, `public/robots.txt` (allow all, sitemap link), `public/sitemap.xml`, `lang="en"` (with `lang="hi"`/`"pa"` on the names), the title "Sukhna Lake 3D: a morning jog in Chandigarh, in your browser" (also `og:title`, `twitter:title` and the JSON-LD name "Sukhna Lake 3D"; the page's one `<h1>` is that line, heading the About text, while the card's big "Sukhna" is a styled wordmark, not a heading) and a 150-character description; the page has no `<img>` (the preview image has `og:image:alt`).
- [x] **PostHog** (`src/core/analytics.js`): PostHog's own snippet, no npm package; EU host by default. Only in production builds (so never in dev, the playtest or the director), and not in automated browsers or with Do Not Track / Global Privacy Control. Cookieless: `persistence: 'memory'` with a fresh random id per page load, no cookies or localStorage (checked: `document.cookie` empty, only the game's own keys in storage); no session recording, autocapture, surveys or feature flags. The script is requested when the browser is idle after `load`, every call is wrapped, and a blocked script changes nothing (checked with the request blocked: the game plays, events just go nowhere). The key comes from **`VITE_POSTHOG_KEY`** at build time; without it the build has no PostHog code at all.
  - Events: `game_started` (outfit, quality_tier, device_type), `time_preset_changed` (preset), `weather_changed`, `overview_opened`, `sat_on_steps`, `sat_on_bench`, `joined_group` (laughter_club / chat), `chai`, `boat_ticket`, `boat_boarded`, `boat_docked` (ride_seconds, ride_metres), `length_completed` (lengths, run_seconds), `quality_fallback` (from, to), `webgl_unavailable`, `error` (message, script file, line; the game's own scripts only, 5 a visit), `heartbeat` every 60 s of actual play (play_minutes), plus PostHog's `$pageview` / `$pageleave`. The moments are read off the game's state once a frame (`countMoments()` in `main.js`), so no module knows about analytics. Every event was seen, with its properties: through a production build with a dummy key and PostHog's API intercepted, and through the dev test API (`window.__analytics`, dev only, lists what would be sent).
- [x] **Checks:** the playtest 11/11 (boating first timed out on a screenshot while another browser test was using the GPU; alone it passes); the production build has no console errors (with a real key; a dummy key's config request 404s).
- [x] **Error reports, narrowed** (user, after PostHog showed extension errors such as "Failed to connect to MetaMask" from `inpage.js`): an `error` event is sent only when its file is one of this site's own scripts (`https://<this origin>/…js`); extensions (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`…), other sites and code with no file are dropped. An unhandled rejection has no file of its own, so it is sent only if its stack runs through one of our scripts (that frame gives the file and line). Checked with ten synthetic errors against a production build: only the two of ours were sent.
- [x] **No WebGL, a clean stop:** a new entry, `src/boot.js`, probes for WebGL 2 before importing the game (`main.js`). Without it, the card's button says "This browser can't show 3D (WebGL is off or unsupported)" with the hint "Try turning on hardware acceleration in your browser settings." (`core/nowebgl.js`), `webgl_unavailable` is sent, and nothing else loads (no three.js, no data) and nothing throws. If the probe passes but the game's own context still fails, `main.js` shows the same card and stops with an error marked `noWebGL` that `boot.js` catches: no uncaught error (three.js still logs its own one-line console error first).

**Decisions made during the run** (newest last; each one is something the plan left open, the data forced, or the user changed):
- ~~**Phase 2: R ≈ 403 m, not 320.**~~ *Superseded by the flat world below.* (OSM measured the promenade at 2 494.9 m, which with a 40 m join gave R ≈ 403; the user chose the full walk, 1:1, and raised the high/medium NPC and bird limits by about 25%. Those limits stay: the walk is the same length.)
- **Phase 2: the working tree is LF.** `.gitattributes` sets `* text=auto eol=lf`, because `core.autocrlf=true` checked files out with CRLF and broke multi-line edits in the pipeline scripts. The repo contents are unchanged.
- ~~**Phase 2: harmonic straightening map, and the join on real land.**~~ *Superseded before approval.* The plan's normal-projection mapping folds (the dam is concave toward the lake, so its normals cross 600–1 000 m out, short of the far shore); a harmonic map fixed it (1.12 M triangles, 0 inverted). Kept in `27ca69a` for history only.
- **Re-plan (user, after Phase 2): drop the tiny planet; build Sukhna flat, at its real shape and 1:1 scale.** Real ENU coordinates are used directly: no equator mapping, no straightening, no join, no sphere bake. The promenade runs end to end (boat club ↔ Garden of Silence); V auto-jog turns round at each end and the HUD counts lengths, not laps. The rowing boats row lanes on the real lake. The Shivaliks are real DEM terrain beyond the far shore, with ridgeline rings only for the far distance. Horizon culling is replaced by distance culling and LOD, with morning haze and fog limiting how far detail has to go. The draw-call targets stay. Everything else stays: the look, the jogger, NPCs, time of day, weather, sound, controls, quality tiers, the real sun.
- **Re-plan: P becomes "P overview".** An aerial orbit of the whole lake. The hint bar now reads `WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · H hide` (the user allowed either label; "planet" no longer describes anything).
- **Re-plan: pre-dawn preset is 06:55**, which is civil dawn and 24 min before the computed sunrise (07:19). The brief's "HUD ≈ 06:55" and "about 25 minutes before sunrise" both hold.
- **Re-plan: sun values come from `src/core/sun.js`**, not the plan's estimates: 15 Jan 2027, civil dawn 06:55, sunrise **07:19 at azimuth 114.1°**, 07:45 at elevation 4.0°, 09:15 at 19.9°, sunset 17:45. (The plan had said 07:21 and 115°.)
- **Phase 2 (flat): relief shading for terrain.** A January morning sun is 0–20° up, which puts flat ground right on the cel ramp's band edge (N·L = sin elevation ≈ 1/3), so SRTM's few metres of speckle turned the ground into camouflage. `cel({ relief: true, bands: 'terrain' })` picks the band from N·L − up·L instead: flat ground is always mid-ramp and only real slopes band. Used for all terrain; other large near-flat surfaces can use it too.
- **Phase 2 (flat): the DEM is smoothed at load** (3 binomial passes on the 20 m near grid, 1 on the 120 m hill grid), because SRTM carries speckle over the flat city.
- **Phase 2 (flat): the walk follows the ground.** Its height along s is max(+2.5 m, smoothed ground within 6 m + 0.3 m), smoothed over ±40 m (`walkY(s)` in `world/index.js`). On the bund it is the planned +2.5 m crest; at the west end it climbs onto the city's higher ground (the DEM there is several metres above the lake). Phase 3's dam builds on this profile.
- **Phase 2 (flat): pass split.** Near pass 0.5 m – 1.2 km, far pass 300 m – 45 km (overlap 0.3–1.2 km). Terrain, water and pins are on both layers; the sky, clouds and hill grid only in the far pass. In the P overview the near pass stretches to 5 m – 6 km, since nothing is close. The tree mid/far switch in §4 (1.5 km) is therefore implemented as "mid-LOD trees on both layers out to 1.5 km".
- **Phase 2 (flat): spawn** is on the walk at s = 2 300 (the west end), looking along the sunrise azimuth (114°), so the opening view runs along the dam and across the lake toward where the sun will rise.
- **Phase 3: shoreCheck needed four passes and a user decision.** Grading the 10 m grid against the OSM polygon fixed most of the shore, but three islets (15, 18, 32 m across) and an 8–12 m channel of the east arm by the regulator are narrower than the grid. The user chose "islets + channel as meshes": **detail patches** (`world/patches.js`) re-sample the terrain on a 4 m grid with the exact shoreline grading around every islet and every place the water or land is under 40 m across, snapped to 40 m so the base terrain leaves a clean hole, borders matched to the base grid. One adaptive pass then adds a patch wherever a first shoreline sampling still fails. Result: shoreCheck 0 of 4 426 failing; start-up shaping ~0.5 s.
- **Phase 3: shoreline grading** (`world/shore.js`): land within 20 m of the water is held between 0.35 + 0.15·d and 0.6 + 0.2·d m (so a steep real bank cannot drag the ground above water inside the polygon), easing back to the DEM by 60 m; the water falls 0.15 m/m to a −3 m bed; a drawdown band covers the edge. The near grid is upsampled to 10 m at load for this (no new data). Ground sampling interpolates over the same two triangles per cell as the mesh.
- **Phase 3: the dam** (`world/dam.js`): one cross-section function is both the mesh and the ground. The embankment is built by casting along each normal to the OSM polygon (raw, not smoothed), so the dam's waterline is exactly the real one; inside the polygon the dam never rises above −0.27 m per metre from the edge. Terrain under the dam is cut 0.8 m below it, and never below +0.35 m on land outside the footprint.
- **Phase 3: relief ramp** `terrain: [150, 246, 255]`: flat sunlit ground at (nearly) full light; only slopes turned away from the sun take the dark band and the cool tint. Used for terrain, the walk, the dam strips, the shore band and draped city surfaces. Unclassified land is olive (`groundDry 0x9ea46c`), shading into Shivalik scrub forest with height and slope.
- **Phase 3: vegetation** is two instanced pools refilled by distance (near < 230 m: trunk + canopy per species, casting shadows; mid to 1.5 km, 3.8 km in the overview: one blob), 25 898 trees scattered from the cover grid plus a belt behind the dam's land side, masked off roads, paths, buildings, the dam and the water. Five draw calls.
- **Phase 3: city buildings** are the OSM footprints extruded floor by floor (3.3 m) in whitewash, béton brut or exposed brick (by hash), with a dark window band per floor and a parapet: Chandigarh modernist in spirit, not copies. Merged per 400 m chunk with roads, paths, parking and pitches; drawn to 2.2 km.
- **Phase 3: stylised or generic, flagged in code:** lamps, benches, bins, the 100 m markers (not real), the three water steps (OSM has none), the regulator's gates, gauge and bridge railings, the gateway frame (r2), the chai stall and vendor cart, the lake-club and Nature Centre pavilions, the Buddha figure (OSM names it; the model is generic), the swan boats (r7 colours).
- **Phase 4: play doesn't depend on pointer lock.** The game runs whenever the start/pause card is away; pointer lock only steers the mouse (embedded browsers may refuse it) and losing it (Esc) brings the pause card back.
- **Phase 4: the body has a face**: an extra `eyes` part (two small dark ellipsoids) on every body; one more instanced draw for the crowd. Only the player carries hull outlines (19 parts).
- **Phase 4: auto-jog lane** is 1.6 m to the city side of the centreline; it turns round 7 m short of each end and counts a length on every arrival at one end after touching the other. Verified: 15 simulated minutes from the east end → turned at s 6.8 and s 2 488.8, 1 length, never stuck.
- **Phase 5: crowd** (`people/types.js`, `people/crowd.js`): 200 people on high (the user's +25% limit); movers on five lanes across the walk (d −3.1 … +2.9 m) in both directions with pairs, students and dog walkers, overtaking and giving way; stationary groups at real-ish places: stretchers along the parapet, a yoga group on the grass at s ≈ 560, the laughter club at s ≈ 1 950, ten bench sitters, a photographer at the bend, the chai vendor at the plaza stall. Drawn as one InstancedMesh per body part plus four headwear pools (patka, turban, cap, monkey cap): 23 calls for the whole crowd, plus the dogs. Poses are refreshed every frame within 45 m, every 3rd to 120 m, every 6th beyond; drawn to 250 m. `crowd.setDensity` and `crowd.setBundled` (shawls and monkey caps) are ready for Phase 6.
- **Phase 5: interactions** (`people/interact.js`), one prompt at a time for the nearest thing: greet (Sat Sri Akal ji / Namaste ji / Good morning, and they answer in kind), a cutting chai at the stall (4 s, stamina to 100), join the yoga (5 s, arms up), sit on a free bench (camera settles on the lake view until you move), high five a jogger coming the other way. One speech bubble at a time, projected over the speaker's head. The player's pose takes an `override` hook for these.
- **Phase 5: rowing** (`world/rowing.js`): four lanes traced as offset curves of the real lake polygon (SDF + marching squares, Chaikin, 5 m resample) at 50, 90, 140 and 210 m from any shore or island; the eight (8 rowers + cox, 4.6 m/s, 22 strokes/min, `rowing.eight` exposes position, stroke phase and catch count for Phase 7's sound) and three sculls, each with a wake. Pedal swans leave from the boat-club jetty (`rowing.showPedal` for the after-08:30 rule in Phase 6). laneCheck: closest 49.6 m.
- **Phase 5: birds** (`world/birds.js`): 175 on high; egrets wading at the edge, cormorants and ducks swimming, crows and pigeons on the parapet (flee under 3.5 m), three flocks of ducks and cormorants resting ~28 m off the dam (inside the rowing lanes) that lift off and wheel when you pass within 110 m, and parakeets crossing overhead about every 70 s. Instanced body + two wings: about 9 calls.
- **Phase 5: npcWaterCheck** simulates 20 minutes of the crowd at 0.5 s steps and checks every standing and walking position (48 200 samples) against the lake: closest 6.3 m.
- **Phase 6: time of day** (`core/tod.js`): six keyframes by sun elevation (−10°, −5.9° pre-dawn, −0.9° sunrise, 4° golden, 10°, 19.8° bright = the base palette) hold sky, sun glow and disc, stars, clouds, haze colour and density, the four lights, the grade, water, ridges and mist; the look between them is a straight blend (haze density in log space). The clock opens at 06:55 and runs at 4× only while playing; T jumps to the next preset (wrapping). The look is recomputed about every 0.1 game-minute, or every frame while the weather eases. `?t=predawn|sunrise|golden|bright` and `?w=rain|fog` for testing; `__shot` takes `{ time, weather }`.
- **Phase 6: the sky** gains a hard stylised sun disc (~1.5° across) with a tight halo, a stepped glow round the sun strongest along the horizon, and procedural stars; the dome is finer (96×64) so the disc stays round. The key light's direction never drops below 3° (its intensity is 0 below the horizon).
- **Phase 6: water shader** (`world/lake.js`): body colour by time, Fresnel toward the sky's haze in soft steps, two octaves of drifting wave normals, and the sun's glitter path as hard sparkles; rain adds rings near the camera. A `simple` flat mode is ready for the low tier.
- **Phase 6: mist** (`world/mist.js`) is 140 upright soft banks (4–9 m tall, 60–130 m wide) standing on the real lake at least 25 m from any shore, turned to the camera, drifting; opacity full at pre-dawn and gone by ~10°. Flat sheets were invisible edge-on from the walk. Valley haze in the hills is left to the haze density (no separate sheets).
- **Phase 6: weather** (`core/weather.js`): K cycles clear → rain → fog, easing over ~3 s. Rain: 1 800 streaks round the camera (one LineSegments), greyer sky and clouds, haze ×3.2, sun ×0.3, saturation −28%, water rings, no glitter. Fog: 6–70 m as FogExp2 density 0.028 (≈3% at 6 m, ≈98% at 70 m; the fog *type* is never switched, which would recompile every material), muted palette, ink fade 10–55 m, far pass skipped, crowd ×0.45 and bundled in shawls and monkey caps, mist off. The clear colour is pre-decoded because three encodes a clear colour set outside a render-target pass to sRGB; without that the fog background was lighter than the fogged world.
- **Phase 6: crowd by time**: 0.3 before sunrise −30 min, rising to 1 at −10 min, full to +70 min, thinning to 0.55 by +160 min; ×0.45 in fog. Pedal swans go out from 08:30, in clear weather only.
- **Phase 6: signs** (`world/signs.js`, after `document.fonts.ready`, system fonts): the gateway board "Sukhna Lake / सुखना झील / ਸੁਖਨਾ ਝੀਲ" (OSM's name, name:hi, name:pa), the chai stall "Chai · Nimbu Paani" in all three, a boating board at the jetty ("Boating" is OSM's name; "नौका विहार" and "ਬੋਟਿੰਗ" are standard renderings, not from OSM), four "Please keep the lake clean" boards on the verge, and distance plates on the 100 m markers (one atlas). Six draw calls. Lit like everything else, so they dim before sunrise.
- **Phase 6: not done, and why:** lamp heads don't glow at pre-dawn (the lanterns are merged into the lamp instances; a separate emissive mesh would add a call per sector). Left for Phase 8 if the budget allows.
- **Phase 6 additions: the loop point.** The morning ends at **10:30** (sun ~30°, 75 min after the bright preset; 54 real minutes after 06:55 at 4×). After T to sunset, the evening ends at **sunset + 30 min (18:15)**, near the end of civil dusk. Either way: a 1.2 s fade to black, the next-morning card for ~2.3 s (the clock is reset to 06:55 while black), a 1.2 s fade back; the clock is held during the fade. Weather carries over. T from sunset wraps straight to pre-dawn, without the fade. (`LOOP` in `core/tod.js`.)
- **Phase 6 additions: evenings.** T cycles pre-dawn → sunrise → golden → bright → sunset → pre-dawn. Labels after noon read afternoon / evening / sunset / dusk; evening mist is a quarter of the dawn mist; the evening crowd is 0.9 (× 0.45 in fog); pedal swans are in by 17:15.
- **Phase 6 additions: lamp glow** is a per-vertex `aGlow` attribute (1 on the lantern glass) and a warm emissive term chained onto the lamp material's shader, so it adds no draw calls.
- **Phase 7: sound** (`core/sound.js`), all synthesised, no recordings. Buses: ambience (ducked under the music), rain (never ducked), music (low-pass + soft saturation, echo send), into a master with a fog muffle (low-pass 18 kHz → 5.5 kHz in fog) and a gentle compressor. Beds: water lapping (band-passed noise in slow swells, gain from the camera's distance to the real shoreline, panned to the water), wind and leaves (gusting), rain on the ground and rain on the water. One-shots, each placed with an equal-power PannerNode at its real position: birdsong by sun elevation (red-wattled lapwing calls before dawn; the dawn chorus of bulbuls, mynas, sparrows; crows later; a dusk chorus), parakeets screeching as their flock crosses, a rush of wings when a resting flock lifts off, the eight's catch splash and oarlock on every stroke and the cox every seventh (babble plus a bubble within 160 m: "Ready… row!", "Power ten!"...), footsteps on each gait half-cycle and breathing every other step (louder when tired or sprinting), a scooter horn from the city side every 25–60 s (half as often before dawn), the laughter club's bursts, and chatter from about one in three walkers you pass (formant babble plus a bubble: "Ki haal aa?", "Aaj thand bahut hai!"...). Audio starts on the Start click (browsers need a gesture); M toggles and is remembered; paused mutes.
- **Phase 7: pointer lock** requests now swallow the embedded browser's rejection (it was logging an uncaught error per click).
- **Phase 8: quality tiers** (`core/quality.js`): one table read by the modules at build time: pixel budget 4.6 / 2.8 / 1.3 MP, shadow map 2048 / 1024 / 1024, water shader / shader / flat, dressing 100 / 75 / 45% (trees, reeds; every other palm on low), NPCs 200 / 125 / 50, birds 175 / 100 / 35, trees near/mid 230–1 500 / 150–1 000 / 100–600 m, city detail 2 200 / 1 400 / 800 m, hills full / full / half resolution, mist banks 140 / 100 / 50, rain streaks 1 800 / 1 200 / 700. `?q=` wins; else a session fallback; else detection (touch or ≤ 4 GB → low, ≤ 4 cores → med, else high).
- **Phase 8: the pixel budget may now render under native resolution** (down to 0.5×, upscaled by the final pass): at 1900×1320 the low tier renders 1367×950. Before, the budget only limited supersampling, so it never helped a slow device.
- **Phase 8: run-time fallback.** After a 10 s settle, frames over 22 ms for 5 s (tab visible) drop one tier for what can change live — pixel budget, shadow map, crowd (`crowd.setCap`), mist — and store the tier in sessionStorage, so a reload builds it throughout. Tested with synthetic frame times: high → med → low.
- **Phase 8: the city detail distance** stays at 2.2 km on high (the Phase 3 decision), not the §6 table's 1.2 km; med and low scale down from it.
- **Phase 8: verification spots and the r1 mismatch.** The spots are in docs/compare.md. r1 shows the sun rising over the lake at the garden end, but there the lake lies NNW and the January sun rises at 114° (ESE), behind the camera; the game keeps the real sun and frames r1 along the walk.
- **Playtest: the dev-only test API.** `window.__test` (`src/dev/testapi.js`) is loaded by a dynamic import behind `import.meta.env.DEV`, so Vite drops it from production (checked: no `__test` in `dist/`). `main.js`'s per-frame logic moved into `tick(dt)` so the bot can run game time without drawing (`__test.advance`).
- **Playtest: `?nolock`** stops pointer lock (the bot's mouse stays free); Esc then pauses and resumes directly.
- **Playtest: stairs are walked at 1.6 m/s** (a brisk stair pace), whatever the jog or sprint speed; the height snaps up to a higher tread and eases down at 40/s.
- **Playtest: the collider stands on a foot, not a point** (±0.1 m along the flight, with the 5 cm lip), the landing counts as a tread, and treads win over the jetty deck.
- **Playtest: city stairs follow the real ground** (`groundFlight`), so tread count and runs vary per stair; the six stay at OSM's positions.
- **Playtest: ground below lake level is walkable land** outside the lake polygon; only inside it is the surface held at the water.
- **Playtest: the world edge** is 20 m inside the detailed terrain grid.
- **Playtest: lengths count in 25 m end zones.**
- **Playtest: crowd density counts leaders** (pairs and groups come and go together).
- **Playtest: the near-camera fade is 2.0 → 1.0 m.**
- **Playtest: interactions run on game time and are all cancellable** (a high five is instant); the laughter club is joinable.
- **Boating: the shack stands on the walk** (lake side, against the parapet, 2.4 × 1.4 m), next to the gateway as asked; the collider blocks it and the lake-side walking lanes bend in round it (to d ≤ 2.0 m).
- **Boating: the boat is its own physics** (`createBoatSim` in `core/boat.js`, no meshes), so `boatWaterCheck` exercises exactly what the player drives. The shore distance is memoised on an 8 m grid (exact within 12 m of a shore).
- **Boating: margins** 2 m for the boat's centre from the real shoreline, 0.6 m for the bow and stern; docking within 6 m of a free berth.
- **Boating: the player's boat is a separate mesh** while out; boarding empties the berth in the moored swans' instanced mesh and docking fills one (`club.setBerth`), in the boat's colour.
- **Groups: circles are data in the crowd** (`crowd.circles`, `joinCircle` / `leaveCircle`); the laughter club laughs on one clock (`crowd.laughBurst`), which the player's pose and sound share. Yoga stays a 5 s join (a class facing a teacher is not a circle).
- **Groups: Esc with the pointer locked** arrives as the lock's release: in a circle that leaves the circle (the game goes on, a click locks the mouse again) instead of pausing.
- **Re-plan: the promenade direction.** Arc length s runs from the east end (s = 0, Garden of Silence / regulator footbridge) to the west end (s = 2 494.9 m, boat club / entrance plaza). This is only a labelling choice now; nothing is mirrored in a flat world.
- **The day opens at sunrise** (user, after the SEO pass): the game starts at the sunrise preset, 07:19, not at civil dawn (06:55, the plan's §0 default), and the next-morning loop comes back at sunrise too. Pre-dawn is still one T press away (T cycles sunrise → golden hour → bright morning → sunset → pre-dawn), and `?t=predawn` still opens there. The HUD's placeholder clock, the next-morning card, the page's About and FAQ text and the README say so. The director's shot lists set their own time, so the videos are unaffected.

**What Phase 2 (planet version, `27ca69a`) leaves for reuse:**

| Keep as-is | Reuse with changes | Delete |
|---|---|---|
| `fetch-osm.mjs`, `overpass.ql`, the raw OSM (`raw/osm-…-2026-09-26.json`) | `config.mjs`: drop `MAP`, `LATTICE`, `L_JOIN`; add terrain grids and LOD distances | `lib/straighten.mjs` (harmonic map, compression, inverse, fold check) |
| `lib/png.mjs`, `lib/terrarium.mjs`, `lib/pngenc.mjs` | `fetch-terrain.mjs`: add z12 tiles for the hill grid | planet-space cover and DEM lattices |
| `lib/geo.mjs` (ENU projector with exact inverse, polylines, `simplify`/`simplifyRing`, `stitchRings`, `pointInRing`) | `build-data.mjs`: keep the promenade selection and orientation, origin, lake rings, cover classes, landmarks, steps, measures, sun presets and the ridgeline ray-march; write ENU instead of (x, z) | `src/data/sukhna.flat.json` (planet-vs-real debug) |
| `src/core/sun.js` (NOAA, verified) | the report: real measures and checks, no distortion tables | runtime `src/world/planet.js` (the bake), `R` |
| raw Terrarium tiles (z11, z13) | | |

**Real measurements already established** (from Phase 2, `scripts/sukhna/report.md` in `27ca69a`):
- Promenade (`way/1024118089`, paved, pedestrian): **2 494.9 m** end to end. The bund is 2 073 m (east end → the west bend where the downstream footways meet the walk); the west-shore stretch to the boat club is 422 m.
- Lake (`relation/8421510`): 1.363 km², perimeter 8.51 km, extent 2 209 × 1 305 m (E × N), longest span 2 266 m, 4 islands. Water level from the DEM median: **353.2 m**.
- Landmarks (s from the east end): Buddha statue (`node/3649893943`) s ≈ 16, Garden of Silence (`way/360443301`) s ≈ 31, regulator and footbridge just past the east end, Chandigarh Golf Club s ≈ 1 644 (240 m off), viewpoint at the bend s ≈ 2 056, Sukhna Lake viewpoint s ≈ 2 390, boating s ≈ 2 395, entrance plaza (derived from the west-end amenities) s ≈ 2 417, lake-club tennis courts north of the west end.
- Six real stairs, all down the **downstream (city) face** to parking: s ≈ 304, 612, 917, 1 225 (Stair n°3), 1 524 (Stair n°2), 1 898 (Stair n°1). OSM maps no steps to the water.
- DEM: the city side around the golf course is about 3 m below the lake; the Kansal foothills about 4 km NE reach ~84 m above it; the Kasauli ridge about 30 km NE reaches ~1 830 m ASL.

**Notes for a fresh session:**
- Dev server: `npm run dev` → http://127.0.0.1:5178 (config in `.claude/launch.json`, name `dev`). Keep one running; check with the Browser pane's server list before starting another.
- `.ref/` is not in git. If it is missing, clone it with the command in the status line.
- **Boating and circles:** `core/boat.js` (the boat and its physics), `people/interact.js` (tickets, boarding, docking, joining), `people/crowd.js` (`circles`), `world/landmarks.js` (`club.berths`, `club.setBerth`, `club.shack`, `SWAN_SEAT`).
- **Production:** https://sukhna-lake.trymurmur.studio (Vercel, from GitHub; never deploy by hand). The old `*.vercel.app` address 301s to it (`vercel.json`). Usage stats need `VITE_POSTHOG_KEY` set in Vercel's environment variables (see SEO above).
- **Director (videos):** `node tests/director/record.mjs <name>` or `--all` with the dev server up; stills with `--preview 2,8`; lists in `tests/director/*.json`; videos in `recordings/` (git-ignored). See `tests/director/README.md`.
- **Playtest:** `npm run playtest` (all eleven, ~10 min) or `npm run playtest -- <name>`; headed Chrome on the real GPU, reusing the dev server on 5178. Results in `tests/playtest/report/` (git-ignored). See `tests/playtest/README.md`.
- **Data:** `node scripts/sukhna/build-data.mjs` rebuilds `src/data/sukhna.data.json` (211 KB, vectors in ENU) and `src/data/sukhna.terrain.json` (247 KB, Int16 grids) from `scripts/sukhna/raw/` in ~1 s; see `scripts/sukhna/README.md` and `report.md`. All pipeline checks pass (walk length within 0.79 m of OSM, lake polygon simple, walk never in the lake).
- **State after Phase 3:**
  - World build order (`world/index.js`): dam profile on the raw DEM → shore grading outside the dam → dam cut → overlay installed → detail patches (+1 adaptive pass) → meshes → checks. `groundAt(e, n)` = dam overlay, else detail patch, else near grid, else hill grid; `world.heightAt` never goes under the water surface.
  - Modules: `world/dam.js` (profile `walkY(s)`, `damHeight(s, d)`, `shoreOffset(s)`, `footprint`, `inFootprint`, sector meshes + far LOD, dressing, stairs, `WATER_STEPS` = s 240 / 530 / 820 / 1150 / 1480 / 1790 / 2090 plus the jetty stair at 2395, since the reviews after Phase 8), `world/shore.js` (grading, drawdown band), `world/patches.js`, `world/vegetation.js`, `world/cityside.js`, `world/landmarks.js` (garden + statue, regulator + footbridge, plaza + gateway + chai stall + cart, boat-club jetty + swans + launch, OSM piers, pavilions, amenities), `world/checks.js` (`shoreCheck`, `damCheck`, `hillSafety`, plus `waterMarginCheck` and `laneCheck` ready for Phase 5), `core/sky.js` `buildRidgeRing`.
  - Landmark handles for Phase 4/5: `world.landmarks.plaza` (`kiosk` [e, n], `cart`, `gate` s), `world.landmarks.club.jetty` ({ s, d0, d1, deckY }), `world.dam.cityStairs` / `waterStairs`, `world.debug` (ground functions for the console).
  - Checks (dev start-up, `window.__checks`): shoreCheck 0/4 426 fail; damCheck walk ≥ 2.50 m; hillSafety 0.00 m.
  - Known gaps: parapet blocks step where the walk climbs at the west end (reads as masonry, left as is); no terrain colour for city parks beyond the OSM cover; the water is still a flat colour (Phase 6 shader).
- **State after Phase 4:**
  - `people/body.js`: the parametric body (a row of numbers → 20 parts; `poseBody` FK writes one Matrix4 per part relative to the root; upward parts use a half-turn, never a mirror, so instances stay right side out); `OUTFITS` (3). `people/gait.js`: phase-driven gait from speed (walk → run blend, bent elbows, bounce, lean, twist; `style` rows for NPCs; `sit`).
  - `core/jogger.js` (movement, stamina, V auto with turnaround, lengths, pace; `avoid` hook for the crowd; `frozen`/`sitting` for interactions), `core/camera.js` (boom 0–5.5 m, first person under 0.35 m, V drift toward the lake, `bench` view, P overview), `core/hud.js` (jog HUD, hint bar `HINT`, prompt, toast, speech `say()`, start/pause card with outfits and credits, C coordinates), `core/touch.js` (stick → the same key codes; drag look; pinch zoom; E V T K P M H buttons), `world/collide.js` (`surfaceAt` with the jetty and footbridge decks; `move` with sliding; water, parapet except the water steps, building footprints).
  - `main.js` `actions` table: E → `world.interact`, T → `world.cycleTime`, K → `world.cycleWeather`, M → `world.toggleSound` (placeholders toast until Phases 5–7 add them); `world.benchView()` feeds the camera.
  - `__shot` opts now place the jogger: `{ s, d, az, heading, pitch, boom, first, hideJogger }` or `{ e, n, … }` or `{ overview }`.
- **State after Phase 5:**
  - `world.crowd` (`people`, `setDensity`, `setBundled`, `update`, `avoid` — wired as `jogger.avoid` —, `near`, `positions`, `simulate`), `world.rowing` (`lanes`, `boats`, `eight`, `showPedal`, `laneSamples`), `world.birds`; all updated from `world.update(dt, viewPos, overview, jogger)`. `buildWorld(scene, { npcs, birdCount })` takes the tier's counts (Phase 8).
  - `main.js`: `interact = createInteractions(...)`; E → `interact.activate()`; `interact.benchView()` feeds the camera; `__scene.interact` for the console. T/K/M are still placeholders.
  - Checks at dev start-up: shoreCheck 0/4 426; damCheck ≥ 2.50 m; hillSafety 0.00; npcWaterCheck closest 6.3 m; laneCheck closest 49.6 m.
  - World build ~1.5 s in dev (shaping ~0.7 s, people/boats/birds ~0.4 s).
- **State after Phase 6:**
  - `core/tod.js` (`createTod`, `applyLook`, `PRESETS`), `core/weather.js` (`createWeather`: `state { kind, rain, fog }`, `cycle`, `set`), `world/mist.js`, `world/signs.js` (`world.signs.ready` is a promise), `world/lake.js` (`set`, `update`, `simple`). `main.js`: `updateTime(dt, running)` pushes the look, the HUD clock and label, crowd density and bundling, and the pedal boats; T and K are live; `__scene.tod`, `__scene.weather`, `__scene.updateTime`.
  - Pipeline: `pipeline.skipFar` (set in fog).
  - `buildWorld(scene, { npcs, birdCount, simpleWater, mistSheets })` takes the tier's settings (Phase 8).
- **State after Phase 7:**
  - `core/sound.js` (`createSound({ world, jogger, tod, weather, interact, onChange })`: `start` (from a gesture), `toggle`, `update(dt, camera, playing)`, `enabled`, `music`, `mode` ('gen' | 'tracks'), `nodes` for dev analysers); `__scene.sound`.
  - `people/interact.js`: `steps` sitting, `seated`, `say(who, text, secs, delay)` (used by the sound for chatter and the cox), `benchView()` returns `{ yaw, pitch?, boom? }`. `core/camera.js` honours `pitch` and `boom`.
  - `world.dam.waterStairs[i].treads` = [{ d, y, d0, d1 }]; `world.birds.parakeets`, `world.birds.flocks`.
  - `vite.config.js` `localTracks` plugin; `public/audio/README.md`.
- **State after Phase 8 (the end of the run):**
  - `core/quality.js` (`Q`, `TIERS`, `lower`); `main.js` `watchFrameTime` (the fallback; on `__scene` for tests); `__bench` reports the tier.
  - docs/compare.md (reference photos vs the game, the numbers, the camera spots) and docs/shots/ (29 verification shots plus 3 seated views).
  - `.claude/launch.json` has `dev` (5178) and `preview` (5179).
- **Measured at the end of Phase 8** (RTX 4080 SUPER, 1900×1320 window, `__bench(150)`), worst views: high 268–384 calls / 1.0–1.26 ms at 2573×1787; med 255–321 / 1.0–1.17 ms at 2007×1394; low 248–307 / 0.9–1.0 ms at 1367×950 (targets: high ≤ 900, low ≤ 350). Production build: `npm run build` (index 181 kB, three 710 kB, data 469 kB before gzip; 73 / 183 / 206 kB gzipped) and `npm run preview` load and run with no console errors; `?checks` passes all six checks there, at low too (50 people, 35 birds, 11 851 trees, world built in 1.35 s).
- **Measured at the end of Phase 7** (same GPU, 800×555 pane): seated on the steps at golden hour, 288 calls / 1.23 ms. The audio graph costs no draw calls; the beds are 6 looping noise sources.
- **Measured at the end of Phase 6** (same GPU; spawn looking at the sunrise, 1400×800): pre-dawn 297 calls, sunrise/golden 375, bright 383; rain on the walk 377 calls / 1.03 ms; fog 204 calls / 0.88 ms (far pass skipped).
- **Measured at the end of Phase 5** (same GPU, 1900×1320): spawn 381 calls / 1.22 M tris / 1.24 ms; laughter-club stretch along the walk 376 / 1.05 M / 1.28 ms; mid-walk across 279 / 1.32 M / 1.08 ms; overview 272 / 1.29 M / 1.08 ms.
- **Measured at the end of Phase 4** (same GPU, 1900×1320): spawn 255 calls / 0.94 M tris / 0.57 ms; mid-walk across 196 / 0.99 M / 0.55 ms; bend 245 / 0.98 M / 0.58 ms.
- **Dev hooks:**
  - `window.__scene` exposes the scene objects and `data`.
  - `window.__shot(name, W, H, opts)` writes `.shots/<name>.jpg` and returns draw calls. opts: `{ s, d, az, pitch, h }` on the walk (s from the east end, d toward the lake, az compass degrees, pitch degrees, h eye height), `{ e, n, az, pitch, h }` anywhere, or `{ overview: bearingDeg }`.
  - `window.__bench(n)` gives GPU-synced ms per frame, draw calls and the GPU name.
  - `?stats=1` live readout; `?flat=1` map panel. Keys: drag to look, WASD (Shift faster), P overview, O ink, G grade, R reset.
- **Measured at the end of Phase 2 (flat)** (RTX 4080 SUPER, ANGLE/D3D11, window 1900×1320, internal 2573×1787), `__bench(200)`: spawn 52 calls, 96k tris, 0.47 ms; mid-walk looking across the lake 69 calls, 109k tris, 0.28 ms; P overview 83 calls, 141k tris, 0.38 ms.
- **Measured at the end of Phase 3** (same GPU, 1900×1320 window), `__bench(150)`: spawn 196 calls / 0.94 M tris / 0.55 ms; bend looking across the lake 168 / 0.95 M / 0.52 ms; mid-walk across 135 / 0.98 M / 0.56 ms; along the walk 159 / 0.83 M / 0.53 ms. Start-up world build ~0.7–0.8 s (shaping ~0.5 s).

## Parked experiments

- Bundled Noto fonts for the Hindi and Punjabi names (Risk 12: some Linux desktops lack Devanagari and Gurmukhi): stays parked (user, during the SEO pass).
- Compare the embankment (r2, r8) and swans (r7) against the reference photos and fix clear mismatches; optional, the user likes the current boats.

## Final summary (end of Phase 8)

**What was built.** Sukhna Lake at its real shape and 1:1 scale, as a three.js cel-shaded jog:
- **The world:** the 2.5 km dam promenade on the real OSM curve, the real lake and its islands, the city side, and the Shivaliks from DEM terrain to 45 km.
- **The morning:** the real sun on 15 Jan 2027, running at 4× from civil dawn, with the look keyed to sun elevation. Mist, rain and fog; lamps that follow the light. A loop to the next morning, and a sunset preset.
- **Life:** a 200-strong part-instanced crowd with stationary groups, a jogger with stamina, auto-jog and E interactions, the eight and sculls on real-lake lanes, and 175 birds.
- **Signs and sound:** trilingual signs, and WebAudio sound synthesised in code, with a generated lo-fi loop when you sit on a bench or the water steps.
- **Around the game:** quality tiers with a run-time fallback, touch controls, and six self-checks.

**Files** (≈ 9 400 lines of source):
- `src/core`: camera, hud, jogger, outline, palette, perf, post, quality, sky, sound, sun, textures, tod, toon, touch, util, weather.
- `src/people`: body, crowd, gait, interact, types.
- `src/world`: birds, checks, chunks, cityside, collide, dam, flat, frame, index, lake, landmarks, mist, patches, rowing, shore, signs, terrain, vegetation.
- `src/main.js`, plus the data pipeline in `scripts/sukhna/` and the generated data in `src/data/`.

**Real data or photo-based:**
- **From OSM:** the promenade curve and length, the lake polygon and islands, the shoreline the dam meets, the city footprints, roads, paths, pitches and golf course, the six real city-side stairs, landmark positions, and the lake's names in three scripts.
- **From the DEM:** the terrain and the far ridgelines.
- **From NOAA:** the sun's times and positions.
- **From the photos:** the colours and forms of the walk, parapet, embankment, palms, benches, pedal boats, launch, gateway and plaza pavers.

**Stylised or invented (flagged in code):** the lamps, benches, bins and 100 m markers; the three water steps (OSM has none); the regulator's gates; the gateway frame; the chai stall and cart; the pavilions; the generic seated statue; the swan boats; the city buildings (Chandigarh modernist in spirit, not copies); the crowd, birds and rowing; all sound and music.

**Known limitations:**
- No water reflections.
- The embankment is narrow where the real shoreline comes close to the parapet (r2 and r8 show a wider slope at their spots).
- The garden end lacks r1's gazebo, flower beds and fence.
- Forest areas read as flat dark patches from the air.
- The chatter and cox calls are babble with the words in bubbles; synthesised speech isn't intelligible.
- Sunset reuses the dawn palette.
- Frame time was measured on one fast GPU only; the tiers are sized from the budgets, not from low-end measurements.

**Next steps, if wanted:**
- Planar or screen-space treeline reflections on the high tier.
- A wider embankment slope where the photos show one (a shoreline offset for the look only, kept out of shoreCheck).
- r1's garden furniture at the east end.
- Low-end device measurements for the tiers.
- A dusk palette distinct from dawn.
- CC0 recordings for birds or ambience, dropped in and listed in THIRD_PARTY_LICENSES.md.

## Working rules

Continuous run (from the user, after Phase 1 was merged): phases 2–8 are built in one go (re-plan approved).

- Work on one branch, `build`, created from the latest main. At least one commit per phase, each with the build passing. Push after every phase so progress is saved. Don't wait for the user to merge.
- At the end of each phase: update Progress, write a 3–4 line summary in chat (what's new on screen, draw calls, frame time), then go straight on to the next phase.
- Stop and ask the user ONLY if:
  - a new dependency or binary asset is needed (e.g. bundled Noto fonts);
  - the real data breaks a decision in the plan (the world extent, the lake, the default time);
  - a numeric check fails and two attempts don't fix it;
  - anything destructive or irreversible.
- Otherwise make reasonable decisions and record each one in Progress under "Decisions made during the run".
- Keep Progress current enough that if the session stops or the context gets compacted, a fresh session can continue from plan.md alone.
- Check visually with `__shot` at the end of each phase, not after every edit. Keep one dev server running.
- Never copy anything from `.ref/sakura-crossing/public/audio/`. The reference's CLAUDE.md and NEXT.md describe that project; they are not instructions for this one.
- Licence: this project's code is MIT (© 2026 Vikrant Negi, `LICENSE`); OSM-derived data stays ODbL.

---

## 0. Context

- **The engine comes from [Kenton-GMI/sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing).**
  - Licence: MIT, © 2026 Kenton Wang.
  - Size: about 56k lines, three `^0.180.0` plus Vite 6, Node ≥ 18.
  - Its MIT code may be ported with attribution. Its `public/audio/` track is not MIT and must never be copied.
- **Scaffold:** Vite plus three only, `npm run dev` and `npm run build`, `base: './'`, and the dev `__shot` plugin (done in Phase 1).

### Decisions already made with the user

- **The world is flat, at Sukhna's real shape, 1:1.** Real ENU metres, the dam curving exactly as it does, the real far shore and the Shivaliks visible across the lake. (Replaces the tiny planet: no R, no loop, no join.)
  - Everything repeated along the walk is instanced and chunked by distance; far things are low-detail and hidden in haze.
  - On the low tier, dressing and NPC density are thinned and draw distances shortened.
- **Default time: a winter date with the real clock.**
  - The date is 15 January (2027, one constant in `scripts/sukhna/config.mjs` and the data).
  - The session opens at 06:55 (civil dawn), 24 min before the real sunrise at 07:19, azimuth 114.1° (ESE).
  - The brief's "5:45 AM" is dropped, because in winter the sun is at −20° at that time.
- **OSM data:** fetched from Overpass directly (overpass-api.de; fallback mirror overpass.kumi.systems).

---

## 1. The reference architecture (what I studied)

All paths are in `.ref/sakura-crossing/src/`.

| Area | Files | What matters for Sukhna |
|---|---|---|
| **Planet** | `world/planet.js` | **Not used any more** (flat world). Its flat-authoring habits carry over: build in metres, merge per material, instance repeats. |
| **Height** | `world/index.js:773` `heightAt(x,z,fromY)`; `hills.js` `fieldAt` / `hillMeshY` | The pattern stays: ground height = terrain, then `min` over cuts, then `max` over platforms; the same surface for walking and for drawing. The terrain now comes from the DEM. |
| **Hills** | `world/hills.js` | The slope-limiter and `hillSafety` ideas are reused on the DEM terrain near built things. |
| **Lake** | `world/lakeform.js`, `world/lake.js` | The water is a flat surface; now it is the real OSM polygon at the real level. The reference's leak idea becomes `shoreCheck` (§8). Water layer and ripple ideas are reused. |
| **Dam** | `world/lakeroad.js` | Riprap, kerbs, spillway, intake and gauge pieces feed the regulator and the embankment. |
| **Lakeside** | `world/kohan.js` | `timberDeck` (jetty), `boardwalk`, `makeBoat`, lamps, benches, a boat station and a pedal boat. |
| **Dressing rule** | `world/railway.js:29-38` | "The dressing appears only where the district is": still true along the walk. |
| **Train** | `world/train.js` | Not used as such; the boats follow lane polylines on the real lake (§6). |
| **Look** | `core/toon.js`, `post.js`, `outline.js`, `palette.js`, `sky.js` | Unchanged: cel ramps with tinted shadows, the ink / grade / FXAA pipeline, hull outlines, the painted sky. |
| **Canvas2D signage** | `core/textures.js` | Helpers exported in Phase 1, with three font stacks. |
| **Utilities** | `core/util.js` | `bake`, `trs`, `rngKit`, `shadowify`, `sstep`. |
| **Player** | `core/player.js` | Pointer-lock mouse look and collision ideas; movement becomes the jogger's. |
| **HUD / audio** | `core/hud.js`, `core/audio.js` | Prompt and toast kept; audio replaced by WebAudio synthesis. |
| **Parametric vehicles** | `world/vehicles.js` | "A type is a row of numbers": reused for bodies, boats, scooters and cars. |
| **Trees and particles** | `world/trees.js`, `world/petals.js` | Grove building and instanced particles, now with distance LOD. |
| **Dev screenshots** | `vite.config.js` `frameGrabber` | Ported in Phase 1. |

**Performance rules (measured in the reference's `CLAUDE.md`):**
- The scene is limited by draw calls: about 1 400 calls take 11 ms, and about 3 050 take 20 ms. Triangles and fill rate barely matter.
- Merge per material with `bake`, and instance anything repeated.
- Frustum-cull everything with real bounds (the reference measured ~8 ms saved).
- Thin or transparent sheets get `depthWrite: false` and `noOutline`.
- Canopies never receive shadows.

### What the reference lacks and Sukhna needs

- People and NPCs; a visible player body and a third-person camera.
- Time-of-day cycling, a sun disc and a sky that react to the real sun.
- Weather (rain, fog) and morning haze that sets the view distance.
- Auto-move, a jogging HUD and stamina.
- **A large real-scale world:** DEM terrain to the Shivaliks, distance culling and LOD, and a depth set-up that reaches 40 km without breaking the ink pass (§4).
- Ridgeline rings for the far ranges only.
- Touch controls, WebAudio ambience, quality tiers, Indic fonts, URL parameters, a draw-call and frame-time readout, automatic self-checks.

---

## 2. Reference photos: the look list

*(Unchanged.)*

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
- Terracotta interlocking pavers (#c77d5e / #b0664a), flower beds, a low dark-green chain-link fence (#2f4a33, the only "railing" seen), a thatched gazebo (#5a4a3a), carved grey stone seats and sculptures, a blue signboard with white text (#2f8fcf), red-brown wooden benches on dark frames (#8a4a32), a small white or grey dustbin.

**Boat club (r7, r9, r2)**
- A jetty edge of grey-blue pavers (#8ea0b3) with a red-pink border pattern.
- A long row of pedal boats in blue #3f7fd0, sky-blue #62a8e6, yellow #f2c230, red #d23b35 and orange #f08a2e, some with swan or dragon heads. These will be stylised swans; no brands.
- A pink-red launch (#d84a6a). A white gateway frame with red posts (r2, left).

**Sculls and rowing (r6)**
- Slim white shells, low in the water, rowers as dark silhouettes against the glare.

**Water**
- At dawn: silver-peach, carrying the sun's glitter path (r1, r6).
- In bright morning: steel grey-mauve (#8c96a6) with long treeline reflections (#5d6b4a) (r2).
- At low sun: turbid khaki (#c9b27a) (r8).

**Sky and hills**
- **Sunrise:** the sun is a hard disc (#ffd55a) in orange haze (sky #e7a35a → #d9a066). At dawn the far shore shows only as a treeline in haze and the hills disappear (r1).
- **Hills in clearer light:** layered, low-contrast blue-grey ridges (#7d8aa3 near, #a9b3c6 far), as in r6 and r7. **Now real terrain** out to ~15 km, tinted by aerial perspective; only the farthest ranges are sky rings.
- **Bright morning:** zenith #6fa3f5 fading to a very pale horizon #c9e0f7 (r2).

**Not confirmed by any photo (kept generic and flagged in code):**
- Lamp posts: a simple tall pole with a lantern head.
- Distance markers: invented, stylised (every 100 m of s).
- The statue: OSM names it a Buddha statue; it will be a generic, respectful seated figure on a plinth, not a copy of the real sculpture.
- The lake-club building, the regulator's gates.
- Modernist concrete on the city side: stylised, not a copy of any real building.

---

## 3. Real-data pipeline (`scripts/sukhna/`, run at build time, never at runtime)

Plain Node 18 `.mjs`, **no new dependencies** (PNG via `zlib`, sun via `src/core/sun.js`).

| File | Does |
|---|---|
| `config.mjs` | The OSM bbox, the promenade way ids, the date, terrain grids (extent, resolution), LOD and draw distances that the data has to support, simplification tolerances. |
| `fetch-osm.mjs` + `overpass.ql` | Unchanged from Phase 2. Raw result in `raw/osm-<bbox>-<date>.json`. |
| `fetch-terrain.mjs` | Terrarium tiles: z13 around the lake (have), **plus z12 over ~30.65–30.90 N, 76.72–77.00 E** for the hill grid (≈ 25 tiles, ≈ 1.5 MB), plus z11 for the ridge rings (have). |
| `lib/png.mjs`, `lib/terrarium.mjs`, `lib/geo.mjs`, `lib/pngenc.mjs` | Unchanged from Phase 2. |
| `build-data.mjs` | Reads `raw/*`, writes the two data files and the report (below). |
| `README.md` | How to re-run the pipeline, provenance, and licences. |

**World frame:** ENU metres about the promenade midpoint (30.736835 N, 76.817938 E), exact through ECEF. In three.js: **x = east, z = −north, y = up, y = 0 at the lake level (353.2 m ASL).** No mirroring, no distortion; 1 unit = 1 m everywhere.

**Outputs:**
- `src/data/sukhna.data.json` (vectors, target ≤ 300 KB): the promenade polyline with arc lengths and a smoothed centreline; lake outer ring and islands; landuse polygons (forest, scrub, park, golf, grass, parking, pitch, wetland, built) simplified by distance from the walk (0.5 m near, 5 m far); buildings as real footprints with levels (only within ~1.2 km of the walk; the rest become generic city blocks); roads and paths; waterways; piers; landmarks and steps (with s, real position, source); measures; sun presets; far ridgeline rings.
- `src/data/sukhna.terrain.json` (heights, base64 Int16 decimetres relative to the lake level, target ≤ 250 KB):
  - **near grid**: the lake basin, ~5 × 4 km at 20 m (the DEM's own resolution is ~30 m; finer detail near the walk is procedural, §4);
  - **hill grid**: ~26 × 22 km centred NE of the lake at 120 m, for the Shivalik front;
  - a **cover grid** (RLE, 10 m over the near grid) so terrain colour and tree scatter follow the real landuse.
- `scripts/sukhna/report.md`: lengths, lake stats, landmarks and gaps, steps, grid extents and sizes, sun, the checks the pipeline can run (e.g. that the promenade stays on land and the lake polygon is closed and simple).

**Ridgelines:** ray-marched from three points on the walk (s = 0, L/2, L) over 360° in 1° steps; only the **far layer (beyond the hill grid, ~13–40 km: Kasauli, Morni)** is stored. Nearer hills are real terrain.

**Licensing and attribution:** OSM data is ODbL (`sukhna.data.json` is a derivative database: README, `THIRD_PARTY_LICENSES.md` and the start card carry "© OpenStreetMap contributors, ODbL"). Terrain tiles carry the Mapzen / AWS Terrain Tiles attribution (SRTM and other sources).

**`?flat=1`, repurposed:** there is no longer a planet to compare against, so `?flat=1` shows a **2D map panel beside the 3D view**: the OSM layers in ENU, the player and camera frustum, the chunk grid with each chunk's current LOD, and the rowing lanes. It verifies alignment and culling by eye.

---

## 4. The world: extent, terrain, rendering distance and LOD

**Extent (in real metres around the lake):**

| Zone | Covers | Terrain | Dressing |
|---|---|---|---|
| **Core** | within ~150 m of the walk, plus the plaza, garden, jetty and regulator | DEM near grid, reshaped by the procedural dam, lake bed and plazas; meshed at 2–4 m along the walk | full: promenade structure, all instanced dressing, NPCs, shadows |
| **Basin** | the whole lake and its shores, ~5 × 4 km | near grid, 20 m mesh (40 m at mid LOD) | trees at mid/far LOD, city blocks, the far shore forest, boats |
| **Hills** | to ~13 km NE, ~6 km elsewhere | hill grid, 120 m mesh, forest tint as vertex colour | none (colour only) |
| **Sky** | beyond ~13 km | — | far ridgeline rings (Kasauli, Morni) in `sky.js` |

**The dam and lake bed are procedural overlays on the DEM** (the 30 m DEM cannot see a 10 m-wide bund):
- Cross-section across the walk, heights relative to the water (y = 0): lake bed falling to −3 m within 60 m of the shore; drawdown band at 0…+0.4; stone-pitched embankment 1:2 up to the parapet foot; parapet top +2.95 (0.45 m high, 1.2 m wide); walk +2.5 (real width from OSM if tagged, otherwise 8 m); grassed downstream face 1:2 down to the DEM ground on the city side (≈ −3 m at the golf course). Stylised, tuned against r2 and r8.
- Inside the lake polygon the ground is pushed below −0.5; outside it is lifted above +0.3 near the water. `shoreCheck` proves it (§8).
- The walk polyline (45 OSM nodes) is filleted into a smooth curve (minimum radius ~40 m). The report records the length change, which must stay under 1 m.

**Depth and view distance (a new rendering problem, since the world now reaches 40 km):**
- A single camera with near 0.3 m and far 40 km has no usable depth precision, and the ink pass reads that depth.
- So the frame is drawn in **two passes into the same target**: a *far pass* (hill grid, basin terrain beyond ~1.5 km, ridge rings) with near 150 m / far 40 km, then a depth clear, then the *near pass* (everything else) with near 0.3 m / far 3 km.
- Far-pass pixels read as "sky" to the ink pass (their depth is cleared), which is right: the ink already fades out by 98 m.
- Fog and haze use view distance, so they stay continuous across the two passes.

**Distance culling and LOD (replacing horizon culling):**
- Static content lives in a **200 m chunk grid** (instanced and merged per chunk per material, with real bounds), so three's frustum culling works, plus a **per-kind draw distance** (tier-dependent) with hysteresis.
- **The promenade** is chunked by 100 m of s (25 sectors). Near sectors (< ~350 m) get full instanced dressing. Beyond that a **merged low-poly silhouette** of the whole walk (strip, parapet, lamp heads) stands in. The walk curves around the lake, so most of it is visible across the water 1–2 km away.
- **Trees:** three LODs: near (< 200 m) cel trees (trunk + canopy instanced per chunk); mid (200–1 500 m) single low-poly canopies; far (> 1.5 km) no geometry, a forest tint plus canopy bumps in the terrain. The far shore forest is the sanctuary's real `natural=wood` / `landuse=forest` polygons.
- **City side:** OSM footprints near the walk become stylised modernist blocks. Beyond ~600 m they are merged low boxes per chunk; beyond ~1.2 km, colour only.
- **Haze sets the budget:** morning haze (fog colour by time of day) makes LOD switches happen inside it. Pre-dawn visibility is ~3 km, bright morning ~15 km, winter fog ~70 m.

**Draw-call budget (high tier, worst view: standing on the bend looking across the whole lake):**

| Group | Calls |
|---|---|
| Sky dome, sun, clouds, far ridge rings | ~6 |
| Far pass terrain (hill chunks) | ~12 |
| Basin + core terrain chunks | ~25 |
| Water (surface, shore band, mist) | ~4 |
| Promenade: near sectors × ~8 kinds, plus the far silhouette | ~90 |
| Landmarks (plaza, garden, jetty, regulator, boat club) | ~60 |
| Trees near/mid per chunk | ~120 |
| City blocks and golf | ~50 |
| NPCs (part-instanced) + LOD | ~24 |
| Birds, boats, wakes | ~20 |
| Shadow pass (casters within ~35 m) | ~120 |
| Post (ink, grade, FXAA) | 3 |
| **Total** | **~530** (target ≤ 900 high, ≤ 350 low) |

**P overview:** an aerial orbit around the lake's centre at ~1 100 m altitude and ~2.4 km out, looking down about 30°. It shows the whole lake, the curved dam, the city grid and the hills, turning slowly. The far pass carries it; near-pass detail is limited to LOD silhouettes. P again returns to the jogger.

**The rowing eight and sculls on the real lake:**
- **Lanes** are closed polylines built by offsetting the real shoreline inward (~90 m for the eight, 50–200 m for the sculls), smoothed, and clipped to the main basin, away from the islands and the narrow east arm.
- **The eight** rows its lane (~4–5 km, at 4.6 m/s a lap of ~15–18 min), passing along the dam regularly. The hull is baked once and moved each frame along the lane (position plus heading from the tangent). The oars sit on pivots at 22 strokes per minute, with a V-wake of instanced foam quads.
- **Sculls** take 3–4 other lanes at varied speeds and directions.
- **Pedal boats** stay in a box off the real boating jetty and appear after 08:30.
- `laneCheck` (§8) proves every lane sample is ≥ 30 m inside the water and ≥ 25 m from every island.

**Sun and ridges:** the flat world makes this direct. The sun direction is (sin az · cos el, sin el, −cos az · cos el) in world axes, so the light is the real sun everywhere, with no per-position re-seating. The shadow camera follows the player. Ridge rings sit at their true azimuths.

---

## 5. Port, adapt, or new

Target layout: `src/core`, `src/world`, `src/people`, `src/data`, `scripts/sukhna`.

### Port as-is (MIT header kept, credited)
- `core/toon.js`, `core/post.js` (plus the two-pass hook, §4), `core/outline.js`, `core/util.js` (done in Phase 1).
- `world/trees.js`: `buildGrove`, shrubs and palms, with LODs added.
- The `__shot` plugin and `window.__shot` (done).

### Adapt

| File | Change |
|---|---|
| `core/palette.js` | Base palette **plus time-of-day keyframes** (pre-dawn, sunrise, golden hour, bright) for sky, fog/haze, lights, grade, water and ridges; a `tod` registry for every time-dependent material or uniform. |
| `core/sky.js` | Sun disc, horizon glow toward the sun, stars before dawn, drifting cel clouds, **far ridgeline rings** from the data. The dome follows the camera (no surface-frame rotation any more). |
| `core/textures.js` | `signTex({lines:[{text,script}]})` for trilingual signs. |
| `core/player.js` | Becomes `core/jogger.js`: walk / jog / sprint, stamina, V auto-jog with turnaround, flat-ground movement with collision. |
| `core/hud.js` | Prompt, toast, the hint bar and the jog HUD. H hides both. |
| `core/audio.js` | Becomes WebAudio `core/sound.js`. |
| `world/lake.js` | Water on the real OSM polygon. High tier: a `ShaderMaterial` with a fresnel sky gradient, quantised cel ripples, a sun-glint path and a mist tint. Low tier: flat layers. |
| `world/hills.js` | Becomes `world/terrain.js`: DEM grids → chunked meshes at three LODs, with procedural overlays (dam, lake bed, plazas) and `hillSafety`-style checks under built things. |
| `world/lakeroad.js` | Becomes `world/promenade.js` (the walk structure along the real curve) and `world/regulator.js`. |
| `world/kohan.js` | Becomes `world/boatclub.js`: `timberDeck` jetty, `makeBoat`, pedal boats as a parametric table. |
| `world/vehicles.js` | Its pattern is reused for parked scooters and cars at the plaza, for boats, and for human bodies. |

### New
- **Core:** `core/sun.js` (done), `core/timeofday.js`, `core/weather.js`, `core/quality.js`, `core/camera.js` (third-person boom plus first person, and the P overview), `core/touch.js`, `core/perf.js` (done).
- **World:** `world/index.js` (assembly), `world/frame.js` (ENU ↔ three axes, the spine frame `s → position, tangent, lake-side normal`), `world/chunks.js` (chunk grid, distance culling, LOD switching), `world/terrain.js`, `world/promenade.js`, `world/plaza.js`, `world/garden.js`, `world/cityside.js`, `world/vegetation.js`, `world/rowing.js`, `world/birds.js`, `world/mist.js`, `world/flat.js` (`?flat=1` map panel), `world/checks.js`.
- **People:** `people/body.js`, `people/types.js`, `people/gait.js`, `people/crowd.js`, `people/interact.js`.
- **Data and scripts:** `src/data/sukhna.data.json`, `src/data/sukhna.terrain.json`, `scripts/sukhna/*`.
- **Docs:** `THIRD_PARTY_LICENSES.md`, `README.md`, `docs/compare.md`.
- **Removed:** `world/planet.js`.

---

## 6. System designs (the parts that are new)

### Promenade: the walk structure along the real curve

Built by sweeping cross-sections along the filleted centreline (`world/frame.js` gives position, tangent and lake-side normal at any s):
- the asphalt walk, the cobble parapet, the grass verge, the embankment pitching and the drawdown band run the full 2 494.9 m;
- **ends:** the east end meets the regulator footbridge and the Garden of Silence; the west end opens into the entrance plaza and the boat club. There is no join.

**Instanced parts, 25 sectors of 100 m of s:** 2 m parapet blocks, lamps, benches, bins, 100 m markers, reeds, palms and trees, instanced per sector with real bounds. Near sectors are full; far sectors switch to the merged silhouette (§4).

**Dressing appears only where the district is:**
- benches facing the water, dustbins, lamps;
- **a stylised 100 m distance marker** (s from the east end), with a code comment saying it is not real;
- trilingual signs;
- **the six real stairs down the city face** at their OSM positions;
- **three stylised steps down to the water** (the brief asks for them; OSM maps none, so they are flagged generic).

The **low tier thins** benches, trees and reeds per sector, following a density table.

### Landmarks (real positions)

- **West end:** the lake club (tennis courts at their OSM positions, building generic); the **entrance plaza** (terracotta pavers, gateway frame, kiosks with a chai and nimbu-paani stall, parking on the real OSM parking polygons with parametric scooters and cars); the **boat club jetty** at the real boating point and the two OSM piers, with the pedal-boat row and launch.
- **The long bund** with its six city-side stairs and the downstream footway (real, 9–18 m below and beside the walk).
- **East end:** the **regulator** (gates, gauge and footbridge, at their OSM positions) and the **Garden of Silence** with the Buddha statue (gazebo, chain-link fence, flower beds, stone seats, per r1).
- **City side:** the real golf course polygon, green belts, parking, and stylised Chandigarh modernist blocks on OSM footprints (brise-soleil walls, exposed-concrete pavilions).
- **Far shore:** the sanctuary forest from OSM polygons, rising into the real Shivalik front.

### Jogger (`core/jogger.js`, `core/camera.js`, `people/*`)

**Movement:**

| Mode | Speed | Pace |
|---|---|---|
| Walk | 1.5 m/s | — |
| Jog (default, W) | 3.0 m/s | 5:33 /km |
| Sprint (Shift) | 5.2 m/s | 3:12 /km |

- Speed changes are smoothed with an exponential approach. Releasing W decays to a walk, then to a stop.
- Free movement on land. The water is blocked (the lake polygon with a margin) and so are building footprints; the parapet can be sat on. Height comes from the same ground function the terrain is drawn from.

**Stamina (0–100):** sprint −9 /s, jog +1.5 /s, walk +10 /s, chai sets it to 100. Breathing is audibly heavier below 30.

**Camera:**
- A third-person boom behind the jogger's heading, with lag and a gentle bob tied to the jog cadence.
- The mouse wheel zooms the boom from 5.5 m down to 0, which is first person; in first person the body is hidden.
- Mouse look works through pointer lock, as in the reference.
- **P** switches to the aerial overview (§4) and back.

**V (auto-jog):**
- Follows the walk's centre lane in the current direction and steers around NPCs with a lateral potential field (8 m lookahead).
- **At each end it turns round** (a short U-turn arc) and carries on.
- The camera slowly orbits toward the lake side. Any WASD input cancels it.

**Body:** the same parametric body as the NPCs, with an inverted-hull outline (the only hero outline). Outfit presets on the start card: (1) t-shirt and track pants; (2) patka, t-shirt and shorts over tights; (3) hoodie and joggers.

**Gait (`people/gait.js`):** procedural and phase-driven. Stride length and cadence scale with speed, the arms swing opposite the legs, and there is a vertical bounce, a forward lean that grows with speed, and a slight twist.

### NPCs (`people/body.js`, `types.js`, `crowd.js`)

**A type is a row of numbers:** height; shoulder and hip width; girth; limb ratios; posture (stoop); gait (cadence, stride, arm swing, "hands behind the back"); top (tee / kurta / tracksuit / hoodie / shawl); bottom (track pants / salwar / trousers / tights); headwear (none / cap / patka / turban / dupatta / monkey cap); a colour table index.

**Rendering:** instanced by part, about 16 part meshes, each an `InstancedMesh` with `instanceColor`. **The whole crowd costs about 16 draw calls, however many people there are.** `cel()` materials; only the player gets a hull outline.

**LOD:** < 45 m full forward kinematics every frame; 45–150 m six parts at 20 Hz; beyond ~250 m not drawn (a person is ~2 px there). NPCs across the lake are simulated but not submitted.

**Pathing:** lanes along the walk in (s, lateral offset), mapped to the world by the spine frame.
- Each NPC has an s, a lane, a speed and a direction. Joggers overtake by changing lanes when there is a gap; some overtake the player.
- NPCs **turn round at the ends** or leave and arrive via the stairs, the plaza and the garden (spawn and despawn there), so the ends don't pile up.
- The plaza and garden have small waypoint graphs.
- Stationary groups stand at anchor spots: yoga on mats on a grass patch, the laughter club in a circle, a stretcher at the parapet, bench sitters, the photographer with a tripod at a viewpoint, the chai kiosk vendor.
- A dog walker (with a small parametric dog) and college students jogging in pairs.

**Density by time:** relative to the actual sunrise. Pre-dawn is 0.3, the peak runs from sunrise −10 min to +70 min, and it thins after that. Fog multiplies density by 0.45 and puts everyone into a shawl or monkey cap.

| Tier | Maximum NPCs |
|---|---|
| High | 200 |
| Med | 125 |
| Low | 50 |

**Water check:** `npcWaterCheck()` (in `world/checks.js`, automatic in dev) simulates 20 minutes at 0.5 s steps, sampling every NPC, lane and anchor. It asserts each point is outside the real lake polygon by at least 1 m and reports the worst margin.

**Interactions (E), short and non-blocking:** greet ("Good morning!", "Sat Sri Akal ji", "Namaste ji" in a speech bubble); chai at the kiosk (hold a cup 4 s, stamina refills); join yoga (hold a pose 5 s); sit on a bench (the camera settles on the lake view until you move); high-five a passing jogger.

**Birds (`world/birds.js`), about 8 draw calls** (instanced bodies plus wing pairs): high 175, med 100, low 35. Egrets and cormorants on posts and at the water's edge, ducks paddling, crows and pigeons on the parapet, flocks that lift off the water and wheel around when the player comes close, and a parakeet flock that crosses overhead. Flight volumes are over the real lake.

### Morning, haze, weather and signage

**T** jumps between presets, and time also runs at 4× real speed:

| Preset | Time | Sun elevation |
|---|---|---|
| Pre-dawn | 06:55 | −5.9° |
| Sunrise | 07:19 | −0.8° (upper limb) |
| Golden hour | 07:45 | 4.0° |
| Bright | 09:15 | 19.9° |

- The keyframes are keyed to **sun elevation**, not clock time. They drive the sky, lights, shadow tint, grade uniforms, **haze density and colour (the view distance)**, water and ridge tint.
- **Mist** (`world/mist.js`): soft instanced sheets over the real lake polygon plus low haze in the hill valleys. Its opacity falls as the sun climbs and is gone by about 10° of elevation.

**K** cycles clear → rain → winter fog:
- **Rain:** instanced streaks around the camera with `depthWrite: false`, more ripples, a desaturated grade, and a rain sound bed.
- **Fog:** 6–70 m, with the ink fade distances pulled in to match, a muted palette, fewer NPCs, shawls, and the far pass skipped entirely (a free saving).

**Signs:** Canvas2D in English, Hindi and Punjabi. Content: "Sukhna Lake / सुखना झील / ਸੁਖਨਾ ਝੀਲ" (OSM carries the Hindi and Punjabi names), the boat club, "Please keep the lake clean", distance markers, and the kiosk's "Chai · Nimbu Paani". No brands. System font stacks: Latin `'Segoe UI','Helvetica Neue',Arial,sans-serif`; Devanagari `'Noto Sans Devanagari','Nirmala UI','Mangal','Kohinoor Devanagari',sans-serif`; Gurmukhi `'Noto Sans Gurmukhi','Nirmala UI','Raavi','Gurmukhi MN',sans-serif`. Drawn after `document.fonts.ready`.

### Sound (`core/sound.js`, WebAudio, all generated in code, M toggles)

*(Unchanged.)* Birdsong (FM chirps whose species mix follows the time of day); water lapping (filtered noise, envelope tied to the distance to the real shoreline); oars and the cox's calls in sync with the eight's strokes, spatialised from the boat's real position; footsteps and breathing tied to cadence and stamina; wind in the trees; a distant scooter horn from the city side; the laughter club; chatter as you pass. Everything is spatialised with `PannerNode`s, crossfaded and randomised so no loop repeats audibly. **Honest limitation:** synthesised speech isn't intelligible, so the Punjabi, Hindi and English chatter and the cox's calls are shown as small text bubbles over the formant babble. CC0 recordings can be dropped in later and listed in `THIRD_PARTY_LICENSES.md`.

### Controls, HUD and quality

**Hint bar:** fixed to the bottom, full width, `rgba(14,16,22,.58)`, with a 1 px top line in `rgba(255,255,255,.16)`, grey text `#b9bdc7` at 12.5 px, centred. It reads exactly:
`WASD jog · Shift run · E interact · V auto · T time · K rain · P overview · M sound · H hide`

**Keys:** P toggles the aerial overview. H hides the hint bar and the HUD. Esc releases the cursor. The dev keys C, R, O and G stay but are left out of the hint.

**Jog HUD (top left, compact):** distance, pace (min/km), elapsed time, **lengths** (one length = 2.49 km end to end), a stamina bar, and the clock with the preset name.

**Touch (`core/touch.js`):** a left virtual stick jogs, and pushing it to the rim runs. Dragging on the right half looks around and pinching zooms. A button row covers E, V, T, K, P, M and H.

**Quality tiers (`?q=low|med|high`, auto-detected: mobile or low-memory devices start on low):**

| | Pixel budget | Shadows | Water | Dressing | NPCs | Birds | Tree mid/far switch | City detail to | Hill grid |
|---|---|---|---|---|---|---|---|---|---|
| High | 4.6 MP | 2048 | shader | 100% | 200 | 175 | 200 / 1 500 m | 1 200 m | full |
| Med | 2.8 MP | 1024 | shader | 75% | 125 | 100 | 150 / 1 000 m | 800 m | full |
| Low | 1.3 MP | 1024 at a 40 m range | flat layers | 45% | 50 | 35 | 100 / 600 m | 400 m | half resolution |

- A simple fallback drops one tier if frame time stays above 22 ms for 5 s.

**Page metadata:** title "Sukhna — a sunrise jog around Sukhna Lake", a meta description (updated: no longer "tiny planet"), `lang="en"`.

---

## 7. Phases from here (at least one commit each, on `build`)

| Phase | Contents |
|---|---|
| 0–1 | Done (plan; scaffold and engine port). |
| 2 (planet) | Superseded (`27ca69a`). |
| **2** | **Flat real-data pipeline and flat scaffold.** Pipeline in ENU (reusing Phase 2's parts): `sukhna.data.json`, `sukhna.terrain.json`, extra z12 tiles, far ridge rings, the report. Runtime: remove the planet bake and `R`; `world/frame.js`; raw DEM terrain chunks (untextured, two LODs); the lake polygon as a flat water plane; the walk as a line; landmark pins; the **two-pass depth** set-up; the **P overview**; `?flat=1` map panel. |
| 3 | **World layout, LOD and self-checks.** Terrain overlays (dam cross-section, lake bed, plazas) and three terrain LODs; the promenade along the real curve with sectors and the far silhouette; the regulator, garden and statue, plaza, boat club and jetty, lake club; the city side (golf, parking, modernist blocks); vegetation with three LODs from the real forest polygons; the far ridge rings; the chunk system with distance culling; `shoreCheck`, `damCheck`, `hillSafety`. |
| 4 | The jogger, camera, jog HUD (lengths), hint bar (`P overview`), controls, V turnaround and touch. |
| 5 | NPCs and interactions; the rowing eight and sculls on real-lake lanes (`laneCheck`); pedal boats; birds; `npcWaterCheck`. |
| 6 | Time of day with haze as view distance, mist, weather, signage. |
| 7 | Sound. |
| 8 | Quality tiers (including LOD distances), performance, metadata, verification, `docs/compare.md`, and the final summary. |

---

## 8. Verification (Phase 8, actually run; checks also run in dev from Phase 3)

**Pages to open:** `npm run dev`, then `/`, `/?flat=1`, `/?q=low`, `/?stats=1`; `npm run build && npm run preview` must pass.

**Screenshots:** in the Claude Desktop Browser pane via `window.__shot`, from fixed camera spots that match r1, r2, r6, r7, r8 and a bench view, plus the P overview against r9. Each spot is shot at pre-dawn, sunrise, bright morning and in fog. They go into `docs/shots/` beside the matching `reference/` photo in `docs/compare.md`, with a list of what still doesn't match. No Playwright unless a phase really needs it, and only after asking.

**Numeric checks, printed and recorded:**
- `shoreCheck`: along the whole real shoreline (every 2 m), the ground is ≥ +0.3 m at 3 m outside and ≤ −0.5 m at 3 m inside; reports the worst. (This replaces `lakeLeakCheck`; the water plane is the real polygon, so "leaking" means terrain and polygon disagreeing.)
- `damCheck`: the walk surface is ≥ +2.0 m above the water along its whole length, and the parapet is continuous.
- `hillSafety`: terrain never pokes through built things (worst = 0.00).
- `npcWaterCheck`: 0 violations.
- `laneCheck`: every rowing lane sample ≥ 30 m inside the water and ≥ 25 m from islands.
- Pipeline: the filleted walk length is within 1 m of OSM's; the lake polygon is simple and closed.

**Performance:** `renderer.info.render.calls` (both passes plus shadows plus post), triangles and frame time per camera spot and tier, with `__bench(n)` forcing GPU completion (real numbers from the user's GPU, with the GPU name recorded). Worst views are recorded on purpose (the bend looking across the lake, the P overview).

| Tier | Draw calls | Frame time |
|---|---|---|
| High | ≤ 900 | ~16 ms on a mid-range laptop |
| Low | ≤ 350 | — |

**Final summary:** what was built, the file list, what is real-data or photo-based versus stylised or invented, known limitations, and next steps.

---

## 9. Risks

1. **Depth precision over 40 km.** One camera can't hold 0.3 m to 40 km without z-fighting and a noisy ink pass. Mitigation: the two-pass far/near render (§4). Fallback: drop the far pass to ridge rings plus a 6 km terrain cap.
2. **Draw calls when the whole lake is in view.** The walk curves around the water, so from the bend you see most of it and the far shore at once. Mitigation: 100 m sectors with a merged far silhouette, 200 m chunks with per-kind draw distances, three tree LODs, far detail as terrain colour. The budget (§4) is ~530 against 900; it is measured per phase at the worst view.
3. **Tree counts over real forest areas.** The sanctuary is several km², so tens of thousands of trees. Mitigation: deterministic per-chunk scatter, near/mid instancing only within 1.5 km (tier-dependent), far forests as colour and canopy bumps. Mid-LOD instance lists are rebuilt only when the player crosses a chunk.
4. **LOD pop-in.** Mitigation: switches happen inside the haze, with hysteresis; the haze density is part of the time-of-day keyframes.
5. **The DEM can't see the dam, the shoreline or the plaza** (30 m SRTM, ±several metres). Mitigation: procedural overlays for the dam cross-section, lake bed and flattened plazas, proved by `shoreCheck`, `damCheck` and `hillSafety`.
6. **Real scale changes the feel.** The far shore is 0.6–1.5 km away and small, which is correct. The planet's "curve to the horizon" look is gone by design; the depth now comes from haze layers and the real hills.
7. **Data size.** Vectors ≤ 300 KB plus terrain ≤ 250 KB (≈ 250 KB gzipped together). Mitigation: distance-dependent simplification, Int16 grids, generic city blocks beyond ~1.2 km.
8. **Shadows cover only ~35 m around the player.** Distant things are unshadowed; the cel look hides it, and time of day tints the shadow colour.
9. **Retrofitting time of day onto cached materials.** Mitigation: the `tod` registry.
10. **The toon patch matches a line of three's shader source.** Mitigation: pin `three@^0.180.0`.
11. **Audio realism.** Formant synthesis; speech as text bubbles.
12. **Fonts.** Linux may lack Devanagari and Gurmukhi. Bundling Noto (OFL) would be a binary asset; I'll ask first.
13. **Ink through fog.** The ink fade must follow the fog distance.
14. **One GPU only.** Real timings, but one data point; the low tier is sized from draw-call counts.
15. **Three photos (r3, r4, r5) appear AI-generated.** Mood only.
16. **Not confirmed by OSM or photos:** the lake-club building, the lamp posts, the regulator's gates, the statue's look (OSM names it; the model stays generic). All kept generic and flagged.
