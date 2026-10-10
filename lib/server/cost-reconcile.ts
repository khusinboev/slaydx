import { IMAGE_PRICES, PRICING, TTS_PRICING } from "../generation/llm-pricing";
import type { Queryable } from "./admin-cost";

/**
 * Reconciliation of our recorded AI spend (`ai_usage.parts`) with the Google billing
 * export — the logic behind `scripts/cost-reconcile.mts`. Everything here is pure or
 * read-only: no network, no writes.
 *
 * EXPECTED CSV (Google AI Studio → Billing → export / Google Cloud Billing report).
 * The column names vary between exports, so headers are matched tolerantly
 * (case-insensitive, any order, extra columns ignored):
 *
 *   date   "Date" | "Usage date" | "Day" | "usage_start_time"       (YYYY-MM-DD, M/D/YYYY, "Oct 1, 2026")
 *   model  "Model" | "SKU" | "SKU description" | "Service description" | "Description"
 *   usage  "Usage" | "Usage amount" | "Quantity" | "Tokens"          (optional, shown as is)
 *   cost   "Cost" | "Cost ($)" | "Amount" | "Subtotal" | "Total"      (USD; gross cost, credits ignored)
 *
 * One row per (day, SKU); several SKUs of one model (input / output / cached tokens,
 * image, audio) are summed per model·day. The delimiter (`,` `;` or tab), quoting,
 * a BOM, `$1,234.56` / `1.234,56` / `(1.23)` numbers are handled. Rows without a
 * readable date or cost are skipped and counted — never guessed.
 *
 * Billing days follow the billing account's time zone (Google: Pacific Time for
 * invoices, UTC for most exports); our side is bucketed in `--tz` (default UTC). A
 * day boundary shift moves cost between neighbouring days, so read the per-model
 * TOTALS first and the per-day rows second.
 */

/* ══════════════════════════════ CSV ══════════════════════════════ */

export type BillingRow = {
  /** `YYYY-MM-DD`. */
  day: string;
  /** The SKU / model text as exported. */
  label: string;
  usage: number | null;
  usd: number;
};

export type BillingParse = {
  rows: BillingRow[];
  /** Data rows dropped for an unreadable date or cost. */
  skipped: number;
  /** The header names picked for each role (`null` = not found). */
  columns: { date: string | null; model: string | null; usage: string | null; cost: string | null };
};

/** RFC 4180-style split: quotes, doubled quotes, CRLF; the delimiter is `,` `;` or tab (the most frequent in the header line). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => head.split(ch).length - 1;
  const delimiter = [",", ";", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** `$1,234.56`, `1.234,56`, `1 234,5`, `(1.23)`, `-1.23`, `0.5 USD` → number; `NaN` for anything unreadable. */
export function parseMoney(raw: string): number {
  let s = String(raw ?? "").trim();
  if (!s) return Number.NaN;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,-]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/\d/.test(s) || s.includes("-")) return Number.NaN;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal mark, the other one groups thousands.
    s = lastDot > lastComma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return Number.NaN;
  return negative ? -n : n;
}

/** `YYYY-MM-DD[...]`, `M/D/YYYY` (D/M when the first number exceeds 12), `Oct 1, 2026` → `YYYY-MM-DD`; `null` when unreadable. */
export function parseBillingDay(raw: string): string | null {
  const s = String(raw ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?![\d])/.exec(s);
  if (iso) return validDay(+iso[1], +iso[2], +iso[3]);
  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/.exec(s);
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
    const a = +slash[1];
    const b = +slash[2];
    return a > 12 ? validDay(year, b, a) : validDay(year, a, b);
  }
  if (/[A-Za-z]/.test(s)) {
    const ms = Date.parse(`${s} UTC`);
    if (Number.isFinite(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function validDay(y: number, m: number, d: number): string | null {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** First header matching any pattern, trying the patterns in order (so an exact name beats a loose one). */
function pick(headers: string[], taken: Set<number>, patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = headers.findIndex((h, idx) => !taken.has(idx) && re.test(h.trim()));
    if (i >= 0) {
      taken.add(i);
      return i;
    }
  }
  return -1;
}

export function parseBillingCsv(text: string): BillingParse {
  const table = parseCsv(text);
  const headers = (table[0] ?? []).map((h) => h.trim());
  const taken = new Set<number>();
  const dateAt = pick(headers, taken, [/^(usage[ _-]?)?(start[ _-]?)?date$/i, /^day$/i, /^usage[ _-]?start[ _-]?time$/i, /date|day|time/i]);
  const modelAt = pick(headers, taken, [/^model$/i, /^sku[ _-]?description$/i, /^sku$/i, /^service[ _-]?description$/i, /^description$/i, /model|sku|description|service|product/i]);
  const costAt = pick(headers, taken, [/^cost( ?\(.*\))?$/i, /^subtotal/i, /^amount/i, /^total/i, /^charge/i, /cost|amount|price/i]);
  const usageAt = pick(headers, taken, [/^usage( amount)?$/i, /^quantity$/i, /^tokens?$/i, /usage|quantity|tokens|units/i]);
  const name = (i: number) => (i >= 0 ? headers[i] : null);
  const columns = { date: name(dateAt), model: name(modelAt), usage: name(usageAt), cost: name(costAt) };
  if (dateAt < 0 || modelAt < 0 || costAt < 0) return { rows: [], skipped: Math.max(0, table.length - 1), columns };

  const rows: BillingRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const day = parseBillingDay(r[dateAt] ?? "");
    const usd = parseMoney(r[costAt] ?? "");
    const label = (r[modelAt] ?? "").trim();
    if (!day || !Number.isFinite(usd) || !label) {
      skipped += 1;
      continue;
    }
    const usage = usageAt >= 0 ? parseMoney(r[usageAt] ?? "") : Number.NaN;
    rows.push({ day, label, usage: Number.isFinite(usage) ? usage : null, usd });
  }
  return { rows, skipped, columns };
}

/* ══════════════════════════════ model mapping ══════════════════════════════ */

const norm = (s: string): string =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Words a SKU appends to a model name that are not part of the model. */
const SKU_TAIL = /(?:-(?:input|output|tokens?|text|audio|image|video|cache[d]?|caching|context|prompts?|paid|free|tier|standard|batch|priority|lt|gt|le|ge|\d+k))+$/;

/** Every model name the price book or the telemetry can produce — the targets a billing SKU is mapped onto. */
export function knownModels(extra: Iterable<string> = []): string[] {
  const set = new Set<string>(["google_search"]);
  for (const r of PRICING) set.add(r.model);
  for (const m of Object.keys(IMAGE_PRICES)) set.add(m);
  for (const r of TTS_PRICING) if (r.billing === "tokens") set.add(r.model);
  for (const m of extra) if (m) set.add(m);
  return [...set];
}

/**
 * Maps a billing SKU text onto the model name our telemetry uses: the LONGEST known
 * model contained in the normalised SKU (`"Gemini 2.5 Flash Preview TTS Input"` →
 * `gemini-2.5-flash-preview-tts`); grounding SKUs → `google_search`; otherwise the
 * normalised SKU without its token/audio/tier suffixes, so an unknown model still
 * groups consistently and shows up as a billing-only row.
 */
export function canonicalModel(label: string, known: readonly string[] = knownModels()): string {
  const n = norm(label);
  if (/grounding|google-search/.test(n)) return "google_search";
  const hit = known
    .map((k) => ({ k, nk: norm(k) }))
    .filter(({ nk }) => nk && n.includes(nk))
    .sort((a, b) => b.nk.length - a.nk.length)[0];
  return hit ? hit.k : n.replace(SKU_TAIL, "");
}

/* ══════════════════════════════ our side ══════════════════════════════ */

export type OurRow = { day: string; model: string; usd: number; calls: number };

export type LoadOptions = {
  /** First day included, `YYYY-MM-DD` in `tz`. */
  fromDay: string;
  /** First day NOT included. */
  toDayExclusive: string;
  /** IANA zone the `ai_usage.at` instants are bucketed in (default UTC). */
  tz?: string;
  /** Only parts of this provider (default `gemini`: the only one Google bills); `all` disables the filter. */
  provider?: string;
};

/** `ai_usage` parts per day and model. Read-only; run it inside the caller's READ ONLY transaction. */
export async function loadOurUsage(db: Queryable, o: LoadOptions): Promise<OurRow[]> {
  const res = await db.query<{ day: string; model: string; usd: string | null; calls: string | null }>(
    `SELECT to_char(u.at AT TIME ZONE $3::text, 'YYYY-MM-DD') AS day,
            COALESCE(NULLIF(p->>'model', ''), 'unknown') AS model,
            sum(GREATEST(CASE WHEN jsonb_typeof(p->'usd') = 'number' THEN (p->'usd')::numeric ELSE 0 END, 0)) AS usd,
            sum(CASE WHEN jsonb_typeof(p->'calls') = 'number' THEN (p->'calls')::numeric ELSE 0 END) AS calls
       FROM ai_usage u
       CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(u.parts) = 'array' THEN u.parts ELSE '[]'::jsonb END) p
      WHERE (u.at AT TIME ZONE $3::text)::date >= $1::date
        AND (u.at AT TIME ZONE $3::text)::date < $2::date
        AND ($4::text = 'all' OR p->>'provider' = $4::text)
      GROUP BY 1, 2
      ORDER BY 1, 2`,
    [o.fromDay, o.toDayExclusive, o.tz ?? "UTC", o.provider ?? "gemini"],
  );
  return res.rows.map((r) => ({ day: String(r.day), model: String(r.model), usd: Number(r.usd ?? 0), calls: Number(r.calls ?? 0) }));
}

/* ══════════════════════════════ diff ══════════════════════════════ */

export type ReconRow = {
  /** `YYYY-MM-DD`, or `null` for a per-model total. */
  day: string | null;
  model: string;
  /** Our recorded USD (`ai_usage`). */
  ours: number;
  /** Billed USD (the export). */
  billing: number;
  /** `ours − billing`. */
  diff: number;
  /** `diff / billing × 100`; `null` when nothing was billed (then `ours` alone decides the flag). */
  diffPct: number | null;
  flagged: boolean;
  oursCalls: number;
  /** Sum of the export's usage column (tokens, images, …) — informational. */
  billingUsage: number | null;
};

export type ReconOptions = {
  /** Flag when |diff| exceeds this share of the billed amount (default 5). */
  thresholdPct?: number;
  /** …and is at least this many USD, so $0.0001 of noise on a quiet day never flags (default 0.01). */
  minUsd?: number;
};

export type Reconciliation = { daily: ReconRow[]; totals: ReconRow[]; grand: ReconRow };

function makeRow(day: string | null, model: string, ours: number, billing: number, oursCalls: number, billingUsage: number | null, o: Required<ReconOptions>): ReconRow {
  // `+ 0` turns -0 into 0, so an exact match never prints (or compares) as a negative zero.
  const r6 = (v: number) => Number(v.toFixed(6)) + 0;
  const diff = r6(ours - billing);
  const diffPct = billing > 0 ? (diff / billing) * 100 : null;
  const material = Math.abs(diff) >= o.minUsd;
  const flagged = material && (diffPct === null || Math.abs(diffPct) > o.thresholdPct);
  return { day, model, ours: r6(ours), billing: r6(billing), diff, diffPct: diffPct === null ? null : Number(diffPct.toFixed(2)) + 0, flagged, oursCalls, billingUsage };
}

/**
 * Our spend against the billed spend, per model·day and per model. A model present on
 * one side only is a row too (ours 0 = we missed it; billing 0 = we invented it).
 * Flag rule: |diff| ≥ `minUsd` and (nothing billed, or |diff| > `thresholdPct` % of
 * the billed amount).
 */
export function reconcile(ours: readonly OurRow[], billing: readonly BillingRow[], options: ReconOptions = {}): Reconciliation {
  const o: Required<ReconOptions> = { thresholdPct: options.thresholdPct ?? 5, minUsd: options.minUsd ?? 0.01 };
  const known = knownModels(ours.map((r) => r.model));
  type Cell = { ours: number; calls: number; billing: number; usage: number | null };
  const cells = new Map<string, Cell>();
  const cellOf = (day: string, model: string): Cell => {
    const key = `${day}\u0000${model}`;
    let c = cells.get(key);
    if (!c) {
      c = { ours: 0, calls: 0, billing: 0, usage: null };
      cells.set(key, c);
    }
    return c;
  };
  for (const r of ours) {
    const c = cellOf(r.day, r.model);
    c.ours += r.usd;
    c.calls += r.calls;
  }
  for (const b of billing) {
    const c = cellOf(b.day, canonicalModel(b.label, known));
    c.billing += b.usd;
    if (b.usage !== null) c.usage = (c.usage ?? 0) + b.usage;
  }

  const daily: ReconRow[] = [];
  const perModel = new Map<string, Cell>();
  for (const [key, c] of cells) {
    const [day, model] = key.split("\u0000");
    daily.push(makeRow(day, model, c.ours, c.billing, c.calls, c.usage, o));
    const t = perModel.get(model) ?? { ours: 0, calls: 0, billing: 0, usage: null };
    t.ours += c.ours;
    t.calls += c.calls;
    t.billing += c.billing;
    if (c.usage !== null) t.usage = (t.usage ?? 0) + c.usage;
    perModel.set(model, t);
  }
  daily.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "") || a.model.localeCompare(b.model));
  const totals = [...perModel].map(([model, t]) => makeRow(null, model, t.ours, t.billing, t.calls, t.usage, o)).sort((a, b) => b.billing + b.ours - (a.billing + a.ours) || a.model.localeCompare(b.model));
  const sum = (pick: (r: ReconRow) => number) => totals.reduce((a, r) => a + pick(r), 0);
  const grand = makeRow(null, "TOTAL", sum((r) => r.ours), sum((r) => r.billing), sum((r) => r.oursCalls), null, o);
  return { daily, totals, grand };
}

/* ══════════════════════════════ output ══════════════════════════════ */

const usd4 = (v: number): string => `$${v.toFixed(4)}`;
const signedUsd = (v: number): string => `${v < 0 ? "-" : "+"}$${Math.abs(v).toFixed(4)}`;
const pct = (r: ReconRow): string => (r.diffPct === null ? (r.ours > 0 ? "ours only" : "—") : `${r.diffPct >= 0 ? "+" : ""}${r.diffPct.toFixed(1)}%`);

function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i <= 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

/** Plain-text report: per-model totals first, then the model·day rows; a `!!` marks every flagged row. */
export function renderReconciliation(rec: Reconciliation, options: ReconOptions = {}): string {
  const th = options.thresholdPct ?? 5;
  const floor = options.minUsd ?? 0.01;
  const rowCells = (r: ReconRow): string[] => [r.flagged ? "!!" : "", r.day ?? "all days", r.model, usd4(r.ours), usd4(r.billing), signedUsd(r.diff), pct(r)];
  const header = ["", "day", "model", "ours (ai_usage)", "billing", "diff", "diff %"];
  const flagged = [...rec.totals, ...rec.daily].filter((r) => r.flagged).length;
  return [
    `Totals per model (ours − billing, flag: |diff| ≥ $${floor} and > ${th}% of billing)`,
    table(header, [...rec.totals.map(rowCells), rowCells(rec.grand)]),
    "",
    "Per model and day",
    rec.daily.length ? table(header, rec.daily.map(rowCells)) : "(no rows)",
    "",
    flagged ? `${flagged} row(s) flagged (!!): check the price book (cache tokens, toolUsePromptTokenCount, image size, grounding) in lib/generation/llm-pricing.ts.` : "No row exceeds the threshold.",
  ].join("\n");
}
