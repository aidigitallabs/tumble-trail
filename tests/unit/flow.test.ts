import { describe, expect, it } from 'vitest';
import { initialFlow, transition, type FlowEvent, type FlowState } from '../../src/app/flow';
import type { TTState } from '../../src/app/tt';

const at = (state: TTState, under: TTState | null = null): FlowState => ({ state, under });

function run(start: FlowState, events: FlowEvent[]): FlowState {
  let f = start;
  for (const e of events) {
    const next = transition(f, e);
    if (!next) throw new Error(`${e.type} not valid in ${f.state}`);
    f = next;
  }
  return f;
}

describe('flow: the happy path', () => {
  it('boot -> title -> playing -> celebrating -> finished -> playing next', () => {
    let f = initialFlow;
    for (const [event, state] of [
      ['ready', 'title'],
      ['play', 'playing'],
      ['finish', 'celebrating'],
      ['celebrationDone', 'finished'],
      ['play', 'playing'],
    ] as const) {
      f = transition(f, { type: event }) as FlowState;
      expect(f.state).toBe(state);
    }
  });

  it('title <-> levelSelect, levelSelect -> playing, finished -> levelSelect', () => {
    expect(run(at('title'), [{ type: 'openLevels' }]).state).toBe('levelSelect');
    expect(run(at('levelSelect'), [{ type: 'levelsHome' }]).state).toBe('title');
    expect(run(at('levelSelect'), [{ type: 'play' }]).state).toBe('playing');
    expect(run(at('finished'), [{ type: 'toLevels' }]).state).toBe('levelSelect');
  });
});

describe('flow: nothing advances on its own or out of order', () => {
  it('celebrating cannot be left except by celebrationDone (or the parent gate)', () => {
    const f = at('celebrating');
    for (const type of [
      'play',
      'toLevels',
      'openLevels',
      'levelsHome',
      'finish',
      'ready',
    ] as const) {
      expect(transition(f, { type }), type).toBeNull();
    }
    expect(transition(f, { type: 'celebrationDone' })?.state).toBe('finished');
  });

  it('finished only leaves through play or toLevels', () => {
    const f = at('finished');
    for (const type of ['finish', 'celebrationDone', 'openLevels', 'ready'] as const) {
      expect(transition(f, { type }), type).toBeNull();
    }
  });

  it('playing has no way out except finishing or the parent gate', () => {
    const f = at('playing');
    for (const type of [
      'play',
      'toLevels',
      'openLevels',
      'levelsHome',
      'celebrationDone',
      'ready',
      'closeParent',
      'parentHome',
    ] as const) {
      expect(transition(f, { type }), type).toBeNull();
    }
  });

  it('finish is only valid while playing', () => {
    for (const s of ['boot', 'title', 'levelSelect', 'celebrating', 'finished'] as const) {
      expect(transition(at(s), { type: 'finish' }), s).toBeNull();
    }
  });
});

describe('flow: the parent menu', () => {
  const states: TTState[] = ['title', 'levelSelect', 'playing', 'celebrating', 'finished'];

  it('opens from every state except boot and remembers what is under it', () => {
    for (const s of states) {
      expect(transition(at(s), { type: 'openParent' })).toEqual({
        state: 'parentMenu',
        under: s,
      });
    }
    expect(transition(at('boot'), { type: 'openParent' })).toBeNull();
  });

  it('does not open on top of itself', () => {
    expect(transition(at('parentMenu', 'playing'), { type: 'openParent' })).toBeNull();
  });

  it('resume returns to exactly the state underneath', () => {
    for (const s of states) {
      const open = transition(at(s), { type: 'openParent' }) as FlowState;
      expect(transition(open, { type: 'closeParent' })).toEqual({ state: s, under: null });
    }
  });

  it('home goes to the title from any state', () => {
    for (const s of states) {
      const open = transition(at(s), { type: 'openParent' }) as FlowState;
      expect(transition(open, { type: 'parentHome' })?.state).toBe('title');
    }
  });

  it('ignores game events while the menu is open', () => {
    const f = at('parentMenu', 'finished');
    for (const type of ['play', 'finish', 'celebrationDone', 'toLevels', 'openLevels'] as const) {
      expect(transition(f, { type }), type).toBeNull();
    }
  });

  it('forcePlay (the loadLevel test hook) works from anywhere after boot and closes the menu', () => {
    for (const s of [...states, 'parentMenu'] as const) {
      expect(transition(at(s, s === 'parentMenu' ? 'title' : null), { type: 'forcePlay' })).toEqual(
        at('playing'),
      );
    }
    expect(transition(at('boot'), { type: 'forcePlay' })).toBeNull();
  });
});
