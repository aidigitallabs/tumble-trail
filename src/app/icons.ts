import type { BallCharacter, PaletteId } from '../config/brand';

/** Inline SVG icons (no external assets, PLAN section 15.3). All use `currentColor` unless noted. */

const svg = (viewBox: string, body: string): string =>
  `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${body}</svg>`;

const stroke =
  'stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';

export const icons = {
  play: svg('0 0 64 64', `<path d="M22 12 L53 32 L22 52 Z" fill="currentColor" ${stroke} />`),
  grid: svg(
    '0 0 64 64',
    `<rect x="9" y="9" width="19" height="19" rx="5" fill="currentColor"/>
     <rect x="36" y="9" width="19" height="19" rx="5" fill="currentColor"/>
     <rect x="9" y="36" width="19" height="19" rx="5" fill="currentColor"/>
     <rect x="36" y="36" width="19" height="19" rx="5" fill="currentColor"/>`,
  ),
  back: svg('0 0 64 64', `<path d="M40 12 L18 32 L40 52 M20 32 H54" fill="none" ${stroke} />`),
  home: svg(
    '0 0 64 64',
    `<path d="M10 31 L32 11 L54 31 M17 27 V52 H47 V27" fill="none" ${stroke} />`,
  ),
  star: svg(
    '0 0 64 64',
    `<path d="M32 6 L40 24 L59 26 L45 39 L49 58 L32 48 L15 58 L19 39 L5 26 L24 24 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>`,
  ),
  lock: svg(
    '0 0 64 64',
    `<rect x="14" y="28" width="36" height="26" rx="6" fill="currentColor"/>
     <path d="M22 28 V20 A10 10 0 0 1 42 20 V28" fill="none" ${stroke} />`,
  ),
  speakerOn: svg(
    '0 0 64 64',
    `<path d="M10 25 H22 L36 13 V51 L22 39 H10 Z" fill="currentColor"/>
     <path d="M44 22 Q52 32 44 42 M50 14 Q64 32 50 50" fill="none" ${stroke} />`,
  ),
  speakerOff: svg(
    '0 0 64 64',
    `<path d="M10 25 H22 L36 13 V51 L22 39 H10 Z" fill="currentColor"/>
     <path d="M46 24 L60 40 M60 24 L46 40" fill="none" ${stroke} />`,
  ),
  leaf: svg(
    '0 0 64 64',
    `<path d="M12 52 C10 24 28 10 54 10 C54 38 40 54 12 52 Z" fill="currentColor"/>
     <path d="M12 52 L38 26" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>`,
  ),
  reset: svg(
    '0 0 64 64',
    `<path d="M50 32 A18 18 0 1 1 44 18.5" fill="none" ${stroke} />
     <path d="M52 8 V22 H38" fill="none" ${stroke} />`,
  ),
  info: svg(
    '0 0 64 64',
    `<circle cx="32" cy="32" r="24" fill="none" ${stroke} />
     <path d="M32 29 V45" fill="none" ${stroke} /><circle cx="32" cy="19" r="3.5" fill="currentColor"/>`,
  ),
  check: svg('0 0 64 64', `<path d="M13 34 L27 48 L52 16" fill="none" ${stroke} />`),
  /** A friendly mitten-like hand for the idle hint (fill is set by CSS). */
  hand: svg(
    '0 0 64 64',
    `<path d="M24 56 C14 48 12 38 16 33 C19 30 23 33 25 37 L25 15 C25 10 33 10 33 15 L33 28 C33 23 41 23 41 28 C41 25 49 25 49 31 C49 29 55 29 55 35 L55 44 C55 51 49 56 42 56 Z" fill="currentColor" stroke="#2a2438" stroke-width="3" stroke-linejoin="round"/>`,
  ),
};

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** A ball character as a flat quartered circle with a dark rim (the title's 160 px buttons). */
export function ballIcon(c: BallCharacter): string {
  return svg(
    '0 0 100 100',
    `<circle cx="50" cy="50" r="44" fill="${hex(c.quarter)}"/>
     <path d="M50 50 L50 6 A44 44 0 0 1 94 50 Z" fill="${hex(c.main)}"/>
     <path d="M50 50 L50 94 A44 44 0 0 1 6 50 Z" fill="${hex(c.main)}"/>
     <circle cx="50" cy="50" r="44" fill="none" stroke="${hex(c.outline)}" stroke-width="7"/>`,
  );
}

/** A simple glyph per palette for the level tiles (no text needed). */
export function paletteGlyph(id: PaletteId): string {
  switch (id) {
    case 'meadow':
      return svg(
        '0 0 64 64',
        `<circle cx="32" cy="26" r="9" fill="#ffd23f"/>
         <circle cx="32" cy="10" r="7" fill="#fff"/><circle cx="48" cy="26" r="7" fill="#fff"/>
         <circle cx="32" cy="42" r="7" fill="#fff"/><circle cx="16" cy="26" r="7" fill="#fff"/>
         <path d="M32 44 V58" fill="none" stroke="#2f7d4f" stroke-width="5" stroke-linecap="round"/>`,
      );
    case 'beach':
      return svg(
        '0 0 64 64',
        `<path d="M6 40 Q16 28 26 40 T46 40 T62 38" fill="none" stroke="#1d7fa8" stroke-width="7" stroke-linecap="round"/>
         <path d="M6 54 Q16 42 26 54 T46 54 T62 52" fill="none" stroke="#1d7fa8" stroke-width="7" stroke-linecap="round"/>
         <circle cx="48" cy="16" r="8" fill="#ffb74d"/>`,
      );
    case 'sky':
      return svg(
        '0 0 64 64',
        `<path d="M18 46 A11 11 0 0 1 20 24 A15 15 0 0 1 48 28 A9.5 9.5 0 0 1 48 46 Z" fill="#fff" stroke="#8a78c8" stroke-width="4" stroke-linejoin="round"/>`,
      );
    default:
      return '';
  }
}
