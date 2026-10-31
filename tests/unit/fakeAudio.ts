/**
 * A minimal fake Web Audio graph for unit tests (no dependency): it records every AudioParam
 * automation call and every node, and exposes a settable `state`, so the scheduling maths and the
 * context lifecycle can be asserted without a browser.
 */

export interface ParamEvent {
  type: 'set' | 'linear' | 'exp' | 'target' | 'cancel';
  value: number;
  time: number;
  timeConstant?: number;
}

export class FakeParam {
  events: ParamEvent[] = [];
  private _value = 0;
  get value(): number {
    return this._value;
  }
  set value(v: number) {
    this._value = v;
    this.events.push({ type: 'set', value: v, time: -1 });
  }
  setValueAtTime(value: number, time: number): this {
    this._value = value;
    this.events.push({ type: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: 'target', value, time, timeConstant });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancel', value: 0, time });
    return this;
  }
}

export class FakeNode {
  connections: FakeNode[] = [];
  disconnected = false;
  connect(dest: FakeNode): FakeNode {
    this.connections.push(dest);
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam();
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
}

export class FakeOsc extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(t = 0): void {
    this.startedAt = t;
  }
  stop(t = 0): void {
    this.stoppedAt = t;
  }
}

export class FakeContext {
  currentTime = 0;
  state: AudioContextState;
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly oscs: FakeOsc[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  /** What `resume()` does: 'running' (default), or stay as is (iOS refusing without a gesture). */
  resumeResult: AudioContextState | 'stay' | 'reject' = 'running';

  constructor(state: AudioContextState = 'suspended') {
    this.state = state;
  }
  createGain(): FakeGain {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBiquadFilter(): FakeFilter {
    const f = new FakeFilter();
    this.filters.push(f);
    return f;
  }
  createOscillator(): FakeOsc {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o;
  }
  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeResult === 'reject') return Promise.reject(new Error('NotAllowedError'));
    if (this.resumeResult !== 'stay') this.state = this.resumeResult;
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspendCalls++;
    this.state = 'suspended';
    return Promise.resolve();
  }

  /** Treat as the real thing for code that takes an `AudioContext`. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
