import type { Capability, MediaKind } from "./types";
import type { CostRule } from "./cost";
import type { ParamSchema } from "./params";

/**
 * Model catalog (docs/studio/P0-SPEC.md §3.5): one entry per model the product sells. Adding a model = one entry + its
 * ParamSchema + a live smoke; the form, the price, the router and the admin page all read the entry.
 *
 * `routes` are ordered (primary first). They name the provider registry id whose key + switch decide availability,
 * the upstream model id and the adapter that speaks to it. Routes never reach the browser (`clientView`).
 */
export type Route = { provider: string; upstreamModel: string; adapter: string };

export type Badge = "tez" | "sifatli" | "arzon" | "matn" | "ovozli" | "yangi";

export type CatalogEntry = {
  /** Stable public id, `maker/model`. */
  id: string;
  kind: MediaKind;
  capabilities: readonly Capability[];
  /** Uzbek name on the picker. */
  label: string;
  maker: string;
  badges: readonly Badge[];
  params: readonly ParamSchema[];
  cost: CostRule;
  routes: readonly Route[];
  /** Hidden until the admin switches it on in «Media modellari»; without the flag a model is on until switched off. */
  defaultOff?: boolean;
  limits: { timeoutMs: number; deadlineMs?: number };
  output: { mimes: readonly string[]; maxBytes: number };
};

/** What the browser may see of an entry. */
export type ClientEntry = Omit<CatalogEntry, "routes">;

export type Catalog = {
  readonly entries: readonly CatalogEntry[];
  byId(id: string): CatalogEntry | null;
  ofKind(kind: MediaKind): CatalogEntry[];
  clientView(): ClientEntry[];
};

function costParams(rule: CostRule): string[] {
  switch (rule.per) {
    case "job":
      return [];
    case "output":
      return [rule.countParam, rule.by?.param].filter((x): x is string => !!x);
    case "second":
      return [rule.secondsParam, rule.countParam, rule.by?.param, rule.plus?.param].filter((x): x is string => !!x);
    case "kchar":
      return [rule.textParam];
  }
}

/**
 * Builds the lookup and checks the entries once, at module load: a broken entry is a programmer error and must fail
 * every test, not surface as a wrong price in production.
 */
export function defineCatalog(entries: readonly CatalogEntry[]): Catalog {
  const byId = new Map<string, CatalogEntry>();
  for (const e of entries) {
    if (!/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(e.id)) throw new Error(`catalog: bad id "${e.id}"`);
    if (byId.has(e.id)) throw new Error(`catalog: duplicate id "${e.id}"`);
    if (e.routes.length === 0) throw new Error(`catalog: "${e.id}" has no route`);
    const names = new Set<string>();
    for (const p of e.params) {
      if (names.has(p.name)) throw new Error(`catalog: "${e.id}" repeats param "${p.name}"`);
      names.add(p.name);
    }
    for (const n of costParams(e.cost)) if (!names.has(n)) throw new Error(`catalog: "${e.id}" cost reads unknown param "${n}"`);
    byId.set(e.id, e);
  }
  return {
    entries,
    byId: (id) => byId.get(id) ?? null,
    ofKind: (kind) => entries.filter((e) => e.kind === kind),
    clientView: () =>
      entries.map((e) => {
        const view: Partial<CatalogEntry> = { ...e };
        delete view.routes;
        return view as ClientEntry;
      }),
  };
}
