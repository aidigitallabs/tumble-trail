import type { Tier } from '../levels/schema';
import type { AudioState } from '../game/Audio';

/** Debug/test contract (PLAN section 4). `window.__tt` is always present. */
export type TTState =
  'boot' | 'title' | 'levelSelect' | 'playing' | 'celebrating' | 'finished' | 'parentMenu';

export interface TTStats {
  triangles: number;
  drawCalls: number;
  fps: number;
}

/** Read-only audio status for tests: 'none' until the first gesture has created the context. */
export interface TTAudio {
  state: AudioState;
  muted: boolean;
}

/** Read-only effects status for tests. */
export interface TTEffects {
  /** Live particle quads. */
  particles: number;
  reducedMotion: boolean;
}

export interface TT {
  readonly state: TTState;
  /** Applies on the next `loadLevel`. Does not touch the save (the parent menu does that). */
  setTier(t: Tier): void;
  /**
   * Resolves when the physics world and track are built and `state === 'playing'`. Bypasses the
   * title, the celebration and any open parent menu (test hook).
   */
  loadLevel(id: string): Promise<void>;
  autopilot: boolean;
  /**
   * Synchronous. Steps physics only (no render / audio / effects), running the autopilot inside
   * each step when `autopilot` is on, and returns early when `until` is reached. The rAF loop is
   * paused while it runs.
   */
  fastForward(maxSeconds: number, until?: TTState): { state: TTState; seconds: number };
  /** From `renderer.info`, i.e. the last rendered frame. */
  stats(): TTStats;
  trackWidth(): number;
  /** Id of the loaded level ('' before the first one). */
  levelId(): string;
  /** Balloons in the loaded level for the current tier, and how many are popped. */
  balloons(): { total: number; popped: number };
  /** How many obstacles of each kind the loaded level has for the current tier. */
  obstacles(): Record<'bump' | 'pillar' | 'gate' | 'balloon', number>;
  ball(): {
    pos: [number, number, number];
    vel: [number, number, number];
    t: number;
    lateral: number;
  };
  /** Audio context state and the mute flag (Phase 5). */
  audio(): TTAudio;
  /** Live effect particles and the reduced-motion flag (Phase 5). */
  effects(): TTEffects;
  /** The renderer's GPU string (Phase 0 smoke test: proves WebGL is real, not a stub). */
  app: { rendererString: string | null };
}

declare global {
  interface Window {
    __tt: TT;
  }
}

/** The part of `App` that `__tt` needs (so tt.ts does not import the renderer code). */
export interface TTHost {
  state: TTState;
  autopilot: boolean;
  rendererString: string | null;
  setTier(t: Tier): void;
  loadLevel(id: string): Promise<void>;
  fastForward(maxSeconds: number, until?: TTState): { state: TTState; seconds: number };
  stats(): TTStats;
  trackWidth(): number;
  levelId(): string;
  balloons(): { total: number; popped: number };
  obstacles(): Record<'bump' | 'pillar' | 'gate' | 'balloon', number>;
  ballState(): ReturnType<TT['ball']>;
  audioStatus(): TTAudio;
  effectsStatus(): TTEffects;
}

/** Placeholder installed before the app is constructed (state 'boot'). */
export function bootTT(): TT {
  const notReady = (): never => {
    throw new Error('Tumble Trail is still booting');
  };
  return {
    state: 'boot',
    autopilot: false,
    setTier: notReady,
    loadLevel: () => Promise.reject(new Error('Tumble Trail is still booting')),
    fastForward: notReady,
    stats: () => ({ triangles: 0, drawCalls: 0, fps: 0 }),
    trackWidth: () => 0,
    levelId: () => '',
    balloons: () => ({ total: 0, popped: 0 }),
    obstacles: () => ({ bump: 0, pillar: 0, gate: 0, balloon: 0 }),
    ball: () => ({ pos: [0, 0, 0], vel: [0, 0, 0], t: 0, lateral: 0 }),
    audio: () => ({ state: 'none', muted: false }),
    effects: () => ({ particles: 0, reducedMotion: false }),
    app: { rendererString: null },
  };
}

/** The live `__tt`: thin accessors over the app. Nothing here can touch persistence. */
export function createTT(host: TTHost): TT {
  return {
    get state() {
      return host.state;
    },
    get autopilot() {
      return host.autopilot;
    },
    set autopilot(on: boolean) {
      host.autopilot = on;
    },
    setTier: (t) => host.setTier(t),
    loadLevel: (id) => host.loadLevel(id),
    fastForward: (s, until) => host.fastForward(s, until),
    stats: () => host.stats(),
    trackWidth: () => host.trackWidth(),
    levelId: () => host.levelId(),
    balloons: () => host.balloons(),
    obstacles: () => host.obstacles(),
    ball: () => host.ballState(),
    audio: () => host.audioStatus(),
    effects: () => host.effectsStatus(),
    app: { rendererString: host.rendererString },
  };
}
