import { describe, expect, it } from 'vitest';
import {
  applyFinish,
  defaultProfile,
  defaultSave,
  isLevelOpen,
  parseSave,
  Persistence,
  SAVE_KEY,
  type StorageLike,
} from '../../src/app/Persistence';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('Persistence round trip', () => {
  it('starts from the defaults with nothing stored', () => {
    const p = new Persistence(new MemoryStorage());
    expect(p.data).toEqual(defaultSave());
    expect(p.data.balls).toHaveLength(3);
  });

  it('saves under tt.v1 and loads the same data back', () => {
    const storage = new MemoryStorage();
    const a = new Persistence(storage);
    a.selectBall(2);
    a.setTier(2, 'bigkid');
    a.setMuted(true);
    a.setLowGraphics(true);
    a.markParentCardSeen();
    a.recordFinish(2, 0, 'level01', 4, 6);
    expect(storage.items.has(SAVE_KEY)).toBe(true);
    expect(SAVE_KEY).toBe('tt.v1');

    const b = new Persistence(storage);
    expect(b.data).toEqual(a.data);
    expect(b.data.selectedBall).toBe(2);
    expect(b.selected.tier).toBe('bigkid');
    expect(b.selected.stars).toEqual({ level01: 4 });
    expect(b.data.muted).toBe(true);
    expect(b.data.lowGraphics).toBe(true);
    expect(b.data.parentCardSeen).toBe(true);
    expect(b.data.version).toBe(1);
  });

  it('keeps each ball character as its own profile', () => {
    const p = new Persistence(new MemoryStorage());
    p.setTier(1, 'bigkid');
    p.recordFinish(1, 0, 'level01', 3, 6);
    expect(p.profile(0)).toEqual(defaultProfile());
    expect(p.profile(1).unlocked).toBe(2);
    expect(p.profile(2)).toEqual(defaultProfile());
  });

  it('reset forgets progress but keeps the ball tier', () => {
    const p = new Persistence(new MemoryStorage());
    p.setTier(0, 'bigkid');
    p.recordFinish(0, 0, 'level01', 3, 6);
    p.resetBall(0);
    expect(p.profile(0)).toEqual({ tier: 'bigkid', unlocked: 1, currentLevel: 0, stars: {} });
  });
});

describe('corrupt and unexpected data', () => {
  it.each([
    ['not json', '{oops'],
    ['an array', '[1,2,3]'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['no version', '{"muted":true}'],
    ['version 0', '{"version":0}'],
    ['a fractional version', '{"version":1.5}'],
    ['a string version', '{"version":"1"}'],
  ])('falls back to the defaults for %s', (_name, text) => {
    const { data, readOnly } = parseSave(text);
    expect(data).toEqual(defaultSave());
    expect(readOnly).toBe(false);
  });

  it('fixes bad fields one by one and keeps the good ones', () => {
    const text = JSON.stringify({
      version: 1,
      muted: 'yes',
      lowGraphics: true,
      parentCardSeen: 1,
      selectedBall: 7,
      balls: [
        { tier: 'giant', unlocked: -3, currentLevel: 'x', stars: { a: 3, b: 'no', c: -1 } },
        { tier: 'bigkid', unlocked: 4, currentLevel: 2, stars: {} },
        'junk',
        { tier: 'tiny' },
      ],
    });
    const { data } = parseSave(text);
    expect(data.muted).toBe(false);
    expect(data.lowGraphics).toBe(true);
    expect(data.parentCardSeen).toBe(false);
    expect(data.selectedBall).toBe(0);
    expect(data.balls).toHaveLength(3);
    expect(data.balls[0]).toEqual({ tier: 'tiny', unlocked: 1, currentLevel: 0, stars: { a: 3 } });
    expect(data.balls[1]).toEqual({ tier: 'bigkid', unlocked: 4, currentLevel: 2, stars: {} });
    expect(data.balls[2]).toEqual(defaultProfile());
  });

  it('corrupt JSON in storage gives the defaults and is overwritten by the next save', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{broken');
    const p = new Persistence(storage);
    expect(p.data).toEqual(defaultSave());
    p.selectBall(1);
    expect(JSON.parse(storage.getItem(SAVE_KEY) as string).selectedBall).toBe(1);
  });
});

describe('migration guard', () => {
  it('never overwrites a save written by a newer version', () => {
    const storage = new MemoryStorage();
    const future = JSON.stringify({ version: 2, shiny: 'new things', selectedBall: 2 });
    storage.setItem(SAVE_KEY, future);
    const p = new Persistence(storage);
    expect(p.data).toEqual(defaultSave()); // plays with defaults in memory...
    p.selectBall(1);
    p.recordFinish(1, 0, 'level01', 3, 6);
    expect(storage.getItem(SAVE_KEY)).toBe(future); // ...but leaves the newer save untouched
  });

  it('flags a newer version as read-only and an older or missing one as writable', () => {
    expect(parseSave(JSON.stringify({ version: 99 })).readOnly).toBe(true);
    expect(parseSave(JSON.stringify({ version: 1 })).readOnly).toBe(false);
    expect(parseSave(null).readOnly).toBe(false);
  });
});

describe('storage failures (private mode)', () => {
  it('works from memory when storage throws on read and write', () => {
    const p = new Persistence(throwing);
    expect(p.data).toEqual(defaultSave());
    p.selectBall(2);
    p.recordFinish(2, 1, 'level02', 3, 6);
    expect(p.data.selectedBall).toBe(2);
    expect(p.profile(2).stars.level02).toBe(3);
  });

  it('works from memory with no storage at all', () => {
    const p = new Persistence(null);
    p.setMuted(true);
    expect(p.data.muted).toBe(true);
  });
});

describe('progress rules', () => {
  it('unlocks the next level on finish and points currentLevel at it', () => {
    const p = defaultProfile();
    applyFinish(p, 0, 'level01', 4, 6);
    expect(p.unlocked).toBe(2);
    expect(p.currentLevel).toBe(1);
    applyFinish(p, 1, 'level02', 3, 6);
    expect(p.unlocked).toBe(3);
    expect(p.currentLevel).toBe(2);
  });

  it('keeps the best stars and never lowers anything', () => {
    const p = defaultProfile();
    applyFinish(p, 0, 'level01', 4, 6);
    applyFinish(p, 0, 'level01', 2, 6);
    expect(p.stars.level01).toBe(4);
    expect(p.unlocked).toBe(2);
  });

  it('replaying an early level does not lock later ones', () => {
    const p = defaultProfile();
    for (let i = 0; i < 4; i++) applyFinish(p, i, `l${i}`, 3, 6);
    applyFinish(p, 0, 'l0', 3, 6);
    expect(p.unlocked).toBe(5);
  });

  it('wraps currentLevel to the first level after the last and caps unlocked', () => {
    const p = defaultProfile();
    applyFinish(p, 5, 'level06', 5, 6);
    expect(p.currentLevel).toBe(0);
    expect(p.unlocked).toBe(6);
  });

  it('Tiny has every level open, Big kid is sequential', () => {
    const tiny = defaultProfile();
    const big = { ...defaultProfile(), tier: 'bigkid' as const, unlocked: 2 };
    expect(isLevelOpen(tiny, 5)).toBe(true);
    expect(isLevelOpen(big, 0)).toBe(true);
    expect(isLevelOpen(big, 1)).toBe(true);
    expect(isLevelOpen(big, 2)).toBe(false);
  });
});
