/**
 * Cross-process pacing for the Gemini TTS per-minute request quota.
 *
 * Gemini allows ≈10 requests/min per project per model; the web and worker processes
 * (and two concurrent jobs) share that one quota, so an in-process counter is useless.
 * Before EVERY request attempt the adapter takes a slot from the pg-backed fixed-window
 * limiter (`lib/server/ratelimit.ts`, shared by all processes): `TTS_GEMINI_RPM` slots
 * (default 8, a margin under the quota) per 60 s, bucket `tts:gemini:rpm`.
 *
 * A rejected `take` has already counted in the CURRENT window, so polling inside it
 * is pointless: the pacer sleeps until the window turns over (`retryAfterSec`) and takes
 * again. It never sleeps past the job deadline (`DeadlineError` instead).
 *
 * The limiter backend is injected (`take`) so the unit tests run without a database;
 * the default imports `ratelimit.ts` lazily because this file lives in the isomorphic
 * TTS layer (no static server import).
 */
import { DeadlineError } from "../llm/chain";
import type { TtsPaceCtx } from "./types";

export const GEMINI_RPM_BUCKET = "tts:gemini:rpm";
export const GEMINI_RPM_DEFAULT = 8;
export const GEMINI_RPM_WINDOW_SEC = 60;

/** `TTS_GEMINI_RPM` (positive integer) or the default 8. */
export function geminiTtsRpm(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(String(env.TTS_GEMINI_RPM ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : GEMINI_RPM_DEFAULT;
}

export type SlotResult = { ok: boolean; retryAfterSec: number };
export type TakeSlot = (bucket: string, limit: number, windowSec: number) => Promise<SlotResult>;

/** Default backend: the shared pg `rateLimit`. */
export const pgTakeSlot: TakeSlot = async (bucket, limit, windowSec) => {
  const { rateLimit } = await import("../../server/ratelimit");
  const r = await rateLimit(bucket, limit, windowSec);
  return { ok: r.ok, retryAfterSec: r.retryAfterSec };
};

export type PacerOpts = {
  take?: TakeSlot;
  /** Read at every call, so a changed env takes effect without a restart. */
  limit?: () => number;
  windowSec?: number;
  bucket?: string;
  log?: (line: string) => void;
};

/** Small head-room added to the window turnover so the next `take` lands inside the new window. */
const WINDOW_SLACK_MS = 150;

export function makePacer(o: PacerOpts = {}): (ctx: TtsPaceCtx) => Promise<void> {
  const take = o.take ?? pgTakeSlot;
  const limit = o.limit ?? (() => geminiTtsRpm());
  const windowSec = o.windowSec ?? GEMINI_RPM_WINDOW_SEC;
  const bucket = o.bucket ?? GEMINI_RPM_BUCKET;
  const log = o.log ?? ((line: string) => console.log(line));

  return async (ctx) => {
    // A window turns over at most every `windowSec`, so this loop ends within a few rounds.
    for (let round = 0; ; round++) {
      const r = await take(bucket, limit(), windowSec);
      if (r.ok) return;
      const wait = Math.min(windowSec * 1000, Math.max(0, r.retryAfterSec) * 1000) + WINDOW_SLACK_MS;
      const left = ctx.left();
      if (left - wait < ctx.reserveMs) throw new DeadlineError("tts:gemini-pace", left - wait);
      if (round === 0) log(`[tts] gemini → so'rov oralig'i to'lgan (${limit()}/${windowSec}s), ${Math.round(wait)} ms kutiladi`);
      await ctx.sleep(wait);
    }
  };
}

/** The pacer production uses (shared pg limiter, env-configured). */
export const geminiPacer = makePacer();
