import type { Tier } from '../levels/schema';

/** localStorage key and schema version (PLAN section 12). */
export const SAVE_KEY = 'tt.v1';
export const SAVE_VERSION = 1;
export const BALL_COUNT = 3;

export type BallIndex = 0 | 1 | 2;

/** One ball character's profile: its own tier and progress. */
export interface BallProfile {
  tier: Tier;
  /** How many levels are unlocked (Big kid is sequential; Tiny ignores it: all open). */
  unlocked: number;
  /** Index of the level the title's play button starts. */
  currentLevel: number;
  /** Best stars earned per level id. Only ever goes up. */
  stars: Record<string, number>;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  muted: boolean;
  lowGraphics: boolean;
  parentCardSeen: boolean;
  selectedBall: BallIndex;
  balls: BallProfile[];
}

/** The slice of the Storage API we use (so tests can inject a fake). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function defaultProfile(): BallProfile {
  return { tier: 'tiny', unlocked: 1, currentLevel: 0, stars: {} };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    muted: false,
    lowGraphics: false,
    parentCardSeen: false,
    selectedBall: 0,
    balls: Array.from({ length: BALL_COUNT }, defaultProfile),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nonNegInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

function sanitizeProfile(raw: unknown): BallProfile {
  const d = defaultProfile();
  if (!isObject(raw)) return d;
  const stars: Record<string, number> = {};
  if (isObject(raw.stars)) {
    for (const [id, n] of Object.entries(raw.stars)) {
      const v = nonNegInt(n, 0);
      if (v > 0) stars[id] = v;
    }
  }
  return {
    tier: raw.tier === 'bigkid' ? 'bigkid' : 'tiny',
    unlocked: Math.max(1, nonNegInt(raw.unlocked, d.unlocked)),
    currentLevel: nonNegInt(raw.currentLevel, d.currentLevel),
    stars,
  };
}

/** Field-by-field sanitising of a version-1 object: bad fields fall back to defaults. */
function sanitize(raw: Record<string, unknown>): SaveData {
  const d = defaultSave();
  const rawBalls = Array.isArray(raw.balls) ? raw.balls : [];
  const sel = raw.selectedBall;
  return {
    version: SAVE_VERSION,
    muted: raw.muted === true,
    lowGraphics: raw.lowGraphics === true,
    parentCardSeen: raw.parentCardSeen === true,
    selectedBall: sel === 1 || sel === 2 ? sel : 0,
    balls: d.balls.map((_, i) => sanitizeProfile(rawBalls[i])),
  };
}

/** Migrations from older versions: `migrations[n]` upgrades a version-n object to n + 1. None yet. */
const migrations: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

export interface ParseResult {
  data: SaveData;
  /**
   * True when the stored data was written by a NEWER version of the app: we play with defaults but
   * must never overwrite it (a downgrade must not destroy a newer save).
   */
  readOnly: boolean;
}

/** Parse a stored string. Never throws: corrupt, missing or unknown data gives the defaults. */
export function parseSave(text: string | null): ParseResult {
  if (text === null) return { data: defaultSave(), readOnly: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { data: defaultSave(), readOnly: false };
  }
  if (!isObject(raw) || typeof raw.version !== 'number' || !Number.isInteger(raw.version)) {
    return { data: defaultSave(), readOnly: false };
  }
  if (raw.version > SAVE_VERSION) return { data: defaultSave(), readOnly: true };
  if (raw.version < 1) return { data: defaultSave(), readOnly: false };
  let obj: Record<string, unknown> = raw;
  for (let v = raw.version; v < SAVE_VERSION; v++) {
    const step = migrations[v];
    if (!step) return { data: defaultSave(), readOnly: false };
    obj = step(obj);
  }
  return { data: sanitize(obj), readOnly: false };
}

/**
 * Records a finished level on a profile: best stars, unlocks the next level, and points
 * `currentLevel` at the next level (wrapping to the first after the last).
 */
export function applyFinish(
  profile: BallProfile,
  levelIndex: number,
  levelId: string,
  stars: number,
  levelCount: number,
): void {
  profile.stars[levelId] = Math.max(profile.stars[levelId] ?? 0, stars);
  profile.unlocked = Math.max(profile.unlocked, Math.min(levelIndex + 2, levelCount));
  profile.currentLevel = levelIndex + 1 < levelCount ? levelIndex + 1 : 0;
}

/** Tiny has every level open; Big kid is sequential. */
export function isLevelOpen(profile: BallProfile, index: number): boolean {
  return profile.tier === 'tiny' || index < profile.unlocked;
}

/** Storage from `window`, or null when it is unavailable or throws (private mode). */
function windowStorage(): StorageLike | null {
  try {
    const s = window.localStorage;
    s.getItem(SAVE_KEY);
    return s;
  } catch {
    return null;
  }
}

/**
 * Versioned save under `tt.v1`. Every storage access is in try/catch; when storage is missing or
 * throws, the data simply lives in memory for this session.
 */
export class Persistence {
  data: SaveData;
  private readOnly = false;

  constructor(private storage: StorageLike | null = windowStorage()) {
    let text: string | null;
    try {
      text = storage?.getItem(SAVE_KEY) ?? null;
    } catch {
      text = null;
    }
    const parsed = parseSave(text);
    this.data = parsed.data;
    this.readOnly = parsed.readOnly;
  }

  get selected(): BallProfile {
    return this.profile(this.data.selectedBall);
  }

  profile(ball: number): BallProfile {
    return this.data.balls[ball] ?? (this.data.balls[0] as BallProfile);
  }

  selectBall(i: BallIndex): void {
    this.data.selectedBall = i;
    this.commit();
  }

  setTier(ball: number, tier: Tier): void {
    this.profile(ball).tier = tier;
    this.commit();
  }

  setCurrentLevel(ball: number, index: number): void {
    this.profile(ball).currentLevel = index;
    this.commit();
  }

  setMuted(muted: boolean): void {
    this.data.muted = muted;
    this.commit();
  }

  setLowGraphics(on: boolean): void {
    this.data.lowGraphics = on;
    this.commit();
  }

  markParentCardSeen(): void {
    this.data.parentCardSeen = true;
    this.commit();
  }

  recordFinish(
    ball: number,
    levelIndex: number,
    levelId: string,
    stars: number,
    levelCount: number,
  ): void {
    applyFinish(this.profile(ball), levelIndex, levelId, stars, levelCount);
    this.commit();
  }

  /** Forget one ball's progress (it keeps its tier). */
  resetBall(ball: number): void {
    const p = this.profile(ball);
    p.unlocked = 1;
    p.currentLevel = 0;
    p.stars = {};
    this.commit();
  }

  private commit(): void {
    if (this.readOnly || !this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Quota or private mode: keep playing from memory.
      this.storage = null;
    }
  }
}
