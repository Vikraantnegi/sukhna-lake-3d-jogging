/* ------------------------------------------------------------------ *
 * Entry point: check for WebGL 2 before the game is loaded at all.
 *
 * Without it the start card says so (with a hint) and nothing else is
 * fetched -- no three.js, no world data, and no error to throw.  With it,
 * the game (main.js) is imported; if its renderer still can't start (the
 * probe passed, the real context didn't), main.js shows the same card and
 * stops with an error marked `noWebGL`, which is caught here, so the page
 * never ends on an uncaught error.
 * ------------------------------------------------------------------ */
import { track, deviceType } from './core/analytics.js';
import { isTouch } from './core/touch.js';
import { showNoWebGL } from './core/nowebgl.js';

function hasWebGL2() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // (give the probe's context straight back)
    return !!gl;
  } catch {
    return false;
  }
}

if (hasWebGL2()) {
  import('./main.js').catch((err) => { if (!err?.noWebGL) throw err; });
} else {
  track('webgl_unavailable', { device_type: deviceType(isTouch()) });
  showNoWebGL();
}
