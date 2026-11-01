import test from "node:test";
import assert from "node:assert/strict";
import {
  MediaError,
  checkOutput,
  costUsd,
  defineCatalog,
  definePurposes,
  isRetryableStatus,
  normalize,
  price,
  resolveModel,
  roundUpTo,
  routeKey,
  sha256Hex,
  sniffMime,
  submitWithRoutes,
  validate,
  type CatalogEntry,
  type MediaAdapter,
  type ParamSchema,
  type Route,
  type RouteHealth,
} from "../lib/studio-core/index.ts";

/**
 * Media engine core, pure parts (docs/studio/P0-SPEC.md §3, §8).
 *
 * Mutations (each turned the named test red, then restored):
 *   pricing  `* markup` removed -> "price: cost x rate x markup"; fixed override ignored -> "fixed override wins";
 *            `Math.max(1, …)` removed -> "never free"; ceil -> floor in roundUpTo -> "rounds up";
 *            per-model markup ignored -> "per-model markup".
 *   cost     second rule multiplies by count param -> "per second"; `by` table ignored -> "by table".
 *   params   unknown enum mapped to default in validate -> "unknown enum rejected"; int step check removed -> "int step".
 *   router   `e.accepted ||` removed -> "no fallback after accept"; `e.safety ||` removed -> "no fallback on safety";
 *            health.allow skipped -> "open breaker skipped…"; last-route exception removed -> same test.
 *   purposes requested model swapped for the default when unavailable -> "a pick is never swapped".
 */

const schema: ParamSchema[] = [
  { name: "prompt", label: "Tavsif", type: "text", min: 5, max: 20, affects: "request" },
  { name: "count", label: "Soni", type: "int", min: 1, max: 4, default: 1, affects: "both" },
  { name: "seconds", label: "Davomiylik", type: "int", min: 5, max: 10, step: 5, default: 5, affects: "both" },
  { name: "aspect", label: "O'lcham", type: "enum", options: [{ value: "1:1", label: "1:1" }, { value: "16:9", label: "16:9" }], default: "1:1", affects: "request" },
  { name: "hd", label: "HD", type: "bool", default: false, affects: "both" },
  { name: "ref", label: "Surat", type: "image", max: 2, mimes: ["image/png"], maxBytes: 10, affects: "request" },
];

test("params: normalize falls back to defaults, never throws", () => {
  const p = normalize(schema, { prompt: "  a   b  c  ", count: "9", seconds: 7, aspect: "4:3", hd: "yes", ref: "zz" });
  assert.equal(p.prompt, "a b c");
  assert.equal(p.count, 1);
  assert.equal(p.seconds, 5);
  assert.equal(p.aspect, "1:1");
  assert.equal(p.hd, false);
  assert.deepEqual(p.ref, []);
  const q = normalize(schema, { prompt: "x".repeat(50), count: "3", seconds: "10", aspect: "16:9", hd: "1", ref: ["A".repeat(24), "b".repeat(24), "c".repeat(24)] });
  assert.equal(q.prompt, "x".repeat(20));
  assert.equal(q.count, 3);
  assert.equal(q.seconds, 10);
  assert.equal(q.aspect, "16:9");
  assert.equal(q.hd, true);
  assert.deepEqual(q.ref, ["a".repeat(24), "b".repeat(24)]);
});

test("params: unknown enum rejected, blank accepted", () => {
  assert.match(validate(schema, { prompt: "hello world", aspect: "4:3" }) ?? "", /O'lcham/);
  assert.equal(validate(schema, { prompt: "hello world", aspect: "" }), null);
  assert.equal(validate(schema, { prompt: "hello world" }), null);
});

test("params: int range and step", () => {
  assert.match(validate(schema, { prompt: "hello world", count: 5 }) ?? "", /Soni/);
  assert.match(validate(schema, { prompt: "hello world", seconds: 7 }) ?? "", /Davomiylik/);
  assert.equal(validate(schema, { prompt: "hello world", seconds: 10 }), null);
});

test("params: text min, bool, image ids", () => {
  assert.match(validate(schema, { prompt: "  hi  " }) ?? "", /kamida 5/);
  assert.match(validate(schema, { prompt: "hello world", hd: "maybe" }) ?? "", /HD/);
  assert.match(validate(schema, { prompt: "hello world", ref: "nothex" }) ?? "", /identifikator/);
  assert.match(validate(schema, { prompt: "hello world", ref: ["a".repeat(24), "b".repeat(24), "c".repeat(24)] }) ?? "", /eng ko'pi 2/);
});

test("cost: per job / output / by table", () => {
  assert.equal(costUsd({ per: "job", usd: 0.5 }, {}), 0.5);
  assert.equal(costUsd({ per: "output", usd: 0.03, countParam: "count" }, { count: 3 }), 0.09);
  assert.equal(costUsd({ per: "output", usd: 0.03 }, { count: 3 }), 0.03);
  const byQ = { per: "output" as const, usd: 0.05, countParam: "count", by: { param: "q", table: { high: 0.2 } } };
  assert.equal(costUsd(byQ, { count: 2, q: "high" }), 0.4);
  assert.equal(costUsd(byQ, { count: 2, q: "low" }), 0.1);
});

test("cost: per second and per 1k chars", () => {
  assert.equal(costUsd({ per: "second", usd: 0.1, secondsParam: "seconds" }, { seconds: 8, count: 4 }), 0.8);
  assert.equal(costUsd({ per: "kchar", usd: 0.08, textParam: "text" }, { text: "x".repeat(2500) }), 0.2);
});

test("price: cost x rate x markup, rounded up", () => {
  const rule = { per: "output" as const, usd: 0.034, countParam: "count" };
  // 0.034 x 2 x 12 800 x 2 = 1 740.8 -> 1 800
  assert.equal(price(rule, { count: 2 }, { rate: 12_800, markup: 2, round: roundUpTo(100) }), 1800);
  assert.equal(price(rule, { count: 2 }, { rate: 12_800, markup: 1, round: roundUpTo(100) }), 900);
});

test("price: per-model markup beats the global one, invalid one is ignored", () => {
  const rule = { per: "job" as const, usd: 1 };
  const ctx = { rate: 100, markup: 2, round: (x: number) => x };
  assert.equal(price(rule, {}, { ...ctx, override: { mode: "markup", markup: 3 } }), 300);
  assert.equal(price(rule, {}, { ...ctx, override: { mode: "markup", markup: 0.5 } }), 200);
});

test("price: fixed override wins", () => {
  const rule = { per: "job" as const, usd: 1 };
  const ctx = { rate: 100, markup: 2, round: (x: number) => x };
  assert.equal(price(rule, { count: 4 }, { ...ctx, override: { mode: "fixed", price: (p) => (Number(p.count) >= 4 ? 6000 : 2000) } }), 6000);
});

test("price: never free", () => {
  assert.equal(price({ per: "job", usd: 0 }, {}, { rate: 12_800, markup: 2, round: roundUpTo(100) }), 1);
});

test("roundUpTo: rounds up, exact stays", () => {
  assert.equal(roundUpTo(100)(1701), 1800);
  assert.equal(roundUpTo(100)(1700), 1700);
  assert.equal(roundUpTo(100)(1700.0000001), 1700);
});

const route = (provider: string, adapter = provider): Route => ({ provider, upstreamModel: `${provider}-m`, adapter });

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: "acme/pic",
    kind: "image",
    capabilities: ["t2i"],
    label: "Acme",
    maker: "Acme",
    badges: [],
    params: [{ name: "count", label: "Soni", type: "int", min: 1, max: 4, default: 1, affects: "both" }],
    cost: { per: "output", usd: 0.03, countParam: "count" },
    routes: [route("a")],
    limits: { timeoutMs: 1000 },
    output: { mimes: ["image/png"], maxBytes: 100 },
    ...over,
  };
}

test("catalog: rejects bad entries at load", () => {
  assert.throws(() => defineCatalog([entry(), entry()]), /duplicate/);
  assert.throws(() => defineCatalog([entry({ routes: [] })]), /no route/);
  assert.throws(() => defineCatalog([entry({ id: "Bad Id" })]), /bad id/);
  assert.throws(() => defineCatalog([entry({ cost: { per: "second", usd: 1, secondsParam: "seconds" } })]), /unknown param "seconds"/);
});

test("catalog: client view has no routes", () => {
  const c = defineCatalog([entry()]);
  assert.equal(c.byId("acme/pic")?.routes.length, 1);
  assert.equal(c.byId("nope"), null);
  assert.ok(!("routes" in c.clientView()[0]));
});

const cat = defineCatalog([entry({ id: "acme/a" }), entry({ id: "acme/b" }), entry({ id: "acme/v", kind: "video" })]);
const purposes = definePurposes(cat, [{ id: "x.image", kind: "image", allowed: ["acme/a", "acme/b"], default: "acme/a", userCanChoose: true }]);

test("purposes: definition is checked", () => {
  assert.throws(() => definePurposes(cat, [{ id: "p", kind: "image", allowed: ["acme/a"], default: "acme/b", userCanChoose: false }]), /default/);
  assert.throws(() => definePurposes(cat, [{ id: "p", kind: "image", allowed: ["acme/v"], default: "acme/v", userCanChoose: false }]), /video/);
  assert.throws(() => definePurposes(cat, [{ id: "p", kind: "image", allowed: ["acme/z"], default: "acme/z", userCanChoose: false }]), /unknown/);
});

test("purposes: default, stored default, fallback order", () => {
  const all = () => true;
  assert.deepEqual(resolveModel(purposes, "x.image", { available: all }), { ok: true, modelId: "acme/a" });
  assert.deepEqual(resolveModel(purposes, "x.image", { available: all, storedDefault: "acme/b" }), { ok: true, modelId: "acme/b" });
  assert.deepEqual(resolveModel(purposes, "x.image", { available: all, storedDefault: "acme/v" }), { ok: true, modelId: "acme/a" });
  assert.deepEqual(resolveModel(purposes, "x.image", { available: (id) => id === "acme/b" }), { ok: true, modelId: "acme/b" });
  assert.deepEqual(resolveModel(purposes, "x.image", { available: () => false }), { ok: false, reason: "unavailable" });
  assert.deepEqual(resolveModel(purposes, "nope", { available: all }), { ok: false, reason: "unknown-purpose" });
});

test("purposes: a pick is never swapped", () => {
  assert.deepEqual(resolveModel(purposes, "x.image", { requested: "acme/b", available: (id) => id === "acme/a" }), { ok: false, reason: "unavailable" });
  assert.deepEqual(resolveModel(purposes, "x.image", { requested: "acme/v", available: () => true }), { ok: false, reason: "not-allowed" });
  assert.deepEqual(resolveModel(purposes, "x.image", { requested: "acme/b", available: () => true }), { ok: true, modelId: "acme/b" });
});

function fakeAdapter(id: string, behave: () => Promise<unknown>, calls: string[]): MediaAdapter {
  return {
    id,
    configured: () => true,
    buildRequest: () => ({ url: "https://x", headers: {}, body: {} }),
    submit: async (input) => {
      calls.push(`${id}:${input.upstreamModel}:${input.idempotencyKey}`);
      await behave();
      return { opId: `${id}-op` };
    },
    fetchOutput: async () => new Uint8Array(),
  };
}

function health(open: string[] = []): RouteHealth & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    allow: (r) => !open.includes(r.provider),
    success: (r) => log.push(`ok:${r.provider}`),
    failure: (r) => log.push(`fail:${r.provider}`),
  };
}

const ok = () => Promise.resolve();
const fail = (o: ConstructorParameters<typeof MediaError>[2]) => () => Promise.reject(new MediaError("p", "boom", o));

test("router: primary first", async () => {
  const calls: string[] = [];
  const h = health();
  const r = await submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", ok, calls), b: fakeAdapter("b", ok, calls) }, h, { params: {}, idempotencyKey: "k1" });
  assert.equal(r.route.provider, "a");
  assert.deepEqual(calls, ["a:a-m:k1"]);
  assert.deepEqual(h.log, ["ok:a"]);
});

test("router: falls back on a retryable error before acceptance", async () => {
  const calls: string[] = [];
  const h = health();
  const r = await submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", fail({ retryable: true, status: 503 }), calls), b: fakeAdapter("b", ok, calls) }, h, { params: {}, idempotencyKey: "k" });
  assert.equal(r.route.provider, "b");
  assert.deepEqual(h.log, ["fail:a", "ok:b"]);
});

test("router: no fallback after accept", async () => {
  const calls: string[] = [];
  await assert.rejects(
    submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", fail({ retryable: true, accepted: true }), calls), b: fakeAdapter("b", ok, calls) }, health(), { params: {}, idempotencyKey: "k" }),
    /boom/,
  );
  assert.deepEqual(calls, ["a:a-m:k"]);
});

test("router: no fallback on safety or a permanent error", async () => {
  for (const o of [{ retryable: true, safety: true }, { retryable: false, status: 403 }]) {
    const calls: string[] = [];
    await assert.rejects(submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", fail(o), calls), b: fakeAdapter("b", ok, calls) }, health(), { params: {}, idempotencyKey: "k" }));
    assert.deepEqual(calls, ["a:a-m:k"]);
  }
});

test("router: open breaker skipped, the last usable route is still tried", async () => {
  const calls: string[] = [];
  const r = await submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", ok, calls), b: fakeAdapter("b", ok, calls) }, health(["a"]), { params: {}, idempotencyKey: "k" });
  assert.equal(r.route.provider, "b");
  assert.deepEqual(calls, ["b:b-m:k"]);
  const single: string[] = [];
  await submitWithRoutes([route("a")], { a: fakeAdapter("a", ok, single) }, health(["a"]), { params: {}, idempotencyKey: "k" });
  assert.deepEqual(single, ["a:a-m:k"]);
});

test("router: no configured route = retryable error", async () => {
  const off: MediaAdapter = { ...fakeAdapter("a", ok, []), configured: () => false };
  await assert.rejects(
    submitWithRoutes([route("a")], { a: off }, health(), { params: {}, idempotencyKey: "k" }),
    (e: unknown) => e instanceof MediaError && e.retryable,
  );
});

test("router: non-media errors (bugs) propagate", async () => {
  await assert.rejects(
    submitWithRoutes([route("a"), route("b")], { a: fakeAdapter("a", () => Promise.reject(new TypeError("bug")), []), b: fakeAdapter("b", ok, []) }, health(), { params: {}, idempotencyKey: "k" }),
    TypeError,
  );
});

test("routeKey and retryable statuses", () => {
  assert.equal(routeKey(route("kling")), "media:kling:kling-m");
  assert.deepEqual([400, 401, 403, 404, 408, 429, 500, 503].map(isRetryableStatus), [false, false, false, false, true, true, true, true]);
});

test("storage: sniff, size, type, sha256", async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  assert.equal(sniffMime(png), "image/png");
  assert.equal(sniffMime(new Uint8Array([0, 0, 0, 0x18, ...[..."ftypmp42"].map((c) => c.charCodeAt(0))])), "video/mp4");
  assert.equal(sniffMime(new Uint8Array(12)), null);
  const ok1 = await checkOutput(png, { mimes: ["image/png"], maxBytes: 100 });
  assert.equal(ok1.ok, true);
  assert.equal(ok1.ok && ok1.sha256, await sha256Hex(png));
  assert.match((await checkOutput(png, { mimes: ["image/jpeg"], maxBytes: 100 }) as { error: string }).error, /unexpected/);
  assert.match((await checkOutput(png, { mimes: ["image/png"], maxBytes: 5 }) as { error: string }).error, /too large/);
  assert.equal(await sha256Hex(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
