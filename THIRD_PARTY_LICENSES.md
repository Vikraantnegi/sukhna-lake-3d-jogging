# Third-party licences and attributions

## sakura-crossing (engine reference) — MIT

This project ports and adapts code from **sakura-crossing**,
https://github.com/Kenton-GMI/sakura-crossing. Every ported or adapted file
starts with a header naming its source file and what changed.

Ported so far: `src/core/toon.js`, `post.js`, `outline.js`, `util.js`,
`sky.js`, `textures.js` (helpers only), `palette.js` (structure only),
`src/world/planet.js`, the `__shot` frame grabber in `vite.config.js`, and the
structure of `src/main.js`.

Nothing from sakura-crossing's `public/audio/` is used or copied. That track
is not covered by its MIT licence.

```
MIT License

Copyright (c) 2026 Kenton Wang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js — MIT

Runtime dependency (`three`, npm). Copyright © 2010–2025 three.js authors.
https://github.com/mrdoob/three.js/blob/dev/LICENSE

## OpenStreetMap data — ODbL 1.0 (placeholder, filled in Phase 2)

`src/data/sukhna.data.json` will be a derivative database of OpenStreetMap
data: © OpenStreetMap contributors, available under the Open Database
Licence (ODbL) 1.0, https://www.openstreetmap.org/copyright. Phase 2 records
the query, the fetch date and the bounding box here.

## Terrain — Terrarium elevation tiles (placeholder, filled in Phase 2)

Elevation for the Shivalik hills and ridgelines will come from the Mapzen /
AWS Terrain Tiles (Terrarium encoding, `elevation-tiles-prod`). Phase 2
records the attribution their documentation requires, which covers SRTM and
the other source datasets.

## Sound

None yet. Phase 7 generates every sound in code. Any CC0 recording added
later is listed here with its source URL and licence.
