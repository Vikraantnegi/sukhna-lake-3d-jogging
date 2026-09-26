/* Ported from sakura-crossing (https://github.com/Kenton-GMI/sakura-crossing),
 * src/core/textures.js.  Copyright (c) 2026 Kenton Wang.  MIT License -- full
 * text in THIRD_PARTY_LICENSES.md.  Changes: only the generic helpers and the
 * cloud mask are kept (the rest is that project's signage); `make`, `cached`,
 * `fitText` and `centered` are exported; the Japanese font stack is replaced
 * by Latin, Devanagari and Gurmukhi stacks, and Indic text is never tracked
 * per character (it would break conjuncts and matras).  Trilingual
 * `signTex` arrives with the signage in Phase 6. */
import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Procedural canvas textures.
 *
 * The scene ships with zero binary assets: every sign and mask is drawn
 * with Canvas2D at start-up.  Everything is kept flat and low-frequency on
 * purpose -- crisp shapes and type, never photographic noise.
 * ------------------------------------------------------------------ */

/** System font stacks, one per script.  No bundled fonts (see plan §9). */
export const FONTS = {
  latn: `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`,
  deva: `'Noto Sans Devanagari', 'Nirmala UI', 'Mangal', 'Kohinoor Devanagari', sans-serif`,
  guru: `'Noto Sans Gurmukhi', 'Nirmala UI', 'Raavi', 'Gurmukhi MN', sans-serif`,
};

const cache = new Map();

export function make(w, h, draw, { srgb = true, repeat = null, aniso = 4 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = true;
  draw(c, w, h);
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.needsUpdate = true;
  return tex;
}

export function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export const hex = (n) => '#' + n.toString(16).padStart(6, '0');

/** Shrink the font until `text` fits in `maxW`.  Returns the size used. */
export function fitText(c, text, maxW, size, font = FONTS.latn, weight = 'bold') {
  let s = size;
  do {
    c.font = `${weight} ${s}px ${font}`;
    if (c.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 6);
  return s;
}

/**
 * Draw `text` centred on (x, y), fitted to `maxW`.  `script` picks the font
 * stack; `spacing` (per-character tracking) is honoured for Latin only.
 */
export function centered(c, text, x, y, maxW, size, color,
  { weight = 'bold', spacing = 0, script = 'latn' } = {}) {
  const font = FONTS[script] || FONTS.latn;
  const s = fitText(c, text, maxW, size, font, weight);
  const track = script === 'latn' ? spacing : 0;
  c.fillStyle = color;
  c.textAlign = track ? 'left' : 'center';
  c.textBaseline = 'middle';
  if (track) {
    const chars = [...text];
    const total = chars.reduce((a, ch) => a + c.measureText(ch).width + track, -track);
    let cx = x - total / 2;
    for (const ch of chars) {
      c.fillText(ch, cx, y);
      cx += c.measureText(ch).width + track;
    }
  } else {
    c.fillText(text, x, y);
  }
  return s;
}

/* ------------------------------ sky ------------------------------ */

export const cloudTex = () =>
  cached('cloudTex', () =>
    make(512, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      const puffs = [
        [0.22, 0.62, 0.15], [0.36, 0.46, 0.2], [0.52, 0.4, 0.24],
        [0.68, 0.5, 0.19], [0.82, 0.63, 0.14], [0.45, 0.66, 0.2], [0.6, 0.68, 0.17],
      ];
      c.fillStyle = '#ffffff';
      for (const [x, y, r] of puffs) {
        c.beginPath();
        c.ellipse(x * w, y * h, r * w * 0.55, r * h * 1.1, 0, 0, Math.PI * 2);
        c.fill();
      }
      // trim the bottom flat, the way cel-painted clouds sit on a line
      c.globalCompositeOperation = 'destination-out';
      c.fillRect(0, h * 0.78, w, h * 0.22);
      c.globalCompositeOperation = 'source-over';
    }, { srgb: false })
  );

/* ------------------------------ Sukhna ------------------------------ */

/**
 * The dam parapet: rounded grey river cobbles in dark mortar (photo r2, r8).
 * Low frequency on purpose -- stones about 20 cm across on a 2 m block.
 */
export const cobbleTex = () =>
  cached('cobbleTex', () =>
    make(256, 64, (c, w, h) => {
      c.fillStyle = '#6f6b63';
      c.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const tones = ['#9a978d', '#b9b3a4', '#a8a397', '#8f8b82', '#c2bcae'];
      for (let row = 0; row < 4; row++) {
        let x = -rnd() * 10;
        while (x < w + 10) {
          const rw = 11 + rnd() * 9, rh = 6 + rnd() * 3;
          c.fillStyle = tones[Math.floor(rnd() * tones.length)];
          c.beginPath();
          c.ellipse(x + rw / 2, row * 16 + 8 + (rnd() - 0.5) * 3, rw / 2, rh, 0, 0, Math.PI * 2);
          c.fill();
          x += rw + 1.5 + rnd() * 2;
        }
      }
    }, { repeat: [1, 1] })
  );
