// Renders the app icon (a quartered ball on a pastel sky) to PNGs with sharp.
// Run once with `npm run icons`; the PNGs in public/icons/ are committed. Not part of CI.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const SKY = '#bfe6ff';
const GROUND = '#8fd694';
const RED = '#e5484d';
const WHITE = '#ffffff';
const RIM = '#2b2d42';

/** `scale` is the ball diameter as a fraction of the canvas. Maskable icons keep it inside 80%. */
function svg(size, scale, rounded) {
  const r = (size * scale) / 2;
  const cx = size / 2;
  const cy = size / 2 - size * 0.03;
  const stroke = Math.max(2, size * 0.035);
  const corner = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="ball"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <clipPath id="tile"><rect width="${size}" height="${size}" rx="${corner}"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="${size}" height="${size}" fill="${SKY}"/>
    <rect y="${size * 0.74}" width="${size}" height="${size * 0.26}" fill="${GROUND}"/>
    <ellipse cx="${cx}" cy="${cy + r + size * 0.03}" rx="${r * 0.85}" ry="${size * 0.035}" fill="${RIM}" opacity="0.18"/>
    <g clip-path="url(#ball)">
      <rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" fill="${WHITE}"/>
      <rect x="${cx - r}" y="${cy - r}" width="${r}" height="${r}" fill="${RED}"/>
      <rect x="${cx}" y="${cy}" width="${r}" height="${r}" fill="${RED}"/>
    </g>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${RIM}" stroke-width="${stroke}"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'icon-192.png', size: 192, scale: 0.58, rounded: false },
  { file: 'icon-512.png', size: 512, scale: 0.58, rounded: false },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.46, rounded: false },
  // iOS applies its own corner mask, so the apple-touch-icon is a full-bleed square.
  { file: 'apple-touch-icon-180.png', size: 180, scale: 0.58, rounded: false },
];

await mkdir(outDir, { recursive: true });
for (const t of targets) {
  await sharp(Buffer.from(svg(t.size, t.scale, t.rounded)))
    .png()
    .toFile(join(outDir, t.file));
  console.log('wrote', t.file);
}
