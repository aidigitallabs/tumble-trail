import RAPIER from '@dimforge/rapier3d-compat';
import { BufferGeometry, Color, Vector3 } from 'three';
import { palettes } from '../config/brand';
import { tuning } from '../config/tuning';
import { MeshBuilder } from './MeshBuilder';
import type { Frame } from './Spline';

/** Wall mode for a ribbon (PLAN section 5). 'none' is only meant for Big kid straights. */
export type WallMode = 'full' | 'low' | 'none';

export interface RibbonColors {
  track: number;
  stripe: number;
  wall: number;
  /** Start pad colour. Default: the stripe colour. */
  pad?: number;
}

export interface RibbonOptions {
  /**
   * Arc length of the finish line. When given, frames beyond it form the end pad: side walls and
   * a back wall are always built there, and side walls are omitted for the
   * `tuning.track.noWallBeforeFinishM` metres before it. When omitted there is no end pad.
   */
  finishM?: number;
  /** Vertex colours. Default: the meadow palette. */
  colors?: RibbonColors;
  /**
   * Radius of the start pad: a flat disc centred on frame 0, lying in frame 0's plane. The half in
   * front of the start line coincides with the track floor, so only the half behind it is built.
   * Omit for no pad.
   */
  startPadRadiusM?: number;
}

export interface RibbonGeometry {
  floor: BufferGeometry;
  walls: BufferGeometry;
}

/** Wall height in metres for a mode ('none' has no wall). */
export function wallHeight(mode: WallMode): number {
  if (mode === 'full') return tuning.track.fullWallHeightM;
  if (mode === 'low') return tuning.track.lowWallHeightM;
  return 0;
}

const UP = new Vector3(0, 1, 0);

/** Floor: three strips (left, centre stripe, right), centre stripe dashed along the track. */
function buildFloor(
  frames: readonly Frame[],
  width: number,
  colors: RibbonColors,
  startPadRadiusM: number,
): BufferGeometry {
  const mb = new MeshBuilder();
  const trackCol = new Color(colors.track);
  const stripeCol = new Color(colors.stripe);
  const hw = width / 2;
  const sw = Math.min(tuning.track.stripeWidthM, width) / 2;
  const edges = [-hw, -sw, sw, hw];
  const period = tuning.track.stripeDashM + tuning.track.stripeGapM;

  const p = (f: Frame, x: number): Vector3 => f.pos.clone().addScaledVector(f.right, x);

  for (let i = 0; i + 1 < frames.length; i++) {
    const a = frames[i] as Frame;
    const b = frames[i + 1] as Frame;
    const stripeOn = ((a.arcM + b.arcM) / 2) % period < tuning.track.stripeDashM;
    for (let j = 0; j < 3; j++) {
      const x0 = edges[j] as number;
      const x1 = edges[j + 1] as number;
      const col = j === 1 && stripeOn ? stripeCol : trackCol;
      mb.quad(p(a, x0), p(a, x1), p(b, x1), p(b, x0), UP, col);
    }
  }

  // Start pad: the half of the disc behind frame 0, as a fan from the frame's centre.
  const first = frames[0];
  if (first && startPadRadiusM > 0) {
    const padCol = new Color(colors.pad ?? colors.stripe);
    const n = tuning.track.startPadSegments;
    const rim = (k: number): Vector3 => {
      const phi = -Math.PI / 2 + (k * Math.PI) / n;
      return first.pos
        .clone()
        .addScaledVector(first.right, startPadRadiusM * Math.sin(phi))
        .addScaledVector(first.tangent, -startPadRadiusM * Math.cos(phi));
    };
    for (let k = 0; k < n; k++) mb.tri(first.pos, rim(k), rim(k + 1), first.up, padCol);
  }
  return mb.toGeometry();
}

interface WallSegment {
  /** Wall height for this segment, 0 = no wall. */
  height: number;
}

/** Side walls plus, when `finishM` is set, the end pad's back wall. */
function buildWalls(
  frames: readonly Frame[],
  width: number,
  mode: WallMode,
  noWallSpansM: ReadonlyArray<readonly [number, number]>,
  options: RibbonOptions,
  colors: RibbonColors,
): BufferGeometry {
  const mb = new MeshBuilder();
  const col = new Color(colors.wall);
  const { finishM } = options;
  const thick = tuning.track.wallThicknessM;
  const hw = width / 2;
  const padHeight = wallHeight(mode === 'none' ? 'low' : mode);

  // Wall height per segment (segment i runs from frame i to frame i + 1).
  const segs: WallSegment[] = [];
  for (let i = 0; i + 1 < frames.length; i++) {
    const mid = ((frames[i] as Frame).arcM + (frames[i + 1] as Frame).arcM) / 2;
    let height = wallHeight(mode);
    if (finishM !== undefined && mid >= finishM) {
      height = padHeight;
    } else {
      if (finishM !== undefined && mid >= finishM - tuning.track.noWallBeforeFinishM) height = 0;
      for (const [lo, hi] of noWallSpansM) {
        if (mid >= lo && mid <= hi) height = 0;
      }
    }
    segs.push({ height });
  }

  const up = (h: number): Vector3 => new Vector3(0, h, 0);

  for (const side of [-1, 1]) {
    const inner = (f: Frame): Vector3 => f.pos.clone().addScaledVector(f.right, side * hw);
    const outer = (f: Frame): Vector3 =>
      f.pos.clone().addScaledVector(f.right, side * (hw + thick));

    for (let i = 0; i < segs.length; i++) {
      const h = (segs[i] as WallSegment).height;
      if (h <= 0) continue;
      const a = frames[i] as Frame;
      const b = frames[i + 1] as Frame;
      const ia = inner(a);
      const ib = inner(b);
      const oa = outer(a);
      const ob = outer(b);
      const iaTop = ia.clone().add(up(h));
      const ibTop = ib.clone().add(up(h));
      const oaTop = oa.clone().add(up(h));
      const obTop = ob.clone().add(up(h));
      const toCentre = a.right.clone().multiplyScalar(-side);
      const away = a.right.clone().multiplyScalar(side);

      mb.quad(ia, ib, ibTop, iaTop, toCentre, col); // inner face
      mb.quad(oa, ob, obTop, oaTop, away, col); // outer face
      mb.quad(iaTop, ibTop, obTop, oaTop, UP, col); // top

      const prevH = i > 0 ? (segs[i - 1] as WallSegment).height : 0;
      const nextH = i + 1 < segs.length ? (segs[i + 1] as WallSegment).height : 0;
      if (prevH !== h) mb.quad(ia, oa, oaTop, iaTop, a.tangent.clone().negate(), col); // start cap
      if (nextH !== h) mb.quad(ib, ob, obTop, ibTop, b.tangent, col); // end cap
    }
  }

  // Back wall across the end of the pad.
  if (finishM !== undefined && frames.length > 0 && padHeight > 0) {
    const f = frames[frames.length - 1] as Frame;
    const across = hw + thick;
    const t = f.tangent;
    const r = f.right;
    const h = up(padHeight);
    const b00 = f.pos.clone().addScaledVector(r, -across);
    const b10 = f.pos.clone().addScaledVector(r, across);
    const b01 = b00.clone().addScaledVector(t, thick);
    const b11 = b10.clone().addScaledVector(t, thick);
    const t00 = b00.clone().add(h);
    const t10 = b10.clone().add(h);
    const t01 = b01.clone().add(h);
    const t11 = b11.clone().add(h);
    mb.quad(b00, b10, t10, t00, t.clone().negate(), col); // face toward the track
    mb.quad(b01, b11, t11, t01, t, col); // face away from the track
    mb.quad(t00, t10, t11, t01, UP, col); // top
    mb.quad(b00, b01, t01, t00, r.clone().negate(), col); // left end
    mb.quad(b10, b11, t11, t10, r, col); // right end
  }

  return mb.toGeometry();
}

/**
 * Pure ribbon geometry for a track (PLAN section 5): no Rapier, no scene.
 *
 * - `floor`: width wide, wound counter-clockwise seen from above (normals up), with a dashed
 *   centre stripe in the vertex colours.
 * - `walls`: vertical prisms outside the playable width (inner face, outer face, top and end
 *   caps, every triangle facing out of the wall's solid). Height from `wallMode`; none within
 *   `noWallSpansM` (arc-length ranges, applied whatever the mode, so callers pass `[]` for Tiny);
 *   none for the last `tuning.track.noWallBeforeFinishM` metres before `options.finishM`; the end
 *   pad beyond it always has side walls (low if the mode is 'none') and a back wall.
 *
 * Both geometries are non-indexed with flat normals and a `color` attribute.
 */
export function buildRibbonGeometry(
  frames: readonly Frame[],
  width: number,
  wallMode: WallMode,
  noWallSpansM: ReadonlyArray<readonly [number, number]> = [],
  options: RibbonOptions = {},
): RibbonGeometry {
  const colors = options.colors ?? {
    track: palettes.meadow.track,
    stripe: palettes.meadow.trackStripe,
    wall: palettes.meadow.wall,
  };
  return {
    floor: buildFloor(frames, width, colors, options.startPadRadiusM ?? 0),
    walls: buildWalls(frames, width, wallMode, noWallSpansM, options, colors),
  };
}

export interface TrackColliders {
  floor: RAPIER.Collider;
  /** Null when the wall geometry has no triangles (wall mode 'none' without an end pad). */
  walls: RAPIER.Collider | null;
  catchPlane: RAPIER.Collider;
  /** World Y of the top surface of the catch plane (10 m below the lowest frame). */
  catchY: number;
}

/** Number of triangles in a non-indexed triangle soup. */
export function triangleCount(geometry: BufferGeometry): number {
  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

/**
 * A fixed trimesh collider description from a non-indexed triangle soup (indices are simply
 * 0..n-1), or null when there is no triangle: Rapier panics on an empty index buffer.
 */
export function trimeshDesc(geometry: BufferGeometry): RAPIER.ColliderDesc | null {
  if (triangleCount(geometry) === 0) return null;
  const position = geometry.getAttribute('position');
  const vertices = new Float32Array(position.array as ArrayLike<number>);
  const indices = new Uint32Array(position.count);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
}

/**
 * Fixed colliders for a track (PLAN section 5): one trimesh for the floor (friction 0.8) and one
 * for the walls (friction 0, restitution 0.3), both with `FIX_INTERNAL_EDGES`, plus a large flat
 * catch plane `tuning.respawn.catchPlaneDepthM` below the lowest floor vertex as a last resort.
 *
 * The geometries are non-indexed (vertices are merged by Rapier's flag). The floor's lowest
 * vertex is the lowest frame, because every floor strip is horizontal across the track.
 */
export function buildColliders(world: RAPIER.World, geoms: RibbonGeometry): TrackColliders {
  const floorDesc = trimeshDesc(geoms.floor);
  if (!floorDesc) throw new Error('The track floor has no triangles (needs at least 2 frames)');
  const floor = world.createCollider(
    floorDesc.setFriction(tuning.track.floorFriction).setRestitution(tuning.track.floorRestitution),
  );
  const wallDesc = trimeshDesc(geoms.walls);
  const walls = wallDesc
    ? world.createCollider(
        wallDesc
          .setFriction(tuning.track.wallFriction)
          .setRestitution(tuning.track.wallRestitution),
      )
    : null;

  geoms.floor.computeBoundingBox();
  const box = geoms.floor.boundingBox as NonNullable<BufferGeometry['boundingBox']>;
  const catchY = box.min.y - tuning.respawn.catchPlaneDepthM;
  const m = tuning.physics.catchPlaneMarginM;
  const halfX = (box.max.x - box.min.x) / 2 + m;
  const halfZ = (box.max.z - box.min.z) / 2 + m;
  const thickness = 0.5;
  const catchPlane = world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, thickness / 2, halfZ)
      .setTranslation(
        (box.max.x + box.min.x) / 2,
        catchY - thickness / 2,
        (box.max.z + box.min.z) / 2,
      )
      .setFriction(tuning.track.floorFriction),
  );
  return { floor, walls, catchPlane, catchY };
}
