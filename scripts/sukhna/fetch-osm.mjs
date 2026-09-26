/* Fetch the OSM data for Sukhna Lake from Overpass and save it raw.
 *
 *   node scripts/sukhna/fetch-osm.mjs            # skips if a raw file exists
 *   node scripts/sukhna/fetch-osm.mjs --refresh  # fetch again
 *
 * Tries overpass-api.de first and falls back to overpass.kumi.systems.
 * Output: scripts/sukhna/raw/osm-<s>_<w>_<n>_<e>-<YYYY-MM-DD>.json
 * The data is © OpenStreetMap contributors, ODbL 1.0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BBOX, OVERPASS } from './config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(here, 'raw');
fs.mkdirSync(rawDir, { recursive: true });

const tag = BBOX.join('_');
const existing = fs.readdirSync(rawDir).filter((f) => f.startsWith(`osm-${tag}-`));
if (existing.length && !process.argv.includes('--refresh')) {
  console.log(`raw OSM already present: ${existing.join(', ')} (use --refresh to fetch again)`);
  process.exit(0);
}

const ql = fs.readFileSync(path.join(here, 'overpass.ql'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll('{{bbox}}', BBOX.join(','));

let json = null;
for (const url of OVERPASS) {
  try {
    console.log(`POST ${url} ...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'sukhna-build/0.1 (data pipeline)' },
      body: 'data=' + encodeURIComponent(ql),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
    json.__source = { url, fetched: new Date().toISOString(), bbox: BBOX };
    break;
  } catch (e) {
    console.warn(`  failed: ${e.message}`);
  }
}
if (!json) {
  console.error('all Overpass endpoints failed');
  process.exit(1);
}
const date = new Date().toISOString().slice(0, 10);
const out = path.join(rawDir, `osm-${tag}-${date}.json`);
fs.writeFileSync(out, JSON.stringify(json));
console.log(`saved ${json.elements.length} elements -> ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB)`);
