import "./helpers/next-request.mts";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Admin pricing and pause, server side (docs/admin/02-plan.md §6.10, §17.2, §17.8).
 *
 * `lib/server/pricing.ts`: no row → no adjustment; a row applies after the
 * 15 s cache is invalidated; invalid rows and a failing DB never throw.
 * `POST /api/generations`: charges the adjusted price; `generation.paused` /
 * `generation.paused_tools` → 503 with nothing charged or queued; a stale
 * `expectedPrice` → 409 `price_changed` with nothing charged or queued; a
 * malformed one → 400; an idempotent replay still returns the original job
 * after a price change or a pause. `GET /api/auth/session` exposes
 * `features.pricing` for non-default tools only.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("pricing") : { isolated: false, drop: async () => {} };
const skip = !hasDb ? "DATABASE_URL yo'q" : iso.isolated ? false : "alohida Postgres baza yaratilmadi";

test("narx sozlamasi va to'xtatish (haqiqiy Postgres)", { skip }, async (t) => {
  const { query, migrate, pool } = await import("../lib/server/db.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  const { env } = await import("../lib/server/env.ts");
  const pricing = await import("../lib/server/pricing.ts");
  const settings = await import("../lib/server/settings.ts");
  const { applyPriceAdjust, basePriceFor, TOOL_BY_ID } = await import("../lib/tools.ts");
  const route = await import("../app/api/generations/route.ts");
  const sessionRoute = await import("../app/api/auth/session/route.ts");
  await migrate({ lockRetryDelayMs: 50 });
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 10, totalSlots: 8, meanServiceSec: 200, maxWaitSec: 100_000 });
  t.after(async () => {
    await pool().end().catch(() => {});
    await iso.drop();
  });

  const setPrice = async (toolId: string, percent: number, roundTo: number) => {
    await query(
      `INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ($1, $2, $3)
       ON CONFLICT (tool_id) DO UPDATE SET percent = EXCLUDED.percent, round_to = EXCLUDED.round_to, updated_at = now()`,
      [toolId, percent, roundTo],
    );
    pricing.invalidatePricingCache();
  };
  const clearPrices = async () => {
    await query("DELETE FROM tool_pricing");
    pricing.invalidatePricingCache();
  };
  const setSetting = async (key: string, value: unknown) => {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
    settings.invalidateSettingsCache();
  };
  const clearSettings = async () => {
    await query("DELETE FROM app_settings");
    settings.invalidateSettingsCache();
  };

  const mkUser = async (name: string) => {
    const uid = String(
      (
        await query<{ id: string }>(
          `INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Test', 0, 0, 100000) RETURNING id`,
          [`${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
        )
      )[0].id,
    );
    const { token } = await createSession(uid);
    return { uid, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const ESSAY_VALUES = { topic: "Suv aylanishi", essayContext: "academic", essayKind: "argumentative" };
  const ESSAY_BASE = basePriceFor(TOOL_BY_ID.essay, ESSAY_VALUES);
  const post = async (cookie: string, extra: Record<string, unknown> = {}, key?: string) => {
    const headers: Record<string, string> = { cookie, "content-type": "application/json" };
    if (key !== undefined) headers["idempotency-key"] = key;
    // The route allows 5 POSTs per user per minute; this file sends more on purpose.
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const body = JSON.stringify({ slug: "essay", values: ESSAY_VALUES, ...extra });
    const req = new Request("http://localhost/api/generations", { method: "POST", headers, body });
    const res = await inRequest(req, () => route.POST(req));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const balance = async (uid: string) => Number((await query<{ balance: string }>(`SELECT balance FROM users WHERE id = $1`, [uid]))[0].balance);
  const jobs = async (uid: string) =>
    (await query<{ id: string; price: number }>(`SELECT id, price FROM generations WHERE user_id = $1 ORDER BY created_at`, [uid])).map(
      (r) => ({ id: r.id, price: Number(r.price) }),
    );
  const charges = async (uid: string) =>
    Number((await query<{ n: string }>(`SELECT count(*) AS n FROM transactions WHERE user_id = $1 AND kind = 'charge'`, [uid]))[0].n);
  const nothingHappened = async (uid: string) => {
    assert.deepEqual(await jobs(uid), [], "ish yaratilmasligi kerak edi");
    assert.equal(await charges(uid), 0, "pul yechilmasligi kerak edi");
    assert.equal(await balance(uid), 100_000);
  };

  // ------------------------------------------------------------------ pricing module

  await t.test("getToolPricing: qator yo'q → null; getAllToolPricing → {}", async () => {
    await clearPrices();
    assert.equal(await pricing.getToolPricing("essay"), null);
    assert.deepEqual(await pricing.getAllToolPricing(), {});
    assert.equal(await pricing.effectivePrice(TOOL_BY_ID.essay, ESSAY_VALUES), ESSAY_BASE);
  });

  await t.test("getToolPricing: qator kuchga kiradi; kesh invalidatsiyagacha eski qiymat", async () => {
    await setPrice("essay", 150, 1000);
    assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 150, roundTo: 1000 });
    assert.equal(
      await pricing.effectivePrice(TOOL_BY_ID.essay, ESSAY_VALUES),
      applyPriceAdjust(ESSAY_BASE, { percent: 150, roundTo: 1000 }),
    );
    // Written by another process (no invalidation here): the 15 s snapshot still serves the old row.
    await query("UPDATE tool_pricing SET percent = 200 WHERE tool_id = 'essay'");
    assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 150, roundTo: 1000 });
    pricing.invalidatePricingCache();
    assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 200, roundTo: 1000 });
    // A caller cannot mutate the shared snapshot.
    const got = await pricing.getToolPricing("essay");
    got!.percent = 999;
    assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 200, roundTo: 1000 });
    await clearPrices();
  });

  await t.test("yaroqsiz qatorlar e'tiborsiz (noma'lum vosita); 100 % — standart", async () => {
    await query("INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ('no-such-tool', 300, 500), ('image', 100, 1000)");
    await setPrice("slide", 80, 500);
    assert.deepEqual(await pricing.getAllToolPricing(), { slide: { percent: 80, roundTo: 500 } });
    assert.equal(await pricing.getToolPricing("image"), null);
    await clearPrices();
  });

  await t.test("baza xatosi: snapshot yo'q → tuzatishsiz; snapshot bor → oxirgi yaxshi qiymat; xato tashlanmaydi", async () => {
    const off = () => query("ALTER TABLE tool_pricing RENAME TO tool_pricing_off");
    const on = () => query("ALTER TABLE tool_pricing_off RENAME TO tool_pricing");
    // No good snapshot yet: the global cache is reset to simulate a fresh process.
    (globalThis as { __slaydxPricingCache?: unknown }).__slaydxPricingCache = undefined;
    await off();
    try {
      assert.equal(await pricing.getToolPricing("essay"), null);
      assert.deepEqual(await pricing.getAllToolPricing(), {});
    } finally {
      await on();
    }
    await setPrice("essay", 120, 500);
    assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 120, roundTo: 500 });
    await off();
    try {
      pricing.invalidatePricingCache();
      assert.deepEqual(await pricing.getToolPricing("essay"), { percent: 120, roundTo: 500 });
    } finally {
      await on();
    }
    await clearPrices();
  });

  // ------------------------------------------------------------------ POST /api/generations

  await t.test("narx sozlamasiz: o'sha formula narxi yechiladi; to'g'ri expectedPrice ham o'tadi", async () => {
    await clearPrices();
    const u = await mkUser("price-default");
    const a = await post(u.cookie);
    assert.equal(a.status, 202, JSON.stringify(a.body));
    assert.equal(a.body.price, ESSAY_BASE);
    const b = await post(u.cookie, { expectedPrice: ESSAY_BASE });
    assert.equal(b.status, 202, JSON.stringify(b.body));
    assert.deepEqual((await jobs(u.uid)).map((j) => j.price), [ESSAY_BASE, ESSAY_BASE]);
    assert.equal(await balance(u.uid), 100_000 - 2 * ESSAY_BASE);
  });

  await t.test("tuzatilgan narx yechiladi (generations.price ham, balans ham)", async () => {
    await setPrice("essay", 150, 1000);
    const want = applyPriceAdjust(ESSAY_BASE, { percent: 150, roundTo: 1000 });
    assert.notEqual(want, ESSAY_BASE);
    const u = await mkUser("price-adjusted");
    const res = await post(u.cookie, { expectedPrice: want });
    assert.equal(res.status, 202, JSON.stringify(res.body));
    assert.equal(res.body.price, want);
    assert.deepEqual((await jobs(u.uid)).map((j) => j.price), [want]);
    assert.equal(await balance(u.uid), 100_000 - want);
    // An old client without expectedPrice is charged the current (adjusted) price, as before the guard existed.
    const old = await post(u.cookie);
    assert.equal(old.status, 202);
    assert.equal(old.body.price, want);
    await clearPrices();
  });

  await t.test("expectedPrice farq qilsa → 409 price_changed, pul ham ish ham yo'q", async () => {
    await setPrice("essay", 150, 1000);
    const want = applyPriceAdjust(ESSAY_BASE, { percent: 150, roundTo: 1000 });
    const u = await mkUser("price-409");
    const res = await post(u.cookie, { expectedPrice: ESSAY_BASE }, randomUUID());
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, "price_changed");
    assert.equal(res.body.price, want);
    assert.equal(res.body.error, `Narx o'zgardi. Yangi narx: ${want.toLocaleString("uz-UZ")} tanga.`);
    await nothingHappened(u.uid);
    await clearPrices();
  });

  await t.test("noto'g'ri expectedPrice → 400 (manfiy, kasr, matn, null), pul yo'q", async () => {
    const u = await mkUser("price-400");
    for (const bad of [-1, 1.5, "3000", null]) {
      const res = await post(u.cookie, { expectedPrice: bad });
      assert.equal(res.status, 400, `${JSON.stringify(bad)} → ${JSON.stringify(res.body)}`);
    }
    await nothingHappened(u.uid);
  });

  await t.test("generation.paused → 503 paused, pul ham ish ham yo'q", async () => {
    await setSetting("generation.paused", true);
    const u = await mkUser("paused-all");
    try {
      const res = await post(u.cookie, { expectedPrice: ESSAY_BASE }, randomUUID());
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.deepEqual(res.body, { error: "Xizmat vaqtincha to'xtatilgan. Birozdan keyin urinib ko'ring.", code: "paused" });
      await nothingHappened(u.uid);
    } finally {
      await clearSettings();
    }
    const after = await post(u.cookie, { expectedPrice: ESSAY_BASE });
    assert.equal(after.status, 202, "to'xtatish olib tashlangach yana ishlaydi");
  });

  await t.test("generation.paused_tools: faqat ro'yxatdagi vosita to'xtaydi", async () => {
    await setSetting("generation.paused_tools", ["essay"]);
    const u = await mkUser("paused-tool");
    try {
      const res = await post(u.cookie);
      assert.equal(res.status, 503, JSON.stringify(res.body));
      assert.equal(res.body.code, "paused");
      await nothingHappened(u.uid);
      await setSetting("generation.paused_tools", ["slide", "image"]);
      const other = await post(u.cookie);
      assert.equal(other.status, 202, JSON.stringify(other.body));
    } finally {
      await clearSettings();
    }
  });

  await t.test("takror (Idempotency-Key): narx o'zgargandan va to'xtatilgandan keyin ham ASL ish qaytadi", async () => {
    await clearPrices();
    const u = await mkUser("price-replay");
    const key = randomUUID();
    const first = await post(u.cookie, { expectedPrice: ESSAY_BASE }, key);
    assert.equal(first.status, 202, JSON.stringify(first.body));

    // Price raised after the first request was charged; the client retries the
    // same intent (same key) after a lost response, with either price.
    await setPrice("essay", 200, 500);
    for (const expectedPrice of [ESSAY_BASE, applyPriceAdjust(ESSAY_BASE, { percent: 200, roundTo: 500 }), undefined]) {
      const again = await post(u.cookie, expectedPrice === undefined ? {} : { expectedPrice }, key);
      assert.equal(again.status, 202, JSON.stringify(again.body));
      assert.deepEqual(again.body, first.body, "takror asl javobni qaytarishi kerak");
    }
    // Paused after the original was accepted: the replay still reports the paid job.
    await setSetting("generation.paused", true);
    try {
      const paused = await post(u.cookie, { expectedPrice: ESSAY_BASE }, key);
      assert.equal(paused.status, 202, JSON.stringify(paused.body));
      assert.deepEqual(paused.body, first.body);
      // A NEW key while paused is refused.
      const fresh = await post(u.cookie, { expectedPrice: ESSAY_BASE }, randomUUID());
      assert.equal(fresh.status, 503);
    } finally {
      await clearSettings();
    }
    assert.deepEqual((await jobs(u.uid)).map((j) => j.price), [ESSAY_BASE]);
    assert.equal(await charges(u.uid), 1);
    assert.equal(await balance(u.uid), 100_000 - ESSAY_BASE);
    await clearPrices();
  });

  await t.test("o'sha kalit, BOSHQA forma → 422 (narx/to'xtatish tekshiruvi buni yashirmaydi), pul yo'q", async () => {
    const u = await mkUser("price-conflict");
    const key = randomUUID();
    const first = await post(u.cookie, { expectedPrice: ESSAY_BASE }, key);
    assert.equal(first.status, 202);
    await setPrice("essay", 300, 1000);
    const headers = { cookie: u.cookie, "content-type": "application/json", "idempotency-key": key };
    const body = JSON.stringify({ slug: "essay", values: { ...ESSAY_VALUES, topic: "Boshqa mavzu" }, expectedPrice: ESSAY_BASE });
    const req = new Request("http://localhost/api/generations", { method: "POST", headers, body });
    const res = await inRequest(req, () => route.POST(req));
    assert.equal(res.status, 422);
    assert.equal(await charges(u.uid), 1);
    await clearPrices();
  });

  // ------------------------------------------------------------------ GET /api/auth/session

  const session = async () => {
    const req = new Request("http://localhost/api/auth/session");
    const res = await inRequest(req, () => sessionRoute.GET(req));
    assert.equal(res.status, 200);
    return (await res.json()) as { user: unknown; features: Record<string, unknown> };
  };

  await t.test("sessiya: features.pricing — faqat standart bo'lmagan vositalar", async () => {
    await clearPrices();
    const empty = await session();
    assert.deepEqual(empty.features.pricing, {});
    assert.deepEqual(
      Object.keys(empty.features).sort(),
      ["devLogin", "images", "llm", "payments", "pdf", "pricing", "telegram", "telegramBot"],
      "boshqa kalitlar o'zgarmagan",
    );
    await setPrice("slide", 120, 500);
    await setPrice("essay", 100, 1000);
    const one = await session();
    assert.deepEqual(one.features.pricing, { slide: { percent: 120, roundTo: 500 } });
    await clearPrices();
  });
});
