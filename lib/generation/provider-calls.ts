/**
 * Call counter for providers that cost no money (stock photos, research APIs).
 *
 * Paid spend is recorded per job in `ai_usage` (`job-cost.ts`); a Pexels photo or an OpenAlex lookup spends nothing,
 * so it left no trace and the admin «Provayderlar» page could not show how much of a free quota is used. The
 * generation layer reports every REAL request here (one call = one HTTP request made, not a skipped provider);
 * the server registers a sink that batches the counts into `provider_calls` (`lib/server/provider-usage.ts`).
 *
 * Isomorphic and never throwing: with no sink (unit tests, CLI scripts) a call is dropped, and a failing sink must
 * never fail a job. The ids are the provider registry ids (`lib/server/providers/registry.ts`).
 */

export type ProviderCallSink = (provider: string, ok: boolean) => void;

type Holder = typeof globalThis & { __slaydxProviderCallSink?: ProviderCallSink | null };
const g = globalThis as Holder;

/** The server registers its batching sink here. `null` unregisters (tests). */
export function registerProviderCallSink(sink: ProviderCallSink | null): void {
  g.__slaydxProviderCallSink = sink;
}

/** One request to `provider` was made; `ok` is whether it succeeded. */
export function recordProviderCall(provider: string, ok: boolean): void {
  try {
    g.__slaydxProviderCallSink?.(provider, ok);
  } catch {
    // Telemetry only.
  }
}

/** The registry id of the free provider a research URL belongs to, `null` for any other host (Crossref, lex.uz, …). */
export function providerOfUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "api.openalex.org") return "openalex";
  if (u.hostname === "www.googleapis.com" && u.pathname.startsWith("/books/")) return "googlebooks";
  return null;
}
