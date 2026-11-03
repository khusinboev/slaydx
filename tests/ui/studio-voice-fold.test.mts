import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { ELEVENLABS_VOICES, GEMINI_VOICES } from "../../lib/media/catalog-speech.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { MediaComposer } = await import("../../components/forms/MediaComposer.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { TOOL_BY_ID, priceFor } = await import("../../lib/tools.ts");
const { formatSom } = await import("../../lib/format.ts");

/**
 * Studio P8b (docs/studio/P8-SPEC.md «P8b»): «Podkast» / «Tabriknoma» as «Tayyor shablonlar» of the «Ovoz» tab, with the
 * API stubbed at `fetch` and the REAL tool configs / composer.
 *
 * Locked here:
 *   - switch OFF (`features.legacyFold` absent or false): the «Ovoz» tab exactly as before — no templates row, a
 *     `?template=` link opens nothing, the «hozircha mavjud emas» card while no speech model is listed;
 *   - switch ON: the row («Podkast», «Tabriknoma», «… dan» = `priceFor` of the tool's defaults) above the speech form; a
 *     card opens the EXISTING composer (the tool's own `data-field`s) in place of the speech form; its price button
 *     shows the SAME price the old page shows; the submit sends the tool's own slug, values and that `expectedPrice`;
 *     the job is followed in the template's results (player, «Qayta» = the same request again, the result page link)
 *     and the page does NOT navigate away; «Yopish» brings the speech form back;
 *   - switch ON with `studio.voice.enabled` OFF (no speech model): only the templates row; `?tab=ovoz&template=greeting`
 *     opens the greeting composer directly;
 *   - a tool the server cannot sell (no voice provider) says why and draws no composer;
 *   - a text handed to «Ovoz» from another tab closes an open template (the speech form receives it).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. the row drawn without the switch (`{legacyFold ?` → `{true ?`)              -> «off»;
 *   2. `quietWhenNone` ignored (the «mavjud emas» card under the row)             -> «voice off»;
 *   3. `MediaComposer` `onQueued` path replaced by `runGeneration` + router.push   -> «on» (navigates, no result card);
 *   4. `queueToolGeneration` priced `tool.basePrice` instead of `priceFor`          -> «on» (expectedPrice with premium);
 *   5. `voiceTemplateFromSearch` ignored on mount                                  -> «voice off» (?template=greeting);
 *   6. `toolBlockedReason` check dropped in the panel                              -> «blocked»;
 *   7. `handVoice` not closing the template                                        -> «handoff».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const SPEECH = ["elevenlabs/eleven-v3", "google/gemini-tts"].map((id) => view.find((e) => e.id === id)!);
const BASE_FEATURES = { llm: true, images: true, tts: true, telegram: false, telegramBot: null, devLogin: false, pdf: false, payments: { click: false, payme: false } };

type Opts = { fold?: boolean; voice?: boolean; tts?: boolean; premium?: boolean };
function features(o: Opts) {
  return { ...BASE_FEATURES, tts: o.tts ?? true, ...(o.premium ? { ttsPremium: true } : {}), ...(o.fold === undefined ? {} : { legacyFold: o.fold }) };
}
function api(o: Opts = {}) {
  const base = installApi({
    catalog: catalogBody([NANO, GPT]),
    generation: (id, n) =>
      n === 0
        ? generationDetail(id, { type: "podcast", status: "IN_PROGRESS", progress: 40, step: "Ovozlanmoqda", hasFile: false, doc: null })
        : generationDetail(id, { type: "podcast", format: "mp3", fileName: "podkast.mp3", doc: { meta: { topic: "t", language: "uz" }, audio: { v: 1, kind: "podcast", type: "x", language: "uz", script: [], seconds: 64 } } }),
  });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/media/catalog?purpose=studio.speech")) {
      base.calls.push({ url, method, body: null, key: null });
      return json(200, { purpose: "studio.speech", defaultModelId: o.voice === false ? null : SPEECH[0]!.id, models: o.voice === false ? [] : SPEECH, pricing: { ...PRICING, soumPerUsd: 12_700 } });
    }
    if (url === "/api/media/voices") {
      return json(200, { library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES }, mine: [], clone: { available: false, price: 5000, consentText: "x", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 1, unusedDays: 30 } });
    }
    if (/^\/api\/forms\/[a-z-]+\/draft$/.test(url)) return method === "GET" ? json(200, { draft: null }) : json(200, { ok: true, updatedAt: "now" });
    if (url === "/api/auth/session") return json(200, { user: USER, features: features(o) });
    return inner(input as never, init);
  };
  return base;
}

function login(o: Opts) {
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, points: 0, balance: 90_000 } as never, features: features(o) as never });
}

beforeEach(() => {
  dropMediaCatalog();
  pushes.length = 0;
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  globalThis.fetch = realFetch;
  dropMediaCatalog();
  window.history.replaceState(null, "", "/");
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, sessionChecked: false, user: null, generations: [], features: null });
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const txt = (sel: string) => (q(sel)?.textContent ?? "").replace(/\s/g, " ");
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "element to click");
  await act(async () => void fireEvent.click(el));
};
async function settle(n = 12) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 3));
  });
}
async function mountStudio(path = "/uz/studio?tab=ovoz") {
  window.history.replaceState(null, "", path);
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle(25);
}
/** The old page's price for this tool (the standalone composer, as `/uz/podcast` renders it today). */
async function oldPagePrice(toolId: "podcast" | "greeting"): Promise<string> {
  render(h(AppRouterContext.Provider, { value: router }, h(MediaComposer, { tool: TOOL_BY_ID[toolId] })));
  await settle();
  const p = txt("[data-price-total]");
  cleanup();
  return p;
}

test("off: no templates row, ?template= opens nothing, the «Ovoz» tab as before", async () => {
  for (const fold of [undefined, false]) {
    api({ fold });
    login({ fold });
    await mountStudio("/uz/studio?tab=ovoz&template=podcast");
    assert.equal(q('[data-studio-tab="ovoz"]')!.getAttribute("aria-selected"), "true");
    assert.ok(!q("[data-voice-templates]"), `no row (legacyFold ${String(fold)})`);
    assert.ok(!q("[data-voice-template-panel]"), "no template opened by the link");
    assert.ok(q("[data-voice-tab]"), "the speech form");
    cleanup();
    dropMediaCatalog();
    api({ fold, voice: false });
    login({ fold });
    await mountStudio();
    assert.ok(q("[data-voice-none]"), "speech off: the «mavjud emas» card as before");
    assert.ok(!q("[data-voice-templates]"));
    cleanup();
    dropMediaCatalog();
  }
});

test("on: the row opens the existing composer at the old page's price; submit queues the tool, the job plays here", async () => {
  const a = api({ fold: true, premium: true });
  login({ fold: true, premium: true });
  const oldPrice = await oldPagePrice("podcast");
  await mountStudio();
  assert.deepEqual(qa("[data-voice-template]").map((b) => b.getAttribute("data-voice-template")), ["podcast", "greeting"]);
  assert.deepEqual(qa("[data-voice-template] .font-bold").map((b) => b.textContent), ["Podkast", "Tabriknoma"]);
  for (const id of ["podcast", "greeting"] as const) {
    assert.equal(txt(`[data-voice-template="${id}"] [data-voice-template-price]`), `${formatSom(priceFor(TOOL_BY_ID[id], {} as never))} dan`.replace(/\s/g, " "));
  }
  assert.ok(q("[data-voice-tab]"), "the speech form stays under the row while no template is open");

  await click(q('[data-voice-template="podcast"]'));
  await settle();
  assert.equal(q('[data-voice-template="podcast"]')!.getAttribute("aria-pressed"), "true");
  assert.ok(q('[data-voice-template-panel="podcast"]'));
  assert.ok(!q("[data-voice-tab]"), "the composer replaces the speech form");
  for (const f of ["mode", "topic", "podcastType", "durationMin", "language", "voice", "voiceProvider"]) assert.ok(q(`[data-voice-template-panel] [data-field="${f}"]`), `field ${f}`);
  assert.ok(!q("[data-voice-template-panel] [data-tool-title]"), "no page header of its own");
  assert.equal(txt("[data-voice-template-panel] [data-price-total]"), oldPrice, "the old page's price");

  // Premium voice: the price follows `priceFor` with the surcharge (5 minutes), exactly as the old page would.
  await click(q('[data-field="voiceProvider"] button:nth-child(2)') ?? qa('[data-field="voiceProvider"] [role="radio"], [data-field="voiceProvider"] button')[1]);
  await settle();
  const topic = q<HTMLInputElement>('[data-field="topic"] textarea, [data-field="topic"] input')!;
  await act(async () => void fireEvent.change(topic, { target: { value: "Sun'iy intellekt va ta'lim" } }));
  await settle();
  const shown = txt("[data-voice-template-panel] [data-price-total]");
  await click(qa("[data-voice-template-panel] [data-submit-card] button").at(-1));
  await settle(30);
  const posts = a.posts();
  assert.equal(posts.length, 1);
  const body = posts[0]!.body as { slug: string; values: Record<string, unknown>; expectedPrice: number };
  assert.equal(body.slug, "podcast", "the EXISTING tool");
  assert.equal(body.values.topic, "Sun'iy intellekt va ta'lim");
  assert.equal(body.values.voiceProvider, "elevenlabs");
  assert.equal(body.expectedPrice, priceFor(TOOL_BY_ID.podcast, body.values as never), "priceFor of the sent values");
  assert.equal(formatSom(body.expectedPrice).replace(/\s/g, " "), shown, "= the number on the button");
  assert.ok(body.expectedPrice > priceFor(TOOL_BY_ID.podcast, {} as never), "the premium surcharge is in");
  assert.deepEqual(pushes, [], "the page stays in the Studio");

  // The job: progress, then the player + download + «Qayta» + the result page link.
  const id = a.created[0]!;
  await settle(40);
  const card = q(`[data-voice-template-results] [data-studio-job="${id}"]`);
  assert.ok(card, "followed in the template's results");
  if (card!.getAttribute("data-job-status") !== "COMPLETED") await settle(400);
  assert.equal(q(`[data-studio-job="${id}"]`)!.getAttribute("data-job-status"), "COMPLETED");
  assert.equal(q<HTMLAudioElement>(`[data-studio-job="${id}"] [data-audio-result]`)!.getAttribute("src"), `/api/generations/${id}/file?inline=1`);
  assert.equal(q(`[data-studio-job="${id}"] [data-result-open]`)!.getAttribute("href"), `/uz/files/${id}`, "the same result page");
  assert.match(txt(`[data-studio-job="${id}"] [data-studio-job-meta]`), /Podkast · 64 s/);

  await click(q(`[data-studio-job="${id}"] [data-result-action="again"]`));
  await settle();
  const again = a.posts();
  assert.equal(again.length, 2, "«Qayta» = a new job");
  assert.deepEqual(again[1]!.body, again[0]!.body, "the same request and price");

  await click(q("[data-voice-template-exit]"));
  await settle();
  assert.ok(!q("[data-voice-template-panel]"));
  assert.ok(q("[data-voice-tab]"), "the speech form is back");
});

test("voice off: only the templates row; ?tab=ovoz&template=greeting opens the greeting composer", async () => {
  api({ fold: true, voice: false });
  login({ fold: true });
  await mountStudio();
  assert.ok(q("[data-voice-templates]"));
  assert.ok(!q("[data-voice-none]"), "no «mavjud emas» card under the row");
  assert.ok(!q("[data-voice-tab]"));
  cleanup();
  dropMediaCatalog();
  const oldPrice = await oldPagePrice("greeting");
  api({ fold: true, voice: false });
  login({ fold: true });
  await mountStudio("/uz/studio?tab=ovoz&template=greeting");
  assert.ok(q('[data-voice-template-panel="greeting"]'));
  for (const f of ["recipient", "relation", "occasion", "durationMin"]) assert.ok(q(`[data-field="${f}"]`), `field ${f}`);
  assert.equal(txt("[data-voice-template-panel] [data-price-total]"), oldPrice);
});

test("blocked: no voice provider → the reason, no composer, nothing sent", async () => {
  const a = api({ fold: true, tts: false });
  login({ fold: true, tts: false });
  await mountStudio("/uz/studio?tab=ovoz&template=podcast");
  assert.ok(q("[data-voice-template-blocked]"));
  assert.ok(!q("[data-voice-template-panel] [data-field]"));
  assert.equal(a.posts().length, 0);
});

test("handoff: a text handed to «Ovoz» closes an open template", async () => {
  api({ fold: true });
  login({ fold: true });
  await mountStudio("/uz/studio?tab=ovoz&template=podcast");
  assert.ok(q("[data-voice-template-panel]"));
  // The gallery's «Ovoz qo'shish» path: open the gallery with one picture item and hand its prompt to «Ovoz».
  cleanup();
  dropMediaCatalog();
  const item = { id: "g1", kind: "image", audio: null, createdAt: "2026-11-01T10:00:00.000Z", modelId: NANO.id, modelLabel: NANO.label, prompt: "Tog‘ manzarasi", images: [{ url: "/api/generations/g1/assets/a1", w: 1, h: 1 }], video: null, fileUrl: "/api/generations/g1/file", favorite: false };
  const base = api({ fold: true });
  void base;
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) =>
    String(input).startsWith("/api/media/gallery") ? json(200, { items: [item], nextCursor: null }) : inner(input as never, init);
  await mountStudio("/uz/studio?tab=ovoz&template=podcast");
  assert.ok(q("[data-voice-template-panel]"));
  await click(q("[data-studio-gallery-link]"));
  await settle(20);
  await click(q("[data-gallery-next-toggle]"));
  await click(q('[data-gallery-action="to-voice"]'));
  await settle(20);
  assert.ok(!q("[data-voice-template-panel]"), "the template closed");
  assert.ok(q("[data-voice-tab]"), "the speech form got the text");
});
