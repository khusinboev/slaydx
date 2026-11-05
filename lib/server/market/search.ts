import "server-only";
import { searchTerms } from "../../market/normalize";
import { MARKET_TOOL_IDS, isMarketTool } from "../../market/registry";
import { isMarketSubject } from "../../market/subjects";
import type { MarketCard, MarketLevel, MarketListResponse, MarketSort, MarketSubjectId } from "../../market/types";
import type { ToolId } from "../../types";
import { ApiError } from "../api";
import { query, queryOne } from "../db";
import { getSetting } from "../settings";
import { RATING_MIN_VOTES, toCard } from "./items";
import { marketPricingConfig } from "./pricing";
import { MARKET_ROW_COLUMNS, isUuid, type MarketItemRow } from "./store";

/**
 * Catalog reads (docs/market/PLAN.md §5.2, §8.3): the public list, its facets and the «tayyor varianti bor» suggestion.
 * Only `active` items of tools on sale, never those hidden by reports. The first page of every (tool, subject, level,
 * sort) is cached in process for 15 s: a post in a Telegram channel sends thousands of identical requests.
 */

export const MARKET_PAGE_MAX = 48;
export const MARKET_PAGE_DEFAULT = 24;
const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 300;
/** FTS answers fewer rows than this → the trigram fallback tops the page up. */
const FUZZY_BELOW = 3;
const FUZZY_THRESHOLD = 0.3;

export type MarketListQuery = {
  tool?: string | null;
  subject?: string | null;
  level?: string | null;
  sort?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

const SORTS: readonly MarketSort[] = ["new", "popular", "cheap", "rating"];
const isSort = (v: unknown): v is MarketSort => (SORTS as readonly unknown[]).includes(v);
const isLevel = (v: unknown): v is MarketLevel => v === "maktab" || v === "kollej" || v === "otm";

/**
 * Sort key per sort. `cheap` works on the approval snapshot × the tool's percent: the live price needs the JS formula
 * per row, while this order is the same unless an original price changed since approval, and a card always SHOWS the
 * live price. `rating` counts only items that show their stars.
 */
function sortSpec(sort: MarketSort): { key: string; cast: string; dir: "ASC" | "DESC" } {
  switch (sort) {
    case "popular":
      return { key: "m.sold_count", cast: "int", dir: "DESC" };
    case "cheap":
      return { key: "COALESCE(m.price_override, m.original_price * COALESCE(tp.percent, $PCT) / 100)", cast: "bigint", dir: "ASC" };
    case "rating":
      return { key: `CASE WHEN m.rating_count >= ${RATING_MIN_VOTES} THEN m.rating_sum::float8 / m.rating_count ELSE 0 END`, cast: "float8", dir: "DESC" };
    default:
      return { key: "m.approved_at", cast: "timestamptz", dir: "DESC" };
  }
}

type Cursor = { v: string; id: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id])).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0].length <= 64 && isUuid(parsed[1])) return { v: parsed[0], id: parsed[1] };
  } catch {
    /* falls through to the 400 */
  }
  throw new ApiError("Yaroqsiz sahifa belgisi", 400);
}

/** A tool, subject or level outside the catalog is ignored, not an error: an old shared link still opens the catalog. */
function filtersOf(input: MarketListQuery) {
  return {
    tool: isMarketTool(input.tool) ? (input.tool as ToolId) : null,
    subject: isMarketSubject(input.subject) ? (input.subject as MarketSubjectId) : null,
    level: isLevel(input.level) ? input.level : null,
    sort: isSort(input.sort) ? input.sort : ("new" as MarketSort),
    search: input.q ? searchTerms(input.q) : null,
  };
}

const onSaleTools = async (): Promise<string[]> => {
  const disabled = new Set<string>(await getSetting("market.tools_disabled"));
  return MARKET_TOOL_IDS.filter((t) => !disabled.has(t));
};

const tsquery = (terms: readonly string[]): string => terms.map((t, i) => (i === terms.length - 1 ? `${t}:*` : t)).join(" & ");

type Where = { sql: string; args: unknown[] };

/** The WHERE of the list and of each facet; `skip` leaves one dimension out, so a facet counts its siblings too. */
function whereOf(f: ReturnType<typeof filtersOf>, tools: readonly string[], skip?: "tool" | "subject"): Where {
  const args: unknown[] = [tools];
  const parts = ["m.status = 'active'", "m.tool_id = ANY($1::text[])", "COALESCE((m.quality_json->>'hidden_until_review')::boolean, FALSE) = FALSE"];
  const add = (sql: string, value: unknown) => {
    args.push(value);
    parts.push(sql.replace("?", `$${args.length}`));
  };
  if (f.tool && skip !== "tool") add("m.tool_id = ?", f.tool);
  if (f.subject && skip !== "subject") add("m.subject = ?", f.subject);
  if (f.level) add("m.level = ?", f.level);
  if (f.search) add("m.search_tsv @@ to_tsquery('simple', ?)", tsquery(f.search.terms));
  return { sql: parts.join(" AND "), args };
}

const FROM = "FROM market_items m LEFT JOIN market_tool_pricing tp ON tp.tool_id = m.tool_id";

async function facetsOf(f: ReturnType<typeof filtersOf>, tools: readonly string[]): Promise<MarketListResponse["facets"]> {
  const t = whereOf(f, tools, "tool");
  const s = whereOf(f, tools, "subject");
  const [toolRows, subjectRows] = await Promise.all([
    query<{ id: string; n: string }>(`SELECT m.tool_id AS id, count(*) AS n FROM market_items m WHERE ${t.sql} GROUP BY 1 ORDER BY 2 DESC, 1`, t.args),
    query<{ id: string; n: string }>(`SELECT m.subject AS id, count(*) AS n FROM market_items m WHERE ${s.sql} GROUP BY 1 ORDER BY 2 DESC, 1`, s.args),
  ]);
  return {
    tools: toolRows.map((r) => ({ id: r.id as ToolId, count: Number(r.n) })),
    subjects: subjectRows.map((r) => ({ id: r.id as MarketSubjectId, count: Number(r.n) })),
  };
}

const COLUMNS = MARKET_ROW_COLUMNS.split(",").map((c) => `m.${c.trim()}`).join(", ");

type PageRow = MarketItemRow & { sort_value: string };

async function pageRows(f: ReturnType<typeof filtersOf>, tools: readonly string[], cursor: Cursor | null, limit: number, percent: number): Promise<PageRow[]> {
  const { sql, args } = whereOf(f, tools);
  const spec = sortSpec(f.sort);
  if (spec.key.includes("$PCT")) args.push(percent);
  const key = spec.key.replace("$PCT", `$${args.length}::int`);
  let where = sql;
  if (cursor) {
    args.push(cursor.v, cursor.id);
    const [v, id] = [`$${args.length - 1}::${spec.cast}`, `$${args.length}::uuid`];
    where += ` AND (${key}, m.id) ${spec.dir === "DESC" ? "<" : ">"} (${v}, ${id})`;
  }
  args.push(limit);
  // `::text`: a timestamptz keeps its microseconds in the cursor (a JS Date would cut them and repeat or skip a row).
  return query<PageRow>(
    `SELECT ${COLUMNS}, (${key})::text AS sort_value ${FROM}
      WHERE ${where} ORDER BY ${key} ${spec.dir}, m.id ${spec.dir} LIMIT $${args.length}`,
    args,
  );
}

/** `pg_trgm` is optional (074): detected once per process. */
const g = globalThis as typeof globalThis & { __slaydxMarketTrgm?: Promise<boolean>; __slaydxMarketPages?: Map<string, { at: number; value: MarketListResponse }> };

export function marketTrgmAvailable(): Promise<boolean> {
  g.__slaydxMarketTrgm ??= queryOne("SELECT 1 AS ok FROM pg_extension WHERE extname = 'pg_trgm'").then(Boolean, () => false);
  return g.__slaydxMarketTrgm;
}

async function fuzzyRows(f: ReturnType<typeof filtersOf>, tools: readonly string[], limit: number, exclude: readonly string[]): Promise<MarketItemRow[]> {
  if (!f.search || limit <= 0 || !(await marketTrgmAvailable())) return [];
  const { sql, args } = whereOf({ ...f, search: null }, tools);
  args.push(f.search.norm, FUZZY_THRESHOLD, exclude, limit);
  const n = args.length;
  return query<MarketItemRow>(
    `SELECT ${COLUMNS} ${FROM}
      WHERE ${sql} AND similarity(m.topic_norm, $${n - 3}) > $${n - 2} AND NOT (m.id = ANY($${n - 1}::uuid[]))
      ORDER BY similarity(m.topic_norm, $${n - 3}) DESC, m.id DESC LIMIT $${n}`,
    args,
  );
}

function pageCache(): Map<string, { at: number; value: MarketListResponse }> {
  return (g.__slaydxMarketPages ??= new Map());
}

/** Drops the cached first pages of this process (after an admin change that must show at once). */
export function invalidateMarketCatalogCache(): void {
  pageCache().clear();
}

export async function listMarketItems(input: MarketListQuery = {}): Promise<MarketListResponse> {
  const f = filtersOf(input);
  const limit = Math.max(1, Math.min(MARKET_PAGE_MAX, Math.trunc(Number(input.limit)) || MARKET_PAGE_DEFAULT));
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  const cacheKey = !cursor && !f.search ? JSON.stringify([f.tool, f.subject, f.level, f.sort, limit]) : null;
  if (cacheKey) {
    const hit = pageCache().get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }

  const [tools, cfg] = await Promise.all([onSaleTools(), marketPricingConfig()]);
  const rows = await pageRows(f, tools, cursor, limit + 1, cfg.percent);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page[page.length - 1] : undefined;
  const fuzzy = !cursor && f.search && page.length < FUZZY_BELOW ? await fuzzyRows(f, tools, limit - page.length, page.map((r) => r.id)) : [];
  const items = await Promise.all([...page, ...fuzzy].map((r) => toCard(r, cfg)));
  const value: MarketListResponse = {
    items,
    nextCursor: last ? encodeCursor({ v: last.sort_value, id: last.id }) : null,
    facets: await facetsOf(f, tools),
  };
  if (cacheKey) {
    const cache = pageCache();
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}

/** Ready-made works for a topic being typed in a tool's form (§5.1). Empty below two letters or for a tool outside the market. */
export async function suggestMarketItems(input: { tool: string; q: string; limit?: number }): Promise<MarketCard[]> {
  if (!isMarketTool(input.tool)) return [];
  const search = searchTerms(input.q);
  if (!search) return [];
  const f = { tool: input.tool as ToolId, subject: null, level: null, sort: "popular" as MarketSort, search };
  const limit = Math.max(1, Math.min(6, input.limit ?? 3));
  const [tools, cfg] = await Promise.all([onSaleTools(), marketPricingConfig()]);
  const rows = await pageRows(f, tools, null, limit, cfg.percent);
  const fuzzy = rows.length < limit ? await fuzzyRows(f, tools, limit - rows.length, rows.map((r) => r.id)) : [];
  return Promise.all([...rows, ...fuzzy].map((r) => toCard(r, cfg)));
}
