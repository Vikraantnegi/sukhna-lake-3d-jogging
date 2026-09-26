# Sukhna

A winter-morning jog along the dam at **Sukhna Lake, Chandigarh**, built with
three.js in a cel-shaded anime style.

The world is Sukhna at its real shape and scale: the 2.5 km promenade, the lake
and the city side come from OpenStreetMap, the Shivalik hills beyond the far
shore from elevation data, and the sun rises where and when it really does in
mid-January.

> **Status: Phase 2 of 8.** Real data and the flat world scaffold are in.
> See [`docs/plan.md`](docs/plan.md) for the plan and progress, and
> [`docs/brief.md`](docs/brief.md) for the brief.

## Run

Needs Node 18+.

```bash
npm install
npm run dev      # http://127.0.0.1:5178  (?stats=1 for draw calls and frame time)
npm run build    # production build into dist/
npm run preview  # serve dist/ on http://127.0.0.1:5179
```

Dev viewer (until the jogger arrives): drag to look, WASD to move (Shift is
faster), P for the aerial overview, O / G toggle the ink and grade passes, R
resets. `?flat=1` shows the map panel, `?stats=1` draw calls and frame time.
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
