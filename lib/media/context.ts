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
