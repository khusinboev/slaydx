import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ClientEntry } from "../../lib/studio-core/index.ts";
import { GPT, NANO, PRICING, USER, catalogBody, installApi } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom, groupDigits } = await import("../../lib/format.ts");
const { MEDIA_CATALOG } = await import("../../lib/media/catalog.ts");

/**
 * Studio P2a (docs/studio/P2-SPEC.md): the page with the REAL 8-model catalog (Nano Banana, GPT Image + the six fal
 * models), no UI change needed — everything is drawn from the catalog's client view.
 *
 * Locked here:
 *   - the row shows 3 cards, «Barcha modellar» lists all eight in catalog order, the chips are the badges the eight
 *     carry, a chip narrows the list, «Tanlash» picks a fal model;
 *   - every card / option shows the price of ONE picture per model at ×2, 12 800 so'm/$ (hand-computed, not the
 *     product's formula);
 *   - picking Ideogram adds its «Sifat» row under «Qo'shimcha sozlamalar»; «Yuqori» moves the button price to the
 *     high-quality price × count; the request carries `quality`; a model without the param never sends it.
 *
 * Mutations (each turned the named tests red, then restored):
 *   Ideogram's `quality` param removed from the catalog          -> the file fails to load (defineCatalog: cost reads an unknown param);
 *   Ideogram's cost `by` table removed                           -> «Ideogram: the Sifat row…» (price stays 1 600 × n);
 *   a fal model dropped from `studio.image.allowed`              -> «eight models…» (the real-catalog list).
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const FAL = ["bfl/flux", "bytedance/seedream", "bytedance/seedream-pro", "ideogram/ideogram", "recraft/recraft", "recraft/recraft-pro"].map(by);
const EIGHT: ClientEntry[] = [NANO, GPT, ...FAL];
/** Hand-computed price of one picture at ×2 and 12 800 so'm/$, rounded up to 100. */
const ONE: Record<string, number> = {
  "google/nano-banana": 900, // 0.034 → 870.4
  "openai/gpt-image": 1400, // 0.053 → 1 356.8
  "bfl/flux": 1300, // 0.048 → 1 228.8
  "bytedance/seedream": 900, // 0.035 → 896
  "bytedance/seedream-pro": 1800, // 0.0675 → 1 728
  "ideogram/ideogram": 1600, // medium 0.06 → 1 536
  "recraft/recraft": 900, // 0.035 → 896
  "recraft/recraft-pro": 5400, // 0.21 → 5 376
};

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
const options = () => qa("[data-model-option]").map((e) => e.getAttribute("data-model-option"));
const label = (n: number, price: number) => `Yaratish · ${n} ta rasm · ${formatSom(price)}`;
const pickCount = (n: number) => click(qa('[data-field="imageCount"] [role="radio"]').find((b) => b.textContent === String(n)));
async function choose(id: string) {
  await click(q("[data-model-all]"));
  await click(q(`[data-model-option="${id}"]`));
  await click(q("[data-model-confirm]"));
  await settle();
}

test("eight models: row of 3, the sheet lists all eight with their own price, chips from their badges, a fal pick", async () => {
  // The real Studio purpose sells exactly these eight, in this order.
  const { MEDIA_PURPOSES, STUDIO_IMAGE_PURPOSE } = await import("../../lib/media/catalog.ts");
  assert.deepEqual(MEDIA_PURPOSES.byId(STUDIO_IMAGE_PURPOSE)!.allowed, EIGHT.map((m) => m.id));
  installApi({ catalog: catalogBody(EIGHT, PRICING, NANO.id) });
  await mount();
  assert.equal(qa("[data-model-picker] [data-model-card]").length, 3);
  await click(q("[data-model-all]"));
  assert.deepEqual(options(), EIGHT.map((m) => m.id));
  for (const m of EIGHT) {
    assert.equal(q(`[data-model-option="${m.id}"] [data-model-price]`)?.textContent?.replace(/\D/g, ""), String(ONE[m.id]), `${m.id}: price of one picture`);
    assert.match(q(`[data-model-option="${m.id}"]`)!.textContent ?? "", new RegExp(m.label.replace(/[()]/g, ".")), `${m.id}: label`);
  }
  assert.deepEqual(qa("[data-model-chip]").map((e) => e.getAttribute("data-model-chip")), ["all", "tez", "sifatli", "arzon", "matn"]);
  await click(q('[data-model-chip="matn"]'));
  assert.deepEqual(options(), ["openai/gpt-image", "ideogram/ideogram"]);
  await click(q('[data-model-chip="arzon"]'));
  assert.deepEqual(options(), ["google/nano-banana", "bytedance/seedream", "recraft/recraft"]);
  await click(q('[data-model-chip="sifatli"]'));
  assert.deepEqual(options(), ["openai/gpt-image", "bfl/flux", "bytedance/seedream-pro", "ideogram/ideogram", "recraft/recraft-pro"]);
  await click(q('[data-model-chip="arzon"]'));
  await click(q('[data-model-option="recraft/recraft"]'));
  await click(q("[data-model-confirm]"));
  await settle();
  assert.equal(qa("[data-model-card]").find((e) => e.getAttribute("aria-pressed") === "true")?.getAttribute("data-model-card"), "recraft/recraft");
  await pickCount(3);
  assert.equal(text("[data-studio-submit]"), label(3, 2700), "0.035 × 3 × 12 800 × 2 = 2 688 → 2 700");
  assert.ok(!q('[data-field="quality"]'), "Recraft has no «Sifat» row");
  void groupDigits;
});

test("Ideogram: the «Sifat» row under «Qo'shimcha sozlamalar» changes the price and reaches the request", async () => {
  const api = installApi({ catalog: catalogBody(EIGHT, PRICING, NANO.id) });
  await mount();
  await choose("ideogram/ideogram");
  const details = q<HTMLDetailsElement>('details[data-settings="studio-advanced"]');
  assert.ok(details?.querySelector('[data-field="quality"]'), "advanced row");
  assert.equal(qa('[data-field="quality"]').length, 1, "exactly one data-field");
  await pickCount(2);
  assert.equal(text("[data-studio-submit]"), label(2, 3100), "medium: 0.06 × 2 × 12 800 × 2 = 3 072 → 3 100");
  await click(qa('[data-field="quality"] [role="radio"]').find((b) => b.textContent === "Yuqori"));
  assert.equal(text("[data-studio-submit]"), label(2, 11300), "high: 0.22 × 2 × 12 800 × 2 = 11 264 → 11 300");
  await click(qa('[data-field="quality"] [role="radio"]').find((b) => b.textContent === "Tez"));
  assert.equal(text("[data-studio-submit]"), label(2, 1600), "low: 0.03 × 2 × 12 800 × 2 = 1 536 → 1 600");
  await click(qa('[data-field="quality"] [role="radio"]').find((b) => b.textContent === "Yuqori"));
  await act(async () => void fireEvent.change(q<HTMLTextAreaElement>('[data-field="prompt"] textarea')!, { target: { value: "Navro'z afishasi" } }));
  await click(q("[data-studio-submit]"));
  await settle();
  const body = api.posts()[0]!.body!;
  assert.deepEqual(body.values, { modelId: "ideogram/ideogram", prompt: "Navro'z afishasi", imageStyle: "photo", imageRatio: "1:1", imageCount: 2, quality: "high" });
  assert.equal(body.expectedPrice, 11300);
});
