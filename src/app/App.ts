import * as THREE from 'three';
import { ballCharacters, palettes } from '../config/brand';
import { pickPixelRatio, tuning } from '../config/tuning';
import { GameAudio } from '../game/Audio';
import { FollowCamera } from '../game/Camera';
import { Effects } from '../game/Effects';
import { GameWorld, type SimEvent } from '../game/GameWorld';
import { LevelView } from '../game/LevelView';
import { getLevel, levels } from '../levels';
import type { LevelDef, Tier } from '../levels/schema';
import { fastForwardSim } from './fastForward';
import { initialFlow, transition, type FlowEvent, type FlowState } from './flow';
import { GameLoop } from './GameLoop';
import { Input } from './Input';
import { reducedMotionFromWindow, type ReducedMotion } from './motion';
import { UpdateGate } from './updateGate';
import { playableLevels, type LevelInfo } from './levelList';
import type { BallIndex, Persistence, SaveData } from './Persistence';
import { Screens, type ScreensHost } from './Screens';
import type { TT, TTAudio, TTEffects, TTHost, TTState, TTStats } from './tt';
import { WakeLockKeeper } from './wakeLock';

const ORIGIN = new THREE.Vector3();
/** Safety cap on queued sim events between two rendered frames (a hidden tab keeps stepping). */
const MAX_PENDING_EVENTS = 64;

/** Ground speed of the ball, m/s (the vertical component is a fall, not rolling). */
function horizontalSpeed(sim: GameWorld): number {
  const v = sim.ball.body.linvel();
  return Math.hypot(v.x, v.z);
}

export interface AppOptions {
  persistence: Persistence;
  /** Shown as plain text in the parent menu. */
  version: string;
  /** The `#ui` element the screens render into. */
  uiRoot: HTMLElement;
}

/**
 * Renderer, scene, state machine and the glue between input, the simulation (`GameWorld`), the
 * fixed-step loop, the follow camera and the DOM screens. `setState`-style changes all go through
 * `dispatch` (the pure transition table in `flow.ts`).
 */
export class App implements TTHost, ScreensHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly rendererString: string | null;
  state: TTState = 'boot';
  readonly levels: readonly LevelInfo[] = playableLevels(levels);
  readonly version: string;

  private flow: FlowState = initialFlow;
  private readonly persistence: Persistence;
  private readonly screens: Screens;
  private readonly wake = new WakeLockKeeper();

  private readonly scene = new THREE.Scene();
  private readonly followCam: FollowCamera;
  private readonly input = new Input();
  private readonly loop: GameLoop;
  private readonly levelGroup = new THREE.Group();
  private view: LevelView | null = null;
  private readonly motion: ReducedMotion;
  private readonly audio: GameAudio;
  private readonly effects = new Effects();
  /** Sim events handed over by the physics step, consumed by the render step (sound, effects). */
  private pendingEvents: SimEvent[] = [];
  /** The flow state the effects / sounds last reacted to (parent menu counts as what is under it). */
  private fxBase: TTState = 'boot';
  private fxRespawnCount = 0;
  private readonly fog = new THREE.Fog(0xffffff, tuning.render.fogNear, tuning.render.fogFar);

  /** Tier of the loaded world. */
  private tier: Tier = 'tiny';
  /** Set by `__tt.setTier` (tests); beats the selected ball's tier until the parent menu changes it. */
  private tierOverride: Tier | null = null;
  private _autopilot = false;
  private sim: GameWorld | null = null;
  /** The loaded world is the title / level-select backdrop (autopilot, no HUD). */
  private simIsDemo = false;
  private demoRestart = false;
  /** Index into `levels` of the loaded world, or -1 (demo, or a level outside the game's list). */
  private levelIndex = -1;
  private run = { stars: 0, maxStars: 0, final: false };
  private celebrateLeft = 0;
  private idleSeconds = 0;
  private lastAlpha = 1;
  private lastRespawnCount = 0;
  private started = false;
  private lastTime = 0;
  private fpsValue = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private readonly updates = new UpdateGate();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: AppOptions,
  ) {
    this.persistence = opts.persistence;
    this.version = opts.version;
    const lowGraphics = this.persistence.data.lowGraphics;
    const isTouch = navigator.maxTouchPoints > 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowGraphics,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      lowGraphics
        ? Math.min(window.devicePixelRatio || 1, tuning.pixelRatioLowGraphics)
        : pickPixelRatio(window.devicePixelRatio || 1, isTouch),
    );

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
    this.motion = reducedMotionFromWindow();
    this.applyReducedMotion(this.motion.value);
    this.motion.subscribe((on) => this.applyReducedMotion(on));

    // Audio: nothing is created until the first pointerup (iOS user activation), then resume() is
    // retried on every later one while the context is not running.
    this.audio = new GameAudio({ muted: this.persistence.data.muted });
    window.addEventListener('pointerup', () => this.audio.unlock(), { capture: true });
    this.scene.add(this.effects.group);

    this.loop = new GameLoop(() => this.physicsStep());
    this.input.attach(canvas);
    // The screens attach their own window-level gate listeners, which run before Input's.
    this.screens = new Screens(opts.uiRoot, this);

    this.resize();
    new ResizeObserver(() => this.resize()).observe(document.documentElement);
    window.visualViewport?.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.lastTime = 0;
      this.loop.reset();
      this.audio.setVisible(document.visibilityState === 'visible');
    });
  }

  /** boot -> title: the backdrop level starts running behind the title screen. */
  showTitle(): void {
    this.dispatch({ type: 'ready' });
  }

  /**
   * A new service worker is waiting. It is applied only on the title screen (PLAN section 8):
   * immediately if we are there, otherwise as soon as we get there.
   */
  setUpdateHandler(apply: () => void): void {
    this.updates.offer(apply, this.state);
  }

  // ---- debug contract (TTHost) ----------------------------------------------------------------

  get autopilot(): boolean {
    return this._autopilot;
  }

  set autopilot(on: boolean) {
    this._autopilot = on;
    if (this.sim) this.sim.autopilot = on || this.simIsDemo;
  }

  /** Test hook: applies on the next `loadLevel`; does not touch the save. */
  setTier(t: Tier): void {
    this.tierOverride = t;
  }

  /**
   * Test hook: rebuild the world and track for a level and go straight to `playing`, bypassing the
   * title and the celebration. Resolves when `state === 'playing'`.
   */
  async loadLevel(id: string): Promise<void> {
    const level = getLevel(id);
    if (!level) throw new Error(`Unknown level "${id}"`);
    this.buildSim(level, this.wantedTier(), false);
    this.dispatch({ type: 'forcePlay' });
  }

  levelId(): string {
    return this.sim?.level.id ?? '';
  }

  /**
   * Synchronous fast-forward: physics steps only, no render / audio / effects. Runs the autopilot
   * inside each step when `autopilot` is on, and returns early once `until` is reached. The rAF
   * loop cannot run while this does, so it is paused by construction. With `until: 'finished'`
   * the 3 s celebration that follows the finish is skipped.
   */
  fastForward(maxSeconds: number, until?: TTState): { state: TTState; seconds: number } {
    const sim = this.sim;
    if (!sim || (until && this.state === until)) return { state: this.state, seconds: 0 };
    let steps = 0;
    if (this.state === 'playing') {
      steps = fastForwardSim(
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
      this.resetFx();
      sim.ball.applyRender(1);
    }
    if (until === 'finished' && this.state === 'celebrating') this.skipCelebration();
    return { state: this.state, seconds: steps / tuning.physicsHz };
  }

  stats(): TTStats {
    const info = this.renderer.info;
    return { triangles: info.render.triangles, drawCalls: info.render.calls, fps: this.fpsValue };
  }

  audioStatus(): TTAudio {
    return { state: this.audio.state, muted: this.audio.muted };
  }

  effectsStatus(): TTEffects {
    return { particles: this.effects.activeCount, reducedMotion: this.motion.value };
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

  inputLocked(): boolean {
    return this.input.locked;
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

  // ---- screens host (ScreensHost) ---------------------------------------------------------------

  save(): SaveData {
    return this.persistence.data;
  }

  fps(): number {
    return this.fpsValue;
  }

  lastRun(): { stars: number; maxStars: number; final: boolean } {
    return this.run;
  }

  selectBall(i: BallIndex): void {
    this.persistence.selectBall(i);
    this.sim?.ball.setCharacter(ballCharacters[i]);
    this.screens.refresh();
  }

  /** Title play button / Finished next button: the level this ball should play next. */
  play(): void {
    const p = this.persistence.selected;
    const last = this.levels.length - 1;
    let index = Math.min(p.currentLevel, last);
    if (p.tier === 'bigkid') index = Math.min(index, Math.max(0, p.unlocked - 1));
    this.startLevel(index);
  }

  openLevels(): void {
    this.dispatch({ type: 'openLevels' });
  }

  playLevel(index: number): void {
    this.startLevel(index);
  }

  toLevels(): void {
    this.dispatch({ type: 'toLevels' });
  }

  levelsHome(): void {
    this.dispatch({ type: 'levelsHome' });
  }

  openParent(): void {
    this.dispatch({ type: 'openParent' });
  }

  /**
   * Resume. If the ball's tier was switched while a level was paused, that level restarts with the
   * new tier (a half-played level cannot change its track width).
   */
  closeParent(): void {
    const sim = this.sim;
    if (
      this.flow.under === 'playing' &&
      sim &&
      !this.simIsDemo &&
      this.wantedTier() !== this.tier
    ) {
      this.buildSim(sim.level, this.wantedTier(), false);
    }
    this.dispatch({ type: 'closeParent' });
    this.loop.reset();
  }

  parentHome(): void {
    this.dispatch({ type: 'parentHome' });
  }

  setBallTier(t: Tier): void {
    this.persistence.setTier(this.persistence.data.selectedBall, t);
    this.tierOverride = null;
    this.screens.refresh();
  }

  buttonPressed(): void {
    this.audio.play('click');
  }

  setMuted(muted: boolean): void {
    this.persistence.setMuted(muted);
    this.audio.setMuted(muted);
    this.screens.refresh();
  }

  /** Persist, then reload so the renderer is rebuilt with dpr 1 and no MSAA. */
  setLowGraphics(on: boolean): void {
    this.persistence.setLowGraphics(on);
    this.screens.refresh();
    window.location.reload();
  }

  resetBall(): void {
    this.persistence.resetBall(this.persistence.data.selectedBall);
    this.screens.refresh();
  }

  dismissCard(): void {
    this.persistence.markParentCardSeen();
  }

  // ---- state machine ----------------------------------------------------------------------------

  /** Apply a flow event if it is valid now. Every state change locks input for 500 ms. */
  private dispatch(e: FlowEvent): boolean {
    const next = transition(this.flow, e);
    if (!next) return false;
    this.flow = next;
    this.state = next.state;
    this.input.lock();

    const s = next.state;
    if ((s === 'title' || s === 'levelSelect') && !this.simIsDemo) this.loadDemo();
    this.wake.set(s === 'playing' || (s === 'parentMenu' && next.under === 'playing'));
    if (s === 'playing') this.idleSeconds = tuning.ui.idleHintSeconds[this.tier];
    this.screens.show(next);
    this.updates.check(s);
    return true;
  }

  private wantedTier(): Tier {
    return this.tierOverride ?? this.persistence.selected.tier;
  }

  private startLevel(index: number): void {
    if (!transition(this.flow, { type: 'play' })) return;
    const info = this.levels[index];
    if (!info) return;
    this.persistence.setCurrentLevel(this.persistence.data.selectedBall, index);
    this.buildSim(info.def, this.wantedTier(), false);
    this.dispatch({ type: 'play' });
  }

  /** The sim reached the finish: record stars, unlock the next level (on the event itself), celebrate. */
  private onSimFinished(): void {
    const sim = this.sim;
    if (!sim) return;
    const stars = sim.progress.checkpointsPassed + 1;
    const info = this.levelIndex >= 0 ? this.levels[this.levelIndex] : undefined;
    if (info) {
      this.persistence.recordFinish(
        this.persistence.data.selectedBall,
        this.levelIndex,
        info.id,
        stars,
        this.levels.length,
      );
    }
    this.run = {
      stars,
      maxStars: sim.level.checkpointsM.length + 1,
      final: !!info && this.levelIndex === this.levels.length - 1,
    };
    this.celebrateLeft = tuning.ui.celebrationSeconds;
    this.dispatch({ type: 'finish' });
  }

  private skipCelebration(): void {
    this.celebrateLeft = 0;
    this.dispatch({ type: 'celebrationDone' });
  }

  private syncState(): void {
    const sim = this.sim;
    if (!sim || sim.state !== 'finished') return;
    if (this.simIsDemo) this.demoRestart = true;
    else if (this.state === 'playing') this.onSimFinished();
  }

  // ---- worlds -----------------------------------------------------------------------------------

  private loadDemo(): void {
    const first = this.levels[0];
    if (first) this.buildSim(first.def, 'tiny', true);
  }

  /** Dispose the old world and build `level` for `tier`. Does not change the flow state. */
  private buildSim(level: LevelDef, tier: Tier, demo: boolean): void {
    this.disposeLevel();
    this.tier = tier;
    const sim = new GameWorld(level, tier);
    sim.autopilot = demo || this._autopilot;
    sim.ball.setCharacter(ballCharacters[this.persistence.data.selectedBall]);
    this.sim = sim;
    this.simIsDemo = demo;
    this.levelIndex = demo ? -1 : this.levels.findIndex((l) => l.id === level.id);

    const palette = palettes[level.palette];
    this.scene.background = new THREE.Color(palette.sky);
    this.fog.color.set(palette.fog);

    this.view = new LevelView(sim, { reducedMotion: this.motion.value });
    this.effects.setPalette(palette);
    this.resetFx();
    this.levelGroup.add(this.view.group, sim.ball.group, sim.ball.shadow);

    this.input.configure(sim.tierTuning.driveMode, sim.tierTuning.steerDecay);
    this.followCam.setTier(sim.tierTuning);
    this.loop.reset();
    this.snapCamera();
    this.lastRespawnCount = sim.respawnCount;
    this.idleSeconds = tuning.ui.idleHintSeconds[tier];
  }

  // ---- loop -------------------------------------------------------------------------------------

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
    if (this.demoRestart) {
      this.demoRestart = false;
      if (this.simIsDemo) this.loadDemo();
    }
    this.screens.tick(dt);
    if (this.state === 'celebrating') {
      this.celebrateLeft -= dt;
      if (this.celebrateLeft <= 0) this.skipCelebration();
    }

    const sim = this.sim;
    if (sim) {
      this.input.update(dt);
      // The parent menu pauses physics; the world just stands there behind it.
      if (this.state !== 'parentMenu') this.lastAlpha = this.loop.advance(dt).alpha;
      this.view?.update(dt);
      this.renderFx(dt, sim);
      sim.ball.applyRender(this.lastAlpha);
      if (sim.respawnCount !== this.lastRespawnCount) {
        this.lastRespawnCount = sim.respawnCount;
        this.snapCamera();
      } else {
        this.followCam.update(dt, sim.ball.renderPosition, sim.spline.frames, sim.progress.index);
      }
      sim.ball.updateShadow(sim.colliders.floor);
    }
    this.effects.update(dt, this.followCam.camera, sim?.ball.renderPosition ?? ORIGIN);
    this.updateHud(dt);
    this.renderer.render(this.scene, this.followCam.camera);
  }

  /** Stars-so-far (Big kid) and the idle hand hint. Neither is interactive. */
  private updateHud(dt: number): void {
    const sim = this.sim;
    const base = this.flow.state === 'parentMenu' ? this.flow.under : this.flow.state;
    const playing = base === 'playing' && !!sim && !this.simIsDemo;
    this.screens.setHud(
      playing && this.tier === 'bigkid',
      sim?.progress.checkpointsPassed ?? 0,
      (sim?.level.checkpointsM.length ?? 0) + 1,
    );
    if (!playing || this.state !== 'playing' || this._autopilot) {
      this.screens.setHint(false);
      return;
    }
    if (this.input.pointerActive) this.idleSeconds = 0;
    else this.idleSeconds += dt;
    this.screens.setHint(this.idleSeconds >= tuning.ui.idleHintSeconds[this.tier]);
  }

  /** One fixed physics step (called by `GameLoop`). Reads no clock. */
  private physicsStep(): void {
    const sim = this.sim;
    if (!sim) return;
    sim.step(this.input.controls);
    // Hand the events to the render step: sound and effects never run inside the physics step.
    for (const e of sim.drainEvents()) this.pendingEvents.push(e);
    if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
      this.pendingEvents.splice(0, this.pendingEvents.length - MAX_PENDING_EVENTS);
    }
    this.syncState();
  }

  private applyReducedMotion(on: boolean): void {
    this.followCam.setReducedMotion(on);
    this.effects.setReducedMotion(on);
  }

  /** Drop everything in flight: a new level, or a fast-forward that skipped frames. */
  private resetFx(): void {
    this.pendingEvents = [];
    this.effects.reset();
    this.sim?.ball.squash.set(1, 1, 1);
    // Respawns that happened while skipping frames get no boop and no glow.
    this.fxRespawnCount = this.sim?.respawnCount ?? 0;
  }

  /**
   * Sound and effects for this rendered frame (PLAN sections 9 and 10). Render step only: it reads
   * the events the physics step queued, never the physics step itself. The title / level-select
   * backdrop is silent but still shows its pops.
   */
  private renderFx(dt: number, sim: GameWorld): void {
    const live = !this.simIsDemo;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    for (const e of events) {
      if (e.type === 'pop') {
        const b = sim.balloons[e.index];
        if (b) this.effects.popBurst(b.centre, e.index);
        if (live) this.audio.play('pop');
      } else if (e.type === 'checkpoint') {
        this.effects.sparkle(sim.ball.renderPosition);
        if (live) this.audio.play('checkpoint');
      } else if (live) {
        this.audio.play('contact');
      }
    }

    if (sim.respawnCount !== this.fxRespawnCount) {
      this.fxRespawnCount = sim.respawnCount;
      this.effects.respawn();
      if (live) this.audio.play('respawn');
    }

    const base: TTState =
      this.flow.state === 'parentMenu' ? (this.flow.under ?? 'title') : this.flow.state;
    if (base !== this.fxBase) {
      if (base === 'celebrating' && live) {
        this.effects.celebrate(sim.ball.renderPosition, this.run.final);
        this.audio.play('celebration');
      } else if (base === 'finished' && live) {
        this.audio.starTicks(this.run.stars, tuning.ui.starStepMs / 1000);
      }
      this.fxBase = base;
    }

    // Rolling hum: only while actually playing a level (not the backdrop, not under the menu).
    const rolling = live && this.state === 'playing' && !sim.respawning;
    const ratio = rolling ? Math.min(1, horizontalSpeed(sim) / sim.tierTuning.maxSpeed) : 0;
    this.audio.setRolling(ratio);

    // Landing squash: velocity along the track's up (a ramp is not a landing).
    const ball = sim.ball;
    if (this.motion.value || sim.respawning || this.state === 'parentMenu') {
      this.effects.landing.reset();
      ball.squash.set(1, 1, 1);
    } else {
      const v = ball.body.linvel();
      const up = sim.progress.frame.up;
      this.effects.landing.sample(v.x * up.x + v.y * up.y + v.z * up.z);
      this.effects.landing.update(dt, ball.squash);
    }
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
      this.fpsValue = (this.fpsFrames * 1000) / (nowMs - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = nowMs;
    }
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
