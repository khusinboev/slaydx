import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import type { ClientEntry, ParamSchema } from "../../lib/studio-core/index.ts";
import { GPT, NANO, PRICING, USER, catalogBody, expectedPrice, installApi, json, withParams } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom } = await import("../../lib/format.ts");
const { resetCompareKey } = await import("../../components/studio/compare/compare-api.ts");
const { COMPARE_MAX, compareBatch, compareLabel, compareModels, sharedParams, toggleModel } = await import("../../components/studio/compare/compare-model.ts");

/**
 * Studio P7a «Solishtirish» (docs/studio/P7-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries.
 *
 * Locked here:
 *   - shared rows: a param every ticked model has (same name + type) with the values they ALL accept (Omni 5 / 8 s ∩
 *     Kling 3–15 s = 5 / 8 s); any other param takes each model's own default — a value left in the bag never leaks;
 *   - the button «Solishtirish · N model · ~X so'm», X = the plain SUM of each model's own price (independent formula);
 *   - Rasm: the switch appears with ≥ 2 models (not with one), seeds the tab's prompt, ticks 2–4 models (the cap holds),
 *     the shared «Rasmlar soni» re-prices the total; SUBMIT posts `/api/studio/compare` with `kind`, each model's
 *     values + own price and the total, an Idempotency-Key; the results grid shows one cell per model in tick order with
 *     its price, the pictures with «Yuklab olish», and «Shu modelni tanlash» (compare off, that model, same prompt);
 *   - money edges: 409 → the new sum, the catalog re-read, no cell; a lost answer (500) → the retry reuses the key;
 *   - Video: the switch on the Video tab, effects never offered, the clip models' values (shared seconds / aspect, the
 *     Kling-only «sound» at its default) and the paid balance line.
 *
 * Mutations (each turned the named test red, then restored):
 *   `shareOne` keeps the FIRST model's enum options (no intersection)                -> «shared rows»;
 *   `memberValues` passes the whole bag (non-shared values leak)                       -> «shared rows»;
 *   `compareBatch` total = the first model's price × N                                 -> «Rasm: switch …» (button text);
 *   `toggleModel` without the COMPARE_MAX cap                                          -> «shared rows» (toggle);
 *   (review MINOR-2) the panel's tick guard uses COMPARE_MAX, not the session cap        -> «… in-flight cap …» (3 ticked);
 *   (review MINOR-2) CompareSwitch shown with a cap below two                          -> «… in-flight cap …» (switch);
 *   ComparePanel sends without `expectedTotal`                                         -> «Rasm: switch …» (request body);
 *   `pickCompared` does not turn compare off                                           -> «Rasm: switch …» (pick);
 *   `sendCompare` mints a new key after a 500                                          -> «money edges»;
 *   `compareModels` keeps the effect entry for video                                   -> «Video».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const OMNI = view.find((e) => e.id === "google/omni-video")!;
const K3 = view.find((e) => e.id === "kling/kling-3")!;
const K3P = view.find((e) => e.id === "kling/kling-3-pro")!;
const FX = view.find((e) => e.id === "kling/effects")!;
const videoCatalog = { purpose: "studio.video", defaultModelId: OMNI.id, models: [OMNI, K3, K3P, FX], pricing: PRICING };

type Compare = { status: number; body: unknown };
function api(opts: { image?: unknown; compare?: (body: Record<string, unknown>, n: number) => Compare } = {}) {
  const base = installApi({ catalog: opts.image ?? catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  const posts: { body: Record<string, unknown>; key: string | null }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) {
      base.calls.push({ url, method: "GET", body: null, key: null });
      return json(200, videoCatalog);
    }
    if (url === "/api/studio/compare") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      posts.push({ body, key: new Headers(init?.headers).get("idempotency-key") });
      const members = body.members as { values: { modelId: string }; expectedPrice: number }[];
      if (opts.compare) {
        const r = opts.compare(body, posts.length - 1);
        return json(r.status, r.body);
      }
      const items = members.map((m, i) => ({ id: `c${posts.length}${i}000000-7777-4777-8777-777777777777`, modelId: m.values.modelId, price: m.expectedPrice }));
      return json(202, { group: `g${posts.length}`, total: body.expectedTotal, items, status: "QUEUED" });
    }
    return inner(input as never, init);
  };
  return { ...base, comparePosts: posts };
}

beforeEach(() => {
  dropMediaCatalog();
  resetCompareKey();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, balance: 900_000 } as never });
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
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "element to click");
  await act(async () => void fireEvent.click(el));
};
async function settle(n = 8) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 3));
  });
}
async function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
}
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel);
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const switchOn = () => click(q('[data-compare-switch] [role="switch"]'));
const button = () => q("[data-studio-submit]")?.textContent ?? "";
const ticked = () => qa('[data-compare-model][aria-checked="true"]').map((e) => e.getAttribute("data-compare-model"));
/** The request values a model must get: its OWN params, the shared bag where shared, its default elsewhere (independent of the product). */
function expectValues(entry: ClientEntry, shared: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { modelId: entry.id };
  for (const p of entry.params) {
    if (p.type === "image") out[p.name] = "";
    else out[p.name] = p.name in shared ? shared[p.name] : (p as { default?: unknown }).default;
  }
  return out;
}

/* ───────────────────────────── pure ───────────────────────────── */

test("shared rows: intersection of what every model accepts; other params at each model's default; the 4-model cap", () => {
  const names = (ps: ParamSchema[]) => ps.map((p) => p.name);
  assert.deepEqual(names(sharedParams([NANO, GPT])), ["prompt", "imageRatio", "imageCount", "imageStyle"]);
  // Omni (5 / 8 s, 16:9 | 9:16) × Kling 3.0 (3–15 s, + 1:1, + sound): seconds 5 / 8, aspect without 1:1, no sound row.
  // Kling first: its own list (with 1:1, 3–15 s) is NOT what is shared — the order of the ticks does not matter.
  const v = sharedParams([K3, OMNI]);
  assert.deepEqual(names(v), ["prompt", "seconds", "aspect"]);
  const secs = v.find((p) => p.name === "seconds") as Extract<ParamSchema, { type: "int" }>;
  assert.deepEqual([secs.min, secs.max, secs.step], [5, 8, 3]);
  const aspect = v.find((p) => p.name === "aspect") as Extract<ParamSchema, { type: "enum" }>;
  assert.deepEqual(aspect.options.map((o) => o.value), ["16:9", "9:16"], "MUTATSIYA: enum options are the intersection");
  // A value of a row that is NOT shared never reaches a model: Kling's sound stays at its default (off).
  const { members, total } = compareBatch("video", [OMNI, K3], { prompt: "Registon tongda kamera", seconds: 8, sound: true, aspect: "9:16" }, PRICING);
  assert.deepEqual(members.map((m) => m.values), [
    expectValues(OMNI, { prompt: "Registon tongda kamera", seconds: 8, aspect: "9:16" }),
    expectValues(K3, { prompt: "Registon tongda kamera", seconds: 8, aspect: "9:16" }),
  ]);
  assert.equal(members[1]!.values.sound, false, "MUTATSIYA: a non-shared value does not leak");
  assert.equal(total, members[0]!.price + members[1]!.price);
  // The cap and the label.
  assert.deepEqual(toggleModel(["a", "b", "c", "d"], "e"), ["a", "b", "c", "d"], "MUTATSIYA: at most four");
  assert.equal(COMPARE_MAX, 4);
  assert.deepEqual(toggleModel(["a", "b"], "a"), ["b"]);
  assert.equal(compareLabel(1, 5000, formatSom), "Solishtirish");
  assert.equal(compareLabel(3, 12_400, formatSom), `Solishtirish · 3 model · ~${formatSom(12_400)}`);
  assert.deepEqual(compareModels("video", [OMNI, FX, K3]).map((m) => m.id), [OMNI.id, K3.id]);
});

/* ───────────────────────────── Rasm ───────────────────────────── */

test("Rasm: switch → seeded prompt, 2 ticked, sum on the button; submit = the contract; grid; «Shu modelni tanlash»", async () => {
  const a = api();
  await mount();
  await type('[data-field="prompt"] textarea', "Registon maydoni erta tongda");
  assert.ok(q("[data-compare-switch]"), "the switch with two models");
  await switchOn();
  assert.ok(q('[data-compare-panel="image"]'));
  assert.ok(!q("[data-model-picker]"), "the tab's own form is replaced");
  assert.equal(q<HTMLTextAreaElement>('[data-compare-panel] [data-field="prompt"] textarea')!.value, "Registon maydoni erta tongda", "the tab's prompt is seeded");
  assert.deepEqual(ticked(), [NANO.id, GPT.id]);
  const sum1 = expectedPrice(NANO, 1) + expectedPrice(GPT, 1);
  assert.equal(button(), `Solishtirish · 2 model · ~${formatSom(sum1)}`, "MUTATSIYA: the sum of each model's own price");
  // The shared «Rasmlar soni» re-prices every model.
  await click(qa('[data-compare-panel] [data-field="imageCount"] [role="radio"]').find((b) => b.textContent === "2"));
  const sum2 = expectedPrice(NANO, 2) + expectedPrice(GPT, 2);
  assert.equal(button(), `Solishtirish · 2 model · ~${formatSom(sum2)}`);
  // One model ticked: no compare, the button says so and is disabled.
  await click(q(`[data-compare-model="${GPT.id}"]`));
  assert.equal(button(), "Solishtirish");
  assert.equal(q<HTMLButtonElement>("[data-studio-submit]")!.disabled, true);
  await click(q(`[data-compare-model="${GPT.id}"]`));

  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal(a.comparePosts.length, 1);
  const shared = { prompt: "Registon maydoni erta tongda", imageCount: 2 };
  assert.deepEqual(a.comparePosts[0]!.body, {
    kind: "image",
    members: [
      { values: expectValues(NANO, shared), expectedPrice: expectedPrice(NANO, 2) },
      { values: expectValues(GPT, shared), expectedPrice: expectedPrice(GPT, 2) },
    ],
    expectedTotal: sum2,
  }, "MUTATSIYA: the request carries each model's price and the total");
  assert.match(a.comparePosts[0]!.key ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(a.posts().length, 0, "no single submit");
  // One cell per model in tick order, with its price; the polled pictures with «Yuklab olish».
  const cells = qa("[data-compare-cell]");
  assert.deepEqual(cells.map((c) => c.getAttribute("data-compare-cell")), [NANO.id, GPT.id]);
  assert.deepEqual(cells.map((c) => c.querySelector("[data-compare-price]")?.textContent), [formatSom(expectedPrice(NANO, 2)), formatSom(expectedPrice(GPT, 2))]);
  assert.ok(cells.every((c) => c.querySelector("[data-compare-pictures] img") && c.querySelector('[data-compare-action="download"]')));
  // «Shu modelni tanlash» on GPT: compare off, GPT chosen in the tab's own form, the same prompt.
  await click(cells[1]!.querySelector('[data-compare-action="pick"]'));
  assert.ok(!q("[data-compare-panel]"), "MUTATSIYA: compare turns off");
  assert.equal(q(`[data-model-card="${GPT.id}"]`)?.getAttribute("aria-pressed"), "true");
  assert.equal(q<HTMLTextAreaElement>('[data-field="prompt"] textarea')!.value, "Registon maydoni erta tongda");
  assert.equal(q('[data-compare-switch] [role="switch"]')?.getAttribute("aria-checked"), "false");
});

test("Rasm: one model offered → no switch; the cap of four holds in the panel", async () => {
  api({ image: catalogBody([NANO]) });
  await mount();
  assert.ok(!q("[data-compare-switch]"), "nothing to compare with one model");
  cleanup();
  dropMediaCatalog();
  const extra = ["a/one", "a/two", "a/three"].map((id, i) => withParams(NANO, id, NANO.params, `Model ${i + 1}`));
  api({ image: catalogBody([NANO, GPT, ...extra]) });
  await mount();
  await switchOn();
  for (const m of extra) await click(q(`[data-compare-model="${m.id}"]`));
  assert.equal(ticked().length, 4);
  assert.equal(q(`[data-compare-model="${extra[2]!.id}"]`)?.getAttribute("aria-disabled"), "true");
  assert.match(q("[data-studio-error]")?.textContent ?? "", /Ko‘pi bilan 4/);
});

test("Rasm: the session's in-flight cap bounds the batch (2 → a third tick refused; 1 → no switch)", async () => {
  const extra = ["a/one", "a/two"].map((id, i) => withParams(NANO, id, NANO.params, `Model ${i + 1}`));
  useAppStore.setState({ features: { compareMax: 2 } as never });
  api({ image: catalogBody([NANO, GPT, ...extra]) });
  await mount();
  await switchOn();
  for (const m of extra) await click(q(`[data-compare-model="${m.id}"]`));
  assert.equal(ticked().length, 2, "MUTATSIYA: the panel keeps the session cap, not four");
  assert.match(q("[data-studio-error]")?.textContent ?? "", /Ko‘pi bilan 2/);
  cleanup();
  dropMediaCatalog();
  useAppStore.setState({ features: { compareMax: 1 } as never });
  api({ image: catalogBody([NANO, GPT]) });
  await mount();
  assert.ok(!q("[data-compare-switch]"), "MUTATSIYA: a cap below two hides the switch (every batch would be a 429)");
});

test("money edges: 409 → the new sum, the catalog re-read, no cell; a lost answer (500) → the retry reuses the key", async () => {
  const a = api({
    compare: (_b, n) =>
      n === 0
        ? { status: 409, body: { error: "Narx o'zgardi. Yangi narx: 9 900 so'm.", code: "price_changed", price: 9900 } }
        : n === 1
          ? { status: 500, body: { error: "Ichki xato" } }
          : { status: 202, body: { group: "g", total: 1, items: [], status: "QUEUED" } },
  });
  await mount();
  await type('[data-field="prompt"] textarea', "Registon maydoni erta tongda");
  await switchOn();
  const reads = a.catalogCalls().length;
  await click(q("[data-studio-submit]"));
  await settle();
  assert.match(q("[data-studio-error]")?.textContent ?? "", /9 900/);
  assert.ok(a.catalogCalls().length > reads, "the catalog is read again");
  assert.equal(qa("[data-compare-cell]").length, 0);
  await click(q("[data-studio-submit]"));
  await settle();
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.comparePosts.length, 3);
  assert.notEqual(a.comparePosts[1]!.key, a.comparePosts[0]!.key, "a refusal frees the key");
  assert.equal(a.comparePosts[2]!.key, a.comparePosts[1]!.key, "MUTATSIYA: after a lost answer the same key");
});

/* ───────────────────────────── Video ───────────────────────────── */

test("Video: the switch on the Video tab, no effect offered, the clip values and the paid balance", async () => {
  const a = api();
  useAppStore.setState({ user: { ...USER, points: 50_000, quota: 0, balance: 200_000 } as never });
  await mount();
  await click(q('[data-studio-tab="video"]'));
  await settle();
  // P11 D: the Video tab lands on «Shablon effektlar» — one photo, one fixed clip, nothing to compare: no switch there.
  assert.ok(!q("[data-compare-switch]"), "MUTATSIYA: no switch on the effects mode");
  await click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === "Matndan / rasmdan"));
  await settle();
  await switchOn();
  assert.ok(q('[data-compare-panel="video"]'));
  assert.deepEqual(qa("[data-compare-model]").map((e) => e.getAttribute("data-compare-model")), [OMNI.id, K3.id, K3P.id], "MUTATSIYA: effects are never compared");
  await click(q(`[data-compare-model="${K3P.id}"]`));
  assert.deepEqual(ticked(), [OMNI.id, K3.id, K3P.id]);
  await type('[data-compare-panel] [data-field="prompt"] textarea', "Tong chog‘ida Registon, kamera sekin yaqinlashadi");
  assert.match(q("[data-studio-balance]")?.textContent ?? "", /To‘langan balans/);
  await click(q("[data-studio-submit]"));
  await settle(12);
  const body = a.comparePosts[0]!.body as { kind: string; members: { values: Record<string, unknown>; expectedPrice: number }[]; expectedTotal: number };
  assert.equal(body.kind, "video");
  const shared = { prompt: "Tong chog‘ida Registon, kamera sekin yaqinlashadi", seconds: 5, aspect: "16:9" };
  assert.deepEqual(body.members.map((m) => m.values), [expectValues(OMNI, shared), expectValues(K3, shared), expectValues(K3P, shared)]);
  assert.equal(body.expectedTotal, body.members.reduce((s, m) => s + m.expectedPrice, 0));
  assert.equal(qa("[data-compare-cell]").length, 3);
});
