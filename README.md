# Sukhna

**Play it: [sukhna-lake.trymurmur.studio](https://sukhna-lake.trymurmur.studio)** · [trailer](https://youtu.be/h8QdG8cU2Go)

A winter-morning jog along the dam at **Sukhna Lake, Chandigarh**, built with
three.js in a cel-shaded anime style.

The world is Sukhna at its real shape and scale: the 2.5 km promenade, the lake
and the city side come from OpenStreetMap, the Shivalik hills beyond the far
shore from elevation data, and the sun rises where and when it really does in
mid-January.

You jog, or walk, or sit, among the morning crowd: joggers, walkers, a laughter
club, yoga on the grass, Sikh uncles in turbans, a chai stall; the eight and the
sculls on the water, egrets and parakeets. The clock runs from civil dawn
(06:55) at 4×, through sunrise and golden hour to bright morning, then fades to
the next morning. Rain and winter fog come on K. Every sound is synthesised in
the browser; sit on a bench or the steps down to the water and a lo-fi loop
plays.

> **Status: all 8 phases built.** See [`docs/plan.md`](docs/plan.md) for the plan,
> progress and every decision made along the way, [`docs/compare.md`](docs/compare.md)
> for the game set against the reference photos, and [`docs/brief.md`](docs/brief.md)
> for the brief.

## Run

Needs Node 18+.

```bash
npm install
npm run dev      # http://127.0.0.1:5178
npm run build    # production build into dist/
npm run preview  # serve dist/ on http://127.0.0.1:5179
```

**Controls:** WASD jog · Shift run · mouse look (click to capture the pointer, or
drag) · wheel zoom down to first person · **E** interact (greet, a cutting chai,
join the yoga, sit on a bench or the water steps, high five) · **V** auto-jog ·
**T** time of day (pre-dawn, sunrise, golden hour, bright morning, sunset) ·
**K** weather (clear, rain, fog) · **P** aerial overview · **M** sound · **H** hide
the HUD · Esc pause. On touch: a left stick (push to the rim to run), drag to
look, pinch to zoom, and buttons for E V T K P M H.

**URL options:** `?q=low|med|high` quality tier (otherwise detected, with an
automatic step down if frames stay slow) · `?t=predawn|sunrise|golden|bright|sunset`
start time · `?w=rain|fog` start weather · `?stats=1` draw calls and frame time ·
`?flat=1` the map panel · `?checks` run the self-checks in a production build
(they always run in dev).

**Dev keys:** C coordinates, R reset, O / G toggle the ink and grade passes.

**Your own music:** audio files in `public/audio/` play while you sit, in place of
the generated loop (dev server only; the folder is git-ignored and never built).
The data pipeline is described in [`scripts/sukhna/README.md`](scripts/sukhna/README.md).

## Credits

- **Engine and look:** ported from
  [sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing) by Kenton
  Wang (MIT): the cel/toon materials, the ink, grade and FXAA pipeline, the
  sky, outlines and utilities, among other code.
  See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
- **Map data:** © OpenStreetMap contributors, ODbL.
- **Terrain:** Mapzen / AWS Terrain Tiles (SRTM and others).
- **Look reference:** the photos in `reference/`.
- [three.js](https://threejs.org) (MIT) and [Vite](https://vitejs.dev) (MIT).

## Licence

The licence for this project's own code has not been chosen yet. Third-party
code and data keep their own licences; see `THIRD_PARTY_LICENSES.md`.
