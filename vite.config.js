/* Based on sakura-crossing's vite.config.js (frame grabber and build
 * settings). Copyright (c) 2026 Kenton Wang, MIT License -- see
 * THIRD_PARTY_LICENSES.md. */
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only helper: lets the page POST a rendered frame to disk so the scene
 * can be reviewed while iterating (`window.__shot` in main.js).  Not part of
 * the build.
 */
function frameGrabber(outDir) {
  return {
    name: 'frame-grabber',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(outDir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const name = (body.name || 'shot').replace(/[^\w.-]/g, '_');
            const data = String(body.data || '').replace(/^data:image\/\w+;base64,/, '');
            const file = path.join(outDir, name.endsWith('.jpg') ? name : name + '.jpg');
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file, bytes: data.length }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

/**
 * Optional user music (Phase 7): tracks the user drops into public/audio/
 * play while sitting.  The folder is git-ignored; the dev server lists it at
 * /audio/list.json, and the build deletes dist/audio so no track is ever
 * shipped.
 */
function localTracks(dir) {
  const AUDIO = /.(mp3|ogg|m4a|wav|flac|opus)$/i;
  return {
    name: 'local-tracks',
    configureServer(server) {
      server.middlewares.use('/audio/list.json', (req, res) => {
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort(); } catch { /* no folder */ }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(files));
      });
    },
    closeBundle() {
      fs.rmSync(path.resolve(process.cwd(), 'dist', 'audio'), { recursive: true, force: true });
    },
  };
}

/**
 * Dev-only: the director's recordings (tests/director).  The page streams its
 * MediaRecorder output here in parts -- POST /__recording?name=x&part=n, part 0
 * starting the file -- so a two-minute 1440p video never sits in memory.  Files go
 * to recordings/ (git-ignored).  CORS is open so a second dev server (the
 * before-after video's Phase 1 build, on another port) can save its clip too.
 */
function recordings(outDir) {
  return {
    name: 'recordings',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(outDir, { recursive: true });
      server.middlewares.use('/__recording', (req, res) => {
        res.setHeader('access-control-allow-origin', '*');
        if (req.method === 'OPTIONS') { res.setHeader('access-control-allow-methods', 'POST'); return res.end(); }
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only'); }
        const q = new URL(req.url, 'http://x').searchParams;
        const name = (q.get('name') || 'recording').replace(/[^\w.-]/g, '_');
        const file = path.join(outDir, name);
        const out = fs.createWriteStream(file, { flags: q.get('part') === '0' ? 'w' : 'a' });
        req.pipe(out);
        out.on('finish', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, file, bytes: fs.statSync(file).size })); });
        out.on('error', (e) => { res.statusCode = 500; res.end(String(e)); });
      });
    },
  };
}

const SHOT_DIR = path.resolve(process.cwd(), '.shots');

export default defineConfig({
  /* Relative asset URLs, so a build runs from any subdirectory. */
  base: './',
  plugins: [frameGrabber(SHOT_DIR), localTracks(path.resolve(process.cwd(), 'public', 'audio')), recordings(path.resolve(process.cwd(), 'recordings'))],
  server: {
    port: 5178,
    strictPort: true,
    host: '127.0.0.1',
    open: false,
  },
  preview: {
    port: 5179,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
    // three.js is one big chunk on purpose, so the size warning is just noise
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // three and the generated Sukhna data change far less often than the
        // app code, so each gets its own cacheable chunk
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('/src/data/')) return 'data';
          return undefined;
        },
      },
    },
  },
});
