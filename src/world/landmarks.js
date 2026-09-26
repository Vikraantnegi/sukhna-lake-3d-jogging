import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { rngKit } from '../core/util.js';
import { data, L, spineAt, nearestS, inLake, shoreDist } from './frame.js';
import { groundAt } from './terrain.js';
import { walkY, shoreOffset, DAM } from './dam.js';
import { LodSet, LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The landmarks, at their real OSM positions (plan §6).
 *
 *   east end   the Garden of Silence and its Buddha statue (OSM names
 *              both; the figure is a generic seated Buddha, not a copy
 *              of the real sculpture), the regulator's gates and the
 *              footbridge over them (photo r1 for the garden's look)
 *   west end   the entrance plaza (OSM has no tag: placed on the
 *              centroid of the west-end amenities), the gateway frame
 *              (r2), the chai and nimbu-paani stall, the boat club
 *              jetty at the real boating point with its row of swan
 *              pedal boats and the pink launch (r7, r9), the two OSM
 *              piers, the lake club's courts and a generic pavilion
 *   along      toilets, drinking water, shelters, fitness stations and
 *              information boards at their OSM positions
 *
 * Everything not confirmed by OSM or a photo is generic and says so.
 * ------------------------------------------------------------------ */

const lm = (id) => data.landmarks.find((l) => l.id === id);
const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

/** Accumulates coloured parts; `mesh()` merges them into one vertex-coloured mesh. */
class Parts {
  constructor() { this.list = []; }
  add(geo, color, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (g.attributes.uv) g.deleteAttribute('uv');
    this.list.push(g);
    return this;
  }
  /** Add a geometry that already carries its own vertex colours. */
  addColoured(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    this.list.push(g);
    return this;
  }
  box(w, h, d, color, x, y, z, ry = 0, rx = 0, rz = 0) { return this.add(new THREE.BoxGeometry(w, h, d), color, M4(x, y, z, ry, 1, 1, 1, rx, rz)); }
  cyl(rt, rb, h, color, x, y, z, seg = 8, sx = 1, sz = 1) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, M4(x, y, z, 0, sx, 1, sz)); }
  ball(r, color, x, y, z, sx = 1, sy = 1, sz = 1, detail = 1) { return this.add(new THREE.IcosahedronGeometry(r, detail), color, M4(x, y, z, 0, sx, sy, sz)); }
  mesh(mat, name) {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

/** Local frame at a point: yaw so that local -z points along the given ENU direction. */
const yawToward = (de, dn) => Math.atan2(-de, dn);
/** World position helper: ENU + local offsets (right, forward) rotated by yaw. */
function at(e, n, yaw, right, fwd) {
  // local x (right) and -z (forward) rotated by yaw into world x/z
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const x = e + right * c - fwd * s;
  const z = -n - right * s - fwd * c;
  return [x, z];
}

/* -------------------------- Garden of Silence -------------------------- */

function buddha(p, x, y, z, yaw) {
  // generic seated figure on a lotus plinth; grey stone
  const stone = 0x9c978d, dark = 0x7f7a71;
  const put = (geo, col, lx, ly, lz, sx = 1, sy = 1, sz = 1) => {
    const [wx, wz] = [x + lx * Math.cos(yaw) - lz * Math.sin(yaw), z - lx * Math.sin(yaw) - lz * Math.cos(yaw)];
    p.add(geo, col, M4(wx, y + ly, wz, yaw, sx, sy, sz));
  };
  put(new THREE.BoxGeometry(3.2, 1.2, 3.2), dark, 0, 0.6, 0);
  put(new THREE.CylinderGeometry(1.5, 1.35, 0.45, 16), stone, 0, 1.42, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    put(new THREE.IcosahedronGeometry(0.34, 0), stone, Math.cos(a) * 1.45, 1.5, Math.sin(a) * 1.45, 1, 0.6, 1.6);
  }
  put(new THREE.IcosahedronGeometry(1, 1), stone, 0, 1.95, 0.1, 1.25, 0.42, 0.85); // crossed legs
  put(new THREE.IcosahedronGeometry(1, 1), stone, 0, 2.75, 0.05, 0.72, 0.95, 0.52); // torso
  put(new THREE.IcosahedronGeometry(1, 1), stone, 0, 2.1, -0.45, 0.42, 0.18, 0.28); // hands in the lap
  put(new THREE.IcosahedronGeometry(0.42, 1), stone, 0, 3.95, 0.0);                 // head
  put(new THREE.IcosahedronGeometry(0.17, 1), stone, 0, 4.4, 0.0);                  // ushnisha
}

function gazebo(p, x, y, z) {
  // thatched gazebo (r1): six posts, a low rail, a conical thatch
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p.cyl(0.1, 0.12, 2.6, 0x5a4a3a, x + Math.cos(a) * 2.2, y + 1.3, z + Math.sin(a) * 2.2, 6);
  }
  p.cyl(2.4, 2.4, 0.25, 0xb9ab8e, x, y + 0.12, z, 12);
  p.add(new THREE.ConeGeometry(3.3, 2.2, 10), PAL.thatch, M4(x, y + 3.6, z));
  p.cyl(0.25, 0.25, 0.4, 0x4a3c2e, x, y + 4.8, z, 6);
}

function buildGarden(p) {
  const g = data.features.gardens.find((q) => /Silence/.test(q.name || ''));
  const st = lm('buddha_statue');
  if (!g || !st) return;
  const [se, sn] = st.at;
  const sy = groundAt(se, sn);
  // face the statue toward the lake (north-west of it)
  const f = spineAt(st.s);
  buddha(p, se, sy - 0.1, -sn, yawToward(f.ne, f.nn));
  // a ring of terracotta pavers and four stone seats round it
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const e = se + Math.cos(a) * 5.5, n = sn + Math.sin(a) * 5.5;
    p.box(2.2, 0.12, 1.4, i % 2 ? PAL.paverRed : PAL.paverRedDark, e, groundAt(e, n) + 0.05, -n, -a);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const e = se + Math.cos(a) * 7.5, n = sn + Math.sin(a) * 7.5;
    p.box(1.8, 0.45, 0.6, 0xa9a397, e, groundAt(e, n) + 0.22, -n, -a + Math.PI / 2);
  }
  // gazebo and flower beds inside the real garden outline
  let ce = 0, cn = 0;
  for (const [e, n] of g.p) { ce += e / g.p.length; cn += n / g.p.length; }
  const ge = ce + (ce - se) * 0.4, gn = cn + (cn - sn) * 0.4;
  gazebo(p, ge, groundAt(ge, gn), -gn);
  const rng = rngKit(88);
  const BEDS = [0xd23b35, 0xf2c230, 0xe07a9a, 0xf08a2e, 0xf4f0e6];
  for (let i = 0; i < 9; i++) {
    const t = rng.next();
    const k = Math.floor(rng.next() * g.p.length);
    const [e0, n0] = g.p[k];
    const e = ce + (e0 - ce) * (0.35 + 0.4 * t), n = cn + (n0 - cn) * (0.35 + 0.4 * t);
    const y = groundAt(e, n);
    p.ball(1.6, 0x4f6b35, e, y + 0.1, -n, 1.3, 0.22, 0.9, 1);
    for (let q = 0; q < 7; q++) p.ball(0.22, BEDS[(i + q) % BEDS.length], e + rng.range(-1.4, 1.4), y + 0.42, -n + rng.range(-0.8, 0.8), 1, 1, 1, 0);
  }
  // the low dark-green chain-link fence along the garden's real boundary (r1)
  for (let i = 0; i < g.p.length; i++) {
    const a = g.p[i], b = g.p[(i + 1) % g.p.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < len; t += 2.5) {
      const e = a[0] + ((b[0] - a[0]) * t) / len, n = a[1] + ((b[1] - a[1]) * t) / len;
      if (nearestS(e, n).d < 8) continue; // open onto the walk
      const y = groundAt(e, n);
      p.cyl(0.035, 0.035, 1.1, PAL.chainLink, e, y + 0.55, -n, 4);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      p.box(2.5, 0.9, 0.03, 0x3b5a40, e + Math.cos(ang) * 1.25, y + 0.55, -(n + Math.sin(ang) * 1.25), ang);
    }
  }
}

/* ------------------------------ regulator ------------------------------ */

function buildRegulator(p) {
  const bridge = data.features.paths.find((q) => q.bridge);
  const reg = lm('regulator');
  if (!bridge || !reg) return null;
  const pts = bridge.p;
  const a = pts[0], b = pts[pts.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const deckY = Math.max(walkY(0), 2.6) + 0.4;
  const me = (a[0] + b[0]) / 2, mn = (a[1] + b[1]) / 2;
  // deck and railings (concrete, generic), piers every ~8 m, steel-blue gates between them
  p.box(len, 0.5, 3.4, PAL.concrete, me, deckY - 0.25, -mn, ang);
  for (const side of [-1, 1]) {
    const oe = -Math.sin(ang) * 1.6 * side, on = Math.cos(ang) * 1.6 * side;
    p.box(len, 0.12, 0.12, 0xe9e5dc, me + oe, deckY + 0.95, -(mn + on), ang);
    for (let t = 0; t <= len; t += 2) p.box(0.1, 0.95, 0.1, 0xe9e5dc, a[0] + Math.cos(ang) * t + oe, deckY + 0.47, -(a[1] + Math.sin(ang) * t + on), ang);
  }
  const piers = Math.max(2, Math.round(len / 8));
  for (let i = 0; i <= piers; i++) {
    const t = i / piers, e = a[0] + (b[0] - a[0]) * t, n = a[1] + (b[1] - a[1]) * t;
    p.box(1.4, deckY + 3.2, 3.8, PAL.concreteDark, e, (deckY - 3.2) / 2 - 0.05, -n, ang);
    if (i < piers) {
      const t2 = (i + 0.5) / piers, e2 = a[0] + (b[0] - a[0]) * t2, n2 = a[1] + (b[1] - a[1]) * t2;
      p.box(len / piers - 1.4, 2.6, 0.3, 0x5a6f80, e2, 0.6, -n2, ang);
      p.box(len / piers - 1.4, 0.3, 0.6, 0x3f4f5c, e2, 2.0, -n2, ang);
    }
  }
  // a gauge post in the water beside it: white with black and red marks
  const ge = a[0] + (b[0] - a[0]) * 0.3 - Math.sin(ang) * 6, gn = a[1] + (b[1] - a[1]) * 0.3 + Math.cos(ang) * 6;
  p.box(0.3, 4, 0.1, 0xf4f2ec, ge, 0.5, -gn, ang);
  for (let k = 0; k < 6; k++) p.box(0.32, 0.12, 0.12, k % 2 ? 0x2a2a2a : 0xc8322d, ge, -1 + k * 0.5, -gn, ang);
  return deckY;
}

/* ------------------------------ west end ------------------------------ */

function buildPlaza(p) {
  const pl = lm('entrance_plaza');
  if (!pl) return null;
  const f = spineAt(pl.s);
  const yaw = yawToward(f.ne, f.nn); // local -z toward the lake
  const [pe, pn] = pl.at;
  // terracotta pavers, 44 x 30 m: one draped surface (shared corner heights, so it is
  // a single clean skin over the ground), 1.5 m tiles in two tones, checkered
  const T = 1.5, pos = [], col = [], index = [];
  const cA = new THREE.Color(PAL.paverRed), cB = new THREE.Color(PAL.paverRedDark);
  const hAt = (u, v) => { const [x, z] = at(pe, pn, yaw, u, v); return [x, groundAt(x, -z) + 0.06, z]; };
  for (let u = -22; u < 22; u += T) {
    for (let v = -15; v < 15; v += T) {
      const [cx, cz] = at(pe, pn, yaw, u + T / 2, v + T / 2);
      if (inLake(cx, -cz) || nearestS(cx, -cz).d < DAM.half + 0.5) continue;
      const k = pos.length / 3, c = ((Math.round(u / T) + Math.round(v / T)) & 1) ? cA : cB;
      for (const [uu, vv] of [[u, v], [u + T, v], [u + T, v + T], [u, v + T]]) { pos.push(...hAt(uu, vv)); col.push(c.r, c.g, c.b); }
      index.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  pg.setIndex(index);
  pg.computeVertexNormals();
  // whichever way the tiles wound, the paving faces up
  if (pg.attributes.normal.getY(0) < 0) { index.reverse(); pg.setIndex(index); pg.computeVertexNormals(); }
  p.addColoured(pg);
  // the gateway frame on the walk (r2, left): white beams on red posts, generic
  const gs = Math.min(L - 8, pl.s + 14), g = spineAt(gs), gy = walkY(gs), gyaw = yawToward(g.ne, g.nn);
  for (const side of [-1, 1]) {
    const e = g.e + g.ne * DAM.half * 1.08 * side, n = g.n + g.nn * DAM.half * 1.08 * side;
    p.box(0.45, 4.6, 0.45, 0xc8322d, e, gy + 2.3, -n, gyaw);
  }
  p.box(0.5, 0.45, DAM.half * 2.4, 0xf1efe8, g.e, gy + 4.55, -g.n, gyaw);
  p.box(0.35, 0.3, DAM.half * 2.3, 0xf1efe8, g.e, gy + 4.05, -g.n, gyaw);
  p.box(0.12, 0.9, 3.6, 0x2f8fcf, g.e, gy + 5.2, -g.n, gyaw); // the sign board (lettering: world/signs.js)
  // the chai and nimbu-paani stall on the plaza, by the walk: booth, striped awning, counter, kettle
  const [kx, kz] = at(pe, pn, yaw, -8, 8);
  const ke = kx, kn = -kz, ky = groundAt(ke, kn);
  p.box(2.6, 2.3, 2.0, 0xd9c7a0, kx, ky + 1.15, kz, yaw);
  for (let i = 0; i < 6; i++) p.box(0.5, 0.08, 1.4, i % 2 ? 0xd23b35 : 0xf4f0e6, kx + Math.cos(-yaw) * (i - 2.5) * 0.5, ky + 2.45, kz + Math.sin(-yaw) * (i - 2.5) * 0.5 - 0.6 * Math.cos(yaw), yaw, 0.3);
  const [cx, cz] = at(ke, kn, yaw, 0, 1.2);
  p.box(2.6, 1.0, 0.5, 0x8a4a32, cx, ky + 0.5, cz, yaw);
  p.cyl(0.22, 0.26, 0.45, 0xb9bcc4, cx + 0.6, ky + 1.25, cz, 10);
  p.cyl(0.05, 0.05, 0.3, 0x3a3a3a, cx + 0.6, ky + 1.55, cz + 0.2, 5);
  // a vendor's cart nearby, with an umbrella
  const [vx, vz] = at(pe, pn, yaw, 6, 6);
  const vy = groundAt(vx, -vz);
  p.box(1.6, 0.8, 0.9, 0x3f7fd0, vx, vy + 0.9, vz, yaw);
  for (const s of [-0.6, 0.6]) p.cyl(0.32, 0.32, 0.08, 0x2a2a2a, vx + Math.cos(-yaw) * s, vy + 0.32, vz + Math.sin(-yaw) * s, 10);
  p.cyl(0.03, 0.03, 1.6, 0x444444, vx, vy + 2.0, vz, 5);
  p.add(new THREE.ConeGeometry(1.2, 0.45, 8), 0xf2c230, M4(vx, vy + 2.85, vz));
  return { kiosk: [ke, kn], kioskY: ky, yaw, cart: [vx, -vz], gate: gs };
}

const SWANS = [PAL.boatBlue, PAL.boatSky, PAL.boatYellow, PAL.boatRed, PAL.boatOrange];
/** A pedal boat as a swan (r7): hull, seat well, neck and head.  Local +x is the bow. */
export function swanParts(color) {
  const q = new Parts();
  q.add(new THREE.IcosahedronGeometry(1, 1), color, M4(0, 0.35, 0, 0, 1.45, 0.45, 0.8));
  q.box(1.2, 0.2, 0.9, 0xf4f0e6, -0.2, 0.62, 0);
  q.add(new THREE.CylinderGeometry(0.12, 0.2, 1.3, 6), 0xfbfaf6, M4(1.05, 1.05, 0, 0, 1, 1, 1, 0, -0.35));
  q.add(new THREE.IcosahedronGeometry(0.24, 1), 0xfbfaf6, M4(1.3, 1.7, 0, 0, 1.3, 1, 1));
  q.add(new THREE.ConeGeometry(0.08, 0.28, 5), 0xf08a2e, M4(1.6, 1.68, 0, 0, 1, 1, 1, 0, -Math.PI / 2));
  const g = mergeGeometries(q.list, false);
  g.computeVertexNormals();
  return g;
}

function buildBoatClub(p, instMat) {
  const bt = lm('boating');
  if (!bt) return null;
  const s = bt.s, f = spineAt(s), dS = shoreOffset(s);
  if (!Number.isFinite(dS)) return null;
  const yaw = yawToward(f.ne, f.nn);
  // the jetty: from the embankment 28 m out over the water, 6 m wide, pavers with a pink border (r7)
  const d0 = dS - 2.5, d1 = dS + 28, deckY = 0.7;
  const dm = (d0 + d1) / 2, len = d1 - d0;
  const ce = f.e + f.ne * dm, cn = f.n + f.nn * dm;
  p.box(6.4, 0.45, len, 0xd8627a, ce, deckY - 0.2, -cn, yaw);
  p.box(5.4, 0.47, len - 1, PAL.jettyPaver, ce, deckY - 0.19, -cn, yaw);
  for (let d = d0 + 2; d < d1; d += 4) for (const side of [-1, 1]) {
    const e = f.e + f.ne * d + f.te * 3 * side, n = f.n + f.nn * d + f.tn * 3 * side;
    p.cyl(0.18, 0.18, 3.2, 0x6b5a48, e, deckY - 1.8, -n, 6);
  }
  // the row of swans moored along both sides, bows out
  const swans = [];
  const rng = rngKit(7);
  for (let d = d0 + 5; d < d1 - 1; d += 2.1) {
    for (const side of [-1, 1]) {
      if (rng.chance(0.12)) continue;
      const e = f.e + f.ne * d + f.te * (3.2 + 1.5) * side, n = f.n + f.nn * d + f.tn * (3.2 + 1.5) * side;
      if (!inLake(e, n)) continue;
      swans.push({ e, n, yaw: yaw + (side > 0 ? 0 : Math.PI), color: SWANS[Math.floor(rng.next() * SWANS.length)] });
    }
  }
  // the pink launch at the end of the jetty
  const le = f.e + f.ne * (d1 + 5), ln = f.n + f.nn * (d1 + 5);
  p.add(new THREE.IcosahedronGeometry(1, 1), PAL.launchPink, M4(le, 0.35, -ln, yaw + Math.PI / 2, 4.2, 0.7, 1.4));
  p.box(3.0, 1.1, 1.8, 0xf4f0e6, le, 1.2, -ln, yaw + Math.PI / 2);
  p.box(3.4, 0.12, 2.2, 0xd84a6a, le, 1.85, -ln, yaw + Math.PI / 2);

  const swanGeo = swanParts(0xffffff);
  const inst = new THREE.InstancedMesh(swanGeo, instMat, swans.length);
  const col = new THREE.Color();
  swans.forEach((w, i) => {
    inst.setMatrixAt(i, M4(w.e, 0.02, -w.n, w.yaw + Math.PI / 2));
    inst.setColorAt(i, col.set(w.color));
  });
  inst.computeBoundingSphere();
  inst.castShadow = true;
  inst.name = 'swanBoats';
  return { swans: inst, jetty: { s, d0, d1, deckY }, launch: [le, ln] };
}

function buildPiers(p) {
  for (const pr of data.features.piers) {
    let ce = 0, cn = 0;
    for (const [e, n] of pr.p) { ce += e / pr.p.length; cn += n / pr.p.length; }
    const shape = new THREE.Shape(pr.p.map(([e, n]) => new THREE.Vector2(e, n)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.3, 0);
    p.add(geo, 0xb08a64);
    for (const [e, n] of pr.p) p.cyl(0.15, 0.15, 2.5, 0x6b5a48, e, -0.6, -n, 6);
  }
}

function buildPavilions(p) {
  // generic: the lake club pavilion by its courts, the Nature Interpretation Centre
  const club = lm('lake_club_courts');
  if (club) {
    // generic pavilion beside the courts, on the land point farthest from the water
    let best = null;
    for (let r = 30; r <= 60; r += 10) for (let a = 0; a < 16; a++) {
      const e = club.at[0] + Math.cos((a / 16) * Math.PI * 2) * r, n = club.at[1] + Math.sin((a / 16) * Math.PI * 2) * r;
      const sd = shoreDist(e, n, 200);
      if (!best || sd > best.sd) best = { e, n, sd };
    }
    const y = groundAt(best.e, best.n);
    const x = best.e, z = -best.n;
    p.box(20, 3.2, 12, 0xf1eee6, x, y + 1.6, z);
    p.box(20, 0.6, 12, 0xb9b3a7, x, y + 3.3, z);
    p.box(10, 3.2, 12, 0xe8e2d4, x + 3, y + 4.9, z);
    p.box(24, 0.35, 16, 0xf4f2ec, x + 1, y + 6.7, z);
  }
  const nc = lm('nature_centre');
  if (nc) {
    const [e, n] = nc.at, y = groundAt(e, n);
    p.box(14, 4, 9, 0xa8674a, e, y + 2, -n);
    p.box(16, 0.5, 11, 0xc9c4b8, e, y + 4.2, -n);
  }
}

function buildAmenities(p) {
  const out = { toilets: 0, water: 0, shelter: 0, fitness: 0, info: 0, food: 0 };
  for (const l of data.landmarks) {
    const [e, n] = l.at;
    if (inLake(e, n)) continue;
    const ns = nearestS(e, n);
    if (ns.d < DAM.verge && ns.s > 0.5 && ns.s < L - 0.5) continue; // not on the walk itself
    const y = groundAt(e, n), f = spineAt(ns.s), yaw = yawToward(f.ne, f.nn);
    switch (l.kind) {
      case 'toilets': p.box(6, 3, 4, 0xd9d3c6, e, y + 1.5, -n, yaw); p.box(6.6, 0.3, 4.6, 0x9e988c, e, y + 3.1, -n, yaw); out.toilets++; break;
      case 'drinking_water': p.box(0.5, 1.0, 0.5, 0xbfb9ad, e, y + 0.5, -n, yaw); p.cyl(0.35, 0.3, 0.2, 0x9e988c, e, y + 1.05, -n, 10); out.water++; break;
      case 'shelter':
        for (const [u, v] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) { const [x, z] = at(e, n, yaw, u, v); p.cyl(0.08, 0.08, 2.6, 0x4a4a4a, x, y + 1.3, z, 6); }
        p.box(5, 0.2, 3.8, 0x8a4a32, e, y + 2.7, -n, yaw); out.shelter++; break;
      case 'fitness':
        for (let i = 0; i < 3; i++) { const [x, z] = at(e, n, yaw, (i - 1) * 2.2, 0); p.cyl(0.05, 0.05, 2.2, 0x3f7fd0, x - 0.5, y + 1.1, z, 5); p.cyl(0.05, 0.05, 2.2, 0x3f7fd0, x + 0.5, y + 1.1, z, 5); p.box(1.1, 0.06, 0.06, 0xd9d9d9, x, y + 2.1, z, yaw); }
        out.fitness++; break;
      case 'information': p.box(1.4, 1.0, 0.1, 0x2f8fcf, e, y + 1.6, -n, yaw); for (const u of [-0.55, 0.55]) { const [x, z] = at(e, n, yaw, u, 0.05); p.cyl(0.04, 0.04, 1.6, 0x444444, x, y + 0.8, z, 5); } out.info++; break;
      case 'food_court': p.box(12, 3.4, 8, 0xe6e0d4, e, y + 1.7, -n, yaw); p.box(14, 0.4, 10, 0xd84a3a, e, y + 3.6, -n, yaw); out.food++; break;
      default: break;
    }
  }
  return out;
}

/* ------------------------------- build ------------------------------- */

export function buildLandmarks(scene) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const mat = cel({ color: 0xffffff, vertexColors: true, flat: false });
  const instMat = cel({ color: 0xffffff, flat: false });
  const lod = new LodSet('landmarks');
  const place = (parts, name, centre, dist = 900) => {
    const m = parts.mesh(mat, name);
    if (!m) return null;
    setLayers(m, LAYER.NEAR);
    group.add(m);
    lod.add(new THREE.Vector3(centre[0], 0, -centre[1]), [{ dist, obj: m }], name);
    return m;
  };
  const east = new Parts();
  buildGarden(east);
  const regulatorDeckY = buildRegulator(east);
  const g = lm('garden_of_silence') || lm('buddha_statue');
  place(east, 'eastEnd', g ? g.at : [0, 0], 1100);

  const west = new Parts();
  const plaza = buildPlaza(west);
  const club = buildBoatClub(west, instMat);
  buildPiers(west);
  buildPavilions(west);
  const pl = lm('entrance_plaza');
  place(west, 'westEnd', pl ? pl.at : [0, 0], 1400);
  if (club?.swans) {
    setLayers(club.swans, LAYER.NEAR);
    group.add(club.swans);
    const bt = lm('boating');
    lod.add(new THREE.Vector3(bt.at[0], 0, -bt.at[1]), [{ dist: 900, obj: club.swans }], 'swans');
  }

  const along = new Parts();
  const amenities = buildAmenities(along);
  const am = along.mesh(mat, 'amenities');
  if (am) { setLayers(am, LAYER.NEAR); group.add(am); } // small and scattered: frustum culling is enough

  scene.add(group);
  return { group, lod, plaza, club, amenities, regulatorDeckY };
}
