# Sukhna playtest

A bot that plays the game in real Chrome on the real GPU and asserts what it finds.

```bash
npm run playtest              # all eleven scenarios (~10 min, most of it stairs and sit)
npm run playtest -- stairs    # the files whose name matches "stairs"
```

- Chrome runs **headed** at 1920×1080 (`channel: 'chrome'`). `openGame` fails the scenario
  if WebGL reports a software renderer (SwiftShader, llvmpipe), so a result never comes
  from the wrong GPU.
- The dev server on 5178 is reused if it's running, else started (`npm run dev`).
- Each scenario writes screenshots and `details.json` to `report/<scenario>/`; the run
  writes `report/summary.md` and `report/results.json` and prints the pass/fail table.
  `report/` is git-ignored.
- `?nolock` stops the game grabbing the mouse while the bot plays.

## The test API (`window.__test`, dev only)

`src/dev/testapi.js`, installed from `main.js` behind `import.meta.env.DEV`, so it is not in
production builds (`dist/` has no `__test`). The main calls:

- `teleport(s, lateral, face)`, `teleportTo(e, n, face)`; `setTime(preset)`, `setWeather(w)`
- `press / hold / release(key, ms)`: real key events, as the game's handlers see them
- `advance(seconds, { dt, every })`: runs the game's `tick(dt)` without drawing, so
  minutes of play take seconds; returns `getPlayer()` samples
- `getPlayer()`: position, s / d, height above the surface, speed, pace, lengths,
  state (walking / jogging / running / sitting / boating / in-group / chai / idle), on water
- boating: `boat()`, `berths()`, `jetty()`, `onJetty()`, `boatInFrame()`, and
  `driveTo(e, n)`, an autopilot that pedals and steers with the real keys (W, A/D, Shift)
- circles: `circles()` (members, whether you've joined, the club's laugh), `bubble()`
- `nearestInteractable()`, `getHud()`, `runChecks()`, `consoleErrors()`
- probes for the specs: `footProbe()` (the rendered surface under the feet),
  `bodyLows()` (the lowest vertex of each body part), `joggerInFrame()`, `crowdNearCamera(r)`,
  `crowdDensity()`, `lamps()`, `music()`, `flights()`, `benches()`

## Scenarios

| File | What it asserts |
|---|---|
| `promenade` | auto-jog end to end and back: never on water, never stuck, a turnaround and a length at each end, ~3.0 m/s |
| `stairs` | all 6 city stairs and all 8 water flights, down and up with W: height follows the rendered treads (no sink, no float, no jump > 0.5 m) |
| `sit` | every bench and every water flight: E sits; no body part under the seat; feet on the tread below; jogger in frame; music fades in and out; a key stands up |
| `interactions` | greet, chai, yoga, laughter club, high five: prompt text, completes, cancellable |
| `tod-weather` | every T preset × every K weather: lamps, crowd density rules, no console errors |
| `camera` | auto-jog through the busiest stretch: nobody un-faded within 1.5 m of the lens |
| `boundaries` | water, dam edge, buildings, world edge are all blocked |
| `ui` | start card, P overview and back, H, M, Esc pause and resume |
| `perf` | draw calls and frame time at the three worst views per tier |
| `boating` | ticket at the shack → down the jetty stair → E at a swan → a loop past the dam (always ≥ 2 m inside the water, boat and jogger in frame) → E mid-lake refused, Esc only pauses → dock at a free berth → back up the stair; the counter shut in rain, open in fog; no swan without a ticket |
| `groups` | join the laughter club (a gap opens, on the ring, facing the middle), stay 30 s (still laughing, bubbles), Esc leaves and a second Esc pauses, W leaves; a chatting circle takes turns to talk and you nod along |
