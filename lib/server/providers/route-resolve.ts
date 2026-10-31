import type { RouteEntry, RouteId } from "./routes";

/**
 * In-memory snapshot of the admin's routing slots (`ai_routes`), the sibling of the provider key snapshot in
 * `resolve.ts` and refreshed by the same loader (`store.ts`), so a change reaches the other process (web <-> worker)
 * within the same TTL.
 *
 * Why SYNCHRONOUS and without `server-only`: the generation layer asks for its model where it builds a request, in
 * isomorphic code that is unit-tested without a database. Nothing is stored here but validated entries; with no
 * snapshot (CLI scripts, unit tests, a failed first load) every slot is unset and the callers keep today's env /
 * built-in default.
 *
 * State lives on `globalThis` (Next bundles instrumentation, route handlers and the worker separately; the same
 * pattern as `resolve.ts` and `settings.ts`).
 */

type Holder = typeof globalThis & { __slaydxRoutes?: ReadonlyMap<string, readonly RouteEntry[]> };
const g = globalThis as Holder;

/** The admin's stored entries for `id`, or `null` when the slot is not overridden. */
export function getRoute(id: RouteId): readonly RouteEntry[] | null {
  return g.__slaydxRoutes?.get(id) ?? null;
}

/** Replaces the snapshot (the loader, and tests). */
export function setRouteSnapshot(snapshot: ReadonlyMap<string, readonly RouteEntry[]>): void {
  g.__slaydxRoutes = snapshot;
}

/** Back to «nothing overridden» (tests). */
export function resetRouteSnapshot(): void {
  g.__slaydxRoutes = undefined;
}
