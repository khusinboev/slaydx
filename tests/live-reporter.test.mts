import test from "node:test";
import assert from "node:assert/strict";
import { extractMeta } from "../lib/generation/meta.ts";
import { TOOL_BY_ID } from "../lib/tools.ts";
import type { SlideProgressEvent } from "../lib/generation/slide-progress.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * `LiveReporter` (L3) — `lib/server/live.ts`.
 *
 * Dvigatel (`lib/generation/`) hodisalarni L2 parallel yozadi — bu yerda
 * ularga TIP darajasida tayaniladi (`SlideProgressEvent`), haqiqiy
 * `buildSlideAcademicDoc` chaqirilmaydi. Baza — `pool().query` ushlanadi
 * (`tests/logo.test.mts:173-213` naqshi), haqiqiy Postgres kerak emas.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const meta = extractMeta(TOOL_BY_ID["slide"], { topic: "Fotosintez jarayoni" } as never);

function slide(i: number, patch: Partial<SlideModel> = {}): SlideModel {
  return { id: `s${i}`, layout: "bullets", title: `Slayd ${i}`, ...patch };
}

function planEvent(n: number, logo?: string): Extract<SlideProgressEvent, { type: "plan" }> {
  return {
    type: "plan",
    slides: Array.from({ length: n }, (_, i) => slide(i)),
    roles: Array.from({ length: n }, (_, i) => `rol-${i}`),
    meta,
    theme: "atlas",
    template: "lecture",
    logo,
  };
}

function slideEvent(index: number, patch: Partial<SlideModel> = {}): Extract<SlideProgressEvent, { type: "slide" }> {
  return { type: "slide", index, slide: slide(index, patch) };
}

function imageEvent(index: number, url: string): Extract<SlideProgressEvent, { type: "image" }> {
  return { type: "image", index, url };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 8 baytlik PNG sarlavha + to'ldiruvchi — `data:` URL yasash uchun. */
function pngDataUrl(extra = 32): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bytes = Buffer.concat([sig, Buffer.alloc(extra, 0x02)]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

type Call = { text: string; params: unknown[] };

/**
 * `pool().query` ushlagichi. `liveSeq()` `UPDATE ... live_seq = live_seq + 1`
 * so'roviga qaytariladigan qatorni tanlaydi — `null` qaytarsa 0 qator
 * (qulf yo'qolgan holat).
 */
function mockQuery(calls: Call[], liveSeq: () => number | null = (() => {
  let n = 0;
  return () => ++n;
})()) {
  return async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    const sql = text.replace(/\s+/g, " ").trim();
    if (/live_seq = live_seq \+ 1/.test(sql)) {
      const v = liveSeq();
      return { rows: v === null ? [] : [{ live_seq: v }], rowCount: v === null ? 0 : 1 };
    }
    return { rows: [], rowCount: 1 };
  };
}

function lastLiveCall(calls: Call[]): Call | undefined {
  return [...calls].reverse().find((c) => /live_seq = live_seq \+ 1/.test(c.text));
}

// ---------------------------------------------------------------------------
// Koalessiya — leading + trailing.
// ---------------------------------------------------------------------------

test("sink: burst hodisalar koalessiya qilinadi (leading darhol, qolgani BITTA trailing)", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  const r = new LiveReporter("job-a", "w1");
  r.sink(planEvent(3));
  await sleep(20);
  assert.equal(calls.length, 1, "birinchi hodisa darhol yozilishi kerak (leading)");

  // MUTATSIYA: agar koalessiya bo'lmasa, bu uchta hodisa yana ikkita
  // qo'shimcha UPDATE beradi — pastdagi tekshiruv shuni ushlaydi.
  r.sink(slideEvent(0, { title: "Yangi 0" }));
  await sleep(20);
  r.sink(slideEvent(1, { title: "Yangi 1" }));
  await sleep(20);
  r.sink(slideEvent(2, { title: "Yangi 2" }));
  assert.equal(calls.length, 1, "burst ichidagi hodisalar hali yozilmagan bo'lishi kerak (trailing kutmoqda)");

  await sleep(430);
  assert.equal(calls.length, 2, "burst BITTA trailing yozuvga birlashishi kerak");

  const last = lastLiveCall(calls);
  const payload = JSON.parse(String(last?.params[2]));
  assert.equal(payload.slides[2].title, "Yangi 2", "trailing yozuv ENG OXIRGI holatni ushlashi kerak");

  await r.stop();
  assert.equal(calls.length, 2, "dirty bo'lmasa stop() qo'shimcha yozuv qilmasligi kerak");
});

// ---------------------------------------------------------------------------
// SQL matni — egalik/qulf predikati va live_seq o'sishi `setLive` orqali.
// ---------------------------------------------------------------------------

test("setLive SQL: locked_by/status predikati, locked_at=now(), live_seq=live_seq+1", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  const r = new LiveReporter("job-b", "worker-7");
  r.sink(planEvent(2));
  await sleep(20);

  const call = lastLiveCall(calls);
  assert.ok(call, "setLive so'rovi yuborilishi kerak");
  const sql = call!.text.replace(/\s+/g, " ");
  assert.match(sql, /WHERE id = \$1 AND locked_by = \$2 AND status = 'IN_PROGRESS'/);
  assert.match(sql, /locked_at = now\(\)/);
  assert.match(sql, /live_seq = live_seq \+ 1/);
  assert.deepEqual([call!.params[0], call!.params[1]], ["job-b", "worker-7"]);

  await r.stop();
});

// ---------------------------------------------------------------------------
// `data:` rasm/logotip → aktiv, JSONB da `data:` YO'Q.
// ---------------------------------------------------------------------------

test("image data: URL aktivga aylanadi — INSERT ... ON CONFLICT, live JSON da assets URL, data: YO'Q", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  const r = new LiveReporter("job-c", "w1");
  const dataUrl = pngDataUrl();
  r.sink(planEvent(2));
  await sleep(20); // leading flush (data: hali) tugasin
  r.sink(imageEvent(0, dataUrl));
  await sleep(450); // asset INSERT + trailing yozuv

  const insertCall = calls.find((c) => /INSERT INTO generation_assets/.test(c.text));
  assert.ok(insertCall, "aktiv INSERT so'rovi yuborilishi kerak");
  assert.match(insertCall!.text.replace(/\s+/g, " "), /ON CONFLICT \(generation_id, asset_id\) DO NOTHING/);
  assert.equal(insertCall!.params[0], "job-c");

  const last = lastLiveCall(calls);
  const rawJson = String(last?.params[2]);
  assert.doesNotMatch(rawJson, /data:/, "live JSON'da data: URL QOLMASLIGI kerak");
  const payload = JSON.parse(rawJson);
  assert.match(payload.slides[0].image.url, /^\/api\/generations\/job-c\/assets\/[0-9a-f]{24}$/);

  await r.stop();
});

test("plan logo data: URL ham xuddi shu naqsh bilan aktivga aylanadi", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  const r = new LiveReporter("job-logo", "w1");
  r.sink(planEvent(1, pngDataUrl()));
  await sleep(450);

  const insertCall = calls.find((c) => /INSERT INTO generation_assets/.test(c.text));
  assert.ok(insertCall, "logotip ham aktivga yozilishi kerak");

  const last = lastLiveCall(calls);
  const rawJson = String(last?.params[2]);
  assert.doesNotMatch(rawJson, /data:/);
  const payload = JSON.parse(rawJson);
  assert.match(payload.logo, /^\/api\/generations\/job-logo\/assets\/[0-9a-f]{24}$/);

  await r.stop();
});

// ---------------------------------------------------------------------------
// Qulf yo'qolgan (0 qator) — `lost`, keyingi yozuvlar to'xtaydi.
// ---------------------------------------------------------------------------

test("setLive 0 qator qaytarsa — lost=true, keyingi hodisalar yozilmaydi", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls, () => null));

  const r = new LiveReporter("job-d", "w1");
  r.sink(planEvent(2));
  await sleep(20);
  assert.equal(r.lost, true, "0 qator qaytgach lost belgilanishi kerak");
  const afterFirst = calls.length;
  assert.ok(afterFirst >= 1);

  // MUTATSIYA: `lost` tekshiruvi olib tashlansa, bu hodisalar yana
  // `setLive` chaqirib, sonni oshirardi.
  r.sink(slideEvent(0, { title: "Yozilmasin" }));
  await sleep(450);
  r.sink(imageEvent(1, pngDataUrl()));
  await sleep(450);

  assert.equal(calls.length, afterFirst, "lost bo'lgach hech qanday yangi so'rov yuborilmasligi kerak");
  await r.stop();
  assert.equal(calls.length, afterFirst, "stop() ham lost holatda yozmasligi kerak");
});

// ---------------------------------------------------------------------------
// Hajm limiti — 1.5 MB.
// ---------------------------------------------------------------------------

test("1.5 MB dan katta: avval notes tashlanadi, hali katta bo'lsa yozilmaydi + warn", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter, LIVE_MAX_BYTES } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  // 1) notes tashlansa sig'adigan holat.
  const bigNotes = "x".repeat(120_000);
  const slides = Array.from({ length: 20 }, (_, i) => slide(i, { notes: bigNotes }));
  const totalWithNotes = JSON.stringify(slides).length;
  assert.ok(totalWithNotes >= LIVE_MAX_BYTES, "sinov ma'lumoti chindan ham limitdan katta bo'lishi kerak");

  const r = new LiveReporter("job-e", "w1");
  r.sink({
    type: "plan",
    slides,
    roles: Array.from({ length: 20 }, (_, i) => `rol-${i}`),
    meta,
    theme: "atlas",
    template: "lecture",
  });
  await sleep(20);

  const last = lastLiveCall(calls);
  assert.ok(last, "notes tashlangach yoziladigan darajaga tushishi kerak");
  const payload = JSON.parse(String(last!.params[2]));
  assert.equal(payload.slides[0].notes, undefined, "notes tashlangan bo'lishi kerak");
  assert.ok(
    Buffer.byteLength(String(last!.params[2]), "utf8") < LIVE_MAX_BYTES,
    "yozilgan JSON limitdan kichik bo'lishi kerak",
  );

  await r.stop();

  // 2) notes tashlansa ham sig'maydigan holat — title'ning o'zi ulkan.
  const warnCalls: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => {
    warnCalls.push(args);
  });
  calls.length = 0;
  const hugeTitle = "y".repeat(2_000_000);
  const r2 = new LiveReporter("job-e2", "w1");
  r2.sink({
    type: "plan",
    slides: [slide(0, { title: hugeTitle })],
    roles: ["rol-0"],
    meta,
    theme: "atlas",
    template: "lecture",
  });
  await sleep(20);

  assert.equal(lastLiveCall(calls), undefined, "juda katta bo'lsa UMUMAN yozilmasligi kerak");
  assert.ok(warnCalls.length >= 1, "console.warn chiqishi kerak");
  await r2.stop();
});

test("done hodisasida yozuv yuborilmaydi (completeJob live_json'ni o'zi NULL qiladi)", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  const r = new LiveReporter("job-done", "w1");
  r.sink(planEvent(1));
  await sleep(20);
  const afterPlan = calls.length;
  assert.ok(afterPlan >= 1);

  r.sink({ type: "done" });
  await sleep(450);
  assert.equal(calls.length, afterPlan, "`done` o'zi qo'shimcha yozuv chaqirmasligi kerak");

  await r.stop();
  assert.equal(calls.length, afterPlan, "stop() ham `done`dan keyin yozmasligi kerak");
});

// ---------------------------------------------------------------------------
// `progressTicker` (worker.ts) — `live.started` bo'lsa faqat `heartbeat`.
// ---------------------------------------------------------------------------

test("progressTicker: hodisa kelmaguncha eski egri chiziq (setProgress), keyin faqat heartbeat", async (t) => {
  const { pool } = await import("../lib/server/db.ts");
  const { progressTicker } = await import("../lib/server/worker.ts");
  const { LiveReporter } = await import("../lib/server/live.ts");
  const calls: Call[] = [];
  t.mock.method(pool(), "query", mockQuery(calls));

  t.mock.timers.enable({ apis: ["setInterval"] });

  const job = {
    id: "job-f",
    userId: "u1",
    toolId: "slide",
    values: {},
    price: 1,
    attempts: 1,
    budgetMs: 300_000,
  };
  const live = new LiveReporter(job.id, "w1");
  const stop = progressTicker(job as never, live);

  const isSetProgress = (c: Call) =>
    /SET progress = \$3, step = \$4, locked_at = now\(\)/.test(c.text.replace(/\s+/g, " "));
  const isHeartbeat = (c: Call) =>
    /^UPDATE generations SET locked_at = now\(\) WHERE id = \$1 AND locked_by = \$2 AND status = 'IN_PROGRESS'$/.test(
      c.text.replace(/\s+/g, " ").trim(),
    );

  // Hali `live` hech qanday hodisa olmagan — eski egri chiziq ishlaydi.
  t.mock.timers.tick(2000);
  await sleep(10);
  assert.ok(calls.some(isSetProgress), "hodisa kelmaguncha setProgress ishlashi kerak");

  calls.length = 0;
  live.sink(planEvent(2)); // started=true — o'zining setLive yozuvi ham navbatga tushadi
  t.mock.timers.tick(2000);
  await sleep(10);
  t.mock.timers.tick(2000);
  await sleep(10);

  // MUTATSIYA: `live?.started` tekshiruvi olib tashlansa, bu yerda
  // setProgress ham chaqirilardi — pastdagi tekshiruv shuni ushlaydi.
  assert.equal(calls.filter(isSetProgress).length, 0, "live boshlangach setProgress CHAQIRILMASLIGI kerak");
  assert.ok(calls.filter(isHeartbeat).length >= 1, "live boshlangach heartbeat chaqirilishi kerak");

  stop();
  await live.stop();
});
