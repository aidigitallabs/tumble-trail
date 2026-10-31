import { describe, expect, it } from 'vitest';
import { pickPixelRatio, tuning } from '../../src/config/tuning';

describe('pixel ratio rule', () => {
  it('caps touch devices at 1.25 and desktops at 2', () => {
    expect(pickPixelRatio(2, true)).toBe(tuning.pixelRatioCapTouch);
    expect(pickPixelRatio(3, false)).toBe(tuning.pixelRatioCapDesktop);
  });

  it('never raises the device pixel ratio', () => {
    expect(pickPixelRatio(1, true)).toBe(1);
    expect(pickPixelRatio(1, false)).toBe(1);
  });
});
