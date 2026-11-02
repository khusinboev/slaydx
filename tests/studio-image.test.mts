import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio «Rasm» tab, backend (docs/studio/P1-SPEC.md, package A): tool `studio-image`, purpose `studio.image`.
 *
 * What is proven here:
 *   price       cost × markup goldens per model × count × markup / override, rounded UP to 100, never below cost ×
 *               markup, never the «Rasm» legacy ladder; `priceFor` in the browser (catalog `pricing` block + session
 *               `tool_pricing` %) == `effectivePrice` on the server == the amount the ledger charges;
 *   validation  unknown / «Rasm» / disabled / unavailable model and every bad ParamSchema value → 400 before ANY charge
 *               (balance unchanged, no generation row);
 *   flow        route → claimNext → runJob with a stubbed provider: charge, stored file, doc.imageModel = catalog id,
 *               one `media_jobs` row per picture (purpose studio.image, ALWAYS — media.core.image is off), partial
 *               refund when one of two pictures fails, full refund when all fail, GPT Image on its own route;
 *   catalog     `GET /api/media/catalog` shape, only available models (key, admin switch), default model, pricing
 *               block = server pricing, no routes / upstream ids / adapters in the payload, other purposes refused;
 *   gallery     only the caller's completed Studio jobs, newest first, 24 per page + cursor, stored asset URLs only;
 *   N3          `runMedia` refuses a model its purpose does not allow and an unknown purpose; listening may speak
 *               through ElevenLabs;
 *   M5          stuck sync 'submitting' rows > 1 h are failed (video and fresh rows untouched), rows > 90 days are
 *               deleted in batches, both reached from the leader housekeeping.
 *
 * Mutations (each turned the named test(s) red, then restored) — see the report in the PR for the run log:
 *   studio-pricing  override ignored (always global markup) -> "price goldens" (override rows), "client preview";
 *                   `override: null` (legacy ladder back) -> "price goldens" (900 vs 2000), "flow";
 *                   roundUpTo -> Math.round -> "price goldens" (never below cost × markup);
 *   tools.ts        `studioImageError` returns null -> "route rejects" (bad values charged); `media` arg dropped in
 *                   basePriceFor -> "client preview" (server prices at the default markup);
 *   pricing.ts      effectivePrice without `mediaPricing()` -> "client preview", "flow" (charged at default rate);
 *   submit          availability check removed -> "route rejects" (hidden / unkeyed model charged);
 *   availability    override.enabled ignored -> "route rejects", "catalog"; key check dropped -> "catalog", "route rejects";
 *   engine          purpose "rasm.image" in buildStudioImage -> "flow" (rows' purpose); `imageModel` = rasm id -> "flow";
 *                   core skipped (bare provider) -> "flow" (no media_jobs rows);
 *   public.ts       clientView bypassed (raw entries) -> "catalog" (routes leak); gallery `user_id` predicate dropped ->
 *                   "gallery" (other user's job listed); `limit + 1` -> `limit` -> "gallery" (nextCursor lost);
 *   run.ts (N3)     allow-list check removed -> "N3"; elevenlabs not in listening.voice -> "N3";
 *   jobs.ts (M5)    sync filter dropped -> "M5" (video row failed); 1 h -> 0 -> "M5" (fresh row failed); batch loop
 *                   breaks after one batch -> "M5"; housekeeping step removed -> "M5 housekeeping".
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_IMAGE_MODEL;
delete process.env.OPENAI_IMAGE_MODEL;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studioimage") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { TOOL_BY_ID, TOOL_BY_SLUG, basePriceFor, priceFor, preflightError, setClientPriceAdjustments } = await import("../lib/tools.ts");
const { studioImagePrice, setClientMediaPricing, defaultMediaPricing, parseMediaPricing } = await import("../lib/media/studio-pricing.ts");
const { IMAGE_MODEL_TO_MEDIA, MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } = await import("../lib/media/catalog.ts");
const { MEDIA_TO_IMAGE_MODEL, imageModelById } = await import("../lib/generation/image-models.ts");
const { costUsd, normalize, MediaError, resetBreakers } = await import("../lib/studio-core/index.ts");
const { IMAGE_PRICES, OPENAI_IMAGE_FALLBACK_USD } = await import("../lib/generation/llm-pricing.ts");
const { IMAGE_RATIOS, IMAGE_STYLES } = await import("../lib/generation/image-studio-options.ts");

const STUDIO = TOOL_BY_ID["studio-image"];
const NANO = "google/nano-banana";
const GPT = "openai/gpt-image";
const USD: Record<string, number> = { [NANO]: IMAGE_PRICES["gemini-3.1-flash-lite-image"]!, [GPT]: OPENAI_IMAGE_FALLBACK_USD };
const pricing = (o: Partial<{ soumPerUsd: number; markup: number; overrides: Record<string, { markup: number }> }> = {}) => ({
  soumPerUsd: o.soumPerUsd ?? 12_800,
  markup: o.markup ?? 2,
  step: 100,
  overrides: o.overrides ?? {},
});

/* ───────────────────────────── pure: price ───────────────────────────── */

test("price goldens: cost × markup per model × count, override wins, rounded up to 100, never below cost × markup", () => {
  // Hand-computed at 12 800 so'm/$ (0.034 × 12 800 = 435.2 per Nano Banana picture, 0.053 × 12 800 = 678.4 per GPT Image).
  const GOLD: Record<string, Record<number, Record<string, number>>> = {
    [NANO]: { 1: { x2: 900, x3: 1400, x1_5: 700 }, 2: { x2: 1800, x3: 2700, x1_5: 1400 }, 3: { x2: 2700, x3: 4000, x1_5: 2000 }, 4: { x2: 3500, x3: 5300, x1_5: 2700 } },
    [GPT]: { 1: { x2: 1400, x3: 2100, x1_5: 1100 }, 2: { x2: 2800, x3: 4100, x1_5: 2100 }, 3: { x2: 4100, x3: 6200, x1_5: 3100 }, 4: { x2: 5500, x3: 8200, x1_5: 4100 } },
  };
  for (const id of [NANO, GPT]) {
    for (const n of [1, 2, 3, 4]) {
      const v = { modelId: id, prompt: "Registon", imageCount: n };
      assert.equal(studioImagePrice(v, pricing()), GOLD[id][n].x2, `${id} × ${n} @ ×2`);
      assert.equal(studioImagePrice(v, pricing({ markup: 3 })), GOLD[id][n].x3, `${id} × ${n} @ ×3`);
      // The model's own markup wins over the global one; another model's override does not touch it.
      assert.equal(studioImagePrice(v, pricing({ overrides: { [id]: { markup: 1.5 } } })), GOLD[id][n].x1_5, `${id} × ${n} override ×1.5`);
      const other = id === NANO ? GPT : NANO;
      assert.equal(studioImagePrice(v, pricing({ overrides: { [other]: { markup: 9 } } })), GOLD[id][n].x2, `${id}: ${other}'s override ignored`);
      // An invalid override (outside 1–20) never applies.
      assert.equal(studioImagePrice(v, pricing({ overrides: { [id]: { markup: 0.5 } } })), GOLD[id][n].x2);
    }
  }
  // Grid: every rate × markup × count stays a multiple of 100, ≥ cost × markup and < cost × markup + 100.
  for (const id of [NANO, GPT]) {
    for (const rate of [11_000, 12_345, 12_800, 13_333]) {
      for (const markup of [1, 1.25, 2, 2.5, 3, 7, 20]) {
        for (const n of [1, 2, 3, 4]) {
          const got = studioImagePrice({ modelId: id, imageCount: n }, pricing({ soumPerUsd: rate, markup }))!;
          const raw = USD[id] * n * rate * markup;
          assert.equal(got % 100, 0, `${id} ${rate} ×${markup} ${n}: multiple of 100`);
          assert.ok(got >= raw - 1e-6 && got < raw + 100, `${id} ${rate} ×${markup} ${n}: ${got} vs raw ${raw}`);
        }
      }
    }
  }
  // Never the «Rasm» legacy ladder (2 000 / 3 500 / 6 000): the same catalog entry is priced cost × markup here.
  assert.equal(studioImagePrice({ modelId: NANO, imageCount: 1 }, pricing()), 900);
  assert.equal(basePriceFor(TOOL_BY_ID.image, { imageCount: 1 }), 2000, "«Rasm» keeps its ladder");
  // Not a Studio model -> null (the route refused it before); blank -> the purpose default.
  assert.equal(studioImagePrice({ modelId: "google/omni-video" }, pricing()), null);
  assert.equal(studioImagePrice({ modelId: "gemini" }, pricing()), null);
  assert.equal(studioImagePrice({}, pricing()), 900);
  // The costs are the price book's (no second copy).
  assert.equal(costUsd(MEDIA_CATALOG.byId(NANO)!.cost, normalize(MEDIA_CATALOG.byId(NANO)!.params, { imageCount: 3 })), USD[NANO] * 3);
});

test("live unit cost: the block's costUsd replaces the catalog's default unit price (server and browser alike)", () => {
  // The admin slot draws Nano Banana with the flash model ($0.067): 0.067 × 12 800 × 2 = 1 715.2 → 1 800 per picture.
  const live = pricing();
  const flash = { ...live, costUsd: { [NANO]: 0.067 } };
  assert.equal(studioImagePrice({ modelId: NANO, imageCount: 1 }, flash), 1800);
  assert.equal(studioImagePrice({ modelId: NANO, imageCount: 3 }, flash), 5200, "0.067 × 3 × 12 800 × 2 = 5 145.6 → 5 200");
  assert.equal(studioImagePrice({ modelId: GPT, imageCount: 1 }, flash), 1400, "another model keeps its catalog cost");
  assert.equal(studioImagePrice({ modelId: NANO, imageCount: 1 }, { ...flash, costUsd: { [NANO]: -1 } }), 900, "a junk cost never applies");
  assert.equal(basePriceFor(STUDIO, { modelId: NANO, imageCount: 1 }, flash), 1800, "basePriceFor reads the same block");
  assert.deepEqual(parseMediaPricing({ ...flash, costUsd: { [NANO]: 0.067, x: 0, y: "1" } })?.costUsd, { [NANO]: 0.067 });
});

test("pricing block: parse rejects junk; the browser registry is invisible on the server", () => {
  assert.equal(parseMediaPricing(null), null);
  assert.equal(parseMediaPricing({ soumPerUsd: 0, markup: 2 }), null);
  assert.equal(parseMediaPricing({ soumPerUsd: 12_800, markup: 0.5 }), null);
  assert.deepEqual(parseMediaPricing({ soumPerUsd: 12_800, markup: 2, overrides: { [NANO]: { markup: 3 }, x: { markup: 99 }, y: 5 } }), { ...pricing({ overrides: { [NANO]: { markup: 3 } } }), costUsd: {} });
  // No window: priceFor ignores the registry and prices at the default block.
  setClientMediaPricing(pricing({ markup: 9 }));
  assert.equal(priceFor(STUDIO, { modelId: NANO }), studioImagePrice({ modelId: NANO }, defaultMediaPricing()));
  setClientMediaPricing(null);
});

test("preflight: Studio model and its ParamSchema, before any charge", () => {
  const ok = { modelId: NANO, prompt: "Registon erta tongda", imageStyle: "photo", imageRatio: "1:1", imageCount: 2 };
  assert.equal(preflightError(STUDIO, ok), null);
  assert.equal(preflightError(STUDIO, { ...ok, modelId: GPT }), null);
  assert.equal(preflightError(STUDIO, { ...ok, modelId: "" }), null, "blank = the default model");
  for (const modelId of ["nope/x", "gemini", "openai", "google/omni-video", "elevenlabs/tts"]) {
    assert.match(String(preflightError(STUDIO, { ...ok, modelId })), /Noma'lum rasm modeli/, modelId);
  }
  assert.match(String(preflightError(STUDIO, { ...ok, imageCount: 5 })), /Soni: 1–4/);
  assert.match(String(preflightError(STUDIO, { ...ok, imageCount: 0 })), /Soni/);
  assert.match(String(preflightError(STUDIO, { ...ok, imageStyle: "zzz" })), /Uslub: noma'lum/);
  assert.match(String(preflightError(STUDIO, { ...ok, imageRatio: "7:3" })), /O'lcham: noma'lum/);
  assert.match(String(preflightError(STUDIO, { ...ok, prompt: "ab" })), /kamida 3/);
  // The tool and its registry facts.
  assert.equal(TOOL_BY_SLUG.studio, STUDIO);
  assert.equal(STUDIO.group, "media");
  assert.equal(STUDIO.custom, "studio-image");
  // P2a: the five fal models joined the Studio after the two «Rasm» models; Nano Banana stays the default.
  assert.deepEqual(MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE), {
    id: "studio.image",
    kind: "image",
    allowed: [NANO, GPT, "bfl/flux", "bytedance/seedream", "ideogram/ideogram", "recraft/recraft", "alibaba/qwen-image"],
    default: NANO,
    userCanChoose: true,
  });
  // The viewer names a Studio doc's catalog id correctly (the inverse map is the catalog's own).
  assert.deepEqual(Object.fromEntries(Object.entries(IMAGE_MODEL_TO_MEDIA).map(([k, v]) => [v, k])), MEDIA_TO_IMAGE_MODEL);
  assert.equal(imageModelById(GPT).id, "openai");
  assert.equal(imageModelById("openai").id, "openai");
  assert.equal(imageModelById(NANO).id, "gemini");
  void IMAGE_RATIOS;
  void IMAGE_STYLES;
});

/* ───────────────────────────── DB fixtures ───────────────────────────── */

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const JPEG = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(n, 3)]);
const B64 = JPEG(3000).toString("base64");
const res = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as never;
const geminiOk = () => res(200, { steps: [{ type: "message", content: [{ data: B64, mime_type: "image/jpeg" }] }] });
const openaiOk = () => res(200, { data: [{ b64_json: B64 }], usage: { input_tokens: 30, input_tokens_details: { text_tokens: 30, image_tokens: 0 }, output_tokens: 1600 } });
const sceneOk = () => res(200, { candidates: [{ content: { parts: [{ text: '{"scene":"A wide view of Registon square at dawn, soft mist."}' }] } }] });
const boom = () => res(500, { error: { message: "internal" } });
const isText = (u: string) => u.includes(":generateContent");
const REAL_FETCH = globalThis.fetch;
function stubFetch(t: TestContext, handler: (url: string) => unknown) {
  globalThis.fetch = (async (u: string) => handler(String(u))) as unknown as typeof fetch;
  t.after(() => void (globalThis.fetch = REAL_FETCH));
}
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
async function mkUser(balance = 100_000): Promise<string> {
  const { query } = await db();
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Studio', 0, 0, $2) RETURNING id", [`studio-${process.pid}-${seq++}`, balance]))[0].id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0].b);
}
async function cookieOf(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function post(userId: string, values: Record<string, unknown>, expectedPrice?: number) {
  const route = await import("../app/api/generations/route.ts");
  // The burst limit (5 a minute) is not under test here.
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: await cookieOf(userId), "content-type": "application/json" },
    body: JSON.stringify({ slug: "studio", values, ...(expectedPrice !== undefined ? { expectedPrice } : {}) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function catalog(purpose = STUDIO_IMAGE_PURPOSE) {
  const route = await import("../app/api/media/catalog/route.ts");
  const req = new Request(`http://localhost/api/media/catalog?purpose=${encodeURIComponent(purpose)}`, { headers: { "x-forwarded-for": `10.9.${seq % 200}.${seq++ % 200}` } });
  const r = await inRequest(req, () => route.GET(req));
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) as Record<string, unknown> };
}
/** Fresh provider keys + overrides + settings (the caches are per process). */
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
async function setOverride(modelId: string, o: { enabled?: boolean | null; markup?: number | null } | null) {
  const { query } = await db();
  await query("DELETE FROM media_model_overrides WHERE model_id = $1", [modelId]);
  if (o) await query("INSERT INTO media_model_overrides (model_id, enabled, markup) VALUES ($1, $2, $3)", [modelId, o.enabled ?? null, o.markup ?? null]);
  await refresh();
}
const VALUES = { modelId: NANO, prompt: "Registon maydoni erta tongda", imageStyle: "photo", imageRatio: "1:1", imageCount: 1 };

/* ───────────────────────────── route: refusals ───────────────────────────── */

test("route rejects an unknown / «Rasm» / hidden / unkeyed model and bad values with 400 and NO charge", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  await refresh();
  const me = await mkUser();
  const before = await balanceOf(me);
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["unknown model", { ...VALUES, modelId: "nope/x" }, /Noma'lum rasm modeli/],
    ["«Rasm» model id", { ...VALUES, modelId: "gemini" }, /Noma'lum rasm modeli/],
    ["video model", { ...VALUES, modelId: "google/omni-video" }, /Noma'lum rasm modeli/],
    ["count 5", { ...VALUES, imageCount: 5 }, /Soni/],
    ["unknown style", { ...VALUES, imageStyle: "zzz" }, /Uslub/],
    ["prompt too short", { ...VALUES, prompt: "ab" }, /kamida 3/],
    // OPENAI_API_KEY is not set: the model exists but cannot be served.
    ["unkeyed provider", { ...VALUES, modelId: GPT }, /hozir mavjud emas/],
  ];
  for (const [name, values, msg] of cases) {
    const r = await post(me, values);
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body)}`);
    assert.match(String(r.body.error), msg, name);
  }
  // The admin switched Nano Banana off: refused even though Gemini is keyed.
  await setOverride(NANO, { enabled: false });
  t.after(() => setOverride(NANO, null));
  const hidden = await post(me, VALUES);
  assert.equal(hidden.status, 400);
  assert.equal(hidden.body.code, "model_unavailable");
  assert.equal(await balanceOf(me), before, "nothing charged");
  assert.equal((await query("SELECT 1 FROM generations WHERE user_id = $1", [me])).length, 0, "nothing queued");
  assert.equal((await query("SELECT 1 FROM transactions WHERE user_id = $1 AND kind = 'charge'", [me])).length, 0);
});

/* ───────────────────────────── flow ───────────────────────────── */

type Flow = { name: string; values: Record<string, unknown>; respond: (n: number, url: string) => unknown; status: string; netShare: number; rows: string[]; delivered?: { got: number; want: number }; openaiKey?: boolean };

const FLOWS: Flow[] = [
  { name: "nano banana, 1 picture", values: VALUES, respond: () => geminiOk(), status: "COMPLETED", netShare: 1, rows: ["succeeded"] },
  { name: "nano banana, 2 pictures -> zip", values: { ...VALUES, imageCount: 2 }, respond: () => geminiOk(), status: "COMPLETED", netShare: 1, rows: ["succeeded", "succeeded"] },
  {
    name: "one of two fails -> delivered 1/2, half refunded",
    values: { ...VALUES, imageCount: 2 },
    respond: (n) => (n === 0 ? geminiOk() : boom()),
    status: "COMPLETED",
    netShare: 0.5,
    rows: ["failed", "succeeded"],
    delivered: { got: 1, want: 2 },
  },
  { name: "all fail -> FAILED, full refund", values: { ...VALUES, imageCount: 2 }, respond: () => boom(), status: "FAILED", netShare: 0, rows: ["failed", "failed"] },
  { name: "gpt image, 1 picture", values: { ...VALUES, modelId: GPT, imageStyle: "watercolor", imageRatio: "16:9" }, respond: () => openaiOk(), status: "COMPLETED", netShare: 1, rows: ["succeeded"], openaiKey: true },
];

test("flow: route -> claimNext -> runJob through the core (media.core.image OFF): charge, file, rows, refunds", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { getSetting } = await import("../lib/server/settings.ts");
  assert.equal(await getSetting("media.core.image"), false, "the «Rasm» switch is off: the Studio does not depend on it");
  for (const f of FLOWS) {
    await t.test(f.name, async (sub) => {
      quiet(sub);
      if (f.openaiKey) setEnv(sub, "OPENAI_API_KEY", "sk-test-openai-key-123456");
      await refresh();
      resetBreakers();
      await query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
      const urls: string[] = [];
      let n = 0;
      stubFetch(sub, (url) => {
        if (isText(url)) return sceneOk();
        urls.push(url);
        return f.respond(n++, url);
      });
      const me = await mkUser();
      const before = await balanceOf(me);
      const rate = await getSetting("finance.soum_per_usd");
      const modelId = String(f.values.modelId);
      const price = Math.ceil((USD[modelId]! * Number(f.values.imageCount) * rate * 2) / 100 - 1e-9) * 100;
      const r = await post(me, f.values, price);
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal(r.body.price, price, "server price = cost × 2, rounded up to 100");
      assert.equal(before - (await balanceOf(me)), price, "charged exactly that");
      const job = await worker.claimNext();
      assert.equal(job?.id, r.body.id);
      await worker.runJob(job!);
      const gen = await getGeneration(r.body.id!, me);
      assert.equal(gen?.status, f.status, String(gen?.error));
      assert.equal(before - (await balanceOf(me)), price * f.netShare, "net cost after the refund");
      const rows = await mediaJobsOf(r.body.id!);
      assert.deepEqual(rows.map((x) => x.status).sort(), f.rows, "one media_jobs row per picture");
      for (const row of rows) {
        assert.equal(row.purpose, "studio.image");
        assert.equal(row.model_id, modelId);
        assert.ok(!JSON.stringify(row.params).includes(B64.slice(0, 40)), "no image bytes in params");
      }
      assert.ok(urls.length > 0 && urls.every((u) => (modelId === GPT ? u.includes("api.openai.com") : u.includes("/interactions"))), "the chosen model's provider drew");
      const file = (await query<{ mime: string; file_name: string }>("SELECT mime, file_name FROM generation_files WHERE generation_id = $1", [r.body.id]))[0];
      const delivered = (await query<{ d: unknown }>("SELECT delivered_json AS d FROM generations WHERE id = $1", [r.body.id]))[0].d;
      if (f.status === "COMPLETED") {
        assert.equal(gen?.doc?.imageModel, modelId, "doc.imageModel = catalog id");
        assert.equal(file?.mime, Number(f.values.imageCount) > 1 && f.netShare === 1 ? "application/zip" : "image/jpeg");
        assert.equal(gen?.doc?.images?.length, f.delivered?.got ?? Number(f.values.imageCount));
        assert.deepEqual(delivered ?? null, f.delivered ?? null);
      } else {
        assert.equal(file, undefined, "no file for a failed job");
      }
    });
  }
});

test("client preview == server price == charge (catalog pricing block + session tool_pricing %)", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { effectivePrice, getAllToolPricing } = await import("../lib/server/pricing.ts");
  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await query("DELETE FROM tool_pricing");
  await query("INSERT INTO tool_pricing (tool_id, percent, round_to) VALUES ('studio-image', 130, 100)");
  await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('media.markup', '2.5'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await query("INSERT INTO app_settings (key, value, updated_at) VALUES ('finance.soum_per_usd', '12900'::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await setOverride(GPT, { markup: 4 });
  t.after(async () => {
    await query("DELETE FROM tool_pricing");
    await query("DELETE FROM app_settings WHERE key IN ('media.markup', 'finance.soum_per_usd')");
    await setOverride(GPT, null);
  });
  const c = await catalog();
  assert.equal(c.status, 200);
  const block = c.body.pricing as ReturnType<typeof pricing>;
  // P2a: the flat-priced fal models carry their price-book cost too (Ideogram is priced by its quality table, so it has
  // no live unit cost — `lib/server/media/pricing.ts falUpstreams`).
  const FAL_LIVE = {
    "bfl/flux": IMAGE_PRICES["blackforestlabs/flux-3/text-to-image"],
    "bytedance/seedream": IMAGE_PRICES["bytedance/seedream/v5/lite/text-to-image"],
    "recraft/recraft": IMAGE_PRICES["fal-ai/recraft/v4.1/text-to-image"],
    "alibaba/qwen-image": IMAGE_PRICES["alibaba/qwen-image-3/text-to-image"],
  };
  assert.deepEqual(block, { soumPerUsd: 12_900, markup: 2.5, step: 100, overrides: { [GPT]: { markup: 4 } }, costUsd: { [NANO]: USD[NANO], [GPT]: USD[GPT], ...FAL_LIVE } });
  // Server prices are taken BEFORE the simulated browser exists: with a `window` the server path would read the
  // browser registry and agree with the client by accident.
  const serverPrice = new Map<string, number>();
  for (const modelId of [NANO, GPT]) {
    for (const imageCount of [1, 2, 3, 4]) {
      const values = { ...VALUES, modelId, imageCount };
      const server = await effectivePrice(STUDIO, values);
      // Hand check: cost × markup (2.5, or GPT's own 4) rounded up to 100, then 130 % rounded to 100.
      const m = modelId === GPT ? 4 : 2.5;
      const base = Math.ceil((USD[modelId]! * imageCount * 12_900 * m) / 100 - 1e-9) * 100;
      assert.equal(server, Math.max(100, Math.round((base * 130) / 100 / 100) * 100), `server ${modelId} × ${imageCount}`);
      serverPrice.set(`${modelId}:${imageCount}`, server);
    }
  }
  const g = globalThis as { window?: unknown };
  const hadWindow = "window" in g;
  g.window = {};
  try {
    assert.ok(setClientMediaPricing(block));
    setClientPriceAdjustments(await getAllToolPricing());
    for (const modelId of [NANO, GPT]) {
      for (const imageCount of [1, 2, 3, 4]) {
        const values = { ...VALUES, modelId, imageCount };
        assert.equal(priceFor(STUDIO, values), serverPrice.get(`${modelId}:${imageCount}`), `client ${modelId} × ${imageCount}`);
      }
    }
  } finally {
    setClientMediaPricing(null);
    setClientPriceAdjustments({});
    if (hadWindow) g.window = undefined;
    else delete g.window;
  }
  // And the route charges exactly the server price (a stale expectedPrice is a 409, nothing charged).
  const me = await mkUser();
  const values = { ...VALUES, modelId: GPT, imageCount: 3 };
  const price = await effectivePrice(STUDIO, values);
  const stale = await post(me, values, price + 100);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "price_changed");
  const before = await balanceOf(me);
  const ok = await post(me, values, price);
  assert.equal(ok.status, 202, JSON.stringify(ok.body));
  assert.equal(before - (await balanceOf(me)), price);
  await query("UPDATE generations SET status = 'REVOKED' WHERE id = $1", [ok.body.id]);
});

test("live upstream: the admin slot's model sets the Studio price (catalog block, effectivePrice, the real charge)", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const { effectivePrice } = await import("../lib/server/pricing.ts");
  const { getSetting } = await import("../lib/server/settings.ts");
  await query("DELETE FROM tool_pricing");
  setEnv(t, "GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image");
  await refresh();
  const rate = await getSetting("finance.soum_per_usd");
  const c = await catalog();
  assert.equal((c.body.pricing as { costUsd: Record<string, number> }).costUsd[NANO], 0.067, "the slot's model, priced by imagePriceOf");
  const values = { ...VALUES, imageCount: 2 };
  const price = await effectivePrice(STUDIO, values);
  assert.equal(price, Math.ceil((0.067 * 2 * rate * 2) / 100 - 1e-9) * 100, "never the lite price for a flash picture");
  assert.ok(price > Math.ceil((USD[NANO]! * 2 * rate * 2) / 100) * 100);
  const me = await mkUser();
  const before = await balanceOf(me);
  const r = await post(me, values, price);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(before - (await balanceOf(me)), price);
  await query("UPDATE generations SET status = 'REVOKED' WHERE id = $1", [r.body.id]);
  // An upstream the price book does not know falls back to the catalog cost (never free, never a guess).
  setEnv(t, "GEMINI_IMAGE_MODEL", "gemini-unknown-image");
  await refresh();
  assert.equal(((await catalog()).body.pricing as { costUsd: Record<string, number> }).costUsd[NANO], undefined);
  assert.equal(await effectivePrice(STUDIO, values), Math.ceil((USD[NANO]! * 2 * rate * 2) / 100 - 1e-9) * 100);
});

/* ───────────────────────────── catalog endpoint ───────────────────────────── */

test("catalog: shape, available models only, default model, pricing = server, no routes or upstream ids", { skip: skipDb }, async (t) => {
  quiet(t);
  await db();
  const { mediaPricing } = await import("../lib/server/media/pricing.ts");
  await refresh();
  const only = await catalog();
  assert.equal(only.status, 200);
  assert.deepEqual(Object.keys(only.body).sort(), ["defaultModelId", "models", "pricing", "purpose"]);
  assert.equal(only.body.purpose, "studio.image");
  assert.deepEqual((only.body.models as { id: string }[]).map((m) => m.id), [NANO], "no OpenAI key -> GPT Image is not offered");
  assert.equal(only.body.defaultModelId, NANO);
  assert.deepEqual(only.body.pricing, await mediaPricing());

  setEnv(t, "OPENAI_API_KEY", "sk-test-openai-key-123456");
  await refresh();
  const both = await catalog();
  const models = both.body.models as Record<string, unknown>[];
  assert.deepEqual(models.map((m) => m.id), [NANO, GPT], "catalog order");
  const client = MEDIA_CATALOG.clientView();
  for (const m of models) {
    assert.ok(!("routes" in m), "routes stripped");
    assert.deepEqual(m, JSON.parse(JSON.stringify(client.find((c) => c.id === m.id))), "exactly the client view");
    assert.ok(Array.isArray(m.params) && (m.params as { name: string }[]).map((p) => p.name).join() === "prompt,imageRatio,imageCount,imageStyle");
    // Contract with the UI: Uslub sits under «Qo'shimcha sozlamalar».
    assert.deepEqual((m.params as { name: string; advanced?: boolean }[]).filter((p) => p.advanced).map((p) => p.name), ["imageStyle"]);
    assert.ok(m.cost, "cost rule shipped for the client preview");
  }
  for (const secret of ["gemini-3.1-flash-lite-image", "gpt-image-2.5-flare", "upstream", "adapter", "google-image", "\"openai-image\"", "routes", "test-gemini-key", "sk-test"]) {
    assert.ok(!both.text.includes(secret), `payload leaks ${secret}`);
  }

  // The admin hid Nano Banana: GPT Image becomes the default.
  await setOverride(NANO, { enabled: false });
  t.after(() => setOverride(NANO, null));
  const hidden = await catalog();
  assert.deepEqual((hidden.body.models as { id: string }[]).map((m) => m.id), [GPT]);
  assert.equal(hidden.body.defaultModelId, GPT);
  setEnv(t, "OPENAI_API_KEY", undefined);
  await refresh();
  const none = await catalog();
  assert.deepEqual(none.body.models, []);
  assert.equal(none.body.defaultModelId, null);

  for (const purpose of ["rasm.image", "video.clip", "listening.voice", "nope", ""]) assert.equal((await catalog(purpose)).status, 400, purpose);
});

/* ───────────────────────────── gallery ───────────────────────────── */

test("gallery: only my completed Studio pictures, newest first, 24 a page with a cursor; asset URLs only", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const route = await import("../app/api/media/gallery/route.ts");
  const get = async (cookie: string | null, cursor?: string) => {
    const req = new Request(`http://localhost/api/media/gallery${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: cookie ? { cookie } : {} });
    const r = await inRequest(req, () => route.GET(req));
    return { status: r.status, body: (await r.json()) as { items: { id: string; modelId: string; modelLabel: string; prompt: string; images: { url: string }[]; fileUrl: string }[]; nextCursor: string | null } };
  };
  const me = await mkUser();
  const other = await mkUser();
  const ins = async (userId: string, o: { tool?: string; status?: string; minutesAgo: number; model?: string; images?: string[] }) => {
    const id = randomUUID();
    const doc = { imageModel: o.model ?? NANO, imagePrompt: `prompt ${o.minutesAgo}`, images: (o.images ?? [`/api/generations/${id}/assets/abc123`]).map((url) => ({ id: "img1", url, alt: "x", w: 1024, h: 1024 })) };
    await query(
      `INSERT INTO generations (id, user_id, tool_id, topic, status, price, format, doc_json, created_at)
       VALUES ($1, $2, $3, 'T', $4, 900, 'png', $5::jsonb, now() - $6::int * interval '1 minute')`,
      [id, userId, o.tool ?? "studio-image", o.status ?? "COMPLETED", JSON.stringify(doc), o.minutesAgo],
    );
    return id;
  };
  const mine: string[] = [];
  for (let i = 0; i < 30; i++) mine.push(await ins(me, { minutesAgo: i, model: i % 2 ? GPT : NANO }));
  const theirs = await ins(other, { minutesAgo: 0 });
  const rasm = await ins(me, { tool: "image", minutesAgo: 1 });
  const failed = await ins(me, { status: "FAILED", minutesAgo: 1 });
  const dataUrl = await ins(me, { minutesAgo: 100, images: ["data:image/png;base64,AAAA", "https://evil.example/x.png"] });
  const cookie = await cookieOf(me);

  const p1 = await get(cookie);
  assert.equal(p1.status, 200);
  assert.equal(p1.body.items.length, 24);
  assert.deepEqual(p1.body.items.map((i) => i.id), mine.slice(0, 24), "newest first");
  assert.ok(p1.body.nextCursor);
  assert.equal(p1.body.items[1].modelId, GPT);
  assert.equal(p1.body.items[1].modelLabel, MEDIA_CATALOG.byId(GPT)!.label);
  assert.equal(p1.body.items[0].prompt, "prompt 0");
  assert.deepEqual(p1.body.items[0].images, [{ url: `/api/generations/${mine[0]}/assets/abc123`, w: 1024, h: 1024 }]);
  assert.equal(p1.body.items[0].fileUrl, `/api/generations/${mine[0]}/file`);
  const p2 = await get(cookie, p1.body.nextCursor!);
  assert.deepEqual(p2.body.items.map((i) => i.id), [...mine.slice(24), dataUrl]);
  assert.equal(p2.body.nextCursor, null);
  assert.deepEqual(p2.body.items.at(-1)!.images, [], "data: and foreign URLs are never passed on");
  const all = [...p1.body.items, ...p2.body.items].map((i) => i.id);
  for (const id of [theirs, rasm, failed]) assert.ok(!all.includes(id), `${id} must not be listed`);
  // Another user's cursor cannot widen the query: the other user sees only their own job.
  const o = await get(await cookieOf(other), p1.body.nextCursor!);
  assert.deepEqual(o.body.items.map((i) => i.id), [], "older than the cursor and theirs: none");
  assert.deepEqual((await get(await cookieOf(other))).body.items.map((i) => i.id), [theirs]);
  assert.equal((await get(cookie, "junk")).status, 400);
  assert.equal((await get(null)).status, 401);
});

/* ───────────────────────────── N3 ───────────────────────────── */

test("N3: runMedia refuses a model its purpose does not allow and an unknown purpose; listening may use ElevenLabs", async () => {
  const { runMedia } = await import("../lib/server/media/run.ts");
  let submits = 0;
  const adapter = (id: string) => ({
    id,
    configured: () => true,
    submit: async () => {
      submits++;
      return { done: [{ kind: "inline" as const, bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mime: "image/jpeg" }] };
    },
    fetchOutput: async () => new Uint8Array(),
  });
  const img = { "google-image": adapter("google-image"), "openai-image": adapter("openai-image") };
  await assert.rejects(runMedia({ purpose: "proslide.illustration", modelId: GPT, values: {}, step: "s", adapters: img }), (e: unknown) => e instanceof MediaError && /not allowed/.test(e.message));
  await assert.rejects(runMedia({ purpose: "studio.image", modelId: "google/omni-video", values: {}, step: "s", adapters: img }), (e: unknown) => e instanceof MediaError && /not allowed/.test(e.message));
  await assert.rejects(runMedia({ purpose: "nope.purpose", modelId: NANO, values: {}, step: "s", adapters: img }), (e: unknown) => e instanceof Error && !(e instanceof MediaError) && /unknown purpose/.test(e.message));
  assert.equal(submits, 0, "nothing reached a provider");
  await runMedia({ purpose: "studio.image", modelId: GPT, values: { prompt: "abc" }, step: "s", adapters: img });
  await runMedia({ purpose: "rasm.image", modelId: NANO, values: { prompt: "abc" }, step: "s", adapters: img });
  assert.equal(submits, 2);
  // The operator path: `tts.order` may put ElevenLabs into the listening chain.
  assert.ok(MEDIA_PURPOSES.byId("listening.voice")!.allowed.includes("elevenlabs/tts"));
  const speech = { ...adapter("elevenlabs-speech"), submit: async () => ({ done: [{ kind: "inline" as const, bytes: new Uint8Array([0x49, 0x44, 0x33, 3]), mime: "audio/mpeg" }] }) };
  const out = await runMedia({ purpose: "listening.voice", modelId: "elevenlabs/tts", values: { text: "salom" }, step: "s", adapters: { "elevenlabs-speech": speech } });
  assert.equal(out.outputs.length, 1);
  await assert.rejects(runMedia({ purpose: "domla.voice", modelId: "elevenlabs/tts", values: { text: "salom" }, step: "s", adapters: { "elevenlabs-speech": speech } }), /not allowed/);
});

/* ───────────────────────────── M5 ───────────────────────────── */

test("M5: stuck sync rows are failed after 1 h (video and fresh rows untouched); rows > 90 days deleted in batches", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const jobs = await import("../lib/server/media/jobs.ts");
  await query("DELETE FROM media_jobs");
  const row = async (o: { model: string; status: string; ageMin: number }) => {
    const key = `m5:${randomUUID()}`;
    await query(
      `INSERT INTO media_jobs (id, generation_id, purpose, model_id, provider, upstream_model, idempotency_key, status, created_at)
       VALUES ($1, NULL, 'studio.image', $2, 'p', 'u', $3, $4, now() - $5::int * interval '1 minute')`,
      [randomUUID(), o.model, key, o.status, o.ageMin],
    );
    return key;
  };
  const statusOf = async (key: string) => (await query<{ status: string; last_error: string | null; finished_at: Date | null }>("SELECT status, last_error, finished_at FROM media_jobs WHERE idempotency_key = $1", [key]))[0];
  const stuck = await row({ model: NANO, status: "submitting", ageMin: 61 });
  const stuckSpeech = await row({ model: "azure/tts", status: "submitting", ageMin: 120 });
  const fresh = await row({ model: NANO, status: "submitting", ageMin: 30 });
  const video = await row({ model: "google/omni-video", status: "submitting", ageMin: 180 });
  const pending = await row({ model: NANO, status: "pending", ageMin: 180 });
  assert.equal(await jobs.failStuckMediaJobs(), 2);
  assert.equal((await statusOf(stuck)).status, "failed");
  assert.match(String((await statusOf(stuck)).last_error), /stuck in submitting/);
  assert.ok((await statusOf(stuck)).finished_at);
  assert.equal((await statusOf(stuckSpeech)).status, "failed");
  assert.equal((await statusOf(fresh)).status, "submitting");
  assert.equal((await statusOf(video)).status, "submitting", "async rows are the poll loop's");
  assert.equal((await statusOf(pending)).status, "pending");
  assert.equal(await jobs.failStuckMediaJobs(), 0, "idempotent");

  const old = [await row({ model: NANO, status: "succeeded", ageMin: 91 * 1440 }), await row({ model: NANO, status: "failed", ageMin: 95 * 1440 }), await row({ model: "google/omni-video", status: "pending", ageMin: 200 * 1440 })];
  const kept = await row({ model: NANO, status: "succeeded", ageMin: 89 * 1440 });
  assert.equal(await jobs.purgeOldMediaJobs(90, 1, 10), 3, "batches of 1 until done");
  for (const k of old) assert.equal(await statusOf(k), undefined);
  assert.ok(await statusOf(kept));
  assert.equal(await jobs.purgeOldMediaJobs(90, 2, 1), 0);

  await t.test("reached from the leader housekeeping", async () => {
    const worker = await import("../lib/server/worker.ts");
    const stuck2 = await row({ model: NANO, status: "submitting", ageMin: 90 });
    const old2 = await row({ model: NANO, status: "succeeded", ageMin: 100 * 1440 });
    worker.resetRetentionScan();
    await worker.purgeHousekeeping();
    assert.equal((await statusOf(stuck2)).status, "failed");
    assert.equal(await statusOf(old2), undefined);
  });
});
