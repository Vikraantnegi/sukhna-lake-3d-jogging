import { data, toENU, azimuthForYaw } from './frame.js';
import { COVER, NEAR } from './terrain.js';

/* ------------------------------------------------------------------ *
 * ?flat=1 -- the map panel (plan §3).
 *
 * There is no planet to compare against any more, so this panel shows the
 * data the world is built from, in the same real ENU metres, beside the
 * 3D view: the land cover, the lake, roads and buildings, the walk, the
 * real landmarks and stairs, and live on top of that the camera with its
 * view cone and every terrain chunk coloured by its current LOD.  It is
 * how alignment and distance culling get checked by eye.
 * ------------------------------------------------------------------ */

const COVER_RGB = {
  land: '#e9e5d6', lake: '#7aa3c8', water: '#8cb4d7', forest: '#4f7a4a', scrub: '#98a870', park: '#9cc684', golf: '#b4d78c',
  built: '#d6cdbf', parking: '#bdbdc6', pitch: '#c8a98a', wetland: '#7fae9f', commercial: '#dcc0c0', grass: '#aad296',
};
const LOD_RGBA = ['rgba(40,160,80,.28)', 'rgba(230,170,40,.22)', 'rgba(120,120,120,.12)'];

export function createFlatPanel(world) {
  const wrap = document.createElement('div');
  wrap.className = 'flatpanel';
  const cv = document.createElement('canvas');
  const info = document.createElement('div');
  info.className = 'flatinfo';
  wrap.append(cv, info);
  document.body.appendChild(wrap);

  const R = NEAR.rect; // the lake basin
  let W = 0, H = 0, sc = 1;
  const base = document.createElement('canvas');
  const T = (e, n) => [(e - R[0]) * sc, H - (n - R[1]) * sc];

  function drawBase() {
    const rect = wrap.getBoundingClientRect();
    W = Math.round(rect.width); H = Math.round(rect.height - 64);
    sc = Math.min(W / (R[2] - R[0]), H / (R[3] - R[1]));
    W = Math.round((R[2] - R[0]) * sc); H = Math.round((R[3] - R[1]) * sc);
    cv.width = base.width = W; cv.height = base.height = H;
    const c = base.getContext('2d');
    // cover cells
    const img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const e = R[0] + x / sc, n = R[1] + (H - y) / sc;
      const i = Math.floor((e - COVER.rect[0]) / COVER.step), j = Math.floor((n - COVER.rect[1]) / COVER.step);
      const cls = i >= 0 && j >= 0 && i < COVER.nx && j < COVER.ny ? COVER.classes[COVER.cells[j * COVER.nx + i]] : 'land';
      const hex = COVER_RGB[cls] || '#e9e5d6';
      const k = (y * W + x) * 4;
      img.data[k] = parseInt(hex.slice(1, 3), 16); img.data[k + 1] = parseInt(hex.slice(3, 5), 16); img.data[k + 2] = parseInt(hex.slice(5, 7), 16); img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    const line = (pts, style, w = 1, close = false) => {
      c.beginPath();
      pts.forEach(([e, n], i) => { const [x, y] = T(e, n); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      if (close) c.closePath();
      c.strokeStyle = style; c.lineWidth = w; c.stroke();
    };
    for (const r of data.features.roads) line(r.p, 'rgba(90,90,100,.55)', r.k === 'secondary' ? 1.4 : 0.7);
    for (const p of data.features.paths) line(p.p, 'rgba(160,90,40,.7)', 0.7);
    for (const b of data.features.buildings) {
      if (b.p) { line(b.p, 'rgba(140,50,50,.9)', 1, true); continue; }
      const ca = Math.cos(b.a), sa = Math.sin(b.a);
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [b.c[0] + ca * u * b.l / 2 - sa * v * b.w / 2, b.c[1] + sa * u * b.l / 2 + ca * v * b.w / 2]);
      line(pts, 'rgba(140,50,50,.5)', 0.6, true);
    }
    line(data.lake.outer, '#2d4f7a', 1.2, true);
    for (const r of data.lake.inner) line(r, '#2d4f7a', 1, true);
    line(data.promenade.pts, '#e07000', 2.2);
    c.font = '11px Segoe UI, sans-serif';
    for (const l of data.landmarks) {
      const [x, y] = T(l.at[0], l.at[1]);
      c.fillStyle = '#c0007a'; c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill();
      if (l.name && ['garden', 'statue', 'regulator', 'viewpoint', 'boat_rental', 'plaza', 'club', 'golf'].includes(l.kind)) {
        c.fillStyle = '#2a2a35'; c.fillText(l.name, x + 5, y - 4);
      }
    }
    for (const s of data.steps) { const [x, y] = T(s.top[0], s.top[1]); c.fillStyle = '#111'; c.fillRect(x - 2, y - 2, 4, 4); }
    // scale bar: 500 m
    c.fillStyle = '#222'; c.fillRect(12, H - 18, 500 * sc, 3); c.fillText('500 m', 12, H - 24);
  }

  let acc = 1;
  function update(camera, dt) {
    acc += dt;
    if (acc < 0.2) return;
    acc = 0;
    if (!W) drawBase();
    const c = cv.getContext('2d');
    c.drawImage(base, 0, 0);
    // terrain chunks by LOD (near grid only; the hill grid is off the map)
    let counts = [0, 0, 0];
    for (const st of world.terrain.lod.states()) {
      if (st.tag !== 'near') continue;
      const [e, n] = toENU(st.c);
      const half = 500;
      const [x0, y0] = T(e - half, n + half);
      const lv = Math.min(2, st.lv < 0 ? 2 : st.lv);
      counts[lv]++;
      c.fillStyle = LOD_RGBA[lv];
      c.fillRect(x0 + 1, y0 + 1, half * 2 * sc - 2, half * 2 * sc - 2);
    }
    // camera and view cone
    const [ce, cn] = toENU(camera.position);
    const [x, y] = T(ce, cn);
    const yaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
    const az = azimuthForYaw(yaw);
    const half = (camera.fov * camera.aspect * Math.PI) / 360;
    const reach = camera.far * sc;
    c.fillStyle = 'rgba(255,255,255,.25)'; c.strokeStyle = 'rgba(20,20,30,.7)';
    c.beginPath(); c.moveTo(x, y);
    const a0 = (az * Math.PI) / 180;
    for (const a of [a0 - half, a0 + half]) c.lineTo(x + Math.sin(a) * reach, y - Math.cos(a) * reach);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = '#111'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill();
    info.textContent = `E ${ce.toFixed(0)} m  N ${cn.toFixed(0)} m  y ${camera.position.y.toFixed(1)} m  az ${az.toFixed(0)}°   near-grid chunks: ${counts[0]} full, ${counts[1]} half`;
  }

  window.addEventListener('resize', () => { W = 0; });
  return { update };
}
