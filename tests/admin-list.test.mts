import test from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import {
  buildKeyset,
  classifyUserQuery,
  countCapped,
  decodeCursor,
  encodeCursor,
  escapeLike,
  keysetSelect,
  likePrefix,
  pageResult,
  parseDateRange,
  parseListParams,
  type IdDef,
  type ListSpec,
  type ParsedList,
  type SortDef,
} from "../lib/server/admin-list.ts";

/**
 * `lib/server/admin-list.ts` — plan §6.0 / §6.4.1 / §9 / T6.
 * Pure unit tests first, then a DB-backed keyset test against real Postgres
 * (skipped without DATABASE_URL).
 */

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
// One isolated database for the whole file: `lib/server/db.ts` keeps a single pool per process.
const iso = hasDb ? await createIsolatedDb("adminlist") : { isolated: false, drop: async () => {} };
const dbm = hasDb ? await import("../lib/server/db.ts") : null;
test.after(async () => {
  await dbm?.pool().end().catch(() => {});
  await iso.drop();
});

const UUID_A = "11111111-2222-3333-4444-555555555555";

const SPEC = {
  sorts: {
    created_desc: { column: "g.created_at", dir: "DESC", type: "timestamptz" },
    created_asc: { column: "g.created_at", dir: "ASC", type: "timestamptz" },
    balance_desc: { column: "u.balance", dir: "DESC", type: "bigint" },
    seen_desc: { column: "u.last_seen_at", dir: "DESC", type: "timestamptz", nullable: true },
    name_asc: { column: "u.name", dir: "ASC", type: "text" },
  },
  id: { column: "g.id", type: "uuid" },
  filters: {
    status: { kind: "enum", values: ["queued", "done", "failed"] },
    userId: { kind: "int", min: 1 },
    gen: { kind: "uuid" },
    blocked: { kind: "flag" },
  },
  range: { maxDays: 366 },
} as const satisfies ListSpec;

const u = (qs: string): URL => new URL(`https://x.test/api/admin/things${qs}`);
/** Duck-typed: under tsx the test and the library can see two module instances of `ApiError`, so `instanceof` is unreliable. */
type ApiErrorLike = Error & { status: number };
const is400 = (e: unknown): boolean => e instanceof Error && (e as ApiErrorLike).status === 400 && e.message.length > 0;
const cur = (v: unknown, id: unknown): string => Buffer.from(JSON.stringify([v, id])).toString("base64url");
const TS = "2026-09-23T04:12:00.123456";

/* ------------------------------ parseListParams ------------------------------ */

test("parseListParams: defaults", () => {
  const p = parseListParams(u(""), SPEC);
  assert.equal(p.limit, 50);
  assert.equal(p.cursor, null);
  assert.equal(p.sortKey, "created_desc");
  assert.deepEqual(p.sort, SPEC.sorts.created_desc);
  assert.deepEqual(p.filters, {});
  assert.equal(p.range, null);
});

test("parseListParams: limit bounds 1..100", () => {
  assert.equal(parseListParams(u("?limit=1"), SPEC).limit, 1);
  assert.equal(parseListParams(u("?limit=100"), SPEC).limit, 100);
  for (const bad of ["0", "101", "-5", "abc", "1e2", "0x10", "10.5", "99999999999999999999"]) {
    assert.throws(() => parseListParams(u(`?limit=${bad}`), SPEC), is400, `limit=${bad}`);
  }
  // an empty value is "not given"
  assert.equal(parseListParams(u("?limit="), SPEC).limit, 50);
});

test("parseListParams: sort whitelist, injection and prototype keys", () => {
  assert.equal(parseListParams(u("?sort=balance_desc"), SPEC).sort.column, "u.balance");
  const attempts = [
    "created_desc; DROP TABLE users",
    "created_desc%3B%20DROP%20TABLE%20users",
    "created_at",
    "g.created_at",
    "CREATED_DESC",
    "created_desc,id",
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "created_desc%20",
    "(select 1)",
  ];
  for (const a of attempts) assert.throws(() => parseListParams(u(`?sort=${a}`), SPEC), is400, a);
});

test("parseListParams: error messages never echo the value", () => {
  for (const qs of ["?sort=EVIL_VALUE_1", "?status=EVIL_VALUE_2", "?limit=EVIL_VALUE_3", `?cursor=${encodeURIComponent("EVIL_VALUE_4")}`, "?from=EVIL_VALUE_5"]) {
    try {
      parseListParams(u(qs), SPEC);
      assert.fail("must throw");
    } catch (e) {
      assert.ok(is400(e));
      assert.doesNotMatch((e as ApiErrorLike).message, /EVIL_VALUE/);
    }
  }
});

test("parseListParams: repeated params are rejected (type confusion)", () => {
  assert.throws(() => parseListParams(u("?sort=created_asc&sort=created_desc"), SPEC), is400);
  assert.throws(() => parseListParams(u("?limit=5&limit=6"), SPEC), is400);
  assert.throws(() => parseListParams(u("?status=done&status=failed"), SPEC), is400);
  assert.throws(() => parseListParams(u(`?cursor=${cur(TS, UUID_A)}&cursor=${cur(TS, UUID_A)}`), SPEC), is400);
  assert.throws(() => parseListParams(u("?from=2026-01-01&from=2026-01-02"), SPEC), is400);
  // array-style syntax is just an unknown param name and is ignored
  assert.deepEqual(parseListParams(u("?status[]=done"), SPEC).filters, {});
});

test("parseListParams: filters are typed and validated", () => {
  const p = parseListParams(u(`?status=done&userId=42&gen=${UUID_A.toUpperCase()}&blocked=1`), SPEC);
  assert.deepEqual(p.filters, { status: "done", userId: 42, gen: UUID_A, blocked: true });
  assert.equal(parseListParams(u("?blocked=0"), SPEC).filters.blocked, false);

  const bad = [
    "status=DONE",
    "status=done%27%20OR%201=1--",
    "status=__proto__",
    "status=constructor",
    "userId=0",
    "userId=-1",
    "userId=1.5",
    "userId=1e3",
    "userId=0x10",
    "userId=99999999999",
    "userId=abc",
    "userId=1%20OR%201=1",
    "gen=not-a-uuid",
    `gen=${UUID_A}%27`,
    `gen=${UUID_A}0`,
    "blocked=2",
    "blocked=true",
    "blocked=yes",
    "blocked=-1",
  ];
  for (const b of bad) assert.throws(() => parseListParams(u(`?${b}`), SPEC), is400, b);
});

test("parseListParams: unknown params are ignored, empty filter = absent", () => {
  const p = parseListParams(u("?q=hello&status=&foo=bar"), SPEC);
  assert.deepEqual(p.filters, {});
});

test("parseListParams: int filter honours custom min/max", () => {
  const spec = { sorts: SPEC.sorts, id: SPEC.id, filters: { n: { kind: "int", min: 5, max: 10 } } } as const satisfies ListSpec;
  assert.equal(parseListParams(u("?n=5"), spec).filters.n, 5);
  assert.equal(parseListParams(u("?n=10"), spec).filters.n, 10);
  assert.throws(() => parseListParams(u("?n=4"), spec), is400);
  assert.throws(() => parseListParams(u("?n=11"), spec), is400);
});

test("parseListParams: range only when the spec declares it", () => {
  const noRange = { sorts: SPEC.sorts, id: SPEC.id } as const satisfies ListSpec;
  assert.equal(parseListParams(u("?from=2026-01-01&to=2026-01-31"), noRange).range, null);
  const p = parseListParams(u("?from=2026-01-01&to=2026-01-31"), SPEC);
  assert.equal(p.range?.days, 31);
  assert.equal(p.range?.fromTs, "2025-12-31T19:00:00.000Z");
  assert.throws(() => parseListParams(u("?from=2026-02-30"), SPEC), is400);
  assert.throws(() => parseListParams(u("?from=2026-01-01&to=2027-12-31"), SPEC), is400);
  const withDefault = { ...SPEC, range: { defaultDays: 7 } } as const satisfies ListSpec;
  assert.equal(parseListParams(u(""), withDefault).range?.days, 7);
});

test("parseListParams: spec without sorts is a programmer error", () => {
  assert.throws(() => parseListParams(u(""), { sorts: {}, id: SPEC.id }), /at least one sort/);
});

/* --------------------------------- cursors ---------------------------------- */

test("cursor: round trip keeps microseconds and the id", () => {
  const sort: SortDef = SPEC.sorts.created_desc;
  const id: IdDef = SPEC.id;
  const enc = encodeCursor({ v: TS, id: UUID_A });
  assert.match(enc, /^[A-Za-z0-9_-]+$/, "base64url, no padding or +/");
  assert.deepEqual(decodeCursor(enc, sort, id), { v: TS, id: UUID_A });
  assert.deepEqual(JSON.parse(Buffer.from(enc, "base64url").toString("utf8")), [TS, UUID_A]);
  // uuid ids are normalised to lower case
  assert.equal(decodeCursor(cur(TS, UUID_A.toUpperCase()), sort, id)?.id, UUID_A);
});

test("cursor: parseListParams turns a bad cursor into 400 'Noto'g'ri kursor'", () => {
  const ok = encodeCursor({ v: TS, id: UUID_A });
  assert.equal(parseListParams(u(`?cursor=${ok}`), SPEC).cursor?.id, UUID_A);
  const attempts = [
    "!!!",
    "AAAA",
    Buffer.from("not json").toString("base64url"),
    Buffer.from("{}").toString("base64url"),
    Buffer.from('["only-one"]').toString("base64url"),
    Buffer.from(JSON.stringify([TS, UUID_A, "extra"])).toString("base64url"),
    cur(TS, "1; DROP TABLE users"),
    cur(TS, `${UUID_A}'`),
    cur(`${TS}'; DROP TABLE users--`, UUID_A),
    cur("2026-09-23T04:12:00.123", UUID_A), // not microseconds
    cur("2026-09-23T04:12:00.123456Z", UUID_A), // trailing Z
    cur("2026-02-30T04:12:00.123456", UUID_A), // not a real date
    cur("2026-13-01T04:12:00.123456", UUID_A),
    cur("2026-09-23T24:12:00.123456", UUID_A),
    cur("0000-01-01T00:00:00.000000", UUID_A),
    cur(null, UUID_A), // NULL on a non-nullable sort
    cur(12345, UUID_A), // number instead of string
    cur(["x"], UUID_A),
    cur({ a: 1 }, UUID_A),
    cur(true, UUID_A),
    cur(TS, 123),
    cur(TS, null),
    cur(TS, ["a"]),
    "a".repeat(600),
  ];
  for (const a of attempts) {
    try {
      parseListParams(u(`?cursor=${encodeURIComponent(a)}`), SPEC);
      assert.fail(`accepted: ${a.slice(0, 60)}`);
    } catch (e) {
      assert.ok(is400(e), `status for ${a.slice(0, 60)}`);
      assert.equal((e as ApiErrorLike).message, "Noto'g'ri kursor");
    }
  }
});

test("cursor: value is validated against the SORT type (type confusion)", () => {
  const ts = SPEC.sorts.created_desc;
  const big = SPEC.sorts.balance_desc;
  const txt = SPEC.sorts.name_asc;
  const nul = SPEC.sorts.seen_desc;
  // a timestamp cursor on a bigint sort, and the reverse
  assert.equal(decodeCursor(cur(TS, UUID_A), big, SPEC.id), null);
  assert.equal(decodeCursor(cur("123", UUID_A), ts, SPEC.id), null);
  // bigint: digits only, int64 range
  assert.deepEqual(decodeCursor(cur("-5", UUID_A), big, SPEC.id), { v: "-5", id: UUID_A });
  assert.deepEqual(decodeCursor(cur("9223372036854775807", UUID_A), big, SPEC.id), { v: "9223372036854775807", id: UUID_A });
  for (const v of ["9223372036854775808", "1e3", "1.5", "0x1", "", " 1", "1 ", "--1", "12345678901234567890"]) {
    assert.equal(decodeCursor(cur(v, UUID_A), big, SPEC.id), null, v);
  }
  // text: bounded, no NUL
  assert.deepEqual(decodeCursor(cur("Ali", UUID_A), txt, SPEC.id), { v: "Ali", id: UUID_A });
  assert.equal(decodeCursor(cur("a\u0000b", UUID_A), txt, SPEC.id), null);
  assert.equal(decodeCursor(cur("x".repeat(257), UUID_A), txt, SPEC.id), null);
  // null only for nullable sorts
  assert.deepEqual(decodeCursor(cur(null, UUID_A), nul, SPEC.id), { v: null, id: UUID_A });
  assert.equal(decodeCursor(cur(null, UUID_A), ts, SPEC.id), null);
});

test("cursor: bigint ids", () => {
  const id: IdDef = { column: "t.id", type: "bigint" };
  const sort = SPEC.sorts.created_desc;
  assert.deepEqual(decodeCursor(cur(TS, "42"), sort, id), { v: TS, id: "42" });
  for (const bad of ["-1", "1.5", "abc", "9223372036854775808", UUID_A, "", "1e3"]) {
    assert.equal(decodeCursor(cur(TS, bad), sort, id), null, bad);
  }
});

/* ------------------------------- buildKeyset -------------------------------- */

test("buildKeyset: no cursor -> TRUE, constant ORDER BY, no params", () => {
  const k = buildKeyset({ sort: SPEC.sorts.created_desc, cursor: null, id: SPEC.id });
  assert.deepEqual(k, { where: "TRUE", orderBy: "g.created_at DESC, g.id DESC", params: [] });
  const a = buildKeyset({ sort: SPEC.sorts.created_asc, cursor: null, id: SPEC.id });
  assert.equal(a.orderBy, "g.created_at ASC, g.id ASC");
});

test("buildKeyset: DESC uses '<', ASC uses '>', ids tie-break in the same direction", () => {
  const c = { v: TS, id: UUID_A };
  const d = buildKeyset({ sort: SPEC.sorts.created_desc, cursor: c, id: SPEC.id });
  assert.equal(d.where, "(g.created_at, g.id) < (($1::timestamp AT TIME ZONE 'UTC'), $2::uuid)");
  assert.deepEqual(d.params, [TS, UUID_A]);
  const a = buildKeyset({ sort: SPEC.sorts.created_asc, cursor: c, id: SPEC.id });
  assert.equal(a.where, "(g.created_at, g.id) > (($1::timestamp AT TIME ZONE 'UTC'), $2::uuid)");
});

test("buildKeyset: paramOffset shifts placeholders", () => {
  const k = buildKeyset({ sort: SPEC.sorts.balance_desc, cursor: { v: "500", id: UUID_A }, id: SPEC.id, paramOffset: 3 });
  assert.equal(k.where, "(u.balance, g.id) < ($4::bigint, $5::uuid)");
  assert.deepEqual(k.params, ["500", UUID_A]);
  assert.throws(() => buildKeyset({ sort: SPEC.sorts.balance_desc, cursor: null, id: SPEC.id, paramOffset: -1 }));
  assert.throws(() => buildKeyset({ sort: SPEC.sorts.balance_desc, cursor: null, id: SPEC.id, paramOffset: 1.5 }));
});

test("buildKeyset: nullable sort uses NULLS LAST and handles the NULL group", () => {
  const sort = SPEC.sorts.seen_desc;
  assert.equal(buildKeyset({ sort, cursor: null, id: SPEC.id }).orderBy, "u.last_seen_at DESC NULLS LAST, g.id DESC");
  const mid = buildKeyset({ sort, cursor: { v: TS, id: UUID_A }, id: SPEC.id });
  assert.match(mid.where, /^\(u\.last_seen_at IS NULL OR \(u\.last_seen_at, g\.id\) < /);
  const inNull = buildKeyset({ sort, cursor: { v: null, id: UUID_A }, id: SPEC.id, paramOffset: 1 });
  assert.equal(inNull.where, "(u.last_seen_at IS NULL AND g.id < $2::uuid)");
  assert.deepEqual(inNull.params, [UUID_A]);
  assert.throws(() => buildKeyset({ sort: SPEC.sorts.created_desc, cursor: { v: null, id: UUID_A }, id: SPEC.id }), /nullable/);
});

test("buildKeyset: only constant fragments reach the SQL text, values stay in params", () => {
  const evil = { v: `${TS}'; DROP TABLE users;--`, id: `${UUID_A}'; DROP TABLE users;--` };
  const k = buildKeyset({ sort: SPEC.sorts.created_desc, cursor: evil, id: SPEC.id });
  const sql = k.where + k.orderBy;
  assert.doesNotMatch(sql, /DROP|;|--/);
  assert.equal(sql.split("'").length - 1, 2, "the only quotes are the constant 'UTC' literal");
  assert.deepEqual(k.params, [evil.v, evil.id]);
});

test("buildKeyset/keysetSelect: non-identifier columns are refused", () => {
  for (const column of ["x; DROP TABLE users", "a b", "a.b.c", "", "1abc", "lower(name)", "a--", "a'", "a\"b"]) {
    assert.throws(() => buildKeyset({ sort: { column, dir: "ASC", type: "text" }, cursor: null, id: SPEC.id }), /invalid column/, column);
    assert.throws(() => keysetSelect({ column, dir: "ASC", type: "text" }, SPEC.id), /invalid column/, column);
    assert.throws(() => buildKeyset({ sort: SPEC.sorts.name_asc, cursor: null, id: { column, type: "uuid" } }), /invalid column/, column);
  }
  assert.throws(() => buildKeyset({ sort: { column: "a", dir: "SIDEWAYS" as "ASC", type: "text" }, cursor: null, id: SPEC.id }), /direction/);
});

test("keysetSelect: per-type value expression", () => {
  assert.equal(
    keysetSelect(SPEC.sorts.created_desc, SPEC.id),
    `to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_v, g.id::text AS cursor_id`,
  );
  assert.equal(keysetSelect(SPEC.sorts.balance_desc, SPEC.id), "u.balance::text AS cursor_v, g.id::text AS cursor_id");
  assert.equal(keysetSelect(SPEC.sorts.name_asc, SPEC.id), "u.name AS cursor_v, g.id::text AS cursor_id");
});

/* -------------------------------- pageResult -------------------------------- */

test("pageResult: limit+1 trick, cursor columns stripped", () => {
  const sort = SPEC.sorts.created_desc;
  const rows = [1, 2, 3].map((n) => ({ n, cursor_v: `${TS.slice(0, -1)}${n}`, cursor_id: UUID_A }));
  const p = pageResult(rows, 2, sort);
  assert.deepEqual(p.items, [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(decodeCursor(p.nextCursor!, sort, SPEC.id), { v: `${TS.slice(0, -1)}2`, id: UUID_A });
  const last = pageResult(rows.slice(0, 2), 2, sort);
  assert.equal(last.nextCursor, null);
  assert.equal(last.items.length, 2);
  assert.deepEqual(pageResult([], 5, sort), { items: [], nextCursor: null });
});

test("pageResult: NULL cursor value is only legal on a nullable sort", () => {
  const rows = [
    { cursor_v: null, cursor_id: UUID_A },
    { cursor_v: null, cursor_id: UUID_A },
  ];
  assert.throws(() => pageResult(rows, 1, SPEC.sorts.created_desc), /NULL cursor/);
  const p = pageResult(rows, 1, SPEC.sorts.seen_desc);
  assert.deepEqual(decodeCursor(p.nextCursor!, SPEC.sorts.seen_desc, SPEC.id), { v: null, id: UUID_A });
});

/* ------------------------------- countCapped -------------------------------- */

test("countCapped: query shape, cap and params", async () => {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  const fn = (n: string) => async (sql: string, params: unknown[]) => {
    seen.push({ sql, params });
    return [{ n }];
  };
  assert.deepEqual(await countCapped(fn("7"), "FROM users u WHERE u.id > $1", [5]), { total: 7, totalCapped: false });
  assert.equal(seen[0]!.sql, "SELECT count(*) AS n FROM (SELECT 1 FROM users u WHERE u.id > $1 LIMIT 10001) t");
  assert.deepEqual(seen[0]!.params, [5]);
  assert.deepEqual(await countCapped(fn("10000"), "FROM x", []), { total: 10000, totalCapped: false });
  assert.deepEqual(await countCapped(fn("10001"), "FROM x", []), { total: 10000, totalCapped: true });
  assert.deepEqual(await countCapped(fn("3"), "FROM x", [], 2), { total: 2, totalCapped: true });
  assert.match(seen.at(-1)!.sql, /LIMIT 3\) t$/);
  // pg client shape ({query -> {rows}}) and an empty result
  const client = { query: async () => ({ rows: [{ n: 4 }] }) };
  assert.deepEqual(await countCapped(client, "FROM x", []), { total: 4, totalCapped: false });
  assert.deepEqual(await countCapped(async () => [], "FROM x", []), { total: 0, totalCapped: false });
  for (const cap of [0, -1, 1.5, 2_000_000, Number.NaN]) await assert.rejects(countCapped(fn("1"), "FROM x", [], cap), /invalid cap/);
});

/* ------------------------------ parseDateRange ------------------------------ */

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01 17:00 Tashkent

test("parseDateRange: Tashkent midnight boundaries (UTC+5)", () => {
  const r = parseDateRange("2026-03-10", "2026-03-10", { nowMs: NOW });
  assert.equal(r.fromTs, "2026-03-09T19:00:00.000Z");
  assert.equal(r.toTsExclusive, "2026-03-10T19:00:00.000Z");
  assert.equal(r.days, 1);
  assert.equal(r.fromDay, "2026-03-10");
  assert.equal(r.toDay, "2026-03-10");
  // an instant at 23:59:59 Tashkent on the `to` day is inside, 00:00 the next day is outside
  const inside = Date.parse("2026-03-10T18:59:59.999Z");
  const outside = Date.parse("2026-03-10T19:00:00.000Z");
  assert.ok(inside >= Date.parse(r.fromTs) && inside < Date.parse(r.toTsExclusive));
  assert.ok(!(outside < Date.parse(r.toTsExclusive)));
  // the instant just before Tashkent midnight on the `from` day is outside
  assert.ok(Date.parse("2026-03-09T18:59:59.999Z") < Date.parse(r.fromTs));
});

test("parseDateRange: leap day, year ends, month ends", () => {
  assert.equal(parseDateRange("2028-02-29", "2028-02-29", { nowMs: NOW }).toTsExclusive, "2028-02-29T19:00:00.000Z");
  assert.equal(parseDateRange("2028-02-28", "2028-03-01", { nowMs: NOW }).days, 3);
  assert.equal(parseDateRange("2027-02-28", "2027-03-01", { nowMs: NOW }).days, 2);
  assert.equal(parseDateRange("2025-12-31", "2026-01-01", { nowMs: NOW }).fromTs, "2025-12-30T19:00:00.000Z");
  assert.throws(() => parseDateRange("2027-02-29", "2027-03-01", { nowMs: NOW }), is400);
  assert.throws(() => parseDateRange("2026-04-31", "2026-05-01", { nowMs: NOW }), is400);
});

test("parseDateRange: 366-day cap is inclusive of both ends", () => {
  assert.equal(parseDateRange("2026-01-01", "2026-12-31", { nowMs: NOW }).days, 365);
  assert.equal(parseDateRange("2028-01-01", "2028-12-31", { nowMs: NOW }).days, 366, "leap year = exactly the cap");
  assert.equal(parseDateRange("2027-01-01", "2028-01-01", { nowMs: NOW }).days, 366);
  assert.throws(() => parseDateRange("2027-01-01", "2028-01-02", { nowMs: NOW }), is400, "367 days");
  assert.throws(() => parseDateRange("2028-01-01", "2029-01-01", { nowMs: NOW }), is400, "367 days");
  assert.equal(parseDateRange("2026-01-01", "2026-01-10", { nowMs: NOW, maxDays: 10 }).days, 10);
  assert.throws(() => parseDateRange("2026-01-01", "2026-01-11", { nowMs: NOW, maxDays: 10 }), is400);
});

test("parseDateRange: validation errors are 400", () => {
  const bad: Array<[string, string]> = [
    ["2026-1-1", "2026-01-02"],
    ["2026-01-01", "2026/01/02"],
    ["26-01-01", "2026-01-02"],
    ["2026-01-01T00:00:00Z", "2026-01-02"],
    ["2026-01-01 ", "2026-01-02"],
    ["2026-01-01", "2026-01-02; DROP TABLE users"],
    ["2026-13-01", "2026-12-01"],
    ["2026-00-10", "2026-12-01"],
    ["2026-01-00", "2026-12-01"],
    ["1999-12-31", "2000-01-02"],
    ["2026-01-01", "2101-01-01"],
    ["٢٠٢٦-٠١-٠١", "2026-01-02"],
    ["2026-01-05", "2026-01-04"], // to before from
  ];
  for (const [f, t] of bad) assert.throws(() => parseDateRange(f, t, { nowMs: NOW }), is400, `${f}..${t}`);
});

test("parseDateRange: missing bounds", () => {
  // neither: the last defaultDays days ending today (Tashkent today = 2026-10-01)
  const d = parseDateRange(null, null, { nowMs: NOW, defaultDays: 7 });
  assert.equal(d.toDay, "2026-10-01");
  assert.equal(d.fromDay, "2026-09-25");
  assert.equal(d.days, 7);
  assert.equal(parseDateRange(undefined, "", { nowMs: NOW }).days, 30);
  // only from: up to today
  const f = parseDateRange("2026-09-20", null, { nowMs: NOW });
  assert.equal(f.toDay, "2026-10-01");
  assert.equal(f.days, 12);
  // only from, in the future: just that day
  assert.equal(parseDateRange("2026-12-01", null, { nowMs: NOW }).days, 1);
  // only to: defaultDays ending at `to`
  const t = parseDateRange(null, "2026-03-31", { nowMs: NOW, defaultDays: 31 });
  assert.equal(t.fromDay, "2026-03-01");
  assert.equal(t.days, 31);
  // an old `from` without `to` exceeds the cap
  assert.throws(() => parseDateRange("2020-01-01", null, { nowMs: NOW }), is400);
});

test("parseDateRange: 'today' follows Tashkent, not UTC", () => {
  // 2026-09-30 20:00 UTC is already 2026-10-01 01:00 in Tashkent
  const r = parseDateRange(null, null, { nowMs: Date.UTC(2026, 8, 30, 20, 0, 0), defaultDays: 1 });
  assert.equal(r.toDay, "2026-10-01");
  // 2026-09-30 18:59 UTC is still 2026-09-30 23:59 in Tashkent
  const r2 = parseDateRange(null, null, { nowMs: Date.UTC(2026, 8, 30, 18, 59, 59), defaultDays: 1 });
  assert.equal(r2.toDay, "2026-09-30");
});

/* ------------------------------ classifyUserQuery --------------------------- */

test("classifyUserQuery: id / numeric / phone / username / name", () => {
  assert.deepEqual(classifyUserQuery("#123"), { kind: "id", value: "123" });
  assert.deepEqual(classifyUserQuery("  #007 "), { kind: "id", value: "7" });
  assert.deepEqual(classifyUserQuery("123"), { kind: "numeric", value: "123" });
  assert.deepEqual(classifyUserQuery("123456789012345678"), { kind: "numeric", value: "123456789012345678" });
  assert.deepEqual(classifyUserQuery("9223372036854775807"), { kind: "numeric", value: "9223372036854775807" });
  assert.deepEqual(classifyUserQuery("+998 90 123-45-67"), { kind: "phone", value: "998901234567" });
  assert.deepEqual(classifyUserQuery("+998901234567"), { kind: "phone", value: "998901234567" });
  assert.deepEqual(classifyUserQuery("(90) 123-45-67"), { kind: "phone", value: "901234567" }, ">= 9 digits with separators");
  assert.deepEqual(classifyUserQuery("90 123 45 67"), { kind: "phone", value: "901234567" });
  assert.deepEqual(classifyUserQuery("+7"), { kind: "phone", value: "7" });
  assert.deepEqual(classifyUserQuery("@Ali_Valiyev"), { kind: "username", value: "ali_valiyev" });
  assert.deepEqual(classifyUserQuery("@ ali"), { kind: "username", value: "ali" });
  assert.deepEqual(classifyUserQuery("  Zulfiya Karimova "), { kind: "name", value: "zulfiya karimova" });
  assert.deepEqual(classifyUserQuery("ЗУЛЬФИЯ"), { kind: "name", value: "зульфия" });
});

test("classifyUserQuery: ambiguous and hostile input", () => {
  assert.equal(classifyUserQuery(""), null);
  assert.equal(classifyUserQuery("   "), null);
  assert.equal(classifyUserQuery("@"), null);
  assert.equal(classifyUserQuery("@   "), null);
  assert.equal(classifyUserQuery("\0"), null);
  // 20 digits: beyond 19 -> not an id/telegram id; still >= 9 digits -> phone
  assert.equal(classifyUserQuery("12345678901234567890")?.kind, "phone");
  // 19 digits above int64 max would overflow `$1::bigint` -> must not be `numeric`
  assert.equal(classifyUserQuery("9999999999999999999")?.kind, "phone");
  assert.equal(classifyUserQuery("#9999999999999999999")?.kind, "name");
  assert.equal(classifyUserQuery("#12345678901234567890")?.kind, "name");
  assert.deepEqual(classifyUserQuery("#abc"), { kind: "name", value: "#abc" });
  assert.deepEqual(classifyUserQuery("# 12"), { kind: "name", value: "# 12" });
  // letters mixed with digits are a name, even with 9+ digits
  assert.deepEqual(classifyUserQuery("ali 1234567890"), { kind: "name", value: "ali 1234567890" });
  assert.deepEqual(classifyUserQuery("+998abc"), { kind: "name", value: "+998abc" });
  assert.deepEqual(classifyUserQuery("12.5"), { kind: "name", value: "12.5" });
  // NUL is stripped (Postgres text cannot hold it)
  assert.deepEqual(classifyUserQuery("al\0i"), { kind: "name", value: "ali" });
  // SQL text stays a plain name; safety comes from `$n` + escapeLike
  assert.deepEqual(classifyUserQuery("' OR 1=1 --"), { kind: "name", value: "' or 1=1 --" });
  // length caps
  assert.equal((classifyUserQuery("a".repeat(500)) as { value: string }).value.length, 120);
  assert.equal((classifyUserQuery(`@${"b".repeat(500)}`) as { value: string }).value.length, 64);
  assert.ok((classifyUserQuery(`+${"9".repeat(500)}`) as { value: string }).value.length <= 32);
  // clipping counts code points, never splits a surrogate pair
  const emoji = (classifyUserQuery("😀".repeat(200)) as { value: string }).value;
  assert.equal(Array.from(emoji).length, 120);
  assert.doesNotMatch(emoji, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test("escapeLike / likePrefix", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
  assert.equal(escapeLike("plain"), "plain");
  assert.equal(escapeLike(""), "");
  assert.equal(escapeLike("%%__\\\\"), "\\%\\%\\_\\_\\\\\\\\");
  assert.equal(likePrefix("a_b%"), "a\\_b\\%%");
  // metacharacters inside a classified query stay literal
  assert.equal(likePrefix((classifyUserQuery("100%_user") as { value: string }).value), "100\\%\\_user%");
});

/* ------------------------- real Postgres: keyset paging ---------------------- */

test("keyset against Postgres: every sort/direction pages without gaps or repeats", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async () => {
  const db = dbm!;
  await db.query("DROP TABLE IF EXISTS kt");
  await db.query(`CREATE TABLE kt (
    uid uuid PRIMARY KEY, bid bigserial UNIQUE, grp text NOT NULL,
    ts timestamptz NOT NULL, n bigint, seen timestamptz, label text NOT NULL)`);
  // Few distinct sort values on purpose: lots of ties force the id tie-break to do the work.
  // Timestamps differ at MICROSECOND level inside the same millisecond.
  const stamps = [
    "2026-09-23 04:12:00.123456+00",
    "2026-09-23 04:12:00.123457+00",
    "2026-09-23 04:12:00.123499+00",
    "2026-09-23 04:12:00.124000+00",
    "2026-09-22 23:59:59.999999+00",
  ];
  const labels = ["Ali", "Ali", "ali", "Ibrohim", "a_b", "a%b", "Zafar", "Álvaro", "", "Ali"];
  const rows: unknown[][] = [];
  for (let i = 0; i < 53; i++) {
    const uid = `00000000-0000-4000-8000-${String(i * 7919 % 100000).padStart(12, "0")}`;
    const n = i % 6 === 0 ? null : (i % 4) - 1; // includes negatives, ties and NULLs
    const seen = i % 5 === 0 ? null : stamps[i % stamps.length];
    rows.push([uid, i % 2 === 0 ? "a" : "b", stamps[(i * 3) % stamps.length], n, seen, labels[i % labels.length]]);
  }
  for (const r of rows) await db.query("INSERT INTO kt(uid, grp, ts, n, seen, label) VALUES ($1,$2,$3,$4,$5,$6)", r);

  const cases: Array<{ name: string; sort: SortDef; id: IdDef }> = [];
  const uuidId: IdDef = { column: "kt.uid", type: "uuid" };
  const bigId: IdDef = { column: "kt.bid", type: "bigint" };
  const sorts: Array<[string, SortDef]> = [
    ["ts desc", { column: "kt.ts", dir: "DESC", type: "timestamptz" }],
    ["ts asc", { column: "kt.ts", dir: "ASC", type: "timestamptz" }],
    ["n desc (nullable bigint)", { column: "kt.n", dir: "DESC", type: "bigint", nullable: true }],
    ["n asc (nullable bigint)", { column: "kt.n", dir: "ASC", type: "bigint", nullable: true }],
    ["seen desc (nullable ts)", { column: "kt.seen", dir: "DESC", type: "timestamptz", nullable: true }],
    ["seen asc (nullable ts)", { column: "kt.seen", dir: "ASC", type: "timestamptz", nullable: true }],
    ["label asc (text)", { column: "kt.label", dir: "ASC", type: "text" }],
    ["label desc (text)", { column: "kt.label", dir: "DESC", type: "text" }],
  ];
  for (const [name, sort] of sorts) for (const [idn, id] of [["uuid", uuidId], ["bigint", bigId]] as const) cases.push({ name: `${name} / ${idn} id`, sort, id });

  for (const { name, sort, id } of cases) {
    // The oracle: one unpaged query with the same ORDER BY.
    const ks0 = buildKeyset({ sort, cursor: null, id });
    const oracle = (await db.query<{ cursor_id: string }>(`SELECT ${keysetSelect(sort, id)} FROM kt WHERE grp = $1 AND ${ks0.where} ORDER BY ${ks0.orderBy}`, ["a"])).map((r) => r.cursor_id);
    assert.ok(oracle.length > 20, name);

    for (const limit of [1, 3, 7, 100]) {
      const got: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const parsed: ParsedList<ListSpec> = parseListParams(u(`?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`), {
          sorts: { s: sort },
          id,
        });
        const base: unknown[] = ["a"]; // the caller's own `$1`
        const ks = buildKeyset({ sort, cursor: parsed.cursor, id, paramOffset: base.length });
        const params: unknown[] = [...base, ...ks.params, parsed.limit + 1];
        const found: Array<{ cursor_v: string | null; cursor_id: string }> = await db.query<{ cursor_v: string | null; cursor_id: string }>(
          `SELECT ${keysetSelect(sort, id)} FROM kt WHERE grp = $1 AND ${ks.where} ORDER BY ${ks.orderBy} LIMIT $${params.length}`,
          params,
        );
        const page: ReturnType<typeof pageResult> = pageResult(found, parsed.limit, sort);
        got.push(...found.slice(0, parsed.limit).map((r) => r.cursor_id));
        assert.ok(page.items.every((it) => !("cursor_v" in it) && !("cursor_id" in it)));
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      assert.deepEqual(got, oracle, `${name}, limit ${limit}`);
      assert.equal(new Set(got).size, got.length, `${name}: no repeats`);
    }
  }

  // The timestamp cursor keeps microseconds (a millisecond-only cursor would skip/repeat rows here).
  const sortTs: SortDef = { column: "kt.ts", dir: "DESC", type: "timestamptz" };
  const first = await db.query<{ cursor_v: string }>(
    `SELECT ${keysetSelect(sortTs, uuidId)} FROM kt WHERE ts < '2026-09-23 04:12:00.124+00' ORDER BY kt.ts DESC, kt.uid DESC LIMIT 1`,
  );
  assert.equal(first[0]!.cursor_v, "2026-09-23T04:12:00.123499");

  // countCapped against the real table, with and without a cap hit.
  assert.deepEqual(await countCapped(db.query, "FROM kt WHERE grp = $1", ["a"]), { total: 27, totalCapped: false });
  assert.deepEqual(await countCapped(db.query, "FROM kt", [], 10), { total: 10, totalCapped: true });
  assert.deepEqual(await countCapped(db.query, "FROM kt WHERE grp = $1", ["none"]), { total: 0, totalCapped: false });
});

test("LIKE escaping against Postgres: metacharacters match literally", { skip: hasDb ? false : "DATABASE_URL yo'q" }, async () => {
  const db = dbm!;
  await db.query("DROP TABLE IF EXISTS names");
  await db.query("CREATE TABLE names (name text)");
  for (const n of ["a_b", "axb", "a%b", "aab", "a\\b", "100%", "1000"]) await db.query("INSERT INTO names VALUES ($1)", [n]);
  const find = async (q: string): Promise<string[]> => {
    const c = classifyUserQuery(q) as { value: string };
    const r = await db.query<{ name: string }>("SELECT name FROM names WHERE lower(name) LIKE $1 ESCAPE '\\' ORDER BY name", [likePrefix(c.value)]);
    return r.map((x) => x.name);
  };
  assert.deepEqual(await find("a_b"), ["a_b"], "_ is literal");
  assert.deepEqual(await find("a%"), ["a%b"], "% is literal");
  assert.deepEqual(await find("a\\"), ["a\\b"], "backslash is literal");
  assert.deepEqual(await find("100%"), ["100%"]);
  assert.deepEqual(await find("zzz%"), []);
});
