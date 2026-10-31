import type { Vec3 } from './schema';

/**
 * A tiny "turtle" for authoring tracks (Phase 3): a plan-view route made of straights and circular
 * arcs, plus a height profile made of smooth ramps. `buildPath` returns plain Catmull-Rom control
 * points, so levels stay readable (`straight(20), arc(150, 13), straight(48)`) and the result is
 * the same `Vec3[]` every other level uses.
 *
 * Plan view: the route starts at the origin heading +Z. A positive `arc` angle turns to the
 * viewer's right (PLAN section 5: right = cross(tangent, up), which is -X when heading +Z).
 */
export type Seg =
  | { kind: 'straight'; lengthM: number }
  | { kind: 'arc'; degrees: number; radiusM: number; easeM: number };

export const straight = (lengthM: number): Seg => ({ kind: 'straight', lengthM });
/**
 * Turn `degrees` (positive = right, negative = left) on a circle of radius `radiusM`. The
 * curvature eases in and out over `easeM` metres at each end (a clothoid-like join), so the
 * spline has no curvature spike where a straight meets a curve. The arc is therefore
 * `easeM` metres longer than `degrees x radius` (see `segLength`); its tightest radius is
 * exactly `radiusM`.
 */
export const arc = (degrees: number, radiusM: number, easeM = 3): Seg => ({
  kind: 'arc',
  degrees,
  radiusM,
  easeM,
});

/** Length of one segment, metres. */
export function segLength(seg: Seg): number {
  return seg.kind === 'straight'
    ? seg.lengthM
    : (Math.abs(seg.degrees) * Math.PI * seg.radiusM) / 180 + seg.easeM;
}

/**
 * A change of height of `riseM` (negative = down) between plan distances `fromM` and `toM`. The
 * slope eases in and out over `easeM` and is constant in between, so the steepest slope is
 * about `riseM / (toM - fromM - easeM)`.
 */
export interface Ramp {
  fromM: number;
  toM: number;
  riseM: number;
  easeM: number;
}

export const ramp = (fromM: number, toM: number, riseM: number, easeM = 3): Ramp => ({
  fromM,
  toM,
  riseM,
  easeM,
});

/** Length of the plan route, metres. */
export function routeLength(segs: readonly Seg[]): number {
  return segs.reduce((n, seg) => n + segLength(seg), 0);
}

/** The route followed by a final straight that makes the whole thing `totalM` metres long. */
export function toLength(totalM: number, segs: readonly Seg[]): Seg[] {
  const rest = totalM - routeLength(segs);
  if (rest < 0)
    throw new Error(`route is ${routeLength(segs).toFixed(1)} m, longer than ${totalM}`);
  return rest > 0 ? [...segs, straight(rest)] : [...segs];
}

/** Height at plan distance `s` for a list of ramps. */
export function heightAt(ramps: readonly Ramp[], s: number): number {
  let y = 0;
  for (const r of ramps) {
    if (s <= r.fromM) continue;
    const len = r.toM - r.fromM;
    const ease = Math.min(r.easeM, len / 2);
    // Slope profile w(x): sin^2 edges of length `ease`, 1 in between; area = len - ease.
    const area = len - ease;
    const x = Math.min(s, r.toM) - r.fromM;
    let cum: number;
    if (x <= ease) {
      // integral of sin^2(pi x / (2 ease)) over [0, x] = x/2 - ease/(2 pi) sin(pi x / ease)
      cum = x / 2 - (ease / (2 * Math.PI)) * Math.sin((Math.PI * x) / ease);
    } else if (x <= len - ease) {
      cum = ease / 2 + (x - ease);
    } else {
      const u = len - x; // distance from the end
      cum = area - (u / 2 - (ease / (2 * Math.PI)) * Math.sin((Math.PI * u) / ease));
    }
    y += (r.riseM * cum) / area;
  }
  return y;
}

/** Dense integration step along the route, metres. */
const FINE_M = 0.02;

/**
 * Control points along the route every `stepM` metres or less (default 2.5; the spline follows a
 * circle better the denser they are; segment ends are always points), with heights from `ramps`
 * (plan distance, so the 3D arc is marginally longer on slopes).
 */
export function buildPath(segs: readonly Seg[], ramps: readonly Ramp[] = [], stepM = 2.5): Vec3[] {
  // Dense plan-view polyline of the whole route, then pick control points off it.
  const xs: number[] = [0];
  const zs: number[] = [0];
  const bounds: number[] = [0]; // index of each segment end in xs / zs
  let theta = 0; // radians, positive = turned to the right
  for (const seg of segs) {
    const n = Math.max(1, Math.round(segLength(seg) / FINE_M));
    const d = segLength(seg) / n;
    const total = seg.kind === 'arc' ? (seg.degrees * Math.PI) / 180 : 0;
    const ease = seg.kind === 'arc' ? seg.easeM : 0;
    const core = seg.kind === 'arc' ? segLength(seg) - ease : 0;
    for (let i = 0; i < n; i++) {
      let kappa = 0; // curvature (1/m, signed) at the middle of this fine step
      if (seg.kind === 'arc') {
        const mid = (i + 0.5) * d;
        const len = segLength(seg);
        const edge = Math.min(mid, len - mid);
        const w = edge >= ease ? 1 : Math.sin((Math.PI * edge) / (2 * ease)) ** 2;
        kappa = (total / core) * w;
      }
      const heading = theta + (kappa * d) / 2;
      xs.push((xs[xs.length - 1] as number) - Math.sin(heading) * d);
      zs.push((zs[zs.length - 1] as number) + Math.cos(heading) * d);
      theta += kappa * d;
    }
    bounds.push(xs.length - 1);
  }

  const pts: Vec3[] = [[0, heightAt(ramps, 0), 0]];
  let segStart = 0; // plan distance at the start of the segment
  for (let k = 1; k < bounds.length; k++) {
    const from = bounds[k - 1] as number;
    const to = bounds[k] as number;
    const len = segLength(segs[k - 1] as Seg);
    const pieces = Math.max(1, Math.ceil(len / stepM));
    for (let j = 1; j <= pieces; j++) {
      const idx = from + Math.round(((to - from) * j) / pieces);
      const s = segStart + (len * (idx - from)) / (to - from);
      pts.push([xs[idx] as number, heightAt(ramps, s), zs[idx] as number]);
    }
    segStart += len;
  }
  return pts;
}
