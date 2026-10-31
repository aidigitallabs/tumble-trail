import * as THREE from 'three';
import { tuning, type TierTuning } from '../config/tuning';
import type { Frame } from './Spline';

/** Vertical FOV (degrees) that gives a constant horizontal FOV at a given aspect ratio. */
export function verticalFovFor(horizontalFovDeg: number, aspect: number): number {
  const h = (horizontalFovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / Math.max(0.01, aspect)) * 180) / Math.PI;
}

/**
 * Follow camera (PLAN section 7). Sits behind and above the ball along a smoothed horizontal
 * tangent, never rolls, looks a little ahead of the ball so the ball is framed lower-middle, and
 * keeps a constant *horizontal* field of view in both orientations.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;

  private readonly tHoriz = new THREE.Vector3(0, 0, 1);
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private rise = 0;
  private reducedMotion = false;

  constructor(private tier: TierTuning) {
    const c = tuning.camera;
    this.camera = new THREE.PerspectiveCamera(60, 1, c.near, c.far);
    this.setAspect(1);
  }

  setTier(tier: TierTuning): void {
    this.tier = tier;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.fov = verticalFovFor(tuning.camera.horizontalFovDeg, aspect);
    this.camera.updateProjectionMatrix();
  }

  /** Tangent flattened to XZ and normalised (falls back to the previous direction if vertical). */
  private flatten(out: THREE.Vector3, frame: Frame): boolean {
    out.set(frame.tangent.x, 0, frame.tangent.z);
    if (out.lengthSq() < 1e-8) return false;
    out.normalize();
    return true;
  }

  /** Hard-snap: no smoothing from the previous pose (load, respawn). */
  snap(ballPos: THREE.Vector3, frames: readonly Frame[], index: number): void {
    const frame = frames[index] as Frame;
    this.flatten(this.tHoriz, frame);
    this.rise = this.trackRise(frames, index);
    this.place(ballPos);
  }

  /** Per rendered frame: ease the heading and the rise, then place the camera. */
  update(dt: number, ballPos: THREE.Vector3, frames: readonly Frame[], index: number): void {
    const frame = frames[index] as Frame;
    let rate = this.tier.cameraSmoothing;
    if (this.reducedMotion) rate *= tuning.camera.reducedMotionSmoothing;
    const k = 1 - Math.exp(-rate * Math.max(0, dt));
    if (this.flatten(this.desired, frame)) {
      this.tHoriz.lerp(this.desired, k);
      if (this.tHoriz.lengthSq() < 1e-8) this.tHoriz.copy(this.desired);
      this.tHoriz.normalize();
    }
    this.rise += (this.trackRise(frames, index) - this.rise) * k;
    this.place(ballPos);
  }

  /** Height of the frame `cameraBack` metres behind minus the current frame's, never negative. */
  private trackRise(frames: readonly Frame[], index: number): number {
    const behind = Math.max(
      0,
      index - Math.round(this.tier.cameraBack / tuning.spline.frameSpacingM),
    );
    return Math.max(0, (frames[behind] as Frame).pos.y - (frames[index] as Frame).pos.y);
  }

  private place(ballPos: THREE.Vector3): void {
    const t = this.tier;
    this.camera.position
      .copy(ballPos)
      .addScaledVector(this.tHoriz, -t.cameraBack)
      .add(this.desired.set(0, t.cameraUp + this.rise, 0));
    this.look
      .copy(ballPos)
      .addScaledVector(this.tHoriz, t.cameraLookAhead)
      .add(this.desired.set(0, tuning.camera.lookAtUpM, 0));
    this.camera.up.set(0, 1, 0); // no roll, ever
    this.camera.lookAt(this.look);
  }
}
