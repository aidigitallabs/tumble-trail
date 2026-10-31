/**
 * iOS Safari guards (PLAN section 11): stop pinch-zoom, double-tap zoom, the text loupe and
 * rubber-banding on the canvas. Listeners must be non-passive to be able to preventDefault.
 */
export function installTouchGuards(canvas: HTMLElement): void {
  const guard = (e: Event) => {
    if (e.target === canvas) e.preventDefault();
  };
  const opts: AddEventListenerOptions = { passive: false };
  document.addEventListener('touchstart', guard, opts);
  document.addEventListener('touchmove', guard, opts);
  document.addEventListener('touchend', guard, opts);
  document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}
