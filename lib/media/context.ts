/**
 * Media engine context of the running job (docs/studio/P0-SPEC.md §6): which kinds go through the core
 * (`media.core.*` settings, read ONCE per job by the worker so a running job never changes path) and the generation
 * id the `media_jobs` rows belong to.
 *
 * Outside a job (scripts, request-path helpers, unit tests) there is no context: every engine keeps its old direct
 * path, and nothing is recorded.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type MediaCoreSwitches = { image: boolean; video: boolean; speech: boolean };

export type MediaContext = { generationId: string; core: MediaCoreSwitches };

const store = new AsyncLocalStorage<MediaContext>();

export function withMediaContext<T>(ctx: MediaContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function mediaContext(): MediaContext | null {
  return store.getStore() ?? null;
}

/** The core path is on for `kind` in this job. */
export function mediaCoreOn(kind: keyof MediaCoreSwitches): boolean {
  return store.getStore()?.core[kind] === true;
}

const stepCounts = new WeakMap<MediaContext, Map<string, number>>();

/**
 * Step name of the next provider call inside this job: `<prefix>[:<tag>]:<n>`, the part of `media_jobs.idempotency_key`
 * after the generation id (`runMedia` prefixes it).
 *
 * `tag` says WHAT is drawn (the image engines pass a short hash of the prompt), `n` counts the earlier calls with the
 * same prefix and tag in this job. Why not a plain per-job counter: image lanes run concurrently, so the order in which
 * calls reach the provider differs between a run and its retry, and `image:3` would name a different picture each time.
 * With the hash a retried job gives the same picture the same key whatever the lane order (calls with an identical tag,
 * e.g. the N copies of one «Rasm» prompt, are interchangeable by definition). The counter lives per context object: a
 * retried job gets a new context, so its keys restart at 0 and meet the rows of the first attempt.
 *
 * Outside a job there is no context and nothing is recorded: the name is `<prefix>[:<tag>]:0`.
 */
export function nextMediaStep(prefix: string, tag = ""): string {
  const base = tag ? `${prefix}:${tag}` : prefix;
  const ctx = store.getStore();
  if (!ctx) return `${base}:0`;
  let counts = stepCounts.get(ctx);
  if (!counts) stepCounts.set(ctx, (counts = new Map()));
  const n = counts.get(base) ?? 0;
  counts.set(base, n + 1);
  return `${base}:${n}`;
}
