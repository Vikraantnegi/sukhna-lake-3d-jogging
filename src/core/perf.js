/* ------------------------------------------------------------------ *
 * Draw calls and frame time.
 *
 * The scene is draw-call bound (plan §1), so the number that matters is
 * `renderer.info.render.calls` summed over the whole frame: the scene pass,
 * the shadow pass and the three post quads.  `info.autoReset` is switched
 * off because every post quad is its own `renderer.render`, which would
 * otherwise leave only the last quad's single call in the counter.
 *
 * `?stats=1` shows a small readout.  `bench(n)` gives a GPU-inclusive frame
 * time: it renders n frames back to back and then reads one pixel, which
 * cannot return until the GPU has finished all of them.
 * ------------------------------------------------------------------ */

export function createPerf(renderer, { show = false } = {}) {
  renderer.info.autoReset = false;
  const gl = renderer.getContext();

  let gpu = 'unknown';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch { /* some browsers hide it; the figures still stand */ }

  let el = null;
  if (show) {
    el = document.createElement('div');
    el.className = 'stats';
    document.body.appendChild(el);
  }

  const last = { calls: 0, triangles: 0, ms: 16.7 };
  let emaMs = 16.7;
  let acc = 0;

  return {
    gpu,
    last,
    /** Call before the frame's first render. */
    begin() {
      renderer.info.reset();
    },
    /** Call after the frame's last render, with the frame's wall-clock dt. */
    end(dt) {
      last.calls = renderer.info.render.calls;
      last.triangles = renderer.info.render.triangles;
      if (dt > 0) emaMs += (dt * 1000 - emaMs) * 0.05;
      last.ms = emaMs;
      acc += dt;
      if (el && acc > 0.25) {
        acc = 0;
        el.textContent =
          `${(1000 / emaMs).toFixed(0)} fps  ${emaMs.toFixed(1)} ms\n` +
          `${last.calls} calls  ${(last.triangles / 1000).toFixed(1)}k tris`;
      }
    },
    /**
     * Render `n` frames with `renderFn`, then block on a 1-pixel read so the
     * figure includes GPU time.  Returns ms per frame and the frame's counts.
     */
    bench(renderFn, n = 120) {
      const px = new Uint8Array(4);
      for (let i = 0; i < 10; i++) renderFn(); // warm-up: shader compiles, uploads
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        renderer.info.reset();
        renderFn();
      }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const ms = (performance.now() - t0) / n;
      return {
        msPerFrame: +ms.toFixed(2),
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        size: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
        gpu,
      };
    },
  };
}
