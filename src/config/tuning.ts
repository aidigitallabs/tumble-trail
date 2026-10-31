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
  /** Default wall mode when the level does not say otherwise (PLAN section 5): tiny 'full', bigkid 'low'. */
  wallMode: 'full' | 'low';
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
      wallMode: 'full',
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
      wallMode: 'low',
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
    /**
     * Parking rule: while not driving, a ball whose speed along the track surface (tangent and
     * sideways components) is below this (m/s) is brought to a dead stop each step. Damping alone
     * leaves a creep of (5/7 g sin(slope)) / brakeDamping = 0.72 m/s on a 15 degree ramp.
     */
    parkSpeed: 0.6,
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
    /** Start pad: diameter (m) of the flat disc under frame 0, and its fan resolution. */
    startPadDiameterM: 3,
    startPadSegments: 16,
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

  /** validateLevel (PLAN section 5, rules 1-7). */
  validation: {
    // Rule 1
    minPoints: 4,
    minPointSpacingM: 2,
    minLengthM: 80,
    maxLengthM: 120,
    // Rule 2
    maxSlopeDeg: 20,
    // Rule 3: turning radius >= minRadiusPerWidth x tier width; parts of the track further apart
    // than selfIntersectMinArcWidths x width (along the arc) must not overlap in plan view.
    minRadiusPerWidth: 1.0,
    selfIntersectMinArcWidths: 3.2,
    // Rule 4
    checkpointFirstMinM: 10,
    checkpointLastBeforeFinishM: 10,
    maxCheckpointStretchM: 30,
    // Rule 5
    obstacleMinAtM: 5,
    obstacleMaxBeforeFinishM: 8,
    obstacleCheckpointClearM: 3,
    pillarMinOffsetM: 0.6,
    pillarEdgeMarginM: 0.2,
    postMaxSlopeDeg: 8,
    /** Slope is checked on frames within this many metres of a pillar / gate. */
    postSlopeWindowM: 1,
    postMinRadiusM: 12,
    /** Turning radius is checked on frames within this many metres of a pillar / gate. */
    postRadiusWindowM: 4,
    balloonEdgeMarginM: 0.5,
    // Rule 6
    noWallMinRadiusM: 30,
    // Rule 7
    tinyMaxBalloonGapM: 25,
  },

  /** Obstacle dimensions (PLAN section 5: fixed) and the small amount of detail around them. */
  obstacles: {
    bump: {
      heightM: 0.2,
      lengthM: 1.2,
      /** Spans this fraction of the track width. */
      spanFraction: 1 / 3,
      segmentsAlong: 12,
      segmentsAcross: 8,
      /** The ridge's base sits this far below the floor so it never leaves a visible seam. */
      sinkM: 0.03,
      /** The ridge's lateral ends ease down over this distance (no sharp step for the ball). */
      edgeTaperM: 0.25,
    },
    pillar: {
      radiusM: 0.4,
      heightM: 2.0,
      /** The conical skirt reaches this far out from the post. */
      skirtReachM: 0.3,
      skirtHeightM: 0.3,
      /** roundCylinder border radius; the shape is inflated by it, so the core is smaller. */
      borderM: 0.05,
      segments: 14,
    },
    gate: {
      /** Posts stand at gate offset +/- this. */
      halfSpanM: 1.1,
      /** Visual-only banner: height above the floor, depth and the string thickness. */
      bannerHeightM: 6,
      bannerDepthM: 0.9,
      bannerOverhangM: 0.5,
      stringHalfWidthM: 0.04,
    },
    balloon: {
      radiusM: 0.5,
      /** Height of the balloon centre above the floor. */
      floatM: 1.2,
      /** Pops when the ball centre is closer than this to the balloon centre. */
      popDistM: 1.1,
      stringHalfWidthM: 0.025,
      segments: 10,
      /** Pop animation: seconds, and the peak scale reached by the burst (at `popPeakAt` of it). */
      popSeconds: 0.3,
      popPeakScale: 1.6,
      popPeakAt: 0.35,
    },
  },

  /** Contact events for the bump / wall sound (PLAN sections 6 and 10); Phase 5 plays them. */
  contacts: {
    /** Minimum contact impulse (N s) over one physics step for an event. */
    impulseThreshold: 0.5,
    /** A contact is "new" when the collider had no force event in the previous this-many steps. */
    newGapSteps: 6,
    /** Per-collider refractory period, seconds. */
    refractorySeconds: 1,
    /** At most this many contact events per second overall. */
    maxPerSecond: 2,
  },

  /** Decor (PLAN section 9): placed 8-16 m from the centreline by a PRNG seeded from the level id. */
  decor: {
    perMetre: 0.5,
    minDistM: 8,
    maxDistM: 16,
    /** Share of trees and clouds; the rest are flat discs. */
    treeShare: 0.5,
    cloudShare: 0.25,
    /** Placement attempts per item before it is dropped (the track may curve back on itself). */
    maxTries: 12,
    treeScale: [0.8, 1.5],
    cloudScale: [1.2, 2.2],
    discScale: [1.5, 3],
    /** Clouds float this high above the track frame's floor, metres. */
    cloudHeight: [4, 9],
    /** Trees and discs sit this far below the frame's floor level. */
    groundDropM: 0.3,
    segments: 8,
    /**
     * Cloud colour multiplier. Lambert lighting from a hemisphere light greys a white shape, so
     * the vertex colour is pushed past 1 and the lit result clamps back to a soft white.
     */
    cloudBrightness: 1.45,
  },

  /** Checkpoint and finish arches, flags (PLAN sections 5 and 9). All visual. */
  arch: {
    postWidthM: 0.4,
    /** Height of the underside of the beam. The camera is ~4.5 m above the floor, so it passes under. */
    beamHeightM: 7.5,
    beamThicknessM: 0.5,
    beamDepthM: 0.4,
    /** Posts stand this far outside the outer face of the walls. */
    outsetM: 0.5,
    /** Finish arch: size of the chequered squares on its beam. */
    checkerM: 0.5,
    /** Flag pole on top of a checkpoint arch, and the cloth. */
    poleHeightM: 1.6,
    poleWidthM: 0.14,
    clothWidthM: 1.2,
    clothHeightM: 0.8,
    /** The cloth slides down the pole by this much when the checkpoint is passed... */
    dropM: 0.7,
    /** ...over this many seconds, spinning this many turns about the pole. */
    dropSeconds: 0.8,
    spinTurns: 2,
  },

  /** Autopilot finish-time proxy for Big kid, seconds [min, max] (PLAN section 13). */
  bigkidLevelSeconds: [12, 60],

  /** Physics world (PLAN section 6). */
  physics: {
    gravity: -9.81,
    /** The ball starts on the start pad, at this arc length (frame 0 = the pad's centre). */
    startArcM: 0,
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
    /** Pillar / gate repulsion (PLAN section 13): window along the track, clearance and strength. */
    postAheadM: 6,
    postBehindM: 1,
    /** Posts whose arc positions differ by less than this belong to the same group (a gate). */
    postGroupM: 0.5,
    postMarginM: 0.5,
    postGain: 4,
  },
} as const;

export function pixelRatioCap(isTouchDevice: boolean): number {
  return isTouchDevice ? tuning.pixelRatioCapTouch : tuning.pixelRatioCapDesktop;
}

export function pickPixelRatio(devicePixelRatio: number, isTouchDevice: boolean): number {
  return Math.min(devicePixelRatio, pixelRatioCap(isTouchDevice));
}
