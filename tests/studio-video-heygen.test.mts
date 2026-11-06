import test from "node:test";
import assert from "node:assert/strict";
import { MediaError, normalize, type AdapterAsset, type AdapterInput, type CatalogEntry } from "../lib/studio-core/index.ts";
import { MEDIA_CATALOG, MEDIA_PURPOSES } from "../lib/media/catalog.ts";
import {
  ASPECT_FOLLOWS_IMAGE,
  HEYGEN_AVATARS,
  HEYGEN_MAX_SECONDS,
  HEYGEN_MODEL,
  HEYGEN_SCRIPT_MAX,
  HEYGEN_USD_PER_SECOND,
  OWN_AUDIO_PARAM,
  STUDIO_VIDEO_PURPOSE,
  HEYGEN_DIGIT_WEIGHT,
  HEYGEN_SYMBOL_WEIGHT,
  avatarAudioSeconds,
  avatarScriptProblem,
  avatarScriptSeconds,
  avatarSpokenChars,
  withAvatarSeconds,
} from "../lib/media/catalog-video.ts";
import { studioVideoAdapters } from "../lib/media/adapters/video.ts";
import { HEYGEN_ADAPTER_ID, heygenVideoAdapter, isHeygenFileUrl, parseHeygenOp } from "../lib/media/adapters/heygen.ts";
import { compareModels } from "../components/studio/compare/compare-model.ts";
import { studioVideoError, studioVideoPrice } from "../lib/media/studio-video-pricing.ts";
import { TOOL_BY_ID, basePriceFor, preflightError } from "../lib/tools.ts";
import { studioVideoClientPrice } from "../components/studio/video/video-price.ts";
import { avatarHiddenParams, avatarRequest, avatarSpeeches } from "../components/studio/video/avatar.ts";
import { providerDef } from "../lib/server/providers/registry.ts";
import { PROVIDER_META, PURPOSES } from "../lib/server/providers/catalog.ts";
import { HEYGEN_ME_URL, heygenMessage, probeProvider, probeRequest } from "../lib/server/providers/probe.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { applyPriceAdjust } from "../lib/price-adjust.ts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * STUDIO P9 — HeyGen avatar videos in the «Video» tab (docs/studio/P9-HEYGEN.md). Stubbed `fetch` only: HeyGen is NEVER
 * called for real.
 *
 *   catalog   one entry `heygen/avatar` after Sora, before the effects; route `heygen` / `heygen-video`; script ≤ 720
 *             characters, own speech, 4 curated avatars, voice, language, engine (priced), 16:9 | 9:16, a computed length;
 *   length    `withAvatarSeconds`: the script at 12 characters / s, an own speech by its stored length (0.1 s rounding),
 *             the request's own `seconds` never kept;
 *   golden    submit = a voice-list read, then ONE `POST /v3/videos` (exact body, `Idempotency-Key`), op `heygen:<id>`;
 *             an own speech = an asset upload (multipart) then `audio_asset_id` (no script / voice);
 *   auth      `x-api-key` only to `api.heygen.com`, every call `redirect: "manual"`; the download carries no key;
 *   errors    before acceptance (voices / upload / a create 4xx) `accepted: false`; a create network drop / no video id /
 *             409 in progress = accepted; 400 `content_policy_violation` = safety; the key is in no message;
 *   poll      pending / processing → running; completed → the URL; failed (policy → safety); 404 → failed; 429 / 5xx /
 *             401 / network → retry; cancel = DELETE;
 *   download  host allowlist, no key, 25 MB cap, MP4 sniff;
 *   prices    goldens at ×2 and 12 700 so'm/$; client == server (`basePriceFor`, tool %);
 *   preflight script XOR own speech, a short script, a bad speech id → refused before charging;
 *   provider  registry / catalog facts, «Tekshirish» = `GET /v3/users/me` with the key header only there.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `heygenVideoBody` drops `engine`                                        -> «golden: script», «probe»;
 *   2. own speech sends `script` too                                           -> «golden: own speech»;
 *   3. `Idempotency-Key` header not sent                                       -> «golden: script»;
 *   4. voice pick ignores the answer's language (first item)                   -> «golden: script» (wrong voice);
 *   5. create 4xx mapped `accepted: true`                                      -> «errors: submit»;
 *   6. create network drop mapped `accepted: false`                            -> «errors: submit»;
 *   7. poll treats `failed` as running                                         -> «poll states»;
 *   8. `isHeygenFileUrl` accepts any https host                                -> «download»;
 *   9. download sends the key                                                  -> «auth»;
 *  10. `scrub` skipped in the create error                                     -> «key never in messages»;
 *  11. `avatarScriptSeconds` at 15 chars / s                                    -> «length», «prices»;
 *  12. `withAvatarSeconds` keeps the request's `seconds`                        -> «length», «prices»;
 *  13. `studioVideoError` lets script + own speech through                      -> «preflight»;
 *  14. probe sends the key as `Authorization`                                   -> «provider».
 * Review fixes (2026-11-04; changed assertions: poll 404 «failed» → «retryable + accepted»; nothing removed):
 *  15. poll 404 → failed at once (old code)                                      -> «poll states»;
 *  16. `avatar_not_usable` back in SAFETY_CODES                                  -> «errors: submit», «MINOR 2»;
 *  17. no error log for a bad avatar code                                        -> «MINOR 2»;
 *  18. completion without the duration log                                       -> «MINOR 2» (calibration line);
 *  19. no re-POST after a create drop                                            -> «MINOR 5», «errors: submit»;
 *  20. digits weighted 1                                                         -> «MINOR 4»;
 *  21. `avatarScriptProblem` without the link check                              -> «MINOR 4»;
 *  22. `compareModels` keeps the avatar                                          -> «MINOR 3».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

const KEY = "hg-test-key-0123456789abcdef";
const RATE = 12_700;
const PRICING = { soumPerUsd: RATE, markup: 2, step: 100, overrides: {}, costUsd: {} };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const API = "https://api.heygen.com";
const SPEECH = "0f0e0d0c-0b0a-4908-8706-050403020100";
const AUDIO: AdapterAsset = { mime: "audio/mpeg", base64: Buffer.from("ID3-fake-mp3-bytes").toString("base64") };
const SCRIPT = "Assalomu alaykum! Bugun yangi kurs haqida gapiramiz."; // 52 characters → 5 s

const entry = (): CatalogEntry => MEDIA_CATALOG.byId(HEYGEN_MODEL)!;
function input(values: Record<string, unknown>, assets: Record<string, AdapterAsset[]> = {}): AdapterInput {
  const e = entry();
  return { upstreamModel: e.routes[0]!.upstreamModel, params: normalize(e.params, values), ...(Object.keys(assets).length ? { assets } : {}), idempotencyKey: "4f1c2b3a-9d8e-4c7b-a6f5-0123456789ab:video:0" };
}
const adapter = (o: { key?: string | null } = {}) => heygenVideoAdapter({ key: () => (o.key === undefined ? KEY : o.key), voiceCache: new Map(), lookup: async () => ["93.184.216.34"] });

type Seen = { url: string; init: RequestInit };
function stub(respond: (url: string, init: RequestInit, n: number) => Response | Promise<Response>): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (u: unknown, init?: RequestInit) => {
    seen.push({ url: String(u), init: init ?? {} });
    return respond(String(u), init ?? {}, seen.length);
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const keyOf = (s: Seen) => new Headers(s.init.headers).get("x-api-key");
const VOICES = {
  data: [
    { voice_id: "en_female_0001", language: "English", gender: "female" },
    { voice_id: "uz_male_0002", language: "Uzbek", gender: "male" },
    { voice_id: "uz_female_0003", language: "Uzbek (Latin, Uzbekistan)", gender: "female" },
  ],
  has_more: false,
};
/** A HeyGen that answers the voice list, the asset upload and the create call. */
const happy = () =>
  stub((url, init) => {
    if (url.startsWith(`${API}/v3/voices`)) return jsonRes(VOICES);
    if (url === `${API}/v3/assets`) return jsonRes({ data: { asset_id: "asset_0123abc", url: "https://files.heygen.ai/a.mp3", mime_type: "audio/mpeg" } });
    if (url === `${API}/v3/videos` && init.method === "POST") return jsonRes({ data: { video_id: "v_abc123def456", status: "waiting" } });
    throw new Error(`unexpected ${init.method} ${url}`);
  });

/* ══════════════════════════ catalog ══════════════════════════ */

test("catalog: heygen/avatar after Sora, before the effects; route heygen; params; priced by engine; client view has no routes", () => {
  const allowed = MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed;
  // P11: package F's models sit between Sora and HeyGen, its photo avatars and fal effects before the direct effects.
  assert.deepEqual(allowed.slice(-7), ["alibaba/happy-horse", HEYGEN_MODEL, "bytedance/omnihuman-2", "kling/ai-avatar-2", "pixverse/effects", "kling/effects-v16", "kling/effects"]);
  const e = entry();
  assert.equal(e.kind, "video");
  assert.equal(e.maker, "HeyGen");
  assert.deepEqual(e.routes, [{ provider: "heygen", upstreamModel: "v3-avatar", adapter: HEYGEN_ADAPTER_ID }]);
  assert.deepEqual(e.params.map((p) => p.name), ["prompt", OWN_AUDIO_PARAM, "avatar", "voice", "language", "engine", "aspect", "seconds"]);
  const prompt = e.params.find((p) => p.name === "prompt")!;
  assert.ok(prompt.type === "text" && prompt.min === 0 && prompt.max === HEYGEN_SCRIPT_MAX && HEYGEN_SCRIPT_MAX === 720);
  const avatar = e.params.find((p) => p.name === "avatar")!;
  assert.ok(avatar.type === "enum");
  assert.deepEqual(avatar.options.map((o) => o.value), HEYGEN_AVATARS.map((a) => a.id));
  assert.equal(avatar.options.length, 4);
  const aspect = e.params.find((p) => p.name === "aspect")!;
  assert.ok(aspect.type === "enum");
  assert.deepEqual(aspect.options.map((o) => o.value), ["16:9", "9:16"]);
  const secs = e.params.find((p) => p.name === "seconds")!;
  assert.ok(secs.type === "int" && secs.min === 1 && secs.max === HEYGEN_MAX_SECONDS && secs.affects === "price");
  assert.deepEqual(e.cost, { per: "second", usd: 0.0805, secondsParam: "seconds", by: { param: "engine", table: { avatar_iv: 0.0805, avatar_iii: 0.0167 } } });
  assert.ok(!e.params.some((p) => p.type === "image"), "no photo input");
  assert.ok(!ASPECT_FOLLOWS_IMAGE.has(HEYGEN_MODEL));
  const view = MEDIA_CATALOG.clientView().find((x) => x.id === HEYGEN_MODEL)!;
  assert.ok(!("routes" in view));
  assert.ok(studioVideoAdapters()[HEYGEN_ADAPTER_ID], "registered with the Studio video adapters");
});

/* ══════════════════════════ length ══════════════════════════ */

test("length: script at 12 characters / s (1…60), own speech by its stored length; the request's seconds never kept", () => {
  assert.equal(avatarScriptSeconds(""), 1);
  assert.equal(avatarScriptSeconds("x".repeat(12)), 1);
  assert.equal(avatarScriptSeconds("x".repeat(13)), 2);
  assert.equal(avatarScriptSeconds(SCRIPT), 5);
  assert.equal(avatarScriptSeconds("x".repeat(HEYGEN_SCRIPT_MAX)), 60);
  assert.equal(avatarScriptSeconds("x".repeat(5000)), 60, "clipped to the script max");
  assert.equal(avatarScriptSeconds("a   b"), 1, "whitespace collapsed as the server reads it");
  assert.equal(avatarAudioSeconds(10.04), 10, "10.0 s as listed");
  assert.equal(avatarAudioSeconds(10.06), 11, "10.1 s as listed → 11");
  assert.equal(avatarAudioSeconds(0.2), 1);
  assert.equal(avatarAudioSeconds(60.3), 60, "within the server's tolerance");
  assert.equal(withAvatarSeconds({ prompt: SCRIPT, seconds: 1 }, null).seconds, 5, "MUTATSIYA: the request's seconds kept");
  assert.equal(withAvatarSeconds({ prompt: "", [OWN_AUDIO_PARAM]: SPEECH, seconds: 1 }, 23.4).seconds, 24);
  assert.equal(withAvatarSeconds({ [OWN_AUDIO_PARAM]: SPEECH, seconds: 7 }, null).seconds, 7, "an unknown speech length leaves the values (the server measures)");
});

/* ══════════════════════════ golden ══════════════════════════ */

test("golden: script → voice lookup (language + gender, answer re-checked) → ONE create with Idempotency-Key; op heygen:<id>; voice cached", async () => {
  const s = happy();
  const a = adapter();
  const r = await a.submit(input({ prompt: SCRIPT, seconds: 5 }), { fetchImpl: s.fetchImpl });
  assert.deepEqual(r, { opId: "heygen:v_abc123def456" });
  assert.equal(s.seen.length, 2);
  const voices = new URL(s.seen[0]!.url);
  assert.equal(voices.origin + voices.pathname, `${API}/v3/voices`);
  assert.deepEqual(Object.fromEntries(voices.searchParams), { type: "public", language: "Uzbek", gender: "female", limit: "100" });
  const create = s.seen[1]!;
  assert.equal(create.url, `${API}/v3/videos`);
  assert.equal(create.init.method, "POST");
  assert.deepEqual(JSON.parse(String(create.init.body)), {
    type: "avatar",
    avatar_id: "Angela-inblackskirt-20220820",
    script: SCRIPT,
    voice_id: "uz_female_0003",
    resolution: "720p",
    aspect_ratio: "16:9",
    engine: { type: "avatar_iv" },
  });
  const h = new Headers(create.init.headers);
  assert.equal(h.get("idempotency-key"), "4f1c2b3a-9d8e-4c7b-a6f5-0123456789ab:video:0", "MUTATSIYA: no Idempotency-Key");
  assert.equal(h.get("content-type"), "application/json");
  // Same adapter, same voice: no second voice-list read.
  const s2 = happy();
  await a.submit(input({ prompt: SCRIPT, voice: "female", aspect: "9:16", engine: "avatar_iii", avatar: "Josh_lite3_20230714" }), { fetchImpl: s2.fetchImpl });
  assert.equal(s2.seen.length, 1, "voice id cached");
  assert.deepEqual(JSON.parse(String(s2.seen[0]!.init.body)), { type: "avatar", avatar_id: "Josh_lite3_20230714", script: SCRIPT, voice_id: "uz_female_0003", resolution: "720p", aspect_ratio: "9:16", engine: { type: "avatar_iii" } });
  // Male Russian: a different lookup.
  const s3 = stub((url) => (url.includes("/v3/voices") ? jsonRes({ data: [{ voice_id: "ru_male_1", language: "Russian", gender: "male" }] }) : jsonRes({ data: { video_id: "v_ru" } })));
  await adapter().submit(input({ prompt: SCRIPT, voice: "male", language: "ru" }), { fetchImpl: s3.fetchImpl });
  assert.deepEqual(Object.fromEntries(new URL(s3.seen[0]!.url).searchParams), { type: "public", language: "Russian", gender: "male", limit: "100" });
  assert.equal(JSON.parse(String(s3.seen[1]!.init.body)).voice_id, "ru_male_1");
  // The pure build names what submit looks up (no key inside).
  const b = a.buildRequest!(input({ prompt: SCRIPT }));
  assert.equal(b.url, `${API}/v3/videos`);
  assert.equal((b.body as { voice_id: string }).voice_id, "lookup:Uzbek:female");
  assert.ok(!JSON.stringify(b).includes(KEY));
});

test("golden: own speech → multipart asset upload, then audio_asset_id (no script, no voice lookup)", async () => {
  const s = happy();
  const r = await adapter().submit(input({ [OWN_AUDIO_PARAM]: SPEECH, seconds: 9, voice: "male", language: "ru" }, { [OWN_AUDIO_PARAM]: [AUDIO] }), { fetchImpl: s.fetchImpl });
  assert.deepEqual(r, { opId: "heygen:v_abc123def456" });
  assert.deepEqual(s.seen.map((x) => `${x.init.method} ${x.url}`), [`POST ${API}/v3/assets`, `POST ${API}/v3/videos`]);
  const form = s.seen[0]!.init.body as FormData;
  assert.ok(form instanceof FormData);
  const file = form.get("file") as File;
  assert.equal(file.type, "audio/mpeg");
  assert.equal(file.name, "voice.mp3");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "ID3-fake-mp3-bytes");
  assert.deepEqual(JSON.parse(String(s.seen[1]!.init.body)), { type: "avatar", avatar_id: "Angela-inblackskirt-20220820", audio_asset_id: "asset_0123abc", resolution: "720p", aspect_ratio: "16:9", engine: { type: "avatar_iv" } }, "MUTATSIYA: script sent with own speech");
  // Own speech without its resolved bytes: nothing sent, not accepted.
  const s2 = happy();
  await assert.rejects(adapter().submit(input({ [OWN_AUDIO_PARAM]: SPEECH }), { fetchImpl: s2.fetchImpl }), (e: unknown) => e instanceof MediaError && e.accepted === false);
  assert.equal(s2.seen.length, 0);
  assert.equal((adapter().buildRequest!(input({ [OWN_AUDIO_PARAM]: SPEECH })).body as Record<string, unknown>).audio_asset_id, `upload:${SPEECH}`);
});

/* ══════════════════════════ auth ══════════════════════════ */

test("auth: x-api-key only to api.heygen.com, every call redirect manual; the download carries no key", async () => {
  const mp4 = fakeMp4(5);
  const s = stub((url, init) => {
    if (url.startsWith(`${API}/v3/voices`)) return jsonRes(VOICES);
    if (url === `${API}/v3/videos` && init.method === "POST") return jsonRes({ data: { video_id: "v_auth1" } });
    if (url === `${API}/v3/videos/v_auth1` && init.method === "GET") return jsonRes({ data: { id: "v_auth1", status: "completed", video_url: "https://files2.heygen.ai/video/v_auth1.mp4?Expires=1&Signature=x" } });
    if (url === `${API}/v3/videos/v_auth1` && init.method === "DELETE") return jsonRes({ data: { id: "v_auth1", deleted: true } });
    if (url.startsWith("https://files2.heygen.ai/")) return new Response(Buffer.from(mp4), { status: 200, headers: { "content-type": "video/mp4" } });
    throw new Error(`unexpected ${init.method} ${url}`);
  });
  const a = adapter();
  const { opId } = (await a.submit(input({ prompt: SCRIPT }), { fetchImpl: s.fetchImpl })) as { opId: string };
  const polled = await a.poll!(opId, { fetchImpl: s.fetchImpl });
  assert.equal(polled.state, "done");
  const out = polled.state === "done" ? polled.outputs[0]! : null;
  assert.deepEqual(await a.fetchOutput(out!, { fetchImpl: s.fetchImpl }), mp4);
  assert.equal(await a.cancel!(opId, { fetchImpl: s.fetchImpl }), "cancelled");
  for (const c of s.seen) {
    const host = new URL(c.url).hostname;
    if (host === "api.heygen.com") {
      assert.equal(keyOf(c), KEY, `${c.url}: the key`);
      assert.equal(c.init.redirect, "manual", `${c.url}: no redirect followed`);
    } else assert.equal(keyOf(c), null, `${c.url}: MUTATSIYA — the key left HeyGen's API host`);
    assert.ok(!new Headers(c.init.headers).get("authorization"), "never an Authorization header");
  }
  assert.ok(s.seen.some((c) => c.url.startsWith("https://files2.heygen.ai/")), "the download happened");
  assert.equal(a.configured(), true);
  assert.equal(adapter({ key: null }).configured(), false);
});

/* ══════════════════════════ errors ══════════════════════════ */

test("errors: submit — before the create nothing is billed (accepted false); create drop / no id / 409 in progress = accepted; policy = safety", async () => {
  const run = async (respond: Parameters<typeof stub>[0], values: Record<string, unknown> = { prompt: SCRIPT }) => {
    const s = stub(respond);
    try {
      await adapter().submit(input(values), { fetchImpl: s.fetchImpl });
    } catch (e) {
      assert.ok(e instanceof MediaError, String(e));
      return { e, seen: s.seen };
    }
    assert.fail("should throw");
  };
  const create = (res: () => Response | Promise<Response>) => (url: string) => (url.includes("/v3/voices") ? jsonRes(VOICES) : res());
  // No key: nothing sent.
  const s0 = stub(() => jsonRes({}));
  await assert.rejects(adapter({ key: null }).submit(input({ prompt: SCRIPT }), { fetchImpl: s0.fetchImpl }), (e: unknown) => e instanceof MediaError && e.accepted === false);
  assert.equal(s0.seen.length, 0);
  // Voice list problems: no video exists.
  let r = await run(() => jsonRes({ data: [] }));
  assert.equal(r.e.accepted, false);
  assert.match(r.e.message, /Uzbek female ovozi topilmadi/);
  r = await run(() => jsonRes({ error: { code: "unauthorized", message: "bad key" } }, 401));
  assert.deepEqual([r.e.status, r.e.accepted, r.e.retryable], [401, false, false]);
  r = await run(() => jsonRes({ data: [{ voice_id: "en_female_1", language: "English", gender: "female" }] }));
  assert.equal(r.e.accepted, false, "MUTATSIYA: an English voice for Uzbek text");
  r = await run(() => {
    throw new TypeError("voices: socket hang up");
  });
  assert.deepEqual([r.e.accepted, r.e.retryable], [false, true]);
  // The create call.
  r = await run(create(() => jsonRes({ error: { code: "content_policy_violation", message: "Script violates policy" } }, 400)));
  assert.deepEqual([r.e.status, r.e.safety, r.e.accepted, r.e.retryable], [400, true, false, false]);
  r = await run(create(() => jsonRes({ error: { code: "insufficient_credit", message: "Not enough credits" } }, 402)));
  assert.deepEqual([r.e.status, r.e.safety, r.e.accepted, r.e.retryable], [402, false, false, false], "MUTATSIYA: a 4xx accepted");
  r = await run(create(() => jsonRes({ error: { code: "avatar_not_found" } }, 404)));
  assert.deepEqual([r.e.accepted, r.e.retryable], [false, false]);
  r = await run(create(() => jsonRes({ error: { code: "rate_limit_exceeded" } }, 429)));
  assert.deepEqual([r.e.accepted, r.e.retryable], [false, true]);
  r = await run(create(() => jsonRes({ error: { code: "internal_error" } }, 500)));
  assert.deepEqual([r.e.accepted, r.e.retryable], [false, true]);
  r = await run(create(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } })));
  assert.deepEqual([r.e.status, r.e.accepted], [302, false]);
  r = await run(create(() => jsonRes({ error: { code: "request_in_progress" } }, 409)));
  assert.deepEqual([r.e.accepted, r.e.retryable], [true, false], "the same key is running: a clip exists");
  r = await run(create(() => {
    throw new TypeError("create: socket hang up");
  }));
  assert.deepEqual([r.e.accepted, r.e.retryable], [true, true], "MUTATSIYA: a create drop not accepted");
  assert.equal(r.seen.filter((c) => c.url === `${API}/v3/videos`).length, 2, "review MINOR 5: one immediate re-POST, no more");
  // Review MINOR 2: a refused curated avatar is a plain failure (not safety), logged at error level for the admin.
  r = await run(create(() => jsonRes({ error: { code: "avatar_not_usable", message: "Avatar failed moderation" } }, 400)));
  assert.deepEqual([r.e.status, r.e.safety, r.e.accepted, r.e.retryable], [400, false, false, false], "MUTATSIYA: avatar_not_usable as safety");
  r = await run(create(() => jsonRes({ data: { status: "waiting" } })));
  assert.equal(r.e.accepted, true, "an answer without video_id");
  // Asset upload problems: not accepted.
  const up = await (async () => {
    const s = stub((url) => (url.endsWith("/v3/assets") ? jsonRes({ error: { code: "invalid_parameter" } }, 400) : jsonRes({ data: { video_id: "v_x" } })));
    try {
      await adapter().submit(input({ [OWN_AUDIO_PARAM]: SPEECH }, { [OWN_AUDIO_PARAM]: [AUDIO] }), { fetchImpl: s.fetchImpl });
    } catch (e) {
      return { e: e as MediaError, n: s.seen.length };
    }
    assert.fail("should throw");
  })();
  assert.deepEqual([up.e.accepted, up.n], [false, 1], "no create after a failed upload");
});

test("key never in messages: submit / poll / cancel errors and a failed clip's message are scrubbed", async () => {
  const echo = () => jsonRes({ error: { code: "invalid_parameter", message: `bad x-api-key ${KEY} for request` } }, 400);
  const s = stub((url) => (url.includes("/v3/voices") ? jsonRes(VOICES) : echo()));
  const e1 = await adapter().submit(input({ prompt: SCRIPT }), { fetchImpl: s.fetchImpl }).catch((e: unknown) => e as Error);
  assert.ok(e1 instanceof Error && !e1.message.includes(KEY), "MUTATSIYA: create error not scrubbed");
  const e2 = await adapter().submit(input({ prompt: SCRIPT }), { fetchImpl: stub(echo).fetchImpl }).catch((e: unknown) => e as Error);
  assert.ok(e2 instanceof Error && !e2.message.includes(KEY), "voices error");
  const e3 = await adapter().poll!("heygen:v_k1", { fetchImpl: stub(() => jsonRes({ error: { message: KEY } }, 500)).fetchImpl }).catch((e: unknown) => e as Error);
  assert.ok(e3 instanceof Error && !e3.message.includes(KEY));
  const failed = await adapter().poll!("heygen:v_k1", { fetchImpl: stub(() => jsonRes({ data: { status: "failed", failure_code: "internal_error", failure_message: `crash with ${KEY}` } })).fetchImpl });
  assert.ok(failed.state === "failed" && !failed.message.includes(KEY));
  const e4 = await adapter().cancel!("heygen:v_k1", { fetchImpl: stub(() => {
    throw new TypeError(`reset ${KEY}`);
  }).fetchImpl }).catch((e: unknown) => e as Error);
  assert.ok(e4 instanceof Error && !e4.message.includes(KEY));
});

/* ══════════════════════════ poll ══════════════════════════ */

test("poll states: pending / processing → running; completed → URL; failed (policy → safety); 404 → failed; 429 / 5xx / 401 / network → retry", async () => {
  const a = adapter();
  const poll = (body: unknown, status = 200) => a.poll!("heygen:v_poll1", { fetchImpl: stub(() => jsonRes(body, status)).fetchImpl });
  assert.deepEqual(await poll({ data: { status: "pending" } }), { state: "running" });
  assert.deepEqual(await poll({ data: { status: "processing" } }), { state: "running" });
  assert.deepEqual(await poll({ data: { status: "completed", video_url: "https://files.heygen.ai/v.mp4", duration: 5.2 } }), { state: "done", outputs: [{ kind: "url", url: "https://files.heygen.ai/v.mp4", mime: "video/mp4" }] });
  const policy = await poll({ data: { status: "failed", failure_code: "content_policy_violation", failure_message: "Script rejected" } });
  assert.deepEqual([policy.state, policy.state === "failed" && policy.safety], ["failed", true], "MUTATSIYA: failed treated as running");
  const generic = await poll({ data: { status: "failed", failure_code: "internal_error", failure_message: "render crashed" } });
  assert.deepEqual([generic.state, generic.state === "failed" && generic.safety], ["failed", false]);
  assert.equal((await poll({ data: { status: "cancelled" } })).state, "failed");
  assert.equal((await poll({ data: { status: "completed" } })).state, "failed", "completed without a URL");
  // Review MINOR 1: a 404 can be HeyGen's lag right after the create — retried (the transient cap / deadline ends it).
  await assert.rejects(poll({ error: { code: "video_not_found" } }, 404), (e: unknown) => e instanceof MediaError && e.retryable && e.accepted && e.status === 404, "MUTATSIYA: 404 failed at once");
  const s = stub(() => jsonRes({ data: { status: "pending" } }));
  await a.poll!("heygen:v_poll1", { fetchImpl: s.fetchImpl });
  assert.equal(s.seen[0]!.url, `${API}/v3/videos/v_poll1`);
  for (const [status, why] of [[429, "rate"], [503, "5xx"], [401, "key changed after submit"]] as const) {
    await assert.rejects(poll({ error: { code: "x" } }, status), (e: unknown) => e instanceof MediaError && e.retryable && e.accepted, why);
  }
  await assert.rejects(a.poll!("heygen:v_poll1", { fetchImpl: stub(() => {
    throw new TypeError("network");
  }).fetchImpl }), (e: unknown) => e instanceof MediaError && e.retryable && e.accepted);
  await assert.rejects(a.poll!("fal:x:y", { fetchImpl: stub(() => jsonRes({})).fetchImpl }), MediaError, "an op id it did not issue");
  await assert.rejects(adapter({ key: null }).poll!("heygen:v_poll1", {}), (e: unknown) => e instanceof MediaError && e.retryable, "a missing key waits for the deadline");
  assert.equal(parseHeygenOp("heygen:v_abc123def456"), "v_abc123def456");
  assert.equal(parseHeygenOp("heygen:../../etc"), null);
  assert.equal(parseHeygenOp("heygen:"), null);
  // Cancel: DELETE, 200 → cancelled, else throws (the host refunds anyway).
  const c = stub(() => jsonRes({ data: { deleted: true } }));
  assert.equal(await a.cancel!("heygen:v_poll1", { fetchImpl: c.fetchImpl }), "cancelled");
  assert.deepEqual([c.seen[0]!.init.method, c.seen[0]!.url], ["DELETE", `${API}/v3/videos/v_poll1`]);
  await assert.rejects(a.cancel!("heygen:v_poll1", { fetchImpl: stub(() => jsonRes({}, 500)).fetchImpl }), MediaError);
});

/* ══════════════════════════ download ══════════════════════════ */

test("download: HeyGen file hosts only, no key, 25 MB cap, MP4 sniffed", async () => {
  const a = adapter();
  const mp4 = fakeMp4(5);
  assert.ok(isHeygenFileUrl("https://files2.heygen.ai/video/x.mp4"));
  assert.ok(isHeygenFileUrl("https://resource2.heygen.ai/video/x.mp4"));
  assert.ok(isHeygenFileUrl("https://d1.cloudfront.net/x.mp4"));
  assert.ok(!isHeygenFileUrl("https://evil.example/heygen.ai/x.mp4"), "MUTATSIYA: any host accepted");
  assert.ok(!isHeygenFileUrl("https://heygen.ai.evil.example/x.mp4"));
  assert.ok(!isHeygenFileUrl("http://files.heygen.ai/x.mp4"), "https only");
  assert.ok(!isHeygenFileUrl("https://user:pw@files.heygen.ai/x.mp4"));
  const other = stub(() => new Response(Buffer.from(mp4)));
  await assert.rejects(a.fetchOutput({ kind: "url", url: "https://evil.example/x.mp4" }, { fetchImpl: other.fetchImpl }), MediaError);
  assert.equal(other.seen.length, 0, "a foreign host is never fetched");
  const big = stub(() => new Response(new Uint8Array(25 * 1024 * 1024 + 10), { status: 200, headers: { "content-length": String(25 * 1024 * 1024 + 10) } }));
  await assert.rejects(a.fetchOutput({ kind: "url", url: "https://files.heygen.ai/big.mp4" }, { fetchImpl: big.fetchImpl }), (e: unknown) => e instanceof MediaError && /juda katta/.test(e.message));
  const html = stub(() => new Response("<html>expired</html>", { status: 200 }));
  await assert.rejects(a.fetchOutput({ kind: "url", url: "https://files.heygen.ai/x.mp4" }, { fetchImpl: html.fetchImpl }), (e: unknown) => e instanceof MediaError && /MP4 emas/.test(e.message));
  const ok = stub(() => new Response(Buffer.from(mp4)));
  assert.deepEqual(await a.fetchOutput({ kind: "url", url: "https://files.heygen.ai/x.mp4" }, { fetchImpl: ok.fetchImpl }), mp4);
  assert.equal(keyOf(ok.seen[0]!), null);
});

/* ══════════════════════════ prices ══════════════════════════ */

test("prices: per second × engine × ×2 × 12 700, rounded up to 100; the length from the script / speech; client == server", () => {
  const sv = (values: Record<string, unknown>) => studioVideoPrice({ modelId: HEYGEN_MODEL, ...withAvatarSeconds(values, null) }, PRICING);
  assert.equal(sv({ prompt: SCRIPT }), up100(0.0805 * 5 * RATE * 2), "5 s Avatar IV");
  assert.equal(sv({ prompt: SCRIPT }), 10_300);
  assert.equal(sv({ prompt: SCRIPT, engine: "avatar_iii" }), up100(0.0167 * 5 * RATE * 2));
  assert.equal(sv({ prompt: "x".repeat(HEYGEN_SCRIPT_MAX) }), up100(0.0805 * 60 * RATE * 2), "the longest script = 60 s");
  assert.equal(studioVideoPrice({ modelId: HEYGEN_MODEL, ...withAvatarSeconds({ [OWN_AUDIO_PARAM]: SPEECH }, 23.4) }, PRICING), up100(0.0805 * 24 * RATE * 2), "own speech of 23.4 s → 24 s");
  assert.equal(HEYGEN_USD_PER_SECOND.avatar_iv, 0.0805);
  // Client == server, with a model override and the tool %.
  const view = MEDIA_CATALOG.clientView().find((e) => e.id === HEYGEN_MODEL)!;
  const tool = TOOL_BY_ID["studio-video"];
  const speeches = [{ id: SPEECH, title: "Salom", kind: "Ovoz", seconds: 17.3 }];
  for (const pricing of [PRICING, { ...PRICING, overrides: { [HEYGEN_MODEL]: { markup: 3 } } }]) {
    for (const form of [{ prompt: SCRIPT, seconds: 1 }, { prompt: "x".repeat(300), engine: "avatar_iii" }, { prompt: "draft", [OWN_AUDIO_PARAM]: SPEECH }]) {
      const sent = avatarRequest(view, { modelId: HEYGEN_MODEL, ...form }, speeches);
      const server = basePriceFor(tool, withAvatarSeconds(sent, form[OWN_AUDIO_PARAM as keyof typeof form] ? 17.3 : null) as never, pricing);
      assert.equal(studioVideoClientPrice(view, sent, pricing, undefined), server, JSON.stringify(form));
      const adj = { percent: 150, roundTo: 500 } as const;
      assert.notEqual(applyPriceAdjust(server, adj), server, "the tool % really applies");
      assert.equal(studioVideoClientPrice(view, sent, pricing, adj), applyPriceAdjust(server, adj));
    }
  }
  // The client clears the script when an own speech is picked, and prices that speech's length.
  const own = avatarRequest(view, { modelId: HEYGEN_MODEL, prompt: "draft", [OWN_AUDIO_PARAM]: SPEECH }, speeches);
  assert.deepEqual([own.prompt, own.seconds], ["", 18]);
  assert.equal(avatarRequest(view, { modelId: HEYGEN_MODEL, prompt: SCRIPT, seconds: 1 }, speeches).seconds, 5);
  assert.deepEqual(avatarRequest({ id: "kling/kling-3" }, { seconds: 7 }, speeches), { seconds: 7 }, "other models untouched");
});

/* ══════════════════════════ preflight ══════════════════════════ */

test("preflight: script XOR own speech; a short script, a bad speech id → refused before charging", () => {
  const err = (v: Record<string, unknown>) => studioVideoError({ modelId: HEYGEN_MODEL, ...v });
  assert.equal(err({ prompt: SCRIPT }), null);
  assert.equal(err({ [OWN_AUDIO_PARAM]: SPEECH }), null);
  assert.match(String(err({ prompt: SCRIPT, [OWN_AUDIO_PARAM]: SPEECH })), /bittasini/, "MUTATSIYA: both sent");
  assert.match(String(err({})), /matnni yozing/);
  assert.match(String(err({ prompt: "Hi" })), /kamida 5/);
  assert.match(String(err({ [OWN_AUDIO_PARAM]: "not-a-uuid" })), /Ovoz topilmadi/);
  assert.match(String(err({ prompt: SCRIPT, avatar: "someone-else" })), /noma'lum/);
  assert.match(String(err({ prompt: SCRIPT, aspect: "1:1" })), /noma'lum/);
  assert.match(String(err({ prompt: SCRIPT, seconds: 61 })), /1–60/);
  assert.equal(preflightError(TOOL_BY_ID["studio-video"], { modelId: HEYGEN_MODEL, prompt: SCRIPT, [OWN_AUDIO_PARAM]: SPEECH } as never) !== null, true);
  // The form: the computed length and the own-speech picker are not generic rows; voice / language hide with an own speech.
  assert.deepEqual([...avatarHiddenParams(false)].sort(), [OWN_AUDIO_PARAM, "seconds"].sort());
  assert.deepEqual([...avatarHiddenParams(true)].sort(), [OWN_AUDIO_PARAM, "language", "seconds", "voice"].sort());
  assert.deepEqual(
    avatarSpeeches([
      { id: "a", title: "A", kind: "Ovoz", seconds: 30 },
      { id: "b", title: "B", kind: "Ovoz", seconds: null },
      { id: "c", title: "C", kind: "Ovoz", seconds: 90 },
      { id: "d", title: "D", kind: "Ovoz", seconds: 60.4 },
    ]).map((s) => s.id),
    ["a", "d"],
    "a known length within the minute (+ the tolerance)",
  );
});

/* ══════════════════════════ provider ══════════════════════════ */

test("provider: registry + catalog facts; «Tekshirish» = GET /v3/users/me, key header only there, balance shown, key never echoed", async () => {
  assert.deepEqual(providerDef("heygen"), { id: "heygen", label: "HeyGen (avatar video)", kinds: ["video"], envKeys: ["HEYGEN_API_KEY"], keyHint: "HeyGen API kaliti (platform.heygen.com/api-keys)", implemented: true, testable: true });
  const meta = PROVIDER_META.heygen!;
  assert.deepEqual([meta.billing, meta.need, meta.keyless, meta.keyUrl], ["paid", "optional", false, "https://platform.heygen.com/api-keys"]);
  assert.match(meta.priceNote, /\$0\.0805 \/ soniya/);
  assert.match(meta.role, /avatar/);
  assert.ok(PURPOSES.find((p) => p.id === "video")!.providers.includes("heygen" as never));
  assert.deepEqual(probeRequest("heygen", KEY), { url: HEYGEN_ME_URL, headers: { "x-api-key": KEY } }, "MUTATSIYA: key as Authorization");
  assert.equal(HEYGEN_ME_URL, "https://api.heygen.com/v3/users/me");
  const ok = stub(() => jsonRes({ data: { email: "someone@example.com", billing_type: "wallet", wallet: { remaining_balance: 12.5, currency: "USD" } } }));
  const r = await probeProvider("heygen", KEY, { fetchImpl: ok.fetchImpl });
  assert.deepEqual(r, { ok: true, message: "Kalit qabul qilindi · hisob: wallet · API balansi $12.5" });
  assert.equal(ok.seen.length, 1);
  assert.equal(ok.seen[0]!.init.redirect, "manual");
  assert.equal(keyOf(ok.seen[0]!), KEY);
  assert.ok(!r.message.includes("someone@example.com"), "no account e-mail");
  assert.equal(heygenMessage({ data: { billing_type: "usage_based", usage_based: { remaining_credits: 1500 }, subscription: { plan: "pro" } } }), "Kalit qabul qilindi · tarif: pro · hisob: usage_based · qolgan kredit 1 500");
  assert.equal(heygenMessage(null), "Kalit qabul qilindi");
  assert.equal(heygenMessage({ data: { wallet: { remaining_balance: null } } }), "Kalit qabul qilindi", "a null balance is not $0");
  const bad = await probeProvider("heygen", KEY, { fetchImpl: stub(() => jsonRes({ error: { code: "unauthorized", message: `key ${KEY} is invalid` } }, 401)).fetchImpl });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /HTTP 401/);
  assert.ok(!bad.message.includes(KEY));
});

/* ══════════════════════════ review fixes ══════════════════════════ */

test("review MINOR 5: a create drop is re-POSTed once with the same Idempotency-Key — the replayed id is adopted; 409 in progress = accepted", async () => {
  const replay = (second: () => Response) => {
    let n = 0;
    return stub((url) => {
      if (url.includes("/v3/voices")) return jsonRes(VOICES);
      n++;
      if (n === 1) throw new TypeError("create: timeout");
      return second();
    });
  };
  const s1 = replay(() => jsonRes({ data: { video_id: "v_replayed1" } }));
  assert.deepEqual(await adapter().submit(input({ prompt: SCRIPT }), { fetchImpl: s1.fetchImpl }), { opId: "heygen:v_replayed1" }, "MUTATSIYA: no re-POST");
  const posts = s1.seen.filter((c) => c.url === `${API}/v3/videos`);
  assert.equal(posts.length, 2);
  assert.equal(new Headers(posts[0]!.init.headers).get("idempotency-key"), new Headers(posts[1]!.init.headers).get("idempotency-key"), "the same key");
  assert.equal(String(posts[0]!.init.body), String(posts[1]!.init.body), "the same body");
  const s2 = replay(() => jsonRes({ error: { code: "request_in_progress" } }, 409));
  await assert.rejects(adapter().submit(input({ prompt: SCRIPT }), { fetchImpl: s2.fetchImpl }), (e: unknown) => e instanceof MediaError && e.accepted === true && e.retryable === false);
});

test("review MINOR 2: avatar_not_usable / avatar_not_found → not safety, error log; only content_policy_violation is safety", async () => {
  const logs: { level: string; msg: string; fields: unknown }[] = [];
  const a = heygenVideoAdapter({ key: () => KEY, voiceCache: new Map(), log: ((level: string, msg: string, fields: unknown) => logs.push({ level, msg, fields })) as never });
  const failed = await a.poll!("heygen:v_bad1", { fetchImpl: stub(() => jsonRes({ data: { status: "failed", failure_code: "avatar_not_usable", failure_message: "Avatar failed moderation" } })).fetchImpl });
  assert.deepEqual([failed.state, failed.state === "failed" && failed.safety], ["failed", false], "MUTATSIYA: «moderation» text made it safety");
  assert.ok(logs.some((l) => l.level === "error" && /curated avatar/.test(l.msg)), "MUTATSIYA: no error log for a bad avatar");
  logs.length = 0;
  const s = stub((url) => (url.includes("/v3/voices") ? jsonRes(VOICES) : jsonRes({ error: { code: "avatar_not_found" } }, 404)));
  await assert.rejects(a.submit(input({ prompt: SCRIPT, avatar: "Tyler-incasualsuit-20220721" }), { fetchImpl: s.fetchImpl }), (e: unknown) => e instanceof MediaError && !e.safety && !e.accepted);
  assert.deepEqual(logs.map((l) => [l.level, (l.fields as { avatar?: string }).avatar]), [["error", "Tyler-incasualsuit-20220721"]]);
  // A normal failure logs nothing at error level; a policy failure is still safety.
  logs.length = 0;
  const policy = await a.poll!("heygen:v_bad1", { fetchImpl: stub(() => jsonRes({ data: { status: "failed", failure_code: "content_policy_violation" } })).fetchImpl });
  assert.ok(policy.state === "failed" && policy.safety);
  assert.ok(!logs.some((l) => l.level === "error"));
  // Completion records HeyGen's own length (calibration of the priced pace, review MINOR 4).
  await a.poll!("heygen:v_ok1", { fetchImpl: stub(() => jsonRes({ data: { status: "completed", video_url: "https://files.heygen.ai/v.mp4", duration: 4.237 } })).fetchImpl });
  assert.deepEqual(logs.find((l) => /clip completed/.test(l.msg))?.fields, { op: "heygen:v_ok1", duration: 4.24 }, "MUTATSIYA: duration not recorded");
});

test("review MINOR 4: digits / symbols weighted as spoken; links / e-mails refused; one formula for price and refusal", () => {
  assert.equal(avatarSpokenChars("abc"), 3);
  assert.equal(avatarSpokenChars("2026"), 4 * HEYGEN_DIGIT_WEIGHT, "MUTATSIYA: digits counted as 1");
  assert.equal(avatarSpokenChars("50%"), 2 * HEYGEN_DIGIT_WEIGHT + HEYGEN_SYMBOL_WEIGHT);
  assert.equal(avatarSpokenChars("$ + = & € № °"), 7 * HEYGEN_SYMBOL_WEIGHT + 6);
  // «2026-yil 15-noyabr» (18 chars) is spoken as ~50 characters: 6 digits × 6 + 12 others = 48 → 4 s, not 2 s.
  assert.equal(avatarScriptSeconds("2026-yil 15-noyabr"), Math.ceil((6 * HEYGEN_DIGIT_WEIGHT + 12) / 12));
  assert.equal(studioVideoPrice({ modelId: HEYGEN_MODEL, ...withAvatarSeconds({ prompt: "Narx 50%" }, null) }, PRICING), up100(0.0805 * Math.ceil((5 + 2 * 6 + 8) / 12) * RATE * 2));
  for (const bad of ["Saytimiz: https://slaydx.uz/kurs", "Batafsil: www.slaydx.uz", "Yozing: info@slaydx.uz"]) {
    assert.match(String(avatarScriptProblem(bad)), /havola yoki e-pochta/, bad);
    assert.equal(studioVideoError({ modelId: HEYGEN_MODEL, prompt: bad }), avatarScriptProblem(bad), "the preflight is the same function");
  }
  const digits = "1".repeat(200); // 200 raw characters, 1 200 spoken: past a minute
  assert.match(String(avatarScriptProblem(digits)), /1 daqiqaga sig‘maydi/);
  assert.equal(studioVideoError({ modelId: HEYGEN_MODEL, prompt: digits }), avatarScriptProblem(digits));
  assert.equal(avatarScriptProblem(SCRIPT), null);
  assert.equal(avatarScriptProblem("x".repeat(HEYGEN_SCRIPT_MAX)), null, "the plain maximum still fits");
});

test("review MINOR 3: «Solishtirish» (video) never offers the avatar (computed length, script prompt)", () => {
  const view = MEDIA_CATALOG.clientView();
  const ids = compareModels("video", view.filter((e) => MEDIA_PURPOSES.byId(STUDIO_VIDEO_PURPOSE)!.allowed.includes(e.id))).map((e) => e.id);
  assert.ok(!ids.includes(HEYGEN_MODEL), "MUTATSIYA: the avatar in compare");
  assert.ok(ids.includes("google/omni-video") && ids.includes("openai/sora-2") && !ids.includes("kling/effects"));
});
