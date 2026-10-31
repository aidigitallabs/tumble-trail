import { tuning } from '../config/tuning';

/**
 * Fixed-timestep driver (PLAN sections 4 and 0): an accumulator that runs `step` at
 * `tuning.physicsHz`, at most `tuning.maxSubSteps` per rendered frame, and returns the render
 * interpolation factor. It never reads a clock; the caller supplies each frame's real duration,
 * and `step` itself must not read one either.
 */
export class GameLoop {
  private accumulator = 0;
  private readonly stepSeconds = 1 / tuning.physicsHz;

  constructor(private readonly step: () => void) {}

  /**
   * Advance by `dtSeconds` of real time. Returns the interpolation alpha in [0, 1): how far
   * between the last two physics states the renderer should draw.
   */
  advance(dtSeconds: number): { steps: number; alpha: number } {
    this.accumulator += Math.max(0, dtSeconds);
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < tuning.maxSubSteps) {
      this.step();
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    // Spiral-of-death guard: if we hit the cap, drop the backlog instead of chasing it.
    if (steps === tuning.maxSubSteps && this.accumulator >= this.stepSeconds) this.accumulator = 0;
    return { steps, alpha: Math.min(1, this.accumulator / this.stepSeconds) };
  }

  /** Forget accumulated time (after a fast-forward, a pause or a hidden tab). */
  reset(): void {
    this.accumulator = 0;
  }
}
