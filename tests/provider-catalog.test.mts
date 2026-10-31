import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://unused/unused";

const { PROVIDERS, PROVIDER_IDS } = await import("../lib/server/providers/registry.ts");
const { PROVIDER_META, PURPOSES, ROUTE_INFO, purposeVerdict } = await import("../lib/server/providers/catalog.ts");
const { ROUTE_IDS, ROUTE_SPECS, checkRoute, isRouteId, modelOptions } = await import("../lib/server/providers/routes.ts");
const { effectiveRoute, geminiImageModelName, geminiTextModel, ttsProviderRank, DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_IMAGE_MODEL } = await import("../lib/server/providers/route-effective.ts");
const { resetRouteSnapshot, setRouteSnapshot } = await import("../lib/server/providers/route-resolve.ts");
const { foldUsage, registryIdOf, tashkentDay, usageDays, SERIES_DAYS } = await import("../lib/server/admin-provider-usage.ts");
const { providerOfUrl, recordProviderCall, registerProviderCallSink } = await import("../lib/generation/provider-calls.ts");
const { getJson } = await import("../lib/generation/research/http.ts");
const { imagePriceOf, costUsd } = await import("../lib/generation/llm-pricing.ts");
const { ttsGroups, ttsVoiceChain } = await import("../lib/generation/tts/chain.ts");

/**
 * The «Provayderlar» page's rules (owner request 2026-10-31), without a database:
 *   - every registry provider has catalog facts and every purpose names only registry providers, so the page can
 *     never show a provider it cannot describe (and a new provider cannot ship without its facts);
 *   - the verdict («yetarlimi?») follows the rules: missing / single / ok / off, fallback only where providers back
 *     each other up, the premium voice never counts;
 *   - routing slots accept only allowed providers and PRICED models, in a valid shape, with no duplicates;
 *   - the effective value is db > env > default, and the generation layer reads it through the same function;
 *   - usage folds into today / 7 / 30 days, free-provider counters and history of removed providers.
 *
 * Mutation checks (each made the named test fail, then restored):
 *   - drop one entry of PROVIDER_META -> "every registry provider has catalog facts" fails;
 *   - count `premium` providers in `purposeVerdict` -> "verdict: premium voice does not count" fails;
 *   - skip the price-book check in `checkRoute` -> "checkRoute rejects a model that is not in the price book" fails;
 *   - prefer env over the stored route in `effectiveRoute` -> "effectiveRoute: db beats env beats default" fails;
 *   - treat day index `>= length - 7` as `> length - 7` in `addDay` -> "foldUsage: windows" fails;
 *   - count a breaker skip as a request in research/http.ts -> "research http counts real requests only" fails;
 *   - ignore the stored order in `ttsVoiceChain` -> "the stored voice order moves whole providers" fails.
 */

afterEach(() => {
  resetRouteSnapshot();
  registerProviderCallSink(null);
});

/* ───────────────────────────── catalog ───────────────────────────── */

test("every registry provider has catalog facts, and the catalog has nothing the registry lacks", () => {
  assert.deepEqual([...Object.keys(PROVIDER_META)].sort(), [...PROVIDER_IDS].sort());
  for (const p of PROVIDERS) {
    const m = PROVIDER_META[p.id];
    assert.ok(m.role.length > 10 && m.priceNote.length > 3, p.id);
    assert.ok(["paid", "free", "free-tier"].includes(m.billing) && ["required", "recommended", "optional"].includes(m.need), p.id);
    if (m.keyUrl) assert.match(m.keyUrl, /^https:\/\//, `${p.id}: a public https page, never a secret`);
  }
});

test("purposes name only registry providers; every routing slot belongs to exactly one purpose; the premium voice is not a chain member", () => {
  const ids = new Set<string>(PROVIDER_IDS);
  const owner = new Map<string, string>();
  for (const pu of PURPOSES) {
    for (const id of [...pu.providers, ...pu.premium]) assert.ok(ids.has(id), `${pu.id}: ${id}`);
    assert.ok(!pu.providers.some((p) => pu.premium.includes(p)), `${pu.id}: premium and chain overlap`);
    for (const r of pu.routes) {
      assert.ok(isRouteId(r), r);
      assert.ok(!owner.has(r), `${r} is in two purposes`);
      owner.set(r, pu.id);
      for (const e of ROUTE_SPECS[r].providers) assert.ok(pu.providers.includes(e), `${pu.id}/${r}: ${e} is not a provider of the purpose`);
    }
  }
  assert.deepEqual([...owner.keys()].sort(), [...ROUTE_IDS].sort(), "no orphan slot");
  for (const r of ROUTE_IDS) assert.ok(ROUTE_INFO[r].title && ROUTE_INFO[r].help, r);
  assert.deepEqual(PURPOSES.find((p) => p.id === "tts")!.premium, ["elevenlabs"]);
});

const envOf = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const label = (id: string) => id.toUpperCase();
const P = (id: string) => PURPOSES.find((p) => p.id === id)!;

test("verdict: missing / single / ok / off follow the rules", () => {
  const text = P("text");
  assert.equal(purposeVerdict(text, [], label).verdict, "missing", "a required purpose with nothing working");
  assert.match(purposeVerdict(text, [], label).detail, /GEMINI, ANTHROPIC/, "names what to switch on");
  assert.equal(purposeVerdict(text, ["gemini"], label).verdict, "single", "one of a fallback chain");
  assert.equal(purposeVerdict(text, ["gemini", "anthropic"], label).verdict, "ok");
  assert.equal(purposeVerdict(P("video"), [], label).verdict, "off", "optional and nobody switched it on");
  assert.equal(purposeVerdict(P("video"), ["veo"], label).verdict, "ok", "video providers are alternatives, one is enough");
  assert.equal(purposeVerdict(P("image"), ["gemini"], label).verdict, "ok", "ChatGPT is a user's choice, not a fallback");
  assert.equal(purposeVerdict(P("stt"), ["gemini"], label).verdict, "ok", "a purpose with one possible provider is never «zaxirasiz»");
  assert.equal(purposeVerdict(P("stock"), ["pixabay"], label).verdict, "single");
});

test("verdict: premium voice does not count", () => {
  const tts = P("tts");
  assert.equal(purposeVerdict(tts, ["elevenlabs"] as never, label).verdict, "missing", "only the premium voice works: the standard chain has nothing");
  assert.equal(purposeVerdict(tts, ["gemini", "elevenlabs"] as never, label).verdict, "single");
});

/* ───────────────────────────── routing slots ───────────────────────────── */

test("modelOptions: only priced models, current price, none for the voice order", () => {
  const writer = modelOptions("llm.writer");
  assert.ok(writer.length >= 4);
  assert.deepEqual([...new Set(writer.map((o) => o.provider))].sort(), ["anthropic", "gemini"]);
  for (const o of writer) {
    assert.ok(costUsd({ provider: o.provider, model: o.model, inputTokens: 1_000_000, outputTokens: 0 }) > 0, `${o.model} is in the price book`);
    assert.ok(o.inUsdPerM! > 0 && o.outUsdPerM! > 0 && o.perImageUsd === null);
  }
  assert.equal(writer.filter((o) => o.model === "gemini-3.7-flash").length, 1, "dated price rows collapse into one option");
  const before = modelOptions("llm.model", new Date("2026-10-31")).find((o) => o.model === "gemini-3.7-flash")!;
  const after = modelOptions("llm.model", new Date("2027-02-01")).find((o) => o.model === "gemini-3.7-flash")!;
  assert.ok(after.inUsdPerM! > before.inUsdPerM!, "the announced price change applies on its date");
  const images = modelOptions("image.gemini");
  assert.ok(images.length >= 2 && images.every((o) => o.perImageUsd! > 0 && imagePriceOf(o.model) !== null));
  assert.ok(images.every((o) => o.model.startsWith("gemini-")), "the OpenAI image models are not Gemini options");
  assert.deepEqual(modelOptions("tts.order"), []);
});

test("checkRoute accepts a valid chain and normalises it", () => {
  const ok = checkRoute("llm.judge", [
    { provider: "anthropic", model: "claude-sonnet-5" },
    { provider: "gemini", model: "gemini-3.7-flash", extra: "ignored" },
  ]);
  assert.deepEqual(ok, { ok: true, entries: [{ provider: "anthropic", model: "claude-sonnet-5" }, { provider: "gemini", model: "gemini-3.7-flash" }] });
  assert.deepEqual(checkRoute("tts.order", [{ provider: "gemini" }, { provider: "azure", model: null }, { provider: "aisha", model: "" }]), {
    ok: true,
    entries: [{ provider: "gemini", model: null }, { provider: "azure", model: null }, { provider: "aisha", model: null }],
  });
  assert.equal(checkRoute("llm.model", [{ provider: "gemini", model: "gemini-3.1-pro" }]).ok, true);
});

test("checkRoute rejects a model that is not in the price book, an unknown or foreign provider, wrong shapes and duplicates", () => {
  const bad = (id: Parameters<typeof checkRoute>[0], raw: unknown) => {
    const r = checkRoute(id, raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    return (r as { error: string }).error;
  };
  assert.match(bad("llm.writer", [{ provider: "gemini", model: "gemini-9-ultra" }]), /narxlar jadvalida yo'q/, "an unpriced model would make every report show a silent $0");
  assert.match(bad("llm.writer", [{ provider: "gemini", model: "claude-sonnet-5" }]), /narxlar jadvalida yo'q/, "a model of the OTHER provider");
  assert.match(bad("llm.writer", [{ provider: "gemini" }]), /narxlar jadvalida yo'q/, "a chain entry needs its model");
  assert.match(bad("llm.writer", [{ provider: "bogus", model: "x" }]), /yaroqsiz/);
  assert.match(bad("llm.writer", [{ provider: "pexels", model: "x" }]), /yaroqsiz/, "a real provider that is not an LLM");
  assert.match(bad("llm.model", [{ provider: "anthropic", model: "claude-sonnet-5" }]), /yaroqsiz/, "the default text model is Gemini only");
  assert.match(bad("llm.model", [{ provider: "gemini", model: "gemini-3.7-flash" }, { provider: "gemini", model: "gemini-3.1-pro" }]), /Eng ko'pi bilan 1|bitta model/);
  assert.match(bad("tts.order", [{ provider: "azure", model: "voice" }]), /model tanlanmaydi/);
  assert.match(bad("tts.order", [{ provider: "elevenlabs" }]), /yaroqsiz/, "the premium voice is not part of the standard order");
  assert.match(bad("llm.writer", [{ provider: "gemini", model: "gemini-3.7-flash" }, { provider: "gemini", model: "gemini-3.7-flash" }]), /ikki marta/);
  assert.match(bad("tts.order", [{ provider: "azure" }, { provider: "azure" }]), /ikki marta/);
  assert.match(bad("llm.writer", []), /Kamida bitta/);
  assert.match(bad("llm.writer", "gemini"), /Kamida bitta/);
  assert.match(bad("llm.writer", Array.from({ length: 5 }, (_, i) => ({ provider: i % 2 ? "gemini" : "anthropic", model: i % 2 ? "gemini-3.7-flash" : `claude-sonnet-${i}` }))), /Eng ko'pi bilan 4/);
  assert.match(bad("llm.writer", [null]), /noto'g'ri/);
});

test("effectiveRoute: db beats env beats default", () => {
  const env = envOf({ GEMINI_MODEL: "gemini-3.5-flash-lite", LLM_JUDGE: "anthropic:claude-sonnet-5,gemini:gemini-3.7-flash", GEMINI_IMAGE_MODEL: "gemini-3.1-flash-image" });
  // default
  assert.deepEqual(effectiveRoute("llm.writer", envOf({})), { source: "default", entries: [{ provider: "gemini", model: DEFAULT_GEMINI_MODEL }] });
  assert.equal(geminiTextModel(envOf({})), DEFAULT_GEMINI_MODEL);
  assert.equal(geminiImageModelName(envOf({})), DEFAULT_GEMINI_IMAGE_MODEL);
  assert.deepEqual(effectiveRoute("tts.order", envOf({})).entries.map((e) => e.provider), ["azure", "aisha", "gemini"]);
  // env
  assert.deepEqual(effectiveRoute("llm.judge", env), {
    source: "env",
    entries: [{ provider: "anthropic", model: "claude-sonnet-5" }, { provider: "gemini", model: "gemini-3.7-flash" }],
  });
  assert.equal(effectiveRoute("llm.model", env).source, "env");
  assert.equal(geminiTextModel(env), "gemini-3.5-flash-lite");
  assert.equal(geminiImageModelName(env), "gemini-3.1-flash-image");
  assert.deepEqual(effectiveRoute("llm.writer", env).entries, [{ provider: "gemini", model: "gemini-3.5-flash-lite" }], "a role with no env value follows the env text model");
  // db
  setRouteSnapshot(new Map([["llm.judge", [{ provider: "gemini", model: "gemini-3.1-pro" }]], ["llm.model", [{ provider: "gemini", model: "gemini-3.1-pro" }]]]));
  assert.deepEqual(effectiveRoute("llm.judge", env), { source: "db", entries: [{ provider: "gemini", model: "gemini-3.1-pro" }] }, "the stored choice beats the env value");
  assert.equal(geminiTextModel(env), "gemini-3.1-pro");
  assert.deepEqual(effectiveRoute("llm.writer", env).entries, [{ provider: "gemini", model: "gemini-3.1-pro" }], "the writer default follows the stored text model");
  assert.equal(effectiveRoute("llm.judge", env, { ignoreStored: true }).source, "env", "what «Standartga qaytarish» restores");
  resetRouteSnapshot();
  assert.equal(effectiveRoute("llm.judge", env).source, "env");
});

test("an env chain naming a provider that was removed keeps the valid entries", () => {
  const env = envOf({ LLM_WRITER: "openrouter:x/y,gemini:gemini-3.7-flash" });
  assert.deepEqual(effectiveRoute("llm.writer", env), { source: "env", entries: [{ provider: "gemini", model: "gemini-3.7-flash" }] });
});

test("ttsProviderRank: null without a stored order; listed providers first, the rest after", () => {
  assert.equal(ttsProviderRank(), null);
  setRouteSnapshot(new Map([["tts.order", [{ provider: "gemini", model: null }, { provider: "azure", model: null }]]]));
  const rank = ttsProviderRank()!;
  assert.deepEqual(["azure", "aisha", "gemini", "elevenlabs"].sort((a, b) => rank(a) - rank(b)), ["gemini", "azure", "aisha", "elevenlabs"]);
});

test("the stored voice order moves whole providers and never beats an operator's TTS_VOICE_<LANG>", () => {
  const env = envOf({ TTS_GEMINI_MODEL: "gemini-2.5-flash-preview-tts" });
  assert.deepEqual(ttsGroups("uz", env).map((g) => g.provider), ["azure", "aisha", "gemini"], "default: the table order");
  setRouteSnapshot(new Map([["tts.order", [{ provider: "gemini", model: null }, { provider: "azure", model: null }]]]));
  assert.deepEqual(ttsGroups("uz", env).map((g) => g.provider), ["gemini", "azure", "aisha"], "listed first, unlisted after, in table order");
  const azure = ttsGroups("uz", env).find((g) => g.provider === "azure")!;
  assert.deepEqual(azure.voices, ["uz-UZ-MadinaNeural", "uz-UZ-SardorNeural"], "a provider keeps its own voice order (female then male)");
  const pinned = envOf({ ...env, TTS_VOICE_UZ: "aisha:gulnoza,azure:uz-UZ-MadinaNeural" });
  assert.deepEqual(ttsVoiceChain("uz", pinned).map((v) => v.provider), ["aisha", "azure"], "the operator's list is untouched by the stored order");
});

/* ───────────────────────────── usage ───────────────────────────── */

const NOW = new Date("2026-10-31T05:00:00Z"); // 10:00 in Tashkent

test("Tashkent days: today is the last of 30, the series is the last 14", () => {
  assert.equal(tashkentDay(new Date("2026-10-31T19:30:00Z")), "2026-11-01", "after 19:00 UTC Tashkent is already tomorrow");
  const days = usageDays(NOW);
  assert.equal(days.length, 30);
  assert.equal(days[0], "2026-10-02");
  assert.equal(days[29], "2026-10-31");
  assert.equal(SERIES_DAYS, 14);
});

test("registryIdOf: the ChatGPT image part belongs to openai-image; a removed provider has no card", () => {
  assert.equal(registryIdOf("openai", "image"), "openai-image");
  assert.equal(registryIdOf("gemini", "llm"), "gemini");
  assert.equal(registryIdOf("veo", "video"), "veo");
  assert.equal(registryIdOf("fal", "image"), null);
  assert.equal(registryIdOf("xai", "llm"), null);
  assert.equal(registryIdOf("unknown", "unknown"), null);
});

const row = (day: string, provider: string, kind: string, model: string, calls: number, usd: number, extra: Partial<{ units: number; inputTokens: number; outputTokens: number }> = {}) => ({
  day,
  provider,
  kind,
  model,
  calls,
  usd,
  records: 1,
  units: extra.units ?? 0,
  inputTokens: extra.inputTokens ?? 0,
  outputTokens: extra.outputTokens ?? 0,
  unpricedCalls: 0,
});

test("foldUsage: windows, kinds, models, daily series, free counters and the history of removed providers", () => {
  const body = foldUsage(
    NOW,
    [
      row("2026-10-31", "gemini", "llm", "gemini-3.7-flash", 10, 1.5, { inputTokens: 1000, outputTokens: 200 }),
      row("2026-10-28", "gemini", "llm", "gemini-3.7-flash", 5, 0.5),
      row("2026-10-24", "gemini", "llm", "gemini-3.7-flash", 1, 0.25), // the 8th day back: in 30 days, NOT in 7
      row("2026-10-10", "gemini", "image", "gemini-3.1-flash-lite-image", 3, 0.1, { units: 3 }),
      row("2026-09-01", "gemini", "llm", "gemini-3.7-flash", 99, 99), // outside the window: ignored everywhere
      row("2026-10-30", "openai", "image", "gpt-image-2.5-flare", 2, 0.1),
      row("2026-10-29", "fal", "image", "fal-ai/flux/schnell", 4, 0.012),
      row("2026-10-29", "xai", "llm", "grok-4.3", 1, 0.2),
    ],
    [
      { day: "2026-10-31", provider: "pexels", calls: "7", errors: "2" },
      { day: "2026-10-20", provider: "pexels", calls: 3, errors: 0 },
      { day: "2026-09-01", provider: "pexels", calls: 500, errors: 0 },
      { day: "2026-10-31", provider: "bogus", calls: 9, errors: 0 },
    ],
  );
  const g = body.byProvider.gemini;
  assert.deepEqual([g.today.calls, g.d7.calls, g.d30.calls], [10, 15, 19], "windows: today / 7 days (10-25 .. 10-31) / 30 days");
  assert.equal(g.today.usd, 1.5);
  assert.equal(g.d7.usd, 2);
  assert.equal(g.d30.usd, 2.35);
  assert.deepEqual([g.today.inputTokens, g.today.outputTokens], [1000, 200]);
  assert.equal(g.d30.units, 3);
  assert.equal(g.today.errors, null, "paid usage does not track failures");
  assert.equal(g.lastDay, "2026-10-31");
  assert.deepEqual(g.kinds.map((k) => k.kind), ["llm", "image"], "biggest spend first");
  assert.equal(g.kinds[0].calls, 16);
  assert.deepEqual(g.models.map((m) => m.model), ["gemini-3.7-flash", "gemini-3.1-flash-lite-image"]);
  assert.equal(g.daily.length, 14);
  assert.equal(g.daily.at(-1)!.day, "2026-10-31");
  assert.equal(g.daily.at(-1)!.calls, 10);
  assert.equal(g.daily.find((d) => d.day === "2026-10-28")!.usd, 0.5);
  assert.ok(!g.daily.some((d) => d.day === "2026-10-10"), "the series is the last 14 days only");

  assert.equal(body.byProvider["openai-image"].d30.calls, 2, "the ChatGPT image part lands on its own card");
  const p = body.byProvider.pexels;
  assert.deepEqual([p.today.calls, p.today.errors, p.d30.calls, p.d30.errors], [7, 2, 10, 2], "free counters: calls and errors, nothing from outside the window");
  assert.equal(p.d30.usd, 0);
  assert.equal(body.byProvider.pixabay.d30.calls, 0, "an unused provider is all zeros, not missing");
  assert.equal(body.byProvider.pixabay.lastDay, null);
  assert.equal(body.byProvider.pixabay.d30.errors, 0, "a free provider reports errors as a number");
  assert.equal(body.byProvider.azure.d30.errors, null, "a paid provider does not track failures");

  assert.deepEqual(body.other, [{ provider: "xai", calls: 1, usd: 0.2 }, { provider: "fal", calls: 4, usd: 0.012 }], "history of removed providers stays visible, biggest first");
  assert.equal(body.total30.calls, 10 + 5 + 1 + 3 + 2 + 4 + 1 + 10, "totals include removed providers and free calls; nothing outside 30 days");
  assert.equal(body.total30.usd, 2.662);
});

/* ───────────────────────────── free-provider counters ───────────────────────────── */

test("providerOfUrl maps the keyless-priced research hosts only", () => {
  assert.equal(providerOfUrl("https://api.openalex.org/works?per-page=1"), "openalex");
  assert.equal(providerOfUrl("https://www.googleapis.com/books/v1/volumes?q=x"), "googlebooks");
  assert.equal(providerOfUrl("https://www.googleapis.com/drive/v3/files"), null);
  assert.equal(providerOfUrl("https://api.crossref.org/works"), null);
  assert.equal(providerOfUrl("not a url"), null);
});

test("recordProviderCall never throws, even from a failing sink", () => {
  registerProviderCallSink(() => {
    throw new Error("sink down");
  });
  assert.doesNotThrow(() => recordProviderCall("pexels", true));
  registerProviderCallSink(null);
  assert.doesNotThrow(() => recordProviderCall("pexels", false));
});

test("research http counts real requests only", async () => {
  const seen: Array<[string, boolean]> = [];
  registerProviderCallSink((p, ok) => seen.push([p, ok]));
  const res = (status: number) => new Response(JSON.stringify({ ok: status < 400 }), { status, headers: { "content-type": "application/json" } });

  await getJson("https://api.openalex.org/works?x=1", { fetchImpl: (async () => res(200)) as typeof fetch, retries: 0 });
  assert.deepEqual(seen, [["openalex", true]]);

  seen.length = 0;
  await getJson("https://api.openalex.org/works?x=2", { fetchImpl: (async () => res(500)) as typeof fetch, retries: 2, retryBaseMs: 0 });
  assert.deepEqual(seen, [["openalex", false], ["openalex", false], ["openalex", false]], "every HTTP attempt is a request against the quota");

  seen.length = 0;
  await getJson("https://api.openalex.org/works?x=3", {
    fetchImpl: (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch,
    retries: 0,
  });
  assert.deepEqual(seen, [["openalex", false]], "a network failure is a failed request");

  seen.length = 0;
  await getJson("https://api.crossref.org/works?x=4", { fetchImpl: (async () => res(200)) as typeof fetch, retries: 0 });
  assert.deepEqual(seen, [], "hosts without a provider card are not counted");

  seen.length = 0;
  await getJson("https://api.openalex.org/works?x=5", { fetchImpl: (async () => res(200)) as typeof fetch, retries: 0, deadline: Date.now() - 1 });
  assert.deepEqual(seen, [], "a call refused by the deadline never reached the network, so it is not a request");
});
