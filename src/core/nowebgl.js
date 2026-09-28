/** No WebGL: say so on the (static) start card, with a hint, instead of leaving it on "Loading". */
export function showNoWebGL() {
  const go = document.querySelector('.overlay .go');
  if (!go) return;
  go.disabled = true;
  go.textContent = "This browser can't show 3D (WebGL is off or unsupported)";
  if (!document.querySelector('.overlay .nogl')) {
    const hint = document.createElement('p');
    hint.className = 'nogl';
    hint.textContent = 'Try turning on hardware acceleration in your browser settings.';
    go.after(hint);
  }
}
