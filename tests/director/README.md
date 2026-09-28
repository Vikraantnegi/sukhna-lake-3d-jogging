# The director: scripted shots, recorded as video

Dev-only (like the playtest's `window.__test`): `src/dev/director.js` is imported only when
`import.meta.env.DEV` and `?director=<name>` are both set, so a production build never has it.

```bash
npm run dev                                                   # the dev server on 5178 must be up
node tests/director/record.mjs trailer-30s                    # record one (or several) shot lists
node tests/director/record.mjs --all                          # every *.json here
node tests/director/record.mjs full-tour --preview 10,40,90   # stills at those seconds, no video
node tests/director/record.mjs boating --size 1080            # 1920 x 1080 instead of 2560 x 1440
node tests/director/record.mjs trailer-30s --portrait         # 1080 x 1920 (<name>-portrait.mp4); a list with "portrait": true always is
node tests/director/record.mjs --phase1                       # re-record the Phase 1 clip before-after plays
```

To watch one play in the browser: `http://127.0.0.1:5178/?director=phase7-steps&q=high&seed=7`
(it plays once; add `&record=1` to record from there).

Videos go to `recordings/` (git-ignored): `<name>.mp4` (the master), `<name>-delivery.mp4` (a
smaller copy for posting) and a report, `<name>.json`.

## How a video is made

- **Deterministic.** `main.js` seeds `Math.random` before the world is built (`?seed=`, from
  the list), and the director runs the game at a fixed 1/60 s step: one step, one rendered frame.
  The same list gives the same video.
- **Composited.** Each frame is drawn onto a 2D canvas (2560 x 1440) with what the recording
  shows and the game's HUD never does: captions, speech bubbles, the `?stats` readout (with the
  GPU's frame time from a timer query), the start card, and an end card if a list asks for one.
  The window shows that canvas, so what you see is what is recorded.
- **Encoded frame-exact.** The frames are encoded with WebCodecs (H.264 High, 4:2:0), each
  stamped n/60 s, so the file is exactly 60 fps. If the page hitches (a cut to a new place
  refills the trees and the crowd), the steps it owes are each still drawn and recorded. The
  WebAudio master output is recorded next to it by MediaRecorder as AAC.
- **One MP4.** `record.mjs` writes the two into one MP4 with its index at the front (the
  `+faststart` layout), ready to upload to X.
- **Loudness and a delivery copy** (with ffmpeg, `winget install Gyan.FFmpeg`): the master's
  audio is normalised to **-14 LUFS** integrated, true peak -1.5 dBTP, LRA 11 (`loudnorm`, two
  passes, the picture copied untouched; the game's mix alone sits around -20 to -30 LUFS), and
  `<name>-delivery.mp4` is the same picture re-encoded at 10-12 Mbit/s (x264 High, yuv420p) with
  the normalised audio. Without ffmpeg both are skipped and the report says so.
- **Checked.** `record.mjs` reads the file's own sample table back: the frame count against the
  list's length, every frame's duration (a gap is a dropped frame, a short one a doubled frame),
  the resolution, and the audio's length; the delivery copy is checked the same way, and the
  table gives the loudness before and after.

Why not `canvas.captureStream(60)` into MediaRecorder (the first plan)? On this machine
(Chrome 154, a 240 Hz display) it lost 1-5 % of the frames, one in about every 101, at 1440p
and at 1080p alike, however the frames were fed to it. It is still there as a fallback:
`&capture=mediarecorder` in the URL.

## A shot list

`tests/director/<name>.json`:

```jsonc
{
  "name": "my-video",
  "seed": 12,                              // Math.random's seed (crowd, birds, boats, bubbles)
  "duration": 15,                          // seconds
  "start": { "time": "golden", "weather": "clear" },   // time: a preset or hours; weather: clear | rain | fog
  "stats": false,                          // show the ?stats readout
  "events": [ { "at": 0, "do": "place", "s": 1200, "d": -1.6, "face": "east" } ],
  "shots":  [ { "at": 0, "mode": "keys", "keys": [ ... ] } ],
  "captions": [ { "from": 0.5, "to": 4, "text": "a caption" } ],
  "endCard": { "at": 13, "text": "…" },   // optional; no list uses one now
  "clip": { "frames": "/recordings/phase1-orbit.video", "from": 0.5, "until": 4 },  // optional: show recorded frames first
  "portrait": false,                       // true: always 1080 x 1920 (the vertical-* lists)
  "portraitFov": 68,                       // the camera's vertical field of view in portrait (the game's is 55)
  "captionY": 0.17                         // optional: where captions sit, as a fraction of the height
}
```

### Portrait (Shorts, Reels, TikTok)

`--portrait` (or `"portrait": true` in a list) renders 1080 x 1920. A tall frame at the game's
55 degrees is only ~32 degrees across, so the camera opens up to `portraitFov` (68); a shot may set
its own `"fov"`, eased across a blend. Any shot, caption or event can carry a `"portrait": { ... }`
block whose fields replace its own in portrait, so a landscape list can give a shot its own tall
framing instead of a crop:

```jsonc
{ "at": 8, "mode": "keys", "keys": [ ... ], "portrait": { "keys": [ ... ], "fov": 72 } }
```

The apps draw their buttons and text over the bottom ~20 % and the right-hand ~15 % of a tall
frame, so captions stay in the rest: centred in the left 85 %, wrapped to 74 % of the width
(two lines break where they come out most even), 6.2 % of the width tall, at 0.73 of the height by
default or wherever `captionY` / a caption's own `"y"` puts them (the vertical lists use 0.17, the
sky, clear of the subject). A line that can't break (a web address) shrinks to fit. Frame the
subject in the upper two thirds; the preview stills (`--preview`) come out full-frame at 720 x 1280.

### Captions

Nunito Bold (OFL; `fonts/Nunito.ttf` with its licence), warm white, centred at 83 % of the
frame's height (landscape; see Portrait above), 5.2 % of it tall: sized for a phone in the X feed (a 16:9 video there is ~390 px
wide) and clear of the feed's controls along the bottom. Each fades in and out over 0.35 s. When
the frame behind a caption is bright (fog, pale water, sky), a very soft dark gradient fades in
behind the text, with no edge and no plate: every 4th step the director reads that patch back
small and takes its brighter pixels (the 75th percentile), and the gradient eases up from
brightness 0.42 to full at 0.64 (0 to 1). The font is fetched by URL while the director runs, so
it never reaches `dist/`.

### Events (`"do"`)

| do | fields | |
|---|---|---|
| `time` | `value` (preset or hours) | jump to a time |
| `timeLapse` | `to` (hours), `over` (s), `ease` | run the clock to a time |
| `weather` | `value`, `instant` | clear / rain / fog (eased over ~3 s unless `instant`) |
| `key` | `key` (E V T K P M H Esc) | press a key |
| `place` | `s`, `d`, `face` or `spot`, `speed` | put the jogger somewhere (`face`: lake / city / west / east / azimuth; `speed`: already moving, m/s, so a video can open mid-stride) |
| `walkTo` | `to` or `path` (spots), `pace` (walk / jog) | walk there with W |
| `auto` / `hold` / `release` | `keys` | auto-jog; hold or let go of keys |
| `sitSteps` | `flight` (its s) | walk down that flight and sit on the lowest dry step |
| `join` | `kind` (laugh / chat), `angle` | stand by a circle and join it |
| `ticket`, `board` (`pace`), `dock` | | the boating steps |
| `boatAt` | `spot`, `face` (lake / dam / berth) | put the boat (boarding one first if need be) |
| `pedal` | `path` (spots), `fast` | pedal through spots |
| `greet`, `five`, `chai` | | a greeting with a walker, a high five with a runner, chai |
| `say` | `who` (player / nearest), `text`, `secs` | a speech bubble |
| `rowers` | `which` (eight / scull0..2), `near` (spot), `lead` (m) | set a boat on its lane to pass a spot |
| `outfit`, `card` | `value`; `show` / `pick` / `press` / `hide` | the start card, drawn in the recording |
| `stats` | `on` | the readout on or off |

### Shots

`{ "at": seconds, "mode": "rig" | "keys" | "overview", "blend": seconds }`: `rig` is the
game's own camera (the chase camera, the seated views); `overview` is P's orbit (`orbit`: its
angle); `keys` interpolates `{ "t", "pos", "look" }` keyframes (eased `inOut`; per key `ease`).
`blend` eases in from the previous shot's camera; without it, a hard cut.

### Points and spots

A camera point: `{ "walk": [s, d], "h": 1.6 }` (h over the surface there, or `"y"`),
`{ "player": [right, up, forward] }`, `{ "boat": [right, up, forward] }`,
`{ "spot": <spot>, "y": 3 }`, `{ "azFrom": <spot>, "az": 112, "dist": 400, "y": 12 }`,
`{ "lake": [de, y, dn] }`, `[e, y, n]`, or `"current"` (the camera when the shot starts).

A spot (where to stand or go): `{ "walk": [s, d] }`, `{ "flight": 820, "at": "seat", "back": 3 }`,
`{ "flight": 820, "u": 6 }`, `{ "jetty": [along, across] }`, `{ "counter": true }`,
`{ "freeBerth": 9 }` (9 m off the free berth furthest along the jetty), `[e, n]`.

s runs along the walk from the east end (0) to the west end (2495.7); d is metres toward
the lake from the centreline.

## Adding a video

1. Copy a list here as `<name>.json`; set its duration, events, shots and captions.
2. `node tests/director/record.mjs <name> --preview 2,8,14` and look at the stills in
   `recordings/preview/`; adjust.
3. `node tests/director/record.mjs <name>`: the video and its frame check.
