import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { tuning, type TierTuning } from '../../src/config/tuning';
import { GameWorld } from '../../src/game/GameWorld';
import { frameIndexAtArc } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';

beforeAll(async () => {
  await RAPIER.init();
});

const IDLE = { driving: false, steer: 0 } as const;

/** Run until finished (or the cap); returns seconds. */
function runToFinish(w: GameWorld, capSeconds = 150): number {
  let n = 0;
  while (w.state === 'playing' && n < capSeconds * tuning.physicsHz) {
    w.step(IDLE);
    n++;
  }
  return n / tuning.physicsHz;
}

describe('ball and colliders (PLAN sections 5 and 6)', () => {
  let w: GameWorld;
  beforeAll(() => {
    w = new GameWorld(levelTest, 'tiny');
  });

  it('has the specified body and collider settings', () => {
    expect(w.ball.collider.mass()).toBeCloseTo(1, 6);
    expect(w.ball.collider.friction()).toBeCloseTo(0.8, 6);
    expect(w.ball.collider.restitution()).toBeCloseTo(0.2, 6);
    expect(w.ball.body.isCcdEnabled()).toBe(true);
    expect(w.ball.body.angularDamping()).toBeCloseTo(0.1, 6);
    expect(w.ball.body.linearDamping()).toBeCloseTo(0.2, 6);
  });

  it('builds a floor trimesh (friction 0.8), a wall trimesh (friction 0, restitution 0.3)', () => {
    const { floor, catchPlane } = w.colliders;
    const walls = w.colliders.walls!;
    expect(walls).not.toBeNull();
    expect(floor.friction()).toBeCloseTo(0.8, 6);
    expect(walls.friction()).toBeCloseTo(0, 6);
    expect(walls.restitution()).toBeCloseTo(0.3, 6);
    expect(floor.shape.type).toBe(RAPIER.ShapeType.TriMesh);
    expect(walls.shape.type).toBe(RAPIER.ShapeType.TriMesh);
    expect(floor.parent()).toBeNull();
    expect(walls.parent()).toBeNull();
    expect(catchPlane.parent()).toBeNull();
  });

  it('puts the catch plane 10 m below the lowest frame', () => {
    const lowest = Math.min(...w.spline.frames.map((f) => f.pos.y));
    expect(w.colliders.catchY).toBeCloseTo(lowest - tuning.respawn.catchPlaneDepthM, 5);
  });

  it('uses the tier width for the track', () => {
    expect(new GameWorld(levelTest, 'bigkid').width).toBe(3.5);
    expect(w.width).toBe(6);
  });
});

describe('autopilot completes levelTest (PLAN section 16, Phase 1b)', () => {
  it('Tiny finishes with no respawns', () => {
    const w = new GameWorld(levelTest, 'tiny');
    w.autopilot = true;
    const seconds = runToFinish(w);
    expect(w.state).toBe('finished');
    expect(w.respawnCount).toBe(0);
    expect(w.progress.checkpointsPassed).toBe(levelTest.checkpointsM.length);
    expect(seconds).toBeLessThan(120);
  });

  it('Big kid finishes with no respawns, inside the plan window', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    w.autopilot = true;
    const seconds = runToFinish(w);
    expect(w.state).toBe('finished');
    expect(w.respawnCount).toBe(0);
    expect(seconds).toBeGreaterThanOrEqual(tuning.bigkidLevelSeconds[0]);
    expect(seconds).toBeLessThanOrEqual(tuning.bigkidLevelSeconds[1]);
  });

  it('stops the simulation on finish', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    w.autopilot = true;
    runToFinish(w);
    const before = { ...w.ball.position() };
    const steps = w.steps;
    for (let i = 0; i < 60; i++) w.step(IDLE);
    expect(w.steps).toBe(steps);
    expect(w.ball.position()).toEqual(before);
  });
});

describe('control forces', () => {
  it('Tiny rolls with no input at all (always-drive is the input layer, but a centred ball stays centred)', () => {
    const w = new GameWorld(levelTest, 'tiny');
    for (let i = 0; i < 600; i++) w.step({ driving: true, steer: 0 });
    expect(w.progress.t).toBeGreaterThan(20);
    expect(Math.abs(w.progress.lateralOffset)).toBeLessThan(0.3);
  });

  it('holding full steer parks the ball in a lane inside the walls (positive = viewer right)', () => {
    // levelTest without obstacles: this is about the lane controller, and since Phase 2 a Big kid
    // ball held at full right steer would (correctly) drive into the pillar at +0.9 m.
    const bare = { ...levelTest, id: 'levelTestBare', obstacles: [] };
    for (const tier of ['tiny', 'bigkid'] as const) {
      const tt = tuning.tiers[tier];
      const lane = tt.width / 2 - tuning.ball.radius - tt.laneMargin;
      const w = new GameWorld(bare, tier);
      let maxAbs = 0;
      for (let i = 0; i < 480; i++) {
        w.step({ driving: true, steer: 1 });
        maxAbs = Math.max(maxAbs, Math.abs(w.progress.lateralOffset));
      }
      expect(w.respawnCount).toBe(0);
      expect(w.progress.lateralOffset).toBeGreaterThan(0.3 * lane);
      expect(maxAbs).toBeLessThan(tt.width / 2 - tuning.ball.radius + 0.35);
    }
  });

  it('never exceeds the horizontal speed clamp', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    w.autopilot = true;
    const limit = tuning.tiers.bigkid.maxSpeed * tuning.ball.speedClampFactor;
    for (let i = 0; i < 1200; i++) {
      w.step(IDLE);
      const v = w.ball.body.linvel();
      expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(limit + 1e-6);
    }
  });

  it('brakes when not driving (damping is brakeDamping)', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    for (let i = 0; i < 180; i++) w.step({ driving: true, steer: 0 });
    const fast = w.ball.speed();
    for (let i = 0; i < 120; i++) w.step({ driving: false, steer: 0 });
    expect(w.ball.body.linearDamping()).toBeCloseTo(tuning.tiers.bigkid.brakeDamping, 6);
    expect(w.ball.speed()).toBeLessThan(fast * 0.25);
  });
});

describe('fall, respawn and stuck (PLAN section 6)', () => {
  const respawnSteps = Math.round((tuning.respawn.durationMs / 1000) * tuning.physicsHz);

  it('a ball teleported far below the track respawns at the start with zero velocity', () => {
    const w = new GameWorld(levelTest, 'tiny');
    w.autopilot = true;
    for (let i = 0; i < 60; i++) w.step(IDLE);
    const f = w.progress.frame;
    w.ball.placeAt({ x: f.pos.x, y: f.pos.y - 20, z: f.pos.z });
    const tBefore = w.progress.t;
    // The fall is detected on the next step, which starts the 300 ms sequence (physics paused).
    w.step(IDLE);
    expect(w.respawning).toBe(true);
    const yAfterFall = w.ball.position().y;
    for (let i = 0; i < 3; i++) w.step({ driving: true, steer: 1 });
    expect(w.ball.position().y).toBe(yAfterFall); // physics paused, input ignored
    for (let i = 0; i < respawnSteps - 4; i++) w.step(IDLE);
    expect(w.respawning).toBe(false);
    expect(w.respawnCount).toBe(1);
    expect(w.ball.visualScale).toBe(1);
    const spawn = w.spline.frames[frameIndexAtArc(w.spline, tuning.physics.startArcM)]!;
    const p = w.ball.position();
    expect(p.x).toBeCloseTo(spawn.pos.x + spawn.up.x * tuning.respawn.liftM, 3);
    expect(p.z).toBeCloseTo(spawn.pos.z + spawn.up.z * tuning.respawn.liftM, 3);
    expect(w.progress.t).toBeGreaterThanOrEqual(tBefore); // high-water mark never decreases
    // And it carries on and finishes.
    expect(runToFinish(w)).toBeLessThan(150);
    expect(w.state).toBe('finished');
  });

  it('respawns at the last checkpoint once one is passed', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    w.autopilot = true;
    while (w.progress.checkpointsPassed < 2) w.step(IDLE);
    const cp = w.spline.frames[frameIndexAtArc(w.spline, levelTest.checkpointsM[1] as number)]!;
    w.ball.placeAt({ x: 0, y: -50, z: 0 });
    for (let i = 0; i < respawnSteps; i++) w.step(IDLE);
    expect(w.respawnCount).toBe(1);
    expect(w.progress.index).toBeGreaterThanOrEqual(frameIndexAtArc(w.spline, 49));
    const p = w.ball.position();
    expect(Math.hypot(p.x - cp.pos.x, p.z - cp.pos.z)).toBeLessThan(1.5);
    expect(w.progress.checkpointsPassed).toBe(2);
  });

  it('driving but stuck for 3 s respawns', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    // A ball that cannot move: drive removed, so speed stays below 0.3 m/s while "driving".
    const stuckTier: TierTuning = { ...tuning.tiers.bigkid, drive: 0 };
    Object.assign(w, { tierTuning: stuckTier });
    const need = tuning.ball.stuckSeconds * tuning.physicsHz;
    for (let i = 0; i < need - 30; i++) w.step({ driving: true, steer: 0 });
    expect(w.respawning).toBe(false);
    expect(w.respawnCount).toBe(0);
    for (let i = 0; i < 60 + respawnSteps; i++) w.step({ driving: true, steer: 0 });
    expect(w.respawnCount).toBe(1);
  });

  it('not driving never counts as stuck', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    for (let i = 0; i < 6 * tuning.physicsHz; i++) w.step(IDLE);
    expect(w.respawnCount).toBe(0);
  });
});

describe('parking brake damps rolling too (review 8)', () => {
  it('angular damping follows linear damping: brakeDamping when not driving, 0.1 when driving', () => {
    const w = new GameWorld(levelTest, 'bigkid');
    w.step({ driving: true, steer: 0 });
    expect(w.ball.body.linearDamping()).toBeCloseTo(tuning.ball.drivingDamping, 6);
    expect(w.ball.body.angularDamping()).toBeCloseTo(tuning.ball.angularDamping, 6);
    w.step({ driving: false, steer: 0 });
    expect(w.ball.body.linearDamping()).toBeCloseTo(tuning.tiers.bigkid.brakeDamping, 6);
    expect(w.ball.body.angularDamping()).toBeCloseTo(tuning.tiers.bigkid.brakeDamping, 6);
    w.step({ driving: true, steer: 0 });
    expect(w.ball.body.angularDamping()).toBeCloseTo(tuning.ball.angularDamping, 6);
  });

  it('the spin dies quickly after letting go, and creeps down a 15 degree ramp more slowly', () => {
    const bare = { ...levelTest, id: 'levelTestBare', obstacles: [] };
    const w = new GameWorld(bare, 'bigkid');
    w.autopilot = true;
    while (w.progress.arcM < 57) w.step({ driving: true, steer: 0 }); // on the ramp (15 degrees)
    w.autopilot = false;
    const spin0 = Math.hypot(...Object.values(w.ball.body.angvel()));
    for (let i = 0; i < 90; i++) w.step({ driving: false, steer: 0 });
    // Terminal creep speed is gravity along the slope (rolling, 5/7 of g sin 15) over the damping:
    // 1.81 / 2.5 = 0.72 m/s. Before this fix the spin kept feeding the ball, about 1 m/s.
    expect(spin0).toBeGreaterThan(2);
    expect(w.ball.speed()).toBeLessThan(0.9);
    expect(w.respawnCount).toBe(0);
  });
});
