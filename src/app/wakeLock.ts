/** The part of `navigator.wakeLock` we use (so a test can fake it). */
export interface WakeLockApi {
  request(type: 'screen'): Promise<{ released: boolean; release(): Promise<void> }>;
}

/**
 * Keeps the screen awake while a level is being played (PLAN section 8). The browser drops the lock
 * when the page is hidden, so it is requested again on `visibilitychange`. Every failure (no API,
 * no user activation, low battery) is ignored: the game plays the same without it.
 */
export class WakeLockKeeper {
  private sentinel: { released: boolean; release(): Promise<void> } | null = null;
  private wanted = false;

  constructor(
    private readonly api: WakeLockApi | undefined = (navigator as { wakeLock?: WakeLockApi })
      .wakeLock,
    doc: Document = document,
  ) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'visible' && this.wanted) void this.acquire();
    });
  }

  set(wanted: boolean): void {
    this.wanted = wanted;
    if (wanted) void this.acquire();
    else this.release();
  }

  private async acquire(): Promise<void> {
    if (!this.api || (this.sentinel && !this.sentinel.released)) return;
    try {
      this.sentinel = await this.api.request('screen');
      // Wanted turned off while the request was in flight.
      if (!this.wanted) this.release();
    } catch {
      this.sentinel = null;
    }
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) s.release().catch(() => {});
  }
}
