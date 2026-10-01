import "server-only";
import { ApiError } from "./api";
import { PG_INT4_MAX, parseIntParam } from "./validate";

/**
 * Shared helpers for admin list endpoints (plan §6.0, §6.4.1, §9, T6).
 *
 * Every admin list goes through the same safe building blocks:
 *   - query params are validated against a whitelist (bad input -> 400, never 500);
 *   - SQL only ever receives constant fragments from the spec plus `$n` placeholders,
 *     user values are never concatenated into SQL text;
 *   - pagination is keyset on `(sortColumn, id)` with an opaque base64url cursor.
 */

/* -------------------------------------------------------------------------- */
/* Spec types                                                                 */
/* -------------------------------------------------------------------------- */

/** Sort column type: the cursor value is validated against it and cast to it in SQL. */
export type SortType = "timestamptz" | "bigint" | "text";
export type IdType = "uuid" | "bigint";

export type SortDef = {
  /** Constant column reference (`g.created_at`); identifier-only, enforced by `assertIdent`. */
  column: string;
  dir: "ASC" | "DESC";
  type: SortType;
  /** Column may be NULL. NULLs always sort last (`NULLS LAST`) in both directions so the keyset order stays uniform. */
  nullable?: boolean;
};

export type IdDef = { column: string; type: IdType };

export type FilterDef =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "int"; min?: number; max?: number }
  | { kind: "uuid" }
  | { kind: "flag" };

export type RangeDef = {
  /** Default 366. */
  maxDays?: number;
  /** Days ending today when neither bound is given. Unset means no range (`null`). */
  defaultDays?: number;
  fromParam?: string;
  toParam?: string;
};

export type ListSpec = {
  /** The first key is the default sort. */
  sorts: Readonly<Record<string, SortDef>>;
  id: IdDef;
  filters?: Readonly<Record<string, FilterDef>>;
  range?: RangeDef;
};

type FilterOut<D> = D extends { kind: "enum"; values: readonly (infer V)[] }
  ? V
  : D extends { kind: "int" }
    ? number
    : D extends { kind: "uuid" }
      ? string
      : D extends { kind: "flag" }
        ? boolean
        : never;

export type ParsedFilters<F extends Readonly<Record<string, FilterDef>> | undefined> = F extends Readonly<Record<string, FilterDef>>
  ? { [K in keyof F]?: FilterOut<F[K]> }
  : Record<string, never>;

export type KeysetCursor = { v: string | null; id: string };

export type DateRange = {
  /** Start of the Tashkent day as a UTC instant (ISO), passed as `$n::timestamptz`. */
  fromTs: string;
  /** Tashkent midnight AFTER the `to` day (open bound): `ts >= fromTs AND ts < toTsExclusive`. */
  toTsExclusive: string;
  /** Number of calendar days covered (both ends inclusive). */
  days: number;
  /** Tashkent calendar days `YYYY-MM-DD`, for audit `meta.filters`. */
  fromDay: string;
  toDay: string;
};

export type ParsedList<S extends ListSpec> = {
  limit: number;
  cursor: KeysetCursor | null;
  sortKey: string;
  sort: SortDef;
  filters: ParsedFilters<S["filters"]>;
  range: DateRange | null;
};

export const LIST_LIMIT_DEFAULT = 50;
export const LIST_LIMIT_MAX = 100;
export const COUNT_CAP = 10_000;

const BAD_CURSOR = "Noto'g'ri kursor";
const MAX_CURSOR_CHARS = 512;
const MAX_TEXT_CURSOR = 256;
const INT64_MAX = BigInt("9223372036854775807");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR_TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{6}$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Column names spliced into SQL must be plain identifiers. The spec is a developer
 * constant, but if user input ever leaks into it by mistake, it stops here (T6, defence in depth).
 */
function assertIdent(column: string): string {
  if (!IDENT_RE.test(column)) throw new Error(`admin-list: invalid column identifier ${JSON.stringify(column)}`);
  return column;
}

/* -------------------------------------------------------------------------- */
/* Cursor                                                                     */
/* -------------------------------------------------------------------------- */

export function encodeCursor(c: KeysetCursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id]), "utf8").toString("base64url");
}

function isRealTimestamp(m: RegExpExecArray): boolean {
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (y < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC silently rolls 2026-02-30 over to March 2, while Postgres would fail with 22008 (500).
  return (
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi &&
    t.getUTCSeconds() === s
  );
}

function validInt64(s: string, allowNegative: boolean): boolean {
  if (!(allowNegative ? /^-?\d{1,19}$/ : /^\d{1,19}$/).test(s)) return false;
  const n = BigInt(s);
  return n <= INT64_MAX && n >= -INT64_MAX - BigInt(1);
}

function validCursorValue(v: unknown, sort: SortDef): v is string | null {
  if (v === null) return sort.nullable === true;
  if (typeof v !== "string") return false;
  switch (sort.type) {
    case "timestamptz": {
      const m = CURSOR_TS_RE.exec(v);
      return m !== null && isRealTimestamp(m);
    }
    case "bigint":
      return validInt64(v, true);
    case "text":
      return v.length <= MAX_TEXT_CURSOR && !v.includes("\0");
  }
}

function validCursorId(id: unknown, type: IdType): id is string {
  if (typeof id !== "string") return false;
  return type === "uuid" ? UUID_RE.test(id) : validInt64(id, false);
}

/** Forged or malformed cursor -> `null` (the caller answers 400). */
export function decodeCursor(raw: string, sort: SortDef, id: IdDef): KeysetCursor | null {
  if (raw.length === 0 || raw.length > MAX_CURSOR_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return null;
  const [v, cid] = parsed as unknown[];
  if (!validCursorValue(v, sort) || !validCursorId(cid, id.type)) return null;
  return { v, id: id.type === "uuid" ? cid.toLowerCase() : cid };
}

/* -------------------------------------------------------------------------- */
/* Tashkent date range                                                        */
/* -------------------------------------------------------------------------- */

/** Tashkent is UTC+5 with no DST (same value as `TASHKENT_UTC_OFFSET_SEC` in spend.ts). */
const TASHKENT_OFFSET_MS = 5 * 3600 * 1000;
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** `YYYY-MM-DD` -> UTC midnight in ms, or `null` (not a real date / year out of bounds). */
function dayToUtcMs(raw: string): number | null {
  const m = DAY_RE.exec(raw);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? t : null;
}

const dayString = (utcMidnightMs: number): string => new Date(utcMidnightMs).toISOString().slice(0, 10);

/** Current Tashkent calendar day as a UTC-midnight timestamp (ms). */
function tashkentTodayMs(nowMs: number): number {
  return Math.floor((nowMs + TASHKENT_OFFSET_MS) / DAY_MS) * DAY_MS;
}

export type DateRangeOptions = {
  maxDays?: number;
  /** Length when a bound is missing (default 30): the window ending today, or ending at `to`. */
  defaultDays?: number;
  /** Clock override for tests. */
  nowMs?: number;
};

/**
 * Reads `YYYY-MM-DD` as **Asia/Tashkent** calendar days, `to` inclusive.
 *
 *   from+to   -> exactly those days
 *   only from -> from..today (just the `from` day if today is earlier)
 *   only to   -> (to - defaultDays + 1)..to
 *   neither   -> the last defaultDays days, ending today
 *
 * Errors (format, non-existent date, from > to, longer than maxDays) -> 400.
 */
export function parseDateRange(from: string | null | undefined, to: string | null | undefined, opts: DateRangeOptions = {}): DateRange {
  const maxDays = opts.maxDays ?? 366;
  const defaultDays = Math.min(opts.defaultDays ?? 30, maxDays);
  const today = tashkentTodayMs(opts.nowMs ?? Date.now());
  const hasFrom = from !== null && from !== undefined && from !== "";
  const hasTo = to !== null && to !== undefined && to !== "";

  let fromMs = 0;
  let toMs = 0;
  if (hasFrom) {
    const f = dayToUtcMs(from);
    if (f === null) throw new ApiError("Boshlanish sanasi noto'g'ri (YYYY-MM-DD kutiladi)", 400);
    fromMs = f;
  }
  if (hasTo) {
    const t = dayToUtcMs(to);
    if (t === null) throw new ApiError("Tugash sanasi noto'g'ri (YYYY-MM-DD kutiladi)", 400);
    toMs = t;
  }

  if (hasFrom && !hasTo) toMs = Math.max(today, fromMs);
  else if (!hasFrom && hasTo) fromMs = toMs - (defaultDays - 1) * DAY_MS;
  else if (!hasFrom && !hasTo) {
    toMs = today;
    fromMs = today - (defaultDays - 1) * DAY_MS;
  }

  if (toMs < fromMs) throw new ApiError("Tugash sanasi boshlanish sanasidan oldin bo'lmasligi kerak", 400);
  const days = Math.round((toMs - fromMs) / DAY_MS) + 1;
  if (days > maxDays) throw new ApiError(`Oraliq ${maxDays} kundan oshmasligi kerak`, 400);

  return {
    fromTs: new Date(fromMs - TASHKENT_OFFSET_MS).toISOString(),
    toTsExclusive: new Date(toMs + DAY_MS - TASHKENT_OFFSET_MS).toISOString(),
    days,
    fromDay: dayString(fromMs),
    toDay: dayString(toMs),
  };
}

/* -------------------------------------------------------------------------- */
/* Query param validation                                                     */
/* -------------------------------------------------------------------------- */

const bad = (name: string): ApiError => new ApiError(`Noto'g'ri parametr: ${name}`, 400);

/** Single value; a repeated param (`?x=1&x=2`) is a 400, which closes the type-confusion route. */
function single(url: URL, name: string): string | null {
  const all = url.searchParams.getAll(name);
  if (all.length > 1) throw bad(name);
  const v = all[0];
  return v === undefined || v === "" ? null : v;
}

function parseFilter(name: string, def: FilterDef, raw: string): string | number | boolean {
  switch (def.kind) {
    case "enum":
      // Exact (case-sensitive) match against the whitelist; the value still reaches SQL only as `$n`.
      if (!def.values.includes(raw)) throw bad(name);
      return raw;
    case "int": {
      const n = parseIntParam(raw, { min: def.min ?? 0, max: def.max ?? PG_INT4_MAX });
      if (n === null) throw bad(name);
      return n;
    }
    case "uuid":
      if (!UUID_RE.test(raw)) throw bad(name);
      return raw.toLowerCase();
    case "flag":
      if (raw !== "0" && raw !== "1") throw bad(name);
      return raw === "1";
  }
}

/**
 * Validates `limit`, `cursor`, `sort`, filters and `from`/`to`. Bad input throws a 400
 * `ApiError` with an Uzbek message, never a 500. The offending value is NOT echoed
 * back, only the parameter name from the spec.
 */
export function parseListParams<S extends ListSpec>(url: URL, spec: S): ParsedList<S> {
  const firstKey = Object.keys(spec.sorts)[0];
  if (firstKey === undefined) throw new Error("admin-list: the spec needs at least one sort");

  const rawLimit = single(url, "limit");
  let limit = LIST_LIMIT_DEFAULT;
  if (rawLimit !== null) {
    const n = parseIntParam(rawLimit, { min: 1, max: LIST_LIMIT_MAX });
    if (n === null) throw new ApiError(`limit 1 dan ${LIST_LIMIT_MAX} gacha bo'lgan butun son bo'lishi kerak`, 400);
    limit = n;
  }

  const sortKey = single(url, "sort") ?? firstKey;
  // hasOwn: prototype keys such as "constructor" / "__proto__" must not pass.
  if (!Object.hasOwn(spec.sorts, sortKey)) throw new ApiError("Noto'g'ri saralash", 400);
  const sort = spec.sorts[sortKey] as SortDef;

  const rawCursor = single(url, "cursor");
  let cursor: KeysetCursor | null = null;
  if (rawCursor !== null) {
    cursor = decodeCursor(rawCursor, sort, spec.id);
    if (!cursor) throw new ApiError(BAD_CURSOR, 400);
  }

  const filters: Record<string, string | number | boolean> = {};
  for (const [name, def] of Object.entries(spec.filters ?? {})) {
    const raw = single(url, name);
    if (raw !== null) filters[name] = parseFilter(name, def, raw);
  }

  let range: DateRange | null = null;
  if (spec.range) {
    const fromRaw = single(url, spec.range.fromParam ?? "from");
    const toRaw = single(url, spec.range.toParam ?? "to");
    if (fromRaw !== null || toRaw !== null || spec.range.defaultDays !== undefined) {
      range = parseDateRange(fromRaw, toRaw, { maxDays: spec.range.maxDays, defaultDays: spec.range.defaultDays });
    }
  }

  return { limit, cursor, sortKey, sort, filters: filters as ParsedFilters<S["filters"]>, range };
}

/* -------------------------------------------------------------------------- */
/* Keyset SQL builder                                                         */
/* -------------------------------------------------------------------------- */

/** SELECT fragment for the cursor columns; `pageResult` reads `cursor_v` / `cursor_id`. */
export function keysetSelect(sort: SortDef, id: IdDef): string {
  const col = assertIdent(sort.column);
  const idCol = assertIdent(id.column);
  // Microsecond precision: JS `Date` only has milliseconds, so the timestamp travels as TEXT
  // straight from the database (same format as `encodeCursor` in jobs.ts).
  const v =
    sort.type === "timestamptz"
      ? `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`
      : sort.type === "bigint"
        ? `${col}::text`
        : col;
  return `${v} AS cursor_v, ${idCol}::text AS cursor_id`;
}

function castFor(type: SortType | IdType, n: number): string {
  switch (type) {
    case "timestamptz":
      // The cursor is zone-less UTC text; `timestamp AT TIME ZONE 'UTC'` yields the exact instant.
      return `($${n}::timestamp AT TIME ZONE 'UTC')`;
    case "bigint":
      return `$${n}::bigint`;
    case "uuid":
      return `$${n}::uuid`;
    case "text":
      return `$${n}::text`;
  }
}

export type KeysetSql = {
  /** Condition safe to join with `AND` (self-parenthesised); `TRUE` when there is no cursor. */
  where: string;
  /** Text that follows `ORDER BY`: `col DESC, id DESC`. */
  orderBy: string;
  /** Values for the `$n` placeholders in `where`, starting at `paramOffset + 1`. */
  params: unknown[];
};

/**
 * Constant SQL fragments for keyset pagination; user values appear only in `params`.
 *
 * `paramOffset` is the number of `$n` placeholders the caller already used, so ours
 * start at `$(paramOffset+1)`. Example:
 *
 *   const ks = buildKeyset({ sort, cursor, id: spec.id, paramOffset: params.length });
 *   `SELECT ..., ${keysetSelect(sort, spec.id)} FROM ... WHERE <own conditions> AND ${ks.where}
 *    ORDER BY ${ks.orderBy} LIMIT $${params.length + ks.params.length + 1}`
 *
 * Both columns sort in the SAME direction, so the row comparison `(col, id) < ($v, $id)`
 * can use a composite index in full.
 */
export function buildKeyset(opts: { sort: SortDef; cursor: KeysetCursor | null; id: IdDef; paramOffset?: number }): KeysetSql {
  const { sort, cursor, id } = opts;
  const offset = opts.paramOffset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error("admin-list: invalid paramOffset");
  const col = assertIdent(sort.column);
  const idCol = assertIdent(id.column);
  if (sort.dir !== "ASC" && sort.dir !== "DESC") throw new Error("admin-list: invalid sort direction");

  const dir = sort.dir;
  const orderBy = `${col} ${dir}${sort.nullable ? " NULLS LAST" : ""}, ${idCol} ${dir}`;
  if (!cursor) return { where: "TRUE", orderBy, params: [] };

  const op = dir === "DESC" ? "<" : ">";
  if (cursor.v === null) {
    if (!sort.nullable) throw new Error("admin-list: a NULL cursor is only valid for a nullable sort");
    // NULL rows come last: after one, only later ids within the NULL group remain.
    return { where: `(${col} IS NULL AND ${idCol} ${op} ${castFor(id.type, offset + 1)})`, orderBy, params: [cursor.id] };
  }
  const tuple = `(${col}, ${idCol}) ${op} (${castFor(sort.type, offset + 1)}, ${castFor(id.type, offset + 2)})`;
  // NULLS LAST: with a non-NULL cursor, NULL rows always come "after" it.
  const where = sort.nullable ? `(${col} IS NULL OR ${tuple})` : tuple;
  return { where, orderBy, params: [cursor.v, cursor.id] };
}

export type CursorColumns = { cursor_v: string | null; cursor_id: string };

/**
 * The limit+1 trick: the query fetches `LIMIT limit+1` rows and an extra row means there
 * is a next page. The `cursor_*` columns are stripped from the returned items.
 */
export function pageResult<T extends CursorColumns>(
  rows: readonly T[],
  limit: number,
  sort: SortDef,
): { items: Array<Omit<T, keyof CursorColumns>>; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const items = page.map((r) => {
    const { cursor_v: _v, cursor_id: _id, ...rest } = r;
    void _v;
    void _id;
    return rest;
  });
  const last = page[page.length - 1];
  if (rows.length <= limit || !last) return { items, nextCursor: null };
  if (last.cursor_v === null && !sort.nullable) throw new Error("admin-list: NULL cursor value on a non-nullable sort");
  return { items, nextCursor: encodeCursor({ v: last.cursor_v, id: last.cursor_id }) };
}

/* -------------------------------------------------------------------------- */
/* Capped count                                                               */
/* -------------------------------------------------------------------------- */

export type QueryRunner =
  | ((text: string, params: unknown[]) => Promise<unknown[]>)
  | { query: (text: string, params: unknown[]) => Promise<{ rows: unknown[] }> };

/**
 * `SELECT count(*) FROM (SELECT 1 <fromWhereSql> LIMIT cap+1) t`, cheap even on big tables.
 * `fromWhereSql` is a CONSTANT `FROM ... WHERE ...` fragment (plus `$n`); never user text.
 * Above `cap` it returns `{ total: cap, totalCapped: true }` ("10 000+").
 */
export async function countCapped(
  runner: QueryRunner,
  fromWhereSql: string,
  params: unknown[],
  cap = COUNT_CAP,
): Promise<{ total: number; totalCapped: boolean }> {
  if (!Number.isInteger(cap) || cap < 1 || cap > 1_000_000) throw new Error("admin-list: invalid cap");
  const sql = `SELECT count(*) AS n FROM (SELECT 1 ${fromWhereSql} LIMIT ${cap + 1}) t`;
  const rows = typeof runner === "function" ? await runner(sql, params) : (await runner.query(sql, params)).rows;
  const n = Number((rows[0] as { n: string | number } | undefined)?.n ?? 0);
  return n > cap ? { total: cap, totalCapped: true } : { total: n, totalCapped: false };
}

/* -------------------------------------------------------------------------- */
/* User search (§6.4.1)                                                       */
/* -------------------------------------------------------------------------- */

export type UserQuery =
  /** `#123`: `users.id` only. */
  | { kind: "id"; value: string }
  /** Digits only (<=19, within int64): `users.id` OR exact `telegram_id`. */
  | { kind: "numeric"; value: string }
  /** Normalised phone number (digits only): exact match. */
  | { kind: "phone"; value: string }
  /** `@x`: prefix of `lower(username)` (lowercased, without `@`). */
  | { kind: "username"; value: string }
  /** Prefix of `lower(name)` (lowercased, <=120 chars). */
  | { kind: "name"; value: string };

const MAX_NAME_CHARS = 120;
const MAX_USERNAME_CHARS = 64;
const MAX_PHONE_DIGITS = 32;

/** A NUL byte is invalid in Postgres `text` (22021 -> 500), so it is dropped before searching. */
const stripNul = (s: string): string => s.replace(/\0/g, "");
const clip = (s: string, n: number): string => Array.from(s).slice(0, n).join("");

/**
 * Classifies the search text on the server (nothing is substring-scanned).
 * Blank input -> `null` (no filter).
 *
 * Order matters: `#123` -> id; all digits -> numeric; leading `+` or >= 9 digits once
 * separators are stripped -> phone; `@` -> username; anything else -> name prefix.
 * A bare 9-19 digit string (`998901234512`) is `numeric` by row 1 of the §6.4.1 table,
 * so a phone must be typed with `+` or with separators.
 */
export function classifyUserQuery(q: string): UserQuery | null {
  const s = stripNul(q).trim();
  if (s === "") return null;

  const idM = /^#(\d{1,19})$/.exec(s);
  if (idM && BigInt(idM[1] as string) <= INT64_MAX) return { kind: "id", value: BigInt(idM[1] as string).toString() };

  if (/^\d{1,19}$/.test(s) && BigInt(s) <= INT64_MAX) return { kind: "numeric", value: BigInt(s).toString() };

  const compact = s.replace(/[\s\-().]/g, "");
  if (/^\+\d+$/.test(compact) || /^\d{9,}$/.test(compact)) {
    return { kind: "phone", value: compact.replace(/\D/g, "").slice(0, MAX_PHONE_DIGITS) };
  }

  if (s.startsWith("@")) {
    const u = clip(s.slice(1).trim().toLowerCase(), MAX_USERNAME_CHARS);
    return u === "" ? null : { kind: "username", value: u };
  }

  return { kind: "name", value: clip(s.toLowerCase(), MAX_NAME_CHARS) };
}

/** For `LIKE ... ESCAPE '\'`: escapes `\`, `%` and `_`. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** Ready-made `LIKE` pattern for a prefix search (`abc%`, metacharacters escaped). */
export const likePrefix = (s: string): string => `${escapeLike(s)}%`;
