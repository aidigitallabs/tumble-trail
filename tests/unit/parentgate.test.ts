import { describe, expect, it } from 'vitest';
import { ParentGate } from '../../src/app/ParentGate';
import { tuning } from '../../src/config/tuning';

const W = 1024;
const H = 768;

function gate(): ParentGate {
  const g = new ParentGate();
  g.setViewport(W, H);
  return g;
}

/** Hold both corners and tick `seconds` in 1/60 s frames; returns when it fired (seconds) or null. */
function holdBoth(g: ParentGate, seconds: number): number | null {
  g.pointerDown(1, 10, 10);
  g.pointerDown(2, W - 10, H - 10);
  const dt = 1 / 60;
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    if (g.update(dt)) return t;
  }
  return null;
}

describe('ParentGate', () => {
  it('fires after the configured hold with both corners down', () => {
    const t = holdBoth(gate(), tuning.ui.gateHoldSeconds + 0.1);
    expect(t).not.toBeNull();
    expect(t as number).toBeGreaterThanOrEqual(tuning.ui.gateHoldSeconds - 0.02);
    expect(t as number).toBeLessThan(tuning.ui.gateHoldSeconds + 0.05);
  });

  it('is 3 s and 120 px, as in the plan', () => {
    expect(tuning.ui.gateHoldSeconds).toBe(3);
    expect(tuning.ui.gateCornerRadiusPx).toBe(120);
  });

  it('does not fire a moment early', () => {
    expect(holdBoth(gate(), tuning.ui.gateHoldSeconds - 0.2)).toBeNull();
  });

  it('one corner alone never fires, however long', () => {
    for (const [x, y] of [
      [5, 5],
      [W - 5, H - 5],
    ] as const) {
      const g = gate();
      expect(g.pointerDown(1, x, y)).toBe(true);
      for (let i = 0; i < 60 * 10; i++) expect(g.update(1 / 60)).toBe(false);
    }
  });

  it('the two other corners do not count', () => {
    const g = gate();
    expect(g.pointerDown(1, W - 10, 10)).toBe(false);
    expect(g.pointerDown(2, 10, H - 10)).toBe(false);
    for (let i = 0; i < 60 * 5; i++) expect(g.update(1 / 60)).toBe(false);
  });

  it('two pointers in the same corner do not count as both corners', () => {
    const g = gate();
    g.pointerDown(1, 10, 10);
    g.pointerDown(2, 30, 30);
    expect(g.bothHeld).toBe(false);
  });

  it('only pointers that start within 120 px of the corner belong to the gate', () => {
    const g = gate();
    expect(g.pointerDown(1, 119, 0)).toBe(true);
    expect(g.pointerDown(2, 121, 0)).toBe(false);
    expect(g.pointerDown(3, 100, 100)).toBe(false); // 141 px away diagonally
    expect(g.pointerDown(4, 80, 80)).toBe(true); // 113 px
    expect(g.pointerDown(5, W - 119, H)).toBe(true);
    expect(g.pointerDown(6, W - 121, H)).toBe(false);
  });

  it('a pointer that wanders out of its corner breaks the hold and resets the ring', () => {
    const g = gate();
    g.pointerDown(1, 10, 10);
    g.pointerDown(2, W - 10, H - 10);
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    expect(g.progress).toBeGreaterThan(0.3);
    g.pointerMove(1, 400, 400);
    g.update(1 / 60);
    expect(g.progress).toBe(0);
    // Coming back does not rejoin: a fresh pointerdown is needed.
    g.pointerMove(1, 10, 10);
    for (let i = 0; i < 60 * 5; i++) expect(g.update(1 / 60)).toBe(false);
  });

  it('lifting either finger restarts the hold from zero', () => {
    const g = gate();
    g.pointerDown(1, 10, 10);
    g.pointerDown(2, W - 10, H - 10);
    for (let i = 0; i < 60 * 2; i++) g.update(1 / 60);
    g.pointerUp(2);
    g.update(1 / 60);
    expect(g.progress).toBe(0);
    g.pointerDown(3, W - 10, H - 10);
    // 2 more seconds is not enough: the first 2 s were thrown away.
    for (let i = 0; i < 60 * 2; i++) expect(g.update(1 / 60)).toBe(false);
  });

  it('the ring fills with the hold and resets after firing', () => {
    const g = gate();
    g.pointerDown(1, 10, 10);
    g.pointerDown(2, W - 10, H - 10);
    for (let i = 0; i < 90; i++) g.update(1 / 60);
    expect(g.progress).toBeCloseTo(0.5, 1);
    expect(g.heldCorners.sort()).toEqual(['br', 'tl']);
    for (let i = 0; i < 100; i++) g.update(1 / 60);
    expect(g.progress).toBe(0);
    expect(g.heldCorners).toEqual([]);
  });

  it('after firing it needs fresh pointerdowns (still-held fingers do not retrigger it)', () => {
    const g = gate();
    expect(holdBoth(g, 3.2)).not.toBeNull();
    for (let i = 0; i < 60 * 5; i++) expect(g.update(1 / 60)).toBe(false);
  });

  it('a resize drops any hold in progress', () => {
    const g = gate();
    g.pointerDown(1, 10, 10);
    g.pointerDown(2, W - 10, H - 10);
    g.setViewport(H, W);
    expect(g.bothHeld).toBe(false);
  });
});
