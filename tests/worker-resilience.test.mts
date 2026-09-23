import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

/**
 * WORKER CHIDAMLILIGI (AUDIT prod-readiness DB-10, C27: BEB-03, CONC-04, BEA-18).
 *
 * 1. `housekeeping()` — har qadam ALOHIDA: bittasi yiqilsa (masalan
 *    `reclaimStaleJobs` ulanish uzilishida) qolganlari baribir ishlaydi.
 *    Ilgari bitta `try` butun ro'yxatni o'rab turardi — birinchi xato
 *    navbat muddati, saqlash muddati va tozalashlarni ham o'tkazib yuborardi.
 * 2. `LiveReporter` — `setLive`/`putAssets` rad etilsa promise zanjiri
 *    ushlanmagan rad etish (unhandledRejection) bermasligi kerak: alohida
 *    worker processida bu processni YIQITARDI.
 * 3. `installProcessGuards` — rad etish jurnalga yoziladi va process
 *    davom etadi; haqiqiy `uncaughtException` esa nol bo'lmagan kod bilan
 *    chiqadi (Docker qayta ko'taradi).
 *
 * Baza `pool().query`/`connect` stubi orqali (bazasiz).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");
const { LiveReporter } = await import("../lib/server/live.ts");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** Har SQL ni yozadi; `fail` mos kelsa shu so'rov xato tashlaydi. */
function mockDb(t: TestContext, fail: (sql: string) => boolean): string[] {
  const seen: string[] = [];
  const run = async (text: string) => {
    const sql = norm(text);
    seen.push(sql);
    if (fail(sql)) throw new Error("sinov: ulanish uzildi");
    return { rows: [], rowCount: 0 };
  };
  const p = pool();
  t.mock.method(p, "query", run);
  t.mock.method(p, "connect", async () => ({ query: run, release() {} }));
  return seen;
}

function quietConsole(t: TestContext) {
  t.mock.method(console, "error", () => {});
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "log", () => {});
}

const LATER_STEPS: Array<[string, RegExp]> = [
  ["navbat muddati (queue-ttl)", /FROM generations WHERE status = 'QUEUED' AND created_at </],
  ["saqlash muddati (retention)", /g\.files_purged_at IS NULL/],
  ["auth sessiyalari", /DELETE FROM sessions WHERE/],
  ["o'yin havolalari", /DELETE FROM game_sessions/],
  ["manba fayllari", /DELETE FROM source_uploads/],
  ["rezyume suratlari", /DELETE FROM photo_uploads/],
];

test("housekeeping(): `reclaimStaleJobs` yiqilsa ham qolgan qadamlar ishlaydi (DB-10)", async (t) => {
  quietConsole(t);
  const seen = mockDb(t, (sql) => /SET status = 'QUEUED', locked_by = NULL/.test(sql));
  await worker.housekeeping();
  assert.ok(seen.some((q) => /SET status = 'QUEUED', locked_by = NULL/.test(q)), "reclaim chaqirilmadi");
  for (const [name, re] of LATER_STEPS) {
    assert.ok(seen.some((q) => re.test(q)), `MUTATSIYA: «${name}» qadami birinchi xato tufayli o'tkazib yuborildi`);
  }
});

test("housekeeping(): o'rtadagi qadam (auth sessiyalari) yiqilsa ham keyingilari ishlaydi", async (t) => {
  quietConsole(t);
  const seen = mockDb(t, (sql) => /DELETE FROM sessions WHERE/.test(sql));
  await worker.housekeeping();
  assert.ok(seen.some((q) => /DELETE FROM game_sessions/.test(q)), "o'yin havolalari o'tkazib yuborildi");
  assert.ok(seen.some((q) => /DELETE FROM photo_uploads/.test(q)), "rezyume suratlari o'tkazib yuborildi");
});

test("housekeeping(): navbat muddati va saqlash muddati HAQIQATAN chaqiriladi", async (t) => {
  quietConsole(t);
  const seen = mockDb(t, () => false);
  await worker.housekeeping();
  assert.ok(seen.some((q) => /FROM generations WHERE status = 'QUEUED' AND created_at </.test(q)), "expireQueuedJobs chaqirilmadi");
  assert.ok(seen.some((q) => /g\.files_purged_at IS NULL/.test(q)), "purgeBonusFiles chaqirilmadi");
});

// ---------------------------------------------------------------------------
// C27 — LiveReporter rad etishi processni yiqitmaydi.
// ---------------------------------------------------------------------------

function pngDataUrl(): string {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${Buffer.concat([sig, Buffer.alloc(32, 2)]).toString("base64")}`;
}

test("LiveReporter: setLive/putAssets rad etilsa unhandledRejection YO'Q, stop() yechiladi (C27)", async (t) => {
  quietConsole(t);
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const meta = extractMeta(TOOL_BY_ID["slide"], { topic: "Sinov" } as never);

  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  t.after(() => process.off("unhandledRejection", onRejection));

  t.mock.method(pool(), "query", async () => {
    throw new Error("sinov: baza vaqtincha yo'q");
  });

  const r = new LiveReporter("job-x", "w-x");
  r.sink({
    type: "plan",
    slides: [{ id: "s0", layout: "bullets", title: "A" }],
    roles: ["r"],
    meta,
    theme: "atlas",
    template: "lecture",
    logo: pngDataUrl(),
  } as never);
  r.sink({ type: "image", index: 0, url: pngDataUrl() } as never);
  await new Promise((res) => setTimeout(res, 700));
  await r.stop();
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(rejections.length, 0, `MUTATSIYA: ushlanmagan rad etish: ${String(rejections[0])}`);
});

test("LiveReporter: yozuv yiqilgach keyingi hodisa qayta yozishga uriniladi", async (t) => {
  quietConsole(t);
  const { extractMeta } = await import("../lib/generation/meta.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const meta = extractMeta(TOOL_BY_ID["slide"], { topic: "Sinov" } as never);
  let n = 0;
  t.mock.method(pool(), "query", async (text: string) => {
    if (/live_seq = live_seq \+ 1/.test(text)) {
      n++;
      if (n === 1) throw new Error("sinov: bir martalik uzilish");
      return { rows: [{ live_seq: n }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const r = new LiveReporter("job-y", "w-y");
  r.sink({ type: "plan", slides: [{ id: "s0", layout: "bullets", title: "A" }], roles: ["r"], meta, theme: "atlas", template: "lecture" } as never);
  await new Promise((res) => setTimeout(res, 30));
  await r.stop();
  assert.equal(n, 2, "yiqilgan yozuvdan keyin stop() oxirgi holatni qayta yozishi kerak");
});

// ---------------------------------------------------------------------------
// C27 — alohida worker processining global himoyasi.
// ---------------------------------------------------------------------------

test("installProcessGuards: rad etish jurnalga, process davom etadi; uncaughtException → exit(1)", (t) => {
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...a: unknown[]) => errors.push(a));
  const exits: number[] = [];
  const proc = Object.assign(new EventEmitter(), {
    exit: (code?: number) => {
      exits.push(code ?? 0);
    },
  });
  worker.installProcessGuards(proc as never);

  proc.emit("unhandledRejection", new Error("vaqtincha"), Promise.resolve());
  assert.deepEqual(exits, [], "MUTATSIYA: rad etishda process chiqib ketdi");
  assert.ok(errors.some((a) => String(a[0]).includes("unhandledRejection")), "rad etish jurnalga yozilmadi");

  proc.emit("uncaughtException", new Error("haqiqiy xato"));
  assert.deepEqual(exits, [1], "MUTATSIYA: uncaughtException da nol bo'lmagan kod bilan chiqilmadi");
});
