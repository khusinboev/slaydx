import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P7a «Solishtirish» — `POST /api/studio/compare` on an isolated Postgres (docs/studio/P7-SPEC.md). No provider
 * is called: the batch only charges and queues (no worker runs here).
 *
 *   request    2–4 distinct models of the tab's prompt purpose, one prompt, no input picture (pure `compareRequestError`);
 *   money      each model = the single submit's server price (`effectivePrice`, `tool_pricing` % included), total = sum;
 *              N charges with the rows' own ids as references, one shared `compare_group`, indexes 0..N-1;
 *   guards     a stale per-model `expectedPrice` / `expectedTotal` → 409, an unavailable SECOND model → 400, a balance
 *              between the first price and the sum → 402 — each with NOTHING charged and NO row (all or nothing);
 *   limits     the batch is N jobs for the in-flight cap (429, nothing charged) and N slots of the burst bucket;
 *   refunds    one member cancelled → only its own price comes back, the other stays queued;
 *   replay     the same Idempotency-Key + request → the same batch, charged once; the same key, another prompt → 422;
 *   video      Studio clips: the PAID balance only (bonus so'm → 402 `paid_balance_required`), an effect is refused.
 *
 * Mutations (each turned the named test red, then restored):
 *   `throw new BatchShort(...)` → `return` of a partial batch (commit the first charge)      -> "guards" (charged, rows left);
 *   `prepareGeneration` loop runs AFTER the first charge (validate one model, charge it, …)  -> "guards" (400 left a charge);
 *   admission loop checks only `userInflight: inflight` (the batch as ONE job)               -> "limits" (202, not 429);
 *   the route calls `limit()` once instead of once per model                                -> "limits" (third batch 202);
 *   `expectedTotal` check removed                                                            -> "guards" (202, not 409);
 *   (review MINOR-1) per-model `expectedPrice` passed back into `prepareGeneration`             -> "guards" (409 price = one model's);
 *   `compare_group` written as a new UUID per row                                            -> "money" (two groups);
 *   replay ignores the values (`same` dropped from the check)                                -> "replay" (202, not 422);
 *   `paidOnly` not passed to `chargeInTx` for the video batch                                -> "video" (bonus paid it).
 * Migration 071 is asserted (CHECK + rollback) in tests/admin-migrations.test.mts: the index CHECK widened to 0..9 and
 * the ROLLBACK block without its `DROP COLUMN compare_index` — both turned that file red, then restored.
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
process.env.KLING_API_KEY = "klingtestkey";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_IMAGE_MODEL;
delete process.env.OPENAI_IMAGE_MODEL;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studiocompare") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { compareRequestError } = await import("../lib/server/studio-compare.ts");
const { TOOL_BY_ID } = await import("../lib/tools.ts");

const NANO = "google/nano-banana";
const GPT = "openai/gpt-image";
const OMNI = "google/omni-video";
const K3 = "kling/kling-3";
const PROMPT = "Registon maydoni erta tongda";
const img = (modelId: string, extra: Record<string, unknown> = {}) => ({ modelId, prompt: PROMPT, imageRatio: "1:1", imageCount: 1, ...extra });
const vid = (modelId: string) => ({ modelId, prompt: "Tong chog‘ida Registon maydoni, kamera sekin yaqinlashadi" });

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
function setEnv(t: TestContext, name: string, value: string | undefined) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => void (saved === undefined ? delete process.env[name] : (process.env[name] = saved)));
}

let dbReady: Promise<void> | null = null;
async function db() {
  const mod = await import("../lib/server/db.ts");
  dbReady ??= mod.migrate();
  await dbReady;
  const { env } = await import("../lib/server/env.ts");
  Object.assign(env.worker, { inline: false });
  Object.assign(env.queue, { userMaxInflight: 50, totalSlots: 50, meanServiceSec: 1, maxWaitSec: 100_000 });
  return mod;
}
after(async () => {
  if (!dbReady) return;
  const { stopProviderKeyRefresh } = await import("../lib/server/providers/store.ts");
  stopProviderKeyRefresh();
  const { pool } = await import("../lib/server/db.ts");
  await pool().end();
  await iso.drop();
});

let seq = 0;
async function mkUser(wallet: { points?: number; balance?: number } = { balance: 100_000 }): Promise<string> {
  const { query } = await db();
  return String(
    (await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Cmp', $2, 0, $3) RETURNING id", [`cmp-${process.pid}-${seq++}`, wallet.points ?? 0, wallet.balance ?? 0]))[0]!.id,
  );
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0]!.b);
}
async function rowsOf(userId: string) {
  const { query } = await db();
  return query<{ id: string; tool_id: string; price: string; compare_group: string | null; compare_index: number | null; status: string; idempotency_key: string | null }>(
    "SELECT id, tool_id, price::text, compare_group, compare_index, status, idempotency_key FROM generations WHERE user_id = $1 ORDER BY compare_index NULLS LAST",
    [userId],
  );
}
async function chargesOf(userId: string) {
  const { query } = await db();
  return query<{ reference: string; kind: string; total: string }>(
    "SELECT reference, kind, (points_delta + quota_delta + balance_delta)::text AS total FROM transactions WHERE user_id = $1 ORDER BY id",
    [userId],
  );
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function refresh() {
  const { reloadProviderKeys } = await import("../lib/server/providers/store.ts");
  const { invalidateMediaOverrides } = await import("../lib/server/media/overrides.ts");
  const { invalidateSettingsCache } = await import("../lib/server/settings.ts");
  const { invalidatePricingCache } = await import("../lib/server/pricing.ts");
  await reloadProviderKeys();
  invalidateMediaOverrides();
  invalidateSettingsCache();
  invalidatePricingCache();
}
type Body = { group?: string; total?: number; items?: { id: string; modelId: string; price: number }[]; error?: string; code?: string; price?: number; prices?: number[] };
async function compare(
  userId: string,
  body: { kind: string; members: { values: Record<string, unknown>; expectedPrice?: number }[]; expectedTotal?: number },
  opts: { key?: string; keepLimits?: boolean } = {},
) {
  const route = await import("../app/api/studio/compare/route.ts");
  if (!opts.keepLimits) await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/studio/compare", {
    method: "POST",
    headers: { cookie: await cookieOf(userId), "content-type": "application/json", ...(opts.key ? { "idempotency-key": opts.key } : {}) },
    body: JSON.stringify(body),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, replayed: r.headers.get("idempotent-replayed") === "true", body: (await r.json()) as Body };
}
async function priceOf(toolId: "studio-image" | "studio-video", values: Record<string, unknown>): Promise<number> {
  const { effectivePrice } = await import("../lib/server/pricing.ts");
  return effectivePrice(TOOL_BY_ID[toolId], values as never);
}

/* ───────────────────────────── pure ───────────────────────────── */

test("request: 2–4 distinct prompt models of the tab, one prompt, no input picture", () => {
  const m = (values: Record<string, unknown>) => ({ values: values as never });
  assert.equal(compareRequestError("image", [m(img(NANO)), m(img(GPT))]), null);
  assert.match(compareRequestError("image", [m(img(NANO))])!, /2–4/);
  assert.match(compareRequestError("image", [m(img(NANO)), m(img(GPT)), m(img("bfl/flux")), m(img("recraft/recraft")), m(img("bytedance/seedream"))])!, /2–4/);
  assert.match(compareRequestError("image", [m(img(NANO)), m(img(NANO))])!, /ikki marta/);
  assert.match(compareRequestError("image", [m(img(NANO)), m({ prompt: PROMPT })])!, /modelId/);
  // Edit / upscale / background removal have no compare; a video model is not a Rasm model.
  assert.match(compareRequestError("image", [m(img(NANO)), m(img("google/nano-banana-edit"))])!, /ishlamaydi/);
  assert.match(compareRequestError("image", [m(img(NANO)), m(vid(OMNI))])!, /ishlamaydi/);
  assert.match(compareRequestError("video", [m(vid(OMNI)), m({ modelId: "kling/effects", effect: "hug_pro" })])!, /ishlamaydi/);
  assert.equal(compareRequestError("video", [m(vid(OMNI)), m(vid(K3))]), null);
  // One prompt: compared as the server normalizes it (whitespace runs collapse), anything else differs.
  assert.equal(compareRequestError("image", [m(img(NANO)), m(img(GPT, { prompt: `  ${PROMPT.replace(" ", "   ")} ` }))]), null);
  assert.match(compareRequestError("image", [m(img(NANO)), m(img(GPT, { prompt: `${PROMPT}!` }))])!, /bitta so‘rov/);
  // Prompt-only: a start frame on a video model is refused.
  assert.match(compareRequestError("video", [m(vid(OMNI)), m({ ...vid(K3), imageAssetId: "0123456789abcdef01234567" })])!, /suratni/);
});

/* ───────────────────────────── money ───────────────────────────── */

test("money: each model at its own server price (tool_pricing % too), total = sum, one group, own charge per row", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await query("DELETE FROM tool_pricing");
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ('studio-image', 130, 100)");
  t.after(async () => {
    await query("DELETE FROM tool_pricing");
    await refresh();
  });
  await refresh();
  const a = await priceOf("studio-image", img(NANO));
  const b = await priceOf("studio-image", img(GPT, { imageCount: 2 }));
  assert.ok(a > 0 && b > 0 && a !== b);
  const me = await mkUser();
  const r = await compare(me, { kind: "image", members: [{ values: img(NANO), expectedPrice: a }, { values: img(GPT, { imageCount: 2 }), expectedPrice: b }], expectedTotal: a + b });
  assert.equal(r.status, 202, r.body.error);
  assert.equal(r.body.total, a + b);
  assert.deepEqual(r.body.items!.map((x) => [x.modelId, x.price]), [[NANO, a], [GPT, b]]);
  assert.equal(await balanceOf(me), 100_000 - a - b);
  const rows = await rowsOf(me);
  assert.deepEqual(rows.map((x) => [x.id, x.tool_id, Number(x.price), x.compare_index, x.status]), [
    [r.body.items![0]!.id, "studio-image", a, 0, "QUEUED"],
    [r.body.items![1]!.id, "studio-image", b, 1, "QUEUED"],
  ]);
  assert.equal(new Set(rows.map((x) => x.compare_group)).size, 1, "MUTATSIYA: one compare_group for the batch");
  assert.equal(rows[0]!.compare_group, r.body.group);
  // Each row is charged under its OWN id (the worker refunds it alone).
  assert.deepEqual((await chargesOf(me)).map((c) => [c.kind, c.reference, Number(c.total)]), [
    ["charge", rows[0]!.id, -a],
    ["charge", rows[1]!.id, -b],
  ]);

  // refunds: one member cancelled → only its own price comes back; the other is untouched.
  const { cancelGeneration } = await import("../lib/server/jobs.ts");
  assert.equal(await cancelGeneration(rows[1]!.id, me), true);
  assert.equal(await balanceOf(me), 100_000 - a);
  assert.deepEqual((await rowsOf(me)).map((x) => x.status), ["QUEUED", "REVOKED"]);
});

/* ───────────────────────────── guards: all or nothing ───────────────────────────── */

test("guards: stale price / stale total / unavailable second model / balance below the sum — nothing charged, no row", { skip: skipDb }, async (t) => {
  quiet(t);
  await db();
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await refresh();
  const a = await priceOf("studio-image", img(NANO));
  const b = await priceOf("studio-image", img(GPT));
  const members = (pa?: number, pb?: number) => [
    { values: img(NANO), ...(pa === undefined ? {} : { expectedPrice: pa }) },
    { values: img(GPT), ...(pb === undefined ? {} : { expectedPrice: pb }) },
  ];

  const me = await mkUser();
  const stale = await compare(me, { kind: "image", members: members(a, b - 100) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "price_changed");
  assert.equal(stale.body.price, a + b, "a stale model price answers the new TOTAL, never one model's price");
  assert.deepEqual(stale.body.prices, [a, b]);
  const staleTotal = await compare(me, { kind: "image", members: members(a, b), expectedTotal: a + b - 100 });
  assert.equal(staleTotal.status, 409, "MUTATSIYA: expectedTotal is checked");
  assert.equal(staleTotal.body.price, a + b);
  assert.deepEqual(staleTotal.body.prices, [a, b]);
  assert.equal(await balanceOf(me), 100_000);
  assert.equal((await rowsOf(me)).length, 0);

  // The SECOND model is not offered now (no OpenAI key): 400 and the first one is not charged either.
  setEnv(t, "OPENAI_API_KEY", undefined);
  await refresh();
  const gone = await compare(me, { kind: "image", members: members(a, b) });
  assert.equal(gone.status, 400);
  assert.equal(gone.body.code, "model_unavailable");
  assert.equal(await balanceOf(me), 100_000, "MUTATSIYA: every model is validated before any charge");
  assert.equal((await chargesOf(me)).length, 0);

  // Enough for the first model, not for both: 402 with the SUM, nothing charged, no row.
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await refresh();
  const poor = await mkUser({ balance: a + b - 1 });
  const short = await compare(poor, { kind: "image", members: members(a, b), expectedTotal: a + b });
  assert.equal(short.status, 402);
  assert.match(short.body.error!, new RegExp(`Kerak: ${(a + b).toLocaleString("uz-UZ")}`));
  assert.equal(await balanceOf(poor), a + b - 1, "MUTATSIYA: a short balance rolls the whole batch back");
  assert.equal((await rowsOf(poor)).length, 0);
  assert.equal((await chargesOf(poor)).length, 0);

  // Bad request shapes: 400 before anything.
  assert.equal((await compare(me, { kind: "image", members: [{ values: img(NANO) }] })).status, 400);
  assert.equal((await compare(me, { kind: "audio", members: members() })).status, 400);
  assert.equal((await compare(me, { kind: "image", members: members(-1) })).status, 400);
});

/* ───────────────────────────── limits ───────────────────────────── */

test("limits: the batch is N jobs for the in-flight cap and N slots of the burst bucket", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  const setCap = async (cap: number | null) => {
    if (cap === null) await query("DELETE FROM app_settings WHERE key = 'queue.user_max_inflight'");
    else await query("INSERT INTO app_settings (key, value) VALUES ('queue.user_max_inflight', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [JSON.stringify(cap)]);
    await refresh();
  };
  const me = await mkUser();
  // Cap 2, one job already queued: a 2-model batch would make 3 — refused, nothing charged.
  await setCap(2);
  t.after(() => setCap(null));
  const one = await compare(me, { kind: "image", members: [{ values: img(NANO) }, { values: img(GPT) }] });
  assert.equal(one.status, 202, one.body.error);
  const { cancelGeneration } = await import("../lib/server/jobs.ts");
  await cancelGeneration(one.body.items![1]!.id, me);
  const before = await balanceOf(me);
  const over = await compare(me, { kind: "image", members: [{ values: img(NANO) }, { values: img(GPT) }] });
  assert.equal(over.status, 429, "MUTATSIYA: the batch is admitted as N jobs");
  assert.equal(over.body.code, "user_inflight");
  assert.match(over.body.error!, /Solishtirish 2 ta ish/);
  assert.equal(await balanceOf(me), before);
  await setCap(null);

  // Burst bucket 5 / minute: two 2-model batches take 4 slots, a third batch (2 more) is refused at the 6th.
  const fresh = await mkUser();
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const m2 = [{ values: img(NANO) }, { values: img(GPT) }];
  assert.equal((await compare(fresh, { kind: "image", members: m2 }, { keepLimits: true })).status, 202);
  assert.equal((await compare(fresh, { kind: "image", members: m2 }, { keepLimits: true })).status, 202);
  const third = await compare(fresh, { kind: "image", members: m2 }, { keepLimits: true });
  assert.equal(third.status, 429, "MUTATSIYA: one limit() slot per model");
  assert.equal((await rowsOf(fresh)).length, 4);
});

/* ───────────────────────────── replay ───────────────────────────── */

test("replay: same key + request → the same batch, charged once; same key, another prompt → 422", { skip: skipDb }, async (t) => {
  quiet(t);
  await db();
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await refresh();
  const me = await mkUser();
  const key = randomUUID();
  const body = { kind: "image", members: [{ values: img(NANO) }, { values: img(GPT) }] };
  const first = await compare(me, body, { key });
  assert.equal(first.status, 202, first.body.error);
  const after1 = await balanceOf(me);
  const again = await compare(me, body, { key });
  assert.equal(again.status, 202);
  assert.equal(again.replayed, true);
  assert.deepEqual(again.body.items, first.body.items);
  assert.equal(again.body.group, first.body.group);
  assert.equal(await balanceOf(me), after1, "a replay charges nothing");
  assert.equal((await rowsOf(me)).length, 2);
  // The key sits on the FIRST row only (the unique index allows one row per key).
  assert.deepEqual((await rowsOf(me)).map((r) => r.idempotency_key), [key, null]);

  const other = await compare(me, { kind: "image", members: [{ values: img(NANO, { prompt: "Boshqa so‘rov matni" }) }, { values: img(GPT, { prompt: "Boshqa so‘rov matni" }) }] }, { key });
  assert.equal(other.status, 422, "MUTATSIYA: a replay compares the values");
  const swapped = await compare(me, { kind: "image", members: [{ values: img(GPT) }, { values: img(NANO) }] }, { key });
  assert.equal(swapped.status, 422, "another order is another request");
  assert.equal(await balanceOf(me), after1);
});

/* ───────────────────────────── video ───────────────────────────── */

test("video: two clip models charged from the PAID balance only; bonus so'm → 402", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  await query("INSERT INTO app_settings (key, value) VALUES ('video.enabled', 'true'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await query("INSERT INTO media_model_overrides (model_id, enabled) VALUES ($1, true) ON CONFLICT (model_id) DO UPDATE SET enabled = true", [K3]);
  t.after(async () => {
    await query("DELETE FROM app_settings WHERE key = 'video.enabled'");
    await query("DELETE FROM media_model_overrides WHERE model_id = $1", [K3]);
    await refresh();
  });
  await refresh();
  const a = await priceOf("studio-video", vid(OMNI));
  const b = await priceOf("studio-video", vid(K3));
  const members = [{ values: vid(OMNI), expectedPrice: a }, { values: vid(K3), expectedPrice: b }];
  const bonusOnly = await mkUser({ points: 1_000_000 });
  const refused = await compare(bonusOnly, { kind: "video", members, expectedTotal: a + b });
  assert.equal(refused.status, 402, "MUTATSIYA: bonus so'm never pays for a clip");
  assert.equal(refused.body.code, "paid_balance_required");
  assert.equal(await balanceOf(bonusOnly), 1_000_000);

  const payer = await mkUser({ points: 5_000, balance: a + b });
  const ok = await compare(payer, { kind: "video", members, expectedTotal: a + b });
  assert.equal(ok.status, 202, ok.body.error);
  const { query: q } = await db();
  const w = (await q<{ points: string; balance: string }>("SELECT points::text, balance::text FROM users WHERE id = $1", [payer]))[0]!;
  assert.deepEqual([Number(w.points), Number(w.balance)], [5_000, 0]);
  assert.deepEqual((await rowsOf(payer)).map((r) => [r.tool_id, r.compare_index]), [["studio-video", 0], ["studio-video", 1]]);

  // The tab's switch off: 400 for the whole batch, nothing charged.
  await query("DELETE FROM app_settings WHERE key = 'video.enabled'");
  await refresh();
  const rich = await mkUser({ balance: 1_000_000 });
  const off = await compare(rich, { kind: "video", members });
  assert.equal(off.status, 400);
  assert.equal(await balanceOf(rich), 1_000_000);
});
