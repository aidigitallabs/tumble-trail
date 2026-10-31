import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { Progress } from '../../src/game/Progress';
import { buildSpline, frameIndexAtArc, type Frame, type Spline } from '../../src/game/Spline';
import { levelTest } from '../../src/levels/levelTest';
import { hairpinPoints, straightPoints } from './fixtures';

/** A ball position `lateral` metres to the viewer's right of the centreline at arc `s`, and `h` above it. */
function ballAt(spline: Spline, s: number, lateral = 0, h = 0.5): Vector3 {
  const f = spline.frames[frameIndexAtArc(spline, s)] as Frame;
  return f.pos.clone().addScaledVector(f.right, lateral).addScaledVector(f.up, h);
}

describe('Progress on a straight', () => {
  const spline = buildSpline(straightPoints);

  it('t tracks the arc position and is monotone', () => {
    const p = new Progress(spline.frames, spline.finishM);
    let prev = 0;
    for (let s = 0; s <= spline.finishM; s += 0.1) {
      p.update(ballAt(spline, s));
      expect(p.t).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(p.t - s)).toBeLessThan(0.3);
      prev = p.t;
    }
  });

  it("lateralOffset is positive toward the viewer's right (tangent +Z: right = -X)", () => {
    const p = new Progress(spline.frames, spline.finishM);
    p.update(new Vector3(-1, 0, 10));
    expect(p.lateralOffset).toBeCloseTo(1, 6);
    p.update(new Vector3(1.5, 0, 10));
    expect(p.lateralOffset).toBeCloseTo(-1.5, 6);
    p.update(ballAt(spline, 10, 0.8));
    expect(p.lateralOffset).toBeCloseTo(0.8, 6);
    p.update(ballAt(spline, 10, -0.8));
    expect(p.lateralOffset).toBeCloseTo(-0.8, 6);
  });

  it('passes checkpoints by the high-water mark, once each, in order', () => {
    const p = new Progress(spline.frames, spline.finishM, [10, 20, 30]);
    const seen: number[] = [];
    for (let s = 0; s <= 35; s += 0.25) seen.push(...p.update(ballAt(spline, s)).checkpoints);
    expect(seen).toEqual([0, 1, 2]);
    expect(p.checkpointsPassed).toBe(3);
    // Rolling back and forward again never re-fires anything.
    for (let s = 35; s >= 5; s -= 0.25) expect(p.update(ballAt(spline, s)).checkpoints).toEqual([]);
    for (let s = 5; s <= 35; s += 0.25) expect(p.update(ballAt(spline, s)).checkpoints).toEqual([]);
  });

  it('a checkpoint is not passed before t reaches it', () => {
    const p = new Progress(spline.frames, spline.finishM, [20]);
    p.update(ballAt(spline, 19));
    expect(p.checkpointsPassed).toBe(0);
    p.update(ballAt(spline, 20.5));
    expect(p.checkpointsPassed).toBe(1);
  });

  it('detects the finish once, at finishM', () => {
    const p = new Progress(spline.frames, spline.finishM);
    let finishes = 0;
    let finishedAt = -1;
    for (let s = 0; s <= spline.totalM; s += 0.25) {
      const ev = p.update(ballAt(spline, s));
      if (ev.finished) {
        finishes++;
        finishedAt = s;
      }
    }
    expect(finishes).toBe(1);
    expect(p.finished).toBe(true);
    expect(finishedAt).toBeGreaterThanOrEqual(spline.finishM - 0.6);
    expect(finishedAt).toBeLessThanOrEqual(spline.finishM + 0.6);
  });

  it('is not finished before the line', () => {
    const p = new Progress(spline.frames, spline.finishM);
    p.update(ballAt(spline, spline.finishM - 2));
    expect(p.finished).toBe(false);
  });
});

describe('Progress on a ramp (levelTest) with roll-back', () => {
  const spline = buildSpline(levelTest.points);

  it('t never decreases when the ball rolls back down the ramp', () => {
    const p = new Progress(spline.frames, spline.finishM);
    // Climb to 60 m (mid ramp), roll back to 45 m, then climb again past 60.
    const path: number[] = [];
    for (let s = 0; s <= 60; s += 0.2) path.push(s);
    for (let s = 60; s >= 45; s -= 0.2) path.push(s);
    for (let s = 45; s <= 70; s += 0.2) path.push(s);
    let prevT = -1;
    let minArcAfterPeak = Infinity;
    let reachedPeak = false;
    for (const s of path) {
      p.update(ballAt(spline, s));
      expect(p.t).toBeGreaterThanOrEqual(prevT);
      prevT = p.t;
      if (s >= 59.9 && !reachedPeak) reachedPeak = true;
      if (reachedPeak) minArcAfterPeak = Math.min(minArcAfterPeak, p.arcM);
    }
    // The projected position really did go back, while t stayed at the high-water mark.
    expect(minArcAfterPeak).toBeLessThan(46);
    expect(p.t).toBeGreaterThan(69);
  });

  it('while rolling back, t stays at the peak but arcM follows the ball', () => {
    const p = new Progress(spline.frames, spline.finishM);
    for (let s = 0; s <= 60; s += 0.2) p.update(ballAt(spline, s));
    const peak = p.t;
    for (let s = 60; s >= 50; s -= 0.2) p.update(ballAt(spline, s));
    expect(p.t).toBe(peak);
    expect(Math.abs(p.arcM - 50)).toBeLessThan(0.6);
  });

  it('recovers after reseed (respawn teleport)', () => {
    const p = new Progress(spline.frames, spline.finishM, levelTest.checkpointsM);
    for (let s = 0; s <= 60; s += 0.2) p.update(ballAt(spline, s));
    const peak = p.t;
    expect(p.checkpointsPassed).toBe(2);

    // Teleport back to the 25 m checkpoint. Without a reseed the +/- 20 frame window cannot find it.
    const cp = ballAt(spline, 25);
    p.update(cp);
    expect(Math.abs(p.arcM - 25)).toBeGreaterThan(5);

    p.reseed(frameIndexAtArc(spline, 25));
    p.update(cp);
    expect(Math.abs(p.arcM - 25)).toBeLessThan(0.3);
    expect(p.index).toBe(frameIndexAtArc(spline, 25));
    expect(p.t).toBe(peak); // high-water mark survives
    // And it keeps tracking normally afterwards.
    for (let s = 25; s <= 40; s += 0.2) {
      p.update(ballAt(spline, s));
      expect(Math.abs(p.arcM - s)).toBeLessThan(0.3);
    }
    expect(p.t).toBe(peak);
  });

  it('reseed clamps its index', () => {
    const p = new Progress(spline.frames, spline.finishM);
    p.reseed(-5);
    expect(p.index).toBe(0);
    p.reseed(1e9);
    expect(p.index).toBe(spline.frames.length - 1);
  });

  it('reaches the finish at the end of levelTest', () => {
    const p = new Progress(spline.frames, spline.finishM, levelTest.checkpointsM);
    let finishes = 0;
    let cps = 0;
    for (let s = 0; s <= spline.totalM; s += 0.2) {
      const ev = p.update(ballAt(spline, s, Math.sin(s)));
      cps += ev.checkpoints.length;
      if (ev.finished) finishes++;
    }
    expect(cps).toBe(3);
    expect(finishes).toBe(1);
  });
});

describe('Progress on a hairpin (legs 4 m apart)', () => {
  const spline = buildSpline(hairpinPoints);

  it('legs really are about 4 m apart', () => {
    const a = spline.frames[frameIndexAtArc(spline, 5)] as Frame;
    const bIdx = frameIndexAtArc(spline, spline.finishM - 5);
    const b = spline.frames[bIdx] as Frame;
    expect(Math.abs(a.pos.x - b.pos.x)).toBeGreaterThan(3.5);
    expect(Math.abs(a.pos.x - b.pos.x)).toBeLessThan(4.5);
  });

  it('never jumps legs, even when the ball hugs the other leg', () => {
    const p = new Progress(spline.frames, spline.finishM);
    const total = spline.finishM;
    let prevIndex = 0;
    for (let s = 0; s <= total; s += 0.1) {
      // Early on leg A lean 2.4 m toward leg B (closer to B than to A); late on leg B lean toward A.
      // Leg A's right is -X, leg B's right is +X, and B is at +X of A: A leans toward B with
      // lateral = -2.4, B leans toward A with lateral = -2.4 as well.
      const lean = s < 12 || s > total - 12 ? -2.4 : 0;
      const pos = ballAt(spline, s, lean);
      if (s < 12) {
        // Sanity: a global nearest-frame search WOULD jump to the other leg here.
        let best = 0;
        let bestD = Infinity;
        spline.frames.forEach((f, i) => {
          const d = f.pos.distanceToSquared(pos);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (Math.abs(lean) > 2) {
          expect((spline.frames[best] as Frame).arcM).toBeGreaterThan(total - 20);
        }
      }
      p.update(pos);
      const expected = frameIndexAtArc(spline, s);
      expect(Math.abs(p.index - expected)).toBeLessThanOrEqual(3);
      expect(p.index).toBeGreaterThanOrEqual(prevIndex - 3);
      prevIndex = p.index;
    }
    expect(p.t).toBeGreaterThan(total - 0.5);
  });

  it('t is monotone and lateral flips side consistently around the turn', () => {
    const p = new Progress(spline.frames, spline.finishM);
    let prevT = 0;
    for (let s = 0; s <= spline.finishM; s += 0.1) {
      p.update(ballAt(spline, s, 0.7));
      expect(p.t).toBeGreaterThanOrEqual(prevT);
      prevT = p.t;
      // Same viewer-relative side the whole way round (the frame's right turns with the track).
      expect(p.lateralOffset).toBeCloseTo(0.7, 1);
    }
  });
});
