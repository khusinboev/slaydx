import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { GenerationDetail, PollIssue } from "../lib/api-client.ts";

/**
 * C20/FE-14/C09 (W2-E) — klient transporti: `pollGeneration` hech qachon
 * «jim» taslim bo'lmaydi, har so'rovda vaqt chegarasi bor, 429 (navbat
 * to'lgan) server matni bilan ko'rsatiladi, ro'yxat sahifalanadi.
 *
 * Soat SOXTA: `Date.now` va global `setTimeout` almashtiriladi — kutish
 * darhol «o'tadi», soat esa kutilgan ms ga suriladi. `request()` ning
 * vaqt chegarasi `AbortSignal.timeout` da (global `setTimeout` emas),
 * shuning uchun soxta taymer uni buzmaydi.
 */

const api = await import("../lib/api-client.ts");
const edit = await import("../lib/api-edit.ts");
const { ApiError, pollGeneration, request } = api;

function gen(patch: Partial<GenerationDetail> = {}): GenerationDetail {
  return {
    id: "g1",
    type: "referat",
    topic: "T",
    status: "QUEUED",
    createdAt: new Date(0).toISOString(),
    price: 1000,
    fileName: "x.docx",
    format: "docx",
    progress: 0,
    step: "Navbatga qo'yildi",
    expiresAt: null,
    error: null,
    preview: null,
    html: null,
    doc: null,
    hasFile: false,
    ...patch,
  } as GenerationDetail;
}

const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

type Clock = { now: number; delays: number[] };

/** Soxta soat: har `setTimeout(fn, ms)` soatni `ms` ga suradi va `fn` ni darhol chaqiradi. */
function fakeClock(t: import("node:test").TestContext): Clock {
  const c: Clock = { now: 0, delays: [] };
  t.mock.method(Date, "now", () => c.now);
  t.mock.method(globalThis, "setTimeout", ((fn: () => void, ms?: number) => {
    c.now += ms ?? 0;
    c.delays.push(ms ?? 0);
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
  return c;
}

// ─────────────────────────── pollGeneration: 20 daqiqa (UX-05)

test("poll: 20 daqiqadan keyin ham QUEUED ish uchun polling TO'XTAMAYDI, sekin rejimga (≥30 s) o'tadi", async (t) => {
  const clock = fakeClock(t);
  const ctrl = new AbortController();
  let calls = 0;
  const callTimes: number[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    callTimes.push(clock.now);
    // 30 daqiqa soxta vaqt o'tgach testni o'zimiz to'xtatamiz.
    if (clock.now > 30 * 60_000) ctrl.abort();
    return json(200, { generation: gen() });
  });
  const err = await pollGeneration("g1", () => {}, ctrl.signal).then(
    () => null,
    (e: unknown) => e,
  );
  // Eski kod: 20 daqiqada `ApiError(…, 504)` bilan taslim bo'lardi.
  assert.ok(!(err instanceof ApiError), `ApiError bilan taslim bo'lmasligi kerak: ${String((err as Error)?.message)}`);
  assert.equal((err as DOMException).name, "AbortError", "faqat chaqiruvchi bekor qilganda to'xtaydi");
  const late = callTimes.filter((x) => x > 21 * 60_000);
  assert.ok(late.length >= 2, "20 daqiqadan keyin ham so'rovlar davom etadi");
  for (let i = 1; i < late.length; i++) {
    assert.ok(late[i] - late[i - 1] >= 30_000, `sekin rejimda oraliq ≥30 s (bor: ${late[i] - late[i - 1]})`);
  }
  assert.ok(calls < 400, `yuk cheklangan (${calls} so'rov / 30 daqiqa)`);
});

test("poll: 20 daqiqada bir marta «slow» xabari beriladi (UI tushuntirishi uchun)", async (t) => {
  const clock = fakeClock(t);
  const ctrl = new AbortController();
  const issues: (PollIssue | null)[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    if (clock.now > 22 * 60_000) ctrl.abort();
    return json(200, { generation: gen() });
  });
  await pollGeneration("g1", () => {}, ctrl.signal, (i) => issues.push(i)).catch(() => {});
  const slow = issues.filter((i) => i?.kind === "slow");
  assert.equal(slow.length, 1, "«slow» bir marta");
  assert.match(slow[0]!.message, /uzoq/);
});

// ─────────────────────────── pollGeneration: uzilish (FE-02)

test("poll: 502 × 6 (≈30 s dan uzun uzilish) dan keyin ham davom etadi va COMPLETED ni qaytaradi", async (t) => {
  fakeClock(t);
  let n = 0;
  t.mock.method(globalThis, "fetch", async () => {
    n++;
    if (n === 1) return json(200, { generation: gen() });
    if (n <= 7) return new Response("<html>502</html>", { status: 502 });
    return json(200, { generation: gen({ status: "COMPLETED", hasFile: true }) });
  });
  const r = await pollGeneration("g1", () => {});
  assert.equal(r.status, "COMPLETED");
});

test("poll: uzilishda qayta urinish oralig'i 30 s dan oshmaydi va `onIssue` xabar beradi, tiklanganda `null`", async (t) => {
  const clock = fakeClock(t);
  let n = 0;
  const issues: (PollIssue | null)[] = [];
  t.mock.method(globalThis, "fetch", async () => {
    n++;
    if (n >= 2 && n <= 12) throw new TypeError("Failed to fetch");
    if (n > 12) return json(200, { generation: gen({ status: "COMPLETED" }) });
    return json(200, { generation: gen() });
  });
  const r = await pollGeneration("g1", () => {}, undefined, (i) => issues.push(i));
  assert.equal(r.status, "COMPLETED");
  assert.ok(Math.max(...clock.delays) <= 30_000, `backoff ≤ 30 s (max ${Math.max(...clock.delays)})`);
  const retrying = issues.filter((i) => i?.kind === "retrying");
  assert.ok(retrying.length >= 1, "uzilish UI ga aytiladi");
  assert.match(retrying[0]!.message, /Aloqa/);
  assert.equal(issues.at(-1), null, "tiklangach xabar o'chadi");
});

test("poll: 429 — `Retry-After` hurmat qilinadi, taslim bo'linmaydi", async (t) => {
  const clock = fakeClock(t);
  let n = 0;
  t.mock.method(globalThis, "fetch", async () => {
    n++;
    if (n === 1) return json(429, { error: "Juda ko'p so'rov" }, { "retry-after": "17" });
    return json(200, { generation: gen({ status: "COMPLETED" }) });
  });
  const r = await pollGeneration("g1", () => {});
  assert.equal(r.status, "COMPLETED");
  assert.ok(clock.delays[0] >= 17_000, `Retry-After 17 s kutildi (bor: ${clock.delays[0]})`);
});

test("poll: 404 — darhol taslim (qayta urinishga ma'no yo'q), xato ApiError 404", async (t) => {
  fakeClock(t);
  let n = 0;
  t.mock.method(globalThis, "fetch", async () => {
    n++;
    return json(404, { error: "Topilmadi" });
  });
  const err = await pollGeneration("g1", () => {}).catch((e: unknown) => e);
  assert.ok(err instanceof ApiError);
  assert.equal((err as InstanceType<typeof ApiError>).status, 404);
  assert.equal(n, 1);
});

test("poll: bekor qilish ketayotgan so'rovni ham to'xtatadi (signal fetch ga uzatiladi)", { timeout: 3000 }, async (t) => {
  const ctrl = new AbortController();
  let seen: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_u: unknown, init?: RequestInit) => {
    seen = init?.signal;
    return new Promise((_, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    });
  });
  const p = pollGeneration("g1", () => {}, ctrl.signal);
  await new Promise((r) => setImmediate(r));
  ctrl.abort();
  const err = await p.catch((e: unknown) => e);
  assert.ok(seen, "fetch signal oldi");
  assert.equal((err as DOMException).name, "AbortError");
});

// ─────────────────────────── request(): vaqt chegarasi (FE-14)

test("request: osilib qolgan so'rov `timeoutMs` dan keyin ApiError(0, timeout) bilan tugaydi", { timeout: 3000 }, async (t) => {
  t.mock.method(globalThis, "fetch", (_u: unknown, init?: RequestInit) => {
    return new Promise((_, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason ?? new DOMException("x", "AbortError")));
    });
  });
  // Node da `AbortSignal.timeout` taymeri `unref` — hodisa halqasi bo'shab
  // qolmasin deb test o'zi bitta faol taymer ushlab turadi.
  const keepAlive = setInterval(() => {}, 1000);
  const err = await request("/api/x", { timeoutMs: 30 })
    .catch((e: unknown) => e)
    .finally(() => clearInterval(keepAlive));
  assert.ok(err instanceof ApiError, "ApiError bo'lishi kerak");
  assert.equal((err as InstanceType<typeof ApiError>).status, 0);
  assert.equal((err as InstanceType<typeof ApiError>).data.timeout, true);
  assert.match((err as Error).message, /javob/i);
});

test("request: har so'rovda standart vaqt chegarasi bor (signal doim uzatiladi)", async (t) => {
  let seen: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_u: unknown, init?: RequestInit) => {
    seen = init?.signal;
    return json(200, { ok: true });
  });
  await request("/api/x");
  assert.ok(seen instanceof AbortSignal);
  assert.equal(api.DEFAULT_TIMEOUT_MS, 30_000);
});

test("request: chaqiruvchi bekor qilsa — AbortError (ApiError emas, UI xato ko'rsatmaydi)", async (t) => {
  const ctrl = new AbortController();
  t.mock.method(globalThis, "fetch", (_u: unknown, init?: RequestInit) => {
    return new Promise((_, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    });
  });
  const p = request("/api/x", { signal: ctrl.signal });
  ctrl.abort();
  const err = await p.catch((e: unknown) => e);
  assert.ok(!(err instanceof ApiError));
  assert.equal((err as DOMException).name, "AbortError");
});

test("request: `Retry-After` sarlavhasi `retryAfterSec` ga o'tadi", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json(503, { error: "Band" }, { "retry-after": "12" }));
  const err = (await request("/api/x").catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
  assert.equal(err.retryAfterSec, 12);
});

// ─────────────────────────── createGeneration: 429 (C09 / W2-B shartnomasi)

test("createGeneration: 429 queue_full — server matni + qayta urinish vaqti, kod saqlanadi", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    json(429, { error: "Navbat to‘lgan — birozdan keyin", code: "queue_full", retryAfterSec: 120 }, { "retry-after": "120" }),
  );
  const err = (await api.createGeneration("referat", {}).catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 429);
  assert.equal(err.data.code, "queue_full");
  assert.match(err.message, /^Navbat to‘lgan — birozdan keyin/, "server matni birinchi");
  assert.match(err.message, /2 daqiqa/, "qayta urinish vaqti ko'rsatiladi");
});

test("createGeneration: 429 user_inflight — server matnida raqam bo'lsa takror qo'shilmaydi", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    json(429, { error: "Sizda 3 ta ish ketmoqda — biri tugashini kuting", code: "user_inflight", retryAfterSec: 45 }),
  );
  const err = (await api.createGeneration("referat", {}).catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
  assert.equal(err.message, "Sizda 3 ta ish ketmoqda — biri tugashini kuting");
  assert.equal(err.retryAfterSec, 45);
});

// ─────────────────────────── listGenerations: kursor (FE-08)

test("listGenerations: kursor va limit so'rovga qo'shiladi, `nextCursor` qaytadi", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (u: unknown) => {
    urls.push(String(u));
    return json(200, { generations: [], nextCursor: String(u).includes("cursor=") ? null : "c2" });
  });
  const first = await api.listGenerations();
  assert.equal(urls[0], "/api/generations");
  assert.equal(first.nextCursor, "c2");
  const next = await api.listGenerations({ cursor: "c2", limit: 50 });
  assert.equal(urls[1], "/api/generations?cursor=c2&limit=50");
  assert.equal(next.nextCursor, null);
});

test("listGenerations: eski server (`nextCursor` yo'q) — kursor null", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json(200, { generations: [] }));
  const page = await api.listGenerations();
  assert.equal(page.nextCursor, null);
});

// ─────────────────────────── downloadGeneration: PDF 429/503 (W2-A shartnomasi)

test("downloadGeneration: 503 — server matni va Retry-After", async (t) => {
  let seen: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_u: unknown, init?: RequestInit) => {
    seen = init?.signal;
    return json(503, { error: "PDF xizmati band" }, { "retry-after": "20" });
  });
  const err = (await api.downloadGeneration("g1", "pdf").catch((e: unknown) => e)) as InstanceType<typeof ApiError>;
  assert.ok(err instanceof ApiError);
  assert.equal(err.status, 503);
  assert.equal(err.retryAfterSec, 20);
  assert.match(err.message, /^PDF xizmati band/);
  assert.match(err.message, /20 soniya/);
  assert.ok(seen instanceof AbortSignal, "yuklab olishda ham vaqt chegarasi bor");
});

test("downloadGeneration: vaqt chegarasi faqat sarlavhalargacha — sekin tana (katta deka, mobil) uzilmaydi (review R2)", { timeout: 3000 }, async (t) => {
  const keepAlive = setInterval(() => {}, 1000);
  const clicked: string[] = [];
  const g = globalThis as unknown as Record<string, unknown>;
  const hadDoc = "document" in g;
  g.document = {
    createElement: () => ({ click: () => clicked.push("a"), remove() {} }),
    body: { appendChild() {} },
  };
  t.mock.method(globalThis, "fetch", async (_u: unknown, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        init?.signal?.addEventListener("abort", () => ctrl.error(new DOMException("aborted", "AbortError")));
        // Tana chegaradan (30 ms) ancha keyin tugaydi.
        setTimeout(() => {
          try {
            ctrl.enqueue(new Uint8Array([1, 2, 3]));
            ctrl.close();
          } catch {
            // Oqim allaqachon uzilgan — test pastda buni xato sifatida ko'radi.
          }
        }, 120);
      },
    });
    return new Response(body, { status: 200, headers: { "content-disposition": 'attachment; filename="d.pptx"' } });
  });
  try {
    await api.downloadGeneration("g1", undefined, { headerTimeoutMs: 30 });
    assert.deepEqual(clicked, ["a"], "fayl saqlandi");
  } finally {
    clearInterval(keepAlive);
    if (!hadDoc) delete g.document;
  }
});

test("downloadGeneration: sarlavhalar kelmasa — vaqt tugadi xatosi", { timeout: 3000 }, async (t) => {
  const keepAlive = setInterval(() => {}, 1000);
  t.mock.method(globalThis, "fetch", (_u: unknown, init?: RequestInit) => {
    return new Promise((_, rej) => {
      init?.signal?.addEventListener("abort", () => rej(new DOMException("x", "AbortError")));
    });
  });
  const err = (await api
    .downloadGeneration("g1", "pdf", { headerTimeoutMs: 30 })
    .catch((e: unknown) => e)
    .finally(() => clearInterval(keepAlive))) as InstanceType<typeof ApiError>;
  assert.ok(err instanceof ApiError);
  assert.equal(err.data.timeout, true);
});

// ─────────────────────────── api-edit: server matni (W1-E follow-up)

test("editErrorText: 429 — umumiy «Juda tez-tez» emas, server matni", () => {
  const e = new ApiError("Bugungi bepul chegara tugadi (20 ta). Ertaga qayta urinib ko'ring.", 429, {
    error: "Bugungi bepul chegara tugadi (20 ta). Ertaga qayta urinib ko'ring.",
  });
  assert.match(edit.editErrorText(e), /Bugungi bepul chegara/);
});

test("editErrorText: 429 server matnsiz (nginx) — zaxira jumla", () => {
  const e = new ApiError("Xatolik (429)", 429, {});
  assert.match(edit.editErrorText(e), /Juda tez-tez/);
});

test("editErrorText: 402 unpaid va 503 disabled — server matni; 409 busy — kod jumlasi emas, server matni", () => {
  const unpaid = new ApiError("AI tahrir faqat pul bilan…", 402, { error: "AI tahrir faqat pul bilan…", code: "unpaid" });
  assert.equal(edit.editErrorText(unpaid), "AI tahrir faqat pul bilan…");
  const off = new ApiError("Bepul AI yordamchi vaqtincha o'chirilgan.", 503, { error: "x", code: "disabled" });
  assert.equal(edit.editErrorText(off), "Bepul AI yordamchi vaqtincha o'chirilgan.");
  const busy = new ApiError("Bu hujjatda AI tahrir allaqachon ketmoqda", 409, { error: "x", code: "busy" });
  assert.equal(edit.editErrorText(busy), "Bu hujjatda AI tahrir allaqachon ketmoqda");
  assert.equal(edit.editErrorCode(busy), null, "busy — konflikt emas, hujjat qayta yuklanmaydi");
  assert.equal(edit.isUnpaidError(unpaid), true);
  assert.equal(edit.isUnpaidError(off), false);
});

test("editErrorText: PATCH 413 — «rasm» jumlasi emas, server matni", () => {
  const e = new ApiError("So'rov hajmi juda katta", 413, { error: "So'rov hajmi juda katta" });
  assert.equal(edit.editErrorText(e), "So'rov hajmi juda katta");
});

// ─────────────────────────── klient/server op chegarasi mosligi (FE-03)

test("MAX_EDIT_OPS: klient bo'laklari server chegarasidan oshmaydi", async () => {
  const src = readFileSync(new URL("../lib/server/edit-adapters.ts", import.meta.url), "utf8");
  const m = /export const MAX_EDIT_OPS = (\d+);/.exec(src);
  assert.ok(m, "server konstantasi topilmadi");
  const { EDIT_CHUNK_OPS } = await import("../lib/api-edit.ts");
  assert.ok(EDIT_CHUNK_OPS <= Number(m[1]), `klient ${EDIT_CHUNK_OPS} ≤ server ${m[1]}`);
  assert.ok(EDIT_CHUNK_OPS >= 1);
});
