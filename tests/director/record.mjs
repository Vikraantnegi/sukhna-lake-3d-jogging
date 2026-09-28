// Render the director's shot lists (tests/director/*.json) to video.
//
//   node tests/director/record.mjs phase7-steps boating      # record these
//   node tests/director/record.mjs --all                     # every shot list
//   node tests/director/record.mjs trailer-30s --preview 2,9,16   # stills at those seconds, no video
//   node tests/director/record.mjs full-tour --size 1080     # 1920 x 1080 instead of 2560 x 1440
//   node tests/director/record.mjs trailer-30s --portrait    # 1080 x 1920 (a list with "portrait": true always is)
//
// Chrome runs headed on the real GPU (as the playtest does), plays the list at a fixed
// 1/60 s step, and the page records itself (captureStream(60) + the WebAudio output ->
// MediaRecorder, H.264 + AAC) into recordings/ through the dev server.  Afterwards the
// MP4's own sample table is read back to check every frame: how many, how long each
// lasts, and any gap (a dropped frame) or doubled frame.  A report goes next to each
// video (recordings/<name>.json).  If a 1440p recording drops frames it is recorded
// again at 1080p, and the report says so.
//
// The dev server must be running (npm run dev, port 5178).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'recordings');
const BASE = 'http://127.0.0.1:5178';
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const preview = opt('--preview');
let names = argv.filter((a, i) => !a.startsWith('--') && !['--preview', '--size', '--capture'].includes(argv[i - 1]));
if (flags.has('--all')) names = fs.readdirSync(HERE).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
if (!names.length && !flags.has('--phase1')) { console.log('usage: node tests/director/record.mjs <name...> | --all [--preview 2,5] [--size 1080] [--portrait]'); process.exit(1); }

const ARGS = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

/* ------------------------------ MP4 frame check ------------------------------ */

/** Read a (fragmented) MP4's tracks and every sample's duration from its boxes. */
export function mp4Samples(file) {
  const buf = fs.readFileSync(file);
  const tracks = {}; // id -> { type, timescale, width, height, defDur, samples: [dur] }
  const boxes = (s, e, fn) => { let p = s; while (p + 8 <= e) { let size = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); let hdr = 8; if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } if (size === 0) size = e - p; if (size < hdr) break; fn(type, p + hdr, p + size); p += size; } };
  let cur = null;
  const walk = (type, s, e) => {
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex', 'moof', 'traf'].includes(type)) return boxes(s, e, walk);
    if (type === 'tkhd') { const v = buf[s], id = buf.readUInt32BE(s + (v === 1 ? 20 : 12)); cur = tracks[id] ||= { id, samples: [], defDur: 0 }; cur.width = buf.readUInt32BE(e - 8) / 65536; cur.height = buf.readUInt32BE(e - 4) / 65536; }
    if (type === 'mdhd') { const v = buf[s]; cur.timescale = buf.readUInt32BE(s + (v === 1 ? 20 : 12)); }
    if (type === 'hdlr') cur.type = buf.toString('latin1', s + 8, s + 12);
    if (type === 'stsd') { const fmt = buf.toString('latin1', s + 12, s + 16); cur.codec = fmt; if (fmt === 'avc1' || fmt === 'hvc1') { cur.width = buf.readUInt16BE(s + 8 + 8 + 24); cur.height = buf.readUInt16BE(s + 8 + 8 + 26); } }
    if (type === 'stts') { const n = buf.readUInt32BE(s + 4); for (let i = 0; i < n; i++) { const c = buf.readUInt32BE(s + 8 + i * 8), d = buf.readUInt32BE(s + 12 + i * 8); for (let k = 0; k < c; k++) cur.samples.push(d); } }
    if (type === 'trex') { const id = buf.readUInt32BE(s + 4); (tracks[id] ||= { id, samples: [] }).defDur = buf.readUInt32BE(s + 12); }
    if (type === 'tfhd') { const fl = buf.readUInt32BE(s) & 0xffffff, id = buf.readUInt32BE(s + 4); cur = tracks[id]; let p = s + 8; if (fl & 1) p += 8; if (fl & 2) p += 4; cur.fragDur = fl & 8 ? buf.readUInt32BE(p) : cur.defDur; }
    if (type === 'trun') {
      const fl = buf.readUInt32BE(s) & 0xffffff, n = buf.readUInt32BE(s + 4); let p = s + 8;
      if (fl & 1) p += 4; if (fl & 4) p += 4;
      for (let i = 0; i < n; i++) { let d = cur.fragDur; if (fl & 0x100) { d = buf.readUInt32BE(p); p += 4; } if (fl & 0x200) p += 4; if (fl & 0x400) p += 4; if (fl & 0x800) p += 4; cur.samples.push(d); }
    }
  };
  boxes(0, buf.length, walk);
  return Object.values(tracks);
}

/** Frames, length, resolution; dropped (a frame lasting > 1.5 frames) and doubled (< 0.5 frame) frames. */
export function frameCheck(file, fps = 60) {
  const tracks = mp4Samples(file), v = tracks.find((t) => t.type === 'vide'), a = tracks.find((t) => t.type === 'soun');
  if (!v) return { ok: false, error: 'no video track' };
  const secs = v.samples.map((d) => d / v.timescale), step = 1 / fps;
  // the last sample's duration is often a placeholder: leave it out of the timing check
  const body = secs.slice(0, -1);
  const dropped = body.filter((d) => d > step * 1.5), doubled = body.filter((d) => d < step * 0.5);
  const missing = dropped.reduce((m, d) => m + Math.round(d / step) - 1, 0);
  const length = secs.reduce((x, d) => x + d, 0);
  return {
    ok: missing === 0 && doubled.length === 0,
    frames: secs.length, length: +length.toFixed(3), width: v.width, height: v.height, codec: v.codec,
    expectedFrames: Math.round(length * fps), droppedEvents: dropped.length, missingFrames: missing, doubledFrames: doubled.length,
    shortestMs: +(Math.min(...body) * 1000).toFixed(2), longestMs: +(Math.max(...body) * 1000).toFixed(2),
    audio: a ? { codec: a.codec, length: +(a.samples.reduce((x, d) => x + d, 0) / a.timescale).toFixed(3) } : null,
  };
}


/* ------------------------------ the MP4 writer ------------------------------ */

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, flags, ...parts) => box(type, Buffer.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);
const MATRIX = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32));
const cstr = (s) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(1)]);

/** The AAC samples of MediaRecorder's (fragmented) audio MP4: its stsd box, timescale, and each sample's place. */
function fmp4Audio(file) {
  const buf = fs.readFileSync(file);
  const out = { buf, samples: [], stsd: null, timescale: 48000, defDur: 1024, defSize: 0 };
  const boxes = (s, e, fn) => { let p = s; while (p + 8 <= e) { let size = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8); let hdr = 8; if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } if (size === 0) size = e - p; if (size < hdr) break; fn(type, p, p + hdr, p + size); p += size; } };
  let moof = 0, tf = null;
  const walk = (type, start, s, e) => {
    if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex'].includes(type)) return boxes(s, e, walk);
    if (type === 'moof') { moof = start; return boxes(s, e, walk); }
    if (type === 'traf') { tf = { base: moof, dur: out.defDur, size: out.defSize }; return boxes(s, e, walk); }
    if (type === 'mdhd') out.timescale = buf.readUInt32BE(s + (buf[s] === 1 ? 20 : 12));
    if (type === 'stsd') out.stsd = buf.subarray(start, e);
    if (type === 'trex') { out.defDur = buf.readUInt32BE(s + 12); out.defSize = buf.readUInt32BE(s + 16); }
    if (type === 'tfhd') {
      const fl = buf.readUInt32BE(s) & 0xffffff; let p = s + 8;
      if (fl & 1) { tf.base = Number(buf.readBigUInt64BE(p)); p += 8; }
      if (fl & 2) p += 4;
      if (fl & 8) { tf.dur = buf.readUInt32BE(p); p += 4; }
      if (fl & 0x10) { tf.size = buf.readUInt32BE(p); p += 4; }
    }
    if (type === 'trun') {
      const fl = buf.readUInt32BE(s) & 0xffffff, n = buf.readUInt32BE(s + 4); let p = s + 8, off = tf.base;
      if (fl & 1) { off += buf.readInt32BE(p); p += 4; }
      if (fl & 4) p += 4;
      for (let i = 0; i < n; i++) {
        let d = tf.dur, z = tf.size;
        if (fl & 0x100) { d = buf.readUInt32BE(p); p += 4; }
        if (fl & 0x200) { z = buf.readUInt32BE(p); p += 4; }
        if (fl & 0x400) p += 4;
        if (fl & 0x800) p += 4;
        out.samples.push({ offset: off, size: z, dur: d });
        off += z;
      }
    }
  };
  boxes(0, buf.length, walk);
  return out;
}

/**
 * Write recordings/<tag>.mp4 from the page's H.264 samples (<tag>.video.h264 + .video.json) and
 * its AAC (<tag>.audio.mp4): one MP4, constant 60 fps, its index (moov) before the data (+faststart).
 */
export function writeMp4(tag, { keep = false } = {}) {
  const meta = JSON.parse(fs.readFileSync(path.join(OUT, `${tag}.video.json`), 'utf8'));
  const payload = path.join(OUT, `${tag}.video.h264`);
  const audioFile = path.join(OUT, `${tag}.audio.mp4`);
  const audio = meta.audio && fs.existsSync(audioFile) ? fmp4Audio(audioFile) : null;
  const avcC = Buffer.from(meta.avcC, 'base64');
  const vs = meta.samples, VT = 60000, VD = 1000, frames = vs.length;
  const videoBytes = vs.reduce((a, s) => a + s[0], 0);
  const aDur = audio ? audio.samples.reduce((a, s) => a + s.dur, 0) : 0;
  const movieMs = Math.max(Math.round((frames / 60) * 1000), audio ? Math.round((aDur / audio.timescale) * 1000) : 0);
  const moovFor = (base) => {
    let off = base;
    const vOff = vs.map((s) => { const o = off; off += s[0]; return o; });
    const aOff = audio ? audio.samples.map((s) => { const o = off; off += s.size; return o; }) : [];
    const avc1 = box('avc1', Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(meta.width), u16(meta.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), Buffer.alloc(32), u16(0x18), u16(0xffff), box('avcC', avcC));
    const keys = vs.map((s, i) => (s[1] ? i + 1 : 0)).filter(Boolean);
    const vtrak = box('trak',
      full('tkhd', 0, 7, u32(0), u32(0), u32(1), u32(0), u32(Math.round((frames / 60) * 1000)), Buffer.alloc(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(meta.width * 65536), u32(meta.height * 65536)),
      box('mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(VT), u32(frames * VD), u16(0x55c4), u16(0)),
        full('hdlr', 0, 0, u32(0), Buffer.from('vide'), Buffer.alloc(12), cstr('VideoHandler')),
        box('minf', full('vmhd', 0, 1, Buffer.alloc(8)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
          box('stbl', full('stsd', 0, 0, u32(1), avc1), full('stts', 0, 0, u32(1), u32(frames), u32(VD)),
            full('stss', 0, 0, u32(keys.length), ...keys.map(u32)), full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
            full('stsz', 0, 0, u32(0), u32(frames), ...vs.map((s) => u32(s[0]))), full('co64', 0, 0, u32(frames), ...vOff.map(u64))))));
    let atrak = Buffer.alloc(0);
    if (audio) {
      const runs = [];
      for (const s of audio.samples) { const r = runs[runs.length - 1]; if (r && r[1] === s.dur) r[0]++; else runs.push([1, s.dur]); }
      atrak = box('trak',
        full('tkhd', 0, 7, u32(0), u32(0), u32(2), u32(0), u32(Math.round((aDur / audio.timescale) * 1000)), Buffer.alloc(8), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0)),
        box('mdia',
          full('mdhd', 0, 0, u32(0), u32(0), u32(audio.timescale), u32(aDur), u16(0x55c4), u16(0)),
          full('hdlr', 0, 0, u32(0), Buffer.from('soun'), Buffer.alloc(12), cstr('SoundHandler')),
          box('minf', full('smhd', 0, 0, u32(0)), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
            box('stbl', audio.stsd, full('stts', 0, 0, u32(runs.length), ...runs.flatMap(([c, d]) => [u32(c), u32(d)])),
              full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)), full('stsz', 0, 0, u32(0), u32(audio.samples.length), ...audio.samples.map((s) => u32(s.size))),
              full('co64', 0, 0, u32(audio.samples.length), ...aOff.map(u64))))));
    }
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieMs), u32(0x00010000), u16(0x0100), Buffer.alloc(10), MATRIX, Buffer.alloc(24), u32(audio ? 3 : 2));
    return box('moov', mvhd, vtrak, atrak);
  };
  const ftyp = box('ftyp', Buffer.from('isom'), u32(512), Buffer.from('isomiso2avc1mp41'));
  const base = ftyp.length + moovFor(0).length + 16;
  const moov = moovFor(base);
  const audioBytes = audio ? audio.samples.reduce((a, s) => a + s.size, 0) : 0;
  const mdatHdr = Buffer.concat([u32(1), Buffer.from('mdat'), u64(16 + videoBytes + audioBytes)]);
  const vbuf = fs.readFileSync(payload);
  if (vbuf.length !== videoBytes) throw new Error(`${tag}: the video payload is ${vbuf.length} bytes, its sample table says ${videoBytes}`);
  const outFile = path.join(OUT, `${tag}.mp4`);
  const fd = fs.openSync(outFile, 'w');
  fs.writeSync(fd, Buffer.concat([ftyp, moov, mdatHdr]));
  fs.writeSync(fd, vbuf);
  if (audio) for (const s of audio.samples) fs.writeSync(fd, audio.buf, s.offset, s.size);
  fs.closeSync(fd);
  if (!keep) for (const f of [payload, audioFile, path.join(OUT, `${tag}.video.json`)]) fs.rmSync(f, { force: true });
  return outFile;
}

/* ------------------------------ Phase 1, for before-after ------------------------------ */

/** Record 4.5 s of the Phase 1 build's P orbit (commit 4c528c4) into recordings/phase1-orbit.mp4. */
async function recordPhase1(browser, size) {
  const WT = path.resolve(ROOT, '..', 'sukhna-phase1');
  const PORT = 5191;
  const sh = (c) => execSync(c, { cwd: ROOT, stdio: 'pipe' }).toString();
  if (fs.existsSync(WT)) { try { sh(`cmd /c rmdir "${path.join(WT, 'node_modules')}"`); } catch { /* none */ } sh(`git worktree remove --force "${WT}"`); }
  sh(`git worktree add --detach "${WT}" 4c528c4`);
  sh(`cmd /c mklink /J "${path.join(WT, 'node_modules')}" "${path.join(ROOT, 'node_modules')}"`);
  const server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: WT, stdio: 'pipe' });
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
    // the old build has no pixel budget (it supersampled to ~4K at 1440p and crashed the page):
    // run it at 1080p and scale each frame up to the video's size as it is captured
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(2500);
    await page.keyboard.press('KeyP');
    await page.waitForTimeout(1200);
    // WebCodecs, every frame stamped n/60 s (as the director does): MediaRecorder dropped frames
    const res = await page.evaluate(async ({ W, H }) => {
      const src = document.getElementById('view');
      const comp = Object.assign(document.createElement('canvas'), { width: W, height: H });
      const g = comp.getContext('2d', { alpha: false });
      const config = { codec: W >= 2560 ? 'avc1.640033' : 'avc1.64002A', width: W, height: H, bitrate: W >= 2560 ? 40e6 : 24e6, framerate: 60, latencyMode: 'quality', avc: { format: 'avc' }, hardwareAcceleration: W > 1920 ? 'no-preference' : 'prefer-hardware' };
      const chunks = [], samples = [];
      let avcC = null;
      const enc = new VideoEncoder({
        output: (c, meta) => {
          if (meta?.decoderConfig?.description && !avcC) { const d = meta.decoderConfig.description; avcC = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer); }
          const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); samples.push([c.byteLength, c.type === 'key' ? 1 : 0, c.timestamp]);
        },
        error: (e) => { throw e; },
      });
      enc.configure(config);
      let n = 0, last = 0, acc = 0;
      // warm up first: the old build's first second has shader compiles and a long hitch
      await new Promise((r) => { let k = 0; const w = () => { g.drawImage(src, 0, 0, W, H); if (++k < 90) requestAnimationFrame(w); else r(); }; requestAnimationFrame(w); });
      await new Promise((done) => {
        const f = (now) => {
          acc += last ? (now - last) / 1000 : 1 / 60; last = now;
          if (acc >= 1 / 60 - 1e-4) {
            acc = Math.min(acc - 1 / 60, 1 / 60);
            g.drawImage(src, 0, 0, W, H);
            const vf = new VideoFrame(comp, { timestamp: Math.round((n * 1e6) / 60), duration: Math.round(1e6 / 60) });
            enc.encode(vf, { keyFrame: n % 120 === 0 }); vf.close(); n++;
          }
          if (n >= 5 * 60) { done(); return; }
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      });
      await enc.flush(); enc.close();
      const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      let s = ''; for (const x of avcC) s += String.fromCharCode(x);
      return { frames: n, payload: await toB64(new Blob(chunks)), meta: { width: W, height: H, fps: 60, codec: config.codec, avcC: btoa(s), samples, frames: n, audio: false }, canvas: [src.width, src.height] };
    }, { W: size[0], H: size[1] });
    // handed back as base64 (this page is another origin than the dev server that saves recordings)
    fs.writeFileSync(path.join(OUT, 'phase1-orbit.video.h264'), Buffer.from(res.payload, 'base64'));
    fs.writeFileSync(path.join(OUT, 'phase1-orbit.video.json'), JSON.stringify(res.meta));
    writeMp4('phase1-orbit', { keep: true }); // (before-after decodes the raw frames itself)
    res.saved = true; delete res.payload; delete res.meta;
    await page.close();
    return res;
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 800));
    try { sh(`cmd /c rmdir "${path.join(WT, 'node_modules')}"`); } catch { /* gone */ }
    sh(`git worktree remove --force "${WT}"`);
  }
}

/* ------------------------------ loudness and a delivery copy (ffmpeg) ------------------------------ */

// Every render ships at -14 LUFS integrated, true peak <= -1.5 dBTP (loudnorm, two passes, the
// picture copied untouched), and gets a smaller delivery copy (<tag>-delivery.mp4, H.264 at
// 10-12 Mbit/s) beside the master.  Both need ffmpeg (winget install Gyan.FFmpeg); without it the
// report says so and the master is left as recorded.
const FFMPEG = (() => {
  for (const exe of ['ffmpeg', path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe')]) {
    try { if (spawnSync(exe, ['-hide_banner', '-version'], { encoding: 'utf8' }).status === 0) return exe; } catch { /* not this one */ }
  }
  return null;
})();
const LOUD = { I: -14, TP: -1.5, LRA: 11 };
const ff = (args) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}\n${(r.stderr || '').slice(-1500)}`);
  return r.stderr;
};
/** loudnorm's measurement of a file's audio (integrated loudness, true peak, range, threshold). */
function measureLoudness(file) {
  const err = ff(['-i', file, '-vn', '-af', `loudnorm=I=${LOUD.I}:TP=${LOUD.TP}:LRA=${LOUD.LRA}:print_format=json`, '-f', 'null', '-']);
  const j = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  return { I: +j.input_i, TP: +j.input_tp, LRA: +j.input_lra, thresh: +j.input_thresh, offset: +j.target_offset };
}
/** Put `from` in place of `to`.  (Windows can refuse a rename over a file something still has open,
 * a virus scan or a preview: then copy over it, retrying for a few seconds.) */
function replaceFile(from, to) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(from, to); return; } catch (e) { if (e.code !== 'EPERM' && e.code !== 'EBUSY') throw e; }
    try { fs.copyFileSync(from, to); fs.rmSync(from, { force: true }); return; } catch (e) { if (i >= 20) throw e; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
}
/** Normalise the master's audio in place: measure, then apply with the measured values (linear when it can be). */
function normaliseLoudness(file) {
  const m = measureLoudness(file);
  const tmp = file.replace(/\.mp4$/, '.loudnorm.mp4');
  ff(['-y', '-i', file, '-map', '0', '-c:v', 'copy',
    '-af', `loudnorm=I=${LOUD.I}:TP=${LOUD.TP}:LRA=${LOUD.LRA}:measured_I=${m.I}:measured_TP=${m.TP}:measured_LRA=${m.LRA}:measured_thresh=${m.thresh}:offset=${m.offset}:linear=true:print_format=summary`,
    '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', tmp]);
  replaceFile(tmp, file);
  const after = measureLoudness(file);
  return { before: { I: m.I, TP: m.TP }, after: { I: after.I, TP: after.TP, LRA: after.LRA } };
}
/** The delivery copy: the same picture re-encoded at 10-12 Mbit/s (H.264 High, yuv420p), the normalised audio copied. */
function deliveryCopy(file) {
  const out = file.replace(/\.mp4$/, '-delivery.mp4');
  ff(['-y', '-i', file, '-map', '0', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-b:v', '12M', '-maxrate', '13M', '-bufsize', '24M', '-g', '120', '-c:a', 'copy', '-movflags', '+faststart', out]);
  return out;
}

/* ------------------------------ one shot list ------------------------------ */

async function run(browser, name, size) {
  const list = JSON.parse(fs.readFileSync(path.join(HERE, `${name}.json`), 'utf8'));
  const tall = size[1] > size[0];
  // (a tall window for a tall video, so preview stills show the whole frame)
  const page = await browser.newPage({ viewport: tall ? { width: 720, height: 1280 } : { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('crash', () => errors.push('the page crashed'));
  page.on('console', (m) => { if (m.type() === 'error' && !m.location()?.url?.endsWith('/favicon.ico')) errors.push(m.text()); }); // (the page has no favicon)
  const q = new URLSearchParams({ director: name, q: 'high', nolock: '', seed: String(list.seed ?? 2027) });
  if (!preview) q.set('record', '1');
  if (size[0] === 1920) q.set('size', '1080');
  if (tall) q.set('portrait', '1');
  if (flags.has('--noaudio')) q.set('noaudio', '1');
  if (opt('--capture')) q.set('capture', opt('--capture'));
  await page.goto(`${BASE}/?${q}`);
  // (plain polling: Playwright's waitForFunction polls on every animation frame, which starved the page)
  const until = async (fn, arg, ms) => { const end = Date.now() + ms; for (;;) { if (await page.evaluate(fn, arg)) return; if (Date.now() > end) { const st = await page.evaluate(() => { const d = window.__director; return d && { state: d.state, t: d.t, errors: d.errors }; }); throw new Error(`${name}: timed out waiting (${JSON.stringify(st)}; page errors: ${errors.join(' | ')})`); } await page.waitForTimeout(100); } };
  await until(() => window.__director && ['playing', 'recording', 'error'].includes(window.__director.state), null, 120_000);
  const stills = [];
  if (preview) {
    for (const at of preview.split(',').map(Number)) {
      await until((a) => window.__director.t >= a || window.__director.state === 'done', at, 300_000);
      const f = path.join(OUT, 'preview', `${name}${tall && !list.portrait ? '-portrait' : ''}-${String(at).replace('.', '_')}s.jpg`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      await page.screenshot({ path: f, type: 'jpeg', quality: 85 });
      stills.push(path.relative(ROOT, f));
    }
  }
  const limit = Date.now() + (list.duration * 4 + 120) * 1000;
  for (;;) {
    const s = await page.evaluate(() => ({ state: window.__director.state, t: window.__director.t, renders: window.__director.renders, vis: document.visibilityState, focus: document.hasFocus(), now: Math.round(performance.now()) }));
    if (process.env.DIRECTOR_DEBUG) console.error(JSON.stringify(s));
    if (['done', 'error'].includes(s.state)) break;
    if (Date.now() > limit) throw new Error(`${name}: stuck at ${JSON.stringify(s)}`);
    await page.waitForTimeout(500);
  }
  if (process.env.DIRECTOR_DEBUG) fs.writeFileSync(path.join(OUT, `${name}-frames.json`), JSON.stringify(await page.evaluate(() => window.__director.frames)));
  const st = await page.evaluate(() => { const d = window.__director; const gaps = d.frames.slice(1).map((x, i) => x - d.frames[i]); return { ...d, frames: undefined, renderIntervalMs: { min: Math.min(...gaps), max: Math.max(...gaps), mean: gaps.reduce((a, b) => a + b, 0) / gaps.length } }; });
  await page.close();
  const report = { name, size, stills, page: st, errors: [...errors, ...(st.errors || [])] };
  if (!preview && st.mode === 'webcodecs') writeMp4(st.file.replace(/\.mp4$/, ''));
  if (!preview && st.file) {
    const master = path.join(OUT, st.file);
    if (FFMPEG && frameCheck(master).audio) {
      try { report.loudness = normaliseLoudness(master); } catch (e) { report.errors.push(`loudnorm: ${e.message}`); }
    } else report.loudness = FFMPEG ? 'no audio' : 'skipped: ffmpeg not found';
    report.check = frameCheck(master);
    // frames the page skipped (a hitch that advanced the game two steps in one frame) are not
    // gaps in the file's timing, but they are missing from the video: count them against the list
    report.check.listFrames = Math.round(list.duration * 60);
    report.check.skippedFrames = Math.max(0, report.check.listFrames - report.check.frames);
    // and the sound must run as long as the picture (a throttled page records real-time audio
    // for much longer than the game-time video)
    report.check.avSkew = report.check.audio ? +(report.check.audio.length - report.check.length).toFixed(3) : null;
    report.check.ok = report.check.ok && report.check.skippedFrames <= 2 && (report.check.avSkew === null || Math.abs(report.check.avSkew) < 0.3);
    if (FFMPEG) {
      try {
        const del = deliveryCopy(master);
        const dc = frameCheck(del);
        report.delivery = { file: path.basename(del), mbps: +((fs.statSync(del).size * 8) / dc.length / 1e6).toFixed(1), check: dc };
      } catch (e) { report.errors.push(`delivery copy: ${e.message}`); }
    }
  }
  if (!preview) fs.writeFileSync(path.join(OUT, `${st.tag || name}.json`), JSON.stringify(report, null, 2));
  return report;
}

/* ------------------------------ main ------------------------------ */

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ARGS });
if (flags.has('--phase1')) {
  // only (re)record the Phase 1 clip that before-after plays first
  const r = await recordPhase1(browser, opt('--size') === '1080' ? [1920, 1080] : [2560, 1440]);
  console.log(`phase1-orbit: ${r.frames} frames from a ${r.canvas.join('x')} canvas, saved ${r.saved}`, frameCheck(path.join(OUT, 'phase1-orbit.mp4')));
  await browser.close();
  process.exit(0);
}
const rows = [];
try {
  for (const name of names) {
    const portrait = flags.has('--portrait') || !!JSON.parse(fs.readFileSync(path.join(HERE, `${name}.json`), 'utf8')).portrait;
    let size = portrait ? [1080, 1920] : opt('--size') === '1080' ? [1920, 1080] : [2560, 1440];
    if (name === 'before-after' && (flags.has('--fresh') || !fs.existsSync(path.join(OUT, 'phase1-orbit.video.h264')))) {
      const r = await recordPhase1(browser, size);
      console.log(`phase1-orbit: ${r.frames} frames from a ${r.canvas.join('x')} canvas, saved ${r.saved}`);
    }
    let rep = await run(browser, name, size);
    if (!preview && size[0] === 2560 && rep.check && !rep.check.ok) {
      console.log(`${name}: dropped frames at 2560x1440 (${rep.check.missingFrames} missing, ${rep.check.doubledFrames} doubled) -- again at 1920x1080`);
      size = [1920, 1080];
      const again = await run(browser, name, size);
      again.fellBackFrom = { size: [2560, 1440], check: rep.check };
      rep = again;
    }
    rows.push(rep);
    const c = rep.check;
    console.log(preview ? `${name}: stills ${rep.stills.join(', ')}${rep.errors.length ? `  ERRORS ${rep.errors.join(' | ')}` : ''}`
      : `${name}: ${rep.page.file}  ${c.length}s  ${c.width}x${c.height}  ${c.frames} frames  missing ${c.missingFrames}  doubled ${c.doubledFrames}  late ticks ${rep.page.lateTicks}  audio ${c.audio ? c.audio.length + 's' : 'none'}${rep.errors.length ? `  ERRORS ${rep.errors.join(' | ')}` : ''}`);
  }
} finally {
  await browser.close();
}
if (!preview) {
  console.log('\n| Video | File | Length | Resolution | Frames | Frame check | Loudness | Delivery copy |\n|---|---|---|---|---|---|---|---|');
  for (const r of rows) { const c = r.check; console.log(`| ${r.name} | recordings/${r.page.file} | ${c.length} s | ${c.width}x${c.height} | ${c.frames} of ${c.listFrames} | ${c.missingFrames || c.doubledFrames ? `${c.missingFrames} dropped, ${c.doubledFrames} doubled` : 'no dropped or doubled frames'}${c.skippedFrames ? `, ${c.skippedFrames} skipped by the page` : ''}${c.avSkew !== null && Math.abs(c.avSkew) >= 0.3 ? `, AUDIO ${c.avSkew} s OFF` : ''}${r.fellBackFrom ? ' (fell back to 1080p)' : ''} | ${r.loudness?.after ? `${r.loudness.after.I} LUFS, ${r.loudness.after.TP} dBTP (was ${r.loudness.before.I})` : r.loudness || ''} | ${r.delivery ? `recordings/${r.delivery.file}, ${r.delivery.mbps} Mbit/s, ${r.delivery.check.frames} frames${r.delivery.check.missingFrames || r.delivery.check.doubledFrames ? ' (TIMING OFF)' : ''}` : ''} |`); }
}
