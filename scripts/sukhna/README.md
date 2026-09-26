# Sukhna data pipeline

Everything the world is built from is made here, at build time; nothing is
fetched while the site runs. Plain Node 18+, no dependencies.

```bash
node scripts/sukhna/fetch-osm.mjs        # Overpass -> raw/osm-<bbox>-<date>.json (skips if present; --refresh)
node scripts/sukhna/fetch-terrain.mjs    # Terrarium tiles -> raw/terrarium/z/x/y.png (skips if present)
node scripts/sukhna/build-data.mjs       # -> src/data/*.json, report.md, debug/world.png
```

| File | What |
|---|---|
| `config.mjs` | Bounding box, tile sets, the promenade way, grid extents and steps, the date. |
| `overpass.ql` | The Overpass query (`{{bbox}}` is filled in by `fetch-osm.mjs`). |
| `lib/geo.mjs` | Exact WGS84 ↔ ENU (through ECEF), polylines, Douglas–Peucker, ring stitching. |
| `lib/png.mjs`, `lib/terrarium.mjs` | Decode Terrarium tiles; height = R·256 + G + B/256 − 32768. |
| `lib/pngenc.mjs` | A tiny PNG writer for the debug picture. |
| `build-data.mjs` | The build: promenade, lake, landuse, buildings, roads, landmarks, steps, grids, ridge rings, sun, report. |
| `report.md` | Measurements and checks from the last build. |

**Frame:** ENU metres [east, north] about the promenade midpoint; heights in
metres above the lake level (the DEM median over the water). The runtime maps
this to three.js as x = east, y = up, z = −north (`src/world/frame.js`).

**Licences:** OSM data © OpenStreetMap contributors, ODbL 1.0. Terrain: Mapzen /
AWS Terrain Tiles (SRTM and others). See `THIRD_PARTY_LICENSES.md`.
