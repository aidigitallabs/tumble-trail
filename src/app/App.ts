import * as THREE from 'three';
import { palettes } from '../config/brand';
import { pickPixelRatio, tuning } from '../config/tuning';
import { FollowCamera } from '../game/Camera';
import { GameWorld } from '../game/GameWorld';
import { LevelView } from '../game/LevelView';
import { getLevel } from '../levels';
import type { Tier } from '../levels/schema';
import { fastForwardSim } from './fastForward';
import { GameLoop } from './GameLoop';
import { Input } from './Input';
import type { TT, TTHost, TTState, TTStats } from './tt';

/**
 * Renderer, scene, state machine and the glue between input, the simulation (`GameWorld`), the
 * fixed-step loop and the follow camera. Phase 1b: boots straight into a level; screens arrive in
 * Phase 4.
 */
export class App implements TTHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly rendererString: string | null;
  state: TTState = 'boot';

  private readonly scene = new THREE.Scene();
  private readonly followCam: FollowCamera;
  private readonly input = new Input();
  private readonly loop: GameLoop;
  private readonly levelGroup = new THREE.Group();
  private view: LevelView | null = null;
  private reducedMotion = false;
  private readonly fog = new THREE.Fog(0xffffff, tuning.render.fogNear, tuning.render.fogFar);

  private tier: Tier = 'tiny';
  private pendingTier: Tier = 'tiny';
  private _autopilot = false;
  private sim: GameWorld | null = null;
  private lastRespawnCount = 0;
  private started = false;
  private lastTime = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const isTouch = navigator.maxTouchPoints > 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pickPixelRatio(window.devicePixelRatio || 1, isTouch));

    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererString =
      String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null;

    const r = tuning.render;
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight(0xffffff, r.hemisphereGround, r.hemisphereIntensity));
    const sun = new THREE.DirectionalLight(0xffffff, r.sunIntensity);
    sun.position.set(r.sunPosition[0], r.sunPosition[1], r.sunPosition[2]);
    this.scene.add(sun);
    this.scene.add(this.levelGroup);

    this.followCam = new FollowCamera(tuning.tiers[this.tier]);
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reducedMotion = motion?.matches ?? false;
    this.followCam.setReducedMotion(this.reducedMotion);

    this.loop = new GameLoop(() => this.physicsStep());
    this.input.attach(canvas);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(document.documentElement);
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.lastTime = 0;
      this.loop.reset();
    });
  }

  // ---- debug contract (TTHost) ----------------------------------------------------------------

  get autopilot(): boolean {
    return this._autopilot;
  }

  set autopilot(on: boolean) {
    this._autopilot = on;
    if (this.sim) this.sim.autopilot = on;
  }

  /** Applies on the next `loadLevel`. */
  setTier(t: Tier): void {
    this.pendingTier = t;
  }

  /** Rebuild the world and track for a level; resolves when `state === 'playing'`. */
  async loadLevel(id: string): Promise<void> {
    const level = getLevel(id);
    if (!level) throw new Error(`Unknown level "${id}"`);

    this.disposeLevel();
    this.tier = this.pendingTier;
    const sim = new GameWorld(level, this.tier);
    sim.autopilot = this._autopilot;
    this.sim = sim;

    const palette = palettes[level.palette];
    this.scene.background = new THREE.Color(palette.sky);
    this.fog.color.set(palette.fog);

    this.view = new LevelView(sim, { reducedMotion: this.reducedMotion });
    this.levelGroup.add(this.view.group, sim.ball.group, sim.ball.shadow);

    this.input.configure(sim.tierTuning.driveMode, sim.tierTuning.steerDecay);
    this.followCam.setTier(sim.tierTuning);
    this.loop.reset();
    this.snapCamera();
    this.lastRespawnCount = sim.respawnCount;
    this.setState('playing');
  }

  /**
   * Synchronous fast-forward: physics steps only, no render / audio / effects. Runs the autopilot
   * inside each step when `autopilot` is on, and returns early once `until` is reached. The rAF
   * loop cannot run while this does, so it is paused by construction.
   */
  fastForward(maxSeconds: number, until?: TTState): { state: TTState; seconds: number } {
    const sim = this.sim;
    if (!sim || (until && this.state === until)) return { state: this.state, seconds: 0 };
    const n = fastForwardSim(
      sim,
      this.input,
      maxSeconds,
      () => !!until && this.state === until,
      () => {
        sim.drainEvents();
        this.syncState();
      },
    );
    this.loop.reset();
    sim.ball.applyRender(1);
    return { state: this.state, seconds: n / tuning.physicsHz };
  }

  stats(): TTStats {
    const info = this.renderer.info;
    return { triangles: info.render.triangles, drawCalls: info.render.calls, fps: this.fps };
  }

  balloons(): { total: number; popped: number } {
    const b = this.sim?.balloons ?? [];
    return { total: b.length, popped: b.filter((x) => x.popped).length };
  }

  obstacles(): Record<'bump' | 'pillar' | 'gate' | 'balloon', number> {
    const counts = { bump: 0, pillar: 0, gate: 0, balloon: 0 };
    for (const o of this.sim?.obstacles ?? []) counts[o.kind]++;
    return counts;
  }

  trackWidth(): number {
    return this.sim?.width ?? tuning.tiers[this.tier].width;
  }

  ballState(): ReturnType<TT['ball']> {
    const sim = this.sim;
    if (!sim) return { pos: [0, 0, 0], vel: [0, 0, 0], t: 0, lateral: 0 };
    const p = sim.ball.body.translation();
    const v = sim.ball.body.linvel();
    return {
      pos: [p.x, p.y, p.z],
      vel: [v.x, v.y, v.z],
      t: sim.progress.t,
      lateral: sim.progress.lateralOffset,
    };
  }

  // ---- loop -----------------------------------------------------------------------------------

  /** Starts the render loop. Physics inside it is stepped by `GameLoop`, never by a clock read. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const frame = (nowMs: number): void => {
      const dt = this.lastTime === 0 ? 0 : Math.min((nowMs - this.lastTime) / 1000, 0.25);
      this.lastTime = nowMs;
      this.renderFrame(dt);
      this.trackFps(nowMs);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private renderFrame(dt: number): void {
    const sim = this.sim;
    if (sim) {
      this.input.update(dt);
      const { alpha } = this.loop.advance(dt);
      this.view?.update(dt);
      sim.ball.applyRender(alpha);
      if (sim.respawnCount !== this.lastRespawnCount) {
        this.lastRespawnCount = sim.respawnCount;
        this.snapCamera();
      } else {
        this.followCam.update(dt, sim.ball.renderPosition, sim.spline.frames, sim.progress.index);
      }
      sim.ball.updateShadow(sim.colliders.floor);
    }
    this.renderer.render(this.scene, this.followCam.camera);
  }

  /** One fixed physics step (called by `GameLoop`). Reads no clock. */
  private physicsStep(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.step(this.input.controls);
    sim.drainEvents(); // Phase 5 will play these; until then they are simply dropped
    this.syncState();
  }

  private syncState(): void {
    if (this.sim?.state === 'finished' && this.state === 'playing') this.setState('finished');
  }

  /** Any state change releases the pointer and ignores input for 500 ms (PLAN section 6). */
  private setState(s: TTState): void {
    this.state = s;
    this.input.lock();
  }

  private snapCamera(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.ball.applyRender(1);
    this.followCam.snap(sim.ball.renderPosition, sim.spline.frames, sim.progress.index);
  }

  private disposeLevel(): void {
    this.levelGroup.clear();
    this.view?.dispose();
    this.view = null;
    this.sim?.dispose();
    this.sim = null;
  }

  private resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.followCam.setAspect(w / h);
    // The viewport and the pointer release on resize are owned by `Input.attach`.
  }

  private trackFps(nowMs: number): void {
    this.fpsFrames++;
    if (this.fpsSince === 0) this.fpsSince = nowMs;
    if (nowMs - this.fpsSince >= 1000) {
      this.fps = (this.fpsFrames * 1000) / (nowMs - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = nowMs;
    }
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
