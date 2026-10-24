import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { makeOmniAdapter, buildOmniRequest, omniDownloadUrl, OMNI_MODEL } from "../lib/generation/video/omni.ts";
import { makeKlingAdapter, buildKlingRequest, parseKlingKey, signKlingJwt, KLING_MODEL } from "../lib/generation/video/kling.ts";
import { VIDEO_SAFETY_MESSAGE, VideoProviderError, looksLikeSafetyRefusal, scrubSecrets } from "../lib/generation/video/types.ts";
import { isMp4, mp4Seconds } from "../lib/generation/video/mp4.ts";
import { setSafeFetchLookup } from "../lib/generation/safe-fetch.ts";
import { isUserSafeText } from "../lib/server/user-error.ts";
import { fakeMp4 } from "./helpers/fake-mp4.mts";

/**
 * VIDEO PROVIDER ADAPTERS -- request shapes, response parsing, safety refusals, secrets, downloads. Stubbed `fetch`:
 * no network, no paid call.
 *
 * Mutations (each turned a test red, then restored):
 *   1. Omni `background: true` dropped from the body                          -> «Omni request shape»;
 *   2. the Gemini key sent to a non-Google download host                      -> «Omni download sends the key only to Google»;
 *   3. a `completed` interaction without a video part treated as «running»    -> «Omni poll: completed without a video is a refusal»;
 *   4. `scrubSecrets` made a no-op                                            -> «secrets never reach an error message»;
 *   5. Kling JWT signed with the access key instead of the secret             -> «Kling JWT is HS256 over the secret»;
 *   6. Kling `code !== 0` ignored                                              -> «Kling: a non-zero code is an error, 1301 is a safety refusal».
 */

setSafeFetchLookup(async () => ["93.184.216.34"]);

const GKEY = "AIzaSyTESTKEY0123456789abcdefghij";
const KKEY = "AKtestaccess:SKtestsecretvalue";

type Seen = { url: string; init: RequestInit };
function stub(respond: (n: number, url: string) => Response): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return respond(seen.length, String(input));
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const mp4Res = (seconds = 5) => new Response(Buffer.from(fakeMp4(seconds)), { status: 200, headers: { "content-type": "video/mp4" } });

/* ══════════════════════════ mp4 ══════════════════════════ */

test("mp4: ftyp sniffing and the length from moov/mvhd", () => {
  assert.equal(isMp4(fakeMp4(5)), true);
  assert.equal(isMp4(new TextEncoder().encode("<html>not a video at all, just an error page</html>")), false);
  assert.equal(isMp4(new Uint8Array(4)), false);
  assert.equal(mp4Seconds(fakeMp4(5)), 5);
  assert.equal(mp4Seconds(fakeMp4(7.5)), 7.5);
  assert.equal(mp4Seconds(new Uint8Array(64)), 0, "no moov box: 0, never a guess");
});

/* ══════════════════════════ Omni (veo) ══════════════════════════ */

test("Omni request shape: Interactions API, gemini-omni-1.1-flash, background, video response_format; the key is not in the request", async () => {
  const req = buildOmniRequest({ prompt: "Registon at dawn", seconds: 8, aspect: "9:16" });
  assert.equal(req.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(req.body.model, OMNI_MODEL);
  assert.equal(OMNI_MODEL, "gemini-omni-1.1-flash");
  assert.equal(req.body.background, true, "MUTATSIYA: background:true olib tashlansa qizaradi");
  assert.deepEqual(req.body.response_format, { type: "video", aspect_ratio: "9:16", resolution: "720p", delivery: "uri" });
  assert.match(String(req.body.input), /Registon at dawn/);
  assert.match(String(req.body.input), /about 8 seconds/);
  assert.ok(!JSON.stringify(req).includes(GKEY));

  const withImage = buildOmniRequest({ prompt: "Animate", seconds: 5, aspect: "16:9", image: { mime: "image/jpeg", base64: "QUJD" } });
  const input = withImage.body.input as { type: string; data?: string; mime_type?: string; text?: string }[];
  assert.deepEqual(input[0], { type: "image", data: "QUJD", mime_type: "image/jpeg" });
  assert.equal(input[1]!.type, "text");
  assert.deepEqual(withImage.body.generation_config, { video_config: { task: "image_to_video" } });
});

test("Omni submit: POST with x-goog-api-key, returns the interaction id; the body carries no key", async () => {
  const { fetchImpl, seen } = stub(() => jsonRes({ id: "int_123", status: "in_progress" }));
  const a = makeOmniAdapter({ key: () => GKEY });
  const out = await a.submit({ prompt: "A cat", seconds: 5, aspect: "16:9" }, { fetchImpl });
  assert.deepEqual(out, { opId: "int_123" });
  const headers = seen[0]!.init.headers as Record<string, string>;
  assert.equal(headers["x-goog-api-key"], GKEY);
  assert.equal(seen[0]!.init.method, "POST");
  assert.ok(!String(seen[0]!.init.body).includes(GKEY));
});

test("Omni errors: 429 / 5xx retryable, 400 policy text = safety, secrets scrubbed", async () => {
  const a = makeOmniAdapter({ key: () => GKEY });
  const run = async (status: number, body: unknown) => {
    const { fetchImpl } = stub(() => jsonRes(body, status));
    return a.submit({ prompt: "A cat", seconds: 5, aspect: "16:9" }, { fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  };
  const rate = await run(429, { error: { message: "quota" } });
  assert.ok(rate instanceof VideoProviderError && rate.retryable && !rate.safety);
  const boom = await run(503, { error: { message: "down" } });
  assert.ok(boom instanceof VideoProviderError && boom.retryable);
  const policy = await run(400, { error: { message: "The prompt was blocked: it violates our safety policy" } });
  assert.ok(policy instanceof VideoProviderError && policy.safety && !policy.retryable);
  const auth = await run(403, { error: { message: `API key ${GKEY} is invalid` } });
  assert.ok(auth instanceof VideoProviderError && !auth.retryable);
  assert.ok(!auth.message.includes(GKEY), "secrets never reach an error message");
});

test("Omni poll: in_progress is running; completed gives the video (inline or uri); failed is classified", async () => {
  const a = makeOmniAdapter({ key: () => GKEY });
  const poll = async (body: unknown) => {
    const { fetchImpl, seen } = stub(() => jsonRes(body));
    const r = await a.poll("int_123", { fetchImpl });
    assert.equal(seen[0]!.url, "https://generativelanguage.googleapis.com/v1beta/interactions/int_123");
    assert.equal(seen[0]!.init.method, "GET");
    return r;
  };
  assert.deepEqual(await poll({ id: "int_123", status: "in_progress" }), { state: "running" });

  const inline = await poll({ status: "completed", steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: Buffer.from("hi").toString("base64") }] }] });
  assert.equal(inline.state, "done");
  assert.ok(inline.state === "done" && inline.media.kind === "inline");

  const uri = await poll({ status: "completed", steps: [{ content: [{ type: "video", uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123" }] }] });
  assert.ok(uri.state === "done" && uri.media.kind === "url" && uri.media.url.endsWith("/files/abc123:download?alt=media"));
  assert.equal(omniDownloadUrl("https://x.googleapis.com/v1beta/files/a:download?alt=media"), "https://x.googleapis.com/v1beta/files/a:download?alt=media");

  const refused = await poll({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "I can't create that." }] }] });
  assert.deepEqual(refused, { state: "failed", message: VIDEO_SAFETY_MESSAGE, safety: true }, "MUTATSIYA: videosiz 'completed' running deb olinsa qizaradi");

  const blocked = await poll({ status: "failed", errors: [{ code: "x", message: "Request blocked by safety filters" }] });
  assert.ok(blocked.state === "failed" && blocked.safety && blocked.message === VIDEO_SAFETY_MESSAGE);
  const plain = await poll({ status: "failed", errors: [{ message: "internal error" }] });
  assert.ok(plain.state === "failed" && !plain.safety);
  assert.equal((await poll({ status: "some_new_status" })).state, "running", "an unknown status keeps waiting (the deadline bounds it)");
  assert.ok(isUserSafeText(VIDEO_SAFETY_MESSAGE), "the safety text passes the user-facing filter as it is");
});

test("Omni download sends the key only to Google; a non-MP4 body is a retryable error; 404 (file not ACTIVE yet) too", async () => {
  const a = makeOmniAdapter({ key: () => GKEY });
  const google = stub(() => mp4Res());
  const bytes = await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" }, { fetchImpl: google.fetchImpl });
  assert.ok(isMp4(bytes));
  assert.equal((google.seen[0]!.init.headers as Record<string, string>)["x-goog-api-key"], GKEY);

  const other = stub(() => mp4Res());
  await a.download({ kind: "url", url: "https://evil.example.com/v.mp4" }, { fetchImpl: other.fetchImpl });
  assert.deepEqual(other.seen[0]!.init.headers, {}, "MUTATSIYA: kalit begona xostga ketsa qizaradi");

  const html = stub(() => new Response("<html>login</html>", { status: 200 }));
  const e1 = await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media" }, { fetchImpl: html.fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  assert.ok(e1 instanceof VideoProviderError && e1.retryable);
  const nf = stub(() => new Response("nope", { status: 404 }));
  const e2 = await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media" }, { fetchImpl: nf.fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  assert.ok(e2 instanceof VideoProviderError && e2.retryable && e2.status === 404);
  const inline = await a.download({ kind: "inline", bytes: fakeMp4(5) });
  assert.ok(isMp4(inline));
  await assert.rejects(a.download({ kind: "inline", bytes: new Uint8Array([1, 2, 3]) }), VideoProviderError);
});

test("Omni download: the key is never sent across a redirect to a foreign host; a Google -> Google hop keeps it", async () => {
  const a = makeOmniAdapter({ key: () => GKEY });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  const keyOf = (seen: Seen[], i: number) => (seen[i]!.init.headers as Record<string, string>)["x-goog-api-key"];

  const foreign = stub((n) => (n === 1 ? redirect("https://cdn.evil.example.com/v.mp4") : mp4Res()));
  await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" }, { fetchImpl: foreign.fetchImpl });
  assert.equal(foreign.seen.length, 2, "the redirect was followed");
  assert.equal(keyOf(foreign.seen, 0), GKEY, "the first hop (Google) carries the key");
  assert.equal(keyOf(foreign.seen, 1), undefined, "MUTATSIYA: kalit redirect orqali begona xostga ketsa qizaradi");

  const google = stub((n) => (n === 1 ? redirect("https://storage.googleapis.com/dl/v.mp4") : mp4Res()));
  await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" }, { fetchImpl: google.fetchImpl });
  assert.equal(keyOf(google.seen, 1), GKEY, "a Google host keeps the key");

  // A hop to a private address / plain http is refused by the safe fetch and never retried; a redirect loop is bounded.
  const toPrivate = stub(() => redirect("http://169.254.169.254/v.mp4"));
  const e1 = await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media" }, { fetchImpl: toPrivate.fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  assert.ok(e1 instanceof VideoProviderError && !e1.retryable);
  const loop = stub(() => redirect("https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media"));
  const e2 = await a.download({ kind: "url", url: "https://generativelanguage.googleapis.com/v1beta/files/a:download?alt=media" }, { fetchImpl: loop.fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  assert.ok(e2 instanceof VideoProviderError && !e2.retryable);
  assert.ok(loop.seen.length <= 5, `bounded hops, saw ${loop.seen.length}`);
});

test("Omni without a key: not configured, submit refuses before any request", async () => {
  const { fetchImpl, seen } = stub(() => jsonRes({}));
  const a = makeOmniAdapter({ key: () => "" });
  assert.equal(a.configured(), false);
  await assert.rejects(a.submit({ prompt: "A cat", seconds: 5, aspect: "16:9" }, { fetchImpl }), VideoProviderError);
  assert.equal(seen.length, 0);
});

/* ══════════════════════════ Kling ══════════════════════════ */

test("Kling key: <accessKey>:<secretKey> only", () => {
  assert.deepEqual(parseKlingKey("AK:SK"), { accessKey: "AK", secretKey: "SK" });
  assert.deepEqual(parseKlingKey("AK:S:K"), { accessKey: "AK", secretKey: "S:K" });
  for (const bad of ["", "nocolon", ":SK", "AK:"]) assert.equal(parseKlingKey(bad), null, bad);
  assert.equal(makeKlingAdapter({ key: () => "nocolon" }).configured(), false);
  assert.equal(makeKlingAdapter({ key: () => KKEY }).configured(), true);
});

test("Kling JWT is HS256 over the secret: header, payload {iss, exp = +1800, nbf = -5}, signature", () => {
  const jwt = signKlingJwt("AKtestaccess", "SKtestsecretvalue", 1_000_000);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h!, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(p!, "base64url").toString()), { iss: "AKtestaccess", exp: 1_001_800, nbf: 999_995 });
  assert.equal(s, createHmac("sha256", "SKtestsecretvalue").update(`${h}.${p}`).digest("base64url"), "MUTATSIYA: maxfiy kalit o'rniga access key bilan imzolansa qizaradi");
});

test("Kling request shape: text2video vs image2video, duration as a string, std mode", () => {
  const t = buildKlingRequest({ prompt: "A cat", seconds: 10, aspect: "9:16" });
  assert.equal(t.url, "https://api-singapore.klingai.com/v1/videos/text2video");
  assert.deepEqual(t.body, { model_name: KLING_MODEL, prompt: "A cat", duration: "10", mode: "std", aspect_ratio: "9:16" });
  const i = buildKlingRequest({ prompt: "Animate", seconds: 5, aspect: "16:9", image: { mime: "image/png", base64: "QUJD" } });
  assert.equal(i.url, "https://api-singapore.klingai.com/v1/videos/image2video");
  assert.deepEqual(i.body, { model_name: KLING_MODEL, prompt: "Animate", duration: "5", mode: "std", image: "QUJD" });
});

test("Kling submit / poll: Bearer JWT, the op id carries the kind, statuses map", async () => {
  const a = makeKlingAdapter({ key: () => KKEY });
  const sub = stub(() => jsonRes({ code: 0, message: "SUCCEED", data: { task_id: "tsk_9", task_status: "submitted" } }));
  const out = await a.submit({ prompt: "A cat", seconds: 5, aspect: "16:9" }, { fetchImpl: sub.fetchImpl, now: () => 1_000_000_000 });
  assert.deepEqual(out, { opId: "text2video:tsk_9" });
  const auth = (sub.seen[0]!.init.headers as Record<string, string>).Authorization!;
  assert.match(auth, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.equal(auth.slice(7), signKlingJwt("AKtestaccess", "SKtestsecretvalue", 1_000_000));
  assert.ok(!String(sub.seen[0]!.init.body).includes("SKtestsecretvalue"));

  const img = stub(() => jsonRes({ code: 0, data: { task_id: "tsk_10" } }));
  assert.deepEqual(await a.submit({ prompt: "x animate", seconds: 5, aspect: "16:9", image: { mime: "image/jpeg", base64: "QQ==" } }, { fetchImpl: img.fetchImpl }), { opId: "image2video:tsk_10" });

  const poll = async (data: unknown) => {
    const s = stub(() => jsonRes({ code: 0, data }));
    const r = await a.poll("text2video:tsk_9", { fetchImpl: s.fetchImpl });
    assert.equal(s.seen[0]!.url, "https://api-singapore.klingai.com/v1/videos/text2video/tsk_9");
    return r;
  };
  assert.deepEqual(await poll({ task_status: "processing" }), { state: "running" });
  assert.deepEqual(await poll({ task_status: "submitted" }), { state: "running" });
  const done = await poll({ task_status: "succeed", task_result: { videos: [{ url: "https://cdn.example.com/v.mp4", duration: "5" }] } });
  assert.deepEqual(done, { state: "done", media: { kind: "url", url: "https://cdn.example.com/v.mp4" } });
  const noUrl = await poll({ task_status: "succeed", task_result: { videos: [] } });
  assert.equal(noUrl.state, "failed");
  const failed = await poll({ task_status: "failed", task_status_msg: "Content blocked by safety policy" });
  assert.ok(failed.state === "failed" && failed.safety && failed.message === VIDEO_SAFETY_MESSAGE);
  const failed2 = await poll({ task_status: "failed", task_status_msg: "internal error" });
  assert.ok(failed2.state === "failed" && !failed2.safety);
  await assert.rejects(a.poll("bad-op-id", {}), VideoProviderError);
});

test("Kling: a non-zero code is an error, 1301 is a safety refusal, 429 retryable, secrets scrubbed", async () => {
  const a = makeKlingAdapter({ key: () => KKEY });
  const run = async (status: number, body: unknown) => {
    const { fetchImpl } = stub(() => jsonRes(body, status));
    return a.submit({ prompt: "A cat", seconds: 5, aspect: "16:9" }, { fetchImpl }).then(() => null, (e: unknown) => e as VideoProviderError);
  };
  const policy = await run(200, { code: 1301, message: "trigger content safety policy" });
  assert.ok(policy instanceof VideoProviderError && policy.safety, "MUTATSIYA: code != 0 e'tiborsiz qoldirilsa qizaradi");
  const balance = await run(200, { code: 1102, message: "account balance not enough" });
  assert.ok(balance instanceof VideoProviderError && !balance.safety && !balance.retryable);
  const limited = await run(429, { code: 1303, message: "parallel task over resource pack limit" });
  assert.ok(limited instanceof VideoProviderError && limited.retryable);
  const leak = await run(401, { code: 1000, message: `bad token ${KKEY} / SKtestsecretvalue` });
  assert.ok(leak instanceof VideoProviderError && !leak.message.includes("SKtestsecretvalue") && !leak.message.includes(KKEY));
});

test("Kling download: only a real MP4, size-capped; 5xx retryable", async () => {
  const a = makeKlingAdapter({ key: () => KKEY });
  const ok = stub(() => mp4Res());
  assert.ok(isMp4(await a.download({ kind: "url", url: "https://cdn.example.com/v.mp4" }, { fetchImpl: ok.fetchImpl })));
  assert.equal((ok.seen[0]!.init.headers as Record<string, string> | undefined)?.Authorization, undefined, "no credentials to the CDN");
  const bad = stub(() => new Response("{}", { status: 200 }));
  const e = await a.download({ kind: "url", url: "https://cdn.example.com/v.mp4" }, { fetchImpl: bad.fetchImpl }).then(() => null, (x: unknown) => x as VideoProviderError);
  assert.ok(e instanceof VideoProviderError && e.retryable);
  const down = stub(() => new Response("x", { status: 503 }));
  const e2 = await a.download({ kind: "url", url: "https://cdn.example.com/v.mp4" }, { fetchImpl: down.fetchImpl }).then(() => null, (x: unknown) => x as VideoProviderError);
  assert.ok(e2 instanceof VideoProviderError && e2.retryable);
  // An http:// or private-address URL from the provider is refused by the safe fetch, never retried.
  const priv = await a.download({ kind: "url", url: "http://169.254.169.254/v.mp4" }, { fetchImpl: ok.fetchImpl }).then(() => null, (x: unknown) => x as VideoProviderError);
  assert.ok(priv instanceof VideoProviderError && !priv.retryable);
});

/* ══════════════════════════ helpers ══════════════════════════ */

test("secrets never reach an error message; safety heuristic", () => {
  const out = scrubSecrets(`oops ${GKEY} and Bearer abc.def.ghi and AIza${"x".repeat(30)}`, [GKEY]);
  assert.ok(!out.includes(GKEY) && !out.includes("abc.def.ghi") && !/AIza/.test(out), "MUTATSIYA: scrubSecrets no-op bo'lsa qizaradi");
  assert.equal(looksLikeSafetyRefusal("Blocked by safety filters"), true);
  assert.equal(looksLikeSafetyRefusal("internal error"), false);
});
