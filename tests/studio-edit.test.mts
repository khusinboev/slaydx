import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P2b — edit with a prompt, upscale, background removal (docs/studio/P2B-SPEC.md).
 *
 * What is proven here:
 *   catalog    the four P2b entries, their purposes (`studio.edit` / `studio.upscale` / `studio.bgremove`), each model in
 *              exactly one Studio purpose, the P1 picture list (`studio.image`, `FAL_IMAGE_MODELS`) unchanged;
 *   request    golden fal bodies (inputs as data URIs, one picture per call, safety on), no input → refused before any
 *              call; differential probe: every P2b param changes the request or the price as its `affects` says;
 *   adapter    a single `image` result (upscale, bria) is read; bria must answer a PNG WITH alpha (an opaque PNG and a
 *              JPEG are refused, accepted: true); a content-policy 422 on an edit is `safety`; `pngHasAlpha` on IHDR
 *              colour types and `tRNS`;
 *   price      goldens per model at ×2 and 12 700 so'm/$, rounded up to 100 (per job for the utilities, × count for edits);
 *   preflight  an edit without a picture is refused by the ParamSchema (`min: 1`) before anything is priced;
 *   ownership  another user's upload is refused by the route (400 `input_invalid`) BEFORE the charge; another user's
 *              Studio result cannot be imported (404); an upscale ×4 input over 1024 px is refused before the charge;
 *   flow       route → claimNext → runJob with a stubbed fal: bria (PNG with alpha delivered, purpose row
 *              `studio.bgremove`, the input sent as a data URI), the result imported back as an input (from-result
 *              route) and upscaled ×2 (`studio.upscale`), a Seedream edit (`studio.edit`, the translated instruction in
 *              the composed edit prompt, all inputs sent); an opaque bria answer → FAILED + full refund.
 *
 * Mutations (each turned the named test(s) red, then restored) — see docs/studio/P2B-SPEC.md «Mutations»:
 *   `pngHasAlpha` check removed from the adapter -> "adapter: bria alpha", "flow: opaque bria";
 *   single `image` result not read (only `images[]`) -> "adapter: single image result", "flow";
 *   `min: 1` dropped from the input param -> "preflight";
 *   ownership: `user_id = $1` dropped from the `studioInputsError` query -> "ownership";
 *   upscale side check removed -> "ownership: upscale ×4 side";
 *   `importStudioResult` without `g.user_id = $3` -> "ownership: import";
 *   SeedVR factor hard-coded 2 -> "request: differential probe", "golden bodies";
 *   FAL_IMAGE_MODELS without the `t2i` filter -> "catalog" (edit / utility models leak into `studio.image`).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;
delete process.env.FAL_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("studioedit") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { falAdapter, pngHasAlpha, dataUri } = await import("../lib/media/adapters/fal.ts");
const cat = await import("../lib/media/catalog.ts");
const { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_PURPOSES, studioPurposeOf, FAL_IMAGE_MODELS, STUDIO_IMAGE_PURPOSE } = cat;
const { studioImagePrice } = await import("../lib/media/studio-pricing.ts");
const { MediaError, normalize, resetBreakers } = await import("../lib/studio-core/index.ts");
const { composeEditPrompt } = await import("../lib/generation/studio/edit.ts");
const { TOOL_BY_ID, preflightError } = await import("../lib/tools.ts");

const KEY = "fal0000-test-key:5ecr3t5ecr3t";
const NANO_EDIT = "google/nano-banana-edit";
const SEED_EDIT = "bytedance/seedream-edit";
const UPSCALE = "bytedance/seedvr-upscale";
const BRIA = "bria/background-remove";
const ENDPOINT: Record<string, string> = {
  [SEED_EDIT]: "bytedance/seedream/v5/lite/edit",
  [UPSCALE]: "fal-ai/seedvr/upscale/image",
  [BRIA]: "fal-ai/bria/background/remove",
};

/** A PNG head with the given IHDR size / colour type (+ an optional tRNS chunk) and a padded IDAT. */
function png(w: number, h: number, colour: number, trns = false): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colour;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...(trns ? [chunk("tRNS", Buffer.from([0, 0, 0]))] : []),
    chunk("IDAT", Buffer.alloc(2000, 3)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const ALPHA_PNG = png(800, 600, 6);
const OPAQUE_PNG = png(800, 600, 2);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(3000, 7)]);
const uri = (b: Buffer, mime: string) => `data:${mime};base64,${b.toString("base64")}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const isSubmit = (c: Call) => c.method === "POST" && c.url.startsWith("https://queue.fal.run/");
const isStatus = (c: Call) => c.method === "GET" && c.url.endsWith("/status");
const isResult = (c: Call) => c.method === "GET" && /\/requests\/[^/]+$/.test(c.url);
function fakeFal(result: (c: Call) => Response) {
  const calls: Call[] = [];
  let n = 0;
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const c: Call = { url: String(u), method: String(init.method ?? "GET"), headers: { ...((init.headers ?? {}) as Record<string, string>) }, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(c);
    if (isSubmit(c)) return json(200, { request_id: `req-${String(n++).padStart(4, "0")}-edit` });
    if (isStatus(c)) return json(200, { status: "COMPLETED" });
    if (isResult(c)) return result(c);
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const adapter = () => falAdapter({ key: () => KEY, sleep: async () => {}, lookup: async () => ["93.184.216.34"] });
const IN = { mime: "image/png", base64: ALPHA_PNG.toString("base64") };
const input = (modelId: string, values: Record<string, unknown>, inputs = [IN]) => ({
  upstreamModel: ENDPOINT[modelId]!,
  params: normalize(MEDIA_CATALOG.byId(modelId)!.params, values) as never,
  assets: { inputImages: inputs },
  idempotencyKey: "gen:image:0",
});
async function err(p: Promise<unknown>): Promise<InstanceType<typeof MediaError>> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof MediaError, `a MediaError, got ${String(e)}`);
    return e as InstanceType<typeof MediaError>;
  }
  assert.fail("expected a MediaError");
}

/* ───────────────────────── pure ───────────────────────── */

test("catalog: four P2b entries in their own purposes; the picture list is unchanged", () => {
  assert.deepEqual(MEDIA_PURPOSES.byId("studio.edit")!.allowed, [NANO_EDIT, SEED_EDIT]);
  assert.deepEqual(MEDIA_PURPOSES.byId("studio.upscale")!.allowed, [UPSCALE]);
  assert.deepEqual(MEDIA_PURPOSES.byId("studio.bgremove")!.allowed, [BRIA]);
  assert.deepEqual(MEDIA_CATALOG.byId(NANO_EDIT)!.capabilities, ["edit"]);
  assert.deepEqual(MEDIA_CATALOG.byId(UPSCALE)!.capabilities, ["upscale"]);
  assert.deepEqual(MEDIA_CATALOG.byId(BRIA)!.capabilities, ["bg-remove"]);
  assert.deepEqual(MEDIA_CATALOG.byId(BRIA)!.output.mimes, ["image/png"]);
  for (const id of [NANO_EDIT, SEED_EDIT, UPSCALE, BRIA]) assert.ok(!MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed.includes(id), `${id} is not a picture model`);
  assert.equal(FAL_IMAGE_MODELS.length, 6, "the six P2a models only");
  // Each Studio model belongs to exactly one Studio purpose (the route and the engine rely on it).
  const all = STUDIO_PURPOSES.flatMap((p) => MEDIA_PURPOSES.byId(p)!.allowed);
  assert.equal(new Set(all).size, all.length);
  for (const id of all) assert.ok(studioPurposeOf(id));
  assert.equal(studioPurposeOf(UPSCALE), "studio.upscale");
  assert.equal(studioPurposeOf("nope/x"), null);
});

test("golden bodies: inputs as data URIs, one picture per call, safety checker on", () => {
  const a = adapter();
  const two = [IN, { mime: "image/jpeg", base64: JPEG.toString("base64") }];
  assert.deepEqual(a.buildRequest!(input(SEED_EDIT, { prompt: "osmonni to'q sariq qil", imageCount: 2 }, two)).body, {
    prompt: "osmonni to'q sariq qil",
    image_urls: [uri(ALPHA_PNG, "image/png"), uri(JPEG, "image/jpeg")],
    image_size: "auto_2K",
    num_images: 1,
    output_format: "jpeg",
    enable_safety_checker: true,
    sync_mode: true,
  });
  assert.deepEqual(a.buildRequest!(input(UPSCALE, { factor: "4" })).body, {
    image_url: dataUri(IN),
    upscale_mode: "factor",
    upscale_factor: 4,
    output_format: "jpg",
    enable_safety_checker: true,
    sync_mode: true,
  });
  assert.deepEqual(a.buildRequest!(input(BRIA, {})).body, { image_url: dataUri(IN), sync_mode: true });
  assert.equal(a.buildRequest!(input(BRIA, {})).url, "https://queue.fal.run/fal-ai/bria/background/remove");
  for (const id of [SEED_EDIT, UPSCALE, BRIA]) assert.throws(() => a.buildRequest!(input(id, { prompt: "abc" }, [])), /kirish rasmi yo'q/, `${id}: no input, no request`);
});

test("request: differential probe — every P2b param changes the request or the price (as `affects` says)", () => {
  const a = adapter();
  const rate = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
  for (const id of [SEED_EDIT, UPSCALE, BRIA, NANO_EDIT]) {
    const e = MEDIA_CATALOG.byId(id)!;
    for (const p of e.params) {
      const base: Record<string, unknown> = { prompt: "osmonni o'zgartir", inputImages: ["a".repeat(24)] };
      let alt: unknown;
      if (p.type === "enum") alt = p.options.find((o) => o.value !== p.default)!.value;
      else if (p.type === "int") alt = p.max;
      else if (p.type === "text") alt = "boshqa ko'rsatma matni";
      else if (p.type === "image") alt = ["a".repeat(24), "b".repeat(24)].slice(0, p.max === 1 ? 1 : 2);
      const changed = { ...base, [p.name]: alt };
      const priceA = studioImagePrice({ ...base, modelId: id }, rate);
      const priceB = studioImagePrice({ ...changed, modelId: id }, rate);
      const priceMoved = priceA !== priceB;
      if (p.type === "image" && p.max === 1) {
        // One picture max: the probe swaps the id instead; the adapter sends whatever the host resolved.
        assert.ok(!priceMoved, `${id}.${p.name}: inputs never change the price`);
        continue;
      }
      let requestMoved = false;
      if (e.routes[0]!.adapter === "fal") {
        const inputsOf = (v: Record<string, unknown>) => (Array.isArray(v.inputImages) ? (v.inputImages as string[]).map((_, i) => (i === 0 ? IN : { mime: "image/jpeg", base64: JPEG.toString("base64") })) : [IN]);
        const ra = JSON.stringify(a.buildRequest!(input(id, base, inputsOf(base))).body);
        const rb = JSON.stringify(a.buildRequest!(input(id, changed, inputsOf(changed))).body);
        requestMoved = ra !== rb;
      } else {
        // Nano Banana edit: the request is the Gemini provider's (prompt + input images, tests/media-image.test.mts).
        requestMoved = p.affects !== "price";
      }
      if (p.affects === "price") assert.ok(priceMoved && !requestMoved, `${id}.${p.name}: price only`);
      if (p.affects === "request") assert.ok(requestMoved && !priceMoved, `${id}.${p.name}: request only`);
      if (p.affects === "both") assert.ok(requestMoved && priceMoved, `${id}.${p.name}: both`);
    }
  }
});

test("adapter: single image result (upscale) is read and returned inline", async () => {
  const fal = fakeFal(() => json(200, { image: { url: uri(JPEG, "image/jpeg"), content_type: "image/jpeg" }, seed: 1 }));
  const out = await adapter().submit(input(UPSCALE, { factor: "2" }), { fetchImpl: fal.fetchImpl });
  assert.ok("done" in out);
  assert.equal(out.done.length, 1);
  assert.equal(out.done[0]!.kind === "inline" && out.done[0]!.mime, "image/jpeg");
  const submit = fal.calls.find(isSubmit)!;
  assert.equal(submit.headers.Authorization, `Key ${KEY}`);
  assert.ok(!JSON.stringify(submit.body).includes(KEY));
});

test("adapter: bria alpha — PNG with transparency delivered, opaque PNG and JPEG refused after acceptance", async () => {
  const ok = await adapter().submit(input(BRIA, {}), { fetchImpl: fakeFal(() => json(200, { image: { url: uri(ALPHA_PNG, "image/png") } })).fetchImpl });
  assert.ok("done" in ok && ok.done[0]!.kind === "inline" && ok.done[0]!.mime === "image/png");
  const opaque = await err(adapter().submit(input(BRIA, {}), { fetchImpl: fakeFal(() => json(200, { image: { url: uri(OPAQUE_PNG, "image/png") } })).fetchImpl }));
  assert.match(opaque.message, /shaffof fon yo'q/);
  assert.equal(opaque.accepted, true);
  const jpeg = await err(adapter().submit(input(BRIA, {}), { fetchImpl: fakeFal(() => json(200, { image: { url: uri(JPEG, "image/jpeg") } })).fetchImpl }));
  assert.match(jpeg.message, /unexpected output type image\/jpeg/);
  assert.equal(pngHasAlpha(ALPHA_PNG), true);
  assert.equal(pngHasAlpha(png(10, 10, 4)), true, "grey + alpha");
  assert.equal(pngHasAlpha(png(10, 10, 3, true)), true, "palette + tRNS");
  assert.equal(pngHasAlpha(OPAQUE_PNG), false);
  assert.equal(pngHasAlpha(JPEG), false);
  assert.equal(pngHasAlpha(new Uint8Array(4)), false);
});

test("adapter: an edit refused by content policy is `safety`; an edit result with images[] is read", async () => {
  const refused = await err(
    adapter().submit(input(SEED_EDIT, { prompt: "abc" }), {
      fetchImpl: fakeFal(() => json(422, { detail: [{ msg: "flagged", type: "content_policy_violation" }] })).fetchImpl,
    }),
  );
  assert.equal(refused.safety, true);
  assert.equal(refused.accepted, true);
  const ok = await adapter().submit(input(SEED_EDIT, { prompt: "abc" }), { fetchImpl: fakeFal(() => json(200, { images: [{ url: uri(JPEG, "image/jpeg") }] })).fetchImpl });
  assert.ok("done" in ok && ok.done.length === 1);
});

test("price goldens at ×2, 12 700 so'm/$ (rounded up to 100): per job for utilities, × count for edits", () => {
  const block = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {}, costUsd: {} };
  const up = (usd: number) => Math.ceil((usd * 12_700 * 2) / 100 - 1e-9) * 100;
  assert.equal(studioImagePrice({ modelId: UPSCALE, factor: "2" }, block), up(0.0168));
  assert.equal(studioImagePrice({ modelId: UPSCALE, factor: "4" }, block), up(0.0168), "the factor does not change the (upper-bound) price");
  assert.equal(up(0.0168), 500);
  assert.equal(studioImagePrice({ modelId: BRIA }, block), 500);
  assert.equal(studioImagePrice({ modelId: SEED_EDIT, imageCount: 1 }, block), 900);
  assert.equal(studioImagePrice({ modelId: SEED_EDIT, imageCount: 3 }, block), up(0.035 * 3));
  assert.equal(studioImagePrice({ modelId: NANO_EDIT, imageCount: 2 }, block), up(0.034 * 2));
  // The admin's per-model markup wins here too.
  assert.equal(studioImagePrice({ modelId: BRIA }, { ...block, overrides: { [BRIA]: { markup: 5 } } }), up(0.018 * 2.5));
});

test("preflight: an edit / utility without a picture is refused by the ParamSchema before any price", () => {
  const tool = TOOL_BY_ID["studio-image"];
  assert.match(String(preflightError(tool, { modelId: SEED_EDIT, prompt: "osmonni o'zgartir" } as never)), /rasm yuklang/);
  assert.match(String(preflightError(tool, { modelId: UPSCALE, inputImages: [] } as never)), /rasm yuklang/);
  assert.match(String(preflightError(tool, { modelId: BRIA, inputImages: ["a".repeat(24), "b".repeat(24)] } as never)), /eng ko'pi 1 ta/);
  assert.match(String(preflightError(tool, { modelId: UPSCALE, inputImages: ["a".repeat(24)], factor: "8" } as never)), /noma'lum qiymat/);
  assert.equal(preflightError(tool, { modelId: BRIA, inputImages: ["a".repeat(24)] } as never), null);
});

test("composeEditPrompt: instruction + keep-the-rest; several inputs name the first as the one to edit", () => {
  const one = composeEditPrompt(" Make the sky orange ", 1);
  assert.match(one, /^Edit the attached image exactly as instructed: Make the sky orange\. /);
  assert.match(one, /Keep the composition/);
  assert.match(composeEditPrompt("x", 3), /the 3 attached images \(the first one is the image to edit/);
});

/* ───────────────────────── DB: ownership + flow ───────────────────────── */

const REAL_FETCH = globalThis.fetch;
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
  globalThis.fetch = REAL_FETCH;
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
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Edit', 0, 0, $2) RETURNING id", [`edit-${process.pid}-${seq++}`, balance]))[0].id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0].b);
}
async function cookie(userId: string): Promise<string> {
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  return `${SESSION_COOKIE}=${(await createSession(userId)).token}`;
}
async function post(userId: string, values: Record<string, unknown>) {
  const route = await import("../app/api/generations/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: await cookie(userId), "content-type": "application/json" },
    // As the Studio form sends them (`requestValues`): a list of asset ids is comma-separated (form values are scalars).
    body: JSON.stringify({ slug: "studio", values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v])) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
}
async function importResult(userId: string, body: Record<string, unknown>) {
  const route = await import("../app/api/media/inputs/from-result/route.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'media:inputs:%'");
  const req = new Request("http://localhost/api/media/inputs/from-result", { method: "POST", headers: { cookie: await cookie(userId), "content-type": "application/json" }, body: JSON.stringify(body) });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { assetId?: string; error?: string } };
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
async function upload(userId: string, bytes: Buffer, mime: "image/png" | "image/jpeg" = "image/png"): Promise<string> {
  const { putPhoto } = await import("../lib/server/photo.ts");
  return putPhoto(userId, bytes, mime, { kind: "studio" });
}

test("ownership: another user's upload / result is refused BEFORE the charge; upscale ×4 side limit", { skip: skipDb }, async (t) => {
  quiet(t);
  await db();
  process.env.FAL_KEY = KEY;
  t.after(() => void delete process.env.FAL_KEY);
  await refresh();
  const alice = await mkUser();
  const bob = await mkUser();
  const aliceAsset = await upload(alice, ALPHA_PNG);

  const stolen = await post(bob, { modelId: BRIA, inputImages: [aliceAsset] });
  assert.equal(stolen.status, 400, JSON.stringify(stolen.body));
  assert.equal(stolen.body.code, "input_invalid");
  assert.equal(await balanceOf(bob), 100_000, "nothing charged");

  const big = await upload(alice, png(1500, 900, 6));
  const tooBig = await post(alice, { modelId: UPSCALE, inputImages: [big], factor: "4" });
  assert.equal(tooBig.status, 400);
  assert.match(String(tooBig.body.error), /1024 pikseldan/);
  assert.equal(await balanceOf(alice), 100_000);
  const ok2 = await post(alice, { modelId: UPSCALE, inputImages: [big], factor: "2" });
  assert.equal(ok2.status, 202, "×2 accepts a 1500 px input");

  const { query } = await db();
  await query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
  // A finished Studio job of Alice with one stored picture.
  const gen = (await query<{ id: string }>(
    `INSERT INTO generations (id, user_id, tool_id, status) VALUES (gen_random_uuid(), $1, 'studio-image', 'COMPLETED') RETURNING id`,
    [alice],
  ))[0].id;
  await query("INSERT INTO generation_assets (generation_id, asset_id, mime, size_bytes, bytes) VALUES ($1, 'abc123abc123', 'image/png', $2, $3)", [gen, ALPHA_PNG.length, ALPHA_PNG]);
  const theft = await importResult(bob, { generationId: gen, assetId: "abc123abc123" });
  assert.equal(theft.status, 404, "another user's result is not found");
  const own = await importResult(alice, { generationId: gen, assetId: "abc123abc123" });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.match(String(own.body.assetId), /^[0-9a-f]{24}$/);
  const bad = await importResult(alice, { generationId: "nope", assetId: "abc" });
  assert.equal(bad.status, 400);
});

test("flow: bria → import → upscale → seedream edit, with a stubbed fal; opaque answer refunded", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { getSetting } = await import("../lib/server/settings.ts");
  process.env.FAL_KEY = KEY;
  t.after(() => void delete process.env.FAL_KEY);
  await refresh();
  resetBreakers();
  const me = await mkUser();
  const rate = await getSetting("finance.soum_per_usd");
  const up = (usd: number) => Math.ceil((usd * rate * 2) / 100 - 1e-9) * 100;

  let answer: (c: Call) => Response = () => json(200, { image: { url: uri(ALPHA_PNG, "image/png") } });
  const calls: Call[] = [];
  let n = 0;
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    if (url.includes(":generateContent")) return json(200, { candidates: [{ content: { parts: [{ text: '{"instruction":"Make the sky orange"}' }] } }] });
    const c: Call = { url, method: String(init.method ?? "GET"), headers: { ...((init.headers ?? {}) as Record<string, string>) }, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(c);
    if (isSubmit(c)) return json(200, { request_id: `req-${String(n++).padStart(4, "0")}-flow` });
    if (isStatus(c)) return json(200, { status: "COMPLETED" });
    if (isResult(c)) return answer(c);
    return json(404, {});
  }) as unknown as typeof fetch;
  t.after(() => void (globalThis.fetch = REAL_FETCH));

  async function run(values: Record<string, unknown>) {
    await query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
    calls.length = 0;
    const before = await balanceOf(me);
    const r = await post(me, values);
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(before - (await balanceOf(me)), r.body.price);
    const job = await worker.claimNext();
    assert.equal(job?.id, r.body.id);
    await worker.runJob(job!);
    return { id: r.body.id!, price: r.body.price!, gen: await getGeneration(r.body.id!, me), spent: before - (await balanceOf(me)) };
  }

  // 1. Background removal of an upload.
  const photo = await upload(me, ALPHA_PNG);
  const bg = await run({ modelId: BRIA, inputImages: [photo] });
  assert.equal(bg.price, up(0.018));
  assert.equal(bg.gen?.status, "COMPLETED", String(bg.gen?.error));
  assert.equal(bg.gen?.doc?.imageModel, BRIA);
  assert.equal(bg.gen?.doc?.imagePrompt, "Fonni olib tashlash");
  const file = (await query<{ mime: string }>("SELECT mime FROM generation_files WHERE generation_id = $1", [bg.id]))[0];
  assert.equal(file?.mime, "image/png", "a transparent PNG is delivered");
  const sub = calls.find(isSubmit)!;
  assert.equal(sub.url, `https://queue.fal.run/${ENDPOINT[BRIA]}`);
  assert.equal((sub.body as { image_url: string }).image_url, uri(ALPHA_PNG, "image/png"), "the user's own picture, inline");
  const rows = await mediaJobsOf(bg.id);
  assert.deepEqual(rows.map((r) => [r.purpose, r.model_id, r.status]), [["studio.bgremove", BRIA, "succeeded"]]);

  // 2. Its result back as an input, upscaled ×2.
  const asset = /\/assets\/([0-9a-f]+)$/.exec(String(bg.gen?.doc?.images?.[0]?.url))?.[1];
  assert.ok(asset, "the result is stored as a generation asset");
  const imported = await importResult(me, { generationId: bg.id, assetId: asset! });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  answer = () => json(200, { image: { url: uri(JPEG, "image/jpeg") } });
  const upj = await run({ modelId: UPSCALE, inputImages: [imported.body.assetId], factor: "2" });
  assert.equal(upj.gen?.status, "COMPLETED", String(upj.gen?.error));
  assert.equal((calls.find(isSubmit)!.body as { upscale_factor: number }).upscale_factor, 2);
  assert.deepEqual((await mediaJobsOf(upj.id)).map((r) => r.purpose), ["studio.upscale"]);

  // 3. A Seedream edit with two inputs: the translated instruction, both pictures sent, 2 pictures = 2 calls.
  answer = () => json(200, { images: [{ url: uri(JPEG, "image/jpeg") }] });
  const second = await upload(me, png(640, 480, 2));
  const ed = await run({ modelId: SEED_EDIT, prompt: "osmonni to'q sariq qil", inputImages: [photo, second], imageCount: 2 });
  assert.equal(ed.price, up(0.035 * 2));
  assert.equal(ed.gen?.status, "COMPLETED", String(ed.gen?.error));
  const subs = calls.filter(isSubmit);
  assert.equal(subs.length, 2);
  for (const s of subs) {
    const b = s.body as { prompt: string; image_urls: string[] };
    assert.match(b.prompt, /^Edit the 2 attached images .*: Make the sky orange/);
    assert.equal(b.image_urls.length, 2);
  }
  assert.deepEqual((await mediaJobsOf(ed.id)).map((r) => r.purpose), ["studio.edit", "studio.edit"]);

  // 4. bria answers an OPAQUE PNG: no cut-out delivered → FAILED, full refund.
  answer = () => json(200, { image: { url: uri(OPAQUE_PNG, "image/png") } });
  const opaque = await run({ modelId: BRIA, inputImages: [photo] });
  assert.equal(opaque.gen?.status, "FAILED");
  assert.equal(opaque.spent, 0, "refunded in full");
});
