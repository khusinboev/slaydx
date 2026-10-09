/**
 * Paced rate limiter for bulk Telegram sends (docs/bonus/BONUS3.md C-Q5).
 *
 * Telegram allows a bot roughly 30 messages per second overall; the broadcast
 * engine stays at `perSecond` (25) with N concurrent senders. Three rules, all
 * enforced by ONE pump so waiters are served strictly first-in first-out:
 *
 *   1. even pacing  — consecutive grants are at least 1000 / perSecond ms apart
 *                     (no 25-message burst at the top of a second);
 *   2. sliding cap  — never more than `perSecond` grants inside any 1000 ms
 *                     window (hard cap; also guards against a late wake-up
 *                     followed by a catch-up burst);
 *   3. global pause — `pauseFor(ms)` (a Telegram 429 `retry_after`) holds EVERY
 *                     waiter, present and future, until it ends; pauses only extend.
 *
 * Time is injectable (`now` / `sleep`) so the cap is unit-tested without waiting
 * (a lone `sleep` gets a virtual clock that it advances).
 * No dependencies: usable from tests and from the server alike.
 */

export type LimiterOptions = {
  perSecond: number;
  /** Default: `Date.now`. */
  now?: () => number;
  /** Default: `setTimeout`. A fake clock's `sleep` advances its own `now`. */
  sleep?: (ms: number) => Promise<void>;
};

export type Limiter = {
  /** Resolves when the caller may send one message. FIFO. */
  acquire(): Promise<void>;
  /** Holds every sender for `ms` from now (longer pauses win; shorter ones are ignored). */
  pauseFor(ms: number): void;
  /** Epoch ms the current pause ends (0 / in the past: not paused). */
  pausedUntil(): number;
  /** Resolves once no pause is in force (senders call it before claiming new work). */
  whenResumed(): Promise<void>;
  /** Grants so far (tests / status). */
  granted(): number;
};

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createLimiter(opts: LimiterOptions): Limiter {
  const cap = Math.max(1, Math.floor(opts.perSecond));
  const gap = 1000 / cap;
  // An injected `sleep` without a clock (tests: `async () => {}`) would make `now()` crawl in real time while
  // sleeps return at once, spinning the pump; give it a virtual clock that its own sleeps advance.
  let virtual = Date.now();
  const now = opts.now ?? (opts.sleep ? () => virtual : Date.now);
  const sleep =
    opts.sleep && !opts.now
      ? async (ms: number) => {
          virtual += ms;
          await opts.sleep!(ms);
        }
      : (opts.sleep ?? realSleep);
  /** Grant times inside the last second, oldest first. */
  const window: number[] = [];
  const queue: Array<() => void> = [];
  let pauseUntil = 0;
  let nextSlot = 0;
  let pumping = false;
  let total = 0;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const t = now();
        while (window.length > 0 && t - window[0]! >= 1000) window.shift();
        let wait = Math.max(pauseUntil - t, nextSlot - t);
        if (window.length >= cap) wait = Math.max(wait, window[0]! + 1000 - t);
        if (wait > 0) {
          await sleep(Math.ceil(wait));
          continue;
        }
        window.push(t);
        nextSlot = t + gap;
        total++;
        queue.shift()!();
      }
    } finally {
      pumping = false;
    }
  }

  return {
    acquire: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve);
        void pump();
      }),
    pauseFor(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return;
      pauseUntil = Math.max(pauseUntil, now() + ms);
    },
    pausedUntil: () => pauseUntil,
    async whenResumed() {
      for (;;) {
        const wait = pauseUntil - now();
        if (wait <= 0) return;
        await sleep(Math.ceil(wait));
      }
    },
    granted: () => total,
  };
}
