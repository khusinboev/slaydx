import test from "node:test";
import assert from "node:assert/strict";
import { normalize, MediaError, type AdapterAsset, type AdapterInput, type CatalogEntry, type MediaOutput } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import { FAL_VIDEO_ENTRIES, FAL_VIDEO_MAX_SECONDS, FAL_VIDEO_USD_PER_SECOND, KLING_DUAL_EFFECTS, KLING_EFFECT_USD, STUDIO_VIDEO_PURPOSE } from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { FAL_VIDEO_ENDPOINTS, FAL_VIDEO_START_TIMEOUT_SEC, falVideoAdapter, parseFalVideoOp } from "../lib/media/adapters/fal.ts";
import { studioVideoError, studioVideoImageParams, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { VIDEO_MAX_BYTES } from "../lib/generation/video/types.ts";
import { TOOL_BY_ID, basePriceFor, topicOf } from "../lib/tools.ts";
import { studioVideoClientPrice, videoCardPrice } from "../components/studio/video/video-price.ts";
import { applyPriceAdjust } from "../lib/price-adjust.ts";
import { groupDigits } from "../lib/format.ts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO P4 — more video in the «Video» tab (docs/studio/P4-SPEC.md): Wan 3.0, Seedance 2.5, Seedance 2.0 Mini, MiniMax
 * H3, MiniMax H3 Max Turbo through the fal QUEUE (async: submit → op id → the shared video poll loop), the Kling 3.0
 * end frame and the two-photo «Quchoqlash» effect. Stubbed `fetch`: no network, no paid call.
 *
 *   catalog   five fal entries on route `fal-video`, prices = the fal pages' per-second tables, ≤ 10 s, client view has no
 *             routes, purpose order;
 *   golden    request body per fal model × text / image / image + end frame; Kling 3.0 `image_tail`; `hug` dual body;
 *   probe     every ParamSchema param of every fal model changes the request or the price, as its `affects` says (the end
 *             frame: start alone vs start + end);
 *   adapter   submit (queue host only, `Key` header, start timeout, `redirect: manual`, op id `fal:<endpoint>:<id>`);
 *             submit errors 401 / 402 / 403 / 422 / 422 content policy / 429 / 5xx / 3xx / no request id / network
 *             (= accepted); poll IN_QUEUE / IN_PROGRESS → running, COMPLETED → result → URL output, COMPLETED with
 *             `error` → failed (policy → safety), result 422 policy → safety, 500 / 504 → failed, 503 → retryable throw,
 *             status 404 → failed, foreign / malformed op id → refused before any call; download WITHOUT the key, size cap,
 *             not an MP4 → error; the key never in a message;
 *   prices    goldens at ×2 and 12 700 so'm/$ (seconds × resolution × model, rounded UP to 100); client == server;
 *   preflight end frame without a start, «Quchoqlash» without its second photo, a second photo on a one-photo scene.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. Wan builder sends `aspect_ratio` from the form in image → video        -> «golden: fal bodies»;
 *   2. Seedance `codec: "H264"` dropped                                     -> «golden: fal bodies»;
 *   3. MiniMax resolution not upper-cased                                   -> «golden: fal bodies», «probe»;
 *   4. (equivalent, not observable) `falVideoFrames` / `endFrame` passing an end frame without a start: every builder
 *      reads the end frame only inside its start-frame branch, so the request is unchanged — two guards, one behaviour;
 *   5. cost table Seedance 2.5 720p = the 480p price                         -> «price goldens», «probe», «catalog»;
 *   6. submit maps a 4xx as accepted                                        -> «adapter: submit errors»;
 *   7. submit network error not accepted                                    -> «adapter: submit errors»;
 *   8. poll ignores COMPLETED `error` (fetches the result anyway)           -> «adapter: poll»;
 *   9. `parseFalVideoOp` accepts any endpoint                               -> «adapter: op ids» (the key would go to a stored path);
 *  10. download sends the `Authorization` header                            -> «adapter: download»;
 *  11. `buildKlingV3Request` drops `image_tail`                             -> «golden: Kling end frame + hug»;
 *  12. dual effect sends one image                                         -> «golden: Kling end frame + hug»;
 *  13. `studioVideoError` lets «Quchoqlash» through with one photo          -> «preflight»;
 *  14. status 404 not mapped to failed                                     -> «adapter: poll»;
 *  15. result 422 content policy not safety                                -> «adapter: poll»;
 *  16. `X-Fal-Request-Start-Timeout` dropped                               -> «adapter: submit»;
 *  17. download not capped at VIDEO_MAX_BYTES                              -> «adapter: download»;
 *  18. submit without `redirect: "manual"`                                 -> «adapter: submit».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

const FKEY = "fal-test-key-0123:secretsecretvalue";
const KKEY = "AKstudioaccess:SKstudiosecretvalue";
const START: AdapterAsset = { mime: "image/png", base64: "c3RhcnQtZnJhbWU=" };
const END: AdapterAsset = { mime: "image/jpeg", base64: "ZW5kLWZyYW1l" };
const ASSET = "0123456789abcdef01234567";
const ASSET2 = "abcdef0123456789abcdef01";
const RATE = 12_700;
const PRICING = { soumPerUsd: RATE, markup: 2, step: 100, overrides: {}, costUsd: {} };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const FAL_IDS = ["alibaba/wan-3", "bytedance/seedance-2.5", "bytedance/seedance-2-mini", "minimax/h3", "minimax/h3-max-turbo"];
const REQ = "4f1c2b3a-9d8e-4c7b-a6f5-0123456789ab";

const entry = (id: string): CatalogEntry => MEDIA_CATALOG.byId(id)!;
const all = () => studioVideoAdapters({ klingKeyFn: () => KKEY, falKeyFn: () => FKEY });
function input(id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}): AdapterInput {
  const e = entry(id);
  return { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(Object.keys(assets).length ? { assets } : {}), idempotencyKey: "g:video:0" };
}
const req = (id: string, values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}) => all()[entry(id).routes[0]!.adapter]!.buildRequest!(input(id, values, assets));
const T = { prompt: "Registon at dawn", seconds: 6 };

type Seen = { url: string; init: RequestInit };
function stub(respond: (n: number, url: string, init: RequestInit) => Response | Promise<Response>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    seen.push({ url: String(u), init: init ?? {} });
    return respond(seen.length, String(u), init ?? {});
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const authOf = (s: Seen) => new Headers(s.init.headers).get("authorization");

/* ══════════════════════════ catalog ══════════════════════════ */

test("catalog: five fal video entries on the fal-video route, per-second tables, ≤ 10 s, between Kling 3.0 and the effects", () => {
  assert.deepEqual(FAL_VIDEO_ENTRIES.map((e) => e.id), FAL_IDS);
  const allowed = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed;
  assert.deepEqual(allowed.slice(3, 8), FAL_IDS);
  assert.equal(allowed.at(-1), "kling/effects", "the effects stay last");
  const upstream: Record<string, string> = {
    "alibaba/wan-3": "alibaba/wan-3.0",
    "bytedance/seedance-2.5": "bytedance/seedance-2.5/us",
    "bytedance/seedance-2-mini": "bytedance/seedance-2.0/mini",
    "minimax/h3": "minimax/h3",
    "minimax/h3-max-turbo": "minimax/h3-max-turbo",
  };
  for (const id of FAL_IDS) {
    const e = entry(id);
    assert.equal(e.kind, "video");
    assert.deepEqual(e.capabilities, ["t2v", "i2v"]);
    assert.deepEqual(e.routes, [{ provider: "fal", upstreamModel: upstream[id], adapter: "fal-video" }]);
    assert.equal(e.cost.per, "second");
    const table = FAL_VIDEO_USD_PER_SECOND[id as keyof typeof FAL_VIDEO_USD_PER_SECOND];
    assert.deepEqual(e.cost.per === "second" ? e.cost.by : null, { param: "resolution", table });
    const res = e.params.find((p) => p.name === "resolution")!;
    assert.deepEqual(res.type === "enum" ? res.options.map((o) => o.value) : [], Object.keys(table), "the form sells exactly the priced tiers");
    const secs = e.params.find((p) => p.name === "seconds")!;
    assert.equal(secs.type === "int" ? secs.max : 0, FAL_VIDEO_MAX_SECONDS);
    assert.deepEqual(e.output.mimes, ["video/mp4"]);
    assert.ok(e.params.some((p) => p.name === "endImageAssetId" && p.type === "image"));
  }
  // The published per-second numbers (fal pages, 2026-11-02).
  assert.deepEqual(FAL_VIDEO_USD_PER_SECOND, {
    "alibaba/wan-3": { "480p": 0.05, "720p": 0.1, "1080p": 0.2 },
    "bytedance/seedance-2.5": { "480p": 0.2205, "720p": 0.473 },
    "bytedance/seedance-2-mini": { "480p": 0.0721, "720p": 0.1547 },
    "minimax/h3": { "480p": 0.05, "768p": 0.06 },
    "minimax/h3-max-turbo": { "480p": 0.025, "768p": 0.04, "1080p": 0.08 },
  });
  // Sound: a switch only where the model makes sound (Wan, Seedance); MiniMax has none.
  assert.ok(!entry("minimax/h3").params.some((p) => p.name === "sound"));
  assert.ok(entry("alibaba/wan-3").params.some((p) => p.name === "sound" && p.type === "bool" && p.default === true && p.affects === "request"));
  for (const e of MEDIA_CATALOG.clientView().filter((x) => FAL_IDS.includes(x.id))) assert.ok(!("routes" in e));
  // Kling 3.0 tiers take an end frame; the effects entry a second photo; «Quchoqlash» is the two-photo scene.
  assert.ok(entry("kling/kling-3").params.some((p) => p.name === "endImageAssetId"));
  assert.ok(entry("kling/effects").params.some((p) => p.name === "secondImageAssetId"));
  assert.deepEqual(KLING_DUAL_EFFECTS, [{ id: "hug", label: "Quchoqlash" }]);
  const fx = entry("kling/effects").params.find((p) => p.name === "effect")!;
  assert.ok(fx.type === "enum" && fx.options.some((o) => o.value === "hug" && o.label === "Quchoqlash"));
});

/* ══════════════════════════ goldens ══════════════════════════ */

test("golden: fal bodies per model × text / image / image + end frame (queue URL, no key in the request)", () => {
  const Q = "https://queue.fal.run";
  // Wan 3.0
  assert.deepEqual(req("alibaba/wan-3", { ...T, resolution: "1080p", aspect: "9:16", sound: false }), {
    url: `${Q}/alibaba/wan-3.0/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: "Registon at dawn", resolution: "1080p", aspect_ratio: "9:16", duration: 6, audio: false, enable_prompt_expansion: true, enable_safety_checker: true },
  });
  const wanI2v = req("alibaba/wan-3", { ...T, aspect: "9:16", imageAssetId: ASSET, endImageAssetId: ASSET2 }, { imageAssetId: [START], endImageAssetId: [END] });
  assert.equal(wanI2v.url, `${Q}/alibaba/wan-3.0/image-to-video`);
  assert.deepEqual(wanI2v.body, {
    prompt: "Registon at dawn",
    start_image_url: `data:image/png;base64,${START.base64}`,
    end_image_url: `data:image/jpeg;base64,${END.base64}`,
    resolution: "720p",
    aspect_ratio: "adaptive",
    duration: 6,
    audio: true,
    enable_prompt_expansion: true,
    enable_safety_checker: true,
  });
  // Seedance 2.5 (bitrate) and 2.0 Mini (no bitrate field); duration is a string, H.264 explicit.
  assert.deepEqual(req("bytedance/seedance-2.5", { ...T, resolution: "480p", aspect: "1:1" }).body, {
    prompt: "Registon at dawn",
    resolution: "480p",
    duration: "6",
    aspect_ratio: "1:1",
    generate_audio: true,
    bitrate_mode: "standard",
    codec: "H264",
  });
  const sdI2v = req("bytedance/seedance-2-mini", { ...T, sound: false, imageAssetId: ASSET }, { imageAssetId: [START] });
  assert.equal(sdI2v.url, `${Q}/bytedance/seedance-2.0/mini/image-to-video`);
  assert.deepEqual(sdI2v.body, { prompt: "Registon at dawn", image_url: `data:image/png;base64,${START.base64}`, resolution: "720p", duration: "6", aspect_ratio: "auto", generate_audio: false, codec: "H264" });
  assert.equal(req("bytedance/seedance-2.5", T, { imageAssetId: [START], endImageAssetId: [END] }).url, `${Q}/bytedance/seedance-2.5/us/image-to-video`);
  assert.equal((req("bytedance/seedance-2.5", T, { imageAssetId: [START], endImageAssetId: [END] }).body as Record<string, unknown>).end_image_url, `data:image/jpeg;base64,${END.base64}`);
  // MiniMax H3 / H3 Max Turbo: upper-case tiers, no aspect in image → video.
  assert.deepEqual(req("minimax/h3", { ...T, resolution: "480p" }), {
    url: `${Q}/minimax/h3/text-to-video`,
    headers: { "Content-Type": "application/json" },
    body: { prompt: "Registon at dawn", aspect_ratio: "16:9", duration: 6, resolution: "480P", prompt_expansion_mode: "balanced", enable_safety_checker: true },
  });
  const mmI2v = req("minimax/h3-max-turbo", { ...T, resolution: "1080p" }, { imageAssetId: [START], endImageAssetId: [END] });
  assert.equal(mmI2v.url, `${Q}/minimax/h3-max-turbo/image-to-video`);
  assert.deepEqual(mmI2v.body, {
    prompt: "Registon at dawn",
    image_url: `data:image/png;base64,${START.base64}`,
    end_image_url: `data:image/jpeg;base64,${END.base64}`,
    duration: 6,
    resolution: "1080P",
    prompt_expansion_mode: "balanced",
    enable_safety_checker: true,
  });
  // An end frame without a start never goes out (text → video, no end field).
  const endOnly = req("alibaba/wan-3", T, { endImageAssetId: [END] });
  assert.equal(endOnly.url, `${Q}/alibaba/wan-3.0/text-to-video`);
  assert.ok(!JSON.stringify(endOnly.body).includes(END.base64), "MUTATSIYA: end frame without a start");
  for (const id of FAL_IDS) assert.ok(!JSON.stringify(req(id, T)).includes("fal-test-key"), `${id}: no key in the built request`);
  assert.equal(FAL_VIDEO_ENDPOINTS.size, 10);
});

test("golden: Kling end frame (`image_tail`) + «Quchoqlash» dual-character body; missing second photo = no request", () => {
  const k = req("kling/kling-3-pro", { ...T, imageAssetId: ASSET, endImageAssetId: ASSET2 }, { imageAssetId: [START], endImageAssetId: [END] });
  assert.deepEqual(k, {
    url: "https://api-singapore.klingai.com/v1/videos/image2video",
    headers: { "Content-Type": "application/json" },
    body: { model_name: "kling-v3", prompt: "Registon at dawn", duration: "6", mode: "pro", sound: "off", image: START.base64, image_tail: END.base64 },
  });
  // Without a start the tail is never sent (text2video, as before).
  const t2v = req("kling/kling-3", T, { endImageAssetId: [END] });
  assert.equal(t2v.url, "https://api-singapore.klingai.com/v1/videos/text2video");
  assert.ok(!("image_tail" in (t2v.body as object)));
  const hug = req("kling/effects", { effect: "hug", imageAssetId: ASSET, secondImageAssetId: ASSET2 }, { imageAssetId: [START], secondImageAssetId: [END] });
  assert.deepEqual(hug, {
    url: "https://api-singapore.klingai.com/v1/videos/effects",
    headers: { "Content-Type": "application/json" },
    body: { effect_scene: "hug", input: { model_name: "kling-v1-6", mode: "std", images: [START.base64, END.base64], duration: "5" } },
  });
  assert.throws(() => req("kling/effects", { effect: "hug", imageAssetId: ASSET }, { imageAssetId: [START] }), MediaError, "hug needs both photos");
  // A one-photo scene ignores a stray second photo (the preflight refuses it before charging anyway).
  assert.deepEqual(req("kling/effects", { effect: "snowglobe", imageAssetId: ASSET }, { imageAssetId: [START], secondImageAssetId: [END] }).body, { effect_scene: "snowglobe", input: { image: START.base64, duration: "5" } });
});

/* ══════════════════════════ probe ══════════════════════════ */

test("probe: every param of every fal video model changes the request or the price, as its `affects` says", () => {
  const alt: Record<string, unknown> = { prompt: "A different prompt", seconds: FAL_VIDEO_MAX_SECONDS, resolution: "480p", aspect: "9:16", sound: false };
  for (const id of FAL_IDS) {
    const e = entry(id);
    const b = { ...T };
    for (const p of e.params) {
      if (p.type === "image") {
        const without = p.name === "imageAssetId" ? req(id, b) : req(id, { ...b, imageAssetId: ASSET }, { imageAssetId: [START] });
        const withIt = p.name === "imageAssetId" ? req(id, { ...b, imageAssetId: ASSET }, { imageAssetId: [START] }) : req(id, { ...b, imageAssetId: ASSET, endImageAssetId: ASSET2 }, { imageAssetId: [START], endImageAssetId: [END] });
        assert.notDeepEqual(withIt, without, `${id}.${p.name} changes the request`);
        continue;
      }
      const v2 = { ...b, [p.name]: alt[p.name] };
      assert.notDeepEqual(normalize(e.params, v2)[p.name], normalize(e.params, b)[p.name], `${id}.${p.name}: the probe value is accepted and differs`);
      const reqChanged = JSON.stringify(req(id, v2)) !== JSON.stringify(req(id, b));
      const priceChanged = studioVideoPrice({ modelId: id, ...v2 }, PRICING) !== studioVideoPrice({ modelId: id, ...b }, PRICING);
      if (p.affects === "request" || p.affects === "both") assert.ok(reqChanged, `${id}.${p.name} must change the request`);
      if (p.affects === "price" || p.affects === "both") assert.ok(priceChanged, `${id}.${p.name} must change the price`);
      if (p.affects === "request") assert.ok(!priceChanged, `${id}.${p.name} is declared price-neutral`);
    }
  }
});

/* ══════════════════════════ adapter ══════════════════════════ */

test("adapter: submit → op id; key only in the queue-host header; start timeout; no redirect followed", async () => {
  const s = stub(() => jsonRes({ request_id: REQ, status_url: "https://evil.example/status", response_url: "https://evil.example/r" }));
  const r = await all()["fal-video"]!.submit(input("alibaba/wan-3", T), { fetchImpl: s.fetchImpl });
  assert.deepEqual(r, { opId: `fal:alibaba/wan-3.0/text-to-video:${REQ}` });
  assert.equal(s.seen.length, 1, "submit is ONE call (no blocking poll inside)");
  const sent = s.seen[0]!;
  assert.equal(sent.url, "https://queue.fal.run/alibaba/wan-3.0/text-to-video");
  assert.equal(sent.init.method, "POST");
  assert.equal(sent.init.redirect, "manual");
  assert.equal(authOf(sent), `Key ${FKEY}`);
  assert.equal(new Headers(sent.init.headers).get("x-fal-request-start-timeout"), String(FAL_VIDEO_START_TIMEOUT_SEC));
  assert.ok(!String(sent.init.body).includes(FKEY));
  assert.equal(all()["fal-video"]!.configured(), true);
  assert.equal(studioVideoAdapters({ falKeyFn: () => null })["fal-video"]!.configured(), false);
  await assert.rejects(studioVideoAdapters({ falKeyFn: () => null })["fal-video"]!.submit(input("alibaba/wan-3", T)), (e: unknown) => e instanceof MediaError && !e.accepted, "no key: nothing sent, not accepted");
});

test("adapter: submit errors — 401/402/403/422 refused (not accepted), policy = safety, 429/5xx retryable, 3xx refused, network / no id = accepted; key scrubbed", async () => {
  const ad = all()["fal-video"]!;
  const fail = async (res: () => Response | Promise<Response>) => {
    const s = stub(res);
    return ad.submit(input("minimax/h3", T), { fetchImpl: s.fetchImpl }).then(
      () => assert.fail("should throw"),
      (err: unknown) => err as MediaError,
    );
  };
  for (const status of [401, 402, 403, 422]) {
    const e = await fail(() => jsonRes({ detail: `nope Key ${FKEY}` }, status));
    assert.ok(e instanceof MediaError);
    assert.deepEqual([e.status, e.accepted, e.retryable, e.safety], [status, false, false, false], `submit ${status}`);
    assert.ok(!e.message.includes("secretsecret"), "MUTATSIYA: scrub — the key never in a message");
  }
  const policy = await fail(() => jsonRes({ detail: [{ type: "content_policy_violation", msg: "flagged" }] }, 422));
  assert.deepEqual([policy.safety, policy.retryable, policy.accepted], [true, false, false]);
  for (const status of [429, 500, 503]) {
    const e = await fail(() => jsonRes({ detail: "busy" }, status));
    assert.deepEqual([e.retryable, e.accepted], [true, false], `submit ${status}`);
  }
  const redirect = await fail(() => new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
  assert.deepEqual([redirect.retryable, redirect.accepted], [false, false]);
  const down = await fail(() => {
    throw new TypeError("socket hang up");
  });
  assert.deepEqual([down.accepted, down.retryable], [true, true], "a network drop may have queued a paid clip: accepted");
  const noId = await fail(() => jsonRes({ status: "IN_QUEUE" }));
  assert.equal(noId.accepted, true);
});

test("adapter: poll — IN_QUEUE / IN_PROGRESS running; COMPLETED → result URL; COMPLETED error / policy / final result codes → failed; 503 retry", async () => {
  const ad = all()["fal-video"]!;
  const op = `fal:bytedance/seedance-2.5/us/image-to-video:${REQ}`;
  const STATUS = `https://queue.fal.run/bytedance/seedance-2.5/requests/${REQ}/status`;
  const RESULT = `https://queue.fal.run/bytedance/seedance-2.5/requests/${REQ}`;
  const once = async (status: () => Response, result?: () => Response) => {
    const s = stub((_n, url) => (url === STATUS ? status() : result ? result() : assert.fail(`unexpected ${url}`)));
    const r = await ad.poll!(op, { fetchImpl: s.fetchImpl });
    for (const x of s.seen) {
      assert.equal(new URL(x.url).hostname, "queue.fal.run", "the key goes to the queue host only");
      assert.equal(x.init.redirect, "manual");
      assert.equal(authOf(x), `Key ${FKEY}`);
    }
    return { r, seen: s.seen };
  };
  assert.deepEqual((await once(() => jsonRes({ status: "IN_QUEUE", request_id: REQ, queue_position: 3 }, 202))).r, { state: "running" });
  assert.deepEqual((await once(() => jsonRes({ status: "IN_PROGRESS", request_id: REQ }, 202))).r, { state: "running" });
  const done = await once(
    () => jsonRes({ status: "COMPLETED", request_id: REQ }),
    () => jsonRes({ video: { url: "https://v3b.fal.media/files/x/clip.mp4", content_type: "video/mp4" }, seed: 1 }),
  );
  assert.deepEqual(done.r, { state: "done", outputs: [{ kind: "url", url: "https://v3b.fal.media/files/x/clip.mp4", mime: "video/mp4" }] });
  assert.deepEqual(done.seen.map((x) => x.url), [STATUS, RESULT]);
  // A failed request is COMPLETED with `error` (queue docs): no result fetch, failed; policy → safety.
  const errored = await once(() => jsonRes({ status: "COMPLETED", request_id: REQ, error: "runner crashed", error_type: "runner_server_error" }));
  assert.deepEqual(errored.r, { state: "failed", message: "runner crashed", safety: false });
  assert.equal(errored.seen.length, 1, "MUTATSIYA: COMPLETED + error must not fetch the result");
  const flagged = await once(() => jsonRes({ status: "COMPLETED", request_id: REQ, error: "Output flagged", error_type: "content_policy_violation" }));
  assert.equal((flagged.r as { safety: boolean }).safety, true);
  const policy = await once(
    () => jsonRes({ status: "COMPLETED", request_id: REQ }),
    () => jsonRes({ detail: [{ type: "content_policy_violation", msg: "blocked" }] }, 422),
  );
  assert.equal(policy.r.state, "failed");
  assert.equal((policy.r as { safety: boolean }).safety, true);
  for (const code of [404, 499, 500, 504]) {
    const final = await once(() => jsonRes({ status: "COMPLETED", request_id: REQ }), () => jsonRes({ detail: "gone" }, code));
    assert.equal(final.r.state, "failed", `result ${code} is final`);
  }
  const missing = await once(() => jsonRes({ status: "NOT_FOUND" }, 404));
  assert.equal(missing.r.state, "failed", "status 404: the request does not exist");
  const noVideo = await once(() => jsonRes({ status: "COMPLETED", request_id: REQ }), () => jsonRes({ seed: 1 }));
  assert.equal(noVideo.r.state, "failed");
  // Transient: a throw the poll loop reschedules (retryable, accepted).
  for (const res of [() => jsonRes({ detail: "unavailable" }, 503), () => new Response("x", { status: 302, headers: { location: "https://evil.example" } })]) {
    const s = stub(() => res());
    const err = await ad.poll!(op, { fetchImpl: s.fetchImpl }).then(() => null, (e: unknown) => e as MediaError);
    assert.ok(err instanceof MediaError);
    assert.equal(err.accepted, true);
  }
  const s503 = stub(() => jsonRes({ detail: "unavailable" }, 503));
  assert.equal(((await ad.poll!(op, { fetchImpl: s503.fetchImpl }).catch((e: MediaError) => e)) as MediaError).retryable, true);
  const sResult503 = stub((_n, url) => (url === STATUS ? jsonRes({ status: "COMPLETED", request_id: REQ }) : jsonRes({ detail: "busy" }, 503)));
  assert.equal(((await ad.poll!(op, { fetchImpl: sResult503.fetchImpl }).catch((e: MediaError) => e)) as MediaError).retryable, true, "result 503: retry later");
  const net = stub(() => {
    throw new TypeError("ECONNRESET");
  });
  assert.equal(((await ad.poll!(op, { fetchImpl: net.fetchImpl }).catch((e: MediaError) => e)) as MediaError).retryable, true);
});

test("adapter: op ids — only `fal:<known endpoint>:<request id>` is polled; anything else is refused before any call", async () => {
  assert.deepEqual(parseFalVideoOp(`fal:minimax/h3/text-to-video:${REQ}`), { endpoint: "minimax/h3/text-to-video", requestId: REQ });
  for (const bad of [`fal:evil.example/x/y:${REQ}`, `fal:alibaba/wan-3.0/edit-video:${REQ}`, `fal:minimax/h3/text-to-video:../../x`, `text2video:${REQ}`, "fal:", `fal:minimax/h3/text-to-video:`]) {
    assert.equal(parseFalVideoOp(bad), null, bad);
    const s = stub(() => jsonRes({}));
    await assert.rejects(all()["fal-video"]!.poll!(bad, { fetchImpl: s.fetchImpl }), MediaError);
    assert.equal(s.seen.length, 0, "MUTATSIYA: no request for a foreign op id (the key would follow it)");
  }
});

test("adapter: download — WITHOUT the key, MP4 checked, size capped, private host refused", async () => {
  const ad = all()["fal-video"]!;
  const out: MediaOutput = { kind: "url", url: "https://v3b.fal.media/files/x/clip.mp4", mime: "video/mp4" };
  const ok = stub(() => new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-type": "video/mp4" } }));
  const bytes = await ad.fetchOutput(out, { fetchImpl: ok.fetchImpl });
  assert.ok(bytes.byteLength > 0);
  assert.equal(authOf(ok.seen[0]!), null, "MUTATSIYA: the key never goes to the CDN");
  const html = stub(() => new Response("<html>error</html>", { status: 200 }));
  await assert.rejects(ad.fetchOutput(out, { fetchImpl: html.fetchImpl }), (e: unknown) => e instanceof MediaError && /MP4/.test(e.message));
  const huge = stub(() => new Response(Buffer.from(fakeMp4(5)), { status: 200, headers: { "content-length": String(VIDEO_MAX_BYTES + 1) } }));
  await assert.rejects(ad.fetchOutput(out, { fetchImpl: huge.fetchImpl }), (e: unknown) => e instanceof MediaError && /katta/.test(e.message) && !e.retryable);
  setSafeFetchLookup(async () => ["10.0.0.5"]);
  try {
    const priv = stub(() => new Response(Buffer.from(fakeMp4(5))));
    await assert.rejects(ad.fetchOutput(out, { fetchImpl: priv.fetchImpl }), MediaError);
    assert.equal(priv.seen.length, 0, "a private address is never fetched");
  } finally {
    setSafeFetchLookup(async () => ["93.184.216.34"]);
  }
  const busy = stub(() => new Response("busy", { status: 503 }));
  assert.equal(((await ad.fetchOutput(out, { fetchImpl: busy.fetchImpl }).catch((e: MediaError) => e)) as MediaError).retryable, true);
});

test("adapter: one adapter instance per process key — falVideoAdapter reads the key at call time", async () => {
  let key: string | null = null;
  const ad = falVideoAdapter({ key: () => key });
  assert.equal(ad.configured(), false);
  key = FKEY;
  assert.equal(ad.configured(), true);
  key = null;
  await assert.rejects(ad.poll!(`fal:minimax/h3/text-to-video:${REQ}`, {}), (e: unknown) => e instanceof MediaError && e.retryable && e.accepted, "key removed after submit: wait, do not fail");
});

/* ══════════════════════════ prices ══════════════════════════ */

test("price goldens at ×2 and 12 700 so'm/$ (rounded UP to 100): seconds × resolution × model; hug = one effect", () => {
  const p = (modelId: string, v: Record<string, unknown>) => studioVideoPrice({ modelId, ...v }, PRICING);
  // Wan 3.0: $0.05 / 0.10 / 0.20 per second.
  assert.equal(p("alibaba/wan-3", { seconds: 5 }), 12_700, "default 720p");
  assert.equal(p("alibaba/wan-3", { seconds: 5, resolution: "480p" }), 6_400);
  assert.equal(p("alibaba/wan-3", { seconds: 10, resolution: "1080p" }), 50_800);
  assert.equal(p("alibaba/wan-3", { seconds: 2, resolution: "480p" }), 2_600);
  // Seedance 2.5: $0.2205 / 0.473.
  assert.equal(p("bytedance/seedance-2.5", { seconds: 5 }), 60_100);
  assert.equal(p("bytedance/seedance-2.5", { seconds: 5, resolution: "480p" }), 28_100);
  assert.equal(p("bytedance/seedance-2.5", { seconds: 10 }), 120_200);
  assert.equal(p("bytedance/seedance-2.5", { seconds: 4, resolution: "480p" }), 22_500);
  // Seedance 2.0 Mini: $0.0721 / 0.1547.
  assert.equal(p("bytedance/seedance-2-mini", { seconds: 5 }), 19_700);
  assert.equal(p("bytedance/seedance-2-mini", { seconds: 5, resolution: "480p" }), 9_200);
  assert.equal(p("bytedance/seedance-2-mini", { seconds: 10 }), 39_300);
  // MiniMax H3: $0.05 / 0.06 (768p default).
  assert.equal(p("minimax/h3", { seconds: 5 }), 7_700);
  assert.equal(p("minimax/h3", { seconds: 5, resolution: "480p" }), 6_400);
  assert.equal(p("minimax/h3", { seconds: 10 }), 15_300);
  // MiniMax H3 Max Turbo: standard rates $0.025 / 0.04 / 0.08.
  assert.equal(p("minimax/h3-max-turbo", { seconds: 5 }), 5_100);
  assert.equal(p("minimax/h3-max-turbo", { seconds: 5, resolution: "480p" }), 3_200);
  assert.equal(p("minimax/h3-max-turbo", { seconds: 10, resolution: "1080p" }), 20_400);
  assert.equal(p("minimax/h3-max-turbo", { seconds: 2, resolution: "480p" }), 1_300);
  // The formula behind every number: USD/s × seconds × rate × markup, up to 100.
  for (const id of FAL_IDS) {
    const table = FAL_VIDEO_USD_PER_SECOND[id as keyof typeof FAL_VIDEO_USD_PER_SECOND] as Record<string, number>;
    for (const [res, usd] of Object.entries(table)) for (const s of [5, 10]) assert.equal(p(id, { seconds: s, resolution: res }), up100(usd * s * RATE * 2), `${id} ${res} ${s}s`);
  }
  // Sound and aspect never change a fal price; the end frame neither.
  assert.equal(p("alibaba/wan-3", { seconds: 5, sound: false, aspect: "1:1" }), 12_700);
  assert.equal(p("alibaba/wan-3", { seconds: 5, imageAssetId: ASSET, endImageAssetId: ASSET2 }), 12_700);
  // The model override wins.
  assert.equal(studioVideoPrice({ modelId: "minimax/h3", seconds: 5 }, { ...PRICING, overrides: { "minimax/h3": { markup: 3 } } }), up100(0.06 * 5 * RATE * 3));
  // «Quchoqlash» is one effect clip.
  assert.equal(p("kling/effects", { effect: "hug" }), up100(KLING_EFFECT_USD * RATE * 2));
  assert.equal(p("kling/effects", { effect: "hug" }), 21_400);
});

test("client preview == server price (basePriceFor) for every fal model × resolution × seconds × override × tool %", () => {
  const tool = TOOL_BY_ID["studio-video"];
  const view = new Map(MEDIA_CATALOG.clientView().map((e) => [e.id, e]));
  const pricings = [PRICING, { ...PRICING, markup: 2.5 }, { ...PRICING, overrides: { "bytedance/seedance-2.5": { markup: 1.4 }, "minimax/h3-max-turbo": { markup: 4 } } }];
  for (const pricing of pricings) {
    for (const id of [...FAL_IDS, "kling/effects"]) {
      const e = view.get(id)!;
      const table = FAL_VIDEO_USD_PER_SECOND[id as keyof typeof FAL_VIDEO_USD_PER_SECOND] as Record<string, number> | undefined;
      const variants: Record<string, unknown>[] = table ? Object.keys(table).flatMap((resolution) => [2, 4, 5, 7, 10].map((seconds) => ({ seconds, resolution }))) : [{ effect: "hug" }];
      for (const v of variants) {
        const values = { modelId: id, ...v };
        const server = basePriceFor(tool, values as never, pricing);
        assert.equal(studioVideoClientPrice(e, values, pricing, undefined), server, `${id} ${JSON.stringify(v)}`);
        const adj = { percent: 120, roundTo: 500 as const };
        assert.equal(studioVideoClientPrice(e, values, pricing, adj), applyPriceAdjust(server, adj));
      }
    }
  }
  assert.equal(videoCardPrice(view.get("minimax/h3")!, { seconds: 5 }, PRICING), `~${groupDigits(7_700)} so'm / 5 s`);
});

/* ══════════════════════════ preflight ══════════════════════════ */

test("preflight: end frame needs a start; «Quchoqlash» needs two photos; a one-photo scene takes no second; sold ranges only", () => {
  const tool = TOOL_BY_ID["studio-video"];
  assert.equal(studioVideoError({ modelId: "alibaba/wan-3", prompt: "Registon at dawn", endImageAssetId: ASSET2 }), "Oxirgi kadr uchun boshlang‘ich suratni ham yuklang.");
  assert.equal(studioVideoError({ modelId: "kling/kling-3", prompt: "Registon at dawn", endImageAssetId: ASSET2 }), "Oxirgi kadr uchun boshlang‘ich suratni ham yuklang.");
  assert.equal(studioVideoError({ modelId: "alibaba/wan-3", prompt: "Registon at dawn", imageAssetId: ASSET, endImageAssetId: ASSET2 }), null);
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "hug", imageAssetId: ASSET }), "Bu effekt uchun ikkinchi suratni ham yuklang.");
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "hug", imageAssetId: ASSET, secondImageAssetId: ASSET2 }), null);
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "snowglobe", imageAssetId: ASSET, secondImageAssetId: ASSET2 }), "Bu effekt bitta surat bilan ishlaydi.");
  assert.equal(studioVideoError({ modelId: "kling/effects", effect: "hug" }), "Effekt uchun surat yuklang.");
  assert.ok(studioVideoError({ modelId: "alibaba/wan-3", prompt: "Registon at dawn", seconds: 11 }), "over 10 s is not sold");
  assert.ok(studioVideoError({ modelId: "minimax/h3", prompt: "Registon at dawn", seconds: 4 }), "H3 starts at 5 s");
  assert.ok(studioVideoError({ modelId: "minimax/h3", prompt: "Registon at dawn", resolution: "1080p" }), "H3 sells 480p / 768p");
  assert.ok(studioVideoError({ modelId: "bytedance/seedance-2.5", prompt: "Registon at dawn", resolution: "1080p" }), "Seedance 2.5 1080p is not sold");
  assert.ok(studioVideoError({ modelId: "minimax/h3", prompt: "Registon at dawn", sound: true }) === null, "an unknown key is ignored, as for every model");
  // The photos a job sends (ownership-checked before charging, resolved at submit).
  assert.deepEqual(studioVideoImageParams(entry("alibaba/wan-3"), {}), ["imageAssetId", "endImageAssetId"]);
  assert.deepEqual(studioVideoImageParams(entry("kling/effects"), { effect: "hug" }), ["imageAssetId", "secondImageAssetId"]);
  assert.deepEqual(studioVideoImageParams(entry("kling/effects"), { effect: "snowglobe" }), ["imageAssetId"]);
  assert.equal(topicOf({ modelId: "kling/effects", effect: "hug" }, tool), "Effekt: Quchoqlash");
});
