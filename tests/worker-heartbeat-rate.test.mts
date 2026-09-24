import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * HEARTBEAT YOZUV SONI (AUDIT prod-readiness DB-12, SCALE-13, W4-B).
 *
 * Ilgari `progressTicker` HAR 2 s da `generations` qatoriga yozardi
 * (soxta egri chiziqda `setProgress`, jonli rejimda `heartbeat`) — 180 s lik
 * ish = 90 ta UPDATE, hammasi `locked_at` bilan (027 gacha — indekslangan,
 * ya'ni non-HOT). Endi:
 *   - ijara (`locked_at`) kamida har `LEASE_EVERY_MS` (10 s) da yangilanadi —
 *     `reclaimStaleJobs` chegarasi (byudjet + 30 s) va qattiq to'xtash
 *     (byudjet + 15 s) bilan izchil;
 *   - soxta egri chiziq progressi faqat O'ZGARGANDA va ko'pi bilan har
 *     `PROGRESS_MIN_GAP_MS` (4 s) da yoziladi;
 *   - jonli rejimda `LiveReporter` ning o'z yozuvi (`setLive` ham `locked_at`
 *     ni suradi) ijarani yangilagan bo'lsa, alohida heartbeat yuborilmaydi.
 *
 * O'lchov (180 s, soxta taymer): soxta egri chiziq 90 → ≤ 46; jonli rejim
 * (60 s deka yozuvi, keyin 120 s sukut) 90 heartbeat → ≤ 14.
 *
 * MUTATSIYA (tasdiqlangan): `if (!due) return;` o'chirilsa (eski 2 s) —
 * soxta egri chiziq testi 90 yozuv bilan qizaradi; jonli rejim oralig'i
 * 40 s qilinsa — «ijara oralig'i ≤ 10 s» testi qizaradi.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { pool } = await import("../lib/server/db.ts");
const worker = await import("../lib/server/worker.ts");

type Call = { at: number; text: string };

function capture(t: TestContext): Call[] {
  const calls: Call[] = [];
  t.mock.method(pool(), "query", async (text: string) => {
    calls.push({ at: Date.now(), text: text.replace(/\s+/g, " ").trim() });
    return { rows: [], rowCount: 0 };
  });
  return calls;
}

const leaseWrites = (calls: Call[]) => calls.filter((c) => /^UPDATE generations SET .*locked_at = now\(\)/.test(c.text));

function maxGap(times: number[], end: number): number {
  let prev = 0;
  let gap = 0;
  for (const at of [...times, end]) {
    gap = Math.max(gap, at - prev);
    prev = at;
  }
  return gap;
}

const JOB = { id: "job-hb", userId: "u1", toolId: "essay", values: {}, price: 1, attempts: 1, budgetMs: 285_000, lease: "w:1" };

async function advance(t: TestContext, ms: number, step = 1000, each?: (now: number) => void) {
  for (let done = 0; done < ms; done += step) {
    t.mock.timers.tick(step);
    each?.(Date.now());
    await new Promise((r) => setImmediate(r));
  }
}

test("soxta egri chiziq: 180 s da ≤ 46 yozuv (ilgari 90), ijara oralig'i ≤ 10 s", async (t) => {
  const calls = capture(t);
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const stop = worker.progressTicker(JOB as never, null);
  await advance(t, 180_000);
  stop();
  const writes = leaseWrites(calls);
  t.diagnostic(`soxta egri chiziq, 180 s: ${writes.length} ta UPDATE (ilgari 90)`);
  assert.ok(writes.length <= 46, `180 s da ${writes.length} ta yozuv (≤ 46 kutilgan)`);
  assert.ok(writes.length >= 18, `ijara yangilanmay qoldi: ${writes.length}`);
  assert.ok(maxGap(writes.map((w) => w.at), 180_000) <= worker.LEASE_EVERY_MS, "ijara oralig'i 10 s dan oshdi");
  // Har yozuv progressni ham olib boradi (soxta egri chiziq to'xtamagan).
  assert.ok(writes.every((w) => /SET progress = \$3, step = \$4/.test(w.text)));
});

test("jonli rejim: deka yozuvi ijarani yangilasa heartbeat yo'q; sukutda har 10 s", async (t) => {
  const calls = capture(t);
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  // `LiveReporter` o'rnida: faqat worker o'qiydigan ikki maydon.
  const live = { started: true, lastWriteAt: -Infinity };
  const stop = worker.progressTicker({ ...JOB, toolId: "slide" } as never, live as never);
  const liveWrites: number[] = [];
  await advance(t, 180_000, 1000, (now) => {
    // Birinchi 60 s — dvigatel har soniyada deka yuboradi (setLive yozuvi), keyin 120 s sukut (LLM kutish).
    if (now <= 60_000) {
      live.lastWriteAt = now;
      liveWrites.push(now);
    }
  });
  stop();
  const beats = calls.filter((c) => /^UPDATE generations SET locked_at = now\(\)/.test(c.text));
  t.diagnostic(`jonli rejim, 180 s: ${beats.length} ta heartbeat (ilgari 90)`);
  assert.ok(beats.length <= 14, `180 s da ${beats.length} ta heartbeat (≤ 14 kutilgan; ilgari 90)`);
  const touches = [...beats.map((b) => b.at), ...liveWrites].sort((a, b) => a - b);
  assert.ok(maxGap(touches, 180_000) <= worker.LEASE_EVERY_MS, "jonli rejimda ijara oralig'i 10 s dan oshdi");
});
