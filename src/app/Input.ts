import { tuning } from '../config/tuning';
import type { ControlInput } from '../game/Ball';

export type DriveMode = 'always' | 'hold';

/** Steer range in pixels for a viewport (PLAN section 6). */
export function steerRangePx(width: number, height: number): number {
  return tuning.input.steerRangeFraction * Math.min(width, height);
}

/** Virtual origin: the touch-down x, clamped so a full steer is reachable on both sides. */
export function steerOriginX(downX: number, width: number, rangePx: number): number {
  return Math.min(Math.max(downX, rangePx), width - rangePx);
}

/**
 * Absolute steer from the virtual origin. Continuous through the dead zone: 0 up to `deadZonePx`,
 * then a linear ramp that reaches +/-1 at `rangePx`:
 * sign(dx) * clamp((|dx| - deadZone) / (range - deadZone), 0, 1).
 */
export function steerFromOffset(x: number, originX: number, rangePx: number): number {
  const dx = x - originX;
  const dead = tuning.input.deadZonePx;
  const span = Math.max(1e-6, rangePx - dead);
  const magnitude = Math.max(0, Math.min(1, (Math.abs(dx) - dead) / span));
  return magnitude === 0 ? 0 : Math.sign(dx) * magnitude;
}

/** True when a pointer starts too close to any screen edge (thumbs, palms, system gestures). */
export function startsAtEdge(x: number, y: number, width: number, height: number): boolean {
  const e = tuning.input.edgeRejectPx;
  return x < e || y < e || x > width - e || y > height - e;
}

/**
 * Pointer / keyboard state -> `{ driving, steer }` (PLAN section 6). The core is DOM-free so it
 * can be unit tested: feed it `pointerDown / pointerMove / pointerUp / release`, call
 * `update(dt)` once per rendered frame with the real frame time, and read `controls`. The physics
 * step only reads `controls`; time-based behaviour (still-finger decay, lockout, keyboard ramp)
 * advances in `update`, never inside the step.
 */
export class Input {
  private driveMode: DriveMode = 'always';
  private steerDecay: number = 0;

  private activeId: number | null = null;
  private originX = 0;
  private pointerX = 0;
  private anchorX = 0;
  private anchorY = 0;
  private stillSeconds = 0;
  private width = 1024;
  private height = 768;
  /** Remaining lockout, seconds (ignores new pointers; steer forced to 0). */
  private lockoutLeft = 0;

  private keyLeft = false;
  private keyRight = false;
  private keyDrive = false;
  private keySteer = 0;

  private readonly out: ControlInput = { driving: true, steer: 0 };

  /** Apply the tier's drive mode and steer decay (called on every level load). */
  configure(driveMode: DriveMode, steerDecaySeconds: number): void {
    this.driveMode = driveMode;
    this.steerDecay = steerDecaySeconds;
    this.release();
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** True while a pointer is held and counted. */
  get pointerActive(): boolean {
    return this.activeId !== null;
  }

  get locked(): boolean {
    return this.lockoutLeft > 0;
  }

  /** After any state change: release everything and ignore input for `lockoutMs`. */
  lock(): void {
    this.release();
    this.lockoutLeft = tuning.input.lockoutMs / 1000;
  }

  /**
   * Let go of the pointer (pointercancel, blur, hidden, resize, state change). Key state is kept:
   * a key that is still physically held stays held, and only the lockout gates it. Use
   * `clearKeys()` when key-up events may have been missed (blur, hidden).
   */
  release(): void {
    this.activeId = null;
    this.stillSeconds = 0;
  }

  /** Forget held keys (the window lost focus, so key-up events may never arrive). */
  clearKeys(): void {
    this.keyLeft = this.keyRight = this.keyDrive = false;
    this.keySteer = 0;
  }

  /** Returns true if this pointer is accepted as THE pointer. */
  pointerDown(id: number, x: number, y: number): boolean {
    if (this.lockoutLeft > 0) return false;
    if (this.activeId !== null) return false; // only the first pointer counts
    if (startsAtEdge(x, y, this.width, this.height)) return false;
    this.activeId = id;
    this.originX = steerOriginX(x, this.width, steerRangePx(this.width, this.height));
    this.pointerX = x;
    this.anchorX = x;
    this.anchorY = y;
    this.stillSeconds = 0;
    return true;
  }

  pointerMove(id: number, x: number, y: number): void {
    if (id !== this.activeId) return;
    this.pointerX = x;
    if (Math.hypot(x - this.anchorX, y - this.anchorY) >= tuning.input.stillMovePx) {
      this.anchorX = x;
      this.anchorY = y;
      this.stillSeconds = 0;
    }
  }

  /** Returns true if this was the active pointer (it is now released). */
  pointerUp(id: number): boolean {
    if (id !== this.activeId) return false;
    this.activeId = null;
    this.stillSeconds = 0;
    return true;
  }

  keyChange(code: string, down: boolean): void {
    switch (code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.keyLeft = down;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.keyRight = down;
        break;
      case 'ArrowUp':
      case 'KeyW':
      case 'Space':
        this.keyDrive = down;
        break;
      default:
    }
  }

  /** Advance time-based behaviour by a rendered frame's real duration (seconds). */
  update(dt: number): void {
    // Only the part of this frame after the lockout ended counts toward the keyboard ramp.
    const lockedFor = this.lockoutLeft;
    if (lockedFor > 0) this.lockoutLeft = Math.max(0, lockedFor - dt);
    const rampDt = lockedFor > 0 ? Math.max(0, dt - lockedFor) : dt;

    // Keyboard steer ramps toward -1 / 0 / +1 (toward 0 while locked, so it eases in afterwards).
    const target = this.lockoutLeft > 0 ? 0 : (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0);
    const maxDelta = tuning.input.keyboardSteerPerSecond * (this.lockoutLeft > 0 ? dt : rampDt);
    this.keySteer += Math.max(-maxDelta, Math.min(maxDelta, target - this.keySteer));

    if (this.activeId !== null) this.stillSeconds += dt;
  }

  /** Current controls, read by the physics step. */
  get controls(): ControlInput {
    const c = this.out;
    const locked = this.lockoutLeft > 0;
    let steer = 0;
    let pointerDriving = false;
    if (!locked && this.activeId !== null) {
      pointerDriving = true;
      steer = steerFromOffset(this.pointerX, this.originX, steerRangePx(this.width, this.height));
      // A leaned-on, motionless finger re-centres instead of grinding (Tiny).
      if (this.steerDecay > 0 && this.stillSeconds > tuning.input.stillSeconds) {
        const faded = (this.stillSeconds - tuning.input.stillSeconds) / this.steerDecay;
        steer *= Math.max(0, 1 - faded);
      }
    } else if (!locked) {
      steer = this.keySteer;
    }
    const keyboardDriving = !locked && this.keyDrive;
    c.driving = this.driveMode === 'always' ? true : pointerDriving || keyboardDriving;
    c.steer = steer;
    return c;
  }

  /**
   * Wire DOM events. Pointer events on the canvas only (HUD / overlay elements never feed Input),
   * with pointer capture; blur, hidden and resize release everything. Returns a detach function.
   */
  attach(canvas: HTMLCanvasElement, win: Window = window): () => void {
    const onDown = (e: PointerEvent): void => {
      if (this.pointerDown(e.pointerId, e.clientX, e.clientY)) {
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // Capture can fail for synthetic pointers; the move / up listeners still work.
        }
      }
    };
    const onMove = (e: PointerEvent): void => this.pointerMove(e.pointerId, e.clientX, e.clientY);
    const onUp = (e: PointerEvent): void => {
      if (this.pointerUp(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // Already released.
        }
      }
    };
    const onBlur = (): void => {
      this.release();
      this.clearKeys();
    };
    const onKeyDown = (e: KeyboardEvent): void => this.keyChange(e.code, true);
    const onKeyUp = (e: KeyboardEvent): void => this.keyChange(e.code, false);
    const onResize = (): void => {
      this.setViewport(win.innerWidth, win.innerHeight);
      this.release();
    };
    const onVisibility = (): void => {
      if (win.document.visibilityState !== 'visible') onBlur();
    };

    this.setViewport(win.innerWidth, win.innerHeight);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('lostpointercapture', onUp);
    win.addEventListener('blur', onBlur);
    win.addEventListener('resize', onResize);
    win.addEventListener('keydown', onKeyDown);
    win.addEventListener('keyup', onKeyUp);
    win.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      win.removeEventListener('blur', onBlur);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.document.removeEventListener('visibilitychange', onVisibility);
    };
  }
}
