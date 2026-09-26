# Sukhna

A winter-morning jog around **Sukhna Lake, Chandigarh**, on a tiny
cel-shaded planet, built with three.js.

The dam promenade is the planet's equator at real scale (1 m = 1 m along the
path, from OpenStreetMap). The Shivaliks come from elevation data, and the sun
rises where and when it really does in mid-January.

> **Status: Phase 1 of 8.** The engine, the look and an empty planet are in.
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

Phase 1 dev viewer: drag to look, WASD to move (Shift is faster), P for the
planet view, O and G to toggle the ink and grade passes, R to reset.

## Credits

- **Engine and look:** ported from
  [sakura-crossing](https://github.com/Kenton-GMI/sakura-crossing) by Kenton
  Wang (MIT). That covers the flat-world-then-bake-to-sphere planet, the
  cel/toon materials, and the ink, grade and FXAA pipeline, among other code.
  See [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
- **Map data:** © OpenStreetMap contributors, ODbL (from Phase 2).
- **Terrain:** Mapzen / AWS Terrain Tiles (from Phase 2).
- **Look reference:** the photos in `reference/`.
- [three.js](https://threejs.org) (MIT) and [Vite](https://vitejs.dev) (MIT).

## Licence

The licence for this project's own code has not been chosen yet. Third-party
code and data keep their own licences; see `THIRD_PARTY_LICENSES.md`.
