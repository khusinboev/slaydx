import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GenerationDetail } from "../lib/api-client.ts";

/**
 * FE-15 — uzoq sinxron AI tahrir (sayqal ≤120 s, «Tuzatish», namuna yuklash)
 * proksi vaqt chegarasidan (nginx 60/120 s) uzoqroq. 504 kelganda server
 * ishni TUGATIB, yangi `doc_version` ni saqlagan bo'lishi mumkin. Ilgari
 * klient «Server javob bermadi» deb ko'rsatib, eski hujjatni ekranda
 * qoldirardi — foydalanuvchi qayta bosib, kunlik 3 sayqaldan birini
 * behuda sarflardi. Endi noaniq javobdan keyin hujjat serverdan qayta
 * so'raladi va natija o'zlashtiriladi.
 */

const api = await import("../lib/api-client.ts");
const edit = await import("../lib/api-edit.ts");
const { ApiError } = api;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
// Testda kutish qisqa — oraliq qiymati konstantada.
edit.RECONCILE_POLL.intervalMs = 5;

function gen(docVersion: number): GenerationDetail {
  return { id: "g1", type: "article", status: "COMPLETED", docVersion, fileVersion: docVersion } as unknown as GenerationDetail;
}

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const gateway = (status: number) => new Response("<html><body>504 Gateway Time-out</body></html>", { status, headers: { "content-type": "text/html" } });

type Handler = (url: string, method: string) => Response | Promise<Response>;
function stub(h: Handler): { url: string; method: string }[] {
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    return h(url, method);
  }) as typeof fetch;
  return calls;
}

test("isUncertainOutcome: proksi 502/504, matnsiz 5xx va vaqt tugashi — noaniq; server matnli javoblar — aniq", () => {
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 504, {})), true);
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 502, {})), true);
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 500, {})), true, "matnsiz 500 — proksi/yiqilish");
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 0, { timeout: true })), true, "klient vaqt chegarasi");
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 0, {})), true, "aloqa uzildi");
  assert.equal(edit.isUncertainOutcome(new ApiError("Kunlik chegara", 503, { error: "Kunlik chegara" })), false, "server o'z matni bilan rad etdi");
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 409, { code: "version" })), false);
  assert.equal(edit.isUncertainOutcome(new ApiError("x", 429, {})), false);
  assert.equal(edit.isUncertainOutcome(new Error("x")), false);
});

test("504 dan keyin server hujjatni saqlagan (docVersion oshgan) — natija o'zlashtiriladi, xato YO'Q", async () => {
  const calls = stub((url, method) => {
    if (method === "POST" && url.endsWith("/polish")) return gateway(504);
    if (method === "GET" && url.startsWith("/api/generations/g1")) return json(200, { generation: gen(8) });
    return json(404, {});
  });
  const r = await edit.withReconcile("g1", 7, () => edit.polishArticle("g1", 7));
  assert.equal(r.generation.docVersion, 8);
  assert.equal(r.reconciled, true);
  assert.equal(calls.filter((c) => c.method === "POST").length, 1, "sayqal QAYTA yuborilmaydi (kunlik chegara)");
});

test("504 dan keyin server hali ishlayapti — keyingi tekshiruvda yangi versiya kelganda o'zlashtiriladi", async () => {
  let gets = 0;
  stub((url, method) => {
    if (method === "POST") return gateway(504);
    gets++;
    return json(200, { generation: gen(gets >= 3 ? 8 : 7) });
  });
  const r = await edit.withReconcile("g1", 7, () => edit.rewriteArticle("g1", 7, { op: "rewrite", target: "intro", instruction: "x" }));
  assert.equal(r.generation.docVersion, 8);
  assert.equal(gets, 3);
});

test("504 va hujjat o'zgarmagan — ANIQ jumla bilan xato (eski «Server javob bermadi» emas), so'rovlar cheklangan", async () => {
  let gets = 0;
  stub((url, method) => {
    if (method === "POST") return gateway(504);
    gets++;
    return json(200, { generation: gen(7) });
  });
  await assert.rejects(
    edit.withReconcile("g1", 7, () => edit.polishArticle("g1", 7)),
    (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.match(e.message, /hujjat o‘zgarmadi/);
      return true;
    },
  );
  assert.equal(gets, edit.RECONCILE_POLL.attempts, "tekshiruvlar soni chegaralangan");
});

test("aniq xatolar (409/429/402/matnli 503) tekshiruvsiz o'z holicha otiladi", async () => {
  for (const [status, body] of [
    [409, { code: "version" }],
    [429, { error: "Bugungi chegara tugadi" }],
    [402, { error: "Bonus" }],
    [503, { error: "O‘chirilgan" }],
  ] as const) {
    let gets = 0;
    stub((url, method) => {
      if (method === "POST") return json(status, body);
      gets++;
      return json(200, { generation: gen(9) });
    });
    await assert.rejects(edit.withReconcile("g1", 7, () => edit.polishArticle("g1", 7)), (e: unknown) => e instanceof ApiError && e.status === status);
    assert.equal(gets, 0, `${status}: qayta so'rov bo'lmasin`);
  }
});

test("W4-D N2: sahifa yopilsa (signal abort) tekshiruv to'xtaydi — 36 ta GET yuborilmaydi", async () => {
  let gets = 0;
  stub((url, method) => {
    if (method === "POST") return gateway(504);
    gets++;
    return json(200, { generation: gen(7) });
  });
  const ctrl = new AbortController();
  const p = edit.withReconcile("g1", 7, () => edit.polishArticle("g1", 7), ctrl.signal);
  setTimeout(() => ctrl.abort(), 12);
  await assert.rejects(p);
  assert.ok(gets < edit.RECONCILE_POLL.attempts, `abortdan keyin to'xtadi (GET: ${gets})`);
});

test("ResultView: «Tuzatish» ham, «Hammasini tuzatish» ham withReconcile orqali", () => {
  const src = readFileSync(new URL("../components/files/ResultView.tsx", import.meta.url), "utf8");
  assert.match(src, /withReconcile\(cur\.id, base, \(\) => rewriteArticle\(/);
  assert.match(src, /withReconcile\(cur\.id, base, \(\) => polishArticle\(/);
});
