import { describe, expect, it } from 'vitest';
import {
  BALL_OUTLINE,
  BRAND_NAME,
  ballCharacters,
  contrastRatio,
  palettes,
  relativeLuminance,
} from '../../src/config/brand';

describe('contrast helpers', () => {
  it('match the WCAG definition', () => {
    expect(relativeLuminance(0xffffff)).toBeCloseTo(1, 6);
    expect(relativeLuminance(0x000000)).toBe(0);
    expect(contrastRatio(0xffffff, 0x000000)).toBeCloseTo(21, 6);
    expect(contrastRatio(0x777777, 0x777777)).toBeCloseTo(1, 6);
    expect(contrastRatio(0xffffff, 0x767676)).toBeGreaterThan(4.5); // well-known AA grey
  });
});

describe('brand', () => {
  it('has the name, 3 palettes and 3 ball characters', () => {
    expect(BRAND_NAME).toBe('Tumble Trail');
    expect(Object.keys(palettes).sort()).toEqual(['beach', 'meadow', 'sky']);
    expect(ballCharacters).toHaveLength(3);
  });

  it('palettes have every key as a 24-bit colour', () => {
    for (const p of Object.values(palettes)) {
      expect(Object.keys(p).sort()).toEqual(
        ['accent', 'decorA', 'decorB', 'fog', 'sky', 'track', 'trackStripe', 'wall'].sort(),
      );
      for (const c of Object.values(p)) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it('every ball main colour has contrast >= 3:1 against every palette track, trackStripe and sky', () => {
    for (const ball of ballCharacters) {
      for (const [name, p] of Object.entries(palettes)) {
        for (const key of ['track', 'trackStripe', 'sky'] as const) {
          const ratio = contrastRatio(ball.main, p[key]);
          expect(ratio, `${ball.id} vs ${name}.${key}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('every ball has a dark outline and a quarter colour that contrasts with its main colour', () => {
    for (const ball of ballCharacters) {
      expect(ball.outline).toBe(BALL_OUTLINE);
      expect(relativeLuminance(ball.outline)).toBeLessThan(0.05);
      expect(contrastRatio(ball.main, ball.quarter)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the three balls have clearly different hues (at least 60 degrees apart)', () => {
    const hue = (hex: number): number => {
      const r = ((hex >> 16) & 255) / 255;
      const g = ((hex >> 8) & 255) / 255;
      const b = (hex & 255) / 255;
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      let h = 0;
      if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
      }
      return (h * 60 + 360) % 360;
    };
    for (let i = 0; i < ballCharacters.length; i++) {
      for (let j = i + 1; j < ballCharacters.length; j++) {
        const diff = Math.abs(hue(ballCharacters[i]!.main) - hue(ballCharacters[j]!.main));
        expect(Math.min(diff, 360 - diff)).toBeGreaterThanOrEqual(60);
      }
    }
  });
});
