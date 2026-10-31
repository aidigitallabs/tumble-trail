import { tuning } from '../config/tuning';
import type { ControlInput } from './Ball';
import type { Progress } from './Progress';
import type { Post } from './Obstacles';
import type { Frame } from './Spline';

/**
 * Test driver (PLAN section 13). Runs *inside* the physics step, never from rAF, so a fast-forward
 * and a live run are identical.
 *
 * `driving` is always true. `steer` is a centring term, `-lateral / (width / 4)`, plus a
 * look-ahead term: how far (sideways, in the current frame's `right`) the frame
 * `tuning.autopilot.lookAheadM` metres ahead lies, so the ball anticipates curves. The look-ahead
 * weight is `tuning.autopilot.lookAheadGain`.
 *
 * Repulsion (Phase 2): the nearest pillar / gate posts (from `postBehindM` behind to `postAheadM`
 * ahead; a gate's two posts count together) push the steer away from them while the ball is closer
 * than their radius + the ball radius + `postMarginM`, with strength
 * `postGain * (clearance - distance) / clearance`. Two gate posts cancel when the ball is centred
 * between them and push it back to the middle when it is not.
 */
export function autopilotControls(
  progress: Progress,
  width: number,
  posts: readonly Post[] = [],
): ControlInput {
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
  let steer = -progress.lateralOffset / quarter + (a.lookAheadGain * aheadLateral) / quarter;
  // Only the nearest group of posts matters (a gate's two posts share an arc position): looking at
  // the next pillar too would fight the first one when pillars alternate sides a few metres apart.
  let nearest = Infinity;
  for (const post of posts) {
    const ahead = post.arcM - progress.arcM;
    if (ahead >= -a.postBehindM && post.arcM < nearest) nearest = post.arcM;
  }
  for (const post of posts) {
    const ahead = post.arcM - progress.arcM;
    if (ahead > a.postAheadM || post.arcM - nearest > a.postGroupM) continue;
    if (ahead < -a.postBehindM) continue;
    const clearance = post.radiusM + tuning.ball.radius + a.postMarginM;
    const d = progress.lateralOffset - post.lateral;
    if (Math.abs(d) >= clearance) continue;
    const side = Math.abs(d) > 1e-6 ? Math.sign(d) : post.lateral > 0 ? -1 : 1;
    steer += (side * a.postGain * (clearance - Math.abs(d))) / clearance;
  }
  return { driving: true, steer: Math.max(-1, Math.min(1, steer)) };
}
