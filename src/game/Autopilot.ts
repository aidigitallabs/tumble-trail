import { tuning } from '../config/tuning';
import type { ControlInput } from './Ball';
import type { Progress } from './Progress';
import type { Frame } from './Spline';

/**
 * Test driver (PLAN section 13). Runs *inside* the physics step, never from rAF, so a fast-forward
 * and a live run are identical.
 *
 * `driving` is always true. `steer` is a centring term, `-lateral / (width / 4)`, plus a
 * look-ahead term: how far (sideways, in the current frame's `right`) the frame
 * `tuning.autopilot.lookAheadM` metres ahead lies, so the ball anticipates curves. The look-ahead
 * weight is `tuning.autopilot.lookAheadGain`. Obstacle repulsion arrives with the obstacles in
 * Phase 2.
 */
export function autopilotControls(progress: Progress, width: number): ControlInput {
  const a = tuning.autopilot;
  const frames = progress.frames;
  const f = progress.frame;
  const ahead = frames[
    Math.min(
      frames.length - 1,
      progress.index + Math.round(a.lookAheadM / tuning.spline.frameSpacingM),
    )
  ] as Frame;
  const quarter = width / 4;
  const dx = ahead.pos.x - f.pos.x;
  const dy = ahead.pos.y - f.pos.y;
  const dz = ahead.pos.z - f.pos.z;
  const aheadLateral = dx * f.right.x + dy * f.right.y + dz * f.right.z;
  const steer = -progress.lateralOffset / quarter + (a.lookAheadGain * aheadLateral) / quarter;
  return { driving: true, steer: Math.max(-1, Math.min(1, steer)) };
}
