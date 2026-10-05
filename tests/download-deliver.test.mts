import test from "node:test";
import assert from "node:assert/strict";

/**
 * Delivery driver (docs/mobile/PLAN.md §4.5, R1 §4–§6) — pure logic and the
 * network/Telegram branches through test seams. No DOM, no real Telegram.
 *
 * Pinned:
 *  - gesture window: a Telegram download is sent only ≤ 8 s after the last tap,
 *    otherwise «Tayyor — yuklab olish» (`needs-tap`); Android with no event in
 *    2 s → `needs-tap` with the late answer kept;
 *  - Telegram gets an ABSOLUTE https URL of the signed path and the file name;
 *  - refusals → fallback (`tg-refused` cancelled / unsupported / error);
 *  - browser: real % progress from Content-Length, 410/503 texts, interrupted
 *    body, navigation only when fetch itself fails while online;
 *  - prepare/telegramAction polling (1.5 s, 60 s budget, 202 preparing);
 *  - the row state machine and the Uzbek status lines.
 */

const d = await import("../lib/downloads/deliver.ts");
const { ApiError } = await import("../lib/api-client.ts");

const FILE = {
  format: "native" as const,
  url: "/api/dl/tok123",
  fileName: "Fotosintez.pptx",
  size: 10,
  mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

/* ─────────────────────────── gesture window ─────────────────────────── */

test("gestureFresh: ≤ 8 s after the tap — fresh; older, none, or a clock going back — stale", () => {
  assert.equal(d.GESTURE_WINDOW_MS, 8_000);
  assert.equal(d.gestureFresh(1_000, 1_000), true);
  assert.equal(d.gestureFresh(1_000, 9_000), true, "exactly 8 s is still fresh");
  assert.equal(d.gestureFresh(1_000, 9_001), false);
  assert.equal(d.gestureFresh(null, 5), false, "no tap recorded");
  assert.equal(d.gestureFresh(5_000, 4_000), false, "tap in the future (clock reset) is not trusted");
});

test("markGesture / lastGesture / resetGesture", () => {
  d.resetGesture();
  assert.equal(d.lastGesture(), null);
  d.markGesture(123);
  assert.equal(d.lastGesture(), 123);
  d.resetGesture();
});

test("readyFresh: a signed URL is reused only with > 60 s left", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(d.readyFresh({ expiresAt: "2026-10-05T10:01:01Z" }, now), true);
  assert.equal(d.readyFresh({ expiresAt: "2026-10-05T10:01:00Z" }, now), false);
  assert.equal(d.readyFresh({ expiresAt: "garbage" }, now), false);
});

/* ─────────────────────────── Telegram branch ─────────────────────────── */

type Asked = { url: string; file_name: string };

function tg(outcome: "downloading" | "cancelled" | "unsupported" | "error") {
  const asked: Asked[] = [];
  const impl = (p: Asked) => {
    asked.push(p);
    return Promise.resolve(outcome);
  };
  return { asked, impl };
}

test("Telegram ≥ 8.0, fresh tap: downloadFile gets the ABSOLUTE https URL and the file name → downloading", async () => {
  const t = tg("downloading");
  const r = await d.deliver(FILE, {
    capability: "tg-download",
    platform: "ios",
    lastGestureAt: 1_000,
    now: () => 2_000,
    origin: "https://slaydx.uz/uz/files/x",
    requestDownloadImpl: t.impl,
  });
  assert.deepEqual(r, { kind: "tg-downloading" });
  assert.deepEqual(t.asked, [{ url: "https://slaydx.uz/api/dl/tok123", file_name: "Fotosintez.pptx" }]);
});

test("Telegram: tap older than 8 s → needs-tap, downloadFile NOT called (Android would drop it silently)", async () => {
  const t = tg("downloading");
  const r = await d.deliver(FILE, { capability: "tg-download", platform: "android", lastGestureAt: 1_000, now: () => 9_500, requestDownloadImpl: t.impl });
  assert.equal(r.kind, "needs-tap");
  assert.equal(t.asked.length, 0);
});

test("Telegram Android: no fileDownloadRequested within 2 s → needs-tap; the late answer is kept", async () => {
  let resolveLate!: (o: "downloading") => void;
  const late = new Promise<"downloading">((r) => (resolveLate = r));
  const r = await d.deliver(FILE, {
    capability: "tg-download",
    platform: "android",
    lastGestureAt: 0,
    now: () => 10,
    eventWaitMs: 20,
    origin: "https://slaydx.uz/",
    requestDownloadImpl: () => late,
  });
  assert.equal(r.kind, "needs-tap");
  assert.ok(r.kind === "needs-tap" && r.late, "late promise handed back");
  resolveLate("downloading");
  assert.equal(await (r as { late: Promise<string> }).late, "downloading");
});

test("Telegram iOS: no 2 s cut-off (the popup answer may take long)", async () => {
  const slow = new Promise<"downloading">((r) => setTimeout(() => r("downloading"), 40));
  const r = await d.deliver(FILE, { capability: "tg-download", platform: "ios", lastGestureAt: 0, now: () => 1, eventWaitMs: 5, origin: "https://a.uz/", requestDownloadImpl: () => slow });
  assert.equal(r.kind, "tg-downloading");
});

test("Telegram refusals map to fallback reasons; < 8.0 never calls downloadFile", async () => {
  for (const [outcome, reason] of [["cancelled", "cancelled"], ["unsupported", "unsupported"], ["error", "error"]] as const) {
    const r = await d.deliver(FILE, { capability: "tg-download", platform: "ios", lastGestureAt: 0, now: () => 1, origin: "https://a.uz/", requestDownloadImpl: () => Promise.resolve(outcome) });
    assert.deepEqual(r, { kind: "tg-refused", reason }, outcome);
  }
  let called = 0;
  const old = await d.deliver(FILE, { capability: "tg-fallback", platform: "android", lastGestureAt: 0, now: () => 1, requestDownloadImpl: () => (called++, Promise.resolve("downloading" as const)) });
  assert.deepEqual(old, { kind: "tg-refused", reason: "unsupported" });
  assert.equal(called, 0);
});

test("absoluteUrl: relative signed path → absolute on the page origin", () => {
  assert.equal(d.absoluteUrl("/api/dl/a.b", "https://slaydx.uz/uz/files/1#tgWebAppData=x"), "https://slaydx.uz/api/dl/a.b");
});

/* ─────────────────────────── browser branch ─────────────────────────── */

function body(chunks: number[][], delay = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      for (const c of chunks) {
        if (delay) await new Promise((r) => setTimeout(r, delay));
        ctrl.enqueue(new Uint8Array(c));
      }
      ctrl.close();
    },
  });
}

test("browser: progress from Content-Length (0 → 4 → 10), blob saved with the server file name and type", async () => {
  const saved: { name: string; size: number; type: string }[] = [];
  const progress: [number, number | null][] = [];
  const r = await d.deliver(FILE, {
    capability: "browser",
    platform: null,
    fetchImpl: (async () => new Response(body([[1, 2, 3, 4], [5, 6, 7, 8, 9, 10]]), { headers: { "content-length": "10" } })) as typeof fetch,
    saveBlobImpl: (b, name) => saved.push({ name, size: b.size, type: b.type }),
    onProgress: (l, t) => progress.push([l, t]),
  });
  assert.deepEqual(r, { kind: "saved" });
  assert.deepEqual(progress, [[0, 10], [4, 10], [10, 10]]);
  assert.deepEqual(saved, [{ name: "Fotosintez.pptx", size: 10, type: FILE.mime }]);
});

test("browser: 410 → «muddati tugagan», 503 + Retry-After → server text + qachon qayta (→ «Qayta urinish»)", async () => {
  const gone = await d
    .deliver(FILE, { capability: "browser", platform: null, fetchImpl: (async () => Response.json({ error: "x", code: "expired" }, { status: 410 })) as typeof fetch })
    .catch((e: unknown) => e);
  assert.ok(gone instanceof d.DeliverError);
  assert.equal((gone as InstanceType<typeof d.DeliverError>).message, d.DELIVER_TEXT.expired);
  const busy = (await d
    .deliver(FILE, {
      capability: "browser",
      platform: null,
      fetchImpl: (async () => Response.json({ error: "Fayl tayyorlash navbati band", code: "busy" }, { status: 503, headers: { "retry-after": "15" } })) as typeof fetch,
    })
    .catch((e: unknown) => e)) as InstanceType<typeof d.DeliverError>;
  assert.equal(busy.status, 503);
  assert.equal(busy.serverCode, "busy");
  assert.equal(busy.message, "Fayl tayyorlash navbati band (qayta urinish: 15 soniyadan keyin)");
});

test("browser: body cut mid-way → «Aloqa uzildi», nothing saved", async () => {
  let saved = 0;
  const broken = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(new Uint8Array([1]));
      setTimeout(() => ctrl.error(new TypeError("network")), 5);
    },
  });
  const e = (await d
    .deliver(FILE, { capability: "browser", platform: null, fetchImpl: (async () => new Response(broken)) as typeof fetch, saveBlobImpl: () => saved++ })
    .catch((x: unknown) => x)) as InstanceType<typeof d.DeliverError>;
  assert.equal(e.code, "interrupted");
  assert.equal(e.message, "Aloqa uzildi — qayta urinib ko‘ring");
  assert.equal(saved, 0);
});

test("browser: fetch itself fails while online → navigate to the signed URL; offline → error, no navigation", async () => {
  const went: string[] = [];
  const failing = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  const r = await d.deliver(FILE, { capability: "browser", platform: null, fetchImpl: failing, navigate: (u) => went.push(u), online: () => true });
  assert.deepEqual(r, { kind: "navigated" });
  assert.deepEqual(went, ["/api/dl/tok123"]);
  const off = (await d
    .deliver(FILE, { capability: "browser", platform: null, fetchImpl: failing, navigate: (u) => went.push(u), online: () => false })
    .catch((x: unknown) => x)) as InstanceType<typeof d.DeliverError>;
  assert.equal(off.code, "offline");
  assert.equal(went.length, 1, "no second navigation");
});

test("browser: saving the blob throws → navigation fallback", async () => {
  const went: string[] = [];
  const r = await d.deliver(FILE, {
    capability: "browser",
    platform: null,
    fetchImpl: (async () => new Response(new Uint8Array([1]))) as typeof fetch,
    saveBlobImpl: () => {
      throw new Error("blocked");
    },
    navigate: (u) => went.push(u),
  });
  assert.deepEqual(r, { kind: "navigated" });
  assert.deepEqual(went, [FILE.url]);
});

/* ─────────────────────────── prepare / telegramAction polling ─────────────────────────── */

test("prepareDownload: polls `preparing` (retryAfterMs clamped to 0.5–5 s), reports elapsed, resolves with the signed URL", async () => {
  let clock = 0;
  const waits: number[] = [];
  const states: number[] = [];
  const answers = [
    { state: "preparing" as const, retryAfterMs: 1_500 },
    { state: "preparing" as const, retryAfterMs: 50 },
    { state: "ready" as const, url: "/api/dl/t", fileName: "a.pdf", size: 5, mime: "application/pdf", expiresAt: FILE.expiresAt },
  ];
  const asked: string[] = [];
  const file = await d.prepareDownload("g1", "pdf", (s) => states.push(s.elapsedMs), {
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    request: async (id, f) => {
      asked.push(`${id}:${f}`);
      return answers.shift()!;
    },
  });
  assert.deepEqual(file, { format: "pdf", url: "/api/dl/t", fileName: "a.pdf", size: 5, mime: "application/pdf", expiresAt: FILE.expiresAt });
  assert.deepEqual(asked, ["g1:pdf", "g1:pdf", "g1:pdf"]);
  assert.deepEqual(waits, [1_500, 500]);
  assert.deepEqual(states, [0, 1_500]);
});

test("prepareDownload: 60 s budget → «odatdagidan uzoq» timeout error", async () => {
  let clock = 0;
  const e = (await d
    .prepareDownload("g1", "pdf", undefined, {
      now: () => clock,
      sleep: async (ms) => void (clock += ms),
      request: async () => ({ state: "preparing", retryAfterMs: 5_000 }),
    })
    .catch((x: unknown) => x)) as InstanceType<typeof d.DeliverError>;
  assert.ok(e instanceof d.DeliverError);
  assert.equal(e.code, "timeout");
  assert.equal(e.message, d.DELIVER_TEXT.timeout);
  assert.equal(clock, 60_000, "stops exactly at the budget");
});

test("prepareDownload: API errors pass through (Uzbek server text)", async () => {
  const err = new ApiError("Bu format ushbu natija uchun mavjud emas", 400, { code: "unsupported" });
  const e = await d.prepareDownload("g1", "pdf", undefined, { request: async () => Promise.reject(err) }).catch((x: unknown) => x);
  assert.equal(e, err);
  assert.equal(d.deliverErrorText(e), "Bu format ushbu natija uchun mavjud emas");
});

test("telegramAction: 202 preparing → same request repeated (same body) until 200; onState gets elapsed", async () => {
  let clock = 0;
  const asked: Array<string | undefined> = [];
  const answers: unknown[] = [{ state: "preparing", retryAfterMs: 1_500 }, { ok: true, duplicate: false, format: "pdf", botUrl: "https://t.me/SlaydX_bot" }];
  const states: number[] = [];
  const r = await d.telegramAction("save", "g1", "pdf", (s) => states.push(s.elapsedMs), {
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    request: async (_id, f) => {
      asked.push(f);
      return answers.shift();
    },
  });
  assert.deepEqual(r, { ok: true, duplicate: false, format: "pdf", botUrl: "https://t.me/SlaydX_bot" });
  assert.deepEqual(asked, ["pdf", "pdf"]);
  assert.deepEqual(states, [0]);
});

test("telegramAction: budget exhausted while preparing → timeout", async () => {
  let clock = 0;
  const e = (await d
    .telegramAction("share", "g1", "slides-png", undefined, { now: () => clock, sleep: async (ms) => void (clock += ms), request: async () => ({ state: "preparing", retryAfterMs: 2_000 }) })
    .catch((x: unknown) => x)) as InstanceType<typeof d.DeliverError>;
  assert.equal(e.code, "timeout");
});

/* ─────────────────────────── error texts ─────────────────────────── */

test("deliverErrorText: codes → Uzbek; 429 with Retry-After; bot links only t.me", () => {
  assert.equal(d.deliverErrorText(new ApiError("x", 409, { code: "no_telegram" })), "Telegram akkaunti bog‘lanmagan");
  assert.equal(
    d.deliverErrorText(new ApiError("x", 409, { code: "bot_unreachable" })),
    "Bot sizga yoza olmadi. Botni ochib /start bosing, so‘ng qayta urinib ko‘ring.",
  );
  assert.equal(d.deliverErrorText(new ApiError("Havola muddati tugagan", 410, { code: "expired" })), d.DELIVER_TEXT.expired);
  assert.equal(d.deliverErrorText(new ApiError("Juda ko'p so'rov", 429, { retryAfter: 40 })), "Juda ko'p so'rov (qayta urinish: 40 soniyadan keyin)");
  assert.equal(d.deliverErrorText(new Error("boom")), d.DELIVER_TEXT.failed);
  assert.equal(d.botUrlOf(new ApiError("x", 409, { botUrl: "https://t.me/SlaydX_bot" })), "https://t.me/SlaydX_bot");
  assert.equal(d.botUrlOf(new ApiError("x", 409, { botUrl: "https://evil.example/x" })), null);
  assert.equal(d.botUrlOf(null, "javascript:alert(1)"), null);
  assert.equal(d.apiErrorCode(new ApiError("x", 501, { code: "share_unavailable" })), "share_unavailable");
});

/* ─────────────────────────── row state machine ─────────────────────────── */

test("rowReducer: idle → preparing → delivering (progress) → done; needs-tap → ready; refusals → fallback → sending (+202) → done", () => {
  let s = d.IDLE;
  s = d.rowReducer(s, { t: "prepare", since: 5 });
  assert.deepEqual(s, { s: "preparing", since: 5 });
  assert.equal(d.rowBusy(s), true);
  s = d.rowReducer(s, { t: "deliver", via: "browser" });
  s = d.rowReducer(s, { t: "progress", loaded: 3, total: 10 });
  assert.deepEqual(s, { s: "delivering", via: "browser", loaded: 3, total: 10 });
  assert.equal(d.rowPercent(s), 30);
  assert.deepEqual(d.rowReducer(s, { t: "result", result: { kind: "saved" }, file: FILE }), { s: "done", text: "Yuklab olindi" });
  assert.deepEqual(d.rowReducer(s, { t: "result", result: { kind: "tg-downloading" }, file: FILE }), { s: "done", text: d.DELIVER_TEXT.tgStarted });
  assert.deepEqual(d.rowReducer(s, { t: "result", result: { kind: "needs-tap" }, file: FILE }), { s: "ready", file: FILE });
  const cancelled = d.rowReducer(s, { t: "result", result: { kind: "tg-refused", reason: "cancelled" }, file: FILE });
  assert.deepEqual(cancelled, { s: "fallback", file: FILE, text: "Yuklab olish bekor qilindi" });
  assert.equal(d.rowReducer(s, { t: "result", result: { kind: "tg-refused", reason: "unsupported" }, file: FILE }).s, "fallback");
  assert.match((d.rowReducer(s, { t: "result", result: { kind: "tg-refused", reason: "unsupported" }, file: FILE }) as { text: string }).text, /Telegram ilovangiz eski/);
  let f = d.rowReducer(cancelled, { t: "send" });
  assert.deepEqual(f, { s: "sending", file: FILE });
  f = d.rowReducer(f, { t: "send-wait", since: 7 });
  f = d.rowReducer(f, { t: "send-wait", since: 99 });
  assert.deepEqual(f, { s: "sending", file: FILE, since: 7 }, "the counter starts once");
  assert.deepEqual(d.rowReducer(f, { t: "sent" }), { s: "done", text: "✅ Fayl bot chatiga yuborildi" });
  assert.deepEqual(d.rowReducer(cancelled, { t: "opened" }).s, "done");
  assert.deepEqual(d.rowReducer(s, { t: "fail", text: "X" }), { s: "error", text: "X" });
  // Out-of-order events keep the state.
  assert.equal(d.rowReducer(d.IDLE, { t: "progress", loaded: 1, total: 2 }), d.IDLE);
  assert.equal(d.rowReducer(d.IDLE, { t: "send" }), d.IDLE);
});

test("rowStatusText: hint + size; PDF preparing with seconds; % with MB; Telegram; ready; sending while the route converts", () => {
  const pdf = { id: "pdf" as const, hint: "Chop etish va yuborish uchun", cost: "convert" as const };
  const native = { id: "native" as const, hint: "Tahrirlash uchun", cost: "instant" as const };
  assert.equal(d.rowStatusText(d.IDLE, native, { now: 0, size: 8_493_465 }), "Tahrirlash uchun · 8,1 MB");
  assert.equal(d.rowStatusText(d.IDLE, pdf, { now: 0 }), "Chop etish va yuborish uchun");
  assert.equal(d.rowStatusText({ s: "preparing", since: 1_000 }, pdf, { now: 4_900 }), "PDF tayyorlanmoqda… (odatda 5–15 soniya) 3 s");
  assert.equal(d.rowStatusText({ s: "preparing", since: 0 }, native, { now: 0 }), "Tayyorlanmoqda… 0 s");
  assert.equal(
    d.rowStatusText({ s: "delivering", via: "browser", loaded: 3_250_000, total: 8_493_465 }, native, { now: 0 }),
    "Yuklab olinmoqda — 38% · 3,1 MB / 8,1 MB",
  );
  assert.equal(d.rowStatusText({ s: "delivering", via: "browser", loaded: 2048, total: null }, native, { now: 0 }), "Yuklab olinmoqda — 2 KB");
  assert.equal(d.rowStatusText({ s: "delivering", via: "telegram", loaded: 0, total: null }, native, { now: 0 }), "Telegram yuklab olmoqda…");
  assert.equal(d.rowStatusText({ s: "ready", file: FILE }, native, { now: 0 }), "Tayyor — yuklab olish uchun bosing");
  assert.equal(d.rowStatusText({ s: "sending", file: FILE }, pdf, { now: 0 }), "Botga yuborilmoqda…");
  assert.equal(d.rowStatusText({ s: "sending", file: FILE, since: 0 }, pdf, { now: 2_000 }), "PDF tayyorlanmoqda… (odatda 5–15 soniya) 2 s");
});

test("formatBytes", () => {
  assert.equal(d.formatBytes(512), "512 B");
  assert.equal(d.formatBytes(640 * 1024), "640 KB");
  assert.equal(d.formatBytes(1024 * 1024 * 12.6), "13 MB");
  assert.equal(d.formatBytes(1024 * 1024 * 1.25), "1,3 MB");
});
