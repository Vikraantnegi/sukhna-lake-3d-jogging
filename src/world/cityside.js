import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cel } from '../core/toon.js';
import { PAL } from '../core/palette.js';
import { data, L, nearestS } from './frame.js';
import { DAM } from './dam.js';
import { groundAt } from './terrain.js';
import { LodSet, LAYER, setLayers } from './chunks.js';

/* ------------------------------------------------------------------ *
 * The city side (plan §6): real OSM roads, footways, parking, pitches and
 * buildings, all draped on the real ground.
 *
 * Buildings are Chandigarh modernist in spirit, not copies: each OSM
 * footprint is extruded floor by floor in one of three finishes the city
 * is built from -- whitewash, béton brut, exposed brick -- with a dark
 * band of windows and shade per floor (the brise-soleil read from a
 * distance) and a flat roof with a parapet.  Everything is merged per
 * 400 m chunk and distance-culled.
 * ------------------------------------------------------------------ */

const CHUNK = 400;
const C = (h) => new THREE.Color(h);
const FINISH = [C(0xe6e0d4), C(PAL.concrete), C(0xa8674a)]; // whitewash, béton brut, exposed brick
const BAND = C(0x4a5260), ROOF = C(0x8f8a80), PARAPET = C(0xb9b3a7);
const LEVELS = { house: 2, residential: 3, apartments: 4, commercial: 3, school: 3, yes: 2, hut: 1, roof: 1, garage: 1, service: 1, public: 3, hotel: 4, retail: 2, office: 4, civic: 3, government: 3, college: 3, hospital: 4, church: 2, temple: 2 };
const FLOOR = 3.3;

function hash(x, y) {
  let h = Math.imul(Math.floor(x * 7.3) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(y * 5.1), 0xc2b2ae35);
  h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------ ribbons ------------------------------ */

/** A flat ribbon along a polyline, draped on the ground (+lift), in world coordinates. */
function ribbon(pts, width, lift, color, pos, col, idx) {
  const c = C(color);
  // resample to <= 6 m so the ribbon follows the ground
  const dense = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 6));
    for (let q = 0; q < k; q++) dense.push([a[0] + ((b[0] - a[0]) * q) / k, a[1] + ((b[1] - a[1]) * q) / k]);
  }
  dense.push(pts[pts.length - 1]);
  let prev = -1;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const nx = ty, ny = -tx, [e, n] = dense[i], base = pos.length / 3;
    for (const sgn of [-1, 1]) {
      const pe = e + nx * width * 0.5 * sgn, pn = n + ny * width * 0.5 * sgn;
      pos.push(pe, groundAt(pe, pn) + lift, -pn);
      col.push(c.r, c.g, c.b);
    }
    if (prev >= 0) idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
    prev = base;
  }
}

/** A flat polygon draped on the ground (+lift): triangulated, then each vertex set on the ground. */
function drape(ring, lift, color, pos, col, idx, maxEdge = 6) {
  const shape = new THREE.Shape(ring.map(([e, n]) => new THREE.Vector2(e, n)));
  let g = new THREE.ShapeGeometry(shape);
  // subdivide long edges so the drape follows the ground
  g = g.index ? g.toNonIndexed() : g;
  const p = g.attributes.position;
  const tris = [];
  for (let t = 0; t < p.count; t += 3) tris.push([[p.getX(t), p.getY(t)], [p.getX(t + 1), p.getY(t + 1)], [p.getX(t + 2), p.getY(t + 2)]]);
  const out = [];
  const split = (a, b, c2, depth) => {
    const l = [Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c2[0], b[1] - c2[1]), Math.hypot(c2[0] - a[0], c2[1] - a[1])];
    const m = Math.max(...l);
    if (m <= maxEdge || depth > 8) { out.push(a, b, c2); return; }
    if (m === l[0]) { const d = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; split(a, d, c2, depth + 1); split(d, b, c2, depth + 1); }
    else if (m === l[1]) { const d = [(b[0] + c2[0]) / 2, (b[1] + c2[1]) / 2]; split(a, b, d, depth + 1); split(a, d, c2, depth + 1); }
    else { const d = [(c2[0] + a[0]) / 2, (c2[1] + a[1]) / 2]; split(a, b, d, depth + 1); split(d, b, c2, depth + 1); }
  };
  for (const [a, b, c2] of tris) split(a, b, c2, 0);
  const c = C(color);
  for (let i = 0; i < out.length; i += 3) {
    const base = pos.length / 3;
    // ShapeGeometry winds counter-clockwise in (e, n); in world (x, -z) that faces up
    for (const [e, n] of [out[i], out[i + 1], out[i + 2]]) { pos.push(e, groundAt(e, n) + lift, -n); col.push(c.r, c.g, c.b); }
    idx.push(base, base + 1, base + 2);
  }
  g.dispose();
}

/* ------------------------------ buildings ------------------------------ */

function footprintOf(b) {
  if (b.p) return b.p;
  const ca = Math.cos(b.a), sa = Math.sin(b.a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [b.c[0] + ca * u * b.l / 2 - sa * v * b.w / 2, b.c[1] + sa * u * b.l / 2 + ca * v * b.w / 2]);
}

/** One building, floor by floor, into the chunk's arrays. */
function building(b, pos, col, idx) {
  let ring = footprintOf(b);
  // counter-clockwise in (e, n)
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  if (area < 0) ring = ring.slice().reverse();
  const floors = b.lv ?? LEVELS[b.k] ?? 2;
  let base = Infinity;
  for (const [e, n] of ring) base = Math.min(base, groundAt(e, n));
  base -= 0.4;
  const top = base + 0.4 + floors * FLOOR;
  const finish = FINISH[Math.floor(hash(b.c[0], b.c[1]) * 3)];
  // walls: per floor a solid band and a dark window band
  const bands = [[base, base + 0.4 + 0.9, finish]];
  for (let f = 0; f < floors; f++) {
    const y0 = base + 0.4 + f * FLOOR;
    bands.push([y0 + 0.9, y0 + 2.3, BAND], [y0 + 2.3, y0 + FLOOR + 0.9 > top ? top : y0 + FLOOR + 0.9, finish]);
  }
  bands.push([top, top + 0.6, PARAPET]);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c2 = ring[(i + 1) % ring.length];
    for (const [y0, y1, c] of bands) {
      if (y1 <= y0) continue;
      const k = pos.length / 3;
      pos.push(a[0], y0, -a[1], c2[0], y0, -c2[1], c2[0], y1, -c2[1], a[0], y1, -a[1]);
      for (let q = 0; q < 4; q++) col.push(c.r, c.g, c.b);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
  }
  // flat roof (slightly below the parapet top)
  const shape = new THREE.Shape(ring.map(([e, n]) => new THREE.Vector2(e, n)));
  const tri = THREE.ShapeUtils.triangulateShape(shape.getPoints(), []);
  const k0 = pos.length / 3;
  for (const [e, n] of ring) { pos.push(e, top + 0.15, -n); col.push(ROOF.r, ROOF.g, ROOF.b); }
  for (const [a, b2, c3] of tri) idx.push(k0 + a, k0 + b2, k0 + c3);
}

function meshFrom(pos, col, idx, mat, name) {
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.receiveShadow = true;
  return m;
}

/* ------------------------------- build ------------------------------- */

const ROAD_W = { secondary: 9, tertiary: 7, residential: 5, service: 3.5, unclassified: 5, secondary_link: 5, tertiary_link: 5, living_street: 4, track: 3, primary: 10 };

export function buildCityside(scene) {
  const group = new THREE.Group();
  group.name = 'cityside';
  const lod = new LodSet('city');
  const flatMat = cel({ color: 0xffffff, vertexColors: true, relief: true, bands: 'terrain', flat: false, cache: false, side: THREE.DoubleSide });
  flatMat.polygonOffset = true;
  flatMat.polygonOffsetFactor = -2;
  flatMat.polygonOffsetUnits = -2;
  const bldMat = cel({ color: 0xffffff, vertexColors: true, bands: 3 });
  const chunks = new Map();
  const chunkOf = (e, n) => {
    const key = Math.floor(e / CHUNK) + ',' + Math.floor(n / CHUNK);
    let c = chunks.get(key);
    if (!c) chunks.set(key, (c = { key, e: (Math.floor(e / CHUNK) + 0.5) * CHUNK, n: (Math.floor(n / CHUNK) + 0.5) * CHUNK, flat: [[], [], []], bld: [[], [], []] }));
    return c;
  };
  const stats = { roads: 0, paths: 0, buildings: 0, parking: 0, pitches: 0 };

  for (const r of data.features.roads) {
    const mid = r.p[Math.floor(r.p.length / 2)];
    const c = chunkOf(mid[0], mid[1]);
    ribbon(r.p, ROAD_W[r.k] ?? 4, 0.14, PAL.road, ...c.flat);
    stats.roads++;
  }
  // footways stop at the walk's edge: split them wherever they cross it
  const onWalk = ([e, n]) => { const ns = nearestS(e, n); return ns.d < DAM.half + 1.5 && ns.s > 0.5 && ns.s < L - 0.5; };
  for (const p of data.features.paths) {
    if (p.k === 'steps' || p.bridge) continue;
    const dense = [];
    for (let i = 1; i < p.p.length; i++) {
      const a = p.p[i - 1], b = p.p[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(len / 2));
      for (let q = 0; q < k; q++) dense.push([a[0] + ((b[0] - a[0]) * q) / k, a[1] + ((b[1] - a[1]) * q) / k]);
    }
    dense.push(p.p[p.p.length - 1]);
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const mid = run[Math.floor(run.length / 2)], ch = chunkOf(mid[0], mid[1]);
        ribbon(run, p.k === 'cycleway' ? 2.5 : 2.2, 0.12, PAL.path, ...ch.flat);
        stats.paths++;
      }
      run = [];
    };
    for (const q of dense) { if (onWalk(q)) flush(); else run.push(q); }
    flush();
  }
  for (const pk of data.features.parking) {
    const mid = pk.p[0];
    const c = chunkOf(mid[0], mid[1]);
    drape(pk.p, 0.1, PAL.paved, ...c.flat);
    stats.parking++;
  }
  for (const pt of data.features.pitches) {
    const c = chunkOf(pt.p[0][0], pt.p[0][1]);
    const col = pt.sport === 'tennis' ? 0x4f8a5a : pt.sport === 'badminton' ? 0x6f8fa0 : 0xa08a5a;
    drape(pt.p, 0.11, col, ...c.flat);
    stats.pitches++;
  }
  for (const b of data.features.buildings) {
    const c = chunkOf(b.c[0], b.c[1]);
    building(b, ...c.bld);
    stats.buildings++;
  }

  for (const c of chunks.values()) {
    const flat = meshFrom(...c.flat, flatMat, `cityFlat${c.key}`);
    const bld = meshFrom(...c.bld, bldMat, `cityBuildings${c.key}`);
    const grp = new THREE.Group();
    if (flat) { flat.userData.noOutline = true; grp.add(flat); }
    if (bld) { bld.castShadow = true; grp.add(bld); }
    setLayers(grp, LAYER.NEAR, LAYER.FAR);
    group.add(grp);
    lod.add(new THREE.Vector3(c.e, 0, -c.n), [{ dist: 2200, obj: grp }], 'city');
  }
  stats.chunks = chunks.size;
  scene.add(group);
  return { group, lod, stats };
}
