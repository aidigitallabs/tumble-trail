import { tuning } from '../config/tuning';
import type { ColliderKind } from './Obstacles';

/**
 * Turns the raw per-step contact-force events into the few "contact" events the sound wants
 * (PLAN sections 6 and 10): only for NEW contacts (the collider had no force event in the previous
 * `newGapSteps`), never for the floor, with a per-collider refractory period and an overall cap on
 * the rate. Pure and clock-free: everything is counted in physics steps.
 */
export class ContactFilter {
  private readonly lastForce = new Map<number, number>();
  private readonly lastEmit = new Map<number, number>();
  private recent: number[] = [];
  private readonly newGapSteps: number;
  private readonly refractorySteps: number;
  private readonly windowSteps: number;
  private readonly maxPerWindow: number;

  constructor(cfg = tuning.contacts, physicsHz = tuning.physicsHz) {
    this.newGapSteps = cfg.newGapSteps;
    this.refractorySteps = Math.round(cfg.refractorySeconds * physicsHz);
    this.windowSteps = physicsHz;
    this.maxPerWindow = cfg.maxPerSecond;
  }

  /** True when a force event on collider `handle` at physics step `step` should be emitted. */
  offer(handle: number, kind: ColliderKind, step: number): boolean {
    if (kind === 'floor') return false;
    const last = this.lastForce.get(handle);
    this.lastForce.set(handle, step);
    const isNew = last === undefined || step - last > this.newGapSteps;
    if (!isNew) return false;
    const emitted = this.lastEmit.get(handle);
    if (emitted !== undefined && step - emitted < this.refractorySteps) return false;
    this.recent = this.recent.filter((s) => step - s < this.windowSteps);
    if (this.recent.length >= this.maxPerWindow) return false;
    this.lastEmit.set(handle, step);
    this.recent.push(step);
    return true;
  }
}
