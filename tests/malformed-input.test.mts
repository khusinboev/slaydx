import test from "node:test";
import assert from "node:assert/strict";

/**
 * Noto'g'ri, lekin «ishonarli» kirish 500 emas, 4xx beradi (BEA-13).
 *
 *   • `readJson` — `null`, massiv, son, satr tanasi. Ilgari `JSON.parse("null")`
 *     `null` qaytarar, route `body.slug` da `TypeError` bilan 500 «Ichki
 *     xatolik» berardi (va har so'rovda xato jurnali). Endi 400.
 *   • `parseIntParam` — Postgres `int4` dan katta son (`?since=3000000000`
 *     → `$3::int` 22003 → 500) va butun bo'lmagan qiymat `null` beradi.
 *   • `parseIsoInstant` — `2026-02-30T…Z` kabi mavjud bo'lmagan sana
 *     (`::timestamptz` 22008 → 500) `null` beradi; JS `Date` uni jimgina
 *     2-martga surardi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { ApiError, readJson } = await import("../lib/server/api.ts");
const { PG_INT4_MAX, parseIntParam, parseIsoInstant } = await import("../lib/server/validate.ts");

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://x/api/test", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    assert.ok(e instanceof ApiError, `ApiError kutilgan edi: ${e}`);
    return (e as InstanceType<typeof ApiError>).status;
  }
}

test("readJson: obyekt bo'lmagan JSON tana — 400 (500 emas)", async () => {
  for (const body of ["null", "[]", "[1,2]", "5", '"salom"', "true"]) {
    assert.equal(await status(readJson(req(body))), 400, `MUTATSIYA: «${body}» tanasi o'tib ketdi`);
  }
});

test("readJson: oddiy obyekt o'tadi; buzuq JSON 400; katta tana 413", async () => {
  assert.deepEqual(await readJson(req('{"a":1}')), { a: 1 });
  assert.deepEqual(await readJson(req("{}")), {});
  assert.equal(await status(readJson(req("{bad"))), 400);
  assert.equal(await status(readJson(req('{"a":"' + "x".repeat(100) + '"}'), 50)), 413);
  assert.equal(await status(readJson(req("{}", { "content-length": "999999999" }), 1000)), 413);
});

test("parseIntParam: int4 dan katta, butun bo'lmagan va yaroqsiz qiymat — null", () => {
  assert.equal(parseIntParam("3000000000"), null, "MUTATSIYA: int4 dan katta son o'tdi");
  assert.equal(parseIntParam(String(PG_INT4_MAX + 1)), null);
  assert.equal(parseIntParam(String(PG_INT4_MAX)), PG_INT4_MAX);
  assert.equal(parseIntParam("12"), 12);
  assert.equal(parseIntParam(" 12 "), 12);
  assert.equal(parseIntParam(7), 7);
  for (const bad of ["", " ", "1.5", "1e3", "0x10", "abc", "12abc", "-1", "Infinity", "NaN", null, undefined, 1.5, Infinity, {}]) {
    assert.equal(parseIntParam(bad as never), null, `«${String(bad)}» yaroqsiz`);
  }
  assert.equal(parseIntParam("-5", { min: -10, max: 10 }), -5);
  assert.equal(parseIntParam("11", { min: 0, max: 10 }), null);
  assert.equal(parseIntParam("99999999999999999999999"), null);
});

test("parseIsoInstant: faqat haqiqiy UTC vaqt; mikrosoniya saqlanadi", () => {
  assert.equal(parseIsoInstant("2026-09-23T04:12:00.123456Z"), "2026-09-23T04:12:00.123456Z");
  assert.equal(parseIsoInstant("2026-09-23T04:12:00Z"), "2026-09-23T04:12:00Z");
  for (const bad of ["2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-02-28T24:00:00Z", "2026-02-28T23:59:60Z", "2026-02-28", "2026-02-28T10:00:00+05:00", "", null, 5]) {
    assert.equal(parseIsoInstant(bad as never), null, `MUTATSIYA: «${String(bad)}» o'tdi`);
  }
});
