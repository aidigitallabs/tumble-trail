# Tumble Trail — v1 Build Plan

**Date:** 31 Oct 2026
**Status:** v2 — revised after two adversarial reviews (technical + toddler-UX). Changelog in §19.
**Author:** Claude (with Nick)
**Audience:** Sonnet-class coding agents executing the build, one phase per session.
**Working name:** *Tumble Trail*. Nothing in the code depends on the name except `src/config/brand.ts`.
**Repo:** `aidigitallabs/tumble-trail` (pre-created by Nick, public, Pages source = "GitHub Actions"). Agents clone it; they never create repos.

---

## 0. How to use this document (read first, agent)

- This is the **single source of truth** for v1. If code and document disagree, the document wins unless a `docs/DECISIONS.md` entry explains why.
- Work is split into **phases (§16)**. Do **one phase per session**, in order.
- Every *Done when* item is tagged **[agent]** or **[human]**. All **[agent]** items must be green before the next phase. **[human]** items are recorded as `PENDING HUMAN: <item>` in `docs/PROGRESS.md` and **do not block** the next phase.
- Every phase ends with: tests green, `npm run build` green, one commit on `main`, push, and a `docs/PROGRESS.md` entry (done / skipped-and-why / look-at-next / PENDING HUMAN list).
- **Do not guess library APIs.** Read the `.d.ts` under `node_modules/` for the installed version. Never downgrade a dependency to match a remembered API.
- **Never skip, disable or weaken a test** to get green. If a test is wrong, fix it and say so in the commit.
- All tunable numbers live in **`src/config/tuning.ts`**. No magic numbers in game code.
- Guardrails in **§15** are not negotiable.
- If something is ambiguous: choose the **simplest option that keeps a 3-year-old able to play**, log it in `docs/DECISIONS.md`, carry on. Stop to ask only when actually blocked.
- Nothing inside `GameLoop.step()` may read a clock (`performance.now`, `Date`). Determinism matters for tests.

---

## 1. Goal and non-goals

### Goal
A free, ad-free, original **rolling-ball obstacle course** that runs in Safari on iPads (2018 or newer), installed to the home screen as a web app. Playable by a **3-year-old without help**, still fun for 5–8-year-old siblings.

### Non-goals for v1
- App Store / native build. Multiplayer, accounts, cloud saves, leaderboards.
- Any monetisation. No ads, purchases, currencies, timed rewards.
- **Gaps in the track** (reviewed: physically infeasible without a jump mechanic at toddler-safe speeds → v2 with a proper jump).
- Moving obstacles, level editor, tilt steering (v2).
- Android/desktop polish. Desktop must *work* (development + tests) but is not the target.

---

## 2. Players and design principles

| Player | Tier | What they need |
|---|---|---|
| 3-year-old | **Tiny** | Ball always rolls; finger only steers. Wide track, full walls, strong centring, things to touch along the way, no failure states, no reading. |
| 5–8-year-old | **Big kid** | Touch-to-go / lift-to-brake, narrower track with low kerbs, pillars and gates, stars that count **up**, sequential unlock. |

Principles:
1. **Nothing bad ever happens.** Falling = pop back to the last checkpoint with a cheerful sound. No lives, no timers, no counters that go down. Ever, in either tier.
2. **No reading required.** Big icons; text is decoration.
3. **One finger.** The first finger on the glass is the only one that counts.
4. **Short.** Levels are 80–120 m. Big kid finishes in roughly 20–45 s; a toddler in 1–3 min.
5. **Celebrate, then wait.** Finishing is loud and sparkly. **Nothing advances without a deliberate touch.**
6. **Parents stay in control.** A two-corner hold gate opens the parent menu. No in-play buttons at all.
7. **Original.** Own name, look and levels. Only the genre idea is borrowed.

---

## 3. Tech stack (pinned choices)

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript** (strict) | Catches API mistakes. |
| Bundler | **Vite** (vanilla-ts template) | Zero-config, PWA plugin. |
| 3D | **three** | Standard. |
| Physics | **@dimforge/rapier3d-compat** | Robust sphere-on-trimesh, CCD, embeds WASM as base64 so no extra Vite WASM plugins are needed. (Cost: ~1.65 MB gzipped on its own; see §14.) |
| PWA | **vite-plugin-pwa** | Manifest + service worker. |
| Unit tests | **vitest** | |
| E2E | **@playwright/test** (Chromium) | Headless WebGL via SwiftShader with the flags in §13. |
| Lint/format | **eslint** + **typescript-eslint** + **prettier**, defaults | |
| Hosting | **GitHub Pages** via Actions on `main` | Free HTTPS. |
| Audio | **Web Audio API, synthesised** | No files, no licensing. |
| Fonts | System font stack | No runtime network. |

**Pre-approved dev dependencies** (no DECISIONS entry needed): `typescript`, `vite`, `vite-plugin-pwa`, `vitest`, `@playwright/test`, `eslint`, `typescript-eslint`, `prettier`, `@types/node`, `sharp` (icon generation only, run once, PNGs committed).

Use the **latest stable** of each; commit the lockfile. Node current LTS; `npm`.

---

## 4. Architecture

```
src/
  main.ts                 # boot: loading screen, await RAPIER.init(), create App
  app/
    App.ts                # renderer, scene, physics world, state machine, __tt hooks
    GameLoop.ts           # fixed 60 Hz physics (accumulator, max 4 sub-steps), render interpolation
    Input.ts              # first-pointer-only -> { driving, steer }
    Screens.ts            # DOM overlays: title, levelSelect, finished, parentMenu, parentCard
    Persistence.ts        # localStorage, versioned
  game/
    Ball.ts               # mesh + rigid body + control forces + respawn
    Track.ts              # buildRibbonGeometry() (pure) + buildColliders(world, geom)
    Spline.ts             # centripetal Catmull-Rom, arc-length LUT, frames
    Progress.ts           # windowed nearest-frame tracker, t high-water mark, checkpoints, finish
    Camera.ts             # follow camera
    Obstacles.ts          # bump, pillar, gate, balloon
    Decor.ts              # instanced decor, seeded PRNG
    Effects.ts            # confetti, sparkles, squash, blob shadow, respawn vignette
    Audio.ts              # synth SFX
    Autopilot.ts          # test driver (runs inside the physics step)
  levels/
    schema.ts             # LevelDef + validateLevel()
    index.ts              # ordered registry incl. levelTest
    levelTest.ts, level01.ts … level06.ts
  config/
    tuning.ts             # ALL tunables, per tier, with derived-acceleration comments
    brand.ts              # name, palettes, ball characters
tests/unit/  tests/e2e/  public/icons/  scripts/make-icons.mjs
docs/PLAN.md  docs/DECISIONS.md  docs/PROGRESS.md  docs/IDEAS.md  docs/IPAD_CHECKLIST.md
```

### Per-frame flow
1. `Input` → `{ driving: boolean, steer: -1..1 }` (or `Autopilot` when enabled — inside the step, not from rAF).
2. `GameLoop` steps physics at 60 Hz with an accumulator (max 4 sub-steps). Render interpolates the ball transform between the last two physics states (keeps ProMotion 120 Hz iPads smooth).
3. Each step: `Progress.update()` → current frame + `t`; `Ball.applyControls()`; checkpoint/finish/fall/stuck checks; balloon proximity checks.
4. Render: `Camera.update(dt)`, `Effects.update(dt)`, `renderer.render`.

### Debug/test contract — `window.__tt` (always present)
```ts
interface TT {
  state: 'boot'|'title'|'levelSelect'|'playing'|'celebrating'|'finished'|'parentMenu';
  setTier(t: 'tiny'|'bigkid'): void;          // applies on next loadLevel
  loadLevel(id: string): Promise<void>;        // resolves when physics world + track are built and state === 'playing'
  autopilot: boolean;
  fastForward(maxSeconds: number, until?: TT['state']): { state: string; seconds: number };
    // synchronous; steps physics without rendering/audio/effects; runs Autopilot inside each step;
    // returns early when `until` is reached. Pauses the rAF loop while running.
  stats(): { triangles: number; drawCalls: number; fps: number };  // from renderer.info
  trackWidth(): number;
  ball(): { pos: [number,number,number]; vel: [number,number,number]; t: number; lateral: number };
}
```
Nothing in `__tt` can mutate persistence beyond what the UI can.

---

## 5. Level / track data model

```ts
export type Vec3 = [number, number, number];
export type Tier = 'tiny' | 'bigkid';

export interface LevelDef {
  id: string;                 // 'level01'
  name: string;               // decorative
  palette: 'meadow' | 'beach' | 'sky';
  points: Vec3[];             // centripetal Catmull-Rom control points, metres. points[0] = start.
  width?: { tiny?: number; bigkid?: number };            // defaults from tuning
  walls?: { tiny?: 'full'; bigkid?: 'low' | 'none' };    // defaults: tiny 'full', bigkid 'low'
  noWallSpansM?: Array<[number, number]>;                // bigkid only: arc-length ranges (m) with NO kerb (straights only)
  obstacles: Array<{
    atM: number;              // arc-length position in metres
    offset: number;           // metres, +ve = viewer's right
    kind: 'bump' | 'pillar' | 'gate' | 'balloon';
    tiers: Tier[];
  }>;
  checkpointsM: number[];     // arc-length positions, ascending
}
```

**Conventions**
- `worldUp = +Y`. For a frame: `tangent` = spline direction; `right = normalize(cross(tangent, worldUp))` — this is **screen-right for the chase camera**; `up = cross(right, tangent)`. Positive `lateralOffset` = ball is to the viewer's right.
- Spline: `CatmullRomCurve3(points, false, 'centripetal', 0.5)`. Build an arc-length LUT with ≥ 2000 samples (do not rely on the default `arcLengthDivisions`). Frames sampled every `ds = 0.5 m`.
- The **end pad**: 6 m of straight flat track appended beyond the last control point, with a back wall. The **finish line** is at the last control point (`finishM = arcLength(points)`). The **start pad**: a flat 3 m disc under frame 0.

**Obstacle dimensions (fixed)**

| kind | Geometry | Collider | Notes |
|---|---|---|---|
| `bump` | Sinusoidal ridge, height 0.2 m, 1.2 m along the track, spans `width/3` centred at `offset` | Trimesh (same verts) | A "whee" moment. Safe at ≤ 4 m/s with 1.5 m walls. |
| `pillar` | Cylinder r 0.4 m, h 2.0 m, with a 0.3 m conical skirt at the base | `roundCylinder` | Validator: `|offset| ≥ 1.2` and `|offset| ≤ width/2 − 0.9`. |
| `gate` | Two pillars at `offset ± 1.4` plus a **visual-only banner at 6 m** height | Two `roundCylinder` | No lintel collider; the camera (≤ 5 m high) never hits anything. |
| `balloon` | Sphere r 0.5 m floating 1.2 m above the floor on a thin string | **None** (distance check from the ball each step; pop when < 1.1 m) | Pop = scale-burst + 6 confetti quads + sound. Not counted, not required. |

**Walls / kerbs**

| mode | Height | Lean | Collider friction | Used by |
|---|---|---|---|---|
| `full` | 1.5 m | **vertical** | 0 | Tiny |
| `low` | 0.35 m kerb | vertical | 0 | Big kid default |
| `none` | — | — | — | Big kid, only within `noWallSpansM`, only where curvature radius > 30 m |

Walls are omitted for the final 2 m before the finish line so the finish arch is visible; the end pad has its own side + back walls.

**`validateLevel()` rules (all unit-tested)**
1. ≥ 4 control points; consecutive points ≥ 2 m apart; arc length 80–120 m.
2. Max slope between consecutive frames ≤ 20°.
3. Turning radius ≥ 1.0 × tier width (checked per tier) and no wall ribbon self-intersection.
4. Checkpoints ≥ 1 and spacing ≤ 30 m; first ≥ 10 m, last ≤ finishM − 10 m.
5. Obstacles inside `[5 m, finishM − 8 m]`; pillar/gate offsets per the table; no obstacle within 3 m of a checkpoint; Tiny tier may only contain `bump` and `balloon`; pillars/gates must not be on a slope > 8° nor within 4 m of a frame whose turning radius < 12 m.
6. `noWallSpansM` only on frames with radius > 30 m.
7. Balloons: ≥ 1 per 25 m of track in Tiny.

### Track generation (`Track.ts`)
- `buildRibbonGeometry(frames, width, wallMode, noWallSpans)` is **pure** (no Rapier) and returns `{ floor: BufferGeometry, walls: BufferGeometry }`. Triangles wound **CCW seen from above** for the floor, outward-facing for walls.
- `buildColliders(world, geoms)` makes two fixed `TriMesh` colliders with `TriMeshFlags.FIX_INTERNAL_EDGES` from day 1; walls friction 0, restitution 0.3; floor friction 0.8.
- A **catch plane** 10 m below the lowest frame triggers respawn as a last resort.

---

## 6. Physics and controls

### Ball
- Rapier dynamic body, `ball(0.5)` collider; **`collider.setMass(1)` explicitly** (not density). Friction 0.8, restitution 0.2, **CCD on**, angular damping 0.1.
- Linear damping: 0.2 while driving; `brakeDamping = 2.5` when not driving (parking brake so the ball holds on ramps).
- Visual: quartered two-tone sphere with a dark rim/outline so rotation reads and the ball is visible on every palette. Flat **blob shadow**: raycast against the floor mesh only, `polygonOffset`, raised 2 cm.

### Input (`Input.ts`)
- Pointer events on the canvas, `setPointerCapture`. **Only the first active pointer counts**; additional pointers are ignored entirely. Pointers that start within 40 px of any screen edge are ignored (thumbs/palms). `pointercancel`, `blur`, `visibilitychange`, resize → release everything.
- Steer is **absolute from a virtual origin**: `origin = clamp(pointerDownX, steerRangePx, viewportW − steerRangePx)`; `steerRangePx = 0.22 × min(W, H)`; dead zone 40 px; `steer = clamp((x − origin) / steerRangePx, −1, 1)` outside the dead zone.
- **Tiny (`driveMode: 'always'`)**: `driving` is always true; the finger only steers. While the finger is still (moved < 8 px for 1 s), `steer` decays toward 0 over 1 s (`steerDecay`), so a leaned-on finger re-centres instead of grinding.
- **Big kid (`driveMode: 'hold'`)**: `driving = first pointer down`.
- After any screen transition, input is ignored for 500 ms and a **fresh pointerdown** is required.
- Keyboard (development only): arrows/WASD, `steer` ramps ±1 at 4/s.
- HUD/overlay DOM elements never feed `Input`.

### Control forces (`Ball.applyControls`, per physics step)
With frame `f` from `Progress`, `vTan = dot(v, f.tangent)`, `vLat = dot(v, f.right)`:
- **Drive** (if `driving`): `F = f.tangent * drive * clamp(1 − vTan / maxSpeed, 0, 1)` (proportional, no bang-bang). Uphill help: if `asin(f.tangent.y) > 12°`, multiply by 1.5.
- **Lane steering** (both tiers; replaces separate "assist"): `targetOffset = steer * (width/2 − 0.5 − laneMargin)`; `vLatTarget = clamp(laneGain * (targetOffset − lateralOffset), −maxLateral, +maxLateral)`; `F = f.right * steerGain * (vLatTarget − vLat)`. With `steer = 0` this centres the ball, which *is* the Tiny magnet. Target is always inside the track, so a held finger parks the ball in a lane rather than slamming the wall, and curves are handled by the controller rather than the child.
- **Speed clamp**: horizontal component only, via `setLinvel` preserving `y`, at `maxSpeed × 1.3`.
- Forces apply always (no ground check in v1).
- **Stuck detection**: `driving` and speed < 0.3 m/s for 3 s → respawn at the current checkpoint.

### Fall and respawn
- Fall if `ballPos.y < f.pos.y − fallDepth` **or** `|lateralOffset| > width` **or** catch plane hit.
- Respawn sequence (300 ms): input ignored, physics paused, ball shrinks/fades (world stays still; soft vignette only — **no full-screen flash**); at the midpoint: place at `checkpointFrame.pos + up × 1.0`, zero velocities, `Progress.reseed(checkpointIndex)`, **camera hard-snapped**; ball scales back in. Sound: short neutral-to-upward "boop".
- **Checkpoints and finish are t-based**, not sensors: a checkpoint is passed when `Progress.t` (monotone high-water mark, never decreases on roll-back) ≥ `checkpointM`. Finish when high-water mark ≥ `finishM`. Checkpoint flags drop/spin when passed (not colour-only).
- Stars: **count up**, one per checkpoint passed plus one for finishing; shown at the finish; persisted per ball per level (best). Falls are never counted or shown.

### Tuning defaults (`tuning.ts`) — mass 1 kg, so N ≈ m/s² before rolling losses

| Key | tiny | bigkid |
|---|---|---|
| width | 6.0 | 3.5 |
| driveMode | always | hold |
| drive (N) | 8 | 10 |
| maxSpeed (m/s) | 4.0 | 5.5 |
| maxLateral (m/s) | 2.5 | 4.0 |
| laneGain (1/s) | 2.0 | 3.0 |
| steerGain | 3 | 4 |
| laneMargin (m) | 0.6 | 0.3 |
| steerDecay (s) | 1.0 | 0 (off) |
| brakeDamping | 2.5 | 2.5 |
| fallDepth (m) | 6 | 6 |
| cameraBack / cameraUp (m) | 7 / 4 | 7 / 4 |
| cameraLookAhead (m) | 4 | 5 |
| cameraSmoothing (1/s) | 5 | 6 |

Starting points; §16 Phase 3b (human) adjusts them.

---

## 7. Camera (`Camera.ts`)
- `tHoriz` = frame tangent flattened to XZ, normalised, exp-lerped at `cameraSmoothing`.
- Desired position: `ball.pos − tHoriz × cameraBack + worldUp × (cameraUp + trackRise)` where `trackRise = max(0, height of the frame `cameraBack` metres behind − height of the current frame)` so the camera never sinks into a ramp or wall behind the ball on descents.
- Look at `ball.pos + tHoriz × cameraLookAhead + worldUp × 0.8` so the ball sits in the **lower-middle** of the frame and a finger on the ball doesn't hide the road.
- **Constant horizontal FOV ≈ 75°** in both orientations (compute vertical FOV from aspect).
- Hard-snap on `loadLevel` and respawn. No roll. `prefers-reduced-motion`: smoothing ×2, no confetti burst.
- Geometry guarantees no clipping: no lintels, decor ≥ 8 m from the centreline, walls ≤ 1.5 m, camera ≥ 4 m up.

---

## 8. Game flow and screens

State machine: `boot → title → playing → celebrating → finished → (playing next | levelSelect)`. `levelSelect` is reached from the title's secondary button. `parentMenu` overlays any state and pauses physics.

DOM overlays over the canvas; inline SVG icons; **play-path targets ≥ 160 px**, parent-side ≥ 88 px. `* { touch-action: none }` except overlay buttons (`manipulation`).

| Screen | Contents | Rules |
|---|---|---|
| **Loading** | Bouncing CSS ball while `RAPIER.init()` runs. | First load can take several seconds on an old iPad; never a blank screen. |
| **Title** | Three **ball characters** (each is a profile: own tier, own progress) as 160 px buttons; the chosen one is highlighted and the 3D demo ball recolours instantly. Huge ▶ = *resume/next unfinished level for this ball*. Smaller "grid" icon = level select. Background: `level01` with autopilot, no HUD. | No ⚙ icon anywhere. |
| **Level select** | Tiles with a simple glyph + palette colour; finished tiles show earned stars; the next one pulses. Tiny: all open. Big kid: sequential; **locked tiles are not rendered in Tiny**, greyed in Big kid. | Tap starts immediately. |
| **Playing** | **No interactive elements.** Big kid shows stars-so-far top-centre (non-interactive). Idle hint: animated hand sweeps sideways across the sky at level start and after 4 s without input (Tiny), 8 s (Big kid). | Exit only via the parent gate. |
| **Celebrating** | 3 s of confetti + fanfare with **all input ignored**. | |
| **Finished** | Stars earned (count up with sound), huge ▶ (next level), back-arrow icon (level select). **No auto-advance.** After the last level: bigger celebration, ▶ restarts at level 1. | Fresh pointerdown required. |
| **Parent menu** | Resume / Home; per-ball tier switch; sound on/off; low-graphics toggle (dpr 1.0, no MSAA, reload); "reset this ball's progress" (drag-to-confirm slider); Guided Access reminder; version string (plain text, **no links**). | |
| **Parent card** | First launch only, dismissible: 2-step Guided Access instructions + "add to home screen". Reachable again from the parent menu. | |

**Parent gate**: hold **top-left and bottom-right corners simultaneously for 3 s** (two pointers, each within 120 px of its corner; a visible fill ring during the hold). This is the only way to pause, exit a level, or reach settings. It works from every state.

Other rules: unlock the next level on the finish event itself. Persist `currentLevel` per ball; a killed PWA resumes into the title with ▶ pointing at that level. Request a **Wake Lock** during play. Service-worker updates are applied only on the title screen. Orientation: both supported via `ResizeObserver`; input state resets on resize.

---

## 9. Visual style
- Flat-shaded low-poly pastel. `MeshLambertMaterial`, `HemisphereLight` + one `DirectionalLight`, **no shadow maps**, no post-processing. Track stripe via vertex colours.
- Sky: `scene.background` colour + fog in the palette's sky colour (cheapest option).
- **3 palettes** (`meadow`, `beach`, `sky`) in `brand.ts`, each `{ sky, fog, track, trackStripe, wall, accent, decorA, decorB }`.
- **3 ball characters** in `brand.ts` (e.g. red with white quarters, blue with yellow, green with white), each with a dark outline. A unit test asserts relative luminance contrast ≥ 3:1 between every ball's main colour and every palette's `track`, `trackStripe` and `sky`.
- Decor: `InstancedMesh` of 2–3 primitive shapes (cone-on-cylinder tree, sphere cloud, flat disc) placed by a seeded PRNG (seed = level id), **8–16 m from the centreline**, density = `tuning.decorPerMetre`.
- Gap/void colours not needed (no gaps). Checkpoint = arch + flag that drops when passed.

---

## 10. Audio (`Audio.ts`)
All synthesised. Every sound: attack ≥ 10 ms, release ≥ 60 ms, low-pass ≤ 3 kHz, master gain −6 dB.

| Event | Sound |
|---|---|
| Rolling | Low pitched hum (triangle + low-pass), gain ∝ speed, −18 dB vs SFX, ducked while any SFX plays. |
| Wall/obstacle contact | Soft pentatonic blip, fired only on a **new contact** with impulse above threshold (`ActiveEvents.CONTACT_FORCE_EVENTS`, filtered to wall/obstacle handles), ≤ 2/s, 1 s refractory per collider. |
| Balloon pop | Short soft "pop" + rising blip. |
| Checkpoint | Two-note rising chime. |
| Respawn | Neutral-to-upward "boop" (never a sad trombone). |
| Celebration | Four-note major arpeggio + soft whoosh (no noise burst). |
| Star count-up | Ascending ticks. |
| Button | Soft click. |

- `AudioContext` created/resumed on **`pointerup`** (touch `pointerdown` is not a user activation on iOS). Retry `resume()` on every `pointerup` while `state !== 'running'`, and on `visibilitychange → visible` (iOS `interrupted` state).
- Suspend when hidden. Mute persisted. iPad hardware volume buttons work; README says so.

---

## 11. iPad / PWA specifics
- `index.html`: viewport `width=device-width, initial-scale=1, viewport-fit=cover`; `apple-mobile-web-app-capable`; `apple-mobile-web-app-status-bar-style=black-translucent`; `apple-touch-icon` 180 px.
- CSS: `html, body { overscroll-behavior: none; }`; `* { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }`; overlay buttons `touch-action: manipulation`; safe-area insets via `env(safe-area-inset-*)`.
- Non-passive `touchstart`/`touchend`/`touchmove` listeners on `document` calling `preventDefault()` when the target is the canvas; `gesturestart` → `preventDefault`.
- `vite-plugin-pwa`: `registerType: 'prompt'`-style deferred update (apply only on title), precache `dist` excluding source maps, manifest `display: standalone`, icons 192/512 (+ maskable). **Do not register the SW in `import.meta.env.DEV`.**
- Icons: `scripts/make-icons.mjs` renders an SVG ball with `sharp` → PNGs are **committed**; not part of CI.
- Renderer: `setPixelRatio(Math.min(devicePixelRatio, navigator.maxTouchPoints > 0 ? 1.25 : 2))`, `antialias: true`, `powerPreference: 'high-performance'`; low-graphics toggle → dpr 1.0, no MSAA.
- Resize via `ResizeObserver` + `visualViewport.resize`; no `orientationchange`.
- Vite `base` from env (`/tumble-trail/`); SW scope matches.
- README: install steps (Safari → Share → Add to Home Screen), Guided Access steps, note that progress lives in the home-screen app's storage (reinstall wipes it), volume buttons for mute.

---

## 12. Persistence (`Persistence.ts`)
Key `tt.v1`:
```ts
{ version: 1, muted: boolean, lowGraphics: boolean, parentCardSeen: boolean, selectedBall: 0|1|2,
  balls: Array<{ tier: Tier; unlocked: number; currentLevel: number; stars: Record<string, number> }> }
```
try/catch everywhere (private mode) with in-memory fallback.

---

## 13. Testing and verification

### Unit (vitest) — `tests/unit/` (no Rapier needed; geometry is pure)
- `Spline`: LUT arc-length uniform within 3 %; frames orthonormal; `right` is screen-right (fixture: tangent +Z → right = −X).
- `Track.buildRibbonGeometry`: vertex counts; wall modes; `noWallSpansM`; CCW winding.
- `Progress`: monotone high-water mark on a straight; on a ramp with roll-back `t` never decreases; recovers after `reseed`; **hairpin fixture** (two legs 4 m apart) never jumps legs; lateral sign.
- `validateLevel`: every shipped level passes; crafted bad levels fail with the right rule number.
- `brand`: contrast test (§9). `Persistence`: round-trip, corrupt JSON.
- Determinism: stepping a `levelTest` world twice for 600 steps gives identical `t` (this one test initialises Rapier in Node).

### E2E (Playwright, Chromium) — `tests/e2e/`
`playwright.config.ts` launch args: `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Server: `vite preview` of a production build (SW is fine in a fresh context). Long-presses tested with `mouse.down/up`, not touch emulation.
1. **Smoke**: page loads with no console errors; `__tt.app.renderer.getContext().getParameter(RENDERER)` non-null; state reaches `title`.
2. **Autopilot, Tiny, every level**: `setTier('tiny'); await loadLevel(id); autopilot = true; fastForward(120, 'celebrating')` → state is `celebrating` (Phases 1–3 assert `'finished'`-equivalent via `__tt.state`, since screens arrive in Phase 4). Record `seconds` into the test report.
3. **Autopilot, Big kid, every level**: same, budget 150 s; finish time must be within `tuning.bigkidLevelSeconds = [12, 60]`.
4. **Persistence**: pick ball 2, reload, ball 2 selected.
5. **Parent gate**: two-pointer 3 s hold opens the menu; a single 1 s press does nothing (`state` unchanged); tier switch + `loadLevel` changes `trackWidth()`.
6. **Stats budget**: `stats()` on each level within §14.

Autopilot: `driving = true`; `steer = clamp(−lateral / (width/4), −1, 1)` + a lookahead term from the frame 4 m ahead + a repulsion term from any pillar/gate post within 6 m ahead. Must finish every level in both tiers. It is a **completability** proxy, not a difficulty proxy; difficulty is Phase 3b's human job.

### CI (GitHub Actions)
- `ci.yml` on push/PR: `npm ci`, `lint`, `typecheck`, `test:unit`, `build`, `npx playwright install --with-deps chromium`, `test:e2e`.
- `pages.yml` on push to `main` after CI: build with `VITE_BASE=/tumble-trail/`, upload artifact, deploy. Needs `permissions: { pages: write, id-token: write, contents: read }`.

### Human checklist — `docs/IPAD_CHECKLIST.md` (Phase 6, Nick)
Install to home screen; full-screen launch; offline launch after one online run; FPS (parent menu) ≥ 55 on the oldest iPad; no pinch-zoom / loupe / selection; audio after first tap; rotation mid-level OK; backgrounding and returning doesn't leave the ball driving; parent gate can't be triggered one-handed; **child protocol**: three separate sessions, adult silent and not touching, child starts from the title and reaches the finish of level 1 within 3 min and asks to play again; one Big-kid session with a 5–8-year-old recording falls per level.

---

## 14. Performance budget

| Metric | Budget |
|---|---|
| Frame time, 2018 iPad (A10) at dpr 1.25 | ≤ 16 ms |
| Triangles per level | ≤ 40 000 |
| Draw calls | ≤ 40 |
| JS bundle (gzipped) | ≤ 2.4 MB (Rapier-compat ≈ 1.65 MB of it) |
| Time to interactive, first visit on Wi-Fi, 2018 iPad | ≤ 8 s with the loading screen visible throughout; subsequent launches from SW cache ≤ 3 s |

`docs/IDEAS.md` records the option of switching to `@dimforge/rapier3d` + `vite-plugin-wasm` to stream the WASM (−0.5 MB) if first-load time is a problem in practice.

---

## 15. Guardrails (non-negotiable)
1. **No ads, purchases, currencies, timed/gated rewards, analytics, telemetry, third-party scripts, outbound links, or runtime network calls** beyond loading the app and the SW update check.
2. **No copying** of any existing game's name, logo, levels, sounds or art known to the agent. Do not mention other games in code, UI, commits or docs. Name originality is Nick's responsibility.
3. **No external assets at runtime.**
4. **No text required to play.**
5. **No failure states, no counters that go down, no timed auto-advance** — in either tier.
6. **No interactive elements during play.** Exit only via the two-corner parent gate.
7. **No dependencies** beyond §3 (incl. the pre-approved dev list) without a `DECISIONS.md` entry.
8. **Tests are never weakened.**
9. **All tunables in `tuning.ts`.**
10. **Keep it small.** Not in this plan → `docs/IDEAS.md`, not the code. Aesthetic "optional" items are decided here: no camera roll, 3 palettes, 3 balls, decor density from tuning.

---

## 16. Phased build plan

One agent session per phase; one squash commit per phase pushed to `main`. Order is fixed.

### Phase 0 — Scaffold, CI, deploy
**Tasks**
1. `npm create vite@latest . -- --template vanilla-ts` (non-interactive), add §3 deps, strict TS, eslint + typescript-eslint + prettier defaults.
2. Scripts: `dev`, `build`, `preview`, `lint`, `typecheck`, `test:unit`, `test:e2e`, `icons`.
3. `index.html` + CSS per §11. Loading screen (CSS ball).
4. `main.ts`: loading screen → `await RAPIER.init()` → three renderer with pixel-ratio rule, a two-tone sphere dropping onto a plane (proves WASM + WebGL). `__tt` with `state`, `stats()`.
5. `vite-plugin-pwa` per §11; `scripts/make-icons.mjs`; PNGs committed; manifest valid.
6. `playwright.config.ts` with the §13 flags; smoke test. One trivial vitest.
7. `ci.yml`, `pages.yml` with the permissions block; `VITE_BASE` env.
8. `docs/PLAN.md` (this file), `DECISIONS.md`, `PROGRESS.md`, `IDEAS.md`, `IPAD_CHECKLIST.md` (from §13), README with install steps.

**Done when**
- [agent] `lint`, `typecheck`, `test:unit`, `build`, `test:e2e` green locally and in CI.
- [agent] Smoke test asserts manifest fetch = 200 and `navigator.serviceWorker.ready` resolves on the preview build.
- [human] Pages URL opens on an iPad and "Add to Home Screen" shows the icon.

### Phase 1a — Spline, track ribbon, progress (pure logic)
**Tasks**: `Spline.ts`, `Track.buildRibbonGeometry`, `Progress.ts` (windowed ±20 frames, `reseed`, high-water `t`), `levels/schema.ts` **types + a stub `validateLevel` that only checks rule 1**, `levels/index.ts` with `levelTest` (straight → S-bend → ramp up 15° → plateau → ramp down → straight; 100 m; 3 checkpoints; 4 balloons; 2 bumps), `tuning.ts`, `brand.ts`. Unit tests for all of the above (§13).

**Done when**: [agent] unit tests green incl. hairpin and ramp roll-back fixtures; `validateLevel(levelTest)` passes.

### Phase 1b — Ball, input, camera, loop, autopilot
**Tasks**: `Track.buildColliders`, `Ball.ts`, `Input.ts`, `Camera.ts`, `GameLoop.ts` (interpolation), fall/respawn/stuck per §6, checkpoints + finish by `t`, blob shadow, `Autopilot.ts`, full `__tt` contract incl. `fastForward`, `loadLevel`, `setTier`. On finish: `state = 'finished'`, physics stops, nothing else (screens come in Phase 4). E2E #1–#3 for `levelTest` only, plus #6.

**Done when**
- [agent] Autopilot completes `levelTest` in both tiers headless via `fastForward`; e2e green in CI; determinism unit test green.
- [agent] `stats()` within §14.
- [human] Hand-feel on desktop and iPad noted in PROGRESS (too fast/slow, camera comfort), both drive modes tried with the 3-year-old on `levelTest`.

### Phase 2 — Track system complete
**Tasks**: full `validateLevel` (all 7 rules, tested with crafted failures); walls `full`/`low`/`none` + `noWallSpansM`; start pad, end pad + back wall, finish arch, checkpoint arches with dropping flags; `Obstacles.ts` (all four kinds, exact dimensions); `Decor.ts`; palettes + fog; contrast unit test; contact-event plumbing for the bump sound (sound itself is Phase 5). Convert `levelTest` to use everything.

**Done when**: [agent] all unit tests green; autopilot e2e green on `levelTest` in both tiers with pillars, a gate and balloons present; `stats()` within §14.

### Phase 3 — Six levels
**Tasks**: author `level01`–`level06` per Appendix B; all validated; e2e #2/#3/#6 across all levels; Big kid autopilot finish time within `bigkidLevelSeconds`.

**Done when**: [agent] 6 levels validated and autopilot-green in both tiers in CI; finish times recorded in PROGRESS.

### Phase 3b — Tuning pass **[human, does not block]**
Nick plays all levels on the oldest iPad in both tiers, with the 3-year-old on Tiny; adjusts `tuning.ts`; records before/after and child observations per level in PROGRESS.

### Phase 4 — Screens, flow, persistence
**Tasks**: `Screens.ts` (all screens in §8, 160 px targets, inline SVG), parent gate, parent card, state machine incl. celebrating/finished, ball-character profiles, `Persistence.ts`, wake lock, resume, SW update-on-title, FPS readout, low-graphics toggle, idle hand hint. E2E #4 and #5.

**Done when**: [agent] a full run (title → ball → level 1 → … → level 6 → final celebration → ▶ restarts at level 1) works with mouse only and no reading; a single click/1 s press anywhere during play leaves `state === 'playing'`; all e2e green.

### Phase 5 — Audio and effects
**Tasks**: `Audio.ts` per §10 (unlock on `pointerup`, resume paths, mute, ducking); `Effects.ts` (confetti ≤ 300 quads, checkpoint sparkle, balloon pop burst, ball squash on landing 1.15/0.85 for 120 ms, respawn vignette); `prefers-reduced-motion`.

**Done when**: [agent] every event in §10 has a sound; no audio errors before the first gesture; `stats()` within budget during celebration (fastForward through a finish with effects enabled); e2e green. [human] audio works after the first tap on an iPad.

### Phase 6 — iPad hardening and v1.0 **[mostly human]**
**Tasks**: Nick runs `docs/IPAD_CHECKLIST.md` on the oldest and newest iPads; the agent fixes everything found (one session per round); README finalised; tag `v1.0.0`.

**Done when**: [human] checklist ticked incl. the child protocol; [agent] `v1.0.0` tagged and deployed.

---

## 17. Risks and fallbacks

| Risk | Mitigation |
|---|---|
| Rapier WASM/base64 slow to load on A10 | Loading screen from Phase 0; SW caches after first run; streaming-WASM option in IDEAS. |
| Headless WebGL in CI | Full SwiftShader flag set in Phase 0; `fastForward` never depends on GPU speed; smoke test asserts the renderer string. |
| Trimesh edge catching | `FIX_INTERNAL_EDGES` from day 1; consistent winding. |
| Ball hops the Big-kid kerb | Lane controller never targets beyond the kerb; `maxLateral` 4 m/s; raise kerb to 0.5 m in tuning if seen. |
| Toddler can't steer at all | Lane controller centres the ball with `steer = 0`, so Tiny is completable with zero input; steering is bonus. |
| Toddler bored (only "hold and watch") | Balloons every ≤ 25 m, bumps, checkpoint flags, star count-up. If still bored: more interactive decor kinds in v1.1, not new mechanics. |
| Accidental exit / iOS system gestures | No in-play UI; two-corner gate; parent card teaches Guided Access on first launch. |
| Agent adds scope | §15.10, IDEAS.md, one phase per session. |
| SW serves a stale/broken build | Update only on title; version string in parent menu; README reinstall steps (with the storage-wipe warning). |

---

## 18. Decisions already taken for the agent
1. Repo `aidigitallabs/tumble-trail`, pre-created; direct push to `main`, one commit per phase.
2. Tiny = always-rolling, steer-only. Big kid = hold-to-go.
3. No gaps in v1. No camera roll. No auto-advance. No in-play buttons.
4. Three ball characters are the profiles; tier is per ball.
5. Stars count up and are persisted per level; falls are never counted.
6. Big kid unlock is sequential; Tiny is all-open.

---

## 19. Changelog v1 → v2 (from adversarial reviews)

**Blockers fixed**: human-gated *Done when* items now tagged and non-blocking; gaps removed from v1 (infeasible physics at safe speeds); bundle budget corrected to reality (≈1.65 MB gz for Rapier alone) with a loading screen; level-duration arithmetic fixed (80–120 m, Big kid 5.5 m/s, 12–60 s proxy); audio unlock moved to `pointerup`; Tiny control model changed to always-rolling + steer-only; in-play long-press buttons removed and replaced by the two-corner parent gate; auto-advance removed; stars count up; `__tt` and `fastForward` precisely specified; Phase 1 no longer reloads on finish; SwiftShader flags in Phase 0; Lighthouse PWA check replaced.

**Majors fixed**: `right` vector convention defined (screen-right); obstacle dimensions fixed; metres instead of `t` for positions; end pad + back wall; checkpoints/finish by `t` high-water mark (no sensors); respawn sequence specified (physics paused, camera snapped, no full-screen flash); explicit `setMass(1)` and halved gains; vertical frictionless walls (no outward lean, no wall-climbing); lane-position controller replaces velocity-target steering + separate magnet; parking brake; stuck detection; first-pointer-only input with edge rejection and dead zone; camera height relative to the track behind; constant horizontal FOV; ball framed lower-middle; title ▶ goes straight to play; ball characters as profiles; no outbound links; wake lock + resume; SW update only on title; Guided Access parent card; touch-action/preventDefault corrected for iOS; audio envelopes, contact-event-based blips, rolling hum instead of noise; contrast unit test; colour-blind-safe checkpoint flags; 160 px play targets; `prefers-reduced-motion`; Phase 1 split into 1a/1b; pure geometry split from colliders; determinism rule; dev-dependency pre-approval; icons committed; CI permissions.

**Deferred to v2 (in IDEAS.md)**: gaps + jump, moving obstacles, tilt, streaming WASM, calm mode toggle, more interactive decor kinds, level editor.

---

## Appendix A — Prompt for a new build session

Paste this as the first message of a session opened on the `aidigitallabs/tumble-trail` repo (empty or at any phase boundary). Replace `<PHASE>` with the phase to run.

```
You are building Tumble Trail, an original, ad-free rolling-ball obstacle course web game for a 3-year-old (and 5–8-year-old siblings) to play on iPads as a home-screen PWA. The complete specification is docs/PLAN.md in this repo (if the repo is empty, it is pasted below this message — your first action is to commit it as docs/PLAN.md).

Read docs/PLAN.md in full before doing anything else. Then read docs/PROGRESS.md and docs/DECISIONS.md if they exist.

Your job this session: execute **Phase <PHASE>** exactly as specified in PLAN.md §16, and nothing else.

Rules (from PLAN.md §0 and §15; they are not negotiable):
- One phase per session. Do not start the next phase.
- Every "Done when" item tagged [agent] must be green before you commit. Items tagged [human] go into docs/PROGRESS.md as "PENDING HUMAN: …" and do not block you.
- Never weaken, skip or disable a test to get green.
- Do not guess library APIs: read node_modules/**/*.d.ts for the installed versions. Do not downgrade packages.
- All tunable numbers go in src/config/tuning.ts.
- No ads, purchases, analytics, telemetry, outbound links, external assets or runtime network calls. No references to any existing commercial game. No interactive elements during play. No auto-advance. No counters that go down.
- No new dependencies beyond PLAN.md §3 without a docs/DECISIONS.md entry.
- Ambiguity: pick the simplest option that keeps a 3-year-old able to play, log it in docs/DECISIONS.md, carry on. Only stop if genuinely blocked.
- Nothing inside the physics step reads a clock.

Finish the session by: running lint, typecheck, unit tests, build and e2e; appending a dated entry to docs/PROGRESS.md (done / skipped and why / PENDING HUMAN / what to look at next); one commit on main with a clear message; git push -u origin main. Then report: what is green, what is pending human, and the Pages URL if it changed.
```

---

## Appendix B — Level briefs (v2: no gaps; lengths 80–120 m)

All levels: start pad, finish arch, checkpoints every ≤ 30 m, balloons every ≤ 25 m in Tiny (also present in Big kid), decor per palette. Tiny obstacles: `bump` + `balloon` only. Big kid extras listed. Each level introduces **one new thing** for Tiny so the sequence feels like progress without getting harder.

| # | Name | Palette | Length | Shape | Tiny "new thing" | Big kid extras |
|---|---|---|---|---|---|---|
| 1 | Meadow Roll | meadow | 80 m | Straight → wide S-bend → straight. Flat. | Balloons | Kerbs; 1 pillar at offset +1.2 |
| 2 | Little Hills | meadow | 90 m | Two gentle humps (≤ 12°) with a curve between | Bumps (2, centred) | Kerbs; 2 pillars alternating ±1.2 |
| 3 | Seaside Sweep | beach | 100 m | Long 150° sweep (radius ≥ 12 m) then a straight | Lots of balloons in the curve | Kerb none on the final straight; 1 gate |
| 4 | Up in the Clouds | sky | 100 m | Ramp up 15°, plateau with a wiggle, ramp down 15° | Balloons on the plateau | Kerbs; 1 gate on the plateau; 1 pillar after the descent |
| 5 | Zigzag Beach | beach | 110 m | Three alternating 70° turns (radius ≥ 10 m) with straights | Bumps on the straights | Kerbs everywhere; pillars on the *outside* of each turn, offset ±1.3 |
| 6 | Big Sky Finale | sky | 120 m | S-bend, hump, sweep, long gentle downhill to the finish | Everything, lots of balloons | Kerbs; 1 gate, 3 pillars, no `none` spans |
