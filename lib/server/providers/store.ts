import "server-only";
import { query } from "../db";
import { log } from "../log";
import { openProviderKey } from "./crypto";
import { isProviderId } from "./registry";
import { setRouteSnapshot } from "./route-resolve";
import { checkRoute, isRouteId, type RouteEntry } from "./routes";
import {
  PROVIDER_CACHE_TTL_MS,
  invalidateProviderCache,
  primeProviderKeys,
  registerProviderSource,
  type ProviderRuntime,
  type ProviderSnapshot,
} from "./resolve";

/**
 * Database side of the provider key store (program-17 decision D7): reads `provider_settings`, decrypts the
 * keys and hands the snapshot to `resolve.ts`, which answers every `getProviderKey()` from memory.
 *
 * Importing this module registers the loader (the `settings.ts` / `registerSoumPerUsdSource` pattern);
 * `startProviderKeyRefresh()` keeps the snapshot fresh in a long-lived process (web via `instrumentation.ts`,
 * the worker process, the inline worker). A write made by the admin API reloads the local snapshot at once; the
 * other process picks it up within `PROVIDER_CACHE_TTL_MS` (about 30 s).
 */

type Row = { provider: string; enabled: boolean; key_ciphertext: Buffer | null };

/** Providers already reported as unreadable, so the 30 s reload does not repeat the same error line. */
const reportedUnreadable = new Set<string>();

/** Reads every row. A key that does not decrypt is `unreadable` (env fallback), logged once per load WITHOUT the value. */
export async function loadProviderSnapshot(): Promise<ProviderSnapshot> {
  const rows = await query<Row>("SELECT provider, enabled, key_ciphertext FROM provider_settings");
  const out = new Map<string, ProviderRuntime>();
  for (const r of rows) {
    // A row of a provider the registry no longer knows is ignored.
    if (!isProviderId(r.provider)) continue;
    let key: string | null = null;
    let unreadable = false;
    if (r.key_ciphertext) {
      try {
        key = openProviderKey(r.provider, r.key_ciphertext);
      } catch (e) {
        unreadable = true;
        if (!reportedUnreadable.has(r.provider)) {
          reportedUnreadable.add(r.provider);
          log("error", "[providers] saqlangan kalitni ochib bo'lmadi: shifrlash kaliti o'zgargan yoki yozuv buzilgan", {
            provider: r.provider,
            code: (e as { code?: string }).code ?? "unknown",
          });
        }
      }
      if (!unreadable) reportedUnreadable.delete(r.provider);
    }
    out.set(r.provider, { enabled: r.enabled, key, unreadable });
  }
  return out;
}

/** Reports each unreadable route row once, so the 30 s reload does not repeat the same line. */
const reportedBadRoutes = new Set<string>();

/**
 * Reads `ai_routes` into the route snapshot. A row the loader cannot read (unknown slot, entries that no longer
 * pass `checkRoute`, e.g. a model that left the price book) is IGNORED: the slot keeps its env / built-in value.
 */
export async function loadRouteSnapshot(): Promise<ReadonlyMap<string, readonly RouteEntry[]>> {
  const rows = await query<{ route: string; entries: unknown }>("SELECT route, entries FROM ai_routes");
  const out = new Map<string, readonly RouteEntry[]>();
  for (const r of rows) {
    const check = isRouteId(r.route) ? checkRoute(r.route, r.entries) : null;
    if (check?.ok) {
      out.set(r.route, check.entries);
      reportedBadRoutes.delete(r.route);
    } else if (!reportedBadRoutes.has(r.route)) {
      reportedBadRoutes.add(r.route);
      log("warn", "[providers] saqlangan zanjir o'qilmadi, env/standart ishlatiladi", { route: r.route });
    }
  }
  return out;
}

/** The loader `resolve.ts` calls: provider keys plus the routing slots, in one refresh cycle. */
export async function loadProviderAndRouteSnapshots(): Promise<ProviderSnapshot> {
  const providers = await loadProviderSnapshot();
  try {
    setRouteSnapshot(await loadRouteSnapshot());
  } catch (e) {
    // A failing route read keeps the previous routes; provider keys must still refresh.
    log("warn", "[providers] ai_routes o'qib bo'lmadi: oxirgi qiymatlar ishlatiladi", { err: e });
  }
  return providers;
}

registerProviderSource(loadProviderAndRouteSnapshots);

type Globals = typeof globalThis & { __slaydxProviderRefresh?: ReturnType<typeof setInterval> };
const g = globalThis as Globals;

/**
 * Loads the snapshot now and then every TTL, with an unref'd timer (it never keeps the process alive and a
 * second call is a no-op). The first load is awaited so a job that starts right after boot already sees the
 * stored keys and switches.
 */
export async function startProviderKeyRefresh(intervalMs: number = PROVIDER_CACHE_TTL_MS): Promise<void> {
  if (!g.__slaydxProviderRefresh) {
    const timer = setInterval(() => {
      void primeProviderKeys({ force: true });
    }, intervalMs);
    timer.unref();
    g.__slaydxProviderRefresh = timer;
  }
  await primeProviderKeys({ force: true });
}

/** Stops the timer (tests). */
export function stopProviderKeyRefresh(): void {
  if (g.__slaydxProviderRefresh) clearInterval(g.__slaydxProviderRefresh);
  g.__slaydxProviderRefresh = undefined;
}

/** Reloads the snapshot when it is older than the TTL (no-op while fresh). Routes and job starts call this. */
export async function ensureProviderKeys(): Promise<void> {
  await primeProviderKeys();
}

/** Reloads the snapshot now: the admin write path after COMMIT, so this process sees its own change at once. */
export async function reloadProviderKeys(): Promise<void> {
  invalidateProviderCache();
  await primeProviderKeys({ force: true });
}
