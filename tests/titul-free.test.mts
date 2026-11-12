import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeDb, db, drainJobs, fileOf, jobOf, ledger, mkUser, resetSettings, setSetting, skip, wallet } from "./helpers/market-buy.mts";

/**
 * «Titul» is FREE and safe (real Postgres in a throwaway database, the real submit pipeline and the real worker):
 * a user with an empty wallet gets the page (price 0, no ledger row, COMPLETED with the DOCX), an admin percentage
 * cannot make it paid, a refund is a no-op, the daily cap `title.daily_limit` refuses the next one with a clear
 * Uzbek 429 (0 = unlimited), and the free page does not unlock the one-time rating bonus.
 *
 * Mutations (each turned a test red, then restored):
 *   M1. `applyPriceAdjust` without the `base <= 0` guard -> «an admin percentage keeps it free» (300 % -> 100 so'm);
 *   M2. `assertTitulDailyLimit` call removed from `prepareGeneration` -> «daily limit»;
 *   M3. `>= limit` -> `> limit` in `assertTitulDailyLimit` -> «daily limit» (a third page slips through);
 *   M4. the `tool_id <> 'title-page'` filter removed from `submitRating` -> «does not unlock the rating bonus».
 */

after(async () => {
  await closeDb();
});

const VALUES = { workType: "coursework", layout: "classic", topic: "Sun'iy intellekt", author: "Aliyev V.", faculty: "Kompyuter injiniringi", year: 2026 };

async function submit(userId: string, values: Record<string, unknown> = VALUES) {
  const { submitGeneration } = await import("../lib/server/submit-generation.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  return submitGeneration({ userId, tool: TOOL_BY_ID["title-page"], values: { ...values } as never, expectedPrice: 0 });
}

test("an empty wallet gets the page: price 0, no ledger row, the worker completes it with the DOCX", { skip }, async () => {
  await resetSettings({});
  const u = await mkUser({ balance: 0, points: 0 });
  const r = await submit(u.id);
  assert.equal(r.kind, "queued");
  assert.ok(r.kind === "queued" && r.price === 0);
  await drainJobs();
  const job = await jobOf(r.kind === "queued" ? r.id : "");
  assert.equal(job?.status, "COMPLETED", job?.error ?? "");
  assert.equal(Number(job?.price), 0);
  assert.ok(job?.doc_json?.titul?.input?.topic === "Sun'iy intellekt", "the model is stored for the viewer and edits");
  const bytes = await fileOf(r.kind === "queued" ? r.id : "");
  assert.ok(bytes && bytes.subarray(0, 2).toString() === "PK", "DOCX stored");
  assert.deepEqual(await ledger(u.id), [], "a free job writes no transaction");
  assert.deepEqual(await wallet(u.id), { balance: 0, points: 0 });
  const { refund } = await import("../lib/server/credits.ts");
  assert.equal(await refund(u.id, r.kind === "queued" ? r.id : "", "test"), false, "refund of a free job is a no-op");
  assert.deepEqual(await ledger(u.id), []);
});

test("an admin percentage keeps it free (0 stays 0)", { skip }, async () => {
  await resetSettings({});
  const { query } = await db();
  const pricing = await import("../lib/server/pricing.ts");
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ('title-page', 300, 1000) ON CONFLICT (tool_id) DO UPDATE SET percent = 300, round_to = 1000");
  pricing.invalidatePricingCache();
  try {
    const { TOOL_BY_ID } = await import("../lib/tools.ts");
    assert.equal(await pricing.effectivePrice(TOOL_BY_ID["title-page"], VALUES as never), 0);
    const u = await mkUser({ balance: 0, points: 0 });
    const r = await submit(u.id);
    assert.ok(r.kind === "queued" && r.price === 0);
  } finally {
    await query("DELETE FROM tool_pricing WHERE tool_id = 'title-page'");
    pricing.invalidatePricingCache();
  }
});

test("daily limit: the (limit+1)-th page of the day is refused with 429 daily_limit; 0 = unlimited", { skip }, async () => {
  await resetSettings({});
  await setSetting("title.daily_limit", 2);
  const u = await mkUser({ balance: 0, points: 0 });
  assert.equal((await submit(u.id)).kind, "queued");
  assert.equal((await submit(u.id)).kind, "queued");
  await assert.rejects(submit(u.id), (e: unknown) => {
    const err = e as { status?: number; message?: string; extra?: Record<string, unknown>; data?: Record<string, unknown> };
    assert.equal(err.status, 429);
    assert.match(String(err.message), /Bugun 2 ta bepul titul yaratdingiz/);
    return true;
  });
  const other = await mkUser({ balance: 0, points: 0 });
  assert.equal((await submit(other.id)).kind, "queued", "the cap is per user");
  await drainJobs(); // the queue's own in-flight cap must not be what refuses the next one
  await setSetting("title.daily_limit", 0);
  assert.equal((await submit(u.id)).kind, "queued", "0 = unlimited");
  // Other tools are not counted.
  const { titulUsedToday } = await import("../lib/server/titul-limit.ts");
  assert.equal(await titulUsedToday(u.id), 3);
});

test("the free page does not unlock the one-time rating bonus", { skip }, async () => {
  await resetSettings({});
  await setSetting("title.daily_limit", 0);
  const u = await mkUser({ balance: 0, points: 0 });
  const r = await submit(u.id);
  await drainJobs();
  assert.equal((await jobOf(r.kind === "queued" ? r.id : ""))?.status, "COMPLETED");
  const ratings = await import("../lib/server/ratings.ts");
  assert.equal((await ratings.getRatingStatus(u.id)).hasFinished, false);
  await assert.rejects(ratings.submitRating(u.id, 5, "Juda qulay xizmat, rahmat sizlarga!"), (e: unknown) => (e as { status?: number }).status === 403);
  assert.deepEqual(await wallet(u.id), { balance: 0, points: 0 });
});
