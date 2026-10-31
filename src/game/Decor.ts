import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  SphereGeometry,
  Vector3,
} from 'three';
import { palettes, type Palette } from '../config/brand';
import { tuning } from '../config/tuning';
import { MeshBuilder } from './MeshBuilder';
import { frameAtArc, type Spline } from './Spline';

export type DecorKind = 'tree' | 'cloud' | 'disc';

export interface DecorItem {
  kind: DecorKind;
  pos: Vector3;
  scale: number;
  /** Rotation about the vertical axis, radians. */
  yaw: number;
}

/** 32-bit FNV-1a hash of a string (the PRNG seed comes from the level id). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decor placement (PLAN section 9): `tuning.decor.perMetre` items per metre of track, each 8-16 m
 * from the centreline (measured in plan view to the nearest frame, so a track that curves back
 * never gets decor on top of itself), by a PRNG seeded from the level id. Deterministic.
 */
export function placeDecor(
  levelId: string,
  spline: Pick<Spline, 'frames' | 'ds' | 'totalM'>,
): DecorItem[] {
  const d = tuning.decor;
  const rng = mulberry32(hashSeed(levelId));
  const lerp = (r: readonly number[]): number =>
    (r[0] as number) + rng() * ((r[1] as number) - (r[0] as number));
  const count = Math.round(d.perMetre * spline.totalM);
  const items: DecorItem[] = [];
  // A little inside the limits, so the nearest-frame distance (which overestimates the distance to
  // the polyline between frames) can never put an item outside 8-16 m.
  const lo = d.minDistM + 0.05;
  const hi = d.maxDistM - 0.05;

  for (let n = 0; n < count; n++) {
    const roll = rng();
    const kind: DecorKind =
      roll < d.treeShare ? 'tree' : roll < d.treeShare + d.cloudShare ? 'cloud' : 'disc';
    let placed: DecorItem | null = null;
    for (let attempt = 0; attempt < d.maxTries && !placed; attempt++) {
      const s = rng() * spline.totalM;
      const side = rng() < 0.5 ? -1 : 1;
      const dist = lo + rng() * (hi - lo);
      const f = frameAtArc(spline, s);
      const pos = f.pos.clone().addScaledVector(f.right, side * dist);
      let nearest = Infinity;
      for (const g of spline.frames) {
        nearest = Math.min(nearest, Math.hypot(g.pos.x - pos.x, g.pos.z - pos.z));
      }
      if (nearest < lo || nearest > hi) continue;
      pos.y = kind === 'cloud' ? f.pos.y + lerp(d.cloudHeight) : f.pos.y - d.groundDropM;
      const scale = lerp(
        kind === 'tree' ? d.treeScale : kind === 'cloud' ? d.cloudScale : d.discScale,
      );
      placed = { kind, pos, scale, yaw: rng() * Math.PI * 2 };
    }
    if (placed) items.push(placed);
  }
  return items;
}

/** Unit-sized decor shapes (vertex-coloured): cone-on-cylinder tree, sphere cloud, flat disc. */
export function buildDecorGeometries(
  palette: Palette = palettes.meadow,
): Record<DecorKind, BufferGeometry> {
  const seg = tuning.decor.segments;
  const at = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);

  const tree = new MeshBuilder();
  const trunk = new CylinderGeometry(0.25, 0.3, 1.2, seg);
  const crown = new ConeGeometry(1.2, 2.8, seg);
  tree.addGeometry(trunk, at(0, 0.6, 0), new Color(palette.decorB));
  tree.addGeometry(crown, at(0, 2.6, 0), new Color(palette.decorA));

  const cloud = new MeshBuilder();
  const puffs: Array<[number, number, number, number]> = [
    [0, 0, 0, 1.2],
    [1.3, -0.2, 0.2, 0.9],
    [-1.2, -0.25, -0.1, 0.85],
    [0.2, 0.4, -0.7, 0.8],
  ];
  for (const [x, y, z, r] of puffs) {
    const g = new SphereGeometry(r, seg, Math.max(4, seg - 3));
    cloud.addGeometry(
      g,
      at(x, y, z),
      new Color(palette.decorB).multiplyScalar(tuning.decor.cloudBrightness),
    );
    g.dispose();
  }

  const disc = new MeshBuilder();
  const slab = new CylinderGeometry(1, 1, 0.12, seg + 4);
  disc.addGeometry(slab, at(0, 0.06, 0), new Color(palette.accent));

  trunk.dispose();
  crown.dispose();
  slab.dispose();
  return { tree: tree.toGeometry(), cloud: cloud.toGeometry(), disc: disc.toGeometry() };
}
