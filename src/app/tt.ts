/** Debug/test contract (PLAN section 4). Phase 0 implements only the parts listed as present. */
export type TTState =
  'boot' | 'title' | 'levelSelect' | 'playing' | 'celebrating' | 'finished' | 'parentMenu';

export interface TTStats {
  triangles: number;
  drawCalls: number;
  fps: number;
}

export interface TT {
  state: TTState;
  stats(): TTStats;
  /** Phase 0: the renderer and the smoke ball, so the smoke test can prove WASM + WebGL work. */
  app: { rendererString: string | null };
  ball(): {
    pos: [number, number, number];
    vel: [number, number, number];
    t: number;
    lateral: number;
  };
}

declare global {
  interface Window {
    __tt: TT;
  }
}
