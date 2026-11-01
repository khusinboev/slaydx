/**
 * ONE synchronous media call through the core (docs/studio/P0-SPEC.md §4): resolve the model's routes, submit with
 * the router (shared breaker registry as health), record a `media_jobs` row when running inside a job, and hand back
 * the outputs. Image and speech engines call this; video uses the same pieces on its async path (submit → park → poll).
 *
 * Recording is telemetry for sync kinds: a failed DB write is logged and never fails the user's job. Outside a job
 * (scripts, unit tests) nothing is written.
 */
import {
  breakerFor,
  costUsd,
  MediaError,
  normalize,
  submitWithRoutes,
  routeKey,
  type AdapterDeps,
  type AdapterInput,
  type CatalogEntry,
  type MediaAdapter,
  type MediaOutput,
  type ParamValue,
  type Route,
  type RouteHealth,
} from "../../studio-core";
import { MEDIA_CATALOG } from "../../media/catalog";
import { mediaContext } from "../../media/context";

/** Breaker health shared with the LLM layer's registry (the admin heartbeat lists both). */
export const breakerHealth: RouteHealth = {
  allow: (r) => breakerFor(routeKey(r)).allow(),
  success: (r) => breakerFor(routeKey(r)).success(),
  failure: (r) => breakerFor(routeKey(r)).failure(),
};

export type RunInput = {
  purpose: string;
  modelId: string;
  /** Form values for the catalog ParamSchema (normalized here, stored in the row, priced for cost_usd). */
  values: Readonly<Record<string, unknown>>;
  /** What the adapter needs beyond the schema (the composed prompt, pixel size…), merged over the normalized values. */
  extra?: Readonly<Record<string, ParamValue>>;
  assets?: AdapterInput["assets"];
  /** Unique per call inside the job, e.g. `image:0`; the generation id is prefixed here. */
  step: string;
  adapters: Readonly<Record<string, MediaAdapter>>;
  /** Swap a route's upstream model (admin routing slot, e.g. `image.gemini`). */
  upstream?: (route: Route) => string;
  deps?: AdapterDeps;
};

export type RunOutput = { route: Route; outputs: MediaOutput[]; entry: CatalogEntry };

async function record<T>(what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[media] ${what} not recorded:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function runMedia(i: RunInput): Promise<RunOutput> {
  const entry = MEDIA_CATALOG.byId(i.modelId);
  if (!entry) throw new MediaError("media", `unknown model ${i.modelId}`);
  const params = normalize(entry.params, i.values);
  const routes = entry.routes.map((r) => (i.upstream ? { ...r, upstreamModel: i.upstream(r) } : r));
  const ctx = mediaContext();
  const key = ctx ? `${ctx.generationId}:${i.step}` : `adhoc:${i.step}`;
  const jobs = ctx ? await import("./jobs") : null;
  const primary = routes[0]!;
  const row = jobs
    ? await record("begin", () =>
        jobs.beginMediaJob({
          generationId: ctx!.generationId,
          purpose: i.purpose,
          modelId: entry.id,
          provider: primary.provider,
          upstreamModel: primary.upstreamModel,
          idempotencyKey: key,
          params: { ...params },
          costUsd: costUsd(entry.cost, params),
        }),
      )
    : null;
  try {
    const { route, result } = await submitWithRoutes(routes, i.adapters, breakerHealth, { params: { ...params, ...i.extra }, assets: i.assets, idempotencyKey: key }, i.deps);
    if (!("done" in result)) throw new MediaError(route.provider, "async result on a sync call");
    if (jobs && row) {
      const metas = result.done.map((o) => ({ mime: o.kind === "inline" ? o.mime : (o.mime ?? "application/octet-stream"), size: o.kind === "inline" ? o.bytes.byteLength : 0 }));
      await record("finish", async () => {
        if (route !== primary) await (await import("../db")).query("UPDATE media_jobs SET provider = $2, upstream_model = $3 WHERE id = $1", [row.row.id, route.provider, route.upstreamModel]);
        await jobs.finishMediaJob(row.row.id, metas);
      });
    }
    return { route, outputs: result.done, entry };
  } catch (e) {
    if (jobs && row) await record("fail", () => jobs.failMediaJob(row.row.id, e instanceof Error ? e.message : String(e)));
    throw e;
  }
}
