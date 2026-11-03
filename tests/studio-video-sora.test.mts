import test from "node:test";
import assert from "node:assert/strict";
import { normalize, type AdapterAsset, type AdapterInput, type CatalogEntry } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import { ASPECT_FOLLOWS_IMAGE, SORA_ENTRIES, SORA_SECONDS, SORA_USD_PER_SECOND, STUDIO_VIDEO_PURPOSE } from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { FAL_VIDEO_ENDPOINTS, parseFalVideoOp } from "../lib/media/adapters/fal.ts";
import { studioVideoError, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { TOOL_BY_ID, basePriceFor } from "../lib/tools.ts";
import { studioVideoClientPrice } from "../components/studio/video/video-price.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";

/**
 * STUDIO P9 — OpenAI Sora 2 / Sora 2 Pro in the «Video» tab through fal (docs/studio/P9-SPEC.md). Same queue adapter
 * as P4 (`fal-video`; its submit / poll / download rules are tests/studio-video-fal.test.mts); this file pins what is
 * Sora's own. Stubbed `fetch`: no network, no paid call.
 *
 *   catalog   two entries on route `fal-video`, 4 / 8 / 12 s (step 4), 16:9 | 9:16, no end frame, no sound switch, Sora 2
 *             without a resolution row (one tier), Pro 720p | 1080p; picker order after the P4 models;
 *   golden    request body × text / image (image_url, aspect «auto», resolution always sent, duration a string,
 *             `model` pinned on the standard endpoint only); the poll goes to the app `fal-ai/sora-2`;
 *   probe     every param changes the request or the price, as its `affects` says;
 *   prices    goldens at ×2 and 12 700 so'm/$; client == server (tool % too);
 *   preflight a length Sora is not sold at (5 s, 16 s) and 1:1 are refused before charging.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `soraBody` sends the form's aspect in image → video            -> «golden»;
 *   2. duration sent as a number                                       -> «golden»;
 *   3. `model: "sora-2"` sent to the Pro endpoint too                  -> «golden»;
 *   4. Pro 1080p priced at the 720p rate                               -> «prices», «probe»;
 *   5. seconds step 4 → 1 (5 s accepted)                               -> «preflight», «catalog».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

const FKEY = "fal-test-key-0123:secretsecretvalue";
const START: AdapterAsset = { mime: "image/png", base64: "c3RhcnQtZnJhbWU=" };
const ASSET = "0123456789abcdef01234567";
const RATE = 12_700;
const PRICING = { soumPerUsd: RATE, markup: 2, step: 100, overrides: {}, costUsd: {} };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const IDS = ["openai/sora-2", "openai/sora-2-pro"];
const REQ = "4f1c2b3a-9d8e-4c7b-a6f5-0123456789ab";
const Q = "https://queue.fal.run";

const entry = (id: string): CatalogEntry => MEDIA_CATALOG.byId(id)!;
const all = () => studioVideoAdapters({ klingKeyFn: () => "AK:SK", falKeyFn: () => FKEY });
function input(id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}): AdapterInput {
  const e = entry(id);
  return { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(Object.keys(assets).length ? { assets } : {}), idempotencyKey: "g:video:0" };
}
const req = (id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}) => all()[entry(id).routes[0]!.adapter]!.buildRequest!(input(id, values, assets));
const T = { prompt: "Registon at dawn, slow dolly", seconds: 8 };
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("catalog: Sora 2 + Sora 2 Pro on fal-video; 4/8/12 s; 16:9 | 9:16; no end frame / sound row; one-tier Sora 2 has no resolution row", () => {
  assert.deepEqual(SORA_ENTRIES.map((e) => e.id), IDS);
  const allowed = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed;
  // P9 HeyGen sits between Sora and the effects (tests/studio-video-heygen.test.mts).
  assert.deepEqual(allowed.slice(-4), [...IDS, "heygen/avatar", "kling/effects"], "after the P4 fal models, before HeyGen and the effects");
  for (const id of IDS) {
    const e = entry(id);
    assert.equal(e.kind, "video");
    assert.equal(e.maker, "OpenAI");
    assert.deepEqual(e.capabilities, ["t2v", "i2v"]);
    assert.equal(e.routes.length, 1);
    assert.equal(e.routes[0]!.provider, "fal");
    assert.equal(e.routes[0]!.adapter, "fal-video");
    const secs = e.params.find((p) => p.name === "seconds")!;
    assert.ok(secs.type === "int");
    assert.deepEqual([secs.min, secs.max, secs.step, secs.default], [4, 12, 4, 4]);
    assert.deepEqual(SORA_SECONDS, [4, 8, 12]);
    const aspect = e.params.find((p) => p.name === "aspect")!;
    assert.ok(aspect.type === "enum");
    assert.deepEqual(aspect.options.map((o) => o.value), ["16:9", "9:16"]);
    assert.ok(!e.params.some((p) => p.name === "endImageAssetId"), "Sora takes no end frame");
    assert.ok(!e.params.some((p) => p.name === "sound"), "Sora always makes sound: no decorative switch");
    assert.ok(e.params.some((p) => p.name === "imageAssetId" && p.type === "image"));
    assert.ok(ASPECT_FOLLOWS_IMAGE.has(id), "image → video: the frame decides the canvas, the form hides «O'lcham»");
  }
  assert.ok(!entry("openai/sora-2").params.some((p) => p.name === "resolution"), "MUTATSIYA: a one-option «Sifat» row");
  const res = entry("openai/sora-2-pro").params.find((p) => p.name === "resolution")!;
  assert.ok(res.type === "enum");
  assert.deepEqual(res.options.map((o) => o.value), ["720p", "1080p"]);
  assert.equal(res.default, "1080p");
  assert.deepEqual(SORA_USD_PER_SECOND, { "openai/sora-2": { "720p": 0.1 }, "openai/sora-2-pro": { "720p": 0.3, "1080p": 0.5 } });
  for (const e of MEDIA_CATALOG.clientView().filter((x) => IDS.includes(x.id))) assert.ok(!("routes" in e));
});

test("golden: Sora bodies × text / image; the poll goes to the app fal-ai/sora-2", () => {
  const t2v = req("openai/sora-2", { ...T, aspect: "9:16" });
  assert.deepEqual(t2v, {
    url: `${Q}/fal-ai/sora-2/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: T.prompt, resolution: "720p", aspect_ratio: "9:16", duration: "8", delete_video: true, model: "sora-2" },
  });
  const i2v = req("openai/sora-2", { ...T, aspect: "9:16", imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.equal(i2v.url, `${Q}/fal-ai/sora-2/image-to-video`);
  assert.deepEqual(i2v.body, { prompt: T.prompt, image_url: `data:image/png;base64,${START.base64}`, resolution: "720p", aspect_ratio: "auto", duration: "8", delete_video: true, model: "sora-2" });
  const pro = req("openai/sora-2-pro", { ...T, seconds: 12 });
  assert.equal(pro.url, `${Q}/fal-ai/sora-2/text-to-video/pro`);
  assert.deepEqual(pro.body, { prompt: T.prompt, resolution: "1080p", aspect_ratio: "16:9", duration: "12", delete_video: true }, "MUTATSIYA: no `model` on Pro");
  const proI2v = req("openai/sora-2-pro", { ...T, resolution: "720p", imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.equal(proI2v.url, `${Q}/fal-ai/sora-2/image-to-video/pro`);
  assert.equal((proI2v.body as Record<string, unknown>).resolution, "720p");
  for (const id of IDS) assert.ok(!JSON.stringify(req(id, T)).includes(FKEY), `${id}: no key in the built request`);
  for (const ep of ["fal-ai/sora-2/text-to-video", "fal-ai/sora-2/image-to-video", "fal-ai/sora-2/text-to-video/pro", "fal-ai/sora-2/image-to-video/pro"]) {
    assert.ok(FAL_VIDEO_ENDPOINTS.has(ep), ep);
    assert.deepEqual(parseFalVideoOp(`fal:${ep}:${REQ}`), { endpoint: ep, requestId: REQ });
  }
});

test("adapter: a Sora op polls https://queue.fal.run/fal-ai/sora-2/requests/<id> (the app, not the sub-path)", async () => {
  const ad = all()["fal-video"]!;
  const seen: string[] = [];
  const fetchImpl = (async (u: unknown) => {
    seen.push(String(u));
    return String(u).endsWith("/status") ? jsonRes({ status: "COMPLETED", request_id: REQ }) : jsonRes({ video: { url: "https://v3b.fal.media/files/x/sora.mp4" }, video_id: "video_1" });
  }) as unknown as typeof fetch;
  const r = await ad.poll!(`fal:fal-ai/sora-2/text-to-video/pro:${REQ}`, { fetchImpl });
  assert.deepEqual(r, { state: "done", outputs: [{ kind: "url", url: "https://v3b.fal.media/files/x/sora.mp4", mime: "video/mp4" }] });
  assert.deepEqual(seen, [`${Q}/fal-ai/sora-2/requests/${REQ}/status`, `${Q}/fal-ai/sora-2/requests/${REQ}`]);
});

test("probe: every Sora param changes the request or the price, as its `affects` says", () => {
  const base: Record<string, Record<string, unknown>> = {
    "openai/sora-2": { prompt: "Registon at dawn", seconds: 4, aspect: "16:9" },
    "openai/sora-2-pro": { prompt: "Registon at dawn", seconds: 4, aspect: "16:9", resolution: "1080p" },
  };
  const alt: Record<string, unknown> = { prompt: "A different prompt", seconds: 12, aspect: "9:16", resolution: "720p" };
  for (const id of IDS) {
    const e = entry(id);
    const b = base[id]!;
    for (const p of e.params) {
      if (p.type === "image") {
        assert.notDeepEqual(req(id, { ...b, imageAssetId: ASSET }, { imageAssetId: [START] }), req(id, b), `${id}.${p.name}`);
        continue;
      }
      const v2 = { ...b, [p.name]: alt[p.name] };
      assert.notDeepEqual(normalize(e.params, v2)[p.name], normalize(e.params, b)[p.name], `${id}.${p.name}: the probe value is accepted`);
      const reqChanged = JSON.stringify(req(id, v2)) !== JSON.stringify(req(id, b));
      const priceChanged = studioVideoPrice({ modelId: id, ...v2 }, PRICING) !== studioVideoPrice({ modelId: id, ...b }, PRICING);
      if (p.affects === "request" || p.affects === "both") assert.ok(reqChanged, `${id}.${p.name} must change the request`);
      if (p.affects === "price" || p.affects === "both") assert.ok(priceChanged, `${id}.${p.name} must change the price`);
    }
  }
});

test("prices: USD/s × seconds × 12 700 × 2, up to 100; aspect and the photo never change it; client == server", () => {
  const p = (id: string, v: Record<string, unknown>) => studioVideoPrice({ modelId: id, prompt: "Registon at dawn", ...v }, PRICING);
  assert.equal(p("openai/sora-2", { seconds: 4 }), 10_200);
  assert.equal(p("openai/sora-2", { seconds: 8 }), 20_400);
  assert.equal(p("openai/sora-2", { seconds: 12 }), 30_500);
  assert.equal(p("openai/sora-2-pro", { seconds: 4, resolution: "720p" }), 30_500);
  assert.equal(p("openai/sora-2-pro", { seconds: 4 }), 50_800, "Pro defaults to 1080p");
  assert.equal(p("openai/sora-2-pro", { seconds: 12, resolution: "1080p" }), 152_400);
  for (const [id, table] of Object.entries(SORA_USD_PER_SECOND)) {
    for (const [res, usd] of Object.entries(table as Record<string, number>)) {
      for (const s of SORA_SECONDS) assert.equal(p(id, { seconds: s, ...(id.endsWith("pro") ? { resolution: res } : {}) }), up100(usd * s * RATE * 2), `${id} ${res} ${s}s`);
    }
  }
  assert.equal(p("openai/sora-2", { seconds: 4, aspect: "9:16", imageAssetId: ASSET }), 10_200);
  const tool = TOOL_BY_ID["studio-video"];
  const view = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));
  for (const pricing of [PRICING, { ...PRICING, markup: 2.5 }, { ...PRICING, overrides: { "openai/sora-2-pro": { markup: 1.5 } } }]) {
    for (const id of IDS) {
      for (const seconds of SORA_SECONDS) {
        for (const resolution of id.endsWith("pro") ? ["720p", "1080p"] : [undefined]) {
          const values = { modelId: id, prompt: "Registon at dawn", seconds, ...(resolution ? { resolution } : {}) };
          assert.equal(studioVideoClientPrice(view.get(id)!, values, pricing, undefined), basePriceFor(tool, values as never, pricing), `${id} ${seconds} ${resolution}`);
        }
      }
    }
  }
});

test("preflight: only 4 / 8 / 12 s and 16:9 | 9:16 are sold — anything else is refused before charging", () => {
  const ok = { modelId: "openai/sora-2", prompt: "Registon at dawn" };
  assert.equal(studioVideoError({ ...ok, seconds: 8 }), null);
  assert.equal(studioVideoError({ ...ok, seconds: 12, aspect: "9:16" }), null);
  for (const seconds of [5, 10, 16, 20, 2]) assert.ok(studioVideoError({ ...ok, seconds }), `MUTATSIYA: ${seconds} s must be refused`);
  assert.ok(studioVideoError({ ...ok, seconds: 4, aspect: "1:1" }), "1:1 is not a Sora aspect");
  assert.ok(studioVideoError({ ...ok, modelId: "openai/sora-2-pro", seconds: 4, resolution: "true_1080p" }));
});
