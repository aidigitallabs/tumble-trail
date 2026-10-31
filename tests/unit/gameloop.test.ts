import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../src/app/GameLoop';
import { tuning } from '../../src/config/tuning';

const STEP = 1 / tuning.physicsHz;

describe('GameLoop accumulator', () => {
  it('runs one step per 1/60 s and reports the interpolation alpha', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);
    expect(loop.advance(STEP * 0.5)).toEqual({ steps: 0, alpha: expect.closeTo(0.5, 6) });
    const r = loop.advance(STEP * 1.25);
    expect(r.steps).toBe(1);
    expect(r.alpha).toBeCloseTo(0.75, 6);
    expect(steps).toBe(1);
  });

  it('caps at maxSubSteps and drops the backlog', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);
    const r = loop.advance(1);
    expect(r.steps).toBe(tuning.maxSubSteps);
    expect(steps).toBe(tuning.maxSubSteps);
    // Backlog dropped: the next tiny frame does not run a burst.
    expect(loop.advance(STEP * 0.1).steps).toBe(0);
  });

  it('a 120 Hz display steps physics every other frame', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);
    for (let i = 0; i < 120; i++) loop.advance(1 / 120);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });

  it('ignores negative time and resets', () => {
    let steps = 0;
    const loop = new GameLoop(() => steps++);
    loop.advance(-1);
    loop.advance(STEP * 0.9);
    loop.reset();
    expect(loop.advance(STEP * 0.5).steps).toBe(0);
    expect(steps).toBe(0);
  });
});
