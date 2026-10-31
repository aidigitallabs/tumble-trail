import { CatmullRomCurve3, Vector3 } from 'three';
import { tuning } from '../config/tuning';
import type { Vec3 } from '../levels/schema';

/** World up (PLAN section 5). */
export const WORLD_UP: Readonly<Vector3> = new Vector3(0, 1, 0);

/** One sample of the track centreline. All vectors are unit length and mutually orthogonal. */
export interface Frame {
  pos: Vector3;
  /** Direction of travel. */
  tangent: Vector3;
  /** Screen-right for the chase camera: normalize(cross(tangent, worldUp)). Always horizontal. */
  right: Vector3;
  /** cross(right, tangent). */
  up: Vector3;
  /** Arc length from the start, metres. */
  arcM: number;
}

export interface Spline {
  curve: CatmullRomCurve3;
  /** Curve parameter u (0..1) at LUT sample k is k / (lut.length - 1); lut[k] is its arc length. */
  lut: Float64Array;
  /** Arc length at the last control point = the finish line, metres. */
  finishM: number;
  /** Arc length of the last frame (finishM + end pad), metres. */
  totalM: number;
  /** Frame spacing, metres. */
  ds: number;
  /** Frames every ds metres from arc 0 to totalM, including the end pad. */
  frames: Frame[];
}

/** Below this squared length cross(tangent, worldUp) is treated as degenerate (tangent ~ vertical). */
const DEGENERATE_RIGHT_LENGTH_SQ = 1e-6;

/**
 * Right and up vectors for a tangent (PLAN section 5 convention). When the tangent is (anti)parallel
 * to world up the cross product vanishes; `right` then falls back to `prevRight` (the previous
 * frame's right), or world +X when there is none, so frames never contain NaN.
 */
export function makeFrame(
  pos: Vector3,
  tangent: Vector3,
  arcM: number,
  prevRight?: Vector3,
): Frame {
  const t = tangent.clone().normalize();
  const right = new Vector3().crossVectors(t, WORLD_UP);
  if (right.lengthSq() < DEGENERATE_RIGHT_LENGTH_SQ) {
    right.copy(prevRight ?? new Vector3(1, 0, 0));
    // Keep it orthogonal to the tangent (prevRight is horizontal, t is ~vertical, so this is tiny).
    right.addScaledVector(t, -right.dot(t));
  }
  right.normalize();
  const up = new Vector3().crossVectors(right, t).normalize();
  return { pos: pos.clone(), tangent: t, right, up, arcM };
}

/** Curve parameter u for an arc length s (clamped to the control-point curve). */
export function arcToU(spline: Pick<Spline, 'lut' | 'finishM'>, s: number): number {
  const lut = spline.lut;
  const n = lut.length - 1;
  if (s <= 0) return 0;
  if (s >= spline.finishM) return 1;
  // Binary search for the last sample with lut[k] <= s.
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((lut[mid] as number) <= s) lo = mid;
    else hi = mid;
  }
  const a = lut[lo] as number;
  const b = lut[hi] as number;
  const f = b > a ? (s - a) / (b - a) : 0;
  return (lo + f) / n;
}

/** Centreline point at arc length s on the control-point curve (not the end pad). */
export function pointAtArc(spline: Spline, s: number, target = new Vector3()): Vector3 {
  return spline.curve.getPoint(arcToU(spline, s), target);
}

/** Index of the frame nearest to arc length s (clamped). */
export function frameIndexAtArc(spline: Pick<Spline, 'frames' | 'ds'>, s: number): number {
  const i = Math.round(s / spline.ds);
  return Math.min(spline.frames.length - 1, Math.max(0, i));
}

export function buildSpline(points: readonly Vec3[]): Spline {
  if (points.length < 2) throw new Error('A spline needs at least 2 control points');
  const { lutSamples, frameSpacingM: ds, endPadM } = tuning.spline;

  // The tension argument is ignored by three for the 'centripetal' type, so it is not passed.
  const curve = new CatmullRomCurve3(
    points.map(([x, y, z]) => new Vector3(x, y, z)),
    false,
    'centripetal',
  );

  // Arc-length lookup table: cumulative chord length at uniform u. Do not rely on three's default
  // arcLengthDivisions (PLAN section 5).
  const lut = new Float64Array(lutSamples + 1);
  const prev = curve.getPoint(0);
  const cur = new Vector3();
  for (let k = 1; k <= lutSamples; k++) {
    curve.getPoint(k / lutSamples, cur);
    lut[k] = (lut[k - 1] as number) + cur.distanceTo(prev);
    prev.copy(cur);
  }
  const finishM = lut[lutSamples] as number;

  const partial = { lut, finishM };
  const endPos = curve.getPoint(1);
  const endTangent = curve.getTangent(1);
  // The end pad is flat: continue along the horizontal part of the final tangent.
  const padDir = new Vector3(endTangent.x, 0, endTangent.z);
  if (padDir.lengthSq() < 1e-12) padDir.set(0, 0, 1);
  padDir.normalize();

  const count = Math.ceil((finishM + endPadM) / ds) + 1;
  const frames: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    if (s <= finishM) {
      const u = arcToU(partial, s);
      frames.push(makeFrame(curve.getPoint(u), curve.getTangent(u), s, frames.at(-1)?.right));
    } else {
      const pos = endPos.clone().addScaledVector(padDir, s - finishM);
      frames.push(makeFrame(pos, padDir, s, frames.at(-1)?.right));
    }
  }

  const last = frames[frames.length - 1] as Frame;
  return { curve, lut, finishM, totalM: last.arcM, ds, frames };
}

/**
 * Frame at an arbitrary arc length (clamped to the track), interpolated between the two
 * neighbouring frames. Used to place obstacles and arches at `atM` metres.
 */
export function frameAtArc(spline: Pick<Spline, 'frames' | 'ds'>, s: number): Frame {
  const { frames, ds } = spline;
  const last = frames.length - 1;
  const x = Math.min(last, Math.max(0, s / ds));
  const i = Math.min(last - 1, Math.floor(x));
  const f = x - i;
  const a = frames[i] as Frame;
  const b = frames[Math.min(last, i + 1)] as Frame;
  const pos = a.pos.clone().lerp(b.pos, f);
  const tangent = a.tangent.clone().lerp(b.tangent, f);
  return makeFrame(pos, tangent, Math.min(spline.frames[last]!.arcM, s), a.right);
}

/** Slope of a frame in degrees (positive = climbing). */
export function frameSlopeDeg(f: Frame): number {
  return (Math.asin(Math.max(-1, Math.min(1, f.tangent.y))) * 180) / Math.PI;
}

/**
 * Horizontal (plan-view) turning radius at every frame, metres: the heading change between the
 * neighbouring frames over the horizontal distance between them. `Infinity` on a straight.
 * Vertical curvature (crests, ramp feet) does not count: walls are vertical and the ball steers
 * in the plan view.
 */
export function turningRadii(frames: readonly Frame[]): number[] {
  const out: number[] = [];
  const n = frames.length;
  for (let i = 0; i < n; i++) {
    const a = frames[Math.max(0, i - 1)] as Frame;
    const b = frames[Math.min(n - 1, i + 1)] as Frame;
    const ah = Math.hypot(a.tangent.x, a.tangent.z);
    const bh = Math.hypot(b.tangent.x, b.tangent.z);
    if (ah < 1e-9 || bh < 1e-9) {
      out.push(Infinity);
      continue;
    }
    const cos = (a.tangent.x * b.tangent.x + a.tangent.z * b.tangent.z) / (ah * bh);
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    const dist = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    out.push(angle < 1e-9 ? Infinity : dist / angle);
  }
  return out;
}
