import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * SO'ROV ID SI VA SERVER XATO JURNALI (AUDIT prod-readiness C31: OBS-01,
 * OBS-02, OBS-03).
 *
 * 1. `lib/server/api.ts handler()` har so'rovga `x-request-id` beradi (yoki
 *    klient/proxy yuborgan TO'G'RI shakldagisini davom ettiradi), uni javob
 *    sarlavhasida qaytaradi va route ichidagi har `log()` qatoriga qo'shadi.
 *    Kutilmagan xato — stack bilan bitta JSON qator; foydalanuvchiga esa faqat
 *    umumiy o'zbekcha matn + `requestId` (murojaat uchun).
 * 2. `instrumentation.ts onRequestError` (Server Component/route render xatosi)
 *    — `log()` orqali, stack + digest + reqId bilan.
 *
 * Bazasiz.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { handler, ApiError } = await import("../lib/server/api.ts");
const { log } = await import("../lib/server/log.ts");
const { onRequestError } = await import("../instrumentation.ts");

function capture(t: TestContext): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const push = (...a: unknown[]) => {
    const s = a.map(String).join(" ");
    try {
      rows.push(JSON.parse(s));
    } catch {
      rows.push({ raw: s });
    }
  };
  t.mock.method(console, "log", push);
  t.mock.method(console, "warn", push);
  t.mock.method(console, "error", push);
  return rows;
}

const req = (headers: Record<string, string> = {}) => new Request("http://x/api/t", { headers });

test("handler(): javobda x-request-id, route ichidagi log() ham shu id bilan", async (t) => {
  const rows = capture(t);
  const h = handler("t/ok", async () => {
    await new Promise((r) => setTimeout(r, 1));
    log("info", "ichkarida");
    return Response.json({ ok: true });
  });
  const res = await h(req());
  const id = res.headers.get("x-request-id");
  // MUTATSIYA: sarlavha qo'yilmasa — shu qator qizaradi.
  assert.ok(id && /^[A-Za-z0-9._:-]{8,128}$/.test(id), `x-request-id yo'q: ${id}`);
  assert.equal(rows.length, 1);
  // MUTATSIYA: `withLogContext` olib tashlansa — reqId yo'qoladi.
  assert.equal(rows[0].reqId, id);
});

test("handler(): kelgan TO'G'RI x-request-id davom ettiriladi, buzuq shakl almashtiriladi", async (t) => {
  const rows = capture(t);
  const h = handler("t/prop", async () => {
    log("info", "x");
    return Response.json({});
  });
  const good = await h(req({ "x-request-id": "edge-7f3a9c21.trace" }));
  assert.equal(good.headers.get("x-request-id"), "edge-7f3a9c21.trace");
  assert.equal(rows[0].reqId, "edge-7f3a9c21.trace");

  // Jurnal in'ektsiyasi/haddan uzun qiymat — qabul qilinmaydi.
  for (const bad of ['x" , "level":"error', "a".repeat(300), "short"]) {
    const res = await h(req({ "x-request-id": bad }));
    const id = res.headers.get("x-request-id");
    assert.ok(id && id !== bad && /^[A-Za-z0-9._:-]{8,128}$/.test(id), `buzuq id qabul qilindi: ${bad}`);
  }
});

test("handler(): kutilmagan xato — 500, stack jurnalda, foydalanuvchiga umumiy matn + requestId", async (t) => {
  const rows = capture(t);
  const h = handler("t/boom", async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
  });
  const res = await h(req());
  assert.equal(res.status, 500);
  const id = res.headers.get("x-request-id");
  assert.ok(id);
  const body = (await res.json()) as { error: string; requestId?: string };
  assert.match(body.error, /Ichki xatolik/);
  assert.equal(body.requestId, id);
  const errs = rows.filter((r) => r.level === "error");
  assert.equal(errs.length, 1, "aynan bitta xato qatori");
  const e = errs[0] as { reqId: string; msg: string; err: { message: string; stack: string } };
  assert.equal(e.reqId, id);
  assert.match(e.msg, /t\/boom/);
  assert.match(e.err.message, /ECONNREFUSED/);
  // MUTATSIYA: `serverError` faqat `e.message` yozsa (OBS-03) — stack yo'qoladi.
  assert.match(e.err.stack, /request-log\.test\.mts/);
});

test("handler(): ApiError (kutilgan xato) — sarlavha bor, xato jurnali yo'q", async (t) => {
  const rows = capture(t);
  const h = handler("t/api", async () => {
    throw new ApiError("Topilmadi", 404);
  });
  const res = await h(req());
  assert.equal(res.status, 404);
  assert.ok(res.headers.get("x-request-id"));
  assert.equal(rows.filter((r) => r.level === "error").length, 0);
});

test("handler(): o'zgarmas sarlavhali javob (redirect) ham buzilmaydi", async (t) => {
  capture(t);
  const h = handler("t/redirect", async () => Response.redirect("http://x/boshqa", 302));
  const res = await h(req());
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "http://x/boshqa");
  assert.ok(res.headers.get("x-request-id"));
});

test("onRequestError: bitta JSON qator — stack, digest, yo'l, reqId; URL dagi kalit yashiriladi", async (t) => {
  const rows = capture(t);
  const err = Object.assign(new Error("render yiqildi"), { digest: "1234567890" });
  await onRequestError(
    err,
    { path: "/uz/files?key=AIzaSyD" + "q".repeat(32), method: "GET", headers: { "x-request-id": "req-abcdef12" } },
    { routerKind: "App Router", routePath: "/[locale]/files", routeType: "render" },
  );
  assert.equal(rows.length, 1);
  const r = rows[0] as Record<string, unknown> & { err: { message: string; stack: string } };
  assert.equal(r.level, "error");
  assert.equal(r.msg, "request_error");
  assert.equal(r.digest, "1234567890");
  assert.equal(r.reqId, "req-abcdef12");
  assert.equal(r.routePath, "/[locale]/files");
  assert.equal(r.err.message, "render yiqildi");
  // MUTATSIYA: stack tashlab yuborilsa — qizaradi.
  assert.match(r.err.stack, /request-log\.test\.mts/);
  // MUTATSIYA: log() o'rniga xom JSON.stringify — kalit qatorda qoladi.
  assert.ok(!JSON.stringify(r).includes("AIzaSyD"), "URL dagi kalit jurnalga tushdi");
});
