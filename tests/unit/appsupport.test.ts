import { describe, expect, it, vi } from 'vitest';
import { playableLevels, TEST_LEVEL_ID } from '../../src/app/levelList';
import { UpdateGate } from '../../src/app/updateGate';
import { WakeLockKeeper, type WakeLockApi } from '../../src/app/wakeLock';
import { tuning } from '../../src/config/tuning';
import { levelTest } from '../../src/levels';
import { plainLevel } from './fixtures';

describe('playableLevels', () => {
  const l1 = { ...plainLevel(), id: 'level01', name: 'One' };
  const l2 = { ...plainLevel(), id: 'level02', name: 'Two' };

  it('leaves the test course out when there are real levels', () => {
    const list = playableLevels([levelTest, l1, l2]);
    expect(list.map((l) => l.id)).toEqual(['level01', 'level02']);
  });

  it('keeps registry order and does not depend on where the test course sits', () => {
    expect(playableLevels([l1, levelTest, l2]).map((l) => l.id)).toEqual(['level01', 'level02']);
  });

  it('falls back to the test course when it is all there is', () => {
    expect(playableLevels([levelTest]).map((l) => l.id)).toEqual([TEST_LEVEL_ID]);
  });

  it('counts one star per checkpoint plus one for finishing', () => {
    const [info] = playableLevels([l1]);
    expect(info?.maxStars).toBe(l1.checkpointsM.length + 1);
  });
});

describe('UpdateGate: service-worker updates apply only on the title', () => {
  it('holds an update in every other state and applies it once on the title', () => {
    const gate = new UpdateGate();
    const apply = vi.fn();
    gate.offer(apply, 'playing');
    for (const s of [
      'playing',
      'celebrating',
      'finished',
      'levelSelect',
      'parentMenu',
      'boot',
    ] as const) {
      expect(gate.check(s)).toBe(false);
    }
    expect(apply).not.toHaveBeenCalled();
    expect(gate.waiting).toBe(true);
    expect(gate.check('title')).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(gate.check('title')).toBe(false);
    expect(gate.waiting).toBe(false);
  });

  it('applies straight away when offered on the title', () => {
    const gate = new UpdateGate();
    const apply = vi.fn();
    gate.offer(apply, 'title');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('WakeLockKeeper', () => {
  /** A just-enough Document: vitest runs in Node here, there is no DOM. */
  function fakeDoc(): { doc: Document; fireVisible: () => void } {
    const listeners: Array<() => void> = [];
    const doc = {
      visibilityState: 'visible',
      addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
    } as unknown as Document;
    return { doc, fireVisible: () => listeners.forEach((fn) => fn()) };
  }
  function fake(): { api: WakeLockApi; request: ReturnType<typeof vi.fn>; release: () => void } {
    const sentinel = { released: false, release: vi.fn(() => Promise.resolve()) };
    sentinel.release.mockImplementation(() => {
      sentinel.released = true;
      return Promise.resolve();
    });
    const request = vi.fn(() => Promise.resolve(sentinel));
    return {
      api: { request },
      request,
      release: () => {
        sentinel.released = true;
      },
    };
  }
  const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  it('requests a screen lock when wanted and releases it when not', async () => {
    const { api, request } = fake();
    const keeper = new WakeLockKeeper(api, fakeDoc().doc);
    keeper.set(true);
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    keeper.set(false);
    await flush();
    keeper.set(true);
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('requests again when the page becomes visible after the browser dropped the lock', async () => {
    const { api, request, release } = fake();
    const { doc, fireVisible } = fakeDoc();
    const keeper = new WakeLockKeeper(api, doc);
    keeper.set(true);
    await flush();
    release(); // the browser released it when the page was hidden
    fireVisible();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ignores a missing API and a rejected request', async () => {
    expect(() => new WakeLockKeeper(undefined, fakeDoc().doc).set(true)).not.toThrow();
    const api: WakeLockApi = { request: () => Promise.reject(new Error('NotAllowedError')) };
    const keeper = new WakeLockKeeper(api, fakeDoc().doc);
    expect(() => keeper.set(true)).not.toThrow();
    await flush();
  });
});

describe('UI tuning', () => {
  it('meets the PLAN section 8 target sizes and timings', () => {
    expect(tuning.ui.playTargetPx).toBeGreaterThanOrEqual(160);
    expect(tuning.ui.parentTargetPx).toBeGreaterThanOrEqual(88);
    expect(tuning.ui.playButtonPx).toBeGreaterThan(tuning.ui.playTargetPx);
    expect(tuning.input.lockoutMs).toBe(500);
    expect(tuning.ui.celebrationSeconds).toBe(3);
    expect(tuning.ui.idleHintSeconds).toEqual({ tiny: 4, bigkid: 8 });
  });
});
