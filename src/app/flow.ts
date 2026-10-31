import type { TTState } from './tt';

/**
 * The screen state machine (PLAN section 8), as a pure function so it can be unit tested:
 *
 *   boot -> title -> playing -> celebrating -> finished -> (playing next | levelSelect)
 *   title <-> levelSelect;  parentMenu overlays any state except boot and remembers what is under it.
 */
export interface FlowState {
  state: TTState;
  /** The state a parent menu overlays (only set while `state === 'parentMenu'`). */
  under: TTState | null;
}

export type FlowEvent =
  | { type: 'ready' }
  | { type: 'openLevels' }
  | { type: 'levelsHome' }
  | { type: 'play' }
  | { type: 'finish' }
  | { type: 'celebrationDone' }
  | { type: 'toLevels' }
  | { type: 'openParent' }
  | { type: 'closeParent' }
  | { type: 'parentHome' }
  /** Test hook (`__tt.loadLevel`): straight to playing from anywhere, closing a parent menu. */
  | { type: 'forcePlay' };

export const initialFlow: FlowState = { state: 'boot', under: null };

const at = (state: TTState): FlowState => ({ state, under: null });

/** The next flow state, or null when the event is not valid in the current state (ignored). */
export function transition(f: FlowState, e: FlowEvent): FlowState | null {
  const s = f.state;
  switch (e.type) {
    case 'ready':
      return s === 'boot' ? at('title') : null;
    case 'openLevels':
      return s === 'title' ? at('levelSelect') : null;
    case 'levelsHome':
      return s === 'levelSelect' ? at('title') : null;
    case 'play':
      return s === 'title' || s === 'levelSelect' || s === 'finished' ? at('playing') : null;
    case 'finish':
      return s === 'playing' ? at('celebrating') : null;
    case 'celebrationDone':
      return s === 'celebrating' ? at('finished') : null;
    case 'toLevels':
      return s === 'finished' ? at('levelSelect') : null;
    case 'openParent':
      return s === 'boot' || s === 'parentMenu' ? null : { state: 'parentMenu', under: s };
    case 'closeParent':
      return s === 'parentMenu' && f.under ? at(f.under) : null;
    case 'parentHome':
      return s === 'parentMenu' ? at('title') : null;
    case 'forcePlay':
      return s === 'boot' ? null : at('playing');
    default:
      return null;
  }
}
