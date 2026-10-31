import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { fastForwardSim } from '../../src/app/fastForward';
import { Input } from '../../src/app/Input';
import { tuning } from '../../src/config/tuning';
import { GameWorld } from '../../src/game/GameWorld';
import { Progress } from '../../src/game/Progress';
import { buildSpline, makeFrame, type Frame } from '../../src/game/Spline';
import { buildColliders, buildRibbonGeometry } from '../../src/game/Track';
import { levelTest } from '../../src/levels/levelTest';
import { straightPoints } from './fixtures';

beforeAll(async () => {
  await RAPIER.init();
});

/** Tests for the Phase 1b code-review findings fixed at the start of Phase 2. */

describe('review 1: fastForward advances Input time', () => {
  const bare = { ...levelTest, id: 'bare', obstacles: [] };

  it('the 500 ms lockout expires during a fast-forward and the keyboard then drives the ball', () => {
    const sim = new GameWorld(bare, 'bigkid'); // hold mode: no pointer, no drive
    const input = new Input();
    input.configure('hold', 0);
    input.lock(); // what loadLevel / setState arm
    input.keyChange('Space', true); // drive
    input.keyChange('ArrowRight', true);
    expect(input.locked).toBe(true);

    fastForwardSim(sim, input, 0.45);
    expect(input.locked).toBe(true); // 27 steps = 450 ms: still locked
    expect(sim.progress.arcM).toBeLessThan(0.5); // and not moving

    const n = fastForwardSim(sim, input, 3);
    expect(n).toBe(180);
    expect(input.locked).toBe(false);
    expect(sim.progress.arcM).toBeGreaterThan(3); // it drove
    expect(input.controls.steer).toBe(1); // the keyboard steer ramped to full
  });

  it('stops early on `stop()` and when the world finishes', () => {
    const sim = new GameWorld(bare, 'tiny');
    const input = new Input();
    input.configure('always', 0);
    let calls = 0;
    const n = fastForwardSim(sim, input, 10, () => ++calls === 7);
    expect(n).toBe(7);
    sim.autopilot = true;
    const total = fastForwardSim(sim, input, 150);
    expect(sim.state).toBe('finished');
    expect(total).toBeLessThan(150 * tuning.physicsHz);
  });
});

describe('review 2: no collider for an empty wall geometry', () => {
  it("wallMode 'none' without finishM builds no wall collider and does not panic", () => {
    const { frames } = buildSpline(straightPoints);
    const geoms = buildRibbonGeometry(frames, 3.5, 'none', []);
    expect(geoms.walls.getAttribute('position').count).toBe(0);
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const colliders = buildColliders(world, geoms);
    expect(colliders.walls).toBeNull();
    expect(colliders.floor.shape.type).toBe(RAPIER.ShapeType.TriMesh);
    world.step(); // would panic on an empty index buffer
    world.free();
  });
});

describe('review 3: makeFrame with a vertical tangent', () => {
  const finite = (f: Frame): boolean =>
    [f.right, f.up, f.tangent, f.pos].every((v) => Number.isFinite(v.x + v.y + v.z));

  it('falls back to world +X at frame 0 and stays orthonormal (no NaN)', () => {
    for (const y of [1, -1]) {
      const f = makeFrame(new Vector3(), new Vector3(0, y, 0), 0);
      expect(finite(f)).toBe(true);
      expect(f.right.toArray()).toEqual([1, 0, 0]);
      expect(f.right.length()).toBeCloseTo(1, 9);
      expect(f.up.length()).toBeCloseTo(1, 9);
      expect(f.right.dot(f.tangent)).toBeCloseTo(0, 9);
    }
  });

  it("falls back to the previous frame's right when there is one", () => {
    const prev = new Vector3(0, 0, -1);
    const f = makeFrame(new Vector3(), new Vector3(0, 1, 1e-5), 3, prev);
    expect(finite(f)).toBe(true);
    expect(f.right.x).toBeCloseTo(0, 6);
    expect(f.right.z).toBeCloseTo(-1, 6);
  });

  it('a normal tangent is unchanged: right = normalize(cross(t, up))', () => {
    const f = makeFrame(new Vector3(), new Vector3(0, 0, 1), 0, new Vector3(0, 0, 1));
    expect(f.right.toArray()).toEqual([-1, 0, 0]);
  });

  it('a spline with a vertical stretch has finite frames throughout', () => {
    const spline = buildSpline([
      [0, 0, 0],
      [0, 0, 6],
      [0, 6, 6],
      [0, 12, 6],
      [0, 12, 12],
      [0, 12, 40],
    ]);
    expect(spline.frames.every(finite)).toBe(true);
  });
});

describe('review 4: Progress clamps the sub-frame projection', () => {
  const spline = buildSpline(straightPoints);
  const totalM = spline.totalM;

  it('never reads more than half a frame past the nearest frame', () => {
    const p = new Progress(spline.frames, spline.finishM);
    const half = tuning.spline.frameSpacingM / 2;
    // Hover high above frame 20 and well ahead of it along the track: nearest stays within the
    // window, the projection is clamped.
    const f = spline.frames[20] as Frame;
    p.update(f.pos.clone().addScaledVector(f.tangent, 0.2));
    expect(p.arcM).toBeLessThanOrEqual(p.frame.arcM + half + 1e-9);
    expect(p.arcM).toBeGreaterThanOrEqual(p.frame.arcM - half - 1e-9);
  });

  it('arcM stays inside [0, totalM] past either end of the track', () => {
    const p = new Progress(spline.frames, spline.finishM);
    p.update(new Vector3(0, 0.5, -5)); // behind the start
    expect(p.arcM).toBe(0);
    p.reseed(spline.frames.length - 1);
    p.update(new Vector3(0, 0.5, totalM + 5)); // beyond the end of the pad
    expect(p.arcM).toBe(totalM);
    expect(p.t).toBeLessThanOrEqual(totalM);
  });
});

describe('review 6: spline.tension is gone', () => {
  it('is not in tuning', () => {
    expect('tension' in tuning.spline).toBe(false);
  });
});
