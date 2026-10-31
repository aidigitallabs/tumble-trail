import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { pickPixelRatio, tuning } from '../config/tuning';
import type { TTStats } from './tt';

/**
 * Phase 0 smoke scene: a two-tone sphere drops onto a plane under Rapier physics, rendered by
 * three.js. It proves WASM + WebGL work in the browser and in headless CI. Replaced in Phase 1b.
 */
export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly rendererString: string | null;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: RAPIER.World;
  private readonly body: RAPIER.RigidBody;
  private readonly ballMesh: THREE.Mesh;
  private accumulator = 0;
  private lastTime = 0;
  private fps = 0;
  private fpsFrames = 0;
  private fpsSince = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const s = tuning.smoke;
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

    // Palette-ish colours; real palettes arrive in Phase 2 (brand.ts).
    const sky = new THREE.Color('#bfe6ff');
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 18, 45);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#a8d5a2', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(4, 8, 3);
    this.scene.add(sun);

    // Ground plane.
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(s.planeHalfSize * 2, s.planeThickness, s.planeHalfSize * 2),
      new THREE.MeshLambertMaterial({ color: '#8fd694' }),
    );
    ground.position.y = -s.planeThickness / 2;
    this.scene.add(ground);

    // Two-tone (quartered) ball, coloured per triangle so the quarters have crisp edges.
    const sphere = new THREE.SphereGeometry(s.ballRadius, 24, 16).toNonIndexed();
    const pos = sphere.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    const a = new THREE.Color('#e5484d');
    const b = new THREE.Color('#ffffff');
    for (let i = 0; i < pos.count; i += 3) {
      const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
      const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
      const c = cx > 0 !== cz > 0 ? a : b;
      for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
    }
    sphere.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.ballMesh = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(this.ballMesh);

    this.camera = new THREE.PerspectiveCamera(s.verticalFov, 1, 0.1, 100);
    this.camera.position.set(0, s.cameraUp, s.cameraBack);
    this.camera.lookAt(0, s.cameraLookAtY, 0);

    // Physics.
    this.world = new RAPIER.World({ x: 0, y: s.gravity, z: 0 });
    this.world.timestep = 1 / tuning.physicsHz;
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(s.planeHalfSize, s.planeThickness / 2, s.planeHalfSize)
        .setTranslation(0, -s.planeThickness / 2, 0)
        .setFriction(0.8),
    );
    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, s.ballStartHeight, 0)
        .setCcdEnabled(true)
        .setAngularDamping(0.1),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.ball(s.ballRadius)
        .setMass(1)
        .setFriction(0.8)
        .setRestitution(s.ballRestitution),
      this.body,
    );
    this.syncMesh();

    this.resize();
    new ResizeObserver(() => this.resize()).observe(document.documentElement);
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  /** Starts the render loop. The physics step itself never reads a clock (PLAN section 0). */
  start(): void {
    const frame = (nowMs: number) => {
      const dt = this.lastTime === 0 ? 0 : Math.min((nowMs - this.lastTime) / 1000, 0.25);
      this.lastTime = nowMs;
      this.accumulator += dt;
      const step = 1 / tuning.physicsHz;
      let n = 0;
      while (this.accumulator >= step && n < tuning.maxSubSteps) {
        this.stepPhysics();
        this.accumulator -= step;
        n++;
      }
      if (n === tuning.maxSubSteps) this.accumulator = 0;
      this.syncMesh();
      this.renderer.render(this.scene, this.camera);
      this.trackFps(nowMs);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private stepPhysics(): void {
    this.world.step();
  }

  private syncMesh(): void {
    const p = this.body.translation();
    const q = this.body.rotation();
    this.ballMesh.position.set(p.x, p.y, p.z);
    this.ballMesh.quaternion.set(q.x, q.y, q.z, q.w);
  }

  private resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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

  stats(): TTStats {
    const info = this.renderer.info;
    return { triangles: info.render.triangles, drawCalls: info.render.calls, fps: this.fps };
  }

  ballState(): { pos: [number, number, number]; vel: [number, number, number] } {
    const p = this.body.translation();
    const v = this.body.linvel();
    return { pos: [p.x, p.y, p.z], vel: [v.x, v.y, v.z] };
  }

  get canvasElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
