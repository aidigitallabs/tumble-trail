import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { palettes } from '../../src/config/brand';
import { tuning } from '../../src/config/tuning';
import { buildArches } from '../../src/game/Arches';
import { GameWorld } from '../../src/game/GameWorld';
import { LevelView } from '../../src/game/LevelView';
import { buildSpline } from '../../src/game/Spline';
import { buildRibbonGeometry } from '../../src/game/Track';
import { levelTest } from '../../src/levels/levelTest';
import { straightPoints } from './fixtures';

beforeAll(async () => {
  await RAPIER.init();
});

const IDLE = { driving: false, steer: 0 } as const;

/** Triangles and draw calls the scene would cost (what renderer.info counts). */
function cost(root: THREE.Object3D): { triangles: number; drawCalls: number } {
  let triangles = 0;
  let drawCalls = 0;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const count = o instanceof THREE.InstancedMesh ? o.count : 1;
    const tris = o.geometry.getAttribute('position').count / 3;
    if (tris === 0 || count === 0) return;
    triangles += tris * count;
    drawCalls++;
  });
  return { triangles, drawCalls };
}

describe('LevelView budget (PLAN section 14) with decor on', () => {
  for (const tier of ['tiny', 'bigkid'] as const) {
    it(`${tier}: well under 40 000 triangles and 40 draw calls, ball included`, () => {
      const w = new GameWorld(levelTest, tier);
      const view = new LevelView(w);
      const scene = new THREE.Group();
      scene.add(view.group, w.ball.group, w.ball.shadow);
      const { triangles, drawCalls } = cost(scene);
      expect(triangles).toBeGreaterThan(5000);
      expect(triangles).toBeLessThanOrEqual(40_000);
      expect(drawCalls).toBeGreaterThan(5);
      expect(drawCalls).toBeLessThanOrEqual(40);
      const counts = view.decorCounts();
      expect(counts.tree + counts.cloud + counts.disc).toBeGreaterThan(30);
      view.dispose();
    });
  }
});

describe('start pad', () => {
  const { frames } = buildSpline(straightPoints);
  const plain = buildRibbonGeometry(frames, 3.5, 'low', []);
  const radius = tuning.track.startPadDiameterM / 2;
  const padded = buildRibbonGeometry(frames, 3.5, 'low', [], { startPadRadiusM: radius });

  it('is a 3 m disc: the half behind frame 0 as a flat fan, facing up', () => {
    expect(radius).toBe(1.5);
    const n = tuning.track.startPadSegments;
    const extra =
      padded.floor.getAttribute('position').count / 3 -
      plain.floor.getAttribute('position').count / 3;
    expect(extra).toBe(n);
    const pos = padded.floor.getAttribute('position');
    const nor = padded.floor.getAttribute('normal');
    const f0 = frames[0]!;
    const start = plain.floor.getAttribute('position').count;
    for (let i = start; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).sub(f0.pos);
      expect(v.dot(f0.up)).toBeCloseTo(0, 6); // flat, in the frame's plane
      expect(v.dot(f0.tangent)).toBeLessThanOrEqual(1e-6); // behind (or on) the start line
      expect(v.length()).toBeLessThanOrEqual(radius + 1e-6);
      expect(nor.getY(i)).toBeGreaterThan(0.99);
    }
    // Triangles wound CCW seen from above.
    for (let i = start; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
    }
  });

  it('the ball spawns on it, at frame 0, and a Tiny/Big kid world has it', () => {
    for (const tier of ['tiny', 'bigkid'] as const) {
      const w = new GameWorld(levelTest, tier);
      const f0 = w.spline.frames[0]!;
      const p = w.ball.position();
      expect(p.x).toBeCloseTo(f0.pos.x + f0.up.x * tuning.respawn.liftM, 6);
      expect(p.z).toBeCloseTo(f0.pos.z + f0.up.z * tuning.respawn.liftM, 6);
      for (let i = 0; i < 60; i++) w.step(IDLE);
      expect(w.respawnCount).toBe(0);
      expect(w.ball.position().y).toBeCloseTo(0.5, 1); // resting on the pad / floor
      expect(w.geoms.floor.getAttribute('position').count / 3).toBeGreaterThan(
        buildRibbonGeometry(w.spline.frames, w.width, 'full', [], {
          finishM: w.spline.finishM,
        }).floor.getAttribute('position').count / 3,
      );
    }
  });
});

describe('walls per tier come from the level and the tuning defaults', () => {
  it('Tiny full (1.5 m), Big kid low (0.35 m); a level can say none for Big kid', () => {
    /** Tallest wall vertex above the floor of its nearest frame. */
    const height = (w: GameWorld): number => {
      const pos = w.geoms.walls.getAttribute('position');
      let max = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const near = w.spline.frames.reduce((b, g) =>
          g.pos.distanceTo(v) < b.pos.distanceTo(v) ? g : b,
        );
        max = Math.max(max, v.y - near.pos.y);
      }
      return max;
    };
    expect(tuning.tiers.tiny.wallMode).toBe('full');
    expect(tuning.tiers.bigkid.wallMode).toBe('low');
    expect(height(new GameWorld(levelTest, 'tiny'))).toBeCloseTo(1.5, 6);
    expect(height(new GameWorld(levelTest, 'bigkid'))).toBeCloseTo(0.35, 6);
    // 'none' (Big kid) leaves only the end pad's walls (low) and builds without a wall panic.
    const none = new GameWorld({ ...levelTest, walls: { bigkid: 'none' } }, 'bigkid');
    expect(height(none)).toBeCloseTo(0.35, 6);
    // noWallSpansM removes kerbs from the Big kid track but never from Tiny.
    const spans: Array<[number, number]> = [[2, 10]];
    const tiny = new GameWorld({ ...levelTest, noWallSpansM: spans }, 'tiny');
    const tinyFull = new GameWorld(levelTest, 'tiny');
    expect(tiny.geoms.walls.getAttribute('position').count).toBe(
      tinyFull.geoms.walls.getAttribute('position').count,
    );
    const big = new GameWorld({ ...levelTest, noWallSpansM: spans }, 'bigkid');
    expect(big.geoms.walls.getAttribute('position').count).toBeLessThan(
      new GameWorld(levelTest, 'bigkid').geoms.walls.getAttribute('position').count,
    );
  });

  it('the end pad has side walls and a back wall that stop the ball', () => {
    for (const tier of ['tiny', 'bigkid'] as const) {
      const bare = { ...levelTest, obstacles: [], checkpointsM: [25, 50, 72] };
      const w = new GameWorld(bare, tier);
      const last = w.spline.frames[w.spline.frames.length - 1]!;
      // Back wall: rolling the ball straight at it from the finish line stops it inside the pad.
      const f = w.spline.frames[Math.round(w.spline.finishM / w.spline.ds)]!;
      w.ball.placeAt(f.pos.clone().addScaledVector(f.up, 0.5));
      w.ball.body.setLinvel({ x: f.tangent.x * 6, y: 0, z: f.tangent.z * 6 }, true);
      for (let i = 0; i < 240; i++) w.world.step();
      const p = w.ball.position();
      const along = new THREE.Vector3(p.x, p.y, p.z).sub(last.pos).dot(last.tangent);
      expect(along).toBeLessThan(0);
      expect(along).toBeGreaterThan(-3); // stopped (and bounced a little) inside the pad
      expect(p.y).toBeGreaterThan(0);
    }
  });
});

describe('arches (visual)', () => {
  const spline = buildSpline(levelTest.points);

  it('every checkpoint and the finish have an arch above camera height, outside the walls', () => {
    for (const width of [6, 3.5]) {
      const { geometry, flags } = buildArches(
        spline,
        width,
        levelTest.checkpointsM,
        spline.finishM,
      );
      expect(flags).toHaveLength(levelTest.checkpointsM.length);
      const pos = geometry.getAttribute('position');
      // No vertex in the airspace the ball and camera use: inside the track width and below the
      // beam. Posts are outside the walls; beams are >= 7.5 m up.
      const wallOuter = width / 2 + tuning.track.wallThicknessM;
      const finish = spline.frames[Math.round(spline.finishM / spline.ds)]!;
      for (let i = 0; i < pos.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, i);
        const near = spline.frames.reduce((b, g) =>
          g.pos.distanceTo(v) < b.pos.distanceTo(v) ? g : b,
        );
        const lateral = Math.abs(v.clone().sub(near.pos).dot(near.right));
        const height = v.y - near.pos.y;
        if (height < tuning.arch.beamHeightM - 1e-6 && height > tuning.arch.poleHeightM) {
          expect(lateral).toBeGreaterThanOrEqual(wallOuter);
        }
        expect(height).toBeGreaterThanOrEqual(-1e-6);
      }
      expect(finish).toBeDefined();
      expect(tuning.arch.beamHeightM).toBeGreaterThan(tuning.tiers.tiny.cameraUp + 2);
    }
  });

  it('has no colliders: it is not in the physics world', () => {
    const w = new GameWorld({ ...levelTest, obstacles: [] }, 'tiny');
    expect(w.world.colliders.len()).toBe(4); // ball, floor, walls, catch plane
  });
});

describe('checkpoint flags drop when the checkpoint is passed (not colour-only)', () => {
  it('the cloth slides down and spins; the shape and pose change, the colour does not', () => {
    const w = new GameWorld(levelTest, 'tiny');
    const view = new LevelView(w);
    const flags = view.group.children.find(
      (c): c is THREE.InstancedMesh =>
        c instanceof THREE.InstancedMesh && c.count === levelTest.checkpointsM.length,
    )!;
    expect(flags).toBeDefined();
    const y = (i: number): number =>
      new THREE.Matrix4().fromArray(flags.instanceMatrix.array, i * 16).elements[13]!;
    const before = [0, 1, 2].map(y);
    expect([0, 1, 2].map((i) => view.flagPose(i).passed)).toEqual([false, false, false]);

    w.autopilot = true;
    while (w.progress.checkpointsPassed < 1) w.step(IDLE);
    view.update(0); // the view sees the event
    expect(view.flagPose(0).passed).toBe(true);
    expect(view.flagPose(1).passed).toBe(false);

    // Mid-animation: lower than before, spinning.
    for (let i = 0; i < 20; i++) view.update(1 / 60);
    const mid = view.flagPose(0);
    expect(mid.dropM).toBeGreaterThan(0);
    expect(mid.dropM).toBeLessThan(tuning.arch.dropM);
    expect(y(0)).toBeLessThan(before[0]!);

    // Settled: dropped by exactly dropM, a whole number of turns, others untouched.
    for (let i = 0; i < 120; i++) view.update(1 / 60);
    const done = view.flagPose(0);
    expect(done.dropM).toBeCloseTo(tuning.arch.dropM, 9);
    expect(done.spin / (2 * Math.PI)).toBeCloseTo(tuning.arch.spinTurns, 9);
    expect(y(0)).toBeCloseTo(before[0]! - tuning.arch.dropM, 4);
    expect(y(1)).toBeCloseTo(before[1]!, 6);
    expect(y(2)).toBeCloseTo(before[2]!, 6);
    view.dispose();
  });

  it('with reduced motion the flag drops without spinning', () => {
    const w = new GameWorld(levelTest, 'tiny');
    const view = new LevelView(w, { reducedMotion: true });
    w.autopilot = true;
    while (w.progress.checkpointsPassed < 1) w.step(IDLE);
    view.update(0);
    for (let i = 0; i < 20; i++) view.update(1 / 60);
    expect(view.flagPose(0).spin).toBe(0);
    expect(view.flagPose(0).dropM).toBeGreaterThan(0);
  });

  it('a view created after checkpoints were passed shows them already dropped', () => {
    const w = new GameWorld(levelTest, 'tiny');
    w.autopilot = true;
    while (w.progress.checkpointsPassed < 2) w.step(IDLE);
    const view = new LevelView(w);
    expect(view.flagPose(0).dropM).toBe(tuning.arch.dropM);
    expect(view.flagPose(1).dropM).toBe(tuning.arch.dropM);
    expect(view.flagPose(2).dropM).toBe(0);
  });
});

describe('balloon pop animation', () => {
  it('bursts (scale up) then vanishes (scale 0), visual only', () => {
    const w = new GameWorld(levelTest, 'tiny');
    const view = new LevelView(w);
    const balloons = view.group.children.find(
      (c): c is THREE.InstancedMesh =>
        c instanceof THREE.InstancedMesh && c.count === w.balloons.length,
    )!;
    const scale = (i: number): number =>
      new THREE.Matrix4().fromArray(balloons.instanceMatrix.array, i * 16).elements[0]!;
    expect([0, 1, 2, 3].map(scale)).toEqual([1, 1, 1, 1]);

    w.autopilot = true;
    while (w.balloonsPopped < 1) w.step(IDLE);
    view.update(0);
    const peaks: number[] = [];
    for (let i = 0; i < 30; i++) {
      view.update(1 / 60);
      peaks.push(scale(0));
    }
    expect(Math.max(...peaks)).toBeGreaterThan(1.3);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(tuning.obstacles.balloon.popPeakScale + 1e-6);
    expect(scale(0)).toBe(0); // gone after popSeconds
    expect(scale(3)).toBe(1); // the others untouched
    view.dispose();
  });
});

describe('palette sky and fog colours exist for every palette', () => {
  it('sky and fog are set', () => {
    for (const p of Object.values(palettes)) {
      expect(p.sky).toBeGreaterThan(0);
      expect(p.fog).toBeGreaterThan(0);
    }
  });
});
