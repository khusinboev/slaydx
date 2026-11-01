import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ClientEntry } from "../../lib/studio-core/index.ts";
import { GPT, NANO, PRICING, USER, catalogBody, expectedPrice, generationDetail, installApi, json, withParams } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom, groupDigits } = await import("../../lib/format.ts");
const { IMAGE_PROMPT_LIMIT } = await import("../../lib/generation/image-params.ts");

/**
 * Studio page (`/uz/studio`, docs/studio/P1-SPEC.md) with the API stubbed at `fetch`, the REAL catalog entries.
 *
 * Locked here:
 *   - shell: «Studio» header + subtitle + «Galereya» link, a «Rasm» tab ONLY (no Video / Ovoz / template / sample-prompt
 *     decoration); logged out → the login opens with `returnTo`;
 *   - the model list is the SERVER's: an unavailable model is not drawn, a stale choice falls back to the default, a
 *     refused model (400) re-reads the catalog; empty / failed catalog have honest states;
 *   - switching the model re-renders the settings and the price; the prompt stays; values the new model accepts stay;
 *   - PRICE: the button text and every card equal the formula (cost × markup, rounded up to 100) for each model × count,
 *     the global markup and a per-model override win in that order;
 *   - SUBMIT sends exactly the contract: slug `studio`, values `{modelId, prompt, imageStyle, imageRatio, imageCount}`
 *     (prompt normalized), the displayed price as `expectedPrice`; too short a prompt sends nothing;
 *   - results: progress panel while running, picture cards when done («Yuklab olish», «Qayta», «Boshqa modelda»), the
 *     failed and the short-delivery states; «Qayta» is a NEW request with a NEW idempotency key;
 *   - money edges: balance below the price is said before the press, 402 → top-up link, 409 → the new price, no job.
 *
 * Mutations (each turned the named tests red, then restored):
 *   price button uses `unitPrice` instead of `studioPrice`                          -> «PRICE: button», «override»;
 *   studio-price `roundUpTo(pricing.step)` -> `Math.round`                          -> «PRICE: button» (870 → 900 expected);
 *   `studioBasePrice` ignores `pricing.overrides`                                   -> «override»;
 *   requestValues adds `topic`                                                      -> «SUBMIT sends exactly the contract»;
 *   send(): `expectedPrice` of the unit price                                       -> «SUBMIT sends exactly the contract»;
 *   send(): `{ repeat: true }` removed                                              -> «Qayta is a new request»;
 *   resolveEntry returns `catalog.models[0]` for an unknown id (no default)         -> «stale choice»;
 *   400 handler does not `reload(true)`                                             -> «a refused model»;
 *   StudioPage draws a «Video» tab                                                  -> «shell»;
 *   `otherModel` does not open the picker                                           -> «Boshqa modelda»;
 *   `otherModel` does not restore the prompt                                        -> «Boshqa modelda».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

beforeEach(() => {
  dropMediaCatalog();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: USER as never });
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  globalThis.fetch = realFetch;
  dropMediaCatalog();
  useUi.setState({ overlay: null, returnTo: null });
  useAppStore.setState({ loggedIn: false, sessionChecked: false, user: null, generations: [] });
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string) => q(sel)?.textContent ?? "";
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
const fieldNames = () => qa("[data-field]").map((e) => e.getAttribute("data-field")!);
const card = (m: ClientEntry) => q(`[data-model-card="${m.id}"]`);
const pickModel = (m: ClientEntry) => click(card(m));
const pickCount = (n: number) => click(qa('[data-field="imageCount"] [role="radio"]').find((b) => b.textContent === String(n)));
const prompt = () => q<HTMLTextAreaElement>('[data-field="prompt"] textarea')!;
async function typePrompt(value: string) {
  await act(async () => void fireEvent.change(prompt(), { target: { value } }));
}
const submit = () => click(q("[data-studio-submit]"));
const label = (n: number, price: number) => `Yaratish · ${n} ta rasm · ${formatSom(price)}`;

test("shell: «Studio» header, subtitle, «Galereya» link and the «Rasm» tab only — no Video / Ovoz / templates decoration", async () => {
  installApi();
  await mount();
  assert.equal(text("[data-page-header] h1"), "Studio");
  assert.ok(text("[data-page-header]").length > "Studio".length, "a subtitle");
  assert.match(text("[data-studio-gallery-link]"), /Galereya/);
  const tabs = qa('[role="tab"]');
  assert.deepEqual(tabs.map((t) => t.textContent), ["Rasm"], "MUTATSIYA: Video tabi chizilsa qizaradi");
  assert.equal(tabs[0]!.getAttribute("aria-selected"), "true");
  const page = document.body.textContent ?? "";
  for (const word of ["Video", "Ovoz", "Namuna promptlar", "Shablonlar", "tez orada"]) assert.ok(!page.includes(word), `no «${word}»`);
  assert.ok(prompt(), "the prompt box");
  assert.equal(q("[data-model-picker]")?.querySelectorAll("[data-model-card]").length, 2);
});

test("logged out: the login opens with returnTo /uz/studio; session not known yet: only «Yuklanmoqda», no request", async () => {
  const api = installApi();
  useAppStore.setState({ sessionChecked: false, loggedIn: false, user: null });
  await mount();
  assert.match(document.body.textContent ?? "", /Yuklanmoqda/);
  assert.equal(api.calls.length, 0, "nothing is requested before the session is known");
  cleanup();
  useAppStore.setState({ sessionChecked: true, loggedIn: false, user: null });
  await mount();
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/studio");
});

test("unavailable model is not offered; a stale choice falls back to the server's default", async () => {
  installApi({ catalog: catalogBody([GPT], PRICING, GPT.id) });
  await mount();
  assert.ok(!card(NANO), "Nano Banana is not offered");
  assert.equal(card(GPT)?.getAttribute("aria-checked"), "true");
  assert.deepEqual(qa("[data-model-card]").map((e) => e.getAttribute("data-model-card")), [GPT.id]);
});

test("a refused model (400 before charging) re-reads the catalog: the choice falls back to the default, nothing is queued", async () => {
  let reads = 0;
  const api = installApi({
    catalog: () => json(200, catalogBody(reads++ === 0 ? [NANO, GPT] : [NANO], PRICING, NANO.id)),
    create: () => json(400, { error: "Bu model hozir mavjud emas" }),
  });
  await mount();
  await pickModel(GPT);
  assert.equal(card(GPT)?.getAttribute("aria-checked"), "true");
  await typePrompt("Registon maydoni kechqurun");
  await submit();
  await settle();
  assert.match(text("[data-studio-error]"), /Bu model hozir mavjud emas/);
  assert.equal(api.catalogCalls().length, 2, "MUTATSIYA: 400 da katalog qayta o'qilmasa qizaradi");
  assert.ok(!card(GPT), "the model is gone from the list");
  assert.equal(card(NANO)?.getAttribute("aria-checked"), "true", "the stale choice fell back to the default");
  assert.ok(!q("[data-studio-job]"), "no job");
});

test("catalog states: empty list is said honestly; a failed read offers «Qayta urinish» that reads again", async () => {
  installApi({ catalog: catalogBody([], PRICING, undefined) });
  await mount();
  assert.match(text("[data-model-empty]"), /mavjud emas/);
  assert.ok(!q("[data-studio-submit]"), "no price to promise without a model");
  cleanup();
  dropMediaCatalog();
  let fail = true;
  const api = installApi({ catalog: () => (fail ? json(500, {}) : json(200, catalogBody([NANO, GPT]))) });
  await mount();
  assert.ok(q("[data-studio-catalog-error]"), "error state");
  fail = false;
  await click(q("[data-studio-catalog-error] button"));
  await settle();
  assert.ok(prompt(), "the form is there after the retry");
  assert.equal(api.catalogCalls().length, 2);
});

test("switching the model re-renders the settings and the price; the prompt and values the new model accepts stay", async () => {
  const narrow = withParams(GPT, "test/narrow", [
    ...GPT.params.map((p) => (p.name === "imageRatio" && p.type === "enum" ? { ...p, options: p.options.filter((o) => o.value === "1:1" || o.value === "16:9"), default: "1:1" } : p)),
  ]);
  installApi({ catalog: catalogBody([NANO, narrow]) });
  await mount();
  await typePrompt("Buxoro, Poi Kalon");
  await click(qa('[data-field="imageRatio"] [role="radio"]').find((b) => b.textContent === "9:16"));
  await pickCount(2);
  const ratios = () => qa('[data-field="imageRatio"] [role="radio"]').map((b) => b.textContent);
  assert.equal(ratios().length, 6);
  const before = text("[data-studio-submit]");
  await pickModel(narrow);
  assert.deepEqual(ratios(), ["1:1", "16:9"], "the settings are the new model's");
  assert.equal(prompt().value, "Buxoro, Poi Kalon", "the prompt stays");
  assert.equal(qa('[data-field="imageRatio"] [role="radio"]').find((b) => b.getAttribute("aria-checked") === "true")?.textContent, "1:1", "9:16 is not offered: the new default");
  const count = qa('[data-field="imageCount"] [role="radio"]').find((b) => b.getAttribute("aria-checked") === "true");
  assert.equal(count?.textContent, "2", "the count both accept stays");
  assert.notEqual(text("[data-studio-submit]"), before, "the price follows the model");
  assert.equal(text("[data-studio-submit]"), label(2, expectedPrice(narrow, 2)));
  assert.deepEqual(fieldNames().sort(), ["imageCount", "imageRatio", "imageStyle", "prompt"], "each param once");
});

test("PRICE: the button and every card equal the formula (cost × markup, rounded up to 100) for each model × count", async () => {
  installApi();
  await mount();
  for (const m of [NANO, GPT]) {
    await pickModel(m);
    for (const n of [1, 2, 3, 4]) {
      await pickCount(n);
      assert.equal(text("[data-studio-submit]"), label(n, expectedPrice(m, n)), `${m.id} × ${n}`);
    }
    // Cards show the price of ONE picture whatever the count is.
    for (const other of [NANO, GPT]) assert.match(text(`[data-model-card="${other.id}"] [data-model-price]`), new RegExp(`~${groupDigits(expectedPrice(other, 1))} so'm / rasm`));
  }
  // Rounding really goes UP: 0.034 × 12 800 × 2 = 870.4 → 900, not 870.
  assert.equal(expectedPrice(NANO, 1), 900);
});

test("PRICE: the global markup and a per-model override change the numbers (override wins for its model)", async () => {
  const pricing = { soumPerUsd: 12_800, markup: 3, step: 100, overrides: { [GPT.id]: { markup: 5 } } };
  installApi({ catalog: catalogBody([NANO, GPT], pricing) });
  await mount();
  await pickModel(NANO);
  await pickCount(2);
  assert.equal(text("[data-studio-submit]"), label(2, expectedPrice(NANO, 2, pricing)), "global ×3");
  await pickModel(GPT);
  assert.equal(text("[data-studio-submit]"), label(2, expectedPrice(GPT, 2, pricing)), "override ×5");
  assert.notEqual(expectedPrice(GPT, 2, pricing), expectedPrice(GPT, 2, { ...pricing, overrides: {} }));
});

test("SUBMIT sends exactly the contract: slug studio, {modelId, prompt, imageStyle, imageRatio, imageCount}, the shown price", async () => {
  const api = installApi();
  await mount();
  await pickModel(GPT);
  await typePrompt("  Registon   maydoni,\n kechqurun  ");
  await pickCount(3);
  await click(qa('[data-field="imageRatio"] [role="radio"]').find((b) => b.textContent === "16:9"));
  await act(async () => void fireEvent.change(q('[data-field="imageStyle"] select')!, { target: { value: "cinematic" } }));
  const shown = expectedPrice(GPT, 3);
  assert.equal(text("[data-studio-submit]"), label(3, shown));
  await submit();
  await settle();
  const posts = api.posts();
  assert.equal(posts.length, 1);
  const body = posts[0]!.body!;
  assert.equal(body.slug, "studio");
  assert.deepEqual(body.values, {
    modelId: GPT.id,
    prompt: "Registon maydoni, kechqurun",
    imageStyle: "cinematic",
    imageRatio: "16:9",
    imageCount: 3,
  }, "MUTATSIYA: values ga topic qo'shilsa / sxemadan tashqari kalit chiqsa qizaradi");
  assert.equal(body.expectedPrice, shown, "MUTATSIYA: expectedPrice birlik narx bo'lsa qizaradi");
  assert.ok(posts[0]!.key, "an Idempotency-Key");
  assert.ok(!("price" in body), "the client never sends a price to charge");
  assert.ok(q("[data-studio-job]"), "the job is followed on the page");
});

test("a prompt shorter than the schema's minimum sends nothing and says so", async () => {
  const api = installApi();
  await mount();
  await typePrompt("  a ");
  await submit();
  await settle();
  assert.equal(api.posts().length, 0);
  assert.match(text("[data-studio-error]"), /Nima chizish kerakligini yozing/);
});

test("the prompt box limit comes from the schema's text param (counter + cut)", async () => {
  installApi();
  await mount();
  assert.match(text("[data-counter]"), new RegExp(`0 / ${groupDigits(IMAGE_PROMPT_LIMIT)}`));
  await typePrompt("x".repeat(IMAGE_PROMPT_LIMIT + 30));
  assert.equal(prompt().value.length, IMAGE_PROMPT_LIMIT);
  assert.equal(prompt().getAttribute("maxlength"), String(IMAGE_PROMPT_LIMIT));
});

test("a running job shows the app's progress panel; a finished one its pictures with the three actions", async () => {
  const api = installApi({ generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Rasm chizilmoqda", doc: null }) });
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await settle();
  assert.ok(q("[data-generation-progress]"), "the progress panel");
  assert.match(text("[data-progress-percent]"), /40/);
  assert.equal(q("[data-studio-job]")?.getAttribute("data-job-status"), "IN_PROGRESS");
  assert.equal(api.posts().length, 1);

  cleanup();
  dropMediaCatalog();
  installApi();
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await waitFor(() => assert.ok(q("[data-studio-pictures]")));
  const img = q<HTMLImageElement>("[data-studio-picture] img")!;
  assert.match(img.getAttribute("src") ?? "", /^\/api\/generations\/.+\/assets\//);
  const actions = qa("[data-result-action]").map((b) => b.getAttribute("data-result-action"));
  assert.deepEqual(actions, ["download", "again", "other-model"]);
  assert.match(text("[data-studio-job-meta]"), new RegExp(`Nano Banana · ${groupDigits(expectedPrice(NANO, 1))} so'm`));
  assert.ok(q("[data-result-open]")?.getAttribute("href")?.startsWith("/uz/files/"), "the full result page");
});

test("failed job: the server's text, «Qayta urinish» sends the same request again; a short delivery says what came back", async () => {
  const api = installApi({
    generation: (id, n) => (n === 0 && api.created.length === 1 ? generationDetail(id, { status: "FAILED", error: "Rasm yaratilmadi — pul qaytarildi", doc: null }) : generationDetail(id)),
  });
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await waitFor(() => assert.ok(q("[data-studio-failed]")));
  assert.match(text("[data-studio-failed]"), /pul qaytarildi/);
  await click(q('[data-studio-failed] [data-result-action="again"]'));
  await waitFor(() => assert.equal(api.posts().length, 2));
  assert.deepEqual(api.posts()[1]!.body!.values, api.posts()[0]!.body!.values);

  cleanup();
  dropMediaCatalog();
  installApi({ generation: (id) => generationDetail(id, { delivered: { got: 1, want: 2 } }) });
  await mount();
  await typePrompt("Registon kechqurun");
  await pickCount(2);
  await submit();
  await waitFor(() => assert.ok(q("[data-studio-delivered]")));
  assert.match(text("[data-studio-delivered]"), /2 tadan 1 ta rasm tayyor bo‘ldi/);
});

test("«Qayta» is a NEW request (new idempotency key, same values, same shown price), not a replay of the first one", async () => {
  const api = installApi();
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await waitFor(() => assert.ok(q("[data-studio-pictures]")));
  await click(q('[data-result-action="again"]'));
  await waitFor(() => assert.equal(api.posts().length, 2));
  const [a, b] = api.posts();
  assert.deepEqual(b!.body!.values, a!.body!.values);
  assert.equal(b!.body!.expectedPrice, a!.body!.expectedPrice);
  assert.ok(a!.key && b!.key);
  assert.notEqual(b!.key, a!.key, "MUTATSIYA: repeat olib tashlansa qizaradi (30 s ichida bir xil kalit)");
  await waitFor(() => assert.equal(qa("[data-studio-job]").length, 2), { timeout: 2000 });
  // The same press twice in a row (a double click) while the first is in flight is ONE request: the button waits.
  assert.equal(api.posts().length, 2);
});

test("«Boshqa modelda»: the same prompt is back in the form and the model picker is open", async () => {
  installApi();
  await mount();
  await typePrompt("Samarqand Registon maydoni");
  await submit();
  await waitFor(() => assert.ok(q("[data-studio-pictures]")));
  await typePrompt("boshqa matn");
  assert.ok(!q("[data-model-sheet]"));
  await click(q('[data-result-action="other-model"]'));
  assert.ok(q("[data-model-sheet]"), "MUTATSIYA: picker ochilmasa qizaradi");
  assert.equal(prompt().value, "Samarqand Registon maydoni", "MUTATSIYA: prompt qaytarilmasa qizaradi");
  // The user picks the other model and the form follows.
  await click(q(`[data-model-option="${GPT.id}"]`));
  await click(q("[data-model-confirm]"));
  assert.ok(!q("[data-model-sheet]"));
  assert.equal(card(GPT)?.getAttribute("aria-checked"), "true");
});

test("balance: a line under the button; below the price it says so BEFORE the press with the top-up link", async () => {
  installApi();
  await mount();
  assert.equal(text("[data-studio-balance]"), `Balans: ${formatSom(USER.balance)}`);
  assert.ok(!q("[data-balance-short]"));
  cleanup();
  dropMediaCatalog();
  useAppStore.setState({ user: { ...USER, balance: 500 } as never });
  installApi();
  await mount();
  assert.ok(q("[data-balance-short]"), "short");
  assert.ok(!q("[data-studio-balance]"));
  assert.match(text("[data-balance-short]"), new RegExp(`${groupDigits(500)} so'm`));
  assert.ok(q("[data-balance-short] a[data-topup]")?.getAttribute("href")?.startsWith("/uz/wallet"));
});

test("402 from the server: the message and the top-up link; nothing is queued", async () => {
  const api = installApi({ create: () => json(402, { error: "Balans yetarli emas. Kerak: 900, mavjud: 100" }) });
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await settle();
  assert.match(text("[data-studio-error]"), /Balans yetarli emas/);
  assert.ok(q("[data-studio-error] a[data-topup]"));
  assert.equal(api.posts().length, 1);
  assert.ok(!q("[data-studio-job]"));
});

test("409 price_changed: the new price is in the message, no job, and the displayed price was sent as expectedPrice", async () => {
  const api = installApi({ create: () => json(409, { error: "Narx o'zgardi", code: "price_changed", price: 1300 }) });
  await mount();
  await typePrompt("Registon kechqurun");
  await submit();
  await settle();
  assert.match(text("[data-studio-error]"), new RegExp(`Yangi narx: ${groupDigits(1300)} so'm`));
  assert.equal(api.posts()[0]!.body!.expectedPrice, expectedPrice(NANO, 1));
  assert.ok(!q("[data-studio-job]"));
});

test("«Galereya» switches to the gallery view and back; the form is not drawn in the gallery", async () => {
  const api = installApi({ gallery: { "": { items: [], nextCursor: null } } });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  assert.ok(q("[data-studio-gallery]"));
  assert.ok(!q("[data-studio-form]"), "the form is hidden");
  assert.ok(api.calls.some((c) => c.url.startsWith("/api/media/gallery")));
  assert.ok(q("[data-gallery-empty]"));
  await click(q("[data-studio-create-link]"));
  assert.ok(q("[data-studio-form]"));
  assert.ok(!q("[data-studio-gallery]"));
});
