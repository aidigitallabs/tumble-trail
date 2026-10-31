import type { TTState } from './tt';

/**
 * Holds a waiting service-worker update until the game is on the title screen (PLAN section 8):
 * reloading mid-level or on the Finished screen would throw away what the child is doing.
 */
export class UpdateGate {
  private pending: (() => void) | null = null;

  /** An update is ready; `apply` activates it and reloads. Runs now only if `state` is the title. */
  offer(apply: () => void, state: TTState): void {
    this.pending = apply;
    this.check(state);
  }

  /** Call on every state change. Runs the pending update once, and only on the title. */
  check(state: TTState): boolean {
    if (state !== 'title' || !this.pending) return false;
    const apply = this.pending;
    this.pending = null;
    apply();
    return true;
  }

  get waiting(): boolean {
    return this.pending !== null;
  }
}
