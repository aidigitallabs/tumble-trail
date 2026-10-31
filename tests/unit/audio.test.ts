import { describe, expect, it } from 'vitest';
import { tuning, type NoteSpec, type SoundSpec } from '../../src/config/tuning';
import {
  GameAudio,
  envelopeFor,
  masterGain,
  pentatonicHz,
  rollingHz,
  rollingMaxGain,
  scheduleNote,
  soundDuration,
  starTickHz,
  type SoundName,
} from '../../src/game/Audio';
import { FakeContext, FakeGain, FakeNode } from './fakeAudio';

const sounds: Record<SoundName, SoundSpec> = tuning.audio.sounds;
const names = Object.keys(sounds) as SoundName[];

/** Run a promise-returning side effect to completion (the engine fires and forgets). */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function running(opts: { muted?: boolean } = {}): { audio: GameAudio; ctx: FakeContext } {
  const ctx = new FakeContext('suspended');
  const audio = new GameAudio({ createContext: () => ctx.asAudioContext(), muted: opts.muted });
  audio.unlock();
  return { audio, ctx };
}

describe('envelope maths (PLAN section 10)', () => {
  const note: NoteSpec = {
    hz: 440,
    at: 0,
    attack: 0.001,
    hold: 0,
    release: 0.001,
    peak: 2,
    type: 'sine',
  };

  it('raises the attack to 10 ms and the release to 60 ms, caps the peak and the cutoff', () => {
    const env = envelopeFor(note);
    expect(env.attack).toBeGreaterThanOrEqual(0.01);
    expect(env.release).toBeGreaterThanOrEqual(0.06);
    expect(env.peakGain).toBeCloseTo(tuning.audio.sfxPeak, 9);
    expect(env.cutoffHz).toBeLessThanOrEqual(3000);
  });

  it('leaves a longer attack / release alone and adds the hold', () => {
    const env = envelopeFor({ ...note, attack: 0.05, hold: 0.2, release: 0.5, peak: 0.5 });
    expect(env.attack).toBeCloseTo(0.05, 9);
    expect(env.holdEnd).toBeCloseTo(0.25, 9);
    expect(env.end).toBeCloseTo(0.75, 9);
    expect(env.peakGain).toBeCloseTo(0.5 * tuning.audio.sfxPeak, 9);
  });

  it('soundDuration is the end of the last note', () => {
    for (const name of names) {
      const s = sounds[name];
      const last = Math.max(...s.notes.map((n) => n.at + envelopeFor(n).end));
      expect(soundDuration(s)).toBeCloseTo(last, 9);
    }
  });

  it('master gain is -6 dB and 0 when muted', () => {
    expect(masterGain(false)).toBeCloseTo(0.5012, 3);
    expect(masterGain(true)).toBe(0);
  });

  it('the rolling hum tops out 18 dB under the loudest SFX note', () => {
    const db = 20 * Math.log10(rollingMaxGain() / tuning.audio.sfxPeak);
    expect(db).toBeCloseTo(-18, 6);
    expect(rollingHz(0)).toBe(tuning.audio.rolling.minHz);
    expect(rollingHz(1)).toBe(tuning.audio.rolling.maxHz);
    expect(rollingHz(5)).toBe(tuning.audio.rolling.maxHz);
    expect(rollingHz(-1)).toBe(tuning.audio.rolling.minHz);
  });
});

describe('scheduleNote through a fake context', () => {
  it.each(names)('%s: every note obeys attack / release / low-pass / waveform rules', (name) => {
    const ctx = new FakeContext('running');
    const dest = new FakeNode();
    for (const note of sounds[name].notes) {
      // The tuning itself must already respect the floors (the clamp is a safety net).
      expect(note.attack, `${name} attack`).toBeGreaterThanOrEqual(tuning.audio.minAttackS);
      expect(note.release, `${name} release`).toBeGreaterThanOrEqual(tuning.audio.minReleaseS);
      scheduleNote(ctx.asAudioContext(), dest as unknown as AudioNode, note, 10, 523.25);
    }
    expect(ctx.oscs).toHaveLength(sounds[name].notes.length);

    ctx.oscs.forEach((osc, i) => {
      const note = sounds[name].notes[i] as NoteSpec;
      const env = envelopeFor(note);
      const start = 10 + note.at;
      // Sine / triangle only: no noise, no harsh waveforms.
      expect(['sine', 'triangle']).toContain(osc.type);
      expect(osc.startedAt).toBeCloseTo(start, 9);
      expect(osc.stoppedAt as number).toBeGreaterThan(start + env.end);

      // Chain: osc -> low-pass -> gain -> destination.
      const filter = osc.connections[0] as unknown as (typeof ctx.filters)[number];
      expect(ctx.filters).toContain(filter);
      expect(filter.type).toBe('lowpass');
      expect(filter.frequency.events.at(-1)?.value).toBeLessThanOrEqual(3000);
      const gain = filter.connections[0] as FakeGain;
      expect(gain.connections[0]).toBe(dest);

      // Envelope: 0 at the start, peak after >= 10 ms, 0 again after a release >= 60 ms.
      const ev = gain.gain.events;
      expect(ev[0]).toMatchObject({ type: 'set', value: 0, time: start });
      const peak = ev.find((e) => e.type === 'linear' && e.value > 0);
      expect((peak?.time ?? 0) - start).toBeGreaterThanOrEqual(0.01 - 1e-9);
      const holdEnd = ev.filter((e) => e.type === 'linear' && e.value > 0).at(-1);
      const end = ev.at(-1);
      expect(end).toMatchObject({ type: 'linear', value: 0 });
      expect((end?.time ?? 0) - (holdEnd?.time ?? 0)).toBeGreaterThanOrEqual(0.06 - 1e-9);
      expect(Math.max(...ev.map((e) => e.value))).toBeLessThanOrEqual(tuning.audio.sfxPeak);
    });
  });

  it('cleans up its nodes when the oscillator ends', () => {
    const ctx = new FakeContext('running');
    scheduleNote(
      ctx.asAudioContext(),
      new FakeNode() as unknown as AudioNode,
      sounds.click.notes[0] as NoteSpec,
      0,
    );
    const osc = ctx.oscs[0];
    osc?.onended?.();
    expect(osc?.disconnected).toBe(true);
    expect(ctx.gains[0]?.disconnected).toBe(true);
  });
});

describe('the sounds themselves', () => {
  it('has a sound for every event in PLAN section 10', () => {
    expect([...names].sort()).toEqual(
      ['celebration', 'checkpoint', 'click', 'contact', 'pop', 'respawn', 'tick'].sort(),
    );
  });

  it('checkpoint is a two-note rising chime', () => {
    const [a, b] = sounds.checkpoint.notes;
    expect(sounds.checkpoint.notes).toHaveLength(2);
    expect(b?.hz).toBeGreaterThan(a?.hz ?? Infinity);
    expect(b?.at).toBeGreaterThan(a?.at ?? Infinity);
  });

  it('respawn never descends', () => {
    for (const n of sounds.respawn.notes) {
      expect(n.glideTo ?? n.hz).toBeGreaterThanOrEqual(n.hz);
    }
  });

  it('pop is a soft pop followed by a rising blip', () => {
    const [pop, blip] = sounds.pop.notes;
    expect(pop?.glideTo).toBeLessThan(pop?.hz ?? 0);
    expect(blip?.glideTo).toBeGreaterThan(blip?.hz ?? Infinity);
    expect(blip?.at).toBeGreaterThan(pop?.at ?? Infinity);
  });

  it('celebration is a four-note major arpeggio plus a tonal whoosh (no noise)', () => {
    const arp = sounds.celebration.notes.filter((n) => n.glideTo === undefined);
    expect(arp).toHaveLength(4);
    const root = arp[0]?.hz ?? 1;
    const semis = arp.map((n) => Math.round(12 * Math.log2(n.hz / root)));
    expect(semis).toEqual([0, 4, 7, 12]);
    expect(arp.map((n) => n.at)).toEqual([...arp.map((n) => n.at)].sort((a, b) => a - b));
    const whoosh = sounds.celebration.notes.filter((n) => n.glideTo !== undefined);
    expect(whoosh).toHaveLength(1);
    expect(whoosh[0]?.type).toBe('sine');
  });

  it('contact blips walk the pentatonic scale; star ticks ascend', () => {
    const scale = tuning.audio.pentatonicHz;
    const seen = Array.from({ length: scale.length * 2 }, (_, i) => pentatonicHz(i));
    expect(seen.slice(0, scale.length)).toEqual([...scale]);
    expect(seen.slice(scale.length)).toEqual([...scale]);
    const ticks = Array.from({ length: 10 }, (_, i) => starTickHz(i));
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1] as number);
    }
    expect(starTickHz(0)).toBeLessThan(starTickHz(5));
    expect(starTickHz(-3)).toBe(starTickHz(0));
  });

  it('no note exceeds what a 3 kHz low-pass can carry as a fundamental', () => {
    for (const name of names) {
      for (const n of sounds[name].notes) {
        expect(Math.max(n.hz, n.glideTo ?? 0)).toBeLessThanOrEqual(tuning.audio.maxCutoffHz);
      }
    }
    expect(Math.max(...tuning.audio.starTickHz)).toBeLessThanOrEqual(tuning.audio.maxCutoffHz);
    expect(tuning.audio.cutoffHz).toBeLessThanOrEqual(tuning.audio.maxCutoffHz);
  });
});

describe('GameAudio lifecycle (PLAN section 10)', () => {
  it('creates nothing before the first gesture and tolerates every call', () => {
    let made = 0;
    const audio = new GameAudio({
      createContext: () => {
        made++;
        return new FakeContext().asAudioContext();
      },
    });
    audio.play('click');
    audio.setRolling(1);
    audio.starTicks(3, 0.38);
    audio.setMuted(true);
    audio.setVisible(false);
    audio.setVisible(true);
    expect(made).toBe(0);
    expect(audio.state).toBe('none');
    expect(audio.muted).toBe(true);
  });

  it('creates the context once on the first unlock and resumes it', async () => {
    const { audio, ctx } = running();
    await flush();
    expect(ctx.resumeCalls).toBe(1);
    expect(audio.state).toBe('running');
    audio.unlock();
    audio.unlock();
    expect(ctx.resumeCalls).toBe(1); // already running: nothing to retry
    expect(ctx.oscs).toHaveLength(1); // just the rolling hum
  });

  it('retries resume() on every unlock while not running (iOS), swallowing refusals', async () => {
    const { audio, ctx } = running();
    ctx.state = 'interrupted';
    ctx.resumeResult = 'reject';
    audio.unlock();
    audio.unlock();
    await flush();
    expect(ctx.resumeCalls).toBe(3);
    expect(audio.state).toBe('interrupted');
    ctx.resumeResult = 'running';
    audio.unlock();
    await flush();
    expect(audio.state).toBe('running');
  });

  it('survives a context that cannot be built', () => {
    const audio = new GameAudio({
      createContext: () => {
        throw new Error('no audio');
      },
    });
    expect(() => audio.unlock()).not.toThrow();
    expect(audio.state).toBe('none');
    const none = new GameAudio({ createContext: () => null });
    none.unlock();
    expect(none.state).toBe('none');
  });

  it('suspends while hidden and resumes when visible again', async () => {
    const { audio, ctx } = running();
    await flush();
    audio.setVisible(false);
    await flush();
    expect(ctx.suspendCalls).toBe(1);
    expect(audio.state).toBe('suspended');
    audio.setVisible(true);
    await flush();
    expect(audio.state).toBe('running');
    const before = ctx.resumeCalls;
    audio.setVisible(true);
    expect(ctx.resumeCalls).toBe(before); // already running
  });

  it('ignores play() until the context is running', () => {
    const { audio, ctx } = running();
    // Not yet resumed (the promise has not been flushed): state is still suspended.
    ctx.state = 'suspended';
    const before = ctx.oscs.length;
    audio.play('checkpoint');
    expect(ctx.oscs.length).toBe(before);
  });
});

describe('mute and master gain', () => {
  it('sets the master gain from the persisted flag when the context is created', () => {
    const muted = running({ muted: true });
    const master = muted.ctx.gains[0] as FakeGain;
    expect(master.gain.value).toBe(0);
    const open = running();
    expect((open.ctx.gains[0] as FakeGain).gain.value).toBeCloseTo(masterGain(false), 9);
    expect(master.connections[0]).toBe(muted.ctx.destination);
  });

  it('setMuted ramps the master gain with a short time constant', async () => {
    const { audio, ctx } = running();
    await flush();
    const master = ctx.gains[0] as FakeGain;
    audio.setMuted(true);
    expect(master.gain.events.at(-1)).toMatchObject({
      type: 'target',
      value: 0,
      timeConstant: tuning.audio.muteTimeConstantS,
    });
    audio.setMuted(false);
    expect(master.gain.events.at(-1)?.value).toBeCloseTo(0.5012, 3);
    expect(audio.muted).toBe(false);
  });

  it('plays nothing while muted, and again after unmuting', async () => {
    const { audio, ctx } = running({ muted: true });
    await flush();
    const base = ctx.oscs.length;
    audio.play('pop');
    audio.starTicks(2, 0.3);
    expect(ctx.oscs.length).toBe(base);
    audio.setMuted(false);
    audio.play('pop');
    expect(ctx.oscs.length).toBe(base + sounds.pop.notes.length);
  });
});

describe('playing sounds', () => {
  it('schedules every note of a sound at the context time through the SFX bus', async () => {
    const { audio, ctx } = running();
    await flush();
    ctx.currentTime = 4;
    const base = ctx.oscs.length;
    audio.play('celebration');
    const mine = ctx.oscs.slice(base);
    expect(mine).toHaveLength(sounds.celebration.notes.length);
    mine.forEach((o, i) => {
      expect(o.startedAt).toBeCloseTo(4 + (sounds.celebration.notes[i] as NoteSpec).at, 9);
    });
  });

  it('cycles the contact blip through the pentatonic scale', async () => {
    const { audio, ctx } = running();
    await flush();
    const base = ctx.oscs.length;
    for (let i = 0; i < 6; i++) audio.play('contact');
    const hz = ctx.oscs.slice(base).map((o) => o.frequency.events[0]?.value);
    expect(hz).toEqual([0, 1, 2, 3, 4, 0].map((i) => tuning.audio.pentatonicHz[i]));
  });

  it('schedules ascending star ticks on the audio clock', async () => {
    const { audio, ctx } = running();
    await flush();
    ctx.currentTime = 2;
    const base = ctx.oscs.length;
    audio.starTicks(3, 0.38);
    const ticks = ctx.oscs.slice(base);
    expect(ticks).toHaveLength(3);
    expect(ticks.map((o) => o.startedAt)).toEqual([2, 2.38, 2.76].map((t) => expect.closeTo(t, 9)));
    const hz = ticks.map((o) => o.frequency.events[0]?.value as number);
    expect(hz[1]).toBeGreaterThan(hz[0] as number);
    expect(hz[2]).toBeGreaterThan(hz[1] as number);
  });

  it('ducks the rolling hum while an SFX plays and brings it back after', async () => {
    const { audio, ctx } = running();
    await flush();
    const duck = ctx.gains[2] as FakeGain; // master, sfx, duck
    ctx.currentTime = 1;
    audio.play('checkpoint');
    const ev = duck.gain.events.filter((e) => e.type === 'target');
    expect(ev[0]).toMatchObject({ value: tuning.audio.duck.gain, time: 1 });
    expect(ev[1]?.value).toBe(1);
    expect(ev[1]?.time).toBeGreaterThanOrEqual(1 + soundDuration(sounds.checkpoint));
    // A second sound extends the duck instead of cutting it short.
    ctx.currentTime = 1.1;
    audio.play('celebration');
    const last = duck.gain.events.filter((e) => e.type === 'target').at(-1);
    expect(last?.time).toBeGreaterThanOrEqual(1.1 + soundDuration(sounds.celebration));
  });
});

describe('rolling hum', () => {
  it('follows speed with gain proportional to the ratio and attack / release floors', async () => {
    const { audio, ctx } = running();
    await flush();
    const roll = ctx.gains[3] as FakeGain; // master, sfx, duck, roll
    audio.setRolling(0.5);
    const up = roll.gain.events.at(-1);
    expect(up).toMatchObject({ type: 'target', timeConstant: tuning.audio.rolling.attackTc });
    expect(up?.value).toBeCloseTo(0.5 * rollingMaxGain(), 9);
    audio.setRolling(1);
    expect(roll.gain.events.at(-1)?.value).toBeCloseTo(rollingMaxGain(), 9);
    audio.setRolling(0.2);
    const down = roll.gain.events.at(-1);
    expect(down?.timeConstant).toBe(tuning.audio.rolling.releaseTc);
    expect(down?.value).toBeCloseTo(0.2 * rollingMaxGain(), 9);
    // Attack time constant >= 10 ms, release >= 60 ms (PLAN section 10).
    expect(tuning.audio.rolling.attackTc).toBeGreaterThanOrEqual(0.01);
    expect(tuning.audio.rolling.releaseTc).toBeGreaterThanOrEqual(0.06);
  });

  it('is a low-passed triangle and ignores tiny changes', async () => {
    const { audio, ctx } = running();
    await flush();
    const hum = ctx.oscs[0];
    expect(hum?.type).toBe('triangle');
    expect(ctx.filters[0]?.frequency.value).toBeLessThanOrEqual(3000);
    const roll = ctx.gains[3] as FakeGain;
    audio.setRolling(0.5);
    const n = roll.gain.events.length;
    audio.setRolling(0.505);
    expect(roll.gain.events.length).toBe(n);
    audio.setRolling(0);
    expect(roll.gain.events.at(-1)?.value).toBe(0);
    const m = roll.gain.events.length;
    audio.setRolling(0); // already silent: nothing new
    expect(roll.gain.events.length).toBe(m);
  });
});
