import { describe, expect, it } from 'vitest';
import {
  Input,
  startsAtEdge,
  steerFromOffset,
  steerOriginX,
  steerRangePx,
} from '../../src/app/Input';
import { tuning } from '../../src/config/tuning';

const W = 1024;
const H = 768;
const RANGE = steerRangePx(W, H);

function fresh(mode: 'always' | 'hold', decay = 0): Input {
  const i = new Input();
  i.setViewport(W, H);
  i.configure(mode, decay);
  return i;
}

describe('steer geometry (PLAN section 6)', () => {
  it('steerRangePx is 0.22 x the shorter side', () => {
    expect(RANGE).toBeCloseTo(0.22 * 768, 6);
  });

  it('clamps the virtual origin so a full steer is reachable on both sides', () => {
    expect(steerOriginX(5, W, RANGE)).toBe(RANGE);
    expect(steerOriginX(W - 5, W, RANGE)).toBe(W - RANGE);
    expect(steerOriginX(500, W, RANGE)).toBe(500);
  });

  it('has a dead zone, then a linear ramp clamped to +/-1', () => {
    const o = 500;
    expect(steerFromOffset(o + 39, o, RANGE)).toBe(0);
    expect(steerFromOffset(o - 39, o, RANGE)).toBe(0);
    expect(steerFromOffset(o + RANGE / 2, o, RANGE)).toBeCloseTo(0.5, 6);
    expect(steerFromOffset(o - RANGE / 2, o, RANGE)).toBeCloseTo(-0.5, 6);
    expect(steerFromOffset(o + RANGE * 3, o, RANGE)).toBe(1);
    expect(steerFromOffset(o - RANGE * 3, o, RANGE)).toBe(-1);
  });

  it('rejects starts within 40 px of any edge', () => {
    expect(startsAtEdge(39, 300, W, H)).toBe(true);
    expect(startsAtEdge(300, 39, W, H)).toBe(true);
    expect(startsAtEdge(W - 39, 300, W, H)).toBe(true);
    expect(startsAtEdge(300, H - 39, W, H)).toBe(true);
    expect(startsAtEdge(41, 41, W, H)).toBe(false);
  });
});

describe('Input core', () => {
  it('Tiny always drives; the finger only steers', () => {
    const i = fresh('always', 1);
    expect(i.controls).toMatchObject({ driving: true, steer: 0 });
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    expect(i.controls).toMatchObject({ driving: true, steer: 1 });
    i.pointerUp(1);
    expect(i.controls).toMatchObject({ driving: true, steer: 0 });
  });

  it('Big kid drives only while the finger is down', () => {
    const i = fresh('hold');
    expect(i.controls.driving).toBe(false);
    i.pointerDown(1, 500, 400);
    expect(i.controls.driving).toBe(true);
    i.pointerUp(1);
    expect(i.controls.driving).toBe(false);
  });

  it('only the first pointer counts', () => {
    const i = fresh('hold');
    expect(i.pointerDown(1, 300, 400)).toBe(true);
    expect(i.pointerDown(2, 700, 400)).toBe(false);
    i.pointerMove(2, 900, 400); // ignored entirely
    expect(i.controls.steer).toBe(0);
    expect(i.pointerUp(2)).toBe(false);
    expect(i.controls.driving).toBe(true);
    i.pointerUp(1);
    expect(i.pointerDown(2, 700, 400)).toBe(true);
  });

  it('ignores pointers that start at an edge', () => {
    const i = fresh('hold');
    expect(i.pointerDown(1, 10, 400)).toBe(false);
    expect(i.controls.driving).toBe(false);
  });

  it('releases everything on release() (cancel, blur, hidden, resize)', () => {
    const i = fresh('hold');
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    i.release();
    expect(i.controls).toMatchObject({ driving: false, steer: 0 });
    i.pointerMove(1, 100, 400); // the old pointer is no longer ours
    expect(i.controls.steer).toBe(0);
  });

  it('a state change locks input for 500 ms and needs a fresh pointerdown', () => {
    const i = fresh('hold');
    i.pointerDown(1, 500, 400);
    i.lock();
    expect(i.controls.driving).toBe(false);
    expect(i.pointerDown(2, 500, 400)).toBe(false); // during the lockout
    i.update(tuning.input.lockoutMs / 1000 - 0.01);
    expect(i.locked).toBe(true);
    i.update(0.02);
    expect(i.locked).toBe(false);
    // The finger that was already down is not resumed: it needs a fresh pointerdown.
    i.pointerMove(1, 500 + RANGE, 400);
    expect(i.controls.driving).toBe(false);
    expect(i.pointerDown(3, 500, 400)).toBe(true);
    expect(i.controls.driving).toBe(true);
  });

  it('Tiny: a motionless finger decays toward centre after 1 s over steerDecay', () => {
    const i = fresh('always', 1);
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    for (let k = 0; k < 60; k++) i.update(1 / 60); // 1 s still
    expect(i.controls.steer).toBeCloseTo(1, 1);
    for (let k = 0; k < 30; k++) i.update(1 / 60); // 0.5 s into the decay
    expect(i.controls.steer).toBeCloseTo(0.5, 1);
    for (let k = 0; k < 60; k++) i.update(1 / 60);
    expect(i.controls.steer).toBe(0);
    // Moving again restores steering.
    i.pointerMove(1, 500 + RANGE / 2 + 20, 400);
    expect(i.controls.steer).toBeGreaterThan(0.4);
  });

  it('Big kid has no steer decay', () => {
    const i = fresh('hold', 0);
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    for (let k = 0; k < 300; k++) i.update(1 / 60);
    expect(i.controls.steer).toBe(1);
  });

  it('keyboard steer ramps at 4 per second and Space/Up drives in hold mode', () => {
    const i = fresh('hold');
    i.keyChange('ArrowRight', true);
    i.update(0.125);
    expect(i.controls.steer).toBeCloseTo(0.5, 6);
    i.update(0.5);
    expect(i.controls.steer).toBe(1);
    i.keyChange('ArrowRight', false);
    i.keyChange('KeyA', true);
    i.update(0.25);
    expect(i.controls.steer).toBeCloseTo(0, 6);
    i.update(0.5);
    expect(i.controls.steer).toBe(-1);
    expect(i.controls.driving).toBe(false);
    i.keyChange('Space', true);
    expect(i.controls.driving).toBe(true);
  });
});
