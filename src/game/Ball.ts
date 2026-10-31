import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { BALL_OUTLINE, ballCharacters, type BallCharacter } from '../config/brand';
import { tuning, type TierTuning } from '../config/tuning';
import type { Frame } from './Spline';

/** What the player (or the autopilot) asks for this step. */
export interface ControlInput {
  /** True while the ball should be driven (always for Tiny, finger-down for Big kid). */
  driving: boolean;
  /** -1..1; positive = viewer's right. */
  steer: number;
}

/** Track context for one control step, from `Progress`. */
export interface ControlContext {
  /** Nearest track frame. */
  frame: Frame;
  /** Signed distance from the centreline (positive = viewer's right). */
  lateralOffset: number;
  /** Playable track width, metres. */
  width: number;
  tier: TierTuning;
}

/** The ball: dynamic Rapier body, quartered two-tone mesh with outline, and a blob shadow. */
export class Ball {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  /** Render root (interpolated transform + respawn scale). Add to the scene. */
  readonly group = new THREE.Group();
  /** Flat blob shadow, a separate scene object so it does not rotate with the ball. */
  readonly shadow: THREE.Mesh;

  /** Visual scale, 0..1, used by the respawn scale-out / scale-in. */
  visualScale = 1;
  /** Consecutive physics steps spent driving at less than `stuckSpeed`. */
  stuckSteps = 0;

  private readonly body0: THREE.Mesh;
  private readonly outline: THREE.Mesh;
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly shadowNormal = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);
  private readonly dt = 1 / tuning.physicsHz;

  constructor(
    private readonly world: RAPIER.World,
    spawn: THREE.Vector3Like,
    character: BallCharacter = ballCharacters[0],
  ) {
    const b = tuning.ball;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .setCcdEnabled(true)
        .setLinearDamping(b.drivingDamping)
        .setAngularDamping(b.angularDamping)
        // A ball that never sleeps keeps the control forces and the stuck timer honest.
        .setCanSleep(false),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(b.radius)
        // Explicit mass (not density) so a force in newtons reads as m/s^2 (PLAN section 6).
        .setMass(b.mass)
        .setFriction(b.friction)
        .setRestitution(b.restitution)
        // Contact force events for the bump / wall sound (Phase 5 plays them). The threshold is
        // a force: the configured impulse per step divided by the step length.
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(tuning.contacts.impulseThreshold * tuning.physicsHz),
      this.body,
    );

    const v = tuning.ballVisual;
    const geometry = new THREE.SphereGeometry(
      b.radius,
      v.widthSegments,
      v.heightSegments,
    ).toNonIndexed();
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3),
    );
    this.body0 = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.setCharacter(character);

    this.outline = new THREE.Mesh(
      new THREE.SphereGeometry(b.radius * v.outlineScale, v.widthSegments, v.heightSegments),
      new THREE.MeshBasicMaterial({ color: BALL_OUTLINE, side: THREE.BackSide }),
    );
    this.group.add(this.body0, this.outline);

    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(b.radius, 24),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: v.shadowOpacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.shadow.visible = false;

    this.teleportSnapshot();
    this.applyRender(1);
  }

  /** Colours the quartered ball: opposite quarters (by sign of x and z) alternate main/quarter. */
  setCharacter(character: BallCharacter): void {
    const geometry = this.body0.geometry;
    const pos = geometry.getAttribute('position');
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
    const main = new THREE.Color(character.main);
    const quarter = new THREE.Color(character.quarter);
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const c = cx > 0 !== cz > 0 ? main : quarter;
      for (let k = 0; k < 3; k++) colors.setXYZ(i + k, c.r, c.g, c.b);
    }
    colors.needsUpdate = true;
  }

  /** Ball centre in the physics world. */
  position(): RAPIER.Vector {
    return this.body.translation();
  }

  /** Linear speed, m/s. */
  speed(): number {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /**
   * Control forces for one physics step (PLAN section 6), applied as impulses of `F * dt` so
   * nothing persists between steps:
   * - drive along the track tangent, proportional to the remaining speed headroom, x1.5 uphill;
   * - lane controller: a lateral force that drives the sideways speed to a target proportional to
   *   the lane error, where the lane is `steer * (width / 2 - radius - laneMargin)`;
   * - damping: light while driving, `brakeDamping` otherwise (the parking brake);
   * - a horizontal-only speed clamp at `maxSpeed * speedClampFactor`.
   * Also maintains the stuck counter.
   */
  applyControls(ctl: ControlInput, ctx: ControlContext): void {
    const { frame: f, tier } = ctx;
    const b = tuning.ball;
    const v = this.body.linvel();
    const vTan = v.x * f.tangent.x + v.y * f.tangent.y + v.z * f.tangent.z;
    const vLat = v.x * f.right.x + v.y * f.right.y + v.z * f.right.z;

    let fx = 0;
    let fy = 0;
    let fz = 0;

    if (ctl.driving) {
      let drive = tier.drive * Math.min(1, Math.max(0, 1 - vTan / tier.maxSpeed));
      const slopeDeg = (Math.asin(Math.max(-1, Math.min(1, f.tangent.y))) * 180) / Math.PI;
      if (slopeDeg > b.uphillBoostAboveDeg) drive *= b.uphillBoost;
      fx += f.tangent.x * drive;
      fy += f.tangent.y * drive;
      fz += f.tangent.z * drive;
    }

    const steer = Math.max(-1, Math.min(1, ctl.steer));
    const maxOffset = ctx.width / 2 - b.radius - tier.laneMargin;
    const targetOffset = steer * maxOffset;
    const vLatTarget = Math.max(
      -tier.maxLateral,
      Math.min(tier.maxLateral, tier.laneGain * (targetOffset - ctx.lateralOffset)),
    );
    const lateralForce = tier.steerGain * (vLatTarget - vLat);
    fx += f.right.x * lateralForce;
    fy += f.right.y * lateralForce;
    fz += f.right.z * lateralForce;

    // mass is 1 kg, so impulse = force * dt.
    const k = this.dt / b.mass;
    this.body.applyImpulse({ x: fx * k, y: fy * k, z: fz * k }, true);
    // The parking brake damps rolling too: otherwise the spin keeps feeding the linear velocity
    // through friction and the ball creeps down a ramp.
    this.body.setLinearDamping(ctl.driving ? b.drivingDamping : tier.brakeDamping);
    this.body.setAngularDamping(ctl.driving ? b.angularDamping : tier.brakeDamping);

    // Horizontal-only speed clamp (keeps falling speed intact).
    const w = this.body.linvel();
    const limit = tier.maxSpeed * b.speedClampFactor;
    const horizontal = Math.hypot(w.x, w.z);
    if (horizontal > limit) {
      const s = limit / horizontal;
      this.body.setLinvel({ x: w.x * s, y: w.y, z: w.z * s }, true);
    }

    // Stuck detection: driving yet barely moving.
    if (ctl.driving && Math.hypot(w.x, w.y, w.z) < b.stuckSpeed) this.stuckSteps++;
    else this.stuckSteps = 0;
  }

  /** True once the ball has been driving but stuck for `stuckSeconds`. */
  isStuck(): boolean {
    return this.stuckSteps >= tuning.ball.stuckSeconds * tuning.physicsHz;
  }

  /** Teleport, stop dead and drop any pending forces; render state snaps (no interpolation). */
  placeAt(pos: THREE.Vector3Like): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
    this.stuckSteps = 0;
    this.teleportSnapshot();
  }

  /** Record the physics transform after a step (keeps the previous one for interpolation). */
  snapshot(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.readBody();
  }

  /** Make both interpolation endpoints the current transform. */
  teleportSnapshot(): void {
    this.readBody();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  private readBody(): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    this.currPos.set(p.x, p.y, p.z);
    this.currQuat.set(q.x, q.y, q.z, q.w);
  }

  /** Interpolated render position (valid after `applyRender`). */
  get renderPosition(): THREE.Vector3 {
    return this.group.position;
  }

  /** Pose the render objects between the last two physics states (alpha 0..1). */
  applyRender(alpha: number): void {
    this.group.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.group.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    this.group.scale.setScalar(Math.max(0.0001, this.visualScale));
    this.group.visible = this.visualScale > 0.001;
  }

  /**
   * Blob shadow: raycast straight down against the floor collider only, orient to the hit
   * normal, lift 2 cm, and shrink / fade with height.
   */
  updateShadow(floor: RAPIER.Collider): void {
    const v = tuning.ballVisual;
    const p = this.group.position;
    this.ray.origin.x = p.x;
    this.ray.origin.y = p.y;
    this.ray.origin.z = p.z;
    const hit = this.world.castRayAndGetNormal(
      this.ray,
      v.shadowMaxDistM,
      true,
      undefined,
      undefined,
      undefined,
      this.body,
      (c) => c.handle === floor.handle,
    );
    if (!hit || this.visualScale <= 0.001) {
      this.shadow.visible = false;
      return;
    }
    const n = hit.normal;
    this.shadowNormal.set(n.x, n.y, n.z);
    if (this.shadowNormal.y < 0) this.shadowNormal.negate();
    const hitY = p.y - hit.timeOfImpact;
    const height = Math.max(0, hit.timeOfImpact - tuning.ball.radius);
    this.shadow.position.set(p.x, hitY, p.z).addScaledVector(this.shadowNormal, v.shadowLiftM);
    this.shadow.quaternion.setFromUnitVectors(this.zAxis, this.shadowNormal);
    this.shadow.scale.setScalar(
      (v.shadowRadiusScale / (1 + height * v.shadowFadePerM)) * this.visualScale,
    );
    (this.shadow.material as THREE.MeshBasicMaterial).opacity =
      v.shadowOpacity / (1 + height * v.shadowFadePerM);
    this.shadow.visible = true;
  }

  dispose(): void {
    this.body0.geometry.dispose();
    (this.body0.material as THREE.Material).dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
