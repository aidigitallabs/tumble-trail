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

describe('per-tier tuning table (PLAN section 6)', () => {
  it('matches the plan', () => {
    expect(tuning.tiers.tiny).toMatchObject({
      width: 6.0,
      driveMode: 'always',
      drive: 8,
      maxSpeed: 4.0,
      maxLateral: 2.5,
      laneGain: 2.0,
      steerGain: 3,
      laneMargin: 0.6,
      steerDecay: 1.0,
      brakeDamping: 2.5,
      fallDepth: 6,
      cameraBack: 7,
      cameraUp: 4,
      cameraLookAhead: 4,
      cameraSmoothing: 5,
    });
    expect(tuning.tiers.bigkid).toMatchObject({
      width: 3.5,
      driveMode: 'hold',
      drive: 10,
      maxSpeed: 5.5,
      maxLateral: 4.0,
      laneGain: 3.0,
      steerGain: 4,
      laneMargin: 0.3,
      steerDecay: 0,
      brakeDamping: 2.5,
      fallDepth: 6,
      cameraBack: 7,
      cameraUp: 4,
      cameraLookAhead: 5,
      cameraSmoothing: 6,
    });
    expect(tuning.bigkidLevelSeconds).toEqual([12, 60]);
  });

  it('keeps the spline LUT at 2000+ samples and frames 0.5 m apart', () => {
    expect(tuning.spline.lutSamples).toBeGreaterThanOrEqual(2000);
    expect(tuning.spline.frameSpacingM).toBe(0.5);
    expect(tuning.spline.endPadM).toBe(6);
  });

  it('terminal speeds quoted in the tuning comments hold', () => {
    const v = (t: 'tiny' | 'bigkid'): number =>
      tuning.tiers[t].drive /
      (tuning.ball.drivingDamping + tuning.tiers[t].drive / tuning.tiers[t].maxSpeed);
    expect(v('tiny')).toBeCloseTo(3.64, 2);
    expect(v('bigkid')).toBeCloseTo(4.955, 2);
  });
});
