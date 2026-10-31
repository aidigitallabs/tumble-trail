import * as THREE from 'three';
import { palettes } from '../config/brand';
import { tuning } from '../config/tuning';
import { buildArches, buildFlagCloth, type FlagAnchor } from './Arches';
import { buildDecorGeometries, placeDecor, type DecorKind } from './Decor';
import type { GameWorld } from './GameWorld';
import { balloonColors, buildBalloonGeometry, buildPostVisual } from './Obstacles';

export interface LevelViewOptions {
  /** `prefers-reduced-motion`: the checkpoint flag drops without spinning. */
  reducedMotion?: boolean;
}

const Y = new THREE.Vector3(0, 1, 0);

/** 0..1 ease-out (cubic). */
function easeOut(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t));
  return 1 - u * u * u;
}

/**
 * Everything you see of a level except the ball: track, walls, bumps, pillars and gates, balloons,
 * checkpoint / finish arches with their flags, and the decor. Built from a `GameWorld`; shares the
 * world's floor / wall / bump geometry (which the world disposes). `update(dt)` advances the purely
 * visual animations (balloon pop, flag drop) by the rendered frame time; they follow world state
 * (`balloons[i].popped`, `progress.checkpointsPassed`), so a fast-forward needs no catch-up.
 *
 * Draw calls: floor, walls, bumps, props, balloons, flags and up to three decor shapes.
 */
export class LevelView {
  readonly group = new THREE.Group();

  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly owned: THREE.BufferGeometry[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];

  private readonly balloonMesh: THREE.InstancedMesh | null;
  /** Seconds since each balloon's pop was first seen (-1 = not popped). */
  private readonly popAge: number[];
  private readonly flagMesh: THREE.InstancedMesh | null;
  private readonly flagAnchors: FlagAnchor[];
  /** Seconds since each flag's checkpoint was first seen passed (-1 = not passed). */
  private readonly flagAge: number[];
  private readonly spinTurns: number;
  private readonly decorCount: Record<DecorKind, number> = { tree: 0, cloud: 0, disc: 0 };
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpRot = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpBasis = new THREE.Matrix4();

  constructor(
    private readonly sim: GameWorld,
    options: LevelViewOptions = {},
  ) {
    const palette = palettes[sim.level.palette];
    this.spinTurns = options.reducedMotion ? 0 : tuning.arch.spinTurns;

    // Track.
    this.group.add(new THREE.Mesh(sim.geoms.floor, this.material));
    if (sim.geoms.walls.getAttribute('position').count > 0) {
      this.group.add(new THREE.Mesh(sim.geoms.walls, this.material));
    }
    if (sim.bumpGeometry) this.group.add(new THREE.Mesh(sim.bumpGeometry, this.material));

    // Posts, banners, arches and flag poles are static: one merged mesh.
    const arches = buildArches(
      sim.spline,
      sim.width,
      sim.level.checkpointsM,
      sim.spline.finishM,
      palette,
    );
    const posts = buildPostVisual(sim.obstacles, palette);
    const props = mergeGeometries([arches.geometry, posts]);
    this.owned.push(props);
    this.group.add(new THREE.Mesh(props, this.material));

    // Balloons: one instanced mesh (sphere + string), tinted per instance.
    const balloons = sim.balloons;
    this.popAge = balloons.map(() => -1);
    if (balloons.length > 0) {
      const geometry = buildBalloonGeometry();
      this.owned.push(geometry);
      this.balloonMesh = this.addInstanced(geometry, balloons.length);
      balloons.forEach((b, i) => {
        this.balloonMesh?.setColorAt(i, new THREE.Color(balloonColors[i % balloonColors.length]));
        this.setBalloonScale(i, b.centre, 1);
      });
      if (this.balloonMesh?.instanceColor) this.balloonMesh.instanceColor.needsUpdate = true;
    } else {
      this.balloonMesh = null;
    }

    // Flags: one instanced cloth per checkpoint.
    this.flagAnchors = arches.flags;
    const passed = sim.progress.checkpointsPassed;
    this.flagAge = this.flagAnchors.map((_, i) => (i < passed ? Infinity : -1));
    if (this.flagAnchors.length > 0) {
      const cloth = buildFlagCloth(palette);
      this.owned.push(cloth);
      this.flagMesh = this.addInstanced(cloth, this.flagAnchors.length);
      this.flagAnchors.forEach((_, i) => this.setFlagPose(i));
    } else {
      this.flagMesh = null;
    }

    // Decor: up to three instanced shapes.
    const shapes = buildDecorGeometries(palette);
    const items = placeDecor(sim.level.id, sim.spline);
    for (const kind of ['tree', 'cloud', 'disc'] as DecorKind[]) {
      const mine = items.filter((d) => d.kind === kind);
      this.decorCount[kind] = mine.length;
      const geometry = shapes[kind];
      this.owned.push(geometry);
      if (mine.length === 0) continue;
      const mesh = this.addInstanced(geometry, mine.length);
      mine.forEach((d, i) => {
        this.tmpRot.makeRotationY(d.yaw);
        this.tmpMatrix.makeScale(d.scale, d.scale, d.scale);
        this.tmpMatrix.premultiply(this.tmpRot);
        this.tmpMatrix.setPosition(d.pos);
        mesh.setMatrixAt(i, this.tmpMatrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Number of decor items per kind (for tests and stats). */
  decorCounts(): Readonly<Record<DecorKind, number>> {
    return this.decorCount;
  }

  /** Current visual state of checkpoint flag `i`: cloth height drop (m) and spin (radians). */
  flagPose(i: number): { dropM: number; spin: number; passed: boolean } {
    const age = this.flagAge[i] as number;
    const t = age < 0 ? 0 : age / tuning.arch.dropSeconds;
    return {
      dropM: tuning.arch.dropM * easeOut(t),
      spin: 2 * Math.PI * this.spinTurns * easeOut(t),
      passed: age >= 0,
    };
  }

  /** Advance the balloon pops and flag drops by `dt` seconds of rendered time. */
  update(dt: number): void {
    const balloons = this.sim.balloons;
    let balloonsDirty = false;
    balloons.forEach((b, i) => {
      let age = this.popAge[i] as number;
      if (b.popped && age < 0) age = 0;
      else if (age >= 0 && age < tuning.obstacles.balloon.popSeconds) age += dt;
      else return;
      this.popAge[i] = age;
      const bt = tuning.obstacles.balloon;
      const t = age / bt.popSeconds;
      const scale =
        t >= 1
          ? 0
          : t < bt.popPeakAt
            ? 1 + (bt.popPeakScale - 1) * (t / bt.popPeakAt)
            : bt.popPeakScale * (1 - (t - bt.popPeakAt) / (1 - bt.popPeakAt));
      this.setBalloonScale(i, b.centre, scale);
      balloonsDirty = true;
    });
    if (balloonsDirty && this.balloonMesh) this.balloonMesh.instanceMatrix.needsUpdate = true;

    const passed = this.sim.progress.checkpointsPassed;
    let flagsDirty = false;
    for (let i = 0; i < this.flagAge.length; i++) {
      let age = this.flagAge[i] as number;
      if (i < passed && age < 0) age = 0;
      else if (age >= 0 && age < tuning.arch.dropSeconds) age += dt;
      else continue;
      this.flagAge[i] = age;
      this.setFlagPose(i);
      flagsDirty = true;
    }
    if (flagsDirty && this.flagMesh) this.flagMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of this.instanced) m.dispose();
    for (const g of this.owned) g.dispose();
    this.material.dispose();
    this.group.clear();
  }

  private addInstanced(geometry: THREE.BufferGeometry, count: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, this.material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Small meshes whose instances move: cheaper to always draw than to keep bounds fresh.
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.instanced.push(mesh);
    return mesh;
  }

  private setBalloonScale(i: number, centre: THREE.Vector3, scale: number): void {
    this.tmpMatrix.makeScale(scale, scale, scale);
    this.tmpMatrix.setPosition(centre);
    this.balloonMesh?.setMatrixAt(i, this.tmpMatrix);
  }

  /** Cloth pose: top at the pole top, lowered by the drop, spun about the pole. */
  private setFlagPose(i: number): void {
    const anchor = this.flagAnchors[i] as FlagAnchor;
    const { dropM, spin } = this.flagPose(i);
    const half = tuning.arch.clothHeightM / 2;
    this.tmpBasis.makeBasis(anchor.right, Y, new THREE.Vector3().crossVectors(anchor.right, Y));
    this.tmpRot.makeRotationY(spin);
    this.tmpMatrix.multiplyMatrices(this.tmpRot, this.tmpBasis);
    this.tmpPos.copy(anchor.poleTop).addScaledVector(Y, -half - dropM);
    this.tmpMatrix.setPosition(this.tmpPos);
    this.flagMesh?.setMatrixAt(i, this.tmpMatrix);
  }
}

/** Concatenate non-indexed geometries that share attributes (position, normal, color). */
function mergeGeometries(parts: Array<THREE.BufferGeometry | null>): THREE.BufferGeometry {
  const used = parts.filter((p): p is THREE.BufferGeometry => p !== null);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = used.map((g) => g.getAttribute(name).array as Float32Array);
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const a of arrays) {
      merged.set(a, at);
      at += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3));
  }
  for (const g of used) g.dispose();
  return out;
}
