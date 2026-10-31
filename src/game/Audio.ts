import { tuning, type NoteSpec, type SoundSpec } from '../config/tuning';

/**
 * Synthesised audio (PLAN section 10). Everything is an oscillator through a low-pass and an
 * envelope; there are no audio files and no noise sources. This module never runs inside the
 * physics step or `fastForward`: the app calls it from the render step only.
 *
 * Context lifecycle (iOS): the `AudioContext` is created lazily on the first `pointerup` (a touch
 * `pointerdown` is not a user activation), `resume()` is retried on every later `pointerup` while
 * it is not running and when the page becomes visible again, and it is suspended while hidden.
 * Before the first gesture nothing is created, so nothing can warn or throw.
 */

export type SoundName = keyof typeof tuning.audio.sounds;
export type AudioState = 'none' | AudioContextState;

const dbToGain = (db: number): number => 10 ** (db / 20);

/** Master gain for the mute flag (PLAN: -6 dB, 0 when muted). */
export function masterGain(muted: boolean): number {
  return muted ? 0 : dbToGain(tuning.audio.masterDb);
}

/** Rolling hum level at full speed, relative to the loudest SFX note (-18 dB). */
export function rollingMaxGain(): number {
  return tuning.audio.sfxPeak * dbToGain(tuning.audio.rolling.db);
}

/** Rolling hum frequency for a 0..1 speed ratio. */
export function rollingHz(ratio: number): number {
  const r = tuning.audio.rolling;
  return r.minHz + (r.maxHz - r.minHz) * Math.min(1, Math.max(0, ratio));
}

export interface Envelope {
  /** Envelope times relative to the note start: gain 0 at 0, peak at `attack`, hold, 0 at `end`. */
  attack: number;
  holdEnd: number;
  release: number;
  end: number;
  peakGain: number;
  cutoffHz: number;
}

/** The envelope of a note with the PLAN's floors applied (attack >= 10 ms, release >= 60 ms, cutoff <= 3 kHz). */
export function envelopeFor(note: NoteSpec): Envelope {
  const a = tuning.audio;
  const attack = Math.max(a.minAttackS, note.attack);
  const release = Math.max(a.minReleaseS, note.release);
  const holdEnd = attack + Math.max(0, note.hold);
  return {
    attack,
    holdEnd,
    release,
    end: holdEnd + release,
    peakGain: Math.min(1, Math.max(0, note.peak)) * a.sfxPeak,
    cutoffHz: Math.min(a.cutoffHz, a.maxCutoffHz),
  };
}

/** Total length of a sound in seconds (last note's end). */
export function soundDuration(sound: SoundSpec): number {
  let end = 0;
  for (const n of sound.notes) end = Math.max(end, n.at + envelopeFor(n).end);
  return end;
}

/** Frequency of the `n`th contact blip (cycles through the pentatonic scale; no randomness). */
export function pentatonicHz(n: number): number {
  const scale = tuning.audio.pentatonicHz;
  return scale[((n % scale.length) + scale.length) % scale.length] as number;
}

/** Frequency of the `i`th star tick (ascending; the last repeats). */
export function starTickHz(i: number): number {
  const ticks = tuning.audio.starTickHz;
  return ticks[Math.min(Math.max(0, i), ticks.length - 1)] as number;
}

/**
 * Schedule one note: oscillator -> low-pass -> enveloped gain -> `dest`, starting at `t`.
 * `hzOverride` replaces the note's frequency when the note says `hz: 0`.
 */
export function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  note: NoteSpec,
  t: number,
  hzOverride = 0,
): void {
  const env = envelopeFor(note);
  const hz = note.hz > 0 ? note.hz : hzOverride;
  const start = t + note.at;

  const osc = ctx.createOscillator();
  osc.type = note.type;
  osc.frequency.setValueAtTime(hz, start);
  if (note.glideTo !== undefined && note.glideS !== undefined) {
    osc.frequency.linearRampToValueAtTime(note.glideTo, start + note.glideS);
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = env.cutoffHz;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(env.peakGain, start + env.attack);
  gain.gain.linearRampToValueAtTime(env.peakGain, start + env.holdEnd);
  gain.gain.linearRampToValueAtTime(0, start + env.end);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  osc.onended = () => {
    osc.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
  osc.start(start);
  osc.stop(start + env.end + 0.02);
}

export interface GameAudioOptions {
  /** Test seam; the default builds a real (or webkit-prefixed) `AudioContext`. */
  createContext?: () => AudioContext | null;
  muted?: boolean;
}

function defaultContext(): AudioContext | null {
  const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/** The sound engine: one lazily created context, a master gain, an SFX bus and the rolling hum. */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private rollGain: GainNode | null = null;
  private rollOsc: OscillatorNode | null = null;
  private _muted: boolean;
  private contactCount = 0;
  private duckUntil = 0;
  private rollRatio = 0;
  private readonly createContext: () => AudioContext | null;

  constructor(opts: GameAudioOptions = {}) {
    this.createContext = opts.createContext ?? defaultContext;
    this._muted = opts.muted ?? false;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** 'none' until the first gesture has created the context. */
  get state(): AudioState {
    return this.ctx ? this.ctx.state : 'none';
  }

  /**
   * Call on every `pointerup`: creates the context on the first one and retries `resume()` while
   * it is not running (iOS may also leave it `interrupted`).
   */
  unlock(): void {
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    this.resume(ctx);
  }

  /** `visibilitychange`: suspend while hidden, try to resume when visible again. */
  setVisible(visible: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (!visible) {
      if (ctx.state === 'running') this.guard(() => ctx.suspend());
      this.setRolling(0);
    } else if (ctx.state !== 'running') {
      this.resume(ctx);
    }
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.setTargetAtTime(
      masterGain(muted),
      ctx.currentTime,
      tuning.audio.muteTimeConstantS,
    );
  }

  /** Play a named sound now (render step only). Silently ignored while muted or not running. */
  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!this.ready(ctx)) return;
    const sound: SoundSpec = tuning.audio.sounds[name];
    const t = ctx.currentTime;
    const hz = name === 'contact' ? pentatonicHz(this.contactCount++) : 0;
    for (const note of sound.notes) scheduleNote(ctx, this.sfx as GainNode, note, t, hz);
    this.duck(ctx, t + soundDuration(sound));
  }

  /** Ascending ticks, one per star, `stepS` apart, scheduled on the audio clock. */
  starTicks(count: number, stepS: number): void {
    const ctx = this.ctx;
    if (!this.ready(ctx)) return;
    const tick = tuning.audio.sounds.tick;
    const t0 = ctx.currentTime + tuning.audio.starTickFirstS;
    for (let i = 0; i < count; i++) {
      for (const note of tick.notes) {
        scheduleNote(ctx, this.sfx as GainNode, note, t0 + i * stepS, starTickHz(i));
      }
    }
  }

  /** Rolling hum level, 0..1 of full speed (0 = silent). Call once per rendered frame. */
  setRolling(ratio: number): void {
    const ctx = this.ctx;
    const gain = this.rollGain;
    const osc = this.rollOsc;
    if (!ctx || !gain || !osc) return;
    const r = Math.min(1, Math.max(0, ratio));
    const roll = tuning.audio.rolling;
    if (Math.abs(r - this.rollRatio) < roll.epsilon && !(r === 0 && this.rollRatio !== 0)) return;
    const rising = r > this.rollRatio;
    this.rollRatio = r;
    const t = ctx.currentTime;
    gain.gain.setTargetAtTime(r * rollingMaxGain(), t, rising ? roll.attackTc : roll.releaseTc);
    osc.frequency.setTargetAtTime(rollingHz(r), t, roll.attackTc);
  }

  // ---- internals -------------------------------------------------------------------------------

  private ready(ctx: AudioContext | null): ctx is AudioContext {
    return !!ctx && ctx.state === 'running' && !this._muted && !!this.sfx;
  }

  private resume(ctx: AudioContext): void {
    this.guard(() => ctx.resume());
  }

  /** Run an audio call that may throw or reject (iOS refuses without a gesture) and swallow it. */
  private guard(call: () => Promise<void>): void {
    try {
      void call().catch(() => undefined);
    } catch {
      // Closed or refused: the next pointerup tries again.
    }
  }

  private build(): void {
    let ctx: AudioContext | null;
    try {
      ctx = this.createContext();
    } catch {
      ctx = null;
    }
    if (!ctx) return;
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = masterGain(this._muted);
    master.connect(ctx.destination);

    const sfx = ctx.createGain();
    sfx.connect(master);

    // Rolling hum: triangle -> low-pass -> speed gain -> duck gain -> master.
    const roll = tuning.audio.rolling;
    const duck = ctx.createGain();
    duck.connect(master);
    const rollGain = ctx.createGain();
    rollGain.gain.value = 0;
    rollGain.connect(duck);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(roll.cutoffHz, tuning.audio.maxCutoffHz);
    filter.connect(rollGain);
    const osc = ctx.createOscillator();
    osc.type = roll.type;
    osc.frequency.value = rollingHz(0);
    osc.connect(filter);
    osc.start();

    this.master = master;
    this.sfx = sfx;
    this.duckGain = duck;
    this.rollGain = rollGain;
    this.rollOsc = osc;
  }

  /** Drop the rolling hum while an SFX plays, back up `tailS` after the last one ends. */
  private duck(ctx: AudioContext, until: number): void {
    const duck = this.duckGain;
    if (!duck) return;
    const d = tuning.audio.duck;
    const t = ctx.currentTime;
    this.duckUntil = Math.max(this.duckUntil, until + d.tailS);
    duck.gain.cancelScheduledValues(t);
    duck.gain.setTargetAtTime(d.gain, t, d.attackTc);
    duck.gain.setTargetAtTime(1, this.duckUntil, d.releaseTc);
  }
}
