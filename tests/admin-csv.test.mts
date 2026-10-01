import test from "node:test";
import assert from "node:assert/strict";
import { CSV_MAX_ROWS, capNoticeLine, csvCell, csvLine, csvResponse, flattenBatches, keysetBatches, safeFilename, tashkentStamp } from "../lib/server/admin-csv.ts";

/**
 * `lib/server/admin-csv.ts` — streaming CSV export (plan §6.0 "Exports", T11).
 * No database needed: rows come from fake async generators.
 */

async function* gen<T>(items: T[], onPull?: (i: number) => void): AsyncGenerator<T> {
  for (let i = 0; i < items.length; i++) {
    onPull?.(i);
    yield items[i]!;
  }
}

const BOM = "﻿";

/** `Response.text()` silently drops a leading BOM; decode with `ignoreBOM` so the test can see it. */
async function bodyOf(res: Response): Promise<string> {
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
}

/* ---------------------------------- cells ---------------------------------- */

test("csvCell: plain values are always quoted", () => {
  assert.equal(csvCell("abc"), '"abc"');
  assert.equal(csvCell(""), '""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');
  assert.equal(csvCell(42), '"42"');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvCell(BigInt("12345678901234567890")), '"12345678901234567890"');
  assert.equal(csvCell(true), '"true"');
  assert.equal(csvCell(false), '"false"');
  assert.equal(csvCell("O'zbekiston"), `"O'zbekiston"`);
  assert.equal(csvCell("Zulfiya, Karimova"), '"Zulfiya, Karimova"');
});

test("csvCell: formula injection is neutralised for = + - @ TAB CR", () => {
  for (const s of ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=1", "\r=1", '=HYPERLINK("http://evil","x")', "=cmd|' /C calc'!A0", "-2+3+cmd|' /C calc'!A0", "@A1"]) {
    const out = csvCell(s);
    assert.ok(out.startsWith(`"'`), `${JSON.stringify(s)} -> ${out}`);
  }
  assert.equal(csvCell("=1+1"), `"'=1+1"`);
  // not a trigger character at position 0 -> untouched
  assert.equal(csvCell("a=1"), '"a=1"');
  assert.equal(csvCell(" =1"), '" =1"');
  assert.equal(csvCell("1-2"), '"1-2"');
  assert.equal(csvCell("#hash"), '"#hash"');
});

test("csvCell: real numbers are not mangled, numeric-looking strings are protected", () => {
  assert.equal(csvCell(-5), '"-5"', "a negative balance stays numeric");
  assert.equal(csvCell(BigInt("-12345678901234567890")), '"-12345678901234567890"');
  assert.equal(csvCell("-5"), `"'-5"`, "a STRING starting with '-' is treated as untrusted");
  assert.equal(csvCell(Number.NEGATIVE_INFINITY), `"'-Infinity"`);
});

test("csvCell: quotes are doubled, newlines stay inside the quotes", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('"'), '""""');
  assert.equal(csvCell("a\nb"), '"a\nb"');
  assert.equal(csvCell("a\r\nb"), '"a\r\nb"');
  assert.equal(csvCell('=A1"&"x'), `"'=A1""&""x"`);
  assert.equal(csvCell("a\u0000b"), '"ab"', "NUL dropped");
});

test("csvCell: Date -> Tashkent DD.MM.YYYY HH:mm", () => {
  assert.equal(csvCell(new Date("2026-09-23T04:12:00.000Z")), '"23.09.2026 09:12"');
  // UTC evening rolls into the next Tashkent day
  assert.equal(csvCell(new Date("2026-12-31T19:00:00.000Z")), '"01.01.2027 00:00"');
  assert.equal(csvCell(new Date("2026-12-31T18:59:59.999Z")), '"31.12.2026 23:59"');
  assert.equal(csvCell(new Date("2028-02-28T19:30:00.000Z")), '"29.02.2028 00:30"', "leap day");
  assert.equal(csvCell(new Date("2026-03-10T00:00:00.000Z")), '"10.03.2026 05:00"');
  assert.equal(csvCell(new Date(Number.NaN)), '""', "invalid date -> empty, never throws");
  assert.equal(tashkentStamp(new Date("2026-01-01T00:00:00Z")), "01.01.2026 05:00");
});

test("csvCell: objects become JSON text (and are injection-checked)", () => {
  assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
  assert.equal(csvCell([1, "x"]), '"[1,""x""]"');
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  assert.equal(csvCell(cyc), '""', "unserialisable value does not break the export");
  assert.equal(csvCell(() => 1), '""');
});

test("csvLine: CRLF terminated", () => {
  assert.equal(csvLine(["a", 1, null]), '"a","1",""\r\n');
});

/* -------------------------------- filenames --------------------------------- */

test("safeFilename: ASCII only, no header injection", () => {
  assert.equal(safeFilename("users-2026-09-23.csv"), "users-2026-09-23.csv");
  assert.equal(safeFilename("users"), "users.csv");
  assert.equal(safeFilename("USERS.CSV"), "USERS.csv");
  assert.equal(safeFilename('a"b\r\nSet-Cookie: x=1.csv'), "a_b_Set-Cookie_x_1.csv");
  assert.equal(safeFilename("../../etc/passwd"), "etc_passwd.csv");
  assert.equal(safeFilename("foydalanuvchilar — ro'yxat"), "foydalanuvchilar_ro_yxat.csv");
  assert.equal(safeFilename("тест"), "export.csv");
  assert.equal(safeFilename(""), "export.csv");
  assert.equal(safeFilename("...."), "export.csv");
  assert.ok(safeFilename("a".repeat(500)).length <= 104);
  for (const f of ['x";y', "x\ny", "x\\y", "x/y", "x;y", "é"]) assert.match(safeFilename(f), /^[A-Za-z0-9._-]+$/, f);
});

/* --------------------------------- response --------------------------------- */

test("csvResponse: headers, BOM, header row, rows", async () => {
  const res = csvResponse({ filename: "users 2026.csv", header: ["ID", "Ism", "Sana"], rows: gen([[1, "Ali", new Date("2026-09-23T04:12:00Z")], [2, "=evil()", null]]) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="users_2026.csv"');
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const body = await bodyOf(res);
  assert.ok(body.startsWith(BOM), "BOM first");
  assert.equal(body.indexOf(BOM, 1), -1, "exactly one BOM");
  assert.equal(body, `${BOM}"ID","Ism","Sana"\r\n"1","Ali","23.09.2026 09:12"\r\n"2","'=evil()",""\r\n`);
});

test("csvResponse: raw bytes begin with the UTF-8 BOM EF BB BF", async () => {
  const res = csvResponse({ filename: "x", header: ["a"], rows: gen([]) });
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("csvResponse: header names are injection-guarded too; extra headers cannot override security headers", async () => {
  const res = csvResponse({
    filename: "x.csv",
    header: ["=bad", "ok"],
    rows: gen([]),
    headers: { "X-Request-Id": "r1", "Cache-Control": "public", "Content-Type": "text/html", "Content-Disposition": "inline" },
  });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="x.csv"');
  assert.equal(res.headers.get("x-request-id"), "r1");
  assert.equal(await bodyOf(res), `${BOM}"'=bad","ok"\r\n`);
});

test("csvResponse: empty export still carries BOM + header", async () => {
  assert.equal(await bodyOf(csvResponse({ filename: "x", header: ["a", "b"], rows: gen([]) })), `${BOM}"a","b"\r\n`);
});

test("csvResponse: multiline cell survives a round trip through a CSV parser", async () => {
  const res = csvResponse({ filename: "x", header: ["t"], rows: gen([['line1\nline2 "q"']]) });
  const body = (await bodyOf(res)).slice(1);
  assert.equal(body, '"t"\r\n"line1\nline2 ""q"""\r\n');
});

test("csvResponse: caps at maxRows and appends an Uzbek notice only when rows were dropped", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => [i]);
  const capped = await bodyOf(csvResponse({ filename: "x", header: ["n"], rows: gen(rows), maxRows: 4 }));
  const lines = capped.slice(1).split("\r\n");
  assert.equal(lines.length, 1 + 4 + 1 + 1, "header + 4 rows + notice + trailing empty");
  assert.equal(lines[4], '"3"');
  assert.equal(lines[5], capNoticeLine(4).trimEnd());
  assert.match(lines[5]!, /^"#CHEKLOV: eksport 4 qatorga cheklangan/);
  assert.doesNotMatch(capped, /"4"\r\n/, "row 5 is not emitted");

  // exactly maxRows -> no notice
  const exact = await bodyOf(csvResponse({ filename: "x", header: ["n"], rows: gen(rows.slice(0, 4)), maxRows: 4 }));
  assert.doesNotMatch(exact, /CHEKLOV/);
  assert.equal(exact.split("\r\n").length, 1 + 4 + 1);
  // fewer than maxRows -> no notice
  assert.doesNotMatch(await bodyOf(csvResponse({ filename: "x", header: ["n"], rows: gen(rows.slice(0, 2)), maxRows: 4 })), /CHEKLOV/);
});

test("csvResponse: the default cap is 100 000 rows and the notice mentions it", async () => {
  assert.equal(CSV_MAX_ROWS, 100_000);
  assert.match(capNoticeLine(CSV_MAX_ROWS), /100 000 qatorga/);
  let pulled = 0;
  async function* endless(): AsyncGenerator<unknown[]> {
    for (;;) {
      pulled++;
      yield [pulled];
    }
  }
  const res = csvResponse({ filename: "x", header: ["n"], rows: endless() });
  const text = await bodyOf(res);
  const lines = text.slice(1).split("\r\n");
  assert.equal(lines.length, 1 + CSV_MAX_ROWS + 1 + 1);
  assert.match(lines[CSV_MAX_ROWS + 1]!, /^"#CHEKLOV/);
  assert.equal(pulled, CSV_MAX_ROWS + 1, "reads exactly one row beyond the cap to detect truncation, then stops");
});

test("csvResponse: pull-based backpressure — an unread stream does not drain the source", async () => {
  let pulled = 0;
  async function* big(): AsyncGenerator<unknown[]> {
    for (let i = 0; i < 50_000; i++) {
      pulled++;
      yield [i, "x".repeat(100)];
    }
  }
  const res = csvResponse({ filename: "x", header: ["a", "b"], rows: big() });
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  // let any eager producer run
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(pulled < 5_000, `source read ${pulled} rows while only one chunk was consumed`);
  const before = pulled;
  await reader.read();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(pulled > before, "consuming more pulls more");
  await reader.cancel();
});

test("csvResponse: cancel stops and releases the source", async () => {
  let cleaned = false;
  async function* src(): AsyncGenerator<unknown[]> {
    try {
      for (let i = 0; i < 1_000_000; i++) yield [i, "y".repeat(200)];
    } finally {
      cleaned = true;
    }
  }
  const res = csvResponse({ filename: "x", header: ["a"], rows: src() });
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(cleaned, true);
});

test("csvResponse: cap releases the source (finally runs)", async () => {
  let cleaned = false;
  async function* src(): AsyncGenerator<unknown[]> {
    try {
      for (let i = 0; i < 100; i++) yield [i];
    } finally {
      cleaned = true;
    }
  }
  await bodyOf(csvResponse({ filename: "x", header: ["a"], rows: src(), maxRows: 3 }));
  assert.equal(cleaned, true);
});

test("csvResponse: a mid-stream failure appends an error row, then errors the stream", async () => {
  async function* boom(): AsyncGenerator<unknown[]> {
    yield [1];
    yield [2];
    throw new Error("db down");
  }
  const res = csvResponse({ filename: "x", header: ["n"], rows: boom() });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  let failure: unknown = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
  } catch (e) {
    failure = e;
  }
  assert.ok(failure instanceof Error, "the stream errors, so the browser marks the download as failed");
  assert.match(text, /"1"\r\n"2"\r\n/);
  assert.match(text, /#XATOLIK/);
  assert.doesNotMatch(text, /db down/, "internal error text is not leaked into the file");
});

test("csvResponse: large export is chunked, not one giant buffer", async () => {
  const rows = Array.from({ length: 5_000 }, (_, i) => [i, "z".repeat(60)]);
  const res = csvResponse({ filename: "x", header: ["a", "b"], rows: gen(rows) });
  const reader = res.body!.getReader();
  let chunks = 0;
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks++;
    bytes += value.byteLength;
    assert.ok(value.byteLength < 100 * 1024, "chunk stays bounded");
  }
  assert.ok(chunks > 3, `expected several chunks, got ${chunks}`);
  assert.ok(bytes > 5_000 * 60);
});

/* ------------------------------- keysetBatches ------------------------------ */

type Page = { items: number[]; nextCursor: string | null };

/** A fake keyset source over 0..total-1 that records the (cursor, limit) of every call. */
function source(total: number): { fetchPage: (c: string | null, l: number) => Promise<Page>; calls: Array<[string | null, number]> } {
  const calls: Array<[string | null, number]> = [];
  return {
    calls,
    fetchPage: async (cursor, limit) => {
      calls.push([cursor, limit]);
      const start = cursor === null ? 0 : Number(cursor);
      const items = Array.from({ length: Math.min(limit, total - start) }, (_, i) => start + i);
      const end = start + items.length;
      return { items, nextCursor: end < total ? String(end) : null };
    },
  };
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

test("keysetBatches: pages in batches of 1000 by default and visits everything once", async () => {
  const s = source(2_500);
  const batches = await collect(keysetBatches(s.fetchPage));
  assert.deepEqual(batches.map((b) => b.length), [1000, 1000, 500]);
  assert.deepEqual(batches.flat(), Array.from({ length: 2_500 }, (_, i) => i));
  assert.deepEqual(s.calls, [[null, 1000], ["1000", 1000], ["2000", 1000]]);
});

test("keysetBatches: lazy — no fetch until pulled", async () => {
  const s = source(10_000);
  const it = keysetBatches(s.fetchPage, 100);
  assert.equal(s.calls.length, 0);
  await it.next();
  assert.equal(s.calls.length, 1);
  await it.next();
  assert.equal(s.calls.length, 2);
  await it.return(undefined);
});

test("keysetBatches: empty source, exact multiple, custom batch", async () => {
  assert.deepEqual(await collect(keysetBatches(source(0).fetchPage, 5)), []);
  assert.deepEqual((await collect(keysetBatches(source(10).fetchPage, 5))).map((b) => b.length), [5, 5]);
  assert.deepEqual((await collect(keysetBatches(source(1).fetchPage, 5))).map((b) => b.length), [1]);
});

test("keysetBatches: maxItems shortens the last page so nothing beyond it is read", async () => {
  const s = source(10_000);
  const all = (await collect(keysetBatches(s.fetchPage, 1000, 2_500))).flat();
  assert.equal(all.length, 2_500);
  assert.deepEqual(s.calls.map((c) => c[1]), [1000, 1000, 500]);
});

test("keysetBatches: tolerates a fetcher that over-returns, rejects a stuck cursor and bad batch sizes", async () => {
  const over = await collect(keysetBatches(async () => ({ items: [1, 2, 3, 4, 5], nextCursor: null }), 3));
  assert.deepEqual(over.flat(), [1, 2, 3]);
  await assert.rejects(collect(keysetBatches(async () => ({ items: [1], nextCursor: "same" }), 1)), /cursor did not advance/);
  await assert.rejects(collect(keysetBatches(source(3).fetchPage, 0)), /batch size/);
  await assert.rejects(collect(keysetBatches(source(3).fetchPage, 1.5)), /batch size/);
});

test("keysetBatches: fetch errors propagate", async () => {
  const it = keysetBatches<number>(async () => {
    throw new Error("pool timeout");
  });
  await assert.rejects(it.next(), /pool timeout/);
});

test("keysetBatches + flattenBatches + csvResponse end to end, with the cap sentinel", async () => {
  const s = source(30);
  const rows = flattenBatches(keysetBatches(s.fetchPage, 8, 6 + 1), (n) => [n, `row ${n}`]);
  const body = await bodyOf(csvResponse({ filename: "x", header: ["n", "t"], rows, maxRows: 6 }));
  assert.match(body, /"5","row 5"\r\n/);
  assert.doesNotMatch(body, /"6","row 6"/);
  assert.match(body, /#CHEKLOV: eksport 6 qatorga/);
  assert.equal(s.calls.length, 1, "a single page of 7 rows was enough");
  assert.equal(s.calls[0]![1], 7);
});

test("flattenBatches: without a mapper yields the items themselves", async () => {
  async function* b(): AsyncGenerator<number[]> {
    yield [1, 2];
    yield [3];
  }
  assert.deepEqual(await collect(flattenBatches(b())), [1, 2, 3]);
});
