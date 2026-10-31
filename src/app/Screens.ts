import { ballCharacters } from '../config/brand';
import { tuning } from '../config/tuning';
import type { Tier } from '../levels/schema';
import type { FlowState } from './flow';
import { ballIcon, icons, paletteGlyph } from './icons';
import type { LevelInfo } from './levelList';
import { isLevelOpen, type BallIndex, type SaveData } from './Persistence';
import { ParentGate, type GateCorner } from './ParentGate';
import type { TTState } from './tt';

/** Everything the screens read from the app, and every action a button can trigger. */
export interface ScreensHost {
  readonly levels: readonly LevelInfo[];
  readonly version: string;
  save(): SaveData;
  fps(): number;
  /** The run that just ended (for the Finished screen). */
  lastRun(): { stars: number; maxStars: number; final: boolean };

  selectBall(i: BallIndex): void;
  /** Title play button and Finished next button: the level this ball should play next. */
  play(): void;
  openLevels(): void;
  playLevel(index: number): void;
  toLevels(): void;
  levelsHome(): void;
  openParent(): void;
  closeParent(): void;
  parentHome(): void;
  setBallTier(t: Tier): void;
  setMuted(muted: boolean): void;
  setLowGraphics(on: boolean): void;
  resetBall(): void;
  dismissCard(): void;
  /** A button press was accepted (not inside the screen lockout): the soft click. */
  buttonPressed(): void;
}

type Attrs = Record<string, string>;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  attrs: Attrs = {},
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (html !== undefined) node.innerHTML = html;
  return node;
}

const GATE_RING_R = 42;
const GATE_RING_LEN = 2 * Math.PI * GATE_RING_R;

/**
 * DOM overlays over the canvas (PLAN section 8): Title, Level select, Playing HUD, Celebrating,
 * Finished, Parent menu and Parent card, plus the parent gate's fill rings. Inline SVG icons only.
 * Play-path targets are at least `ui.playTargetPx`, parent-side ones `ui.parentTargetPx` (CSS
 * variables set from tuning). The playing screen contains no interactive element at all.
 */
export class Screens {
  private readonly gate = new ParentGate();
  private readonly title = h('section', 'screen title', { 'data-testid': 'screen-title' });
  private readonly levelsEl = h('section', 'screen levels', { 'data-testid': 'screen-levels' });
  private readonly hud = h('section', 'screen hud', { 'data-testid': 'screen-playing' });
  private readonly celebrate = h('section', 'screen celebrate', {
    'data-testid': 'screen-celebrating',
  });
  private readonly finished = h('section', 'screen finished', { 'data-testid': 'screen-finished' });
  private readonly menu = h('section', 'screen menu', { 'data-testid': 'parent-menu' });
  private readonly card = h('section', 'screen card', { 'data-testid': 'parent-card' });
  private readonly gateRings = h('div', 'gate-rings');
  private readonly ringEls: Record<GateCorner, SVGCircleElement>;

  private readonly ballButtons: HTMLButtonElement[] = [];
  private readonly tiles = h('div', 'tiles');
  private readonly hudStars = h('div', 'hud-stars', { 'data-testid': 'hud-stars' });
  private readonly hint = h('div', 'hint', { 'data-testid': 'hint' }, icons.hand);
  private readonly finishStars = h('div', 'finish-stars', { 'data-testid': 'finished-stars' });
  private readonly nextButton: HTMLButtonElement;
  private readonly tierButtons: Record<Tier, HTMLButtonElement>;
  private readonly soundButton: HTMLButtonElement;
  private readonly lowGfxButton: HTMLButtonElement;
  private readonly menuBall = h('span', 'menu-ball');
  private readonly fpsEl = h('span', '', { 'data-testid': 'fps' }, '--');
  private readonly slider: HTMLElement;
  private readonly thumb: HTMLElement;

  private flow: FlowState = { state: 'boot', under: null };
  private base: TTState = 'boot';
  private cardOpen = false;
  private readyAt = 0;
  private readyToken = 0;
  private hudShown = { earned: -1, max: -1 };
  private fpsClock = 0;

  constructor(
    root: HTMLElement,
    private readonly host: ScreensHost,
    private readonly win: Window = window,
  ) {
    const ui = tuning.ui;
    root.style.setProperty('--target-play', `${ui.playTargetPx}px`);
    root.style.setProperty('--target-parent', `${ui.parentTargetPx}px`);
    root.style.setProperty('--play-button', `${ui.playButtonPx}px`);
    root.style.setProperty('--hint-sweep', `${ui.hintSweepSeconds}s`);
    root.style.setProperty('--star-step', `${ui.starStepMs}ms`);

    // ---- gate rings
    const mk = (corner: GateCorner): SVGCircleElement => {
      const wrap = h(
        'div',
        `gate-ring ${corner}`,
        {},
        `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="${GATE_RING_R}"/><circle class="fill" cx="50" cy="50" r="${GATE_RING_R}" stroke-dasharray="${GATE_RING_LEN}" stroke-dashoffset="${GATE_RING_LEN}"/></svg>`,
      );
      this.gateRings.append(wrap);
      return wrap.querySelector('.fill') as SVGCircleElement;
    };
    this.ringEls = { tl: mk('tl'), br: mk('br') };

    // ---- title
    const balls = h('div', 'balls');
    ballCharacters.forEach((c, i) => {
      const b = this.button('ball-btn', `ball-${i}`, c.id, ballIcon(c), () =>
        this.host.selectBall(i as BallIndex),
      );
      this.ballButtons.push(b);
      balls.append(b);
    });
    const actions = h('div', 'title-actions');
    actions.append(
      this.button('play-big', 'play', 'play', icons.play, () => this.host.play()),
      this.button('round-btn grid-btn', 'levels', 'levels', icons.grid, () =>
        this.host.openLevels(),
      ),
    );
    this.title.append(balls, actions);

    // ---- level select
    this.levelsEl.append(
      this.tiles,
      this.button('round-btn corner-bl', 'levels-home', 'home', icons.home, () =>
        this.host.levelsHome(),
      ),
    );

    // ---- playing HUD (not interactive)
    this.hud.append(this.hudStars, this.hint);

    // ---- celebrating
    // The confetti here is 3D (Effects.ts); only the star pops in the DOM.
    this.celebrate.append(h('div', 'big-star', {}, icons.star));

    // ---- finished
    this.nextButton = this.button('play-big', 'next', 'next', icons.play, () => this.host.play());
    this.finished.append(
      h('div', 'burst small'),
      this.finishStars,
      this.nextButton,
      this.button('round-btn corner-bl', 'to-levels', 'levels', icons.back, () =>
        this.host.toLevels(),
      ),
    );

    // ---- parent menu
    const panel = h('div', 'panel');
    const head = h('div', 'panel-row');
    head.append(
      this.button('parent-btn big', 'parent-resume', 'resume', icons.play, () =>
        this.host.closeParent(),
      ),
      this.button('parent-btn big', 'parent-home', 'home', icons.home, () =>
        this.host.parentHome(),
      ),
      h('span', 'spacer'),
      this.menuBall,
    );
    const tierRow = h('div', 'panel-row');
    this.tierButtons = {
      tiny: this.button('parent-btn wide', 'tier-tiny', 'Tiny', '<span>Tiny</span>', () =>
        this.host.setBallTier('tiny'),
      ),
      bigkid: this.button('parent-btn wide', 'tier-bigkid', 'Big kid', '<span>Big kid</span>', () =>
        this.host.setBallTier('bigkid'),
      ),
    };
    tierRow.append(this.tierButtons.tiny, this.tierButtons.bigkid);
    this.soundButton = this.button('parent-btn wide', 'sound-toggle', 'Sound', '', () =>
      this.host.setMuted(!this.host.save().muted),
    );
    this.lowGfxButton = this.button(
      'parent-btn wide',
      'lowgfx-toggle',
      'Low graphics',
      `${icons.leaf}<span>Low graphics</span>`,
      () => this.host.setLowGraphics(!this.host.save().lowGraphics),
    );
    const toggles = h('div', 'panel-row');
    toggles.append(this.soundButton, this.lowGfxButton);

    this.thumb = h('div', 'reset-thumb', { 'data-testid': 'reset-thumb' }, icons.reset);
    this.slider = h('div', 'reset-slider', { 'data-testid': 'reset-slider' });
    this.slider.append(
      h('span', 'reset-label', {}, "Slide to reset this ball's progress"),
      this.thumb,
    );
    this.wireSlider();

    const meta = h('div', 'panel-meta');
    meta.append(
      this.button(
        'parent-btn wide',
        'parent-card-open',
        'Setup help',
        `${icons.info}<span>Setup help</span>`,
        () => {
          this.cardOpen = true;
          this.renderOverlays();
        },
      ),
      h(
        'p',
        '',
        {},
        'Tip: turn on Guided Access (Settings, Accessibility) and triple-click the top button to keep little fingers inside the game.',
      ),
    );
    const foot = h('p', 'panel-foot');
    foot.append(
      'Tumble Trail ',
      h('span', '', { 'data-testid': 'version' }, `v${host.version}`),
      ' · FPS ',
      this.fpsEl,
    );
    panel.append(head, tierRow, toggles, this.slider, meta, foot);
    this.menu.append(h('div', 'backdrop'), panel);

    // ---- parent card
    const cardBox = h('div', 'panel card-box');
    cardBox.append(
      h('h2', '', {}, 'Setting up'),
      h(
        'ol',
        '',
        {},
        `<li><b>Guided Access.</b> Settings, Accessibility, Guided Access, switch it on.</li>
         <li>Open Tumble Trail and triple-click the top button, then tap Start.</li>
         <li><b>Home Screen.</b> In Safari tap Share, then Add to Home Screen.</li>
         <li>To open the parent menu, hold the top-left and bottom-right corners together for ${tuning.ui.gateHoldSeconds} seconds.</li>`,
      ),
      this.button('parent-btn wide', 'card-ok', 'OK', `${icons.check}<span>OK</span>`, () => {
        this.cardOpen = false;
        this.host.dismissCard();
        this.renderOverlays();
      }),
    );
    this.card.append(h('div', 'backdrop'), cardBox);

    root.append(
      this.title,
      this.levelsEl,
      this.hud,
      this.celebrate,
      this.finished,
      this.menu,
      this.card,
      this.gateRings,
    );
    for (const el of this.screenEls()) el.hidden = true;
    this.attachGate();
  }

  // ---- public API --------------------------------------------------------------------------------

  /** Show the screen for a flow state (called on every state change). */
  show(flow: FlowState): void {
    this.flow = flow;
    const base: TTState = flow.state === 'parentMenu' ? (flow.under ?? 'title') : flow.state;
    const baseChanged = base !== this.base;
    this.base = base;
    if (baseChanged || flow.state !== 'parentMenu') {
      this.cardOpen =
        base === 'title' && flow.state === 'title' && !this.host.save().parentCardSeen;
    }
    if (baseChanged) this.rebuildBase();
    this.refresh();
    this.renderOverlays();
    this.stampReady();
  }

  /** Re-read the save and update everything that depends on it. */
  refresh(): void {
    const save = this.host.save();
    this.ballButtons.forEach((b, i) =>
      b.setAttribute('aria-pressed', String(i === save.selectedBall)),
    );
    const profile = save.balls[save.selectedBall];
    for (const t of ['tiny', 'bigkid'] as const) {
      this.tierButtons[t].setAttribute('aria-pressed', String(profile?.tier === t));
    }
    this.soundButton.innerHTML = `${save.muted ? icons.speakerOff : icons.speakerOn}<span>Sound ${save.muted ? 'off' : 'on'}</span>`;
    this.soundButton.setAttribute('aria-pressed', String(!save.muted));
    this.lowGfxButton.setAttribute('aria-pressed', String(save.lowGraphics));
    const c = ballCharacters[save.selectedBall];
    if (c) this.menuBall.innerHTML = ballIcon(c);
    if (this.base === 'levelSelect') this.buildTiles();
  }

  /** Per rendered frame: parent gate timer and rings, FPS readout. */
  tick(dt: number): void {
    if (this.gate.update(dt)) {
      this.setRings(0, []);
      this.host.openParent();
    } else {
      this.setRings(this.gate.progress, this.gate.heldCorners);
    }
    if (this.flow.state === 'parentMenu') {
      this.fpsClock += dt * 1000;
      if (this.fpsClock >= tuning.ui.fpsRefreshMs) {
        this.fpsClock = 0;
        this.fpsEl.textContent = String(Math.round(this.host.fps()));
      }
    }
  }

  /** Stars-so-far at the top centre (Big kid only; non-interactive). */
  setHud(visible: boolean, earned: number, max: number): void {
    this.hudStars.hidden = !visible;
    if (!visible || (this.hudShown.earned === earned && this.hudShown.max === max)) return;
    this.hudShown = { earned, max };
    this.hudStars.innerHTML = Array.from(
      { length: max },
      (_, i) => `<span class="${i < earned ? 'on' : ''}">${icons.star}</span>`,
    ).join('');
    this.hudStars.dataset.earned = String(earned);
  }

  setHint(visible: boolean): void {
    this.hint.classList.toggle('visible', visible);
  }

  // ---- building ----------------------------------------------------------------------------------

  private screenEls(): HTMLElement[] {
    return [
      this.title,
      this.levelsEl,
      this.hud,
      this.celebrate,
      this.finished,
      this.menu,
      this.card,
    ];
  }

  private button(
    cls: string,
    testId: string,
    label: string,
    html: string,
    onPress: () => void,
  ): HTMLButtonElement {
    const b = h(
      'button',
      cls,
      { type: 'button', 'data-testid': testId, 'aria-label': label },
      html,
    );
    b.addEventListener('click', () => {
      // A press only counts once the screen's lockout is over (a fresh pointerdown is required).
      if (performance.now() < this.readyAt) return;
      this.host.buttonPressed();
      onPress();
    });
    return b;
  }

  /** Content that is built when entering a base screen (not when a menu opens over it). */
  private rebuildBase(): void {
    this.hudShown = { earned: -1, max: -1 };
    if (this.base === 'finished') this.buildFinished();
    if (this.base === 'celebrating') {
      this.celebrate.classList.toggle('final', this.host.lastRun().final);
    }
  }

  private buildBurst(el: Element | null): void {
    if (!el) return;
    const run = this.host.lastRun();
    const n = run.final ? tuning.ui.finalConfettiPieces : tuning.ui.confettiPieces;
    const colors = ['#ff8fab', '#ffd23f', '#7be3d6', '#8fb8ff', '#b8f28a', '#ffb347'];
    let html = '';
    for (let i = 0; i < n; i++) {
      // Deterministic spread (no Math.random): golden-angle fan with varying distance and delay.
      const angle = (i * 137.5) % 360;
      const dist = 22 + ((i * 53) % 55);
      const delay = (i % 9) * 0.05;
      html += `<i style="--a:${angle}deg;--d:${dist}vmin;--c:${colors[i % colors.length]};--t:${delay}s"></i>`;
    }
    el.innerHTML = html;
  }

  private buildFinished(): void {
    const run = this.host.lastRun();
    this.finished.classList.toggle('final', run.final);
    this.finished.dataset.final = String(run.final);
    this.buildBurst(this.finished.querySelector('.burst'));
    this.finishStars.dataset.stars = String(run.stars);
    this.finishStars.innerHTML = Array.from(
      { length: run.maxStars },
      (_, i) =>
        `<span class="${i < run.stars ? 'lit' : 'dim'}" style="--i:${i}">${icons.star}</span>`,
    ).join('');
  }

  private buildTiles(): void {
    const save = this.host.save();
    const profile = save.balls[save.selectedBall];
    if (!profile) return;
    const firstUnfinished = this.host.levels.findIndex(
      (l, i) => isLevelOpen(profile, i) && !(profile.stars[l.id] ?? 0),
    );
    this.tiles.replaceChildren();
    this.host.levels.forEach((level, i) => {
      const open = isLevelOpen(profile, i);
      if (!open && profile.tier === 'tiny') return; // locked tiles are never drawn in Tiny
      const earned = profile.stars[level.id] ?? 0;
      const cls = `tile ${level.palette}${open ? '' : ' locked'}${i === firstUnfinished ? ' next' : ''}`;
      const stars = Array.from(
        { length: level.maxStars },
        (_, k) => `<span class="${k < earned ? 'on' : ''}">${icons.star}</span>`,
      ).join('');
      const tile = this.button(
        cls,
        `tile-${i}`,
        level.name,
        `<span class="glyph">${open ? paletteGlyph(level.palette) : icons.lock}</span><span class="tile-stars">${stars}</span>`,
        () => {
          if (open) this.host.playLevel(i);
        },
      );
      if (!open) tile.disabled = true;
      tile.dataset.earned = String(earned);
      this.tiles.append(tile);
    });
  }

  private renderOverlays(): void {
    const { base } = this;
    const menuOpen = this.flow.state === 'parentMenu';
    this.title.hidden = base !== 'title';
    this.levelsEl.hidden = base !== 'levelSelect';
    this.hud.hidden = base !== 'playing';
    this.celebrate.hidden = base !== 'celebrating';
    this.finished.hidden = base !== 'finished';
    this.menu.hidden = !menuOpen;
    this.card.hidden = !this.cardOpen;
    if (menuOpen) this.fpsEl.textContent = String(Math.round(this.host.fps()));
  }

  /** The visible screens report `data-ready` once the 500 ms lockout is over. */
  private stampReady(): void {
    const els = this.screenEls();
    for (const el of els) el.dataset.ready = 'false';
    const token = ++this.readyToken;
    this.readyAt = performance.now() + tuning.input.lockoutMs;
    window.setTimeout(() => {
      if (token !== this.readyToken) return;
      for (const el of els) el.dataset.ready = 'true';
    }, tuning.input.lockoutMs);
  }

  // ---- reset slider ------------------------------------------------------------------------------

  private wireSlider(): void {
    // The whole track accepts the press (a finger that lands beside the thumb, or a thumb
    // still snapping back from an earlier short drag, must not make the slider dead).
    let pointer: number | null = null;
    let startX = 0;
    let travel = 1;
    const move = (e: PointerEvent): number => {
      const dx = Math.max(0, Math.min(travel, e.clientX - startX));
      this.thumb.style.transform = `translateX(${dx}px)`;
      return dx / travel;
    };
    this.slider.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      pointer = e.pointerId;
      startX = e.clientX;
      travel = Math.max(1, this.slider.clientWidth - this.thumb.offsetWidth);
      this.thumb.classList.remove('snap');
      try {
        this.slider.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers may not be capturable; move / up still arrive on the thumb.
      }
    });
    this.slider.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointer) move(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pointer) return;
      const done = move(e) >= tuning.ui.resetConfirmFraction;
      pointer = null;
      this.thumb.classList.add('snap');
      this.thumb.style.transform = '';
      if (done) {
        this.host.resetBall();
        this.slider.classList.add('done');
        window.setTimeout(() => this.slider.classList.remove('done'), 1200);
      }
    };
    this.slider.addEventListener('pointerup', end);
    this.slider.addEventListener('pointercancel', (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.thumb.classList.add('snap');
      this.thumb.style.transform = '';
    });
  }

  // ---- parent gate wiring ------------------------------------------------------------------------

  private setRings(progress: number, corners: GateCorner[]): void {
    for (const corner of ['tl', 'br'] as const) {
      const el = this.ringEls[corner];
      const on = corners.includes(corner);
      el.parentElement?.parentElement?.classList.toggle('active', on);
      el.style.strokeDashoffset = String(GATE_RING_LEN * (1 - (on ? progress : 0)));
    }
  }

  /**
   * Window-level capture listeners: a pointer that starts in a corner zone belongs to the gate and,
   * when it was aimed at the canvas, is stopped before `Input` can see it. Pointers on buttons are
   * only observed (the button still gets its click).
   */
  private attachGate(): void {
    const win = this.win;
    const canvasTarget = (e: Event): boolean =>
      (e.target as HTMLElement | null)?.tagName === 'CANVAS';
    const syncViewport = (): void => this.gate.setViewport(win.innerWidth, win.innerHeight);
    syncViewport();
    win.addEventListener('resize', syncViewport);
    win.addEventListener(
      'pointerdown',
      (e) => {
        if (this.gate.pointerDown(e.pointerId, e.clientX, e.clientY) && canvasTarget(e)) {
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    win.addEventListener(
      'pointermove',
      (e) => this.gate.pointerMove(e.pointerId, e.clientX, e.clientY),
      true,
    );
    for (const type of ['pointerup', 'pointercancel'] as const) {
      win.addEventListener(type, (e) => this.gate.pointerUp(e.pointerId), true);
    }
    win.addEventListener('blur', () => this.gate.reset());
    win.document.addEventListener('visibilitychange', () => {
      if (win.document.visibilityState !== 'visible') this.gate.reset();
    });
  }
}
