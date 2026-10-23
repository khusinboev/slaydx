import { log } from "../log";
import { providerDef, type ProviderId } from "./registry";

/**
 * Provider key resolution (program-17 decision D7).
 *
 *   effective key of a provider =
 *     - "" when the provider is DISABLED in `provider_settings` (even if an env var exists);
 *     - the DB key (decrypted by the store) when one is stored and readable;
 *     - otherwise the first non-empty fallback env var of the registry entry.
 *
 * With no `provider_settings` rows nothing is overridden: every provider is enabled and the keys are the
 * env vars -- exactly how the product behaved before the store existed (`tests/provider-keys.test.mts`).
 *
 * Why SYNCHRONOUS: the generation layer (LLM adapters, image sources, TTS) reads a key where it builds a
 * request, in code that is isomorphic (no `server-only`, no database) and unit-tested with a mocked `fetch`.
 * The database is read by `store.ts`, which registers a loader here (`registerProviderSource`); this module
 * keeps the last loaded snapshot and answers from memory. The snapshot is refreshed
 *   - at process start and then every `PROVIDER_CACHE_TTL_MS` by the store's timer (`startProviderKeyRefresh`),
 *   - on demand by `primeProviderKeys()` when it is older than the TTL (job start, session route, admin page),
 *   - at once after a write made by THIS process (`invalidateProviderCache`).
 * Another process (web <-> worker) sees a change within the TTL (about 30 s).
 *
 * Failure policy: a failing load keeps the last good snapshot; with none, env keys apply and every provider
 * is enabled (the pre-store behaviour). A stored key that cannot be decrypted is `unreadable`: it is ignored
 * (env fallback) and the admin page says so.
 *
 * State lives on `globalThis`: Next bundles instrumentation, route handlers and the worker separately, and
 * a second copy of this module must see the snapshot the first one loaded (same pattern as `settings.ts`).
 * The snapshot holds decrypted keys in this process's memory only; nothing here logs or serialises them.
 */

export const PROVIDER_CACHE_TTL_MS = 30_000;

export type ProviderRuntime = {
  enabled: boolean;
  /** The decrypted DB key; `null` when none is stored or it could not be decrypted. */
  key: string | null;
  /** A key is stored but cannot be decrypted (wrong/missing encryption key). */
  unreadable: boolean;
};

export type ProviderSnapshot = ReadonlyMap<string, ProviderRuntime>;
export type ProviderSource = () => Promise<ProviderSnapshot>;

type State = {
  snapshot: ProviderSnapshot;
  /** Epoch ms of the last successful load; 0 = never. */
  loadedAt: number;
  /** Bumped by an invalidation; a load that started earlier is discarded. */
  version: number;
  source: ProviderSource | null;
  inflight: Promise<void> | null;
  /** Epoch ms of the last warning, so a sick database does not flood the log. */
  warnedAt: number;
  /** Epoch ms of the last FAILED load: a non-forced prime backs off for `ERROR_RETRY_MS` after it. */
  failedAt: number;
};

/** After a failed load a non-forced prime does not hit the database again for this long. */
const ERROR_RETRY_MS = 5_000;

type Holder = typeof globalThis & { __slaydxProviderKeys?: State };
const g = globalThis as Holder;

function state(): State {
  return (g.__slaydxProviderKeys ??= { snapshot: new Map(), loadedAt: 0, version: 0, source: null, inflight: null, warnedAt: 0, failedAt: 0 });
}

/** The store registers its loader here. `null` unregisters (tests). */
export function registerProviderSource(source: ProviderSource | null): void {
  state().source = source;
}

/** Replaces the snapshot (the store after its own write, and tests). */
export function setProviderSnapshot(snapshot: ProviderSnapshot, now: number = Date.now()): void {
  const s = state();
  s.snapshot = snapshot;
  s.loadedAt = now;
}

/** Drops the snapshot: back to env-only, never loaded. Tests. */
export function resetProviderCache(): void {
  const s = state();
  s.snapshot = new Map();
  s.loadedAt = 0;
  s.version++;
  s.inflight = null;
}

/**
 * Marks the snapshot stale so the next `primeProviderKeys()` reloads. Call after the transaction that wrote
 * `provider_settings` committed. The old snapshot stays as the fallback of a failing reload.
 */
export function invalidateProviderCache(): void {
  const s = state();
  s.version++;
  s.loadedAt = 0;
  s.inflight = null;
}

/** Age of the snapshot in ms, `Infinity` when never loaded. */
export function providerCacheAgeMs(now: number = Date.now()): number {
  const s = state();
  return s.loadedAt === 0 ? Number.POSITIVE_INFINITY : now - s.loadedAt;
}

/**
 * Loads the snapshot when it is older than the TTL (or `force`). Single-flight; never throws -- a failing load
 * keeps the previous snapshot. A no-op when no store registered a source (CLI scripts, unit tests): env only.
 */
export async function primeProviderKeys(opts: { force?: boolean; now?: number } = {}): Promise<void> {
  const s = state();
  const now = opts.now ?? Date.now();
  if (!s.source) return;
  if (!opts.force && s.loadedAt !== 0 && now - s.loadedAt < PROVIDER_CACHE_TTL_MS) return;
  if (!opts.force && s.failedAt !== 0 && now - s.failedAt < ERROR_RETRY_MS) return;
  if (s.inflight) return s.inflight;
  const version = s.version;
  const source = s.source;
  const p = Promise.resolve().then(source).then(
    (snap) => {
      // An invalidation during the load means the rows may already be stale: keep loadedAt = 0 so the next prime reloads.
      if (s.version === version) {
        s.snapshot = snap;
        s.loadedAt = now;
        s.failedAt = 0;
      }
    },
    (err: unknown) => {
      s.failedAt = now;
      if (now - s.warnedAt > 60_000) {
        s.warnedAt = now;
        log("warn", "[providers] provider_settings o'qib bo'lmadi: oxirgi qiymatlar yoki env ishlatiladi", { err });
      }
    },
  );
  s.inflight = p;
  void p.finally(() => {
    if (s.inflight === p) s.inflight = null;
  });
  return p;
}

function envKey(id: string): string {
  const def = providerDef(id);
  if (!def) return "";
  for (const name of def.envKeys) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

/** `false` only for a provider the admin switched off. Unknown ids and providers without a row are enabled. */
export function isProviderEnabled(id: ProviderId | string): boolean {
  return state().snapshot.get(id)?.enabled ?? true;
}

/**
 * The effective key of `id` (see the file header), `""` when the provider is off, unknown or has no key.
 * Callers treat `""` as «not configured»: the chain skips the provider and falls through to the next one.
 */
export function getProviderKey(id: ProviderId | string): string {
  const row = state().snapshot.get(id);
  if (row && !row.enabled) return "";
  if (row?.key) return row.key;
  return envKey(id);
}

/** Which source `getProviderKey(id)` answers from: for the admin page. */
export function keySourceOf(id: ProviderId | string): "db" | "env" | "none" {
  const row = state().snapshot.get(id);
  if (row && !row.enabled) return "none";
  if (row?.key) return "db";
  return envKey(id) ? "env" : "none";
}

/** The raw env fallback, ignoring the DB and the switch: whether an env var is set at all (admin page). */
export function hasEnvKey(id: ProviderId | string): boolean {
  return envKey(id) !== "";
}
