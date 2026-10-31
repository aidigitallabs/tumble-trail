import type { Tier } from '../levels/schema';

/**
 * All tunable numbers live here (PLAN section 0 / 15.9).
 *
 * The ball has mass 1 kg (set explicitly on the collider in Phase 1b), so a force in newtons is
 * numerically an acceleration in m/s^2 before damping and rolling losses.
 */

export interface TierTuning {
  /** Track width in metres (floor, between the inner faces of the walls). */
  width: number;
  /** 'always': the ball always rolls and the finger only steers. 'hold': rolls while touching. */
  driveMode: 'always' | 'hold';
  /**
   * Peak drive force (N). With mass 1 kg this is the standing-start acceleration in m/s^2. It
   * is scaled by (1 - vTan / maxSpeed), so it fades out smoothly as the ball nears maxSpeed.
   */
  drive: number;
  /**
   * Speed (m/s) at which the drive force reaches zero. The speed actually reached is a little
   * lower because linear damping (0.2 /s while driving) also acts:
   * v_terminal = drive / (damping + drive / maxSpeed).
   *   tiny:   8 / (0.2 + 8 / 4.0)   = 3.64 m/s
   *   bigkid: 10 / (0.2 + 10 / 5.5) = 4.95 m/s
   * The hard clamp (horizontal only) sits at maxSpeed * speedClampFactor.
   */
  maxSpeed: number;
  /** Cap (m/s) on the sideways speed the lane controller will ask for. */
  maxLateral: number;
  /**
   * Lane gain (1/s): vLatTarget = laneGain * (targetOffset - lateralOffset). The lateral offset
   * error closes with time constant 1 / laneGain: tiny 0.50 s, bigkid 0.33 s.
   */
  laneGain: number;
  /**
   * Steer gain (N per m/s of lateral speed error). With mass 1 kg the lateral speed error closes
   * with time constant 1 / steerGain: tiny 0.33 s, bigkid 0.25 s. Peak lateral acceleration at a
   * full-scale error (maxLateral) is steerGain * maxLateral: tiny 7.5 m/s^2, bigkid 16 m/s^2.
   */
  steerGain: number;
  /** Extra clearance (m) between the lane target and the wall, on top of the ball radius. */
  laneMargin: number;
  /** Seconds for a still finger's steer to decay to 0 (0 = off). */
  steerDecay: number;
  /** Linear damping while not driving: speed decays as exp(-2.5 t), time constant 0.4 s. */
  brakeDamping: number;
  /** Metres below the current frame at which the ball counts as fallen. */
  fallDepth: number;
  cameraBack: number;
  cameraUp: number;
  cameraLookAhead: number;
  /** Camera exp-lerp rate (1/s). */
  cameraSmoothing: number;
}

export const tuning = {
  /** Renderer pixel-ratio cap on touch devices (iPads) and everywhere else (PLAN section 11). */
  pixelRatioCapTouch: 1.25,
  pixelRatioCapDesktop: 2,
  /** Pixel ratio used by the low-graphics toggle. */
  pixelRatioLowGraphics: 1,

  /** Fixed physics step (PLAN section 4). */
  physicsHz: 60,
  maxSubSteps: 4,

  /** Per-tier gameplay table (PLAN section 6). Starting points; Phase 3b adjusts them. */
  tiers: {
    tiny: {
      width: 6.0,
      driveMode: 'always',
      drive: 8,
      maxSpeed: 4.0,
      maxLateral: 2.5,
      laneGain: 2.0,
      steerGain: 3,
      laneMargin: 0.6,
      steerDecay: 1.0,
      brakeDamping: 2.5,
      fallDepth: 6,
      cameraBack: 7,
      cameraUp: 4,
      cameraLookAhead: 4,
      cameraSmoothing: 5,
    },
    bigkid: {
      width: 3.5,
      driveMode: 'hold',
      drive: 10,
      maxSpeed: 5.5,
      maxLateral: 4.0,
      laneGain: 3.0,
      steerGain: 4,
      laneMargin: 0.3,
      steerDecay: 0,
      brakeDamping: 2.5,
      fallDepth: 6,
      cameraBack: 7,
      cameraUp: 4,
      cameraLookAhead: 5,
      cameraSmoothing: 6,
    },
  } satisfies Record<Tier, TierTuning>,

  /** Ball body and control constants shared by both tiers (PLAN section 6). Used from Phase 1b. */
  ball: {
    radius: 0.5,
    /** Explicit collider mass (kg), so forces in N read as m/s^2. */
    mass: 1,
    friction: 0.8,
    restitution: 0.2,
    angularDamping: 0.1,
    /** Linear damping while driving (1/s). */
    drivingDamping: 0.2,
    /** Horizontal speed hard clamp = maxSpeed * this. */
    speedClampFactor: 1.3,
    /** Drive is multiplied by uphillBoost while the track climbs steeper than this (degrees). */
    uphillBoostAboveDeg: 12,
    uphillBoost: 1.5,
    /** Stuck detection: driving and slower than stuckSpeed for stuckSeconds -> respawn. */
    stuckSpeed: 0.3,
    stuckSeconds: 3,
  },

  /** Respawn sequence (PLAN section 6). */
  respawn: {
    durationMs: 300,
    /** Metres above the checkpoint frame the ball is placed. */
    liftM: 1.0,
    /** Metres below the lowest frame for the last-resort catch plane. */
    catchPlaneDepthM: 10,
  },

  /** Input constants (PLAN section 6). Used from Phase 1b. */
  input: {
    steerRangeFraction: 0.22,
    deadZonePx: 40,
    edgeRejectPx: 40,
    stillMovePx: 8,
    stillSeconds: 1,
    lockoutMs: 500,
    keyboardSteerPerSecond: 4,
  },

  /** Spline sampling (PLAN section 5). */
  spline: {
    /** Arc-length lookup samples along the control-point curve (>= 2000 required). */
    lutSamples: 4000,
    /** Spacing of track frames along the arc, metres. */
    frameSpacingM: 0.5,
    /** Straight, flat track appended beyond the last control point (the actual pad is at least this long). */
    endPadM: 6,
    /** CatmullRomCurve3 tension for the centripetal type. */
    tension: 0.5,
  },

  /** Track ribbon geometry (PLAN sections 5 and 9). */
  track: {
    fullWallHeightM: 1.5,
    lowWallHeightM: 0.35,
    /** Thickness of the wall prism, outside the playable width. */
    wallThicknessM: 0.3,
    /** No side walls for this many metres before the finish line. */
    noWallBeforeFinishM: 2,
    /** Centre stripe: width and dash/gap lengths along the track. */
    stripeWidthM: 0.4,
    stripeDashM: 1.5,
    stripeGapM: 1.5,
    /** Collider materials (PLAN section 5). Walls are frictionless so the ball slides along them. */
    floorFriction: 0.8,
    floorRestitution: 0,
    wallFriction: 0,
    wallRestitution: 0.3,
  },

  /** Progress tracker (PLAN section 4 flow). */
  progress: {
    /** Search +/- this many frames around the previous nearest frame. */
    windowFrames: 20,
  },

  /** validateLevel rule 1 (PLAN section 5). Later rules arrive in Phase 2. */
  validation: {
    minPoints: 4,
    minPointSpacingM: 2,
    minLengthM: 80,
    maxLengthM: 120,
  },

  /** Autopilot finish-time proxy for Big kid, seconds [min, max] (PLAN section 13). */
  bigkidLevelSeconds: [12, 60],

  /** Physics world (PLAN section 6). */
  physics: {
    gravity: -9.81,
    /** Spawn at this arc length on the first start (a stand-in for the Phase 2 start pad). */
    startArcM: 1,
    /** Catch plane half extent beyond the track bounding box, metres. */
    catchPlaneMarginM: 50,
    /** The catch plane counts as hit when the ball centre is within this many metres of its top. */
    catchPlaneHitM: 1,
  },

  /** Follow camera (PLAN section 7). Distances per tier are in the tier table. */
  camera: {
    /** Constant horizontal field of view, degrees (vertical FOV follows the aspect ratio). */
    horizontalFovDeg: 75,
    near: 0.1,
    far: 120,
    /** The look-at point sits this high above the ball so the ball is framed lower-middle. */
    lookAtUpM: 0.8,
    /** prefers-reduced-motion multiplies the smoothing rate by this. */
    reducedMotionSmoothing: 2,
  },

  /** Scene look (PLAN section 9). */
  render: {
    fogNear: 30,
    fogFar: 80,
    hemisphereIntensity: 1.7,
    sunIntensity: 1.3,
    sunPosition: [6, 12, 4],
    /** Ground colour of the hemisphere light. */
    hemisphereGround: 0xb8c9a0,
  },

  /** Ball visuals (PLAN section 6). */
  ballVisual: {
    widthSegments: 28,
    heightSegments: 18,
    /** Back-face outline hull scale. */
    outlineScale: 1.07,
    shadowOpacity: 0.28,
    /** Blob shadow is raised this far above the floor hit. */
    shadowLiftM: 0.02,
    /** Raycast length below the ball, metres. */
    shadowMaxDistM: 8,
    /** Shadow radius scale at the floor and its growth per metre of height (shrinks as it rises). */
    shadowRadiusScale: 0.95,
    shadowFadePerM: 0.18,
  },

  /** Autopilot (PLAN section 13). */
  autopilot: {
    /** Look this far ahead along the track for the curve-anticipation term, metres. */
    lookAheadM: 4,
    /** Weight of the look-ahead lateral term relative to the centring term. */
    lookAheadGain: 0.5,
  },
} as const;

export function pixelRatioCap(isTouchDevice: boolean): number {
  return isTouchDevice ? tuning.pixelRatioCapTouch : tuning.pixelRatioCapDesktop;
}

export function pickPixelRatio(devicePixelRatio: number, isTouchDevice: boolean): number {
  return Math.min(devicePixelRatio, pixelRatioCap(isTouchDevice));
}
