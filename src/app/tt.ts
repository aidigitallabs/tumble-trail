import type { Tier } from '../levels/schema';

/** Debug/test contract (PLAN section 4). `window.__tt` is always present. */
export type TTState =
  'boot' | 'title' | 'levelSelect' | 'playing' | 'celebrating' | 'finished' | 'parentMenu';

export interface TTStats {
  triangles: number;
  drawCalls: number;
  fps: number;
}

export interface TT {
  readonly state: TTState;
  /** Applies on the next `loadLevel`. */
  setTier(t: Tier): void;
  /** Resolves when the physics world and track are built and `state === 'playing'`. */
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
  ball(): {
    pos: [number, number, number];
    vel: [number, number, number];
    t: number;
    lateral: number;
  };
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
  ballState(): ReturnType<TT['ball']>;
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
    ball: () => ({ pos: [0, 0, 0], vel: [0, 0, 0], t: 0, lateral: 0 }),
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
    ball: () => host.ballState(),
    app: { rendererString: host.rendererString },
  };
}
