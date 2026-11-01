import type { AdapterDeps, AdapterInput, MediaAdapter, SubmitResult } from "./adapter";
import type { Route } from "./catalog";
import { MediaError } from "./types";

/**
 * Router (docs/studio/P0-SPEC.md §3.9): tries a model's routes in order.
 *
 *   - a route whose health gate says no (breaker open, balance below floor) is skipped — except the LAST usable one:
 *     with nowhere else to go, skipping would fail a job the provider may still serve (a single-route model keeps
 *     today's behaviour exactly);
 *   - on failure it moves to the next route ONLY when the provider had not accepted the job and the error is
 *     retryable — never after acceptance (double cost, double output) and never on a safety refusal (another provider
 *     drawing the refused content would defeat the refusal);
 *   - every other error is thrown to the host, which fails the job and refunds.
 *
 * The health gate is injected so the host decides what «healthy» means (SlaydX: the shared breaker registry).
 */
export type RouteHealth = {
  allow(route: Route): boolean;
  success(route: Route): void;
  failure(route: Route, err: MediaError): void;
};

export type Routed = { route: Route; result: SubmitResult };

/** Key of one route in breaker / limiter registries. */
export function routeKey(route: Route): string {
  return `media:${route.provider}:${route.upstreamModel}`;
}

export async function submitWithRoutes(
  routes: readonly Route[],
  adapters: Readonly<Record<string, MediaAdapter>>,
  health: RouteHealth,
  input: Omit<AdapterInput, "upstreamModel">,
  deps: AdapterDeps = {},
): Promise<Routed> {
  let last: MediaError | null = null;
  const usable = routes.filter((r) => adapters[r.adapter]?.configured());
  for (const [i, route] of usable.entries()) {
    const adapter = adapters[route.adapter]!;
    if (i < usable.length - 1 && !health.allow(route)) continue;
    try {
      const result = await adapter.submit({ ...input, upstreamModel: route.upstreamModel }, deps);
      health.success(route);
      return { route, result };
    } catch (e) {
      if (!(e instanceof MediaError)) throw e;
      if (e.retryable) health.failure(route, e);
      if (e.accepted || e.safety || !e.retryable) throw e;
      last = e;
    }
  }
  throw last ?? new MediaError("router", "no route available", { retryable: true });
}
