import { tuning } from '../config/tuning';
import type { Frame } from './Spline';

export interface PointLike {
  x: number;
  y: number;
  z: number;
}

export interface ProgressEvents {
  /** Indices (into `checkpointsM`) of checkpoints passed by this update. */
  checkpoints: number[];
  /** True only on the update that first reaches the finish. */
  finished: boolean;
}

/**
 * Windowed nearest-frame tracker (PLAN sections 4, 5, 6).
 *
 * Only frames within +/- `windowFrames` of the previous nearest frame are searched, so on a
 * hairpin the tracker can never jump to the other leg. `arcM` is the ball's current projected
 * arc position (it can go down on a roll-back); `t` is its monotone high-water mark and is what
 * checkpoints and the finish use. `t` never decreases, not even across `reseed`.
 */
export class Progress {
  /** Index of the nearest frame found by the last update (or the reseed index). */
  index = 0;
  /** Current projected arc position, metres. */
  arcM = 0;
  /** High-water mark of `arcM`, metres. Monotone non-decreasing. */
  t = 0;
  /** Signed distance from the centreline, metres; positive = viewer's right. */
  lateralOffset = 0;
  /** Number of checkpoints passed so far. */
  checkpointsPassed = 0;
  finished = false;

  constructor(
    readonly frames: readonly Frame[],
    readonly finishM: number,
    readonly checkpointsM: readonly number[] = [],
    private readonly windowFrames: number = tuning.progress.windowFrames,
  ) {
    if (frames.length === 0) throw new Error('Progress needs at least one frame');
  }

  get frame(): Frame {
    return this.frames[this.index] as Frame;
  }

  /**
   * Re-centre the search window on a frame, e.g. after a respawn teleport. Keeps `t` (the
   * high-water mark never decreases); `arcM` and `lateralOffset` refresh on the next `update`.
   */
  reseed(index: number): void {
    this.index = Math.min(this.frames.length - 1, Math.max(0, Math.round(index)));
    this.arcM = this.frame.arcM;
    this.lateralOffset = 0;
  }

  update(pos: PointLike): ProgressEvents {
    const frames = this.frames;
    const lo = Math.max(0, this.index - this.windowFrames);
    const hi = Math.min(frames.length - 1, this.index + this.windowFrames);

    let best = this.index;
    let bestD = Infinity;
    for (let i = lo; i <= hi; i++) {
      const p = (frames[i] as Frame).pos;
      const dx = pos.x - p.x;
      const dy = pos.y - p.y;
      const dz = pos.z - p.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.index = best;

    // Sub-frame position: project onto the nearest frame's tangent / right.
    const f = frames[best] as Frame;
    const dx = pos.x - f.pos.x;
    const dy = pos.y - f.pos.y;
    const dz = pos.z - f.pos.z;
    const along = dx * f.tangent.x + dy * f.tangent.y + dz * f.tangent.z;
    // The nearest frame is within half a spacing along the track, so the projection is too.
    const half = tuning.spline.frameSpacingM / 2;
    const totalM = (frames[frames.length - 1] as Frame).arcM;
    this.arcM = Math.max(0, Math.min(totalM, f.arcM + Math.max(-half, Math.min(half, along))));
    this.lateralOffset = dx * f.right.x + dy * f.right.y + dz * f.right.z;
    if (this.arcM > this.t) this.t = this.arcM;

    const events: ProgressEvents = { checkpoints: [], finished: false };
    while (
      this.checkpointsPassed < this.checkpointsM.length &&
      this.t >= (this.checkpointsM[this.checkpointsPassed] as number)
    ) {
      events.checkpoints.push(this.checkpointsPassed);
      this.checkpointsPassed++;
    }
    if (!this.finished && this.t >= this.finishM) {
      this.finished = true;
      events.finished = true;
    }
    return events;
  }
}
