import RAPIER from '@dimforge/rapier3d-compat';
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
import type { LevelDef, Tier } from '../levels/schema';
import { MeshBuilder } from './MeshBuilder';
import { frameAtArc, type Frame, type Spline } from './Spline';
import { trimeshDesc } from './Track';

export type ObstacleKind = LevelDef['obstacles'][number]['kind'];

/** One obstacle of a level, tier-filtered and placed on the spline. */
export interface PlacedObstacle {
  kind: ObstacleKind;
  /** Arc-length position, metres. */
  atM: number;
  /** Lateral offset from the centreline, metres (+ = viewer's right). */
  offset: number;
  /** Track frame at `atM`. */
  frame: Frame;
  /** The floor point at the obstacle's lateral offset: `frame.pos + right * offset`. */
  base: Vector3;
}

/** A fixed post (pillar, or one side of a gate) in track coordinates, for the autopilot. */
export interface Post {
  arcM: number;
  /** Lateral offset of the post's centre, metres (+ = viewer's right). */
  lateral: number;
  radiusM: number;
}

/**
 * The obstacles of `level` that apply to `tier`, each placed on the spline at `atM` with its
 * lateral `offset` along the frame's `right` (PLAN section 5).
 */
export function placeObstacles(
  level: Pick<LevelDef, 'obstacles'>,
  tier: Tier,
  spline: Pick<Spline, 'frames' | 'ds'>,
): PlacedObstacle[] {
  return level.obstacles
    .filter((o) => o.tiers.includes(tier))
    .map((o) => {
      const frame = frameAtArc(spline, o.atM);
      return {
        kind: o.kind,
        atM: o.atM,
        offset: o.offset,
        frame,
        base: frame.pos.clone().addScaledVector(frame.right, o.offset),
      };
    });
}

/** Floor positions of every post: one per pillar, two per gate (offset +/- `gate.halfSpanM`). */
export function postBases(placed: readonly PlacedObstacle[]): Vector3[] {
  const out: Vector3[] = [];
  for (const o of placed) {
    if (o.kind === 'pillar') out.push(o.base.clone());
    if (o.kind === 'gate') {
      for (const side of [-1, 1]) {
        out.push(
          o.frame.pos
            .clone()
            .addScaledVector(o.frame.right, o.offset + side * tuning.obstacles.gate.halfSpanM),
        );
      }
    }
  }
  return out;
}

/** The pillar and gate posts in track coordinates (what the autopilot steers around). */
export function postsOf(placed: readonly PlacedObstacle[]): Post[] {
  const r = tuning.obstacles.pillar.radiusM;
  const out: Post[] = [];
  for (const o of placed) {
    if (o.kind === 'pillar') out.push({ arcM: o.atM, lateral: o.offset, radiusM: r });
    if (o.kind === 'gate') {
      for (const side of [-1, 1]) {
        out.push({
          arcM: o.atM,
          lateral: o.offset + side * tuning.obstacles.gate.halfSpanM,
          radiusM: r,
        });
      }
    }
  }
  return out;
}

/** Centre of a balloon: `floatM` above the floor point, along the frame's up. */
export function balloonCentre(o: PlacedObstacle): Vector3 {
  return o.base.clone().addScaledVector(o.frame.up, tuning.obstacles.balloon.floatM);
}

function shade(hex: number, factor: number): Color {
  return new Color(hex).multiplyScalar(factor);
}

// ---- bump -----------------------------------------------------------------------------------

/**
 * Sinusoidal ridges for every bump (PLAN section 5): `height` 0.2 m, 1.2 m along the track,
 * `width / 3` across, centred at the bump's offset. Height is sin^2 along the track (zero slope at
 * both ends) and eases down over `edgeTaperM` at the lateral ends, so the ball never meets a step.
 * The base sits `sinkM` below the floor; the peak is exactly `heightM` above it. This one geometry
 * is both the visual and (same vertices) the trimesh collider.
 */
export function buildBumpGeometry(
  bumps: readonly PlacedObstacle[],
  width: number,
  palette: Palette = palettes.meadow,
): BufferGeometry {
  const b = tuning.obstacles.bump;
  const mb = new MeshBuilder();
  const col = new Color(palette.accent);
  const span = width * b.spanFraction;
  const L = b.lengthM;
  const up = new Vector3();
  for (const o of bumps) {
    if (o.kind !== 'bump') continue;
    const f = o.frame;
    up.copy(f.up);
    const grid: Vector3[][] = [];
    for (let i = 0; i <= b.segmentsAlong; i++) {
      const row: Vector3[] = [];
      const u = -L / 2 + (L * i) / b.segmentsAlong;
      const hu = Math.sin((Math.PI * (u + L / 2)) / L) ** 2;
      for (let j = 0; j <= b.segmentsAcross; j++) {
        const v = -span / 2 + (span * j) / b.segmentsAcross;
        const edge = Math.min(v + span / 2, span / 2 - v);
        const hv = edge >= b.edgeTaperM ? 1 : Math.sin((Math.PI / 2) * (edge / b.edgeTaperM)) ** 2;
        const h = -b.sinkM + (b.heightM + b.sinkM) * hu * hv;
        row.push(
          f.pos
            .clone()
            .addScaledVector(f.tangent, u)
            .addScaledVector(f.right, o.offset + v)
            .addScaledVector(up, h),
        );
      }
      grid.push(row);
    }
    for (let i = 0; i < b.segmentsAlong; i++) {
      for (let j = 0; j < b.segmentsAcross; j++) {
        const g = grid as Vector3[][];
        mb.quad(g[i]![j]!, g[i]![j + 1]!, g[i + 1]![j + 1]!, g[i + 1]![j]!, f.up, col);
      }
    }
  }
  return mb.toGeometry();
}

// ---- pillar / gate (visual) -----------------------------------------------------------------

const Y = new Vector3(0, 1, 0);

/** Pillar: cylinder r 0.4 m, h 2.0 m, plus a cone skirt reaching 0.3 m out from its base. */
function addPillarVisual(mb: MeshBuilder, base: Vector3, palette: Palette): void {
  const p = tuning.obstacles.pillar;
  const post = new CylinderGeometry(p.radiusM, p.radiusM, p.heightM, p.segments);
  mb.addGeometry(
    post,
    new Matrix4().makeTranslation(base.x, base.y + p.heightM / 2, base.z),
    new Color(palette.accent),
  );
  const skirt = new ConeGeometry(p.radiusM + p.skirtReachM, p.skirtHeightM, p.segments);
  mb.addGeometry(
    skirt,
    new Matrix4().makeTranslation(base.x, base.y + p.skirtHeightM / 2, base.z),
    shade(palette.accent, 0.78),
  );
  post.dispose();
  skirt.dispose();
}

/** Gate banner (visual only): striped board at `bannerHeightM`, tied to the post tops by strings. */
function addGateBanner(mb: MeshBuilder, o: PlacedObstacle, palette: Palette): void {
  const g = tuning.obstacles.gate;
  const p = tuning.obstacles.pillar;
  const f = o.frame;
  const halfWidth = g.halfSpanM + p.radiusM + g.bannerOverhangM;
  const stripes = 6;
  const stripeW = (2 * halfWidth) / stripes;
  const axes = [f.right, Y, new Vector3().crossVectors(f.right, Y)] as const;
  const centre = f.pos.clone().addScaledVector(f.right, o.offset);
  for (let k = 0; k < stripes; k++) {
    const x = -halfWidth + stripeW * (k + 0.5);
    const c = centre
      .clone()
      .addScaledVector(f.right, x)
      .addScaledVector(Y, g.bannerHeightM + g.bannerDepthM / 2);
    // Alternating stripes: a pattern, not just a colour.
    mb.box(
      c,
      axes,
      [stripeW / 2, g.bannerDepthM / 2, g.stringHalfWidthM],
      k % 2 === 0 ? new Color(palette.accent) : new Color(0xffffff),
    );
  }
  const stringCol = new Color(0x5a5470);
  for (const side of [-1, 1]) {
    const top = g.bannerHeightM;
    const bottom = p.heightM;
    const c = centre
      .clone()
      .addScaledVector(f.right, side * g.halfSpanM)
      .addScaledVector(Y, (top + bottom) / 2);
    mb.box(c, axes, [g.stringHalfWidthM, (top - bottom) / 2, g.stringHalfWidthM], stringCol);
  }
}

/** Visual geometry for every pillar and gate (posts, skirts, banners). Null when there are none. */
export function buildPostVisual(
  placed: readonly PlacedObstacle[],
  palette: Palette = palettes.meadow,
): BufferGeometry | null {
  const mb = new MeshBuilder();
  for (const o of placed) {
    if (o.kind === 'pillar') addPillarVisual(mb, o.base, palette);
    if (o.kind === 'gate') {
      for (const side of [-1, 1]) {
        addPillarVisual(
          mb,
          o.frame.pos
            .clone()
            .addScaledVector(o.frame.right, o.offset + side * tuning.obstacles.gate.halfSpanM),
          palette,
        );
      }
      addGateBanner(mb, o, palette);
    }
  }
  return mb.triangles > 0 ? mb.toGeometry() : null;
}

// ---- balloon (visual) -----------------------------------------------------------------------

/**
 * One balloon centred on the origin: a sphere of radius 0.5 and a thin string hanging down to the
 * floor point (`floatM` below the centre). Vertex colours are white (balloon) and grey (string),
 * so a per-instance colour tints the whole thing.
 */
export function buildBalloonGeometry(): BufferGeometry {
  const b = tuning.obstacles.balloon;
  const mb = new MeshBuilder();
  const ball = new SphereGeometry(b.radiusM, b.segments, Math.max(4, b.segments - 2));
  mb.addGeometry(ball, new Matrix4(), new Color(0xffffff));
  ball.dispose();
  const length = b.floatM - b.radiusM;
  mb.box(
    new Vector3(0, -b.radiusM - length / 2, 0),
    [new Vector3(1, 0, 0), Y, new Vector3(0, 0, 1)],
    [b.stringHalfWidthM, length / 2, b.stringHalfWidthM],
    new Color(0x8a8499),
  );
  return mb.toGeometry();
}

/** Balloon body colours (instance tints). Fixed list, cycled by balloon index. */
export const balloonColors: readonly number[] = [0xff6f91, 0xffc83d, 0x7a8cff, 0x45c9a0];

// ---- colliders ------------------------------------------------------------------------------

/** What a collider is, for the contact-event filter. */
export type ColliderKind = 'wall' | 'pillar' | 'gate' | 'bump' | 'floor';

export interface KindedCollider {
  collider: RAPIER.Collider;
  kind: ColliderKind;
}

/**
 * Fixed colliders for the solid obstacles (balloons have none; they are a distance check):
 * - one trimesh for all bumps, from the same vertices as the visual (`bumpGeometry`);
 * - per pillar and per gate post a `roundCylinder` whose rounded shape is exactly r 0.4 m, h 2.0 m
 *   (the core is `borderM` smaller on every side), plus a cone for the 0.3 m skirt.
 * The gate banner has no collider.
 */
export function buildObstacleColliders(
  world: RAPIER.World,
  placed: readonly PlacedObstacle[],
  bumpGeometry: BufferGeometry | null,
): KindedCollider[] {
  const out: KindedCollider[] = [];
  const p = tuning.obstacles.pillar;
  const material = (d: RAPIER.ColliderDesc): RAPIER.ColliderDesc =>
    d.setFriction(tuning.track.wallFriction).setRestitution(tuning.track.wallRestitution);

  if (bumpGeometry) {
    const desc = trimeshDesc(bumpGeometry);
    if (desc) {
      out.push({
        collider: world.createCollider(
          desc
            .setFriction(tuning.track.floorFriction)
            .setRestitution(tuning.track.floorRestitution),
        ),
        kind: 'bump',
      });
    }
  }

  const addPost = (base: Vector3, kind: 'pillar' | 'gate'): void => {
    out.push({
      collider: world.createCollider(
        material(
          RAPIER.ColliderDesc.roundCylinder(
            p.heightM / 2 - p.borderM,
            p.radiusM - p.borderM,
            p.borderM,
          ).setTranslation(base.x, base.y + p.heightM / 2, base.z),
        ),
      ),
      kind,
    });
    out.push({
      collider: world.createCollider(
        material(
          RAPIER.ColliderDesc.cone(p.skirtHeightM / 2, p.radiusM + p.skirtReachM).setTranslation(
            base.x,
            base.y + p.skirtHeightM / 2,
            base.z,
          ),
        ),
      ),
      kind,
    });
  };

  for (const o of placed) {
    if (o.kind === 'pillar') addPost(o.base, 'pillar');
    if (o.kind === 'gate') {
      for (const side of [-1, 1]) {
        addPost(
          o.frame.pos
            .clone()
            .addScaledVector(o.frame.right, o.offset + side * tuning.obstacles.gate.halfSpanM),
          'gate',
        );
      }
    }
  }
  return out;
}
