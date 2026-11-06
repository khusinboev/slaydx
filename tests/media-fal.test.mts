import "./helpers/next-request.mts";
import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createIsolatedDb } from "./helpers/isolated-db.mts";
import { inRequest } from "./helpers/next-request.mts";

/**
 * Studio P2a — fal.ai models (docs/studio/P2-SPEC.md): the generic fal adapter, the six catalog entries, their prices,
 * availability, the admin probe, and a Studio job end to end through `runMedia` with a stubbed fal.
 *
 * What is proven here:
 *   adapter    queue cycle on fabricated fal answers: submit → IN_QUEUE → IN_PROGRESS → COMPLETED → result (data URI and
 *              downloaded URL), key only in the queue-host header (never in a body, a URL, a download or an error),
 *              status/result URLs on another host ignored, no redirect followed; error mapping: 401/402/403 account,
 *              422 validation, 422 content policy (submit and result), `has_nsfw_concepts`, 429, 5xx, network before an
 *              answer, transient status 5xx, timeout after submit (accepted + cancel), unknown output type, no key;
 *   request    golden body per model × ratio; differential probe: every ParamSchema param of every fal model changes the
 *              request (through the engine's composed prompt for `imageStyle`) or the price, as its `affects` says;
 *   price      goldens per model × count at ×2 and 12 700 so'm/$ (Ideogram per quality), the browser block = server;
 *   available  no key → hidden; key → listed; provider switched off → hidden; model switched off → hidden;
 *   flow       route → claimNext → runJob with a stubbed fal: charge, file, doc.imageModel, `media_jobs` rows with provider
 *              `fal` + the endpoint as upstream, Ideogram «high» charged at its own price, partial refund when one of two
 *              pictures is refused, the refusal message + full refund when all are, the spend recorded on provider `fal`;
 *   admin      «Tekshirish» for fal (price list vs the catalog, balance), `media:fal:*` breakers on the fal card,
 *              viewer label of a fal picture.
 *
 * Mutations (each turned the named test(s) red, then restored) — listed in the P2a report:
 *   adapter    auth header sent to a non-queue status_url -> "adapter: foreign queue URLs"; `redirect: "manual"` dropped
 *              on submit -> "adapter: redirect"; `accepted: true` dropped after submit -> "adapter: timeout after submit",
 *              "adapter: result errors"; 403 treated as retryable -> "adapter: submit errors"; content-policy type check
 *              removed -> "adapter: submit errors", "adapter: result errors"; nsfw flag ignored -> "adapter: result
 *              errors"; scrub() returns the raw text -> "adapter: submit errors" (key echoed); checkOutput skipped ->
 *              "adapter: unknown output type"; cancel PUT removed -> "adapter: timeout after submit";
 *   request    Ideogram `quality` hard-coded "medium" -> "differential probe", "golden bodies"; Seedream sizes swapped to
 *              the 1K presets -> "golden bodies"; flux `aspect_ratio` fixed "1:1" -> "differential probe";
 *   price      Ideogram `by` table removed -> "price goldens", "differential probe", "flow"; Ideogram added to the
 *              live-cost block (skip removed AND a book row `ideogram/v4.5` added) -> "price goldens", "flow"; flux price
 *              0.048 -> 0.03 in the book -> "price goldens", "probe", "flow";
 *   flow       `imageCount` reaching the per-picture values (engine passes it AND `coreAdapterImageProvider` lets it win)
 *              -> "flow" (row cost × N, pictures × N); refusal prefix `moderation_blocked` dropped in `failureOf` ->
 *              "flow: all refused" (generic message), "admin wiring"; recordImageUsd removed -> "flow" (no fal spend part);
 *              key check skipped for fal in availability -> "availability", "flow" (charged without a key);
 *   text       (P2a-2, owner 2026-11-02) no-text clause kept next to the instruction for a text model -> "text prompt",
 *              "flow"; `allowText: true` for every Studio model -> "flow" (flux / seedream / recraft pro lose the ban);
 *              «Rasm» always in text mode -> "«Rasm» keeps the no-text prompt", "flow"; quoted texts not passed ->
 *              "flow"; «…» not parsed -> "text prompt", "flow";
 *   tiers      Seedream Pro 1:1 at 2048² (over the $0.0675 step) / Lite sizes for Pro -> "golden bodies"; Recraft Pro
 *              price 0.21 -> 0.035 -> "price goldens", "flow" (+ ui/studio-fal, studio-admin-media); Seedream Pro price
 *              -> "price goldens"; Recraft Pro routed to the standard endpoint -> "price goldens", "probe", "flow";
 *   review     (MINOR-4) last look disabled (`lastLook` always false) -> "final window"; (NIT-1) the size-cap check removed
 *              (body read and parsed whatever its size) -> "JSON cap"; (NIT-2) inner `"` kept in textInstruction -> "text prompt";
 *   admin      `media:` branch removed from providerOfBreaker -> "admin wiring"; falMessage diff check removed ->
 *              "probe"; imageModelLabel catalog fallback removed -> "admin wiring" (viewer says nothing).
 */

process.env.SESSION_SECRET = "test-session-secret-at-least-32-characters";
process.env.WORKER_INLINE = "false";
process.env.GEMINI_API_KEY = "test-gemini-key";
delete process.env.OPENAI_API_KEY;
delete process.env.FAL_KEY;

const hasDb = Boolean(process.env.DATABASE_URL) && !process.env.DATABASE_URL!.includes("unused");
const iso = hasDb ? await createIsolatedDb("mediafal") : { isolated: false, drop: async () => {} };
const skipDb = hasDb && iso.isolated ? false : "isolated Postgres database is not available";

const { falAdapter, FAL_MODELS, SEEDREAM_SIZES, SEEDREAM_PRO_SIZES, IDEOGRAM_SIZES, RECRAFT_SIZES, scrub } = await import("../lib/media/adapters/fal.ts");
const { MEDIA_CATALOG, MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE, FAL_IMAGE_MODELS, imageModelLabel } = await import("../lib/media/catalog.ts");
const { studioImagePrice, studioEntryPrice } = await import("../lib/media/studio-pricing.ts");
const { MediaError, normalize, costUsd, resetBreakers } = await import("../lib/studio-core/index.ts");
const { IMAGE_PRICES, FAL_IDEOGRAM_QUALITY_USD } = await import("../lib/generation/llm-pricing.ts");
const { IMAGE_RATIOS, IMAGE_STYLES } = await import("../lib/generation/image-studio-options.ts");
const { composePrompt, quotedTexts, textInstruction, NO_TEXT_CLAUSE } = await import("../lib/generation/image-studio.ts");
const { failureOf } = await import("../lib/media/image.ts");
const resolve = await import("../lib/server/providers/resolve.ts");
const { modelAvailable } = await import("../lib/server/media/availability.ts");
const { liveUnitCosts } = await import("../lib/server/media/pricing.ts");
const probe = await import("../lib/server/providers/probe.ts");
const { providerOfBreaker } = await import("../lib/server/admin-providers.ts");

const KEY = "fal0000-test-key:5ecr3t5ecr3t";
const FLUX = "bfl/flux";
const SEED = "bytedance/seedream";
const SEEDP = "bytedance/seedream-pro";
const IDEO = "ideogram/ideogram";
const RECR = "recraft/recraft";
const RECP = "recraft/recraft-pro";
const FAL_IDS = [FLUX, SEED, SEEDP, IDEO, RECR, RECP];
/** Studio P11 package F: hidden until the admin's switch, so the availability checks below stay on the six (own checks: studio-media-providers). */
const MUSE = "meta/muse";
const KLEIN = "bfl/flux-klein";
const ENDPOINT: Record<string, string> = {
  [FLUX]: "blackforestlabs/flux-3/text-to-image",
  [SEED]: "bytedance/seedream/v5/lite/text-to-image",
  [IDEO]: "ideogram/v4.5",
  [RECR]: "fal-ai/recraft/v4.1/text-to-image",
  [SEEDP]: "bytedance/seedream/v5/pro/text-to-image",
  [RECP]: "fal-ai/recraft/v4.1/pro/text-to-image",
  [MUSE]: "meta/muse-image/text-to-image",
  [KLEIN]: "blackforestlabs/flux-3/klein/text-to-image",
};

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(3000, 7)]);
const B64 = JPEG.toString("base64");
const DATA_URI = `data:image/jpeg;base64,${B64}`;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown; redirect?: string };
/** A fake fal: `handler` answers each call; every call is recorded (url, method, headers, parsed body). */
function fakeFal(handler: (c: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (u: string | URL, init: RequestInit = {}) => {
    const c: Call = {
      url: String(u),
      method: String(init.method ?? "GET"),
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      redirect: init.redirect,
    };
    calls.push(c);
    return handler(c, calls.length - 1);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const SUB = (id = "req-0001-abcd") => ({
  request_id: id,
  status_url: `https://queue.fal.run/blackforestlabs/flux-3/requests/${id}/status`,
  response_url: `https://queue.fal.run/blackforestlabs/flux-3/requests/${id}`,
  cancel_url: `https://queue.fal.run/blackforestlabs/flux-3/requests/${id}/cancel`,
});
const isSubmit = (c: Call) => c.method === "POST" && c.url.startsWith("https://queue.fal.run/");
const isStatus = (c: Call) => c.method === "GET" && c.url.endsWith("/status");
const isResult = (c: Call) => c.method === "GET" && /\/requests\/[^/]+$/.test(c.url);

const adapter = (o: Parameters<typeof falAdapter>[0] = {}) => falAdapter({ key: () => KEY, sleep: async () => {}, lookup: async () => ["93.184.216.34"], ...o });
const input = (upstreamModel = ENDPOINT[FLUX]!, params: Record<string, unknown> = {}) => ({
  upstreamModel,
  params: { ...normalize(MEDIA_CATALOG.byId(FLUX)!.params, { prompt: "Registon at dawn", imageRatio: "16:9" }), ...params } as never,
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
const flags = (e: InstanceType<typeof MediaError>) => ({ retryable: e.retryable, safety: e.safety, accepted: e.accepted, status: e.status });

/* ───────────────────────────── adapter: the happy cycle ───────────────────────────── */

test("adapter: submit → IN_QUEUE → IN_PROGRESS → COMPLETED → result; key only in queue-host headers", async () => {
  const states = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
  let polls = 0;
  const fal = fakeFal((c) => {
    if (isSubmit(c)) return json(200, SUB());
    if (isStatus(c)) return json(202, { status: states[Math.min(polls++, 2)], queue_position: 0 });
    if (isResult(c)) return json(200, { images: [{ url: DATA_URI, content_type: "image/jpeg" }], seed: 1 });
    return json(404, {});
  });
  const t0 = 1_000_000;
  const out = await adapter().submit(input(), { fetchImpl: fal.fetchImpl, now: () => t0, deadline: t0 + 60_000 });
  assert.ok("done" in out);
  assert.equal(out.done.length, 1);
  assert.deepEqual(out.done[0], { kind: "inline", bytes: new Uint8Array(JPEG), mime: "image/jpeg" });
  assert.deepEqual(fal.calls.map((c) => `${c.method} ${c.url}`), [
    "POST https://queue.fal.run/blackforestlabs/flux-3/text-to-image",
    "GET https://queue.fal.run/blackforestlabs/flux-3/requests/req-0001-abcd/status",
    "GET https://queue.fal.run/blackforestlabs/flux-3/requests/req-0001-abcd/status",
    "GET https://queue.fal.run/blackforestlabs/flux-3/requests/req-0001-abcd/status",
    "GET https://queue.fal.run/blackforestlabs/flux-3/requests/req-0001-abcd",
  ]);
  for (const c of fal.calls) {
    assert.equal(c.headers.Authorization, `Key ${KEY}`);
    assert.ok(!c.url.includes(KEY));
    assert.equal(c.redirect, "manual", `${c.method} ${c.url}: a redirect is never followed with the key`);
  }
  assert.equal(fal.calls[0]!.headers["X-Fal-Request-Start-Timeout"], "60", "fal drops the job if it cannot start before our deadline");
  assert.ok(!JSON.stringify(fal.calls[0]!.body).includes(KEY), "no key in the body");
  assert.deepEqual(fal.calls[0]!.body, FAL_MODELS[ENDPOINT[FLUX]!]!.body(input().params));
});

test("adapter: a URL output is downloaded WITHOUT the key; status/result URLs on another host are ignored", async () => {
  const fal = fakeFal((c) => {
    if (isSubmit(c))
      return json(200, { request_id: "req-0002-abcd", status_url: "https://evil.example/requests/req-0002-abcd/status", response_url: "http://queue.fal.run/x", cancel_url: "https://evil.example/c" });
    if (c.url === "https://v3b.fal.media/files/a.jpg") return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
    if (isStatus(c)) return json(200, { status: "COMPLETED" });
    if (isResult(c)) return json(200, { images: [{ url: "https://v3b.fal.media/files/a.jpg" }] });
    return json(404, {});
  });
  const out = await adapter().submit(input(), { fetchImpl: fal.fetchImpl });
  assert.ok("done" in out && out.done[0]!.kind === "inline");
  assert.ok(!fal.calls.some((c) => c.url.includes("evil.example") || c.url.startsWith("http:")), "the key never goes to a host fal did not own");
  assert.equal(fal.calls[1]!.url, "https://queue.fal.run/blackforestlabs/flux-3/requests/req-0002-abcd/status", "rebuilt from owner/app");
  assert.equal(fal.calls[2]!.url, "https://queue.fal.run/blackforestlabs/flux-3/requests/req-0002-abcd");
  const dl = fal.calls.find((c) => c.url.includes("fal.media"))!;
  assert.equal(dl.headers.Authorization, undefined, "the download carries no key");
});

test("adapter: a redirect is never followed (submit, status, result)", async () => {
  const at = { submit: 0, status: 0, result: 0 };
  for (const where of ["submit", "status", "result"] as const) {
    const fal = fakeFal((c) => {
      const redirect = () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
      if (isSubmit(c)) return where === "submit" ? redirect() : json(200, SUB());
      if (isStatus(c)) return where === "status" ? redirect() : json(200, { status: "COMPLETED" });
      if (isResult(c)) return where === "result" ? redirect() : json(200, { images: [{ url: DATA_URI }] });
      return json(404, {});
    });
    const e = await err(adapter().submit(input(), { fetchImpl: fal.fetchImpl }));
    assert.match(e.message, /redirect rad etildi/, where);
    assert.equal(e.retryable, false, where);
    assert.equal(e.accepted, where !== "submit", `${where}: accepted once a request id exists`);
    assert.ok(!fal.calls.some((c) => c.url.includes("evil.example")), where);
    at[where] = fal.calls.length;
  }
  assert.deepEqual(at, { submit: 1, status: 2, result: 3 });
});

/* ───────────────────────────── adapter: failures ───────────────────────────── */

test("adapter: submit errors map to retryable / safety / account flags, never echo the key", async () => {
  const cases: [string, Response | (() => never), ReturnType<typeof flags>, RegExp][] = [
    ["401 bad key", json(401, { detail: `Invalid key Key ${KEY}` }), { retryable: false, safety: false, accepted: false, status: 401 }, /401/],
    ["402 balance", json(402, { detail: "Insufficient balance" }), { retryable: false, safety: false, accepted: false, status: 402 }, /402 Insufficient/],
    ["403 locked", json(403, { detail: `User is locked. Reason: Exhausted balance. ${KEY}` }), { retryable: false, safety: false, accepted: false, status: 403 }, /Exhausted balance/],
    ["422 validation", json(422, { detail: [{ loc: ["body", "image_size"], msg: "invalid size", type: "value_error" }] }), { retryable: false, safety: false, accepted: false, status: 422 }, /invalid size/],
    ["422 content policy", json(422, { detail: [{ loc: ["body", "prompt"], msg: "flagged", type: "content_policy_violation" }] }), { retryable: false, safety: true, accepted: false, status: 422 }, /flagged/],
    ["429 rate", json(429, { detail: "Too many requests" }), { retryable: true, safety: false, accepted: false, status: 429 }, /429/],
    ["500 server", json(500, { detail: "internal_error", error_type: "internal_error" }), { retryable: true, safety: false, accepted: false, status: 500 }, /500/],
    ["503 runner", json(503, { detail: "runner_scheduling_failure" }), { retryable: true, safety: false, accepted: false, status: 503 }, /503/],
  ];
  for (const [name, res, want, msg] of cases) {
    const fal = fakeFal(() => res as Response);
    const e = await err(adapter().submit(input(), { fetchImpl: fal.fetchImpl }));
    assert.deepEqual(flags(e), want, name);
    assert.match(e.message, msg, name);
    assert.ok(!e.message.includes(KEY) && !e.message.includes("5ecr3t"), `${name}: key scrubbed`);
    assert.equal(fal.calls.length, 1, `${name}: nothing after a refused submit`);
  }
  // No answer at all: the request may have started a paid job — accepted, so the router never sends it elsewhere.
  const down = fakeFal(() => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(flags(await err(adapter().submit(input(), { fetchImpl: down.fetchImpl }))), { retryable: true, safety: false, accepted: true, status: undefined });
  // 200 without a request id.
  const odd = fakeFal(() => json(200, { request_id: "../../x" }));
  assert.equal((await err(adapter().submit(input(), { fetchImpl: odd.fetchImpl }))).accepted, true);
  assert.equal(scrub(`Authorization: Key ${KEY} and ${KEY}`, KEY).includes("5ecr3t"), false);
});

test("adapter: result errors after acceptance — content policy, nsfw flag, validation, empty, transient status", async () => {
  const run = (result: () => Response, status?: (n: number) => Response) => {
    let n = 0;
    const fal = fakeFal((c) => {
      if (isSubmit(c)) return json(200, SUB());
      if (isStatus(c)) return status ? status(n++) : json(200, { status: "COMPLETED" });
      if (isResult(c)) return result();
      return json(404, {});
    });
    return { fal, p: adapter().submit(input(), { fetchImpl: fal.fetchImpl }) };
  };
  const policy = await err(run(() => json(422, { detail: [{ msg: "image flagged", type: "content_policy_violation", categories: ["violence"] }] })).p);
  assert.deepEqual(flags(policy), { retryable: false, safety: true, accepted: true, status: 422 });
  const nsfw = await err(run(() => json(200, { images: [{ url: DATA_URI }], has_nsfw_concepts: [true] })).p);
  assert.deepEqual(flags(nsfw), { retryable: false, safety: true, accepted: true, status: undefined });
  const bad = await err(run(() => json(422, { detail: [{ msg: "bad", type: "value_error" }] })).p);
  assert.deepEqual(flags(bad), { retryable: false, safety: false, accepted: true, status: 422 });
  const empty = await err(run(() => json(200, { images: [] })).p);
  assert.equal(empty.accepted, true);
  assert.match(empty.message, /javobda rasm yo'q/);
  const failed = await err(run(() => json(500, { detail: "runner_server_error" })).p);
  assert.deepEqual(flags(failed), { retryable: true, safety: false, accepted: true, status: 500 });
  // Status 5xx twice, then done: transient errors of a running job are polled through.
  const flaky = run(() => json(200, { images: [{ url: DATA_URI }] }), (n) => (n < 2 ? json(503, { detail: "busy" }) : json(200, { status: "COMPLETED" })));
  const ok = await flaky.p;
  assert.ok("done" in ok && ok.done.length === 1);
  // A status 404 (job gone) is final and accepted.
  const gone = await err(run(() => json(200, {}), () => json(404, { detail: "not found" })).p);
  assert.deepEqual(flags(gone), { retryable: false, safety: false, accepted: true, status: 404 });
});

test("adapter: timeout after submit is accepted + retryable and cancels the queued job", async () => {
  let clock = 5_000_000;
  const fal = fakeFal((c) => {
    if (isSubmit(c)) return json(200, SUB());
    if (isStatus(c)) {
      clock += 10_000;
      return json(200, { status: "IN_PROGRESS" });
    }
    if (c.method === "PUT") return json(202, { status: "CANCELLATION_REQUESTED" });
    return json(404, {});
  });
  const e = await err(adapter().submit(input(), { fetchImpl: fal.fetchImpl, now: () => clock, deadline: clock + 30_000 }));
  assert.deepEqual(flags(e), { retryable: true, safety: false, accepted: true, status: undefined });
  assert.match(e.message, /vaqt tugadi/);
  const cancel = fal.calls.at(-1)!;
  assert.equal(`${cancel.method} ${cancel.url}`, "PUT https://queue.fal.run/blackforestlabs/flux-3/requests/req-0001-abcd/cancel");
  assert.equal(fal.calls.filter(isStatus).length, 3);
  // Under 2 s left: nothing is sent at all (not accepted).
  const none = fakeFal(() => json(200, SUB()));
  const early = await err(adapter().submit(input(), { fetchImpl: none.fetchImpl, now: () => 0, deadline: 1_500 }));
  assert.deepEqual(flags(early), { retryable: true, safety: false, accepted: false, status: undefined });
  assert.equal(none.calls.length, 0);
});

test("adapter: a job that completes in the final window is fetched, not cancelled (review MINOR-4)", async () => {
  // Status every 10 s of clock; the deadline leaves 3 s after the 3rd poll — inside the final window.
  const run = async (last: "COMPLETED" | "IN_PROGRESS") => {
    let clock = 7_000_000;
    let polls = 0;
    const fal = fakeFal((c) => {
      if (isSubmit(c)) return json(200, SUB());
      if (isStatus(c)) {
        polls++;
        if (polls <= 3) {
          clock += 10_000;
          return json(200, { status: "IN_PROGRESS" });
        }
        clock += 200;
        return json(200, { status: last });
      }
      if (isResult(c)) return json(200, { images: [{ url: DATA_URI }] });
      if (c.method === "PUT") return json(202, { status: "CANCELLATION_REQUESTED" });
      return json(404, {});
    });
    const p = adapter().submit(input(), { fetchImpl: fal.fetchImpl, now: () => clock, deadline: clock + 33_000 });
    return { fal, p };
  };
  const done = await run("COMPLETED");
  const out = await done.p;
  assert.ok("done" in out && out.done.length === 1, "the picture fal finished (and bills) is delivered");
  assert.equal(done.fal.calls.filter(isStatus).length, 4, "one last look in the final window");
  assert.ok(!done.fal.calls.some((c) => c.method === "PUT"), "no cancel for a completed job");
  // Still running at the last look: cancelled and refunded as before.
  const late = await run("IN_PROGRESS");
  const e = await err(late.p);
  assert.deepEqual(flags(e), { retryable: true, safety: false, accepted: true, status: undefined });
  assert.equal(late.fal.calls.filter(isStatus).length, 4);
  assert.equal(late.fal.calls.at(-1)!.method, "PUT");
});

test("adapter: an answer over the JSON cap is refused whole, never cut and parsed (review NIT-1)", async () => {
  const { FAL_JSON_MAX_CHARS } = await import("../lib/media/adapters/fal.ts");
  assert.equal(FAL_JSON_MAX_CHARS, 64 * 1024 * 1024);
  // Declared over the cap on the result: accepted (the job exists) with a clear reason.
  const big = fakeFal((c) =>
    isSubmit(c) ? json(200, SUB()) : isStatus(c) ? json(200, { status: "COMPLETED" }) : new Response("{}", { status: 200, headers: { "content-length": String(FAL_JSON_MAX_CHARS + 1) } }),
  );
  const e = await err(adapter().submit(input(), { fetchImpl: big.fetchImpl }));
  assert.match(e.message, /result: javob juda katta/);
  assert.equal(e.accepted, true);
  // On a refused submit: not accepted.
  const sub = fakeFal(() => new Response("{}", { status: 500, headers: { "content-length": String(FAL_JSON_MAX_CHARS + 10) } }));
  const s = await err(adapter().submit(input(), { fetchImpl: sub.fetchImpl }));
  assert.match(s.message, /submit: javob juda katta/);
  assert.equal(s.accepted, false);
});

test("adapter: unknown output type, no key, unknown model", async () => {
  const fal = fakeFal((c) => (isSubmit(c) ? json(200, SUB()) : isStatus(c) ? json(200, { status: "COMPLETED" }) : json(200, { images: [{ url: `data:image/jpeg;base64,${Buffer.from("<html>not an image at all</html>").toString("base64")}` }] })));
  const e = await err(adapter().submit(input(), { fetchImpl: fal.fetchImpl }));
  assert.match(e.message, /unexpected output type/);
  assert.equal(e.accepted, true);
  const noKey = adapter({ key: () => null });
  assert.equal(noKey.configured(), false);
  const none = fakeFal(() => json(200, SUB()));
  assert.match((await err(noKey.submit(input(), { fetchImpl: none.fetchImpl }))).message, /FAL_KEY yo'q/);
  assert.equal(none.calls.length, 0);
  assert.throws(() => adapter().buildRequest!(input("fal-ai/unknown")), MediaError);
});

/* ───────────────────────────── request bodies ───────────────────────────── */

test("golden bodies: each model × ratio (sizes from the models' own schemas)", () => {
  const body = (id: string, values: Record<string, unknown>) => FAL_MODELS[ENDPOINT[id]!]!.body(normalize(MEDIA_CATALOG.byId(id)!.params, { prompt: "Registon", ...values }));
  for (const r of IMAGE_RATIOS) {
    assert.deepEqual(body(FLUX, { imageRatio: r.id }), { prompt: "Registon", aspect_ratio: r.id, resolution: "1k", output_format: "jpeg", enable_prompt_expansion: false, safety_tolerance: 2, sync_mode: true });
    assert.deepEqual(body(SEED, { imageRatio: r.id }), { prompt: "Registon", image_size: SEEDREAM_SIZES[r.id], num_images: 1, output_format: "jpeg", enable_safety_checker: true, sync_mode: true });
    const s = SEEDREAM_SIZES[r.id];
    assert.ok(s.width * s.height >= 2560 * 1440 && s.width <= 4096 && s.height <= 4096, `seedream ${r.id} within its native range`);
    assert.ok(Math.abs(s.width / s.height - r.w / r.h) < 0.02, `seedream ${r.id} keeps the ratio`);
    assert.deepEqual(body(IDEO, { imageRatio: r.id }), { prompt: "Registon", image_size: IDEOGRAM_SIZES[r.id], quality: "medium", num_images: 1, enable_prompt_expansion: false, enable_safety_checker: true, sync_mode: true });
    assert.deepEqual(body(RECR, { imageRatio: r.id }), { prompt: "Registon", image_size: RECRAFT_SIZES[r.id], enable_safety_checker: true });
    assert.deepEqual(body(SEEDP, { imageRatio: r.id }), { prompt: "Registon", image_size: SEEDREAM_PRO_SIZES[r.id], num_images: 1, output_format: "jpeg", enhance_prompt_mode: "standard", enable_safety_checker: true, sync_mode: true });
    const sp = SEEDREAM_PRO_SIZES[r.id];
    // Pro's price step: $0.0675 up to 1536 × 1536 of area, $0.135 above; its schema floor is 921 600 pixels.
    assert.ok(sp.width * sp.height <= 1536 * 1536 && sp.width * sp.height >= 921_600, `seedream pro ${r.id} stays in the $0.0675 tier`);
    assert.ok(Math.abs(sp.width / sp.height - r.w / r.h) < 0.02, `seedream pro ${r.id} keeps the ratio`);
    assert.deepEqual(body(RECP, { imageRatio: r.id }), { prompt: "Registon", image_size: RECRAFT_SIZES[r.id], enable_safety_checker: true });
  }
  // The 36 exact sizes Ideogram V4.5 accepts (its schema, 2026-11-02) contain our six.
  const IDEOGRAM_OK = new Set(["1024x1024", "1280x720", "720x1280", "1152x864", "864x1152", "1248x832"]);
  for (const s of Object.values(IDEOGRAM_SIZES)) assert.ok(IDEOGRAM_OK.has(`${s.width}x${s.height}`));
  assert.equal(body(IDEO, { quality: "high" }).quality, "high");
});

test("differential probe: every param of every fal model changes the request or the price (as `affects` says)", () => {
  const pricing = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {} };
  // What reaches fal for these form values: the engine composes the prompt (style suffix, frame) and the adapter builds the body.
  const request = (id: string, v: Record<string, unknown>) => {
    const e = MEDIA_CATALOG.byId(id)!;
    const p = normalize(e.params, v);
    const ratio = IMAGE_RATIOS.find((r) => r.id === p.imageRatio)!;
    return JSON.stringify(FAL_MODELS[e.routes[0]!.upstreamModel]!.body({ ...p, prompt: composePrompt(String(p.prompt), String(p.imageStyle), ratio.w, ratio.h) }));
  };
  const base = { prompt: "Registon maydoni", imageRatio: "1:1", imageCount: 1, imageStyle: "photo", quality: "medium" };
  const ALT: Record<string, unknown> = { prompt: "Samarqand bozori", imageRatio: "16:9", imageCount: 3, imageStyle: "watercolor", quality: "high" };
  for (const id of FAL_IDS) {
    const e = MEDIA_CATALOG.byId(id)!;
    for (const p of e.params) {
      assert.ok(p.name in ALT, `${id}: no probe value for ${p.name}`);
      const v2 = { ...base, [p.name]: ALT[p.name] };
      const reqChanged = request(id, base) !== request(id, v2);
      const priceChanged = studioEntryPrice(e, { ...base, modelId: id }, pricing) !== studioEntryPrice(e, { ...v2, modelId: id }, pricing);
      if (p.affects === "request" || p.affects === "both") assert.ok(reqChanged, `${id}.${p.name} must change the request`);
      if (p.affects === "price" || p.affects === "both") assert.ok(priceChanged, `${id}.${p.name} must change the price`);
      assert.ok(reqChanged || priceChanged, `${id}.${p.name} is decorative`);
    }
  }
  // The model-specific param is Ideogram's only and sits under «Qo'shimcha sozlamalar».
  assert.deepEqual(MEDIA_CATALOG.byId(IDEO)!.params.map((p) => p.name), ["prompt", "imageRatio", "imageCount", "imageStyle", "quality"]);
  assert.equal(MEDIA_CATALOG.byId(IDEO)!.params.find((p) => p.name === "quality")!.advanced, true);
  for (const id of [FLUX, SEED, SEEDP, RECR, RECP]) assert.deepEqual(MEDIA_CATALOG.byId(id)!.params.map((p) => p.name), ["prompt", "imageRatio", "imageCount", "imageStyle"]);
  void IMAGE_STYLES;
});

/* ───────────────────────────── text in pictures ───────────────────────────── */

test("text prompt: quoted texts, the instruction, the no-text clause kept byte for byte without `text`", () => {
  assert.deepEqual(quotedTexts(`Afisha: «Navro'z bayrami» va "21-mart", „Добро пожаловать“ “Welcome” «Navro'z bayrami» «» ""`), ["Navro'z bayrami", "21-mart", "Добро пожаловать", "Welcome"]);
  assert.deepEqual(quotedTexts("Registon kechqurun"), []);
  assert.deepEqual(quotedTexts(`«${"x".repeat(121)}» «ok»`), ["ok"], "a paragraph in quotes is not a poster line");
  assert.equal(textInstruction(["A", "B"]), 'Render exactly this text, spelled exactly as given and nowhere else in the image: "A", "B". No other text, letters, watermark or logo.');
  assert.match(textInstruction([]), /^Add no text/);
  // NIT-2: a `"` inside a «…» text cannot close the instruction's own quotes.
  assert.deepEqual(quotedTexts('Afisha «Say "hi" to Tashkent»'), ['Say "hi" to Tashkent']);
  assert.equal(textInstruction(['Say "hi"']), `Render exactly this text, spelled exactly as given and nowhere else in the image: "Say 'hi'". No other text, letters, watermark or logo.`);
  // Without `text` (the «Rasm» tool, non-text Studio models): the long-standing prompt, byte for byte.
  const RASM =
    "MAIN SUBJECT (must appear): a red apple " +
    IMAGE_STYLES.find((s) => s.id === "watercolor")!.suffix +
    " Wide 1024x576 composition. Scene stretches edge to edge. No empty side panel. Fill the entire frame. No large blank paper. No random animals or faces unless named. " +
    "Absolutely no text, letters, numbers, signage, plaques, inscriptions, watermark, logo, or UI anywhere in the image — walls and surfaces must be blank of any writing.";
  assert.equal(composePrompt("a red apple", "watercolor", 1024, 576), RASM);
  assert.ok(RASM.endsWith(NO_TEXT_CLAUSE));
  // With `text`: the clause is gone, the instruction takes its place, the rest is identical.
  const withText = composePrompt("a red apple", "watercolor", 1024, 576, { quoted: ["Olma"] });
  assert.ok(!withText.includes("Absolutely no text"), "the ban never reaches a text model");
  assert.equal(withText, RASM.replace(NO_TEXT_CLAUSE, textInstruction(["Olma"])));
});

test("text models: only the catalog entries sold as text-capable (badge «matn»)", () => {
  const text = MEDIA_CATALOG.entries.filter((e) => e.kind === "image" && e.badges.includes("matn")).map((e) => e.id);
  assert.deepEqual(text, ["openai/gpt-image", IDEO, MUSE, "meta/muse-edit"]);
});

test("«Rasm» keeps the no-text prompt: the provider request of the old tool carries the clause, even with quotes", async (t) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
  const { buildImageArtifact } = await import("../lib/generation/image-studio.ts");
  const { TOOL_BY_ID } = await import("../lib/tools.ts");
  const bodies: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u);
    if (url.includes(":generateContent")) return json(200, { candidates: [{ content: { parts: [{ text: '{"scene":"A poster on a wall."}' }] } }] });
    bodies.push(typeof init.body === "string" ? init.body : "");
    return json(200, { steps: [{ type: "message", content: [{ data: B64, mime_type: "image/jpeg" }] }] });
  }) as unknown as typeof fetch;
  t.after(() => void (globalThis.fetch = real));
  await buildImageArtifact(TOOL_BY_ID.image, { prompt: "Afisha «Xush kelibsiz»", imageStyle: "photo", imageRatio: "1:1", imageCount: 1 });
  assert.equal(bodies.length, 1);
  assert.ok(bodies[0]!.includes(NO_TEXT_CLAUSE.slice(0, 60)), "the old tool still forbids text");
  assert.ok(!bodies[0]!.includes("Render exactly this text"));
});

/* ───────────────────────────── price ───────────────────────────── */

test("price goldens per model × count at ×2, 12 700 so'm/$ (rounded up to 100); live block = catalog", () => {
  const pricing = { soumPerUsd: 12_700, markup: 2, step: 100, overrides: {} };
  // Hand-computed: usd × n × 12 700 × 2, up to 100.
  const GOLD: Record<string, number[]> = {
    [FLUX]: [1300, 2500, 3700, 4900], // 0.048 → 1 219.2 / 2 438.4 / 3 657.6 / 4 876.8
    [SEED]: [900, 1800, 2700, 3600], // 0.035 → 889 / 1 778 / 2 667 / 3 556
    [SEEDP]: [1800, 3500, 5200, 6900], // 0.0675 → 1 714.5 / 3 429 / 5 143.5 / 6 858
    [IDEO]: [1600, 3100, 4600, 6100], // medium 0.06 → 1 524 / 3 048 / 4 572 / 6 096
    [RECR]: [900, 1800, 2700, 3600],
    [RECP]: [5400, 10700, 16100, 21400], // 0.21 → 5 334 / 10 668 / 16 002 / 21 336
  };
  const live = { ...pricing, costUsd: liveUnitCosts() };
  for (const id of FAL_IDS) {
    for (const n of [1, 2, 3, 4]) {
      assert.equal(studioImagePrice({ modelId: id, imageCount: n }, pricing), GOLD[id]![n - 1], `${id} × ${n}`);
      assert.equal(studioImagePrice({ modelId: id, imageCount: n, quality: "medium" }, live), GOLD[id]![n - 1], `${id} × ${n} with the live block`);
    }
  }
  // Ideogram by quality (0.03 / 0.06 / 0.22): low 762 → 800, high 5 588 → 5 600 per picture; the live block keeps it.
  for (const [q, one, four] of [["low", 800, 3100], ["medium", 1600, 6100], ["high", 5600, 22400]] as const) {
    assert.equal(studioImagePrice({ modelId: IDEO, quality: q }, pricing), one, q);
    assert.equal(studioImagePrice({ modelId: IDEO, quality: q, imageCount: 4 }, live), four, `${q} × 4 live`);
  }
  assert.deepEqual(FAL_IDEOGRAM_QUALITY_USD, { low: 0.03, medium: 0.06, high: 0.22 });
  // The live block carries the flat fal prices (price book rows), never Ideogram's.
  assert.deepEqual(
    Object.fromEntries(FAL_IDS.filter((id) => id in live.costUsd).map((id) => [id, live.costUsd[id]])),
    { [FLUX]: 0.048, [SEED]: 0.035, [SEEDP]: 0.0675, [RECR]: 0.035, [RECP]: 0.21 },
  );
  for (const id of [FLUX, SEED, SEEDP, RECR, RECP]) assert.equal(costUsd(MEDIA_CATALOG.byId(id)!.cost, normalize(MEDIA_CATALOG.byId(id)!.params, { imageCount: 2 })), 2 * IMAGE_PRICES[ENDPOINT[id]!]!);
  // Studio purpose: Nano Banana stays the default, the fal models follow in catalog order.
  assert.deepEqual(MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed.slice(2), [...FAL_IDS, MUSE, KLEIN]);
  assert.deepEqual([...FAL_IMAGE_MODELS], [...FAL_IDS, MUSE, KLEIN]);
  assert.equal(MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.default, "google/nano-banana");
  for (const id of FAL_IDS) {
    const e = MEDIA_CATALOG.byId(id)!;
    assert.deepEqual(e.routes, [{ provider: "fal", upstreamModel: ENDPOINT[id], adapter: "fal" }]);
    assert.ok(e.badges.length > 0 && e.label && e.maker);
  }
});

/* ───────────────────────────── availability ───────────────────────────── */

test("availability: no key → hidden; key → listed; provider off → hidden; model off → hidden", (t) => {
  t.after(() => {
    delete process.env.FAL_KEY;
    resolve.resetProviderCache();
  });
  resolve.resetProviderCache();
  const none = new Map();
  for (const id of FAL_IDS) assert.equal(modelAvailable(id, none), false, `${id}: no key`);
  assert.equal(modelAvailable("google/nano-banana", none), true, "Gemini keyed in this file");
  process.env.FAL_KEY = KEY;
  for (const id of FAL_IDS) assert.equal(modelAvailable(id, none), true, `${id}: keyed`);
  assert.equal(modelAvailable(IDEO, new Map([[IDEO, { enabled: false, markup: null, updatedAt: null }]]) as never), false, "switched off in «Media modellari»");
  assert.equal(modelAvailable(FLUX, new Map([[IDEO, { enabled: false, markup: null, updatedAt: null }]]) as never), true, "another model's switch");
  resolve.setProviderSnapshot(new Map([["fal", { enabled: false, key: null, unreadable: false }]]));
  for (const id of FAL_IDS) assert.equal(modelAvailable(id, none), false, `${id}: provider switched off`);
});

/* ───────────────────────────── admin wiring ───────────────────────────── */

test("admin wiring: fal registry entry, purpose, breaker card, failure mapping, viewer label", async () => {
  const { providerDef } = await import("../lib/server/providers/registry.ts");
  const { PROVIDER_META, PURPOSES } = await import("../lib/server/providers/catalog.ts");
  assert.equal(providerDef("fal")!.testable, true);
  assert.equal(PROVIDER_META.fal!.need, "optional");
  assert.ok(PURPOSES.find((p) => p.id === "image")!.providers.includes("fal"));
  assert.equal(providerOfBreaker("media:fal:ideogram/v4.5"), "fal");
  assert.equal(providerOfBreaker("media:gemini:gemini-3.1-flash-lite-image"), "gemini");
  assert.equal(providerOfBreaker("media:nope:x"), null);
  assert.equal(providerOfBreaker("image:openai"), "openai-image");
  // The engines' failure terms.
  const f = (o: ConstructorParameters<typeof MediaError>[2], msg = "x") => failureOf(new MediaError("fal", msg, o));
  assert.match(f({ safety: true, status: 422 }, "422 flagged").detail, /^moderation_blocked \(fal\)/);
  assert.equal(f({ status: 403 }, "403 Exhausted balance").reason, "blocked");
  assert.equal(f({ status: 403 }, "403 Exhausted balance").detail, "403 Exhausted balance");
  assert.equal(f({ status: 429, retryable: true }).reason, "rate");
  assert.equal(f({ retryable: true, accepted: true }, "vaqt tugadi (fal req)").reason, "timeout");
  assert.equal(f({ status: 500, retryable: true }).reason, "failed");
  // The viewer names a fal picture by its catalog label; «Rasm» docs keep their short names.
  assert.equal(imageModelLabel(IDEO), "Ideogram 4.5");
  assert.equal(imageModelLabel("google/nano-banana"), "Nano Banana");
  assert.equal(imageModelLabel("openai"), "ChatGPT");
  assert.equal(imageModelLabel("gemini"), "Nano Banana");
  assert.equal(imageModelLabel("nope/x"), null);
});

test("probe: fal price list vs the catalog, balance, key never echoed", async () => {
  const req = probe.probeRequest("fal", KEY) as { url: string; headers: Record<string, string> };
  const ids = new URL(req.url).searchParams.get("endpoint_id")!.split(",");
  assert.deepEqual(ids.sort(), Object.values(ENDPOINT).sort());
  const prices = (over: Record<string, number> = {}) => ({
    prices: Object.values(ENDPOINT).map((endpoint_id) => ({ endpoint_id, unit_price: over[endpoint_id] ?? (endpoint_id === "ideogram/v4.5" ? 0.06 : IMAGE_PRICES[endpoint_id]), unit: "image", currency: "USD" })),
  });
  assert.equal(probe.falMessage(prices(), { username: "t", credits: { current_balance: 24.5, currency: "USD" } }), "Kalit qabul qilindi · narxlar katalog bilan mos · balans $24.5");
  assert.equal(
    probe.falMessage(prices({ "blackforestlabs/flux-3/text-to-image": 0.06 }), null),
    "Kalit qabul qilindi · narx farqi — blackforestlabs/flux-3/text-to-image: fal $0.06/image, bizda $0.048",
  );
  assert.match(probe.falMessage({ prices: [] }, null), /fal narxini bermadi: .*ideogram\/v4\.5/);
  // The whole probe: price list OK, balance 403 (a key without billing permission) — still accepted.
  const seen: string[] = [];
  const fetchImpl = (async (u: string, init: RequestInit) => {
    seen.push(`${String(u)} ${(init.headers as Record<string, string>).Authorization === `Key ${KEY}`}`);
    return String(u).includes("/billing") ? json(403, { error: { type: "authorization_error", message: "Access denied" } }) : json(200, prices());
  }) as unknown as typeof fetch;
  const r = await probe.probeProvider("fal", KEY, { fetchImpl });
  assert.deepEqual(r, { ok: true, message: "Kalit qabul qilindi · narxlar katalog bilan mos" });
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.endsWith(" true") && s.startsWith("https://api.fal.ai/")));
  const denied = await probe.probeProvider("fal", KEY, { fetchImpl: (async () => json(401, { error: { message: `bad key ${KEY}` } })) as unknown as typeof fetch });
  assert.equal(denied.ok, false);
  assert.ok(!denied.message.includes(KEY));
});

/* ───────────────────────────── flow (isolated DB) ───────────────────────────── */

const quiet = (t: TestContext) => {
  for (const m of ["log", "info", "warn", "error"] as const) t.mock.method(console, m, () => {});
};
const REAL_FETCH = globalThis.fetch;
const sceneOk = () => json(200, { candidates: [{ content: { parts: [{ text: '{"scene":"A wide view of Registon square at dawn, soft mist."}' }] } }] });

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
  return String((await query<{ id: string }>("INSERT INTO users (username, name, points, quota, balance) VALUES ($1, 'Fal', 0, 0, $2) RETURNING id", [`fal-${process.pid}-${seq++}`, balance]))[0].id);
}
async function balanceOf(userId: string): Promise<number> {
  const { query } = await db();
  return Number((await query<{ b: string }>("SELECT (points + quota + balance)::text AS b FROM users WHERE id = $1", [userId]))[0].b);
}
async function post(userId: string, values: Record<string, unknown>, expectedPrice?: number) {
  const route = await import("../app/api/generations/route.ts");
  const { createSession, SESSION_COOKIE } = await import("../lib/server/session.ts");
  await (await db()).query("DELETE FROM rate_limits WHERE bucket LIKE 'gen:%'");
  const req = new Request("http://localhost/api/generations", {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${(await createSession(userId)).token}`, "content-type": "application/json" },
    body: JSON.stringify({ slug: "studio", values, ...(expectedPrice !== undefined ? { expectedPrice } : {}) }),
  });
  const r = await inRequest(req, () => route.POST(req));
  return { status: r.status, body: (await r.json()) as { id?: string; error?: string; code?: string; price?: number } };
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

type Flow = {
  name: string;
  values: Record<string, unknown>;
  usd: number;
  /** Answer of the n-th fal RESULT call. */
  result: (n: number) => Response;
  status: "COMPLETED" | "FAILED";
  netShare: number;
  rows: string[];
  delivered?: { got: number; want: number };
  error?: RegExp;
};
const VALUES = { prompt: "Registon maydoni erta tongda", imageStyle: "photo", imageRatio: "16:9", imageCount: 1 };
const okResult = () => json(200, { images: [{ url: DATA_URI, content_type: "image/jpeg" }], seed: 7 });
const refused = () => json(422, { detail: [{ loc: ["body", "prompt"], msg: "flagged", type: "content_policy_violation" }] });
const FLOWS: Flow[] = [
  { name: "flux, 1 picture", values: { ...VALUES, modelId: FLUX }, usd: 0.048, result: okResult, status: "COMPLETED", netShare: 1, rows: ["succeeded"] },
  { name: "ideogram high, 2 pictures -> zip at the high price, the quoted text rendered", values: { ...VALUES, prompt: "Registon maydoni, ustida «Xush kelibsiz» yozuvi", modelId: IDEO, quality: "high", imageCount: 2 }, usd: 0.22, result: okResult, status: "COMPLETED", netShare: 1, rows: ["succeeded", "succeeded"] },
  {
    name: "seedream, one of two refused -> delivered 1/2, half refunded",
    values: { ...VALUES, modelId: SEED, imageCount: 2 },
    usd: 0.035,
    result: (n) => (n === 0 ? okResult() : refused()),
    status: "COMPLETED",
    netShare: 0.5,
    rows: ["failed", "succeeded"],
    delivered: { got: 1, want: 2 },
  },
  {
    name: "recraft pro, all refused -> FAILED with the refusal message, full refund",
    values: { ...VALUES, modelId: RECP, imageCount: 2 },
    usd: 0.21,
    result: refused,
    status: "FAILED",
    netShare: 0,
    rows: ["failed", "failed"],
    error: /kontent qoidalariga mos kelmadi/,
  },
];

test("flow: route -> claimNext -> runJob with a stubbed fal: charge, file, media_jobs rows, spend, refunds", { skip: skipDb }, async (t) => {
  quiet(t);
  const { query } = await db();
  const worker = await import("../lib/server/worker.ts");
  const { getGeneration } = await import("../lib/server/jobs.ts");
  const { mediaJobsOf } = await import("../lib/server/media/jobs.ts");
  const { getSetting } = await import("../lib/server/settings.ts");
  const { setSafeFetchLookup } = await import("../lib/generation/safe-fetch.ts");
  setSafeFetchLookup(async () => ["93.184.216.34"]);
  t.after(() => setSafeFetchLookup(null));
  // No key yet: the route refuses a fal model before charging.
  await refresh();
  const nobody = await mkUser();
  const refusedNoKey = await post(nobody, { ...VALUES, modelId: FLUX });
  assert.equal(refusedNoKey.status, 400);
  assert.match(String(refusedNoKey.body.error), /hozir mavjud emas/);
  assert.equal(await balanceOf(nobody), 100_000, "nothing charged without the key");

  process.env.FAL_KEY = KEY;
  t.after(() => void delete process.env.FAL_KEY);
  for (const f of FLOWS) {
    await t.test(f.name, async (sub) => {
      quiet(sub);
      await refresh();
      resetBreakers();
      await query("UPDATE generations SET status = 'REVOKED' WHERE status IN ('QUEUED', 'IN_PROGRESS')");
      const calls: Call[] = [];
      let results = 0;
      let reqN = 0;
      globalThis.fetch = (async (u: string | URL, init: RequestInit = {}) => {
        const url = String(u);
        if (url.includes(":generateContent")) return sceneOk();
        const c: Call = { url, method: String(init.method ?? "GET"), headers: { ...((init.headers ?? {}) as Record<string, string>) }, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
        calls.push(c);
        if (isSubmit(c)) return json(200, { request_id: `req-${String(reqN++).padStart(4, "0")}-flow` });
        if (isStatus(c)) return json(200, { status: "COMPLETED" });
        if (isResult(c)) return f.result(results++);
        return json(404, {});
      }) as unknown as typeof fetch;
      sub.after(() => void (globalThis.fetch = REAL_FETCH));
      const me = await mkUser();
      const before = await balanceOf(me);
      const rate = await getSetting("finance.soum_per_usd");
      const count = Number(f.values.imageCount);
      const price = Math.ceil((f.usd * count * rate * 2) / 100 - 1e-9) * 100;
      const r = await post(me, f.values, price);
      assert.equal(r.status, 202, JSON.stringify(r.body));
      assert.equal(r.body.price, price, "server price = fal cost × 2, rounded up to 100");
      assert.equal(before - (await balanceOf(me)), price, "charged exactly that");
      const job = await worker.claimNext();
      assert.equal(job?.id, r.body.id);
      await worker.runJob(job!);
      const gen = await getGeneration(r.body.id!, me);
      assert.equal(gen?.status, f.status, String(gen?.error));
      if (f.error) assert.match(String(gen?.error), f.error);
      assert.equal(before - (await balanceOf(me)), price * f.netShare, "net cost after the refund");
      const modelId = String(f.values.modelId);
      const endpoint = ENDPOINT[modelId]!;
      // One fal submit per picture, to the model's endpoint, with the key in the header only.
      const submits = calls.filter(isSubmit);
      assert.equal(submits.length, count);
      for (const s of submits) {
        assert.equal(s.url, `https://queue.fal.run/${endpoint}`);
        assert.equal(s.headers.Authorization, `Key ${KEY}`);
        const sent = String((s.body as { prompt: string }).prompt);
        assert.match(sent, /MAIN SUBJECT \(must appear\): A wide view of Registon/, "the engine's composed prompt");
        if (modelId === IDEO) {
          assert.ok(!sent.includes(NO_TEXT_CLAUSE), "a text model never gets the no-text clause");
          assert.ok(sent.includes(textInstruction(["Xush kelibsiz"])), "it renders exactly the user's quoted text");
        } else {
          assert.ok(sent.endsWith(NO_TEXT_CLAUSE), `${modelId}: a non-text model keeps the ban`);
        }
        if (modelId === IDEO) assert.equal((s.body as { quality: string }).quality, "high", "the model's own param reached fal");
      }
      const rows = await mediaJobsOf(r.body.id!);
      assert.deepEqual(rows.map((x) => x.status).sort(), f.rows, "one media_jobs row per picture");
      for (const row of rows) {
        assert.equal(row.purpose, "studio.image");
        assert.equal(row.model_id, modelId);
        assert.equal(row.provider, "fal");
        assert.equal(row.upstream_model, endpoint);
        assert.equal(Number((row as unknown as { cost_usd: string }).cost_usd), f.usd, "cost of ONE picture per row (never × count)");
        assert.ok(!JSON.stringify(row.params).includes(B64.slice(0, 40)), "no image bytes in params");
        assert.ok(!JSON.stringify(row).includes(KEY), "no key in the row");
      }
      const file = (await query<{ mime: string }>("SELECT mime FROM generation_files WHERE generation_id = $1", [r.body.id]))[0];
      const delivered = (await query<{ d: unknown }>("SELECT delivered_json AS d FROM generations WHERE id = $1", [r.body.id]))[0].d;
      const cost = (await query<{ c: { parts?: { kind: string; provider: string; model: string; calls: number; usd: number }[] } | null }>("SELECT cost_json AS c FROM generations WHERE id = $1", [r.body.id]))[0].c;
      const falPart = cost?.parts?.find((p) => p.provider === "fal");
      if (f.status === "COMPLETED") {
        assert.equal(gen?.doc?.imageModel, modelId, "doc.imageModel = catalog id");
        assert.equal(file?.mime, count > 1 && f.netShare === 1 ? "application/zip" : "image/jpeg");
        assert.equal(gen?.doc?.images?.length, f.delivered?.got ?? count);
        assert.deepEqual(delivered ?? null, f.delivered ?? null);
        const got = f.delivered?.got ?? count;
        assert.deepEqual({ kind: falPart?.kind, model: falPart?.model, calls: falPart?.calls }, { kind: "image", model: endpoint, calls: got }, "spend metered on provider fal");
        assert.ok(Math.abs((falPart?.usd ?? 0) - f.usd * got) < 1e-9);
      } else {
        assert.equal(file, undefined, "no file for a failed job");
      }
    });
  }
});
