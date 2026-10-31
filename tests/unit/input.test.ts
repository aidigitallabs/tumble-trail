import { describe, expect, it } from 'vitest';
import {
  Input,
  startsAtEdge,
  steerFromOffset,
  steerOriginX,
  steerRangePx,
} from '../../src/app/Input';
import { tuning } from '../../src/config/tuning';

const W = 1024;
const H = 768;
const RANGE = steerRangePx(W, H);

function fresh(mode: 'always' | 'hold', decay = 0): Input {
  const i = new Input();
  i.setViewport(W, H);
  i.configure(mode, decay);
  return i;
}

describe('steer geometry (PLAN section 6)', () => {
  it('steerRangePx is 0.22 x the shorter side', () => {
    expect(RANGE).toBeCloseTo(0.22 * 768, 6);
  });

  it('clamps the virtual origin so a full steer is reachable on both sides', () => {
    expect(steerOriginX(5, W, RANGE)).toBe(RANGE);
    expect(steerOriginX(W - 5, W, RANGE)).toBe(W - RANGE);
    expect(steerOriginX(500, W, RANGE)).toBe(500);
  });

  it('has a dead zone, then a CONTINUOUS linear ramp clamped to +/-1', () => {
    const o = 500;
    const dz = tuning.input.deadZonePx;
    expect(steerFromOffset(o + 39, o, RANGE)).toBe(0);
    expect(steerFromOffset(o - 39, o, RANGE)).toBe(0);
    // No jump at the dead-zone edge: just outside it the steer is just above 0.
    expect(steerFromOffset(o + dz, o, RANGE)).toBe(0);
    expect(steerFromOffset(o + dz + 1, o, RANGE)).toBeGreaterThan(0);
    expect(steerFromOffset(o + dz + 1, o, RANGE)).toBeLessThan(0.01);
    expect(steerFromOffset(o - dz - 1, o, RANGE)).toBeLessThan(0);
    expect(steerFromOffset(o - dz - 1, o, RANGE)).toBeGreaterThan(-0.01);
    // sign(dx) * clamp((|dx| - deadZone) / (range - deadZone), 0, 1)
    const mid = (RANGE / 2 - dz) / (RANGE - dz);
    expect(steerFromOffset(o + RANGE / 2, o, RANGE)).toBeCloseTo(mid, 9);
    expect(steerFromOffset(o - RANGE / 2, o, RANGE)).toBeCloseTo(-mid, 9);
    // Full steer is reached at exactly one range, and stays there.
    expect(steerFromOffset(o + RANGE, o, RANGE)).toBeCloseTo(1, 9);
    expect(steerFromOffset(o + RANGE * 3, o, RANGE)).toBe(1);
    expect(steerFromOffset(o - RANGE * 3, o, RANGE)).toBe(-1);
  });

  it('rejects starts within 40 px of any edge', () => {
    expect(startsAtEdge(39, 300, W, H)).toBe(true);
    expect(startsAtEdge(300, 39, W, H)).toBe(true);
    expect(startsAtEdge(W - 39, 300, W, H)).toBe(true);
    expect(startsAtEdge(300, H - 39, W, H)).toBe(true);
    expect(startsAtEdge(41, 41, W, H)).toBe(false);
  });
});

describe('Input core', () => {
  it('Tiny always drives; the finger only steers', () => {
    const i = fresh('always', 1);
    expect(i.controls).toMatchObject({ driving: true, steer: 0 });
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    expect(i.controls).toMatchObject({ driving: true, steer: 1 });
    i.pointerUp(1);
    expect(i.controls).toMatchObject({ driving: true, steer: 0 });
  });

  it('Big kid drives only while the finger is down', () => {
    const i = fresh('hold');
    expect(i.controls.driving).toBe(false);
    i.pointerDown(1, 500, 400);
    expect(i.controls.driving).toBe(true);
    i.pointerUp(1);
    expect(i.controls.driving).toBe(false);
  });

  it('only the first pointer counts', () => {
    const i = fresh('hold');
    expect(i.pointerDown(1, 300, 400)).toBe(true);
    expect(i.pointerDown(2, 700, 400)).toBe(false);
    i.pointerMove(2, 900, 400); // ignored entirely
    expect(i.controls.steer).toBe(0);
    expect(i.pointerUp(2)).toBe(false);
    expect(i.controls.driving).toBe(true);
    i.pointerUp(1);
    expect(i.pointerDown(2, 700, 400)).toBe(true);
  });

  it('ignores pointers that start at an edge', () => {
    const i = fresh('hold');
    expect(i.pointerDown(1, 10, 400)).toBe(false);
    expect(i.controls.driving).toBe(false);
  });

  it('releases everything on release() (cancel, blur, hidden, resize)', () => {
    const i = fresh('hold');
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    i.release();
    expect(i.controls).toMatchObject({ driving: false, steer: 0 });
    i.pointerMove(1, 100, 400); // the old pointer is no longer ours
    expect(i.controls.steer).toBe(0);
  });

  it('a state change locks input for 500 ms and needs a fresh pointerdown', () => {
    const i = fresh('hold');
    i.pointerDown(1, 500, 400);
    i.lock();
    expect(i.controls.driving).toBe(false);
    expect(i.pointerDown(2, 500, 400)).toBe(false); // during the lockout
    i.update(tuning.input.lockoutMs / 1000 - 0.01);
    expect(i.locked).toBe(true);
    i.update(0.02);
    expect(i.locked).toBe(false);
    // The finger that was already down is not resumed: it needs a fresh pointerdown.
    i.pointerMove(1, 500 + RANGE, 400);
    expect(i.controls.driving).toBe(false);
    expect(i.pointerDown(3, 500, 400)).toBe(true);
    expect(i.controls.driving).toBe(true);
  });

  it('Tiny: a motionless finger decays toward centre after 1 s over steerDecay', () => {
    const i = fresh('always', 1);
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    for (let k = 0; k < 60; k++) i.update(1 / 60); // 1 s still
    expect(i.controls.steer).toBeCloseTo(1, 1);
    for (let k = 0; k < 30; k++) i.update(1 / 60); // 0.5 s into the decay
    expect(i.controls.steer).toBeCloseTo(0.5, 1);
    for (let k = 0; k < 60; k++) i.update(1 / 60);
    expect(i.controls.steer).toBe(0);
    // Moving again restores steering.
    i.pointerMove(1, 500 + RANGE / 2 + 20, 400);
    expect(i.controls.steer).toBeGreaterThan(0.4);
  });

  it('Big kid has no steer decay', () => {
    const i = fresh('hold', 0);
    i.pointerDown(1, 500, 400);
    i.pointerMove(1, 500 + RANGE, 400);
    for (let k = 0; k < 300; k++) i.update(1 / 60);
    expect(i.controls.steer).toBe(1);
  });

  it('keyboard steer ramps at 4 per second and Space/Up drives in hold mode', () => {
    const i = fresh('hold');
    i.keyChange('ArrowRight', true);
    i.update(0.125);
    expect(i.controls.steer).toBeCloseTo(0.5, 6);
    i.update(0.5);
    expect(i.controls.steer).toBe(1);
    i.keyChange('ArrowRight', false);
    i.keyChange('KeyA', true);
    i.update(0.25);
    expect(i.controls.steer).toBeCloseTo(0, 6);
    i.update(0.5);
    expect(i.controls.steer).toBe(-1);
    expect(i.controls.driving).toBe(false);
    i.keyChange('Space', true);
    expect(i.controls.driving).toBe(true);
  });
});

describe('key state across release / lock (review 7)', () => {
  it('release() keeps held keys: a key still physically held keeps working', () => {
    const i = fresh('hold');
    i.keyChange('ArrowRight', true);
    i.keyChange('Space', true);
    i.update(0.5);
    i.release(); // e.g. a pointercancel or a resize
    i.update(0.01);
    expect(i.controls).toMatchObject({ driving: true, steer: 1 });
  });

  it('lock() keeps held keys but gates them with the lockout only', () => {
    const i = fresh('hold');
    i.keyChange('ArrowLeft', true);
    i.keyChange('Space', true);
    i.lock();
    expect(i.controls).toMatchObject({ driving: false, steer: 0 });
    i.update(tuning.input.lockoutMs / 1000);
    expect(i.locked).toBe(false);
    // Held through the lockout: driving at once, and the steer ramps in from 0 (no jump to full).
    expect(i.controls.driving).toBe(true);
    i.update(0.125);
    expect(i.controls.steer).toBeCloseTo(-0.5, 6);
  });

  it('clearKeys() forgets held keys (the window lost focus, key-ups may never arrive)', () => {
    const i = fresh('hold');
    i.keyChange('ArrowRight', true);
    i.keyChange('Space', true);
    i.update(1);
    i.clearKeys();
    expect(i.controls).toMatchObject({ driving: false, steer: 0 });
  });
});

describe('Input.attach owns the viewport and the resize release (review 5)', () => {
  /** Just enough DOM: event targets with the listeners attach() installs. */
  function fakes(): {
    canvas: HTMLCanvasElement;
    win: Window & { innerWidth: number; innerHeight: number };
    fire: (target: 'win' | 'doc' | 'canvas', type: string, init?: object) => void;
  } {
    const mk = (): EventTarget => new EventTarget();
    const canvas = Object.assign(mk(), {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    });
    const doc = Object.assign(mk(), { visibilityState: 'visible' });
    const win = Object.assign(mk(), { innerWidth: 1024, innerHeight: 768, document: doc });
    return {
      canvas: canvas as unknown as HTMLCanvasElement,
      win: win as unknown as Window & { innerWidth: number; innerHeight: number },
      fire: (target, type, init = {}) => {
        const t = target === 'win' ? win : target === 'doc' ? doc : canvas;
        t.dispatchEvent(Object.assign(new Event(type), init));
      },
    };
  }

  it('reads the viewport on attach and again on window resize, releasing the pointer', () => {
    const { canvas, win, fire } = fakes();
    const i = new Input();
    i.configure('hold', 0);
    const detach = i.attach(canvas, win);
    fire('canvas', 'pointerdown', { pointerId: 1, clientX: 500, clientY: 400 });
    expect(i.pointerActive).toBe(true);

    win.innerWidth = 800;
    win.innerHeight = 600;
    fire('win', 'resize');
    expect(i.pointerActive).toBe(false); // released
    // The new viewport is in force: 30 px from the right edge of 800 is an edge start, 30 px from
    // the right edge of the old 1024 would not have been (and 900 px is now off-screen).
    expect(i.pointerDown(2, 770, 300)).toBe(false);
    expect(i.pointerDown(2, 400, 300)).toBe(true);
    detach();
  });

  it('blur and hidden release the pointer and the keys', () => {
    const { canvas, win, fire } = fakes();
    const i = new Input();
    i.configure('hold', 0);
    i.attach(canvas, win);
    fire('win', 'keydown', { code: 'Space' });
    i.update(0);
    expect(i.controls.driving).toBe(true);
    fire('win', 'blur');
    expect(i.controls.driving).toBe(false);
    fire('win', 'keydown', { code: 'Space' });
    expect(i.controls.driving).toBe(true);
    (win.document as unknown as { visibilityState: string }).visibilityState = 'hidden';
    fire('doc', 'visibilitychange');
    expect(i.controls.driving).toBe(false);
  });
});
