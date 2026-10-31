import * as THREE from 'three';
import { palettes, type Palette } from '../config/brand';
import { tuning } from '../config/tuning';
import { mulberry32 } from './Decor';
import { balloonColors } from './Obstacles';

/**
 * Render-side effects (PLAN sections 8, 9 and 16): confetti on the celebration, a sparkle at
 * checkpoints, a burst when a balloon pops, the landing squash and a soft ball-local glow on
 * respawn. Everything here is driven from the render step (`update(dt, ...)`); nothing runs inside
 * `GameWorld.step` or `fastForward`. Particles are quads in ONE `InstancedMesh` (one draw call).
 */

const KIND_CONFETTI = 0;
const KIND_SPARK = 1;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** sRGB hex. */
  color: number;
  lifeS: number;
  size: number;
  /** y-scale / x-scale of the quad. */
  aspect: number;
  spin: number;
  spinRate: number;
  /** Tumble axis (confetti); billboards spin about the view axis. */
  ax: number;
  ay: number;
  az: number;
  kind: typeof KIND_CONFETTI | typeof KIND_SPARK;
  gravity: number;
  /** Air drag, 1/s. */
  drag: number;
}

/** Struct-of-arrays particle pool: `spawn`, `update(dt)`; dead particles are swap-removed. */
export class ParticleSystem {
  count = 0;
  /** Spawns that found the pool full (cosmetic, simply dropped). */
  dropped = 0;
  readonly pos: Float32Array;
  readonly vel: Float32Array;
  /** Linear-space colour, ready for the instance colour attribute. */
  readonly col: Float32Array;
  readonly axis: Float32Array;
  readonly life: Float32Array;
  readonly maxLife: Float32Array;
  readonly size: Float32Array;
  readonly aspect: Float32Array;
  readonly spin: Float32Array;
  readonly spinRate: Float32Array;
  readonly gravity: Float32Array;
  readonly drag: Float32Array;
  readonly kind: Uint8Array;
  private readonly tmpColor = new THREE.Color();

  constructor(readonly capacity: number) {
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.axis = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.aspect = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.spinRate = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.kind = new Uint8Array(capacity);
  }

  spawn(p: ParticleSpawn): boolean {
    if (this.count >= this.capacity) {
      this.dropped++;
      return false;
    }
    const i = this.count++;
    const k = i * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.vel[k] = p.vx;
    this.vel[k + 1] = p.vy;
    this.vel[k + 2] = p.vz;
    this.tmpColor.set(p.color);
    this.col[k] = this.tmpColor.r;
    this.col[k + 1] = this.tmpColor.g;
    this.col[k + 2] = this.tmpColor.b;
    this.axis[k] = p.ax;
    this.axis[k + 1] = p.ay;
    this.axis[k + 2] = p.az;
    this.life[i] = p.lifeS;
    this.maxLife[i] = p.lifeS;
    this.size[i] = p.size;
    this.aspect[i] = p.aspect;
    this.spin[i] = p.spin;
    this.spinRate[i] = p.spinRate;
    this.gravity[i] = p.gravity;
    this.drag[i] = p.drag;
    this.kind[i] = p.kind;
    return true;
  }

  /** Integrate by `dt` seconds and remove the dead. */
  update(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      this.life[i] = (this.life[i] as number) - dt;
      if ((this.life[i] as number) <= 0) {
        this.removeAt(i);
        continue;
      }
      const k = i * 3;
      const keep = Math.exp(-(this.drag[i] as number) * dt);
      this.vel[k + 1] = (this.vel[k + 1] as number) + (this.gravity[i] as number) * dt;
      for (let a = 0; a < 3; a++) {
        this.vel[k + a] = (this.vel[k + a] as number) * keep;
        this.pos[k + a] = (this.pos[k + a] as number) + (this.vel[k + a] as number) * dt;
      }
      this.spin[i] = (this.spin[i] as number) + (this.spinRate[i] as number) * dt;
      i++;
    }
  }

  clear(): void {
    this.count = 0;
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const copy3 = (a: Float32Array): void => {
      a[i * 3] = a[last * 3] as number;
      a[i * 3 + 1] = a[last * 3 + 1] as number;
      a[i * 3 + 2] = a[last * 3 + 2] as number;
    };
    for (const a of [this.pos, this.vel, this.col, this.axis]) copy3(a);
    for (const a of [
      this.life,
      this.maxLife,
      this.size,
      this.aspect,
      this.spin,
      this.spinRate,
      this.gravity,
      this.drag,
    ]) {
      a[i] = a[last] as number;
    }
    this.kind[i] = this.kind[last] as number;
  }
}

/** How many confetti pieces a celebration releases (0 under `prefers-reduced-motion`). */
export function confettiCount(final: boolean, reducedMotion: boolean): number {
  if (reducedMotion) return 0;
  const e = tuning.effects;
  return Math.min(300, final ? e.finalConfettiCount : e.confettiCount);
}

/** Scale multiplier over a particle's life: grows in quickly, shrinks away at the end. */
export function lifeScale(age: number, life: number): number {
  const e = tuning.effects;
  const grow = e.growS > 0 ? Math.min(1, age / e.growS) : 1;
  const left = life - age;
  const fade = e.fadeS > 0 ? Math.min(1, Math.max(0, left / e.fadeS)) : 1;
  return Math.max(0, Math.min(grow, fade));
}

/** Opacity of the respawn glow `age` seconds after it started. */
export function glowOpacity(age: number): number {
  const g = tuning.effects.glow;
  if (age < 0 || age >= g.riseS + g.fallS) return 0;
  return g.peak * (age < g.riseS ? age / g.riseS : 1 - (age - g.riseS) / g.fallS);
}

/** Scale of the ball `age` seconds after a landing: full squash, relaxing linearly (PLAN 16). */
export function squashScale(age: number, out: THREE.Vector3): THREE.Vector3 {
  const s = tuning.effects.squash;
  const k = age >= s.seconds ? 1 : Math.max(0, age) / s.seconds;
  const xz = s.xz + (1 - s.xz) * k;
  const y = s.y + (1 - s.y) * k;
  return out.set(xz, y, xz);
}

/**
 * Landing detector for the squash: the ball's velocity along the track's `up` was a hard
 * downward speed and has now (nearly) stopped, i.e. the sign flipped or the ball came to rest on
 * the floor. Using the track-relative component means rolling down a ramp is not a landing.
 */
export class LandingSquash {
  private prevUp = 0;
  private age = Infinity;

  /** True when this sample is a landing. */
  sample(vUp: number): boolean {
    const s = tuning.effects.squash;
    const landed = this.prevUp < -s.minImpactSpeed && vUp > -s.landedSpeed;
    this.prevUp = vUp;
    if (landed) this.age = 0;
    return landed;
  }

  /** Advance the relax timer; writes the current scale into `out`. */
  update(dt: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.age < tuning.effects.squash.seconds) this.age += Math.max(0, dt);
    return squashScale(this.age, out);
  }

  reset(): void {
    this.prevUp = 0;
    this.age = Infinity;
  }
}

/** A 32x32 radial-falloff alpha texture for the respawn glow (generated, no asset). */
function glowTexture(): THREE.DataTexture {
  const n = tuning.effects.glow.textureSize;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot((x + 0.5) / n - 0.5, (y + 0.5) / n - 0.5) * 2;
      const a = Math.max(0, 1 - d);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(255 * a * a);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

interface Wave {
  at: number;
  count: number;
  origin: THREE.Vector3;
}

export class Effects {
  readonly group = new THREE.Group();
  readonly particles: ParticleSystem;
  readonly landing = new LandingSquash();

  private readonly mesh: THREE.InstancedMesh;
  private readonly colors: THREE.InstancedBufferAttribute;
  private readonly glow: THREE.Mesh;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly glowTex: THREE.DataTexture;
  private readonly rng = mulberry32(tuning.effects.seed);
  private readonly waves: Wave[] = [];
  private clock = 0;
  private glowAge = Infinity;
  private reducedMotion = false;
  private palette: number[] = [];

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly qz = new THREE.Quaternion();
  private readonly axis = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly zAxis = new THREE.Vector3(0, 0, 1);

  constructor(capacity: number = tuning.effects.maxQuads) {
    this.particles = new ParticleSystem(capacity);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colors;
    // Instances move every frame: always draw rather than keep bounds fresh.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;

    this.glowTex = glowTexture();
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      color: tuning.effects.glow.color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMaterial);
    this.glow.scale.setScalar(tuning.effects.glow.sizeM);
    this.glow.renderOrder = 10;
    this.glow.frustumCulled = false;
    this.glow.visible = false;

    this.group.add(this.mesh, this.glow);
    this.setPalette(palettes.meadow);
  }

  get activeCount(): number {
    return this.particles.count;
  }

  get isReducedMotion(): boolean {
    return this.reducedMotion;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (on) {
      this.waves.length = 0;
      this.landing.reset();
    }
  }

  /** Confetti colours: the level palette plus the balloon colours. */
  setPalette(p: Palette): void {
    this.palette = [p.accent, p.trackStripe, p.wall, p.decorA, p.decorB, ...balloonColors];
  }

  /** Forget everything in flight (level load, fast-forward). */
  reset(): void {
    this.particles.clear();
    this.waves.length = 0;
    this.glowAge = Infinity;
    this.landing.reset();
    this.sync(null);
  }

  /** The celebration: confetti released in waves from `origin` (the ball). No-op when reduced. */
  celebrate(origin: THREE.Vector3Like, final: boolean): void {
    const total = confettiCount(final, this.reducedMotion);
    if (total === 0) return;
    const e = tuning.effects;
    const waves = Math.max(1, e.confettiWaves);
    let left = total;
    for (let w = 0; w < waves; w++) {
      const count = w === waves - 1 ? left : Math.floor(total / waves);
      left -= count;
      this.waves.push({
        at: this.clock + w * e.confettiWaveS,
        count,
        origin: new THREE.Vector3(origin.x, origin.y, origin.z),
      });
    }
  }

  /** A balloon pop: a small burst of coloured quads at the balloon. */
  popBurst(centre: THREE.Vector3Like, index: number): void {
    const e = tuning.effects;
    const color = balloonColors[index % balloonColors.length] as number;
    for (let i = 0; i < e.popBurstCount; i++) {
      const a = (i / e.popBurstCount) * Math.PI * 2 + this.rng() * 0.5;
      const elev = (this.rng() - 0.3) * 1.2;
      const speed = this.range(e.popBurstSpeed);
      this.particles.spawn({
        x: centre.x,
        y: centre.y,
        z: centre.z,
        vx: Math.cos(a) * speed,
        vy: Math.sin(elev) * speed + 1,
        vz: Math.sin(a) * speed,
        color,
        lifeS: this.range(e.popBurstLifeS),
        size: e.popBurstSize,
        aspect: 1,
        spin: this.rng() * Math.PI,
        spinRate: this.range(e.confettiSpin),
        ...this.randomAxis(),
        kind: KIND_CONFETTI,
        gravity: e.popBurstGravity,
        drag: 0.8,
      });
    }
  }

  /** Checkpoint sparkle: diamonds rising around `origin` (the ball). */
  sparkle(origin: THREE.Vector3Like): void {
    const e = tuning.effects;
    for (let i = 0; i < e.sparkleCount; i++) {
      const a = (i / e.sparkleCount) * Math.PI * 2 + this.rng() * 0.4;
      const r = e.sparkleRadius * (0.7 + this.rng() * 0.6);
      this.particles.spawn({
        x: origin.x + Math.cos(a) * r,
        y: origin.y + this.rng() * 0.8,
        z: origin.z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.3,
        vy: this.range(e.sparkleRise),
        vz: Math.sin(a) * 0.3,
        color: this.pick(),
        lifeS: this.range(e.sparkleLifeS),
        size: e.sparkleSize,
        aspect: 1,
        spin: Math.PI / 4,
        spinRate: (this.rng() - 0.5) * 3,
        ax: 0,
        ay: 0,
        az: 1,
        kind: KIND_SPARK,
        gravity: 0,
        drag: 0.5,
      });
    }
  }

  /** Respawn: start the soft glow around the ball. */
  respawn(): void {
    this.glowAge = 0;
  }

  /**
   * Per rendered frame: release due confetti waves, move particles, then pose the instances and
   * the glow facing `camera`. `ballPos` is where the glow sits.
   */
  update(dt: number, camera: THREE.Camera, ballPos: THREE.Vector3Like): void {
    this.clock += Math.max(0, dt);
    while (this.waves.length > 0 && (this.waves[0] as Wave).at <= this.clock) {
      const w = this.waves.shift() as Wave;
      this.spawnConfetti(w.count, w.origin);
    }
    this.particles.update(dt);
    this.sync(camera);

    if (this.glowAge < Infinity) this.glowAge += Math.max(0, dt);
    const opacity = glowOpacity(this.glowAge);
    this.glow.visible = opacity > 0.001;
    if (this.glow.visible) {
      this.glowMaterial.opacity = opacity;
      this.glow.position.set(ballPos.x, ballPos.y, ballPos.z);
      this.glow.quaternion.copy(camera.quaternion);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
    this.glow.geometry.dispose();
    this.glowMaterial.dispose();
    this.glowTex.dispose();
    this.group.clear();
  }

  // ---- internals -------------------------------------------------------------------------------

  private range(r: readonly number[]): number {
    const lo = r[0] as number;
    const hi = r[1] as number;
    return lo + (hi - lo) * this.rng();
  }

  private pick(): number {
    return this.palette[Math.floor(this.rng() * this.palette.length)] as number;
  }

  private randomAxis(): { ax: number; ay: number; az: number } {
    const x = this.rng() - 0.5;
    const y = this.rng() - 0.5;
    const z = this.rng() - 0.5;
    const len = Math.hypot(x, y, z) || 1;
    return { ax: x / len, ay: y / len, az: z / len };
  }

  private spawnConfetti(count: number, origin: THREE.Vector3): void {
    const e = tuning.effects;
    for (let i = 0; i < count; i++) {
      const a = this.rng() * Math.PI * 2;
      const out = this.range(e.confettiOut);
      this.particles.spawn({
        x: origin.x + (this.rng() - 0.5) * 0.6,
        y: origin.y + 0.6,
        z: origin.z + (this.rng() - 0.5) * 0.6,
        vx: Math.cos(a) * out,
        vy: this.range(e.confettiUp),
        vz: Math.sin(a) * out,
        color: this.pick(),
        lifeS: this.range(e.confettiLifeS),
        size: e.confettiSize,
        aspect: e.confettiAspect,
        spin: this.rng() * Math.PI * 2,
        spinRate: this.range(e.confettiSpin),
        ...this.randomAxis(),
        kind: KIND_CONFETTI,
        gravity: e.confettiGravity,
        drag: e.confettiDrag,
      });
    }
  }

  /** Write the pool into the instanced mesh (matrices and colours). */
  private sync(camera: THREE.Camera | null): void {
    const ps = this.particles;
    const n = ps.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0 && camera !== null;
    if (n === 0 || !camera) return;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const scale =
        (ps.size[i] as number) *
        lifeScale((ps.maxLife[i] as number) - (ps.life[i] as number), ps.maxLife[i] as number);
      if (ps.kind[i] === KIND_SPARK) {
        this.qz.setFromAxisAngle(this.zAxis, ps.spin[i] as number);
        this.q.copy(camera.quaternion).multiply(this.qz);
        this.s.set(scale, scale, 1);
      } else {
        this.axis.set(ps.axis[k] as number, ps.axis[k + 1] as number, ps.axis[k + 2] as number);
        this.q.setFromAxisAngle(this.axis, ps.spin[i] as number);
        this.s.set(scale, scale * (ps.aspect[i] as number), 1);
      }
      this.p.set(ps.pos[k] as number, ps.pos[k + 1] as number, ps.pos[k + 2] as number);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.colors.array as Float32Array).set(ps.col.subarray(0, n * 3));
    this.colors.needsUpdate = true;
  }
}
