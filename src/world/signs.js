import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { make, centered } from '../core/textures.js';
import { cel } from '../core/toon.js';
import { spineAt, L } from './frame.js';
import { walkY, DAM } from './dam.js';

/* ------------------------------------------------------------------ *
 * Signs (plan §6): Canvas2D lettering in English, Hindi and Punjabi on
 * the boards the world already has, plus a few boards of their own.
 *
 *   the gateway on the walk   Sukhna Lake / सुखना झील / ਸੁਖਨਾ ਝੀਲ (the
 *                             lake's name, name:hi and name:pa in OSM)
 *   the chai stall            Chai · Nimbu Paani, in all three
 *   the boating jetty         Boating (OSM's name) / नौका विहार / ਬੋਟਿੰਗ
 *   the ticket shack          Boating Tickets / नौका विहार टिकट / ਬੋਟਿੰਗ ਟਿਕਟ
 *                             (no prices, anywhere)
 *   four boards on the verge  Please keep the lake clean
 *   the 100 m markers         a small plate with the distance (stylised,
 *                             like the markers themselves)
 *
 * No brands.  Built after `document.fonts.ready`, so the Devanagari and
 * Gurmukhi faces (system fonts: Nirmala UI, Mangal, Raavi, Noto ...) are
 * there when the canvases are drawn.  About six draw calls in all.
 * ------------------------------------------------------------------ */

const BLUE = '#2f8fcf', WHITE = '#fbfaf6';
const TEXT = {
  lake: [['Sukhna Lake', 'latn'], ['सुखना झील', 'deva'], ['ਸੁਖਨਾ ਝੀਲ', 'guru']],
  chai: [['Chai · Nimbu Paani', 'latn'], ['चाय · नींबू पानी', 'deva'], ['ਚਾਹ · ਨਿੰਬੂ ਪਾਣੀ', 'guru']],
  boat: [['Boating', 'latn'], ['नौका विहार', 'deva'], ['ਬੋਟਿੰਗ', 'guru']],
  clean: [['Please keep the lake clean', 'latn'], ['कृपया झील को स्वच्छ रखें', 'deva'], ['ਕਿਰਪਾ ਕਰਕੇ ਝੀਲ ਨੂੰ ਸਾਫ਼ ਰੱਖੋ', 'guru']],
  // the boat-ticket shack; the Hindi and Punjabi follow the Boating board's words (for review)
  tickets: [['Boating Tickets', 'latn'], ['नौका विहार टिकट', 'deva'], ['ਬੋਟਿੰਗ ਟਿਕਟ', 'guru']],
};

/** A board face: a coloured panel with a border and three stacked lines. */
function boardTex(lines, w, h, { bg = BLUE, fg = WHITE, border = WHITE, first = 0.36 } = {}) {
  return make(w, h, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    const b = Math.round(h * 0.045);
    c.strokeStyle = border;
    c.lineWidth = b;
    c.strokeRect(b * 1.5, b * 1.5, w - b * 3, h - b * 3);
    // the first (Latin) line a little larger; the Indic lines share the rest
    const rows = [first, (1 - first) / 2, (1 - first) / 2];
    let y = h * 0.08;
    const inner = h * 0.84;
    lines.forEach(([text, script], i) => {
      const rh = inner * rows[i];
      centered(c, text, w / 2, y + rh / 2, w * 0.86, Math.round(rh * 0.74), fg, { script, weight: script === 'latn' ? 'bold' : '600' });
      y += rh;
    });
  }, { aniso: 8 });
}

/** A plane of size (w, h) whose front faces the ENU direction (de, dn), centred at (e, y, n). */
function facePlane(w, h, e, y, n, de, dn, uv = null) {
  const g = new THREE.PlaneGeometry(w, h);
  if (uv) {
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * (uv[2] - uv[0]), uv[1] + a.getY(i) * (uv[3] - uv[1]));
  }
  // plane normal +z; rotation.y = atan2(de, -dn) turns it to (de, dn) (world z = -north)
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(de, -dn)));
  g.translate(e, y, -n);
  return g;
}

/** A plain box for posts and backing boards, with vertex colours. */
function boxAt(w, h, d, color, e, y, n, de, dn) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(de, -dn)));
  g.translate(e, y, -n);
  const c = new THREE.Color(color), arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function signMesh(geos, tex, name) {
  const g = mergeGeometries(geos, false);
  g.computeBoundingSphere();
  // lit like everything else, so the lettering dims before sunrise
  const m = new THREE.Mesh(g, cel({ color: 0xffffff, map: tex, bands: 2, cache: false }));
  m.name = name;
  m.userData.noOutline = true;
  m.receiveShadow = true;
  return m;
}

export async function buildSigns(scene, { plaza, club } = {}) {
  try { await document.fonts?.ready; } catch { /* system fonts only; carry on */ }
  const group = new THREE.Group();
  group.name = 'signs';
  const frames = [];
  const out = { boards: 0 };

  // 1. the gateway board (landmarks.js: 3.6 x 0.9 m, 5.2 m up, faces along the walk both ways)
  if (plaza?.gate) {
    const s = plaza.gate, f = spineAt(s), y = walkY(s) + 5.2;
    const tex = boardTex(TEXT.lake, 1024, 256);
    const geos = [];
    for (const dir of [-1, 1]) geos.push(facePlane(3.5, 0.84, f.e + f.te * 0.065 * dir, y, f.n + f.tn * 0.065 * dir, f.te * dir, f.tn * dir));
    group.add(signMesh(geos, tex, 'sign.gateway'));
    out.boards++;
  }

  // 2. the chai stall: a cream board over the counter, facing the way the counter does
  if (plaza?.kiosk) {
    const [ke, kn] = plaza.kiosk, yaw = plaza.yaw;
    // local -z (the counter side) in ENU is (-sin yaw, cos yaw)
    const de = -Math.sin(yaw), dn = Math.cos(yaw);
    const tex = boardTex(TEXT.chai, 1024, 320, { bg: '#f4f0e6', fg: '#b0302a', border: '#d23b35', first: 0.4 });
    const e = ke + de * 1.06, n = kn + dn * 1.06, y = plaza.kioskY + 2.85;
    frames.push(boxAt(2.5, 0.8, 0.06, 0xd23b35, ke + de * 1.02, y, kn + dn * 1.02, de, dn));
    group.add(signMesh([facePlane(2.4, 0.75, e, y, n, de, dn)], tex, 'sign.chai'));
    out.boards++;
  }

  // 3. boating: a gateway over the stair down to the jetty -- posts on its cheek walls
  //    (either side of the parapet gap, dam.js), the board across, facing the walk
  if (club?.jetty) {
    const s = club.jetty.s, f = spineAt(s), y0 = walkY(s) + DAM.parH, d = (DAM.parIn + DAM.parOut) / 2, px = 1.6 + 0.175;
    const tex = boardTex(TEXT.boat, 1024, 288);
    for (const side of [-1, 1]) frames.push(boxAt(0.1, 2.6, 0.1, 0x3e4a46, f.e + f.ne * d + f.te * px * side, y0 + 1.3, f.n + f.nn * d + f.tn * px * side, -f.ne, -f.nn));
    frames.push(boxAt(3.5, 0.95, 0.06, BLUE_HEX, f.e + f.ne * d, y0 + 2.2, f.n + f.nn * d, -f.ne, -f.nn));
    group.add(signMesh([facePlane(3.4, 0.9, f.e + f.ne * (d - 0.035), y0 + 2.2, f.n + f.nn * (d - 0.035), -f.ne, -f.nn)], tex, 'sign.boating'));
    out.boards++;
  }

  // 3b. the ticket shack beside it (landmarks.js): a board on the roof's front edge, facing the walk
  if (club?.shack) {
    const sh = club.shack, f = spineAt(sh.s), d = sh.d - sh.hv - 0.2, y = sh.y + 2.95;
    const tex = boardTex(TEXT.tickets, 1024, 320);
    frames.push(boxAt(2.3, 0.72, 0.06, BLUE_HEX, f.e + f.ne * (d + 0.035), y, f.n + f.nn * (d + 0.035), -f.ne, -f.nn));
    for (const u of [-0.9, 0.9]) frames.push(boxAt(0.06, 0.4, 0.06, 0x3e4a46, f.e + f.ne * (d + 0.05) + f.te * u, sh.y + 2.62, f.n + f.nn * (d + 0.05) + f.tn * u, -f.ne, -f.nn));
    group.add(signMesh([facePlane(2.2, 0.69, f.e + f.ne * d, y, f.n + f.nn * d, -f.ne, -f.nn)], tex, 'sign.tickets'));
    out.boards++;
  }

  // 4. "please keep the lake clean": four boards on the city-side verge, facing the walk
  {
    const tex = boardTex(TEXT.clean, 1024, 512, { first: 0.34 });
    const geos = [];
    for (const s of [450, 1060, 1760, 2210]) {
      if (s > L - 5) continue;
      const f = spineAt(s), d = -(DAM.half + 0.9), y = walkY(s);
      const e = f.e + f.ne * d, n = f.n + f.nn * d;
      for (const u of [-0.5, 0.5]) frames.push(boxAt(0.07, 1.9, 0.07, 0x444444, e + f.te * u, y + 0.95, n + f.tn * u, f.ne, f.nn));
      frames.push(boxAt(1.3, 0.68, 0.05, BLUE_HEX, e - f.ne * 0.01, y + 1.55, n - f.nn * 0.01, f.ne, f.nn));
      geos.push(facePlane(1.24, 0.62, e + f.ne * 0.03, y + 1.55, n + f.nn * 0.03, f.ne, f.nn));
      out.boards++;
    }
    group.add(signMesh(geos, tex, 'sign.clean'));
  }

  // 5. distance plates on the 100 m markers (dam.js: at d = -half - 0.35, 0.26 m square)
  {
    const marks = [];
    for (let s = 100; s < L; s += 100) marks.push(s);
    const cols = 8, rows = Math.ceil(marks.length / cols), cw = 128, ch = 96;
    const tex = make(cols * cw, rows * ch, (c) => {
      marks.forEach((s, i) => {
        const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
        c.fillStyle = WHITE; c.fillRect(x, y, cw, ch);
        c.fillStyle = '#d84a3a'; c.fillRect(x, y, cw, ch * 0.16);
        centered(c, `${s} m`, x + cw / 2, y + ch * 0.6, cw * 0.86, 44, '#2a2a30');
      });
    }, { aniso: 8 });
    const geos = marks.map((s, i) => {
      const f = spineAt(s), d = -DAM.half - 0.35 + 0.132, y = walkY(s) + 0.52;
      const u0 = (i % cols) / cols, v1 = 1 - Math.floor(i / cols) / rows;
      return facePlane(0.22, 0.165, f.e + f.ne * d, y, f.n + f.nn * d, f.ne, f.nn, [u0, v1 - 1 / rows, u0 + 1 / cols, v1]);
    });
    group.add(signMesh(geos, tex, 'sign.markers'));
  }

  if (frames.length) {
    const g = mergeGeometries(frames, false);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, cel({ vertexColors: true }));
    m.name = 'sign.frames';
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  scene.add(group);
  return { group, ...out };
}

const BLUE_HEX = 0x2f8fcf;
