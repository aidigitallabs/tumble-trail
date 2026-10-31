import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { palettes } from '../config/brand';
import { tuning, type TierTuning } from '../config/tuning';
import type { LevelDef, Tier } from '../levels/schema';
import { autopilotControls } from './Autopilot';
import { Ball, type ControlInput } from './Ball';
import { Progress } from './Progress';
import { buildSpline, frameIndexAtArc, type Frame, type Spline } from './Spline';
import {
  buildColliders,
  buildRibbonGeometry,
  type RibbonGeometry,
  type TrackColliders,
  type WallMode,
} from './Track';

export type WorldState = 'playing' | 'finished';

/** Wall mode and no-wall spans for a level and tier (PLAN section 5 defaults). */
export function wallsFor(
  level: LevelDef,
  tier: Tier,
): { mode: WallMode; spans: Array<[number, number]> } {
  if (tier === 'tiny') return { mode: 'full', spans: [] };
  return { mode: level.walls?.bigkid ?? 'low', spans: level.noWallSpansM ?? [] };
}

/**
 * The simulation of one level: Rapier world, track colliders, ball, progress tracking, checkpoints,
 * finish, fall / stuck respawn and the autopilot. It has no renderer and reads no clock, so it
 * runs identically in a unit test, in `fastForward` and live.
 *
 * Per step (PLAN section 4): Progress.update -> checkpoint / finish -> fall / stuck checks ->
 * Ball.applyControls -> world.step. A respawn is a short step-counted sequence during which
 * physics is paused and input is ignored.
 */
export class GameWorld {
  readonly world: RAPIER.World;
  readonly spline: Spline;
  readonly width: number;
  readonly tierTuning: TierTuning;
  readonly geoms: RibbonGeometry;
  readonly colliders: TrackColliders;
  readonly progress: Progress;
  readonly ball: Ball;

  state: WorldState = 'playing';
  /** When true the autopilot, not the supplied input, drives each step. */
  autopilot = false;
  /** Increments on every respawn teleport; the camera hard-snaps when it changes. */
  respawnCount = 0;
  /** Number of physics steps taken. */
  steps = 0;

  /** 0 = not respawning, otherwise the steps elapsed in the respawn sequence (1-based). */
  private respawnStep = 0;
  private readonly respawnSteps: number;
  private readonly spawnIndex: number;

  constructor(
    readonly level: LevelDef,
    readonly tier: Tier,
  ) {
    this.tierTuning = tuning.tiers[tier];
    this.width = level.width?.[tier] ?? this.tierTuning.width;
    this.spline = buildSpline(level.points);
    this.spawnIndex = frameIndexAtArc(this.spline, tuning.physics.startArcM);

    const palette = palettes[level.palette];
    const walls = wallsFor(level, tier);
    this.geoms = buildRibbonGeometry(this.spline.frames, this.width, walls.mode, walls.spans, {
      finishM: this.spline.finishM,
      colors: { track: palette.track, stripe: palette.trackStripe, wall: palette.wall },
    });

    this.world = new RAPIER.World({ x: 0, y: tuning.physics.gravity, z: 0 });
    this.world.timestep = 1 / tuning.physicsHz;
    this.colliders = buildColliders(this.world, this.geoms);

    this.progress = new Progress(this.spline.frames, this.spline.finishM, level.checkpointsM);
    this.progress.reseed(this.spawnIndex);
    this.ball = new Ball(this.world, this.spawnPosition(this.spawnIndex));
    this.respawnSteps = Math.max(
      2,
      Math.round((tuning.respawn.durationMs / 1000) * tuning.physicsHz),
    );
    this.progress.update(this.ball.position());
  }

  /** Frame index of the last checkpoint passed, or the spawn frame if none. */
  checkpointFrameIndex(): number {
    const passed = this.progress.checkpointsPassed;
    if (passed === 0) return this.spawnIndex;
    return frameIndexAtArc(this.spline, this.level.checkpointsM[passed - 1] as number);
  }

  private spawnPosition(frameIndex: number): Vector3 {
    const f = this.spline.frames[frameIndex] as Frame;
    return f.pos.clone().addScaledVector(f.up, tuning.respawn.liftM);
  }

  get respawning(): boolean {
    return this.respawnStep > 0;
  }

  /** One fixed physics step. `input` is ignored while the autopilot is on or a respawn runs. */
  step(input: ControlInput): void {
    if (this.state === 'finished') return;
    this.steps++;

    if (this.respawnStep > 0) {
      this.stepRespawn();
      return;
    }

    const events = this.progress.update(this.ball.position());
    if (events.finished) {
      this.state = 'finished';
      return;
    }

    const p = this.progress;
    const frame = p.frame;
    const pos = this.ball.position();
    const fell =
      pos.y < frame.pos.y - this.tierTuning.fallDepth ||
      Math.abs(p.lateralOffset) > this.width ||
      pos.y < this.colliders.catchY + tuning.physics.catchPlaneHitM;
    if (fell || this.ball.isStuck()) {
      this.respawnStep = 1;
      this.stepRespawn();
      return;
    }

    const ctl = this.autopilot ? autopilotControls(p, this.width) : input;
    this.ball.applyControls(ctl, {
      frame,
      lateralOffset: p.lateralOffset,
      width: this.width,
      tier: this.tierTuning,
    });
    this.world.step();
    this.ball.snapshot();
  }

  /**
   * Respawn (PLAN section 6): over `respawnSteps` steps the ball scales out, at the midpoint it is
   * placed at the last checkpoint (+ up x 1 m), velocities zeroed, progress re-seeded, then it
   * scales back in. The world itself is not stepped.
   */
  private stepRespawn(): void {
    const half = Math.floor(this.respawnSteps / 2);
    const s = this.respawnStep;
    if (s < half) {
      this.ball.visualScale = 1 - s / half;
    } else if (s === half) {
      const index = this.checkpointFrameIndex();
      this.ball.placeAt(this.spawnPosition(index));
      this.progress.reseed(index);
      this.respawnCount++;
      this.ball.visualScale = 0;
    } else {
      this.ball.visualScale = Math.min(1, (s - half) / (this.respawnSteps - half));
    }
    this.respawnStep = s >= this.respawnSteps ? 0 : s + 1;
    if (this.respawnStep === 0) {
      this.ball.visualScale = 1;
      this.progress.update(this.ball.position());
    }
  }

  dispose(): void {
    this.ball.dispose();
    this.geoms.floor.dispose();
    this.geoms.walls.dispose();
    this.world.free();
  }
}
