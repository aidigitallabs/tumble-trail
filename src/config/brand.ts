/** Name, palettes and ball characters (PLAN section 9). Colours are 0xRRGGBB (sRGB). */

export const BRAND_NAME = 'Tumble Trail';

export type PaletteId = 'meadow' | 'beach' | 'sky';

export interface Palette {
  sky: number;
  fog: number;
  track: number;
  trackStripe: number;
  wall: number;
  accent: number;
  decorA: number;
  decorB: number;
}

/** Flat pastel palettes. Track, stripe and sky stay light so the darker balls always stand out. */
export const palettes: Record<PaletteId, Palette> = {
  meadow: {
    sky: 0xbfe6ff,
    fog: 0xbfe6ff,
    track: 0xf3ead2,
    trackStripe: 0xffe08a,
    wall: 0x9bd1a4,
    accent: 0xff8fab,
    decorA: 0x7bc67b,
    decorB: 0xffffff,
  },
  beach: {
    sky: 0xcdeefc,
    fog: 0xcdeefc,
    track: 0xf6dfa8,
    trackStripe: 0xfff6e0,
    wall: 0x7fd6cc,
    accent: 0xff8a73,
    decorA: 0xffb74d,
    decorB: 0x7be3d6,
  },
  sky: {
    sky: 0xd9ccff,
    fog: 0xd9ccff,
    track: 0xfdf3ff,
    trackStripe: 0xffc6e0,
    wall: 0xaed9ff,
    accent: 0xffb347,
    decorA: 0xffffff,
    decorB: 0xffd6e8,
  },
};

export interface BallCharacter {
  id: 'ruby' | 'indigo' | 'clover';
  /** Main colour, tested for contrast against every palette. */
  main: number;
  /** Colour of the two opposite quarters. */
  quarter: number;
  /** Dark outline / rim colour shared by every ball. */
  outline: number;
}

/** Dark outline colour used on every ball so rotation reads on any palette. */
export const BALL_OUTLINE = 0x2a2438;

/** Red/white, blue/yellow, green/white. Luminance differs a little so they also read in greyscale. */
export const ballCharacters: readonly [BallCharacter, BallCharacter, BallCharacter] = [
  { id: 'ruby', main: 0xc62828, quarter: 0xffffff, outline: BALL_OUTLINE },
  { id: 'indigo', main: 0x1d5fbf, quarter: 0xffd23f, outline: BALL_OUTLINE },
  { id: 'clover', main: 0x1b7f4b, quarter: 0xffffff, outline: BALL_OUTLINE },
];

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(hex: number): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((hex >> 16) & 0xff);
  const g = channel((hex >> 8) & 0xff);
  const b = channel(hex & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21) between two sRGB hex colours. */
export function contrastRatio(a: number, b: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
