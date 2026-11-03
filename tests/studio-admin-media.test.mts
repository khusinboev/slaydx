import "./helpers/next-request.mts";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Admin «Narxlar» → «Media modellari» (docs/studio/P1-SPEC.md «Admin»), 2FA mode (step-up enforced):
 *   read     per Studio model: cost per picture (USD, so'm), price at the current markup (+ tool_pricing %), margin,
 *            switch, override — the price is the charging function's;
 *   write    `pricing.edit` only (finance / viewer 403 + denied audit, support 403), stale step-up 401 reauth, no
 *            Origin 403, reason required, bad markup 400, unknown model 404; override row + audit
 *            `media_model.update` (before/after/reason) in one transaction; unchanged 409 `state`, `expected` stale
 *            409 `stale`; default state removes the row;
 *   effect   after the write the catalog pricing block, `effectivePrice` and the real charge follow the new markup;
 *            an old `expectedPrice` is 409 `price_changed`; switching the model off hides it and the route refuses it.
 *
 * Mutations (each turned the named test red, then restored): audit call removed -> "write"; audit `before` = next ->
 * "write"; `invalidateMediaOverrides()` dropped after COMMIT -> "effect" (catalog keeps the old markup); `expected`
 * check disabled -> "write" (409 stale); permission `pricing.view` on PUT -> "roles"; overview priced with the global
 * markup instead of `markupOf` -> "read" (override row).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.APP_URL = "http://localhost:3000";
process.env.TRUST_PROXY = "true";
process.env.WORKER_INLINE = "false";
process.env.ADMIN_TOTP_KEY = randomBytes(32).toString("base64");
process.env.ADMIN_2FA_REQUIRED = "true";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.OPENAI_API_KEY = "sk-test-openai-key-123456";
// P2a: with the fal key every Studio model is ready, so the block lists all seven as sellable.
process.env.FAL_KEY = "test-fal-key-0000:abcdef";
const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";
const skip = hasDb ? false : "DATABASE_URL yo'q";
const iso = hasDb ? await createIsolatedDb("studioadmin") : { isolated: false, drop: async () => {} };

const { query, queryOne, ensureMigrated, transaction, pool } = await import("../lib/server/db.ts");
const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
const { createAdminSession, adminCookieName } = await import("../lib/server/admin-session.ts");
const { env } = await import("../lib/server/env.ts");
const { getSetting, invalidateSettingsCache } = await import("../lib/server/settings.ts");
const { effectivePrice, invalidatePricingCache } = await import("../lib/server/pricing.ts");
const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
const { reloadProviderKeys, stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");
const { IMAGE_PRICES, OPENAI_IMAGE_FALLBACK_USD } = await import("../lib/generation/llm-pricing.ts");
const mediaRoute = await import("../app/api/admin/pricing/media/route.ts");
const catalogRoute = await import("../app/api/media/catalog/route.ts");
const generationsRoute = await import("../app/api/generations/route.ts");

const NANO = "google/nano-banana";
const GPT = "openai/gpt-image";
/** P3: the Studio Video tab's models, listed after the pictures (Gemini Omni + Kling 3.0 tiers + effects); P4 adds the fal models. */
const STUDIO_VIDEO_IDS = ["google/omni-video", "kling/kling-3", "kling/kling-3-pro", "alibaba/wan-3", "bytedance/seedance-2.5", "bytedance/seedance-2-mini", "minimax/h3", "minimax/h3-max-turbo", "openai/sora-2", "openai/sora-2-pro", "kling/effects"];
/** P5: the «Ovoz» tab's speech models, listed after the video ones; one unit = 1 000 characters (the clone is a fixed price, not here). */
const STUDIO_SPEECH_IDS = ["elevenlabs/eleven-v3", "google/gemini-tts", "elevenlabs/v3-dialogue", "google/gemini-dialogue"];
/**
 * P6: the «Audio» tab's four models, listed last; one unit = 1 minute of music / of input audio, 10 s of a sound effect.
 * Prices at ×2 and the default 12 700 so'm/$ (P6-SPEC price table): 15 cr/s × 60 s, 40 cr/s × 10 s, 1 000 cr / min.
 */
const STUDIO_AUDIO: Record<string, { unit: string; values: Record<string, unknown>; price: number }> = {
  "elevenlabs/music": { unit: "1 daqiqa", values: { length: "60" }, price: 4_200 },
  // P9: Lyria on the Gemini key, per song ($0.08 × 12 700 × 2 = 2 032 → 2 100).
  "google/lyria-3": { unit: "1 qo‘shiq", values: { length: "song" }, price: 2_100 },
  "elevenlabs/sfx": { unit: "10 soniya", values: { duration: 10 }, price: 1_900 },
  "elevenlabs/voice-changer": { unit: "1 daqiqa", values: { inputSeconds: 60 }, price: 4_700 },
  "elevenlabs/isolator": { unit: "1 daqiqa", values: { inputSeconds: 60 }, price: 4_700 },
};
const STUDIO_AUDIO_IDS = Object.keys(STUDIO_AUDIO);
/**
 * P10: «Transkripsiya» / «Dublyaj», listed after the «Audio» models; one unit = 1 minute of the source. At ×2 and
 * 12 700 so'm/$ (P10-SPEC): STT 330 cr / min → 1 524 → 1 600; dubbing 3 000 cr / min → 13 854 → 13 900.
 */
const STUDIO_P10: Record<string, { tool: "studio-transcribe" | "studio-dub"; price: number }> = {
  "elevenlabs/scribe-v2": { tool: "studio-transcribe", price: 1_600 },
  "elevenlabs/dubbing": { tool: "studio-dub", price: 13_900 },
};
const STUDIO_P10_IDS = Object.keys(STUDIO_P10);
/** P2a: the fal models (key set above) — one picture at the default params (Ideogram: «Standart» quality, $0.06). */
const FAL_USD: Record<string, number> = {
  "bfl/flux": 0.048,
  "bytedance/seedream": 0.035,
  "bytedance/seedream-pro": 0.0675,
  "ideogram/ideogram": 0.06,
  "recraft/recraft": 0.035,
  "recraft/recraft-pro": 0.21,
};
/** P2b (docs/studio/P2B-SPEC.md): the edit / upscale / background-removal models, managed by the same block. */
const P2B_USD: Record<string, number> = {
  "google/nano-banana-edit": IMAGE_PRICES["gemini-3.1-flash-lite-image"]!,
  "bytedance/seedream-edit": 0.035,
  "bytedance/seedvr-upscale": 0.0168,
  "bria/background-remove": 0.018,
};
const USD: Record<string, number> = { [NANO]: IMAGE_PRICES["gemini-3.1-flash-lite-image"]!, [GPT]: OPENAI_IMAGE_FALLBACK_USD, ...FAL_USD, ...P2B_USD };
const STUDIO = TOOL_BY_ID["studio-image"];
const REASON = "Provayder narxi oshgani uchun ustama tuzatildi";
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;

after(async () => {
  if (!hasDb) return;
  stopProviderKeyRefresh();
  await pool().end();
  await iso.drop();
});
if (hasDb) {
  await ensureMigrated();
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  await reloadProviderKeys();
}

type Role = "owner" | "admin" | "finance" | "support" | "viewer";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
async function mkUser(balance = 0) {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO users (telegram_id, username, name, points, quota, balance) VALUES ($1, $2, 'Media Admin', 0, 0, $3) RETURNING id::text AS id`,
    [String(randomInt(5_000_000_000, 9_000_000_000)), `m_${randomBytes(5).toString("hex")}`, balance],
  );
  const { token } = await createSession(row!.id);
  return { id: row!.id, token };
}
async function session(role: Role, reauth = true) {
  const u = await mkUser();
  const a = await queryOne<{ id: string }>(
    `INSERT INTO admin_accounts (user_id, role, status, totp_enabled_at, totp_secret_enc) VALUES ($1, $2, 'active', now(), 'v1.fixture-never-opened') RETURNING id::text AS id`,
    [u.id, role],
  );
  const us = await queryOne<{ id: string }>(`SELECT id::text AS id FROM sessions WHERE token_hash = $1`, [sha256(u.token)]);
  const s = await transaction((c) => createAdminSession(c, { adminId: a!.id, userSessionId: us!.id, ip: "10.0.0.1", userAgent: "media-test", reauth }));
  return { cookie: `${SESSION_COOKIE}=${u.token}; ${adminCookieName()}=${s.token}`, adminId: a!.id };
}
const headers = (cookie: string | null, origin = true) => {
  const h: Record<string, string> = { host: "localhost:3000", "x-forwarded-for": "10.1.2.3", "user-agent": "media-test", "content-type": "application/json" };
  if (cookie) h.cookie = cookie;
  if (origin) h.origin = "http://localhost:3000";
  return h;
};
/** The fields these tests read from the three endpoints (admin overview, catalog, generations). */
type Model = {
  modelId: string;
  unit: string;
  id: string;
  costUsd: number;
  costSoum: number;
  price: number;
  priceBase: number;
  marginSoum: number;
  marginPct: number;
  enabled: boolean;
  available: boolean;
  providerReady: boolean;
  markupOverride: number | null;
  markup: number;
};
type Body = { code?: string; price?: number; id?: string; markup?: number; soumPerUsd?: number; defaultModelId?: string | null; models: Model[]; pricing: { overrides: unknown } };
async function read(r: Response) {
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : {}) as Body };
}
const get = async (cookie: string | null) => {
  const req = new Request("http://localhost:3000/api/admin/pricing/media", { headers: headers(cookie, false) });
  return read(await inRequest(req, () => mediaRoute.GET(req, undefined)));
};
const put = async (cookie: string | null, body: unknown, origin = true) => {
  const req = new Request("http://localhost:3000/api/admin/pricing/media", { method: "PUT", headers: headers(cookie, origin), body: JSON.stringify(body) });
  return read(await inRequest(req, () => mediaRoute.PUT(req, undefined)));
};
const catalog = async () => {
  const req = new Request("http://localhost/api/media/catalog?purpose=studio.image", { headers: { "x-forwarded-for": `10.7.${randomInt(0, 250)}.${randomInt(0, 250)}` } });
  return read(await inRequest(req, () => catalogRoute.GET(req)));
};
const audits = (adminId: string, action: string) =>
  query<{ outcome: string; target_type: string; target_id: string; reason: string; before: unknown; after: unknown; meta: unknown }>(
    "SELECT outcome, target_type, target_id, reason, before, after, meta FROM admin_audit_log WHERE admin_id = $1 AND action = $2 ORDER BY id",
    [adminId, action],
  );
const rows = () => query<{ model_id: string; enabled: boolean | null; markup: string | null; updated_by: string | null }>("SELECT model_id, enabled, markup::text, updated_by::text FROM media_model_overrides ORDER BY model_id");
const DEF = { enabled: true, markup: null };

test("Media modellari: read, roles, write + audit, conflicts, effect on the price and the catalog", { skip }, async (t) => {
  const owner = await session("owner");
  const rate = await getSetting("finance.soum_per_usd");

  await t.test("read: cost, price at ×2, margin per Studio model", async () => {
    const r = await get(owner.cookie);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.markup, 2);
    assert.equal(r.body.soumPerUsd, rate);
    // The block lists every Studio model by itself (catalog + purpose): the pictures with the fal ones (P2a), the P2b
    // edit / utility models, then the Video tab's models (P3; their per-clip numbers are checked in tests/studio-video.test.mts).
    assert.deepEqual(r.body.models.map((m: { modelId: string }) => m.modelId), [NANO, GPT, ...Object.keys(FAL_USD), ...Object.keys(P2B_USD), ...STUDIO_VIDEO_IDS, ...STUDIO_SPEECH_IDS, ...STUDIO_AUDIO_IDS, ...STUDIO_P10_IDS]);
    // P10: one minute of the source, priced by the charging function of its own tool.
    for (const m of r.body.models.filter((x) => STUDIO_P10_IDS.includes(x.modelId))) {
      const want = STUDIO_P10[m.modelId]!;
      assert.equal(m.unit, "1 daqiqa", m.modelId);
      if (rate === 12_700) assert.equal(m.price, want.price, `${m.modelId}: the P10-SPEC price`);
      assert.equal(m.price, up100(m.costUsd * rate * 2), m.modelId);
      assert.equal(m.price, await effectivePrice(TOOL_BY_ID[want.tool], { source: "upload:" + "a".repeat(24), sourceSeconds: 60 }), `${m.modelId}: the charging function`);
    }
    // P6: an «Audio» row is priced by the charging function of `studio-audio` (seconds × credit rate × markup).
    for (const m of r.body.models.filter((x) => STUDIO_AUDIO_IDS.includes(x.modelId))) {
      const want = STUDIO_AUDIO[m.modelId]!;
      assert.equal(m.unit, want.unit, m.modelId);
      if (rate === 12_700) assert.equal(m.price, want.price, `${m.modelId}: the P6-SPEC price`);
      assert.equal(m.price, up100(m.costUsd * rate * 2), m.modelId);
      assert.equal(m.price, await effectivePrice(TOOL_BY_ID["studio-audio"], { modelId: m.modelId, ...want.values }), `${m.modelId}: the charging function`);
    }
    // P5: a speech row is priced per 1 000 characters by the charging function of `studio-speech`.
    for (const m of r.body.models.filter((x) => STUDIO_SPEECH_IDS.includes(x.modelId))) {
      const field = m.modelId.endsWith("-dialogue") ? "script" : "text";
      assert.equal(m.unit, "1 000 belgi");
      assert.equal(m.price, up100(m.costUsd * rate * 2), m.modelId);
      assert.equal(m.price, await effectivePrice(TOOL_BY_ID["studio-speech"], { modelId: m.modelId, [field]: "x".repeat(1000) }), `${m.modelId}: the charging function`);
    }
    for (const m of r.body.models.filter((x) => !STUDIO_VIDEO_IDS.includes(x.modelId) && !STUDIO_SPEECH_IDS.includes(x.modelId) && !STUDIO_AUDIO_IDS.includes(x.modelId) && !STUDIO_P10_IDS.includes(x.modelId))) {
      const usd = USD[m.modelId]!;
      assert.equal(m.costUsd, usd);
      assert.equal(m.costSoum, Math.round(usd * rate * 100) / 100);
      assert.equal(m.price, up100(usd * rate * 2));
      assert.equal(m.priceBase, m.price, "no tool_pricing row");
      assert.equal(m.price, await effectivePrice(STUDIO, { modelId: m.modelId, imageCount: 1 }), "the charging function");
      assert.equal(m.marginSoum, Math.round((m.price - m.costSoum) * 100) / 100);
      assert.ok(m.marginPct > 0 && m.marginPct < 100);
      assert.equal(m.enabled, true);
      assert.equal(m.available, true);
      assert.equal(m.providerReady, true);
      assert.equal(m.markupOverride, null);
    }
    // P4: the fal video models appear by themselves (fal keyed above): one unit = a default clip (5 s at 720p / 768p),
    // priced by the Video tab's function; availability follows the fal key (+ `video.enabled` for the tab itself).
    const FAL_VIDEO: Record<string, { usd: number; price: number }> = {
      "alibaba/wan-3": { usd: 0.5, price: 12_700 },
      "bytedance/seedance-2.5": { usd: 2.365, price: 60_100 },
      "bytedance/seedance-2-mini": { usd: 0.7735, price: 19_700 },
      "minimax/h3": { usd: 0.3, price: 7_700 },
      "minimax/h3-max-turbo": { usd: 0.2, price: 5_100 },
    };
    for (const [id, want] of Object.entries(FAL_VIDEO)) {
      const m = r.body.models.find((x: { modelId: string }) => x.modelId === id)!;
      assert.ok(m, id);
      assert.equal(m.unit, "5 soniya");
      assert.equal(Math.round(m.costUsd * 1e4) / 1e4, want.usd, id);
      if (rate === 12_700) assert.equal(m.price, want.price, id);
      assert.equal(m.price, up100(m.costUsd * rate * 2), id);
      assert.equal(m.providerReady, true);
      assert.equal(m.available, true);
    }
  });

  await t.test("roles: finance/viewer read but 403 + denied audit on PUT; support 403; stale step-up 401; no Origin 403; non-admin 404", async () => {
    for (const role of ["finance", "viewer"] as const) {
      const s = await session(role);
      assert.equal((await get(s.cookie)).status, 200, role);
      const p = await put(s.cookie, { modelId: NANO, enabled: true, markup: 3, reason: REASON });
      assert.equal(p.status, 403, role);
      const denied = await audits(s.adminId, "auth.denied");
      assert.equal(denied.length, 1);
      assert.deepEqual(denied[0].meta, { permission: "pricing.edit", scope: "admin/pricing/media/update" });
    }
    const support = await session("support");
    assert.equal((await get(support.cookie)).status, 403);
    const stale = await session("owner", false);
    const r = await put(stale.cookie, { modelId: NANO, enabled: true, markup: 3, reason: REASON });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "reauth");
    assert.equal((await put(owner.cookie, { modelId: NANO, enabled: true, markup: 3, reason: REASON }, false)).status, 403);
    const plain = await mkUser();
    assert.equal((await put(`${SESSION_COOKIE}=${plain.token}`, { modelId: NANO, enabled: true, markup: 3, reason: REASON })).status, 404);
    assert.deepEqual(await rows(), [], "nothing written");
  });

  await t.test("validation: reason, markup bounds, enabled type, unknown model", async () => {
    const bad: [unknown, number][] = [
      [{ modelId: NANO, enabled: true, markup: 3 }, 400],
      [{ modelId: NANO, enabled: true, markup: 3, reason: "abc" }, 400],
      [{ modelId: NANO, enabled: true, markup: 0.5, reason: REASON }, 400],
      [{ modelId: NANO, enabled: true, markup: 21, reason: REASON }, 400],
      [{ modelId: NANO, enabled: true, markup: "3", reason: REASON }, 400],
      [{ modelId: NANO, enabled: "yes", markup: null, reason: REASON }, 400],
      [{ modelId: NANO, enabled: true, markup: 3, reason: REASON, expected: "x" }, 400],
      [{ modelId: "google/tts", enabled: true, markup: 3, reason: REASON }, 404],
      [{ modelId: "nope/x", enabled: true, markup: 3, reason: REASON }, 404],
    ];
    for (const [body, status] of bad) assert.equal((await put(owner.cookie, body)).status, status, JSON.stringify(body));
    assert.deepEqual(await rows(), []);
  });

  await t.test("write + effect: markup ×3 on Nano Banana -> row, audit, catalog, effectivePrice and the real charge follow", async () => {
    // A buyer saw the ×2 price before the change.
    const buyer = await mkUser(100_000);
    const values = { modelId: NANO, prompt: "Registon maydoni", imageStyle: "photo", imageRatio: "1:1", imageCount: 2 };
    const oldPrice = await effectivePrice(STUDIO, values);
    assert.equal(oldPrice, up100(USD[NANO] * 2 * rate * 2));

    const r = await put(owner.cookie, { modelId: NANO, enabled: true, markup: 3, reason: REASON, expected: DEF });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const nano = r.body.models.find((m) => m.modelId === NANO)!;
    assert.equal(nano.markupOverride, 3);
    assert.equal(nano.markup, 3);
    assert.equal(nano.price, up100(USD[NANO] * rate * 3));
    assert.equal(r.body.models.find((m) => m.modelId === GPT)!.markup, 2, "the other model keeps the global markup");
    assert.deepEqual(await rows(), [{ model_id: NANO, enabled: null, markup: "3.000", updated_by: owner.adminId }]);
    const a = await audits(owner.adminId, "media_model.update");
    assert.equal(a.length, 1);
    assert.equal(a[0].outcome, "ok");
    assert.equal(a[0].target_type, "media_model");
    assert.equal(a[0].target_id, NANO);
    assert.equal(a[0].reason, REASON);
    assert.deepEqual(a[0].before, DEF);
    assert.deepEqual(a[0].after, { enabled: true, markup: 3 });

    const c = await catalog();
    assert.deepEqual(c.body.pricing.overrides, { [NANO]: { markup: 3 } }, "catalog sees the write at once in this process");
    const newPrice = await effectivePrice(STUDIO, values);
    assert.equal(newPrice, up100(USD[NANO] * 2 * rate * 3));

    const post = async (expectedPrice: number) => {
      await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
      const req = new Request("http://localhost/api/generations", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${buyer.token}`, "content-type": "application/json", "idempotency-key": randomUUID() },
        body: JSON.stringify({ slug: "studio", values, expectedPrice }),
      });
      return read(await inRequest(req, () => generationsRoute.POST(req)));
    };
    const stale = await post(oldPrice);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "price_changed");
    assert.equal(stale.body.price, newPrice);
    const ok = await post(newPrice);
    assert.equal(ok.status, 202, JSON.stringify(ok.body));
    const charged = await queryOne<{ d: string }>("SELECT (-(points_delta + quota_delta + balance_delta))::text AS d FROM transactions WHERE user_id = $1 AND kind = 'charge'", [buyer.id]);
    assert.equal(Number(charged!.d), newPrice, "the ledger charges the new price");
    await query("UPDATE generations SET status = 'REVOKED' WHERE id = $1", [ok.body.id]);
  });

  await t.test("conflicts: unchanged 409 state, stale expected 409 stale; nothing written", async () => {
    const same = await put(owner.cookie, { modelId: NANO, enabled: true, markup: 3, reason: REASON });
    assert.equal(same.status, 409);
    assert.equal(same.body.code, "state");
    const stale = await put(owner.cookie, { modelId: NANO, enabled: true, markup: 4, reason: REASON, expected: DEF });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "stale");
    assert.equal((await audits(owner.adminId, "media_model.update")).length, 1);
    assert.equal((await rows())[0].markup, "3.000");
  });

  await t.test("switch off hides the model (catalog + route 400), back to default removes the row", async () => {
    const off = await put(owner.cookie, { modelId: NANO, enabled: false, markup: 3, reason: REASON, expected: { enabled: true, markup: 3 } });
    assert.equal(off.status, 200);
    const nano = off.body.models.find((m) => m.modelId === NANO)!;
    assert.equal(nano.enabled, false);
    assert.equal(nano.available, false);
    const c = await catalog();
    assert.deepEqual(c.body.models.map((m: { id: string }) => m.id), [GPT, ...Object.keys(FAL_USD)]);
    assert.equal(c.body.defaultModelId, GPT);
    const buyer = await mkUser(100_000);
    await query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
    const req = new Request("http://localhost/api/generations", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${buyer.token}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "studio", values: { modelId: NANO, prompt: "Registon maydoni" } }),
    });
    const r = await read(await inRequest(req, () => generationsRoute.POST(req)));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "model_unavailable");
    const back = await put(owner.cookie, { modelId: NANO, ...DEF, reason: REASON });
    assert.equal(back.status, 200);
    assert.deepEqual(await rows(), [], "the default state is «no row»");
    const last = (await audits(owner.adminId, "media_model.update")).at(-1)!;
    assert.deepEqual(last.before, { enabled: false, markup: 3 });
    assert.deepEqual(last.after, DEF);
  });

  await t.test("live upstream: the admin slot's flash model shows its own cost and the price built from it", async () => {
    const saved = process.env.GEMINI_IMAGE_MODEL;
    process.env.GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
    try {
      await reloadProviderKeys();
      const r = await get(owner.cookie);
      const nano = r.body.models.find((m) => m.modelId === NANO)!;
      assert.equal(nano.costUsd, 0.067, "the cost the admin sees is the cost the price is built from");
      assert.equal(nano.price, up100(0.067 * rate * 2));
      assert.equal(nano.price, await effectivePrice(STUDIO, { modelId: NANO, imageCount: 1 }));
    } finally {
      if (saved === undefined) delete process.env.GEMINI_IMAGE_MODEL;
      else process.env.GEMINI_IMAGE_MODEL = saved;
      await reloadProviderKeys();
    }
  });

  invalidateMediaOverrides();
  invalidateSettingsCache();
  invalidatePricingCache();
});
