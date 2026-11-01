/**
 * Counting semaphore: at most `max` calls in flight, the rest wait in FIFO order (audit C28 EXT-09). Moved here from
 * `lib/generation/llm/limiter.ts` (which keeps the per-provider table and registry) so the media router and the LLM
 * layer share one implementation (docs/studio/P0-SPEC.md §3.9). In-process only, no DB/Redis.
 */
type Waiter = { grant: (release: () => void) => void; timer?: ReturnType<typeof setTimeout> };

export class Semaphore {
  readonly max: number;
  private used = 0;
  private readonly queue: Waiter[] = [];

  constructor(max: number) {
    this.max = Math.max(1, Math.floor(max));
  }

  get active(): number {
    return this.used;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /**
   * Slot olish. Qaytgan funksiya slotni bo'shatadi (ikkinchi chaqiruv
   * hech narsa qilmaydi). `maxWaitMs` o'tsa `null` — chaqiruvchi bu
   * urinishni «vaqt yetmadi» deb hisoblaydi (provayder nosozligi EMAS).
   */
  acquire(maxWaitMs?: number): Promise<(() => void) | null> {
    if (this.used < this.max) {
      this.used += 1;
      return Promise.resolve(this.releaser());
    }
    if (maxWaitMs !== undefined && maxWaitMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter: Waiter = { grant: (release) => resolve(release) };
      if (maxWaitMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          resolve(null);
        }, maxWaitMs);
      }
      this.queue.push(waiter);
    });
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.queue.shift();
      if (next) {
        // Slot bo'shamaydi — to'g'ridan-to'g'ri navbatdagiga o'tadi.
        if (next.timer) clearTimeout(next.timer);
        next.grant(this.releaser());
      } else {
        this.used -= 1;
      }
    };
  }
}
