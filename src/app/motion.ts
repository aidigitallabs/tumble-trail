/**
 * `prefers-reduced-motion` as a live flag (PLAN sections 7 and 16): the follow camera doubles its
 * smoothing, the confetti burst and the landing squash are off. Reads the media query once and
 * follows later changes; a missing `matchMedia` means "no preference".
 */
export interface MotionQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (e: { matches: boolean }) => void): void;
}

export class ReducedMotion {
  private on: boolean;
  private readonly listeners = new Set<(on: boolean) => void>();

  constructor(query: MotionQuery | null | undefined) {
    this.on = query?.matches ?? false;
    query?.addEventListener('change', (e) => {
      this.on = e.matches;
      for (const fn of this.listeners) fn(this.on);
    });
  }

  get value(): boolean {
    return this.on;
  }

  /** Called when the preference changes (not immediately). */
  subscribe(fn: (on: boolean) => void): void {
    this.listeners.add(fn);
  }
}

export function reducedMotionFromWindow(win: Window = window): ReducedMotion {
  const query =
    typeof win.matchMedia === 'function'
      ? win.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  return new ReducedMotion(query);
}
