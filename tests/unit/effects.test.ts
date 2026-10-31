import RAPIER from '@dimforge/rapier3d-compat';
import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { palettes } from '../../src/config/brand';
import { tuning } from '../../src/config/tuning';
import { ReducedMotion, reducedMotionFromWindow } from '../../src/app/motion';
import { FollowCamera } from '../../src/game/Camera';
import {
  Effects,
  LandingSquash,
  ParticleSystem,
  confettiCount,
  glowOpacity,
  lifeScale,
  squashScale,
  type ParticleSpawn,
} from '../../src/game/Effects';
import { GameWorld } from '../../src/game/GameWorld';
import { buildSpline } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import { straightPoints } from './fixtures';

const base: ParticleSpawn = {
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  color: 0xff0000,
  lifeS: 1,
  size: 0.2,
  aspect: 1,
  spin: 0,
  spinRate: 0,
  ax: 0,
  ay: 1,
  az: 0,
  kind: 0,
  gravity: 0,
  drag: 0,
};

const e = tuning.effects;
const origin = new Vector3(0, 1, 5);
const ball = new Vector3(0, 0.5, 5);
const camera = new PerspectiveCamera();

/** Step an Effects forward in 1/60 s frames; returns the peak particle count. */
function run(fx: Effects, seconds: number): number {
  let peak = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    fx.update(1 / 60, camera, ball);
    peak = Math.max(peak, fx.activeCount);
  }
  return peak;
}

describe('ParticleSystem', () => {
  it('spawns up to its capacity and counts what it had to drop', () => {
    const ps = new ParticleSystem(3);
    expect([1, 2, 3, 4].map(() => ps.spawn(base))).toEqual([true, true, true, false]);
    expect(ps.count).toBe(3);
    expect(ps.dropped).toBe(1);
  });

  it('integrates gravity, drag and spin, and removes the dead keeping the survivors intact', () => {
    const ps = new ParticleSystem(8);
    ps.spawn({ ...base, lifeS: 0.1, x: 1 });
    ps.spawn({ ...base, lifeS: 1, x: 2, vx: 2, gravity: -10, spinRate: 3 });
    ps.spawn({ ...base, lifeS: 1, x: 3, color: 0x00ff00 });
    ps.update(0.5);
    expect(ps.count).toBe(2);
    // The last particle was moved into slot 0; the other survived in slot 1.
    expect(ps.pos[0]).toBeCloseTo(3, 6);
    expect(ps.pos[3]).toBeCloseTo(3, 6); // x = 2 + 2 * 0.5
    expect(ps.pos[4]).toBeCloseTo(-2.5, 4); // one 0.5 s step: vy = -5, y = -5 * 0.5
    expect(ps.spin[1]).toBeCloseTo(1.5, 6);
    expect(ps.col[1]).toBeGreaterThan(0.9); // green moved with its particle
  });

  it('drag slows a particle', () => {
    const ps = new ParticleSystem(2);
    ps.spawn({ ...base, vx: 4, drag: 2 });
    ps.update(0.5);
    expect(ps.vel[0]).toBeCloseTo(4 * Math.exp(-1), 5);
  });

  it('frees everything once every life has run out', () => {
    const ps = new ParticleSystem(50);
    for (let i = 0; i < 50; i++) ps.spawn({ ...base, lifeS: 0.2 + i * 0.01 });
    ps.update(1);
    expect(ps.count).toBe(0);
  });
});

describe('particle counts (PLAN section 16)', () => {
  it('confetti is at most 300 quads and zero under reduced motion', () => {
    expect(confettiCount(false, false)).toBe(e.confettiCount);
    expect(confettiCount(true, false)).toBe(e.finalConfettiCount);
    expect(confettiCount(false, false)).toBeLessThanOrEqual(300);
    expect(confettiCount(true, false)).toBeLessThanOrEqual(300);
    expect(confettiCount(true, true)).toBe(0);
    expect(confettiCount(false, true)).toBe(0);
  });

  it('a pop burst is 6 to 12 quads and the pool fits the biggest celebration plus extras', () => {
    expect(e.popBurstCount).toBeGreaterThanOrEqual(6);
    expect(e.popBurstCount).toBeLessThanOrEqual(12);
    expect(e.maxQuads).toBeGreaterThanOrEqual(
      e.finalConfettiCount + 2 * e.popBurstCount + e.sparkleCount,
    );
  });

  it('celebrate releases exactly the configured number, in waves', () => {
    for (const final of [false, true]) {
      const fx = new Effects();
      fx.celebrate(origin, final);
      expect(fx.activeCount).toBe(0); // nothing until the render step runs
      fx.update(0, camera, ball);
      expect(fx.activeCount).toBe(Math.floor(confettiCount(final, false) / e.confettiWaves));
      fx.update(e.confettiWaveS * e.confettiWaves, camera, ball);
      expect(fx.activeCount).toBe(confettiCount(final, false));
      expect(fx.particles.dropped).toBe(0);
      fx.dispose();
    }
  });

  it('confetti is deterministic and ends: the pool empties by itself', () => {
    const a = new Effects();
    const b = new Effects();
    a.celebrate(origin, false);
    b.celebrate(origin, false);
    run(a, 1);
    run(b, 1);
    expect(Array.from(a.particles.pos.subarray(0, 30))).toEqual(
      Array.from(b.particles.pos.subarray(0, 30)),
    );
    const longest = e.confettiLifeS[1] + e.confettiWaveS * e.confettiWaves;
    run(a, longest + 0.5);
    expect(a.activeCount).toBe(0);
  });

  it('reduced motion: no confetti at all, but pops and sparkles still work', () => {
    const fx = new Effects();
    fx.setReducedMotion(true);
    expect(fx.isReducedMotion).toBe(true);
    fx.celebrate(origin, true);
    run(fx, 1);
    expect(fx.activeCount).toBe(0);
    fx.popBurst(origin, 0);
    fx.sparkle(origin);
    expect(fx.activeCount).toBe(e.popBurstCount + e.sparkleCount);
  });

  it('pop burst and sparkle spawn their configured counts', () => {
    const fx = new Effects();
    fx.setPalette(palettes.beach);
    fx.popBurst(origin, 1);
    expect(fx.activeCount).toBe(e.popBurstCount);
    fx.sparkle(origin);
    expect(fx.activeCount).toBe(e.popBurstCount + e.sparkleCount);
    for (let i = 0; i < fx.activeCount; i++) {
      expect(Math.abs((fx.particles.pos[i * 3 + 2] as number) - origin.z)).toBeLessThan(2);
    }
  });

  it('never exceeds the pool and keeps the instanced mesh in step with it', () => {
    const fx = new Effects(40);
    fx.celebrate(origin, true);
    for (let i = 0; i < 5; i++) fx.popBurst(origin, i);
    run(fx, 1);
    expect(fx.activeCount).toBeLessThanOrEqual(40);
    const mesh = fx.group.children[0] as unknown as { count: number; visible: boolean };
    expect(mesh.count).toBe(fx.activeCount);
    expect(mesh.visible).toBe(fx.activeCount > 0);
    fx.reset();
    expect(fx.activeCount).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('is one instanced mesh plus one glow plane', () => {
    const fx = new Effects();
    expect(fx.group.children).toHaveLength(2);
  });
});

describe('scale envelopes', () => {
  it('grows in, holds, shrinks away', () => {
    expect(lifeScale(0, 1)).toBe(0);
    expect(lifeScale(e.growS, 1)).toBe(1);
    expect(lifeScale(0.5, 1)).toBe(1);
    expect(lifeScale(1 - e.fadeS / 2, 1)).toBeCloseTo(0.5, 6);
    expect(lifeScale(1, 1)).toBe(0);
  });

  it('the glow rises then fades and is gone afterwards', () => {
    const g = e.glow;
    expect(glowOpacity(0)).toBe(0);
    expect(glowOpacity(g.riseS)).toBeCloseTo(g.peak, 9);
    expect(glowOpacity(g.riseS + g.fallS / 2)).toBeCloseTo(g.peak / 2, 9);
    expect(glowOpacity(g.riseS + g.fallS)).toBe(0);
    expect(glowOpacity(Infinity)).toBe(0);
    expect(g.peak).toBeLessThan(1); // soft, never a full-screen flash
  });

  it('respawn starts a ball-local glow that is gone after its length', () => {
    const fx = new Effects();
    const glow = fx.group.children[1];
    fx.update(0.01, camera, ball);
    expect(glow?.visible).toBe(false);
    fx.respawn();
    fx.update(e.glow.riseS, camera, ball);
    expect(glow?.visible).toBe(true);
    expect(glow?.position.toArray()).toEqual(ball.toArray());
    expect(glow?.scale.x).toBe(e.glow.sizeM);
    fx.update(e.glow.fallS + 0.1, camera, ball);
    expect(glow?.visible).toBe(false);
  });
});

describe('landing squash (PLAN section 16)', () => {
  it('is 1.15 / 0.85 on impact and relaxes to 1 over 120 ms', () => {
    const out = new Vector3();
    expect(squashScale(0, out).toArray()).toEqual([1.15, 0.85, 1.15]);
    expect(squashScale(0.06, out).x).toBeCloseTo(1.075, 6);
    expect(squashScale(0.12, out).toArray()).toEqual([1, 1, 1]);
    expect(squashScale(5, out).toArray()).toEqual([1, 1, 1]);
    expect(squashScale(Infinity, out).toArray()).toEqual([1, 1, 1]);
    expect(e.squash.seconds).toBeCloseTo(0.12, 9);
  });

  it('fires on a hard downward speed that stops, not on a ramp or a soft touch', () => {
    const l = new LandingSquash();
    const out = new Vector3();
    // Rolling on the floor (or down a ramp: no velocity along the track's up).
    for (let i = 0; i < 10; i++) expect(l.sample(0)).toBe(false);
    expect(l.update(0.016, out).toArray()).toEqual([1, 1, 1]);
    // A soft touch.
    l.sample(-1);
    expect(l.sample(0)).toBe(false);
    // A real landing: falling at 3 m/s, then the sign flips.
    l.sample(-3);
    expect(l.sample(0.4)).toBe(true);
    expect(l.update(0, out).toArray()).toEqual([1.15, 0.85, 1.15]);
    expect(l.update(0.03, out).y).toBeGreaterThan(0.85);
    l.update(0.2, out);
    expect(out.toArray()).toEqual([1, 1, 1]);
    // Landing without a bounce (velocity merely stops) counts too; only once.
    l.sample(-4);
    expect(l.sample(-0.1)).toBe(true);
    expect(l.sample(-0.1)).toBe(false);
  });

  it('reset forgets a pending landing', () => {
    const l = new LandingSquash();
    const out = new Vector3();
    l.sample(-3);
    l.sample(0);
    l.reset();
    expect(l.update(0, out).toArray()).toEqual([1, 1, 1]);
    expect(l.sample(0)).toBe(false);
  });
});

describe('Ball.squash is a render-only world-axis scale that keeps the floor contact', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('leaves the plain transform alone and squashes only the drawn matrix', () => {
    const w = new GameWorld(levelTest, 'tiny');
    const b = w.ball;
    b.applyRender(1);
    expect(b.group.matrixAutoUpdate).toBe(true);
    const p = b.group.position.clone();

    b.squash.set(1.15, 0.85, 1.15);
    b.applyRender(1);
    expect(b.group.matrixAutoUpdate).toBe(false);
    expect(b.group.position.toArray()).toEqual(p.toArray());
    // The drawn centre drops so the squashed bottom (centre - 0.85 r) is where the round one was.
    const r = tuning.ball.radius;
    expect((b.group.matrix.elements[13] as number) - r * 0.85).toBeCloseTo(p.y - r, 6);
    expect(b.group.matrix.elements[0] as number).toBeGreaterThan(1.1);

    b.squash.set(1, 1, 1);
    b.applyRender(1);
    expect(b.group.matrixAutoUpdate).toBe(true);
    w.dispose();
  });
});

describe('reduced motion flag (PLAN sections 7 and 16)', () => {
  it('reads the query now and follows changes', () => {
    let handler: ((ev: { matches: boolean }) => void) | null = null;
    const query = {
      matches: true,
      addEventListener: (_: 'change', fn: (ev: { matches: boolean }) => void) => {
        handler = fn;
      },
    };
    const m = new ReducedMotion(query);
    expect(m.value).toBe(true);
    const seen: boolean[] = [];
    m.subscribe((on) => seen.push(on));
    (handler as unknown as (ev: { matches: boolean }) => void)({ matches: false });
    expect(m.value).toBe(false);
    expect(seen).toEqual([false]);
  });

  it('is "no preference" without matchMedia', () => {
    expect(new ReducedMotion(null).value).toBe(false);
    expect(new ReducedMotion(undefined).value).toBe(false);
    expect(reducedMotionFromWindow({} as Window).value).toBe(false);
    const win = { matchMedia: () => ({ matches: true, addEventListener: () => undefined }) };
    expect(reducedMotionFromWindow(win as unknown as Window).value).toBe(true);
  });

  it('the follow camera smooths twice as fast when reduced', () => {
    expect(tuning.camera.reducedMotionSmoothing).toBe(2);
    const spline = buildSpline(levelTest.points);
    const tier = tuning.tiers.tiny;
    const i0 = Math.round(16 / tuning.spline.frameSpacingM);
    const i1 = Math.round(26 / tuning.spline.frameSpacingM);
    const heading = (reduced: boolean): number => {
      const cam = new FollowCamera(tier);
      cam.setReducedMotion(reduced);
      const f0 = spline.frames[i0];
      const f1 = spline.frames[i1];
      if (!f0 || !f1) throw new Error('frames');
      cam.snap(f0.pos, spline.frames, i0);
      const before = cam.camera.getWorldDirection(new Vector3());
      cam.update(1 / 30, f1.pos, spline.frames, i1);
      return before.angleTo(cam.camera.getWorldDirection(new Vector3()));
    };
    // Reduced motion lets the heading follow the bend sooner (rate x2), not later.
    expect(heading(true)).toBeGreaterThan(heading(false));
    // Straight track: nothing to ease, so the camera does not move at all.
    const straight = buildSpline(straightPoints);
    const cam = new FollowCamera(tier);
    cam.snap(new Vector3(0, 0.5, 10), straight.frames, 20);
    const p = cam.camera.position.clone();
    cam.update(0.5, new Vector3(0, 0.5, 10), straight.frames, 20);
    expect(cam.camera.position.distanceTo(p)).toBeLessThan(1e-9);
  });
});
