import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, type BufferGeometry } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { tuning } from '../../src/config/tuning';
import { ContactFilter } from '../../src/game/Contacts';
import { GameWorld, type SimEvent } from '../../src/game/GameWorld';
import {
  balloonCentre,
  buildBalloonGeometry,
  buildBumpGeometry,
  buildPostVisual,
  placeObstacles,
  postBases,
  postsOf,
} from '../../src/game/Obstacles';
import { buildSpline, type Frame } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import type { LevelDef } from '../../src/levels/schema';

beforeAll(async () => {
  await RAPIER.init();
});

const IDLE = { driving: false, steer: 0 } as const;
const o = tuning.obstacles;

function verts(g: BufferGeometry): Vector3[] {
  const p = g.getAttribute('position');
  return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i));
}

/** A level with a single obstacle on the straight opening of levelTest's track. */
const one = (
  kind: LevelDef['obstacles'][number]['kind'],
  atM: number,
  offset: number,
  tiers: Array<'tiny' | 'bigkid'> = ['tiny', 'bigkid'],
): LevelDef => ({ ...levelTest, id: `one-${kind}`, obstacles: [{ atM, offset, kind, tiers }] });

describe('placement', () => {
  const spline = buildSpline(levelTest.points);

  it('is filtered by tier: Tiny gets bumps and balloons only, Big kid everything', () => {
    const tiny = placeObstacles(levelTest, 'tiny', spline).map((p) => p.kind);
    const big = placeObstacles(levelTest, 'bigkid', spline).map((p) => p.kind);
    expect(new Set(tiny)).toEqual(new Set(['bump', 'balloon']));
    expect(new Set(big)).toEqual(new Set(['bump', 'pillar', 'gate', 'balloon']));
    expect(big.length).toBe(levelTest.obstacles.length);
    expect(tiny.length).toBe(levelTest.obstacles.filter((x) => x.tiers.includes('tiny')).length);
  });

  it('puts each obstacle at atM along the spline, offset along the frame right', () => {
    for (const p of placeObstacles(levelTest, 'bigkid', spline)) {
      expect(p.frame.arcM).toBeCloseTo(p.atM, 6);
      const lateral = p.base.clone().sub(p.frame.pos).dot(p.frame.right);
      expect(lateral).toBeCloseTo(p.offset, 6);
      // On the floor: no height offset from the centreline frame.
      expect(p.base.y).toBeCloseTo(p.frame.pos.y, 9);
    }
  });

  it('positive offsets are on the viewer right (tangent +Z: right = -X)', () => {
    const [p] = placeObstacles(one('pillar', 8, 0.9), 'bigkid', spline);
    expect(p?.base.x).toBeCloseTo(-0.9, 3);
    expect(p?.base.z).toBeCloseTo(8, 1);
  });

  it('a gate has two posts at offset +/- 1.1 and the autopilot sees both', () => {
    const placed = placeObstacles(one('gate', 46, 0.2), 'bigkid', spline);
    const bases = postBases(placed);
    expect(bases).toHaveLength(2);
    const f = placed[0]!.frame;
    const lat = bases.map((b) => b.clone().sub(f.pos).dot(f.right)).sort((a, b) => a - b);
    expect(lat[0]).toBeCloseTo(0.2 - 1.1, 6);
    expect(lat[1]).toBeCloseTo(0.2 + 1.1, 6);
    expect(
      postsOf(placed)
        .map((p) => p.lateral)
        .sort((a, b) => a - b),
    ).toEqual([0.2 - 1.1, 0.2 + 1.1].map((x) => expect.closeTo(x, 9)));
  });
});

describe('bump (PLAN section 5)', () => {
  it('is a sinusoidal ridge 0.2 m high, 1.2 m along the track, width/3 across, centred at the offset', () => {
    for (const [tier, width] of [
      ['tiny', 6],
      ['bigkid', 3.5],
    ] as const) {
      const spline = buildSpline(levelTest.points);
      const placed = placeObstacles(one('bump', 8, 0.3), tier, spline);
      const g = buildBumpGeometry(placed, width);
      const f = placed[0]!.frame;
      let hMax = -Infinity;
      let hMin = Infinity;
      let uMin = Infinity;
      let uMax = -Infinity;
      let vMin = Infinity;
      let vMax = -Infinity;
      for (const v of verts(g)) {
        const d = v.clone().sub(f.pos);
        hMax = Math.max(hMax, d.dot(f.up));
        hMin = Math.min(hMin, d.dot(f.up));
        uMin = Math.min(uMin, d.dot(f.tangent));
        uMax = Math.max(uMax, d.dot(f.tangent));
        vMin = Math.min(vMin, d.dot(f.right));
        vMax = Math.max(vMax, d.dot(f.right));
      }
      expect(hMax).toBeCloseTo(o.bump.heightM, 3);
      expect(hMin).toBeCloseTo(-o.bump.sinkM, 3); // base just below the floor: no visible seam
      expect(uMax - uMin).toBeCloseTo(1.2, 2);
      expect(vMax - vMin).toBeCloseTo(width / 3, 2);
      expect((vMax + vMin) / 2).toBeCloseTo(0.3, 2);
      expect((uMax + uMin) / 2).toBeCloseTo(0, 2);
      // Sinusoidal: height at the middle is the peak, a quarter in it is half the peak.
      const centre = verts(g).filter(
        (v) =>
          Math.abs(v.clone().sub(f.pos).dot(f.tangent)) < 1e-6 &&
          Math.abs(v.clone().sub(f.pos).dot(f.right) - 0.3) < 1e-6,
      );
      expect(centre.length).toBeGreaterThan(0);
      expect(centre[0]!.clone().sub(f.pos).dot(f.up)).toBeCloseTo(o.bump.heightM, 3);
    }
  });

  it('has a collider (one trimesh) in the world, kind bump, built from the same vertices', () => {
    const w = new GameWorld(one('bump', 8, 0), 'tiny');
    expect(w.bumpGeometry).not.toBeNull();
    const trimeshes = [...Array(1)].map(() => w.world.getCollider(maxHandle(w, 'bump')));
    expect(trimeshes[0]!.shape.type).toBe(RAPIER.ShapeType.TriMesh);
    const shape = trimeshes[0]!.shape as RAPIER.TriMesh;
    expect(shape.vertices.length / 3).toBeGreaterThan(0);
    // Every collider vertex is one of the visual vertices.
    const visual = new Set(
      verts(w.bumpGeometry!).map((v) => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`),
    );
    for (let i = 0; i < shape.vertices.length; i += 3) {
      const key = `${shape.vertices[i]!.toFixed(4)},${shape.vertices[i + 1]!.toFixed(4)},${shape.vertices[i + 2]!.toFixed(4)}`;
      expect(visual.has(key)).toBe(true);
    }
  });

  it('a level without bumps has no bump geometry', () => {
    expect(new GameWorld(one('balloon', 8, 0), 'tiny').bumpGeometry).toBeNull();
  });
});

/** Handle of the last collider of a kind (kinds are private; find it through a contact-free probe). */
function maxHandle(w: GameWorld, kind: string): number {
  const map = (w as unknown as { kindOf: Map<number, string> }).kindOf;
  let h = -1;
  for (const [handle, k] of map) if (k === kind) h = handle;
  expect(h).toBeGreaterThanOrEqual(0);
  return h;
}

/** Ray from (x0, y, z) along +x/-x; returns the hit distance, or null. */
function rayHit(w: GameWorld, from: Vector3, dir: Vector3, max = 20): number | null {
  const hit = w.world.castRay(
    new RAPIER.Ray(from, dir),
    max,
    true,
    undefined,
    undefined,
    undefined,
    w.ball.body,
    (c) => c.handle !== w.colliders.floor.handle && c.handle !== w.colliders.catchPlane.handle,
  );
  return hit ? hit.timeOfImpact : null;
}

describe('pillar (PLAN section 5)', () => {
  let w: GameWorld;
  let base: Vector3;
  beforeAll(() => {
    w = new GameWorld(one('pillar', 8, 0.9, ['bigkid']), 'bigkid');
    w.world.step(); // update the query pipeline
    base = w.obstacles[0]!.base;
  });

  it('is a cylinder r 0.4 m, h 2.0 m (roundCylinder) at the offset', () => {
    // Horizontal ray 1 m above the floor, from 3 m away along the track direction normal.
    const origin = new Vector3(base.x, base.y + 1, base.z - 3);
    const d = rayHit(w, origin, new Vector3(0, 0, 1))!;
    expect(3 - d).toBeCloseTo(0.4, 3); // surface at radius 0.4 from the axis
    // Top at 2.0 m.
    const down = rayHit(w, new Vector3(base.x, base.y + 5, base.z), new Vector3(0, -1, 0))!;
    expect(5 - down).toBeCloseTo(2.0, 3);
  });

  it('has a 0.3 m conical skirt: 0.7 m radius at the foot, gone above 0.3 m', () => {
    const foot = new Vector3(base.x, base.y + 0.02, base.z - 3);
    expect(3 - rayHit(w, foot, new Vector3(0, 0, 1))!).toBeGreaterThan(0.64);
    expect(3 - rayHit(w, foot, new Vector3(0, 0, 1))!).toBeLessThan(0.7);
    const above = new Vector3(base.x, base.y + 0.35, base.z - 3);
    expect(3 - rayHit(w, above, new Vector3(0, 0, 1))!).toBeCloseTo(0.4, 3);
  });

  it('visual: cylinder height 2.0, skirt reaches 0.7 m out', () => {
    const g = buildPostVisual(w.obstacles)!;
    const vs = verts(g).map((v) => v.clone().sub(base));
    expect(Math.max(...vs.map((v) => v.y))).toBeCloseTo(2.0, 3);
    expect(Math.max(...vs.map((v) => Math.hypot(v.x, v.z)))).toBeCloseTo(0.7, 2);
    expect(Math.min(...vs.map((v) => v.y))).toBeCloseTo(0, 3);
  });
});

describe('gate (PLAN section 5)', () => {
  let w: GameWorld;
  let f: Frame;
  beforeAll(() => {
    w = new GameWorld(one('gate', 46, 0, ['bigkid']), 'bigkid');
    w.world.step();
    f = w.obstacles[0]!.frame;
  });

  it('has two posts at +/-1.1 m leaving a 1.4 m opening between the surfaces', () => {
    const y = f.pos.y + 1;
    // Sweep along the right axis through the gate plane from far left.
    const from = new Vector3().copy(f.pos).addScaledVector(f.right, -4);
    from.y = y;
    const first = rayHit(w, from, f.right)!;
    expect(first).toBeCloseTo(4 - 1.1 - 0.4, 3); // left post surface at -1.5
    const mid = new Vector3().copy(f.pos).addScaledVector(f.right, -0.7 + 1e-3);
    mid.y = y;
    const second = rayHit(w, mid, f.right)!;
    expect(second).toBeCloseTo(1.4 - 2e-3, 2); // opening 1.4 m: right post surface at +0.7
  });

  it('banner is visual only: nothing solid above the posts, and it hangs at 6 m', () => {
    // No collider at banner height anywhere across the gate.
    for (const x of [-1.1, 0, 1.1]) {
      const from = new Vector3().copy(f.pos).addScaledVector(f.right, x - 3);
      from.y = f.pos.y + 6.3;
      expect(rayHit(w, from, f.right, 8)).toBeNull();
    }
    const g = buildPostVisual(w.obstacles)!;
    const ys = verts(g).map((v) => v.y - f.pos.y);
    // The banner's lowest vertices are at 6.0 m (strings reach down to the posts at 2.0 m).
    const bannerLow = Math.min(...ys.filter((y) => y > 2.5 && y < 6.5 && y >= 5.99));
    expect(bannerLow).toBeCloseTo(6.0, 3);
    expect(Math.max(...ys)).toBeCloseTo(6.0 + o.gate.bannerDepthM, 3);
  });

  it('both posts are gate colliders (kind gate)', () => {
    const map = (w as unknown as { kindOf: Map<number, string> }).kindOf;
    expect([...map.values()].filter((k) => k === 'gate').length).toBe(4); // 2 posts x (cylinder + skirt)
  });
});

describe('balloon (PLAN section 5)', () => {
  const level = one('balloon', 20, 0.3);

  it('floats 1.2 m above the floor, radius 0.5, thin string down to the floor', () => {
    const w = new GameWorld(level, 'tiny');
    const b = w.balloons[0]!;
    const base = w.obstacles[0]!.base;
    expect(b.centre.clone().sub(base).length()).toBeCloseTo(1.2, 6);
    const g = buildBalloonGeometry();
    const ys = verts(g).map((v) => v.y);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 3);
    expect(Math.min(...ys)).toBeCloseTo(-1.2, 3); // string reaches the floor
    expect(balloonCentre(w.obstacles[0]!).distanceTo(b.centre)).toBeLessThan(1e-9);
  });

  it('has no collider', () => {
    const w = new GameWorld(level, 'tiny');
    w.world.step();
    const c = w.balloons[0]!.centre;
    // Rays aimed at the balloon's surface (1 m out, 0.9 m long) hit nothing; the walls are 2.7 m away.
    for (const dir of [new Vector3(1, 0, 0), new Vector3(0, 0, 1), new Vector3(0.6, 0.8, 0)]) {
      const from = c.clone().addScaledVector(dir, -1);
      const hit = w.world.castRay(new RAPIER.Ray(from, dir), 0.9, true);
      expect(hit).toBeNull();
    }
    // ball + floor + walls + catch plane: no bump / pillar / gate / balloon colliders.
    expect(w.world.colliders.len()).toBe(4);
  });

  it('pops when the ball centre is within 1.1 m, once, and emits one pop event', () => {
    const popAt = (distance: number): GameWorld => {
      const w = new GameWorld(level, 'tiny');
      const c = w.balloons[0]!.centre;
      const f = w.obstacles[0]!.frame;
      // Beside the balloon along the track direction, at the balloon's height: nothing in the
      // way and the ball is at rest.
      w.ball.placeAt(c.clone().addScaledVector(f.tangent, -distance));
      w.step(IDLE);
      return w;
    };
    expect(popAt(1.2).balloons[0]!.popped).toBe(false);
    expect(popAt(1.12).balloons[0]!.popped).toBe(false);
    const w = popAt(1.05);
    expect(w.balloons[0]!.popped).toBe(true);
    expect(w.balloonsPopped).toBe(1);
    const pops = w.drainEvents().filter((e) => e.type === 'pop');
    expect(pops).toHaveLength(1);
    for (let i = 0; i < 20; i++) w.step(IDLE);
    expect(w.drainEvents().filter((e) => e.type === 'pop')).toHaveLength(0);
    expect(w.balloonsPopped).toBe(1);
  });

  it('a ball rolling along the floor at the balloon lane pops it (0.7 m below the centre)', () => {
    const w = new GameWorld(
      { ...level, obstacles: [{ ...level.obstacles[0]!, offset: 0 }] },
      'tiny',
    );
    w.autopilot = true;
    while (w.progress.arcM < 25 && w.state === 'playing') w.step(IDLE);
    expect(w.balloonsPopped).toBe(1);
  });
});

describe('autopilot goes round pillars and through gates', () => {
  it('passes a pillar at the centre-ish lane without touching it', () => {
    // Pillars at +0.9 and -0.9 alternately on the straight, Big kid.
    const level: LevelDef = {
      ...levelTest,
      id: 'pillars',
      obstacles: [
        { atM: 8, offset: 0.9, kind: 'pillar', tiers: ['bigkid'] },
        { atM: 11, offset: -0.9, kind: 'pillar', tiers: ['bigkid'] },
      ],
    };
    const w = new GameWorld(level, 'bigkid');
    w.autopilot = true;
    const contacts: SimEvent[] = [];
    while (w.progress.arcM < 16 && w.state === 'playing') {
      w.step(IDLE);
      contacts.push(...w.drainEvents().filter((e) => e.type === 'contact'));
    }
    expect(contacts).toEqual([]);
    expect(w.respawnCount).toBe(0);
  });

  it('passes through a gate centred on the track without touching a post', () => {
    const w = new GameWorld(one('gate', 8, 0, ['bigkid']), 'bigkid');
    w.autopilot = true;
    const contacts: SimEvent[] = [];
    while (w.progress.arcM < 14 && w.state === 'playing') {
      w.step(IDLE);
      contacts.push(...w.drainEvents().filter((e) => e.type === 'contact'));
    }
    expect(contacts).toEqual([]);
    expect(w.progress.arcM).toBeGreaterThan(13);
  });

  it('the repulsion is what does it: without posts it hits the pillar', () => {
    const w = new GameWorld(one('pillar', 8, 0, ['bigkid']), 'bigkid'); // dead centre
    w.autopilot = true;
    (w as unknown as { posts: unknown[] }).posts.length = 0; // blind autopilot
    const kinds: string[] = [];
    for (let i = 0; i < 6 * 60; i++) {
      w.step(IDLE);
      for (const e of w.drainEvents()) if (e.type === 'contact') kinds.push(e.kind);
    }
    expect(kinds).toContain('pillar');
  });
});

describe('contact events (PLAN sections 6 and 10)', () => {
  /**
   * Tiny, bare track: put the ball 0.1 m from the right wall, moving into it at `speed`. (The lane
   * controller pulls a ball back to the centre hard, so it has to start close to reach the wall.)
   */
  function sideways(speed: number): { w: GameWorld; events: SimEvent[] } {
    const w = new GameWorld({ ...levelTest, obstacles: [] }, 'tiny');
    const events: SimEvent[] = [];
    for (let i = 0; i < 30; i++) w.step({ driving: false, steer: 0 }); // settle on the floor
    const f = w.progress.frame;
    const lane = w.width / 2 - tuning.ball.radius - 0.1;
    w.ball.placeAt(f.pos.clone().addScaledVector(f.right, lane).addScaledVector(f.up, 0.5));
    w.ball.body.setLinvel({ x: f.right.x * speed, y: 0, z: f.right.z * speed }, true);
    for (let i = 0; i < 120; i++) {
      w.step({ driving: false, steer: 0 });
      events.push(...w.drainEvents());
    }
    return { w, events };
  }

  it('a wall hit above the threshold gives exactly one wall event', () => {
    const { events } = sideways(2.5);
    const contacts = events.filter((e) => e.type === 'contact');
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ type: 'contact', kind: 'wall' });
  });

  it('rolling on the floor never produces one, however fast or bumpy', () => {
    const w = new GameWorld({ ...levelTest, obstacles: [] }, 'tiny');
    w.autopilot = true;
    const events: SimEvent[] = [];
    while (w.state === 'playing') {
      w.step(IDLE);
      events.push(...w.drainEvents());
    }
    expect(events.filter((e) => e.type === 'contact')).toEqual([]);
  });

  it('a graze below the impulse threshold is ignored', () => {
    const { events } = sideways(0.15);
    expect(events.filter((e) => e.type === 'contact')).toEqual([]);
  });

  it('bump, pillar and gate contacts carry their kind', () => {
    // bump: autopilot over it
    const bump = new GameWorld(one('bump', 8, 0), 'tiny');
    bump.autopilot = true;
    const kinds = new Set<string>();
    const run = (w: GameWorld, until: number): void => {
      while (w.progress.arcM < until && w.state === 'playing') {
        w.step(IDLE);
        for (const e of w.drainEvents()) if (e.type === 'contact') kinds.add(e.kind);
      }
    };
    run(bump, 14);
    expect(kinds).toEqual(new Set(['bump']));
    // pillar and gate: Big kid held at full right steer / driving straight into a post
    const pillar = new GameWorld(one('pillar', 8, 0.9, ['bigkid']), 'bigkid');
    for (let i = 0; i < 240; i++) {
      pillar.step({ driving: true, steer: 1 });
      for (const e of pillar.drainEvents()) if (e.type === 'contact') kinds.add(e.kind);
    }
    expect(kinds.has('pillar')).toBe(true);
    const gate = new GameWorld(one('gate', 8, 0, ['bigkid']), 'bigkid');
    for (let i = 0; i < 240; i++) {
      gate.step({ driving: true, steer: 1 });
      for (const e of gate.drainEvents()) if (e.type === 'contact') kinds.add(e.kind);
    }
    expect(kinds.has('gate')).toBe(true);
  });
});

describe('ContactFilter (new contacts only, <= 2/s, 1 s refractory per collider)', () => {
  it('ignores the floor', () => {
    const f = new ContactFilter();
    for (let s = 0; s < 100; s += 20) expect(f.offer(1, 'floor', s)).toBe(false);
  });

  it('emits a sustained contact once, not every step', () => {
    const f = new ContactFilter();
    const out: boolean[] = [];
    for (let s = 100; s < 160; s++) out.push(f.offer(7, 'wall', s));
    expect(out.filter(Boolean)).toHaveLength(1);
    expect(out[0]).toBe(true);
  });

  it('treats a contact that resumes after a gap as new, but honours the 1 s refractory', () => {
    const f = new ContactFilter();
    expect(f.offer(7, 'wall', 100)).toBe(true);
    // Released for 20 steps, touches again: new, but within 60 steps of the last emit.
    expect(f.offer(7, 'wall', 120)).toBe(false);
    // Again after the refractory (touch at 170 after a gap, > 60 steps from 100): emitted.
    expect(f.offer(7, 'wall', 170)).toBe(true);
  });

  it('refractory is per collider; the overall cap is 2 per second', () => {
    const f = new ContactFilter();
    expect(f.offer(1, 'wall', 0)).toBe(true);
    expect(f.offer(2, 'pillar', 20)).toBe(true);
    expect(f.offer(3, 'gate', 40)).toBe(false); // third within one second
    expect(f.offer(3, 'gate', 61)).toBe(true); // a new touch once the first has left the 1 s window
    expect(f.offer(1, 'wall', 70)).toBe(false); // collider 1 emitted at 0: refractory over, but cap hit (20, 61)
    expect(f.offer(1, 'wall', 130)).toBe(true);
  });

  it('reads its limits from tuning', () => {
    expect(tuning.contacts).toMatchObject({ maxPerSecond: 2, refractorySeconds: 1 });
    expect(tuning.contacts.impulseThreshold).toBeGreaterThan(0);
  });
});
