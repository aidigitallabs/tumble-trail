import { tuning } from '../config/tuning';

export type GateCorner = 'tl' | 'br';

/**
 * The parent gate (PLAN section 8): hold the top-left AND bottom-right corners at the same time
 * for `gateHoldSeconds`. Each pointer must stay within `gateCornerRadiusPx` of its corner. The
 * core is DOM-free: feed it pointer events and `update(dt)`; `update` returns true on the frame
 * the hold completes. Pointers that start in a corner zone belong to the gate and must never be
 * passed on to `Input` (the caller stops their propagation).
 */
export class ParentGate {
  private width = 1024;
  private height = 768;
  private readonly pointers = new Map<number, GateCorner>();
  private held = 0;

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.reset();
  }

  /** Which corner zone a point is in, if any. */
  cornerAt(x: number, y: number): GateCorner | null {
    const r = tuning.ui.gateCornerRadiusPx;
    if (Math.hypot(x, y) <= r) return 'tl';
    if (Math.hypot(this.width - x, this.height - y) <= r) return 'br';
    return null;
  }

  /** Returns true when the pointer starts in a corner zone (the gate owns it from now on). */
  pointerDown(id: number, x: number, y: number): boolean {
    const corner = this.cornerAt(x, y);
    if (!corner) return false;
    this.pointers.set(id, corner);
    return true;
  }

  /** A pointer that wanders out of its corner breaks the hold. */
  pointerMove(id: number, x: number, y: number): void {
    const corner = this.pointers.get(id);
    if (!corner) return;
    if (this.cornerAt(x, y) !== corner) {
      this.pointers.delete(id);
      this.held = 0;
    }
  }

  pointerUp(id: number): void {
    if (this.pointers.delete(id)) this.held = 0;
  }

  /** Forget everything (resize, hidden). */
  reset(): void {
    this.pointers.clear();
    this.held = 0;
  }

  get bothHeld(): boolean {
    const corners = new Set(this.pointers.values());
    return corners.has('tl') && corners.has('br');
  }

  /** Corners currently held (for drawing the rings). */
  get heldCorners(): GateCorner[] {
    return [...new Set(this.pointers.values())];
  }

  /** 0..1 fill of the hold ring. */
  get progress(): number {
    return Math.min(1, this.held / tuning.ui.gateHoldSeconds);
  }

  /** Advance by `dt` seconds of real time. True once, when the hold completes (then it resets). */
  update(dt: number): boolean {
    if (!this.bothHeld) {
      this.held = 0;
      return false;
    }
    this.held += dt;
    if (this.held >= tuning.ui.gateHoldSeconds) {
      this.reset();
      return true;
    }
    return false;
  }
}
