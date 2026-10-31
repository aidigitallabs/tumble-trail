/**
 * All tunable numbers live here (PLAN section 0 / 15.9). Phase 0 only needs the renderer
 * pixel-ratio caps and the smoke-scene numbers; later phases add the per-tier gameplay table.
 */
export const tuning = {
  /** Renderer pixel-ratio cap on touch devices (iPads) and everywhere else (PLAN section 11). */
  pixelRatioCapTouch: 1.25,
  pixelRatioCapDesktop: 2,
  /** Pixel ratio used by the low-graphics toggle. */
  pixelRatioLowGraphics: 1,

  /** Fixed physics step (PLAN section 4). */
  physicsHz: 60,
  maxSubSteps: 4,

  /** Phase 0 smoke scene only. */
  smoke: {
    ballRadius: 0.5,
    ballStartHeight: 4,
    planeHalfSize: 10,
    planeThickness: 0.2,
    gravity: -9.81,
    ballRestitution: 0.35,
    cameraBack: 7,
    cameraUp: 4,
    cameraLookAtY: 0.8,
    verticalFov: 60,
  },
} as const;

export function pixelRatioCap(isTouchDevice: boolean): number {
  return isTouchDevice ? tuning.pixelRatioCapTouch : tuning.pixelRatioCapDesktop;
}

export function pickPixelRatio(devicePixelRatio: number, isTouchDevice: boolean): number {
  return Math.min(devicePixelRatio, pixelRatioCap(isTouchDevice));
}
