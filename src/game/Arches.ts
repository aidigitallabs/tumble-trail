import { Color, Vector3, type BufferGeometry } from 'three';
import { BALL_OUTLINE, palettes, type Palette } from '../config/brand';
import { tuning } from '../config/tuning';
import { MeshBuilder } from './MeshBuilder';
import { frameAtArc, type Frame, type Spline } from './Spline';

const Y = new Vector3(0, 1, 0);

/** Where a checkpoint's flag cloth hangs: the top of the pole on its arch. */
export interface FlagAnchor {
  /** Top of the pole (cloth top edge when raised). */
  poleTop: Vector3;
  /** Horizontal unit vector the cloth extends along (the frame's right). */
  right: Vector3;
}

export interface ArchGeometry {
  /** Posts, beams and flag poles of every checkpoint arch and the finish arch. */
  geometry: BufferGeometry;
  /** One per checkpoint, in order. */
  flags: FlagAnchor[];
}

/**
 * Checkpoint arches (accent posts and beam, a pole on top for the flag) and the finish arch
 * (chequered squares on the posts and beam: a pattern, not only a colour). Visual only: no colliders,
 * and the posts stand outside the walls. The beam's underside is `beamHeightM` above the floor, above
 * the chase camera (about 4.5 m up), so nothing ever clips it.
 */
export function buildArches(
  spline: Pick<Spline, 'frames' | 'ds'>,
  width: number,
  checkpointsM: readonly number[],
  finishM: number,
  palette: Palette = palettes.meadow,
): ArchGeometry {
  const a = tuning.arch;
  const mb = new MeshBuilder();
  const flags: FlagAnchor[] = [];
  const accent = new Color(palette.accent);
  const half = width / 2 + tuning.track.wallThicknessM + a.outsetM + a.postWidthM / 2;

  const axes = (f: Frame): readonly [Vector3, Vector3, Vector3] => [
    f.right,
    Y,
    new Vector3().crossVectors(f.right, Y),
  ];

  const plainArch = (f: Frame, col: Color): void => {
    const ax = axes(f);
    const postTop = a.beamHeightM + a.beamThicknessM;
    for (const side of [-1, 1]) {
      mb.box(
        f.pos
          .clone()
          .addScaledVector(f.right, side * half)
          .addScaledVector(Y, postTop / 2),
        ax,
        [a.postWidthM / 2, postTop / 2, a.beamDepthM / 2],
        col,
      );
    }
    mb.box(
      f.pos.clone().addScaledVector(Y, a.beamHeightM + a.beamThicknessM / 2),
      ax,
      [half + a.postWidthM / 2, a.beamThicknessM / 2, a.beamDepthM / 2],
      col,
    );
  };

  for (const m of checkpointsM) {
    const f = frameAtArc(spline, m);
    plainArch(f, accent);
    const top = f.pos.clone().addScaledVector(Y, a.beamHeightM + a.beamThicknessM + a.poleHeightM);
    mb.box(
      f.pos.clone().addScaledVector(Y, a.beamHeightM + a.beamThicknessM + a.poleHeightM / 2),
      axes(f),
      [a.poleWidthM / 2, a.poleHeightM / 2, a.poleWidthM / 2],
      new Color(BALL_OUTLINE),
    );
    flags.push({ poleTop: top, right: f.right.clone() });
  }

  // Finish arch: chequered posts and beam.
  const f = frameAtArc(spline, finishM);
  const ax = axes(f);
  const dark = new Color(BALL_OUTLINE);
  const light = new Color(0xffffff);
  const sq = a.checkerM;
  const postTop = a.beamHeightM + a.beamThicknessM;
  const rows = Math.ceil(postTop / sq);
  for (const side of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const y0 = r * sq;
      const h = Math.min(sq, postTop - y0);
      mb.box(
        f.pos
          .clone()
          .addScaledVector(f.right, side * half)
          .addScaledVector(Y, y0 + h / 2),
        ax,
        [a.postWidthM / 2, h / 2, a.beamDepthM / 2],
        (r + (side > 0 ? 1 : 0)) % 2 === 0 ? dark : light,
      );
    }
  }
  const beamHalf = half + a.postWidthM / 2;
  const cols = Math.ceil((2 * beamHalf) / sq);
  for (let c = 0; c < cols; c++) {
    const x0 = -beamHalf + c * sq;
    const w = Math.min(sq, beamHalf - x0);
    mb.box(
      f.pos
        .clone()
        .addScaledVector(f.right, x0 + w / 2)
        .addScaledVector(Y, a.beamHeightM + a.beamThicknessM / 2),
      ax,
      [w / 2, a.beamThicknessM / 2, a.beamDepthM / 2],
      c % 2 === 0 ? dark : light,
    );
  }

  return { geometry: mb.toGeometry(), flags };
}

/**
 * The flag cloth: a swallowtail pennant in the XY plane (x along the pole's right, y up), double
 * sided, centred on y = 0 with its left edge on x = 0 (the pole). Colour: the palette accent.
 */
export function buildFlagCloth(palette: Palette = palettes.meadow): BufferGeometry {
  const a = tuning.arch;
  const mb = new MeshBuilder();
  const col = new Color(palette.accent);
  const w = a.clothWidthM;
  const h = a.clothHeightM;
  const A = new Vector3(0, h / 2, 0);
  const B = new Vector3(w, h / 2, 0);
  const C = new Vector3(w * 0.7, 0, 0);
  const D = new Vector3(w, -h / 2, 0);
  const E = new Vector3(0, -h / 2, 0);
  const front = new Vector3(0, 0, 1);
  const back = new Vector3(0, 0, -1);
  for (const n of [front, back]) {
    mb.tri(A, B, C, n, col);
    mb.tri(A, C, E, n, col);
    mb.tri(C, D, E, n, col);
  }
  return mb.toGeometry();
}
