/* Download the Terrarium elevation tiles (plan §3).
 *   node scripts/sukhna/fetch-terrain.mjs   # skips tiles already on disk
 * Tiles: Mapzen / AWS Terrain Tiles, s3 elevation-tiles-prod (see
 * THIRD_PARTY_LICENSES.md for the attribution). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TERRAIN } from './config.mjs';
import { tilesFor } from './lib/terrarium.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'raw', 'terrarium');
const jobs = TERRAIN.sets.flatMap((s) => tilesFor(s.bbox, s.zoom));
let got = 0, skipped = 0;
for (const [z, x, y] of jobs) {
  const f = path.join(dir, String(z), String(x), `${y}.png`);
  if (fs.existsSync(f)) { skipped++; continue; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const res = await fetch(TERRAIN.url(z, x, y), { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${z}/${x}/${y}: HTTP ${res.status}`);
  fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  got++;
}
console.log(`terrain tiles: ${got} downloaded, ${skipped} already present (${jobs.length} total)`);
