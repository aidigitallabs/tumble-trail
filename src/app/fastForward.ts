import { tuning } from '../config/tuning';
import type { ControlInput } from '../game/Ball';
import type { GameWorld } from '../game/GameWorld';

/** The part of `Input` that a fast-forward needs. */
export interface TimedInput {
  /** Advance time-based behaviour (lockout, keyboard ramp) by `dt` seconds. */
  update(dt: number): void;
  readonly controls: ControlInput;
}

/**
 * Steps the simulation for up to `maxSeconds` of simulated time (no rendering). Input time advances
 * by one physics step per iteration, so the 500 ms lockout armed by a state change expires and the
 * keyboard steer ramps exactly as they would live. Stops early once `stop()` returns true (checked
 * after each step) or the world is no longer `playing`. Returns the steps taken.
 */
export function fastForwardSim(
  sim: GameWorld,
  input: TimedInput,
  maxSeconds: number,
  stop: () => boolean = () => false,
  afterStep: () => void = () => {},
): number {
  const total = Math.round(maxSeconds * tuning.physicsHz);
  const dt = 1 / tuning.physicsHz;
  let n = 0;
  while (n < total && sim.state === 'playing') {
    input.update(dt);
    sim.step(input.controls);
    n++;
    afterStep();
    if (stop()) break;
  }
  return n;
}
