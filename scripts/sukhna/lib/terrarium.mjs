/* Terrarium elevation tiles (Mapzen / AWS Terrain Tiles):
 *   height = (R * 256 + G + B / 256) - 32768   metres
 * Tiles are Web Mercator (slippy map) 256 x 256. */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from './png.mjs';

export const lon2tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
export const lat2ty = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/** Tile indices covering [s, w, n, e] at zoom z. */
export function tilesFor([s, w, n, e], z) {
  const out = [];
  for (let x = Math.floor(lon2tx(w, z)); x <= Math.floor(lon2tx(e, z)); x++)
    for (let y = Math.floor(lat2ty(n, z)); y <= Math.floor(lat2ty(s, z)); y++) out.push([z, x, y]);
  return out;
}

/** A height sampler over a set of decoded tiles at one zoom (bilinear). */
export function demSampler(dir, z) {
  const cache = new Map();
  const tile = (x, y) => {
    const k = x + ',' + y;
    if (!cache.has(k)) {
      const f = path.join(dir, String(z), String(x), `${y}.png`);
      if (!fs.existsSync(f)) { cache.set(k, null); return null; }
      const { rgb } = decodePNG(fs.readFileSync(f));
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = rgb[i * 3] * 256 + rgb[i * 3 + 1] + rgb[i * 3 + 2] / 256 - 32768;
      cache.set(k, h);
    }
    return cache.get(k);
  };
  const px = (gx, gy) => {
    const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
    const t = tile(tx, ty);
    if (!t) return NaN;
    return t[(gy - ty * 256) * 256 + (gx - tx * 256)];
  };
  /** Elevation in metres at (lat, lon), or NaN outside the downloaded tiles. */
  return (lat, lon) => {
    const fx = lon2tx(lon, z) * 256 - 0.5, fy = lat2ty(lat, z) * 256 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
  };
}
