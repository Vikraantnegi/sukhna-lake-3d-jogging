/* ------------------------------------------------------------------ *
 * ?perf: a performance overlay for checking the game on real phones.
 *
 * Off unless the URL has ?perf (it never shows otherwise).  Shows the
 * frame rate, frame time p50 / p95 over the last 5 s (the real frame
 * time, not the capped step the game simulates with), the quality tier
 * (and why, and any fallback), draw calls and triangles for the last
 * frame (renderer.info, summed over the whole frame: core/perf.js), the
 * JS heap where the browser reports it (Chrome), and the GPU.
 *
 * It also keeps `window.__perf` for tests/perf/run.mjs: when the first
 * frame came, how long the first frame after Start took, the fallbacks,
 * and a recorder (`record.start()` / `record.stop()`) for a measured run.
 * ------------------------------------------------------------------ */

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] : 0);
const heapNow = () => performance.memory?.usedJSHeapSize ?? null;

export function createPerfHud({ perf, tier, why }) {
  const el = document.createElement('div');
  el.className = 'perfhud';
  document.body.appendChild(el);

  const win = []; // [time, ms] over the last 5 s
  let fpsFrames = 0, fpsAt = performance.now(), fps = 0, shownAt = 0;
  const state = { firstFrameMs: null, startPressedMs: null, startToFrameMs: null, fallbacks: [], gpu: perf.gpu };
  const rec = { on: false, t0: 0, frames: [], calls: [], tris: [], heapPeak: 0 };

  function summary() {
    const ms = [...rec.frames].sort((a, b) => a - b), secs = (performance.now() - rec.t0) / 1000;
    const calls = [...rec.calls].sort((a, b) => a - b), tris = [...rec.tris].sort((a, b) => a - b);
    return {
      seconds: +secs.toFixed(1), frames: rec.frames.length, fps: +(rec.frames.length / secs).toFixed(1),
      p50: +pct(ms, 0.5).toFixed(1), p95: +pct(ms, 0.95).toFixed(1), p99: +pct(ms, 0.99).toFixed(1), worst: +(ms.at(-1) ?? 0).toFixed(1),
      callsP50: pct(calls, 0.5), callsMax: calls.at(-1) ?? 0, trisP50: pct(tris, 0.5), trisMax: tris.at(-1) ?? 0,
      heapPeakMB: rec.heapPeak ? +(rec.heapPeak / 1048576).toFixed(1) : null,
      tier: tier(), fallbacks: state.fallbacks.filter((f) => f.at >= rec.t0).map((f) => ({ ...f, atSec: +((f.at - rec.t0) / 1000).toFixed(1) })),
    };
  }

  const api = {
    /** Each frame, after the render: the real frame time in seconds. */
    frame(raw) {
      const now = performance.now();
      if (state.firstFrameMs === null) state.firstFrameMs = Math.round(now);
      if (state.startPressedMs !== null && state.startToFrameMs === null && now > state.startPressedMs) state.startToFrameMs = Math.round(now - state.startPressedMs);
      const ms = raw * 1000;
      win.push([now, ms]);
      while (win.length && now - win[0][0] > 5000) win.shift();
      fpsFrames++;
      if (now - fpsAt >= 1000) { fps = (fpsFrames * 1000) / (now - fpsAt); fpsFrames = 0; fpsAt = now; }
      if (rec.on) {
        rec.frames.push(ms); rec.calls.push(perf.last.calls); rec.tris.push(perf.last.triangles);
        const h = heapNow(); if (h && h > rec.heapPeak) rec.heapPeak = h;
      }
      if (now - shownAt < 250) return;
      shownAt = now;
      const sorted = win.map((w) => w[1]).sort((a, b) => a - b), h = heapNow();
      const fell = state.fallbacks.length ? `  fell back ×${state.fallbacks.length}` : '';
      el.textContent =
        `${fps.toFixed(0)} fps  p50 ${pct(sorted, 0.5).toFixed(1)} ms  p95 ${pct(sorted, 0.95).toFixed(1)} ms\n` +
        `tier ${tier()} (${why})${fell}\n` +
        `${perf.last.calls} calls  ${(perf.last.triangles / 1000).toFixed(0)}k tris  heap ${h ? `${(h / 1048576).toFixed(0)} MB` : 'n/a'}\n` +
        `${String(perf.gpu).replace(/^ANGLE \(|\)$/g, '').slice(0, 60)}`;
    },
    /** Start was pressed (the next frame's delay is "Start to first frame"). */
    started() { if (state.startPressedMs === null) state.startPressedMs = performance.now(); },
    /** The run-time fallback dropped a tier. */
    fallback(from, to) { state.fallbacks.push({ from, to, at: performance.now() }); },
  };
  window.__perf = {
    state,
    record: {
      start() { Object.assign(rec, { on: true, t0: performance.now(), frames: [], calls: [], tris: [], heapPeak: heapNow() ?? 0 }); },
      stop() { rec.on = false; return summary(); },
    },
  };
  return api;
}
