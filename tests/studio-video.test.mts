import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { normalize, MediaError, type AdapterInput, type CatalogEntry } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import { KLING_EFFECTS, KLING_EFFECT_USD, KLING_V3_USD_PER_SECOND, STUDIO_VIDEO_PURPOSE } from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { studioVideoError, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { buildKlingRequest, KLING_MODEL } from "../lib/generation/video/kling.ts";
import { VIDEO_SAFETY_MESSAGE } from "../lib/generation/video/types.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { TOOL_BY_ID, basePriceFor, preflightError, topicOf } from "../lib/tools.ts";
import { studioVideoClientPrice, videoCardPrice } from "../components/studio/video/video-price.ts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";
import { applyPriceAdjust } from "../lib/price-adjust.ts";
import { groupDigits } from "../lib/format.ts";

/**
 * STUDIO «VIDEO» (docs/studio/P3-SPEC.md) — catalog entries, request builders, auth, error mapping, prices. Stubbed
 * `fetch`: no network, no paid call.
 *
 *   builders  Kling 3.0 t2v / i2v and the effects endpoint: golden bodies; a differential probe over EVERY param of
 *             every `studio.video` model (each changes the request or the price, as its `affects` says);
 *   auth      the Studio adapters sign the same HS256 JWT over the secret half of `<access>:<secret>`, the key never in
 *             a body / message; the old «Video» request is byte-identical (`kling-v2-master`);
 *   errors    HTTP 4xx = not accepted / not retryable, 429 / 5xx retryable, network = accepted (maybe started), code 1301 =
 *             safety; poll of an effect op asks `/v1/videos/effects/<id>`;
 *   prices    cost × markup × rate, rounded UP to 100 — goldens at ×2 and 12 700 so'm/$ for seconds × tier × sound and
 *             per effect; the client preview (`studioVideoClientPrice`) equals the server formula (`basePriceFor`);
 *   preflight unknown model, effect without a photo, a length / aspect the model does not offer → refused before charge.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `buildKlingV3Request` drops `sound`                          -> «Kling 3.0 golden», «probe»;
 *   2. tier adapter `kling-v3-pro` sends mode `std`                 -> «Kling 3.0 golden»;
 *   3. effect body without `effect_scene`                           -> «effects golden», «probe»;
 *   4. cost table `sound.true` = the silent price                   -> «price goldens», «probe»;
 *   5. klingStudioAdapter submit maps a 4xx as accepted             -> «error mapping»;
 *   6. `pollKlingTask` without the `effects` kind                   -> «error mapping» (effect poll);
 *   7. `studioVideoError` lets an effect through without its photo  -> «preflight»;
 *   8. client preview ignores the model override                    -> «client preview == server».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

const KKEY = "AKstudioaccess:SKstudiosecretvalue";
const IMG = { mime: "image/png", base64: "aW1hZ2UtYnl0ZXM=" };
const ASSET = "0123456789abcdef01234567";
const RATE = 12_700;
const PRICING = { soumPerUsd: RATE, markup: 2, step: 100, overrides: {}, costUsd: {} };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;

const adapters = (fetchImpl?: typeof fetch) => ({ all: studioVideoAdapters({ klingKeyFn: () => KKEY }), deps: fetchImpl ? { fetchImpl } : {} });
const entry = (id: string): CatalogEntry => MEDIA_CATALOG.byId(id)!;
function input(e: CatalogEntry, values: Record<string, unknown>, withImage = false): AdapterInput {
  return { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(withImage ? { assets: { imageAssetId: [IMG] } } : {}), idempotencyKey: "g:video:0" };
}
const requestOf = (id: string, values: Record<string, unknown>, withImage = false) => {
  const e = entry(id);
  return adapters().all[e.routes[0]!.adapter]!.buildRequest!(input(e, values, withImage));
};

type Seen = { url: string; init: RequestInit };
function stub(respond: (n: number, url: string) => Response | Promise<Response>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    seen.push({ url: String(u), init: init ?? {} });
    return respond(seen.length, String(u));
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* ══════════════════════════ catalog ══════════════════════════ */

test("catalog: studio.video = Omni (default) + Kling 3.0 + Kling 3.0 Pro + effects; client view has no routes", () => {
  const p = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!;
  // P4 adds the fal models between Kling 3.0 and the effects (their own checks: tests/studio-video-fal.test.mts).
  assert.deepEqual(p.allowed, [
    "google/omni-video",
    "kling/kling-3",
    "kling/kling-3-pro",
    "alibaba/wan-3",
    "bytedance/seedance-2.5",
    "bytedance/seedance-2-mini",
    "minimax/h3",
    "minimax/h3-max-turbo",
    "openai/sora-2",
    "openai/sora-2-pro",
    // P9: HeyGen avatars after Sora, before the effects (their own checks: tests/studio-video-heygen.test.mts).
    "heygen/avatar",
    "kling/effects",
  ]);
  assert.equal(p.default, "google/omni-video");
  assert.equal(p.userCanChoose, true);
  for (const id of p.allowed) assert.equal(entry(id).kind, "video");
  const view = MEDIA_CATALOG.clientView().filter((e) => p.allowed.includes(e.id));
  for (const e of view) assert.ok(!("routes" in e), `${e.id}: no routes in the client view`);
  // The nine effects, every one a single-image scene id that both pass-through lists document (P3-SPEC).
  assert.deepEqual(
    KLING_EFFECTS.map((x) => x.id),
    ["happy_birthday", "surprise_bouquet", "glamour_photo_shoot", "box_of_joy", "zombie_transform", "pure_white_wings", "bullet_time_360", "throne_of_king", "snowglobe"],
  );
  assert.ok(entry("kling/effects").capabilities.includes("effect"));
  assert.deepEqual(entry("kling/kling-3").routes, [{ provider: "kling", upstreamModel: "kling-v3", adapter: "kling-v3-std" }]);
  assert.deepEqual(entry("kling/kling-3-pro").routes, [{ provider: "kling", upstreamModel: "kling-v3", adapter: "kling-v3-pro" }]);
});

/* ══════════════════════════ builders ══════════════════════════ */

test("Kling 3.0 golden: text2video (std / pro, sound, aspect) and image2video (no aspect, raw base64)", () => {
  const t2v = requestOf("kling/kling-3", { prompt: "Registon at dawn", seconds: 7, aspect: "1:1", sound: true });
  assert.deepEqual(t2v, {
    url: "https://api-singapore.klingai.com/v1/videos/text2video",
    headers: { "Content-Type": "application/json" },
    body: { model_name: "kling-v3", prompt: "Registon at dawn", duration: "7", mode: "std", sound: "on", aspect_ratio: "1:1" },
  });
  const pro = requestOf("kling/kling-3-pro", { prompt: "Registon at dawn", seconds: 15 });
  assert.deepEqual(pro.body, { model_name: "kling-v3", prompt: "Registon at dawn", duration: "15", mode: "pro", sound: "off", aspect_ratio: "16:9" });
  const i2v = requestOf("kling/kling-3-pro", { prompt: "Animate it", seconds: 5, aspect: "9:16", imageAssetId: ASSET }, true);
  assert.equal(i2v.url, "https://api-singapore.klingai.com/v1/videos/image2video");
  assert.deepEqual(i2v.body, { model_name: "kling-v3", prompt: "Animate it", duration: "5", mode: "pro", sound: "off", image: IMG.base64 });
  // The old «Video» tool's request is untouched.
  assert.equal(KLING_MODEL, "kling-v2-master");
  assert.deepEqual(buildKlingRequest({ prompt: "abcde", seconds: 5, aspect: "16:9" }).body, { model_name: "kling-v2-master", prompt: "abcde", duration: "5", mode: "std", aspect_ratio: "16:9" });
});

test("effects golden: POST /v1/videos/effects { effect_scene, input: { image, duration: '5' } }; no photo = no request", () => {
  const r = requestOf("kling/effects", { effect: "zombie_transform", imageAssetId: ASSET }, true);
  assert.deepEqual(r, {
    url: "https://api-singapore.klingai.com/v1/videos/effects",
    headers: { "Content-Type": "application/json" },
    body: { effect_scene: "zombie_transform", input: { image: IMG.base64, duration: "5" } },
  });
  assert.throws(() => requestOf("kling/effects", { effect: "zombie_transform" }), MediaError);
});

test("probe: every param of every studio.video model changes the request or the price, as its `affects` says", () => {
  const base: Record<string, Record<string, unknown>> = {
    "google/omni-video": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    "kling/kling-3": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9", sound: false },
    "kling/kling-3-pro": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9", sound: false },
    "kling/effects": { effect: "happy_birthday", imageAssetId: ASSET },
    // P4 (fal): defaults are 720p / 768p and sound on, so the probe values below differ from them.
    "alibaba/wan-3": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    "bytedance/seedance-2.5": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    "bytedance/seedance-2-mini": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    "minimax/h3": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    "minimax/h3-max-turbo": { prompt: "Registon at dawn", seconds: 5, aspect: "16:9" },
    // P9 Sora (fal): 4 s and the top tier are the defaults; the probe goes to 12 s and down to 720p.
    "openai/sora-2": { prompt: "Registon at dawn", seconds: 4, aspect: "16:9" },
    "openai/sora-2-pro": { prompt: "Registon at dawn", seconds: 4, aspect: "16:9", resolution: "1080p" },
    // P9 HeyGen: a script at the defaults; the probe swaps each enum, adds an own speech, and raises the length.
    "heygen/avatar": { prompt: "Assalomu alaykum, do'stlar!", seconds: 3 },
  };
  /** Per-model probe values where the shared `alt` does not fit (HeyGen's own enums and the own-speech id). */
  const altOf: Record<string, Record<string, unknown>> = {
    "heygen/avatar": { avatar: "Tyler-incasualsuit-20220721", voice: "male", language: "ru", engine: "avatar_iii", audioId: "0f0e0d0c-0b0a-4908-8706-050403020100" },
  };
  const alt: Record<string, unknown> = { prompt: "A different prompt", seconds: undefined, aspect: "9:16", sound: true, effect: "snowglobe", resolution: "480p" };
  const soundOff = new Set(["alibaba/wan-3", "bytedance/seedance-2.5", "bytedance/seedance-2-mini"]);
  for (const id of MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed) {
    const e = entry(id);
    const b = base[id]!;
    const needsImage = e.capabilities.includes("effect");
    for (const p of e.params) {
      let next: unknown = altOf[id]?.[p.name] ?? alt[p.name];
      if (p.name === "seconds" && p.type === "int") next = p.max;
      // The fal models default to sound ON (same price): the probe flips it off.
      if (p.name === "sound" && soundOff.has(id)) next = false;
      if (p.name === "resolution" && id === "openai/sora-2-pro") next = "720p";
      if (p.type === "image") {
        // The start image: with vs without (the effect's photo is required, so it is probed by its presence in the build).
        if (needsImage) continue;
        if (p.name === "endImageAssetId") {
          // P4 end frame: start alone vs start + end (an end frame without a start is refused by the preflight).
          const e2 = entry(id);
          const ad = adapters().all[e2.routes[0]!.adapter]!;
          const withStart = { upstreamModel: e2.routes[0]!.upstreamModel, params: normalize(e2.params, { ...b, imageAssetId: ASSET }), idempotencyKey: "g:video:0" };
          const startOnly = ad.buildRequest!({ ...withStart, assets: { imageAssetId: [IMG] } });
          const both = ad.buildRequest!({ ...withStart, params: normalize(e2.params, { ...b, imageAssetId: ASSET, endImageAssetId: ASSET }), assets: { imageAssetId: [IMG], endImageAssetId: [{ mime: "image/jpeg", base64: "ZW5kLWZyYW1l" }] } });
          assert.notDeepEqual(both, startOnly, `${id}.${p.name} changes the request`);
          continue;
        }
        const without = requestOf(id, b);
        const withImg = requestOf(id, { ...b, imageAssetId: ASSET }, true);
        assert.notDeepEqual(withImg, without, `${id}.${p.name} changes the request`);
        continue;
      }
      const v2 = { ...b, [p.name]: next };
      assert.notDeepEqual(normalize(e.params, v2)[p.name], normalize(e.params, b)[p.name], `${id}.${p.name}: the probe value is accepted`);
      const reqChanged = JSON.stringify(requestOf(id, v2, needsImage)) !== JSON.stringify(requestOf(id, b, needsImage));
      const priceChanged = studioVideoPrice({ modelId: id, ...v2 }, PRICING) !== studioVideoPrice({ modelId: id, ...b }, PRICING);
      if (p.affects === "request" || p.affects === "both") assert.ok(reqChanged, `${id}.${p.name} must change the request`);
      if (p.affects === "price" || p.affects === "both") assert.ok(priceChanged, `${id}.${p.name} must change the price`);
    }
  }
});

/* ══════════════════════════ auth + errors ══════════════════════════ */

test("auth: HS256 JWT over the secret half, fresh per call; the key is in no body", async () => {
  const s = stub(() => jsonRes({ code: 0, data: { task_id: "T1" } }));
  const { all } = adapters();
  const e = entry("kling/kling-3");
  const r = await all["kling-v3-std"]!.submit(input(e, { prompt: "Registon at dawn", seconds: 5 }), { fetchImpl: s.fetchImpl });
  assert.deepEqual(r, { opId: "text2video:T1" });
  const auth = new Headers(s.seen[0]!.init.headers).get("authorization")!;
  const [head, body, sig] = auth.replace(/^Bearer /, "").split(".");
  assert.equal(sig, createHmac("sha256", "SKstudiosecretvalue").update(`${head}.${body}`).digest("base64url"));
  assert.equal(JSON.parse(Buffer.from(body!, "base64url").toString()).iss, "AKstudioaccess");
  assert.ok(!String(s.seen[0]!.init.body).includes("SKstudio"), "no secret in the body");
  assert.equal(all["kling-v3-std"]!.configured(), true);
  assert.equal(studioVideoAdapters({ klingKeyFn: () => "no-colon" })["kling-effects"]!.configured(), false);
});

test("error mapping: 4xx refused (not accepted), 429/5xx retryable, network = accepted, 1301 safety; effect poll path", async () => {
  const { all } = adapters();
  const e = entry("kling/effects");
  const inp = input(e, { effect: "happy_birthday", imageAssetId: ASSET }, true);
  const fail = async (res: () => Response | Promise<Response>) => {
    const s = stub(res);
    return all["kling-effects"]!.submit(inp, { fetchImpl: s.fetchImpl }).then(
      () => assert.fail("should throw"),
      (err: unknown) => err as MediaError,
    );
  };
  const bad = await fail(() => jsonRes({ code: 1201, message: "invalid effect_scene" }, 400));
  assert.ok(bad instanceof MediaError);
  assert.equal(bad.accepted, false);
  assert.equal(bad.retryable, false);
  const busy = await fail(() => jsonRes({ code: 1302, message: "too many" }, 429));
  assert.equal(busy.retryable, true);
  assert.equal(busy.accepted, false);
  const down = await fail(() => {
    throw new TypeError("socket hang up");
  });
  assert.equal(down.accepted, true, "a network drop may have started a paid job: never resubmitted elsewhere");
  const safety = await fail(() => jsonRes({ code: 1301, message: "risk" }, 400));
  assert.equal(safety.safety, true);
  for (const err of [bad, busy, down, safety]) assert.ok(!err.message.includes("SKstudio"), "no secret in a message");

  // Submit → op id with the effects kind; poll asks the effects path; done → url output → MP4 download.
  const s = stub((n, url) => {
    if (n === 1) return jsonRes({ code: 0, data: { task_id: "E9" } });
    if (url.endsWith("/v1/videos/effects/E9")) return jsonRes({ code: 0, data: { task_status: "succeed", task_result: { videos: [{ url: "https://cdn.example.com/e9.mp4" }] } } });
    return new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-type": "video/mp4" } });
  });
  const { opId } = (await all["kling-effects"]!.submit(inp, { fetchImpl: s.fetchImpl })) as { opId: string };
  assert.equal(opId, "effects:E9");
  const polled = await all["kling-effects"]!.poll!(opId, { fetchImpl: s.fetchImpl });
  assert.equal(s.seen[1]!.url, "https://api-singapore.klingai.com/v1/videos/effects/E9");
  assert.equal(polled.state, "done");
  const bytes = await all["kling-effects"]!.fetchOutput((polled as { outputs: import("../lib/studio-core/index.ts").MediaOutput[] }).outputs[0]!, { fetchImpl: s.fetchImpl });
  assert.ok(bytes.byteLength > 0);
  const refused = stub(() => jsonRes({ code: 0, data: { task_status: "failed", task_status_msg: "content policy violation" } }));
  const r = await all["kling-effects"]!.poll!("effects:E10", { fetchImpl: refused.fetchImpl });
  assert.deepEqual(r, { state: "failed", message: VIDEO_SAFETY_MESSAGE, safety: true });
  await assert.rejects(all["kling-effects"]!.poll!("bogus:1", { fetchImpl: refused.fetchImpl }), MediaError);
});

/* ══════════════════════════ prices ══════════════════════════ */

test("price goldens at ×2 and 12 700 so'm/$ (rounded UP to 100): seconds × tier × sound, Omni, per effect", () => {
  const p = (values: Record<string, unknown>) => studioVideoPrice(values, PRICING);
  // Kling 3.0 (720p): $0.084/s silent, $0.126/s with sound.
  assert.equal(p({ modelId: "kling/kling-3", seconds: 5 }), 10_700);
  assert.equal(p({ modelId: "kling/kling-3", seconds: 5, sound: true }), 16_100);
  assert.equal(p({ modelId: "kling/kling-3", seconds: 10 }), 21_400);
  assert.equal(p({ modelId: "kling/kling-3", seconds: 15, sound: true }), 48_100);
  assert.equal(p({ modelId: "kling/kling-3", seconds: 3 }), 6_500);
  // Kling 3.0 Pro (1080p): $0.112/s silent, $0.168/s with sound.
  assert.equal(p({ modelId: "kling/kling-3-pro", seconds: 5 }), 14_300);
  assert.equal(p({ modelId: "kling/kling-3-pro", seconds: 5, sound: true }), 21_400);
  assert.equal(p({ modelId: "kling/kling-3-pro", seconds: 15, sound: true }), 64_100);
  // Gemini Omni: $0.10/s (5 / 8 s) — the «Video» tool's ladder does not apply in the Studio.
  assert.equal(p({ modelId: "google/omni-video", seconds: 5 }), 12_700);
  assert.equal(p({ modelId: "google/omni-video", seconds: 8 }), 20_400);
  assert.equal(p({}), 12_700, "blank model = the purpose default (Omni)");
  // An effect: one clip, the same price whatever the scene.
  for (const fx of KLING_EFFECTS) assert.equal(p({ modelId: "kling/effects", effect: fx.id }), 21_400);
  assert.equal(up100(KLING_EFFECT_USD * RATE * 2), 21_400);
  assert.equal(up100(KLING_V3_USD_PER_SECOND.pro.sound * 5 * RATE * 2), 21_400);
  // Markup override of a model wins; the global markup moves the rest.
  assert.equal(studioVideoPrice({ modelId: "kling/kling-3", seconds: 5 }, { ...PRICING, overrides: { "kling/kling-3": { markup: 3 } } }), up100(0.084 * 5 * RATE * 3));
  assert.equal(studioVideoPrice({ modelId: "kling/kling-3-pro", seconds: 5 }, { ...PRICING, markup: 1.5, overrides: { "kling/kling-3": { markup: 3 } } }), up100(0.112 * 5 * RATE * 1.5));
  assert.equal(p({ modelId: "unknown/model" }), null);
});

test("client preview == server price (basePriceFor) for every model × length × sound × override × tool %", () => {
  const tool = TOOL_BY_ID["studio-video"];
  const view = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));
  const pricings = [PRICING, { ...PRICING, markup: 2.5 }, { ...PRICING, overrides: { "kling/kling-3-pro": { markup: 4 }, "kling/effects": { markup: 1.2 } } }];
  for (const pricing of pricings) {
    for (const id of MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed) {
      const e = view.get(id)!;
      const variants: Record<string, unknown>[] = id === "kling/effects" ? KLING_EFFECTS.map((x) => ({ effect: x.id })) : [3, 5, 8, 10, 15].flatMap((s) => [{ seconds: s }, { seconds: s, sound: true }]);
      for (const v of variants) {
        const values = { modelId: id, ...v };
        const server = basePriceFor(tool, values as never, pricing);
        assert.equal(studioVideoClientPrice(e, values, pricing, undefined), server, `${id} ${JSON.stringify(v)}`);
        const adj = { percent: 150, roundTo: 500 as const };
        assert.equal(studioVideoClientPrice(e, values, pricing, adj), applyPriceAdjust(server, adj), "the tool % on top, as priceFor");
      }
    }
  }
  assert.equal(videoCardPrice(view.get("kling/kling-3")!, { seconds: 5 }, PRICING), `~${groupDigits(10_700)} so'm / 5 s`);
  assert.equal(videoCardPrice(view.get("kling/effects")!, {}, PRICING), `~${groupDigits(21_400)} so'm`);
});

/* ══════════════════════════ preflight ══════════════════════════ */

test("preflight: unknown model, effect without its photo, values the model does not offer → refused before charge", () => {
  const tool = TOOL_BY_ID["studio-video"];
  assert.equal(preflightError(tool, { modelId: "openai/gpt-image", prompt: "Registon at dawn" }), "Noma'lum video modeli — boshqa modelni tanlang.");
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "happy_birthday" }), "Effekt uchun surat yuklang.");
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "happy_birthday", imageAssetId: ASSET }), null);
  assert.ok(studioVideoError({ modelId: "kling/effects", effect: "trampoline", imageAssetId: ASSET }), "an effect scene we do not sell");
  assert.ok(studioVideoError({ modelId: "kling/kling-3", prompt: "Registon at dawn", seconds: 20 }), "20 s is not offered");
  assert.ok(studioVideoError({ modelId: "google/omni-video", prompt: "Registon at dawn", seconds: 6 }), "Omni sells 5 / 8 only");
  assert.ok(studioVideoError({ modelId: "google/omni-video", prompt: "Registon at dawn", aspect: "1:1" }), "Omni has no 1:1");
  assert.ok(studioVideoError({ modelId: "kling/kling-3", prompt: "abc" }), "too short a prompt");
  assert.equal(studioVideoError({ modelId: "kling/kling-3", prompt: "Registon at dawn", seconds: 12, aspect: "1:1", sound: true }), null);
  assert.equal(topicOf({ modelId: "kling/effects", effect: "snowglobe" }, tool), "Effekt: Qorli shar");
  assert.equal(topicOf({ modelId: "kling/kling-3", prompt: "  Registon   at dawn " }, tool), "Registon at dawn");
});
