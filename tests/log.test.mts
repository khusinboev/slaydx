import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * TUZILMALI JURNAL (AUDIT prod-readiness C31: OBS-02, OBS-03, EXT-12).
 *
 * `lib/server/log.ts` — pul/navbat yo'llarining yagona jurnal nuqtasi:
 *   • har chaqiruv AYNAN bitta JSON qator (`ts, level, msg, reqId?, jobId?,
 *     userId?, genId?, provider?, err?{message, stack}`);
 *   • hech qachon xato tashlamaydi (aylanma obyekt, BigInt, getter xatosi);
 *   • aniq sirlarni yashiradi: URL dagi `?key=`, `Authorization`/`Bearer`,
 *     Google/Anthropic/xAI kalit shakllari, telefon raqami → oxirgi 2 raqam;
 *   • `withLogContext` ichidagi har qator `reqId`/`jobId` ni o'zi oladi.
 *
 * Bazasiz, provayder chaqiruvisiz.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";

const { log, withLogContext, addLogContext, redact } = await import("../lib/server/log.ts");

/** `console.*` ga yozilgan qatorlarni yig'adi. */
function capture(t: TestContext): string[] {
  const lines: string[] = [];
  const push = (...a: unknown[]) => {
    lines.push(a.map(String).join(" "));
  };
  t.mock.method(console, "log", push);
  t.mock.method(console, "info", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return lines;
}

const GOOGLE_KEY = "AIzaSyD" + "x".repeat(32);

test("log(): bitta JSON qator — shartnoma maydonlari va err{message, stack}", (t) => {
  const lines = capture(t);
  const err = new Error("ulanish uzildi");
  log("error", "[worker] ish yiqildi", { jobId: "job-1", userId: "42", genId: "job-1", provider: "gemini", attempt: 2, err });
  assert.equal(lines.length, 1, "aynan bitta qator");
  assert.ok(!lines[0].includes("\n"), "qator ichida yangi qator bo'lmasin (grep/jq uchun)");
  const row = JSON.parse(lines[0]);
  assert.equal(row.level, "error");
  assert.equal(row.msg, "[worker] ish yiqildi");
  assert.ok(!Number.isNaN(Date.parse(row.ts)), "ts ISO vaqt");
  assert.equal(row.jobId, "job-1");
  assert.equal(row.userId, "42");
  assert.equal(row.genId, "job-1");
  assert.equal(row.provider, "gemini");
  assert.equal(row.attempt, 2);
  assert.equal(row.err.message, "ulanish uzildi");
  // MUTATSIYA: `stack` maydoni tashlab yuborilsa (OBS-03) — shu qator qizaradi.
  assert.match(String(row.err.stack), /log\.test\.mts/, "stack saqlanishi kerak");
});

test("log(): darajalar to'g'ri kanalga — error/warn stderr, info stdout", (t) => {
  const seen: string[] = [];
  t.mock.method(console, "log", () => seen.push("log"));
  t.mock.method(console, "info", () => seen.push("info"));
  t.mock.method(console, "warn", () => seen.push("warn"));
  t.mock.method(console, "error", () => seen.push("error"));
  log("info", "a");
  log("warn", "b");
  log("error", "c");
  assert.deepEqual(seen, ["log", "warn", "error"]);
});

test("log(): URL dagi kalit, Bearer token, Authorization maydoni va telefon yashiriladi", (t) => {
  const lines = capture(t);
  log("warn", `so'rov yiqildi: https://api.openalex.org/works?search=x&api_key=SECRETQ1&key=${GOOGLE_KEY}`, {
    err: new Error(`403 Permission denied: Consumer 'api_key:${GOOGLE_KEY}' has been suspended. Authorization: Bearer abc.def.ghi`),
    authorization: "Basic UGF5Y29tOnNlY3JldA==",
    headers: { Authorization: "Bearer zzz-top-secret" },
    phone: "+998 90 123 45 67",
    note: "mijoz 998901234567 dan yozdi, kalit sk-ant-api03-abcdefghijklmnop va xai-ABCDEFGHIJKLMNOP",
    jobId: "550e8400-e29b-41d4-a716-446655440000",
  });
  assert.equal(lines.length, 1);
  const out = lines[0];
  for (const secret of [GOOGLE_KEY, "SECRETQ1", "abc.def.ghi", "UGF5Y29tOnNlY3JldA==", "zzz-top-secret", "sk-ant-api03-abcdefghijklmnop", "xai-ABCDEFGHIJKLMNOP"]) {
    // MUTATSIYA: tegishli redaksiya qoidasi o'chirilsa — shu sir qatorda qoladi.
    assert.ok(!out.includes(secret), `sir jurnalga tushdi: ${secret}`);
  }
  // Telefon: faqat oxirgi 2 raqam.
  assert.ok(!out.includes("123 45 67") && !out.includes("901234567"), "telefon to'liq yozildi");
  const row = JSON.parse(out);
  assert.equal(row.phone, "***67");
  assert.match(row.note, /\*\*\*67/);
  // UUID raqamlari telefon deb buzilmasin — ish izi aynan shu id bo'yicha qidiriladi.
  assert.equal(row.jobId, "550e8400-e29b-41d4-a716-446655440000");
  // Kontekst saqlanadi: nima yiqilgani hali ham o'qiladi.
  assert.match(row.err.message, /403 Permission denied/);
  assert.match(row.msg, /api\.openalex\.org\/works\?search=x/);
});

test("redact(): oddiy matn va raqamlar buzilmaydi", () => {
  assert.equal(redact("Ish vaqti tugadi (660 s), perform_time 1727000000000"), "Ish vaqti tugadi (660 s), perform_time 1727000000000");
  assert.equal(redact("buyurtma 3f2c9a1e-0000-4000-8000-000000000001"), "buyurtma 3f2c9a1e-0000-4000-8000-000000000001");
});

test("log(): HECH QACHON xato tashlamaydi — aylanma obyekt, BigInt, getter xatosi", (t) => {
  const lines = capture(t);
  const circ: Record<string, unknown> = { a: 1 };
  circ.self = circ;
  const bad = {
    get boom() {
      throw new Error("getter");
    },
  };
  assert.doesNotThrow(() => log("error", "x", { circ, big: 10n, bad, err: circ }));
  assert.doesNotThrow(() => log("error", "y", undefined));
  assert.doesNotThrow(() => log("error", undefined as unknown as string, null as never));
  assert.equal(lines.length, 3);
  for (const l of lines) assert.doesNotThrow(() => JSON.parse(l));
});

test("withLogContext: ichki chaqiruvlar reqId/userId ni o'zi oladi; tashqarida yo'q", async (t) => {
  const lines = capture(t);
  await withLogContext({ reqId: "req-abc12345" }, async () => {
    await new Promise((r) => setTimeout(r, 1));
    addLogContext({ userId: "7" });
    log("info", "ichkarida", { genId: "g1" });
  });
  log("info", "tashqarida");
  const [inner, outer] = lines.map((l) => JSON.parse(l));
  // MUTATSIYA: `log` kontekstni o'qimasa — reqId yo'qoladi.
  assert.equal(inner.reqId, "req-abc12345");
  assert.equal(inner.userId, "7");
  assert.equal(inner.genId, "g1");
  assert.equal(outer.reqId, undefined);
  assert.equal(outer.userId, undefined);
});
