import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom, groupDigits } = await import("../../lib/format.ts");

/**
 * Studio P4 «Video» tab (docs/studio/P4-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries:
 *   - the model sheet lists the five fal models (Wan 3.0, Seedance 2.5, Seedance 2.0 Mini, MiniMax H3, H3 Max Turbo) with
 *     their maker + honest badges and the clip price «~X so'm / 5 s»;
 *   - a fal model's form is its ParamSchema (one `data-field` each: length, «Sifat» resolution, aspect, sound where the
 *     model has it, start + end frame); the resolution moves the button price; the submit carries it;
 *   - the end-frame upload is drawn only for models that take one (not for Gemini Omni); an end frame without a start is
 *     refused before any request;
 *   - effects: «Quchoqlash» shows a SECOND photo input (absent for the one-photo scenes); without it nothing is sent; with
 *     it both photos go out; a one-photo scene never sends a second.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. VideoTab shows the second photo for every scene                  -> «effects: Quchoqlash»;
 *   2. VideoTab sends `secondImageAssetId` for one-photo scenes        -> «effects: Quchoqlash»;
 *   3. end-frame card drawn for every model (hasEnd = true)            -> «text: end frame only where the model takes one»;
 *   4. (review N4) end-frame upload open without a start               -> «text: end frame only …»;
 *   5. removing the start frame keeps the end frame                    -> «text: end frame only …»;
 *   6. (review N3) aspect row kept with a start image (aspectHidden = false) -> «text: «O'lcham» hides …».
 * Review N3 / N4: «O'lcham» hides while a start image is set for models that follow the frame; the end-frame upload
 * waits for the start frame (the client's old end-without-start check became unreachable and was removed).
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const OMNI = by("google/omni-video");
const K3 = by("kling/kling-3");
const K3P = by("kling/kling-3-pro");
const FX = by("kling/effects");
const FAL = ["alibaba/wan-3", "bytedance/seedance-2.5", "bytedance/seedance-2-mini", "minimax/h3", "minimax/h3-max-turbo"].map(by);
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const ASSET = "0123456789abcdef01234567";

function api() {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) {
      base.calls.push({ url, method: "GET", body: null, key: null });
      return json(200, { purpose: "studio.video", defaultModelId: "google/omni-video", models: [OMNI, K3, K3P, ...FAL, FX], pricing: RATE });
    }
    if (url.startsWith("/api/uploads/photo")) return json(200, { assetId: ASSET, originalAssetId: "" });
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, points: 0, balance: 900_000 } as never });
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
  useAppStore.setState({ loggedIn: false, sessionChecked: false, user: null, generations: [] });
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
const tab = (t: "rasm" | "video") => click(q(`[data-studio-tab="${t}"]`));
const button = () => q("[data-studio-submit]")?.textContent ?? "";
const mode = (label: string) => click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === label));
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel)!;
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const radio = (field: string, label: string) => qa(`[data-field="${field}"] [role="radio"]`).find((b) => b.textContent === label);

/** jsdom has no canvas / image decoding: the minimum the crop dialog needs (as video-composer.test.mts). */
function stubCanvas() {
  const g = globalThis as unknown as Record<string, unknown>;
  class FakeImage {
    naturalWidth = 800;
    naturalHeight = 1000;
    width = 800;
    height = 1000;
    crossOrigin = "";
    onload: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  g.Image = FakeImage;
  const proto = (document.createElement("canvas").constructor as unknown as { prototype: Record<string, unknown> }).prototype;
  proto.getContext = () => ({ clearRect() {}, drawImage() {}, save() {}, restore() {}, beginPath() {}, arc() {}, closePath() {}, clip() {} });
  proto.toBlob = (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(500)], { type: "image/jpeg" }));
  (URL as unknown as Record<string, unknown>).createObjectURL = () => "blob:stub";
  (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
}
async function upload(field: string) {
  stubCanvas();
  const input = q<HTMLInputElement>(`[data-field="${field}"] input[type="file"]`);
  assert.ok(input, `file input of ${field}`);
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(500)], "p.jpg", { type: "image/jpeg" })] } });
  });
  const done = await screen.findByText("Tayyor");
  await waitFor(() => assert.ok(!(done as HTMLButtonElement).closest("button")!.disabled));
  await act(async () => void fireEvent.click(done));
  await waitFor(() => assert.ok(q(`[data-field="${field}"] img`), `${field} uploaded`));
}
async function pickModel(id: string) {
  await click(q("[data-model-all]"));
  await click(q(`[data-model-option="${id}"]`));
  await click(q("[data-model-confirm]"));
  await settle();
}

test("sheet: the five fal models with maker, honest badges and «~X so'm / 5 s»", async () => {
  api();
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  await click(q("[data-model-all]"));
  const options = qa("[data-model-option]").map((o) => o.dataset.modelOption);
  assert.deepEqual(options, [OMNI.id, K3.id, K3P.id, ...FAL.map((e) => e.id)], "video models only, catalog order; the effects are not a picker model");
  const text = (id: string) => q(`[data-model-option="${id}"]`)!.textContent ?? "";
  const price = (id: string) => q(`[data-model-option="${id}"] [data-model-price]`)!.textContent ?? "";
  // P11 §D ModelSpecs: the maker, then what the schema allows (seconds.max, the top resolution, the sound default, the
  // frames it takes), then the badges as words — never a hand-written line per model.
  assert.match(text("alibaba/wan-3"), /Wan 3\.0.*Alibaba · 10 s gacha · 1080p · ovoz bilan · suratdan · oxirgi kadr · Ovozli/);
  assert.match(text("bytedance/seedance-2.5"), /Seedance 2\.5.*ByteDance · 10 s gacha · 720p · ovoz bilan · suratdan · oxirgi kadr · Sifatli, Ovozli/);
  assert.match(text("minimax/h3-max-turbo"), /MiniMax H3 Max Turbo.*MiniMax · 10 s gacha · 1080p · suratdan · oxirgi kadr · Arzon/);
  // Default lengths (5 s) and tiers (720p / 768p): $/s × 5 × 12 700 × 2.
  assert.equal(price("alibaba/wan-3"), `~${groupDigits(12_700)} so'm / 5 s`);
  assert.equal(price("bytedance/seedance-2.5"), `~${groupDigits(60_100)} so'm / 5 s`);
  assert.equal(price("bytedance/seedance-2-mini"), `~${groupDigits(19_700)} so'm / 5 s`);
  assert.equal(price("minimax/h3"), `~${groupDigits(7_700)} so'm / 5 s`);
  assert.equal(price("minimax/h3-max-turbo"), `~${groupDigits(5_100)} so'm / 5 s`);
  // The «Arzon» chip leads to the cheap ones (Kling 3.0 and the two MiniMax).
  await click(q('[data-model-chip="arzon"]'));
  assert.deepEqual(qa("[data-model-option]").map((o) => o.dataset.modelOption), [K3.id, "minimax/h3", "minimax/h3-max-turbo"]);
});

test("text: a fal model's form is its ParamSchema; «Sifat» moves the price; the submit carries resolution + sound", async () => {
  const a = api();
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  await pickModel("alibaba/wan-3");
  const WAN = by("alibaba/wan-3");
  const names = qa("[data-field]").map((e) => e.getAttribute("data-field")).sort();
  assert.deepEqual(names, WAN.params.map((p) => p.name).sort(), "one data-field per schema param (end frame included)");
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(12_700)}`);
  await click(radio("resolution", "480p"));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(6_400)}`);
  await click(radio("resolution", "1080p (Full HD)"));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.2 * 5 * 12_700 * 2))}`);
  // Sound is free on Wan: the switch does not move the price.
  await click(q('[data-field="sound"] [role="switch"]'));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(25_400)}`);
  await type("[data-video-prompt] textarea", "Registon tongda, kamera sekin");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: "alibaba/wan-3", prompt: "Registon tongda, kamera sekin", seconds: 5, resolution: "1080p", aspect: "16:9", sound: false, imageAssetId: "", endImageAssetId: "", aiImprove: true });
  assert.equal(sent.expectedPrice, 25_400);
  // MiniMax H3: no sound row (the model makes none), 768p default.
  await pickModel("minimax/h3");
  assert.ok(!q('[data-field="sound"]'));
  assert.ok(radio("resolution", "768p")!.getAttribute("aria-checked") === "true");
});

test("text: end frame only where the model takes one; its upload waits for the start frame; removing the start clears it", async () => {
  const a = api();
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  assert.ok(q('[data-field="imageAssetId"]'), "Omni: the start image");
  assert.ok(!q('[data-field="endImageAssetId"]'), "MUTATSIYA: Omni takes no end frame — no second photo input");
  await pickModel(K3.id);
  assert.ok(q('[data-field="endImageAssetId"]'), "Kling 3.0 takes an end frame");
  // Review N4: no upload until the start frame exists.
  assert.ok(!q('[data-field="endImageAssetId"] input[type="file"]'), "MUTATSIYA: end-frame upload open without a start");
  assert.ok(q('[data-field="endImageAssetId"] [data-end-frame-locked]'));
  await type("[data-video-prompt] textarea", "Gul ochiladi, kamera yaqinlashadi");
  await upload("imageAssetId");
  assert.ok(!q("[data-end-frame-locked]"));
  await upload("endImageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!.values as Record<string, unknown>;
  assert.equal(sent.imageAssetId, ASSET);
  assert.equal(sent.endImageAssetId, ASSET);
  // Removing the start frame removes the end frame too: the next request carries neither.
  await click(qa('[data-field="imageAssetId"] button').find((b) => b.textContent === "Olib tashlash"));
  assert.ok(q('[data-field="endImageAssetId"] [data-end-frame-locked]'));
  await click(q("[data-studio-submit]"));
  await settle();
  const next = a.posts()[1]!.body!.values as Record<string, unknown>;
  assert.equal(next.imageAssetId, "");
  assert.equal(next.endImageAssetId, "", "MUTATSIYA: an end frame left without its start");
});

test("text: «O'lcham» hides while a start image is set for Kling 3.0 / fal models (they follow the frame); Omni keeps it", async () => {
  api();
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  await upload("imageAssetId");
  assert.ok(q('[data-field="aspect"]'), "Omni sends the aspect in image → video too");
  await pickModel("alibaba/wan-3");
  assert.ok(!q('[data-field="aspect"]'), "MUTATSIYA: Wan + start image still shows the aspect row");
  await pickModel(K3.id);
  assert.ok(!q('[data-field="aspect"]'));
  await click(qa('[data-field="imageAssetId"] button').find((b) => b.textContent === "Olib tashlash"));
  assert.ok(q('[data-field="aspect"]'), "no start image: the aspect row is back");
});

test("effects: «Quchoqlash» asks for a second photo (absent for one-photo scenes); both photos go out; one-photo scenes send one", async () => {
  const a = api();
  await mount();
  await tab("video");
  await settle();
  assert.ok(q('[data-effect="hug_pro"]'), "the scene is in the grid");
  assert.ok(!q('[data-field="secondImageAssetId"]'), "MUTATSIYA: a one-photo scene shows no second input");
  await click(q('[data-effect="hug_pro"]'));
  assert.ok(q('[data-field="secondImageAssetId"]'));
  assert.equal(button(), `Yaratish · «Quchoqlash» · ${formatSom(21_400)}`);
  await upload("imageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 0, "the second photo is required");
  assert.match(q("[data-studio-error]")?.textContent ?? "", /ikkinchi suratni/);
  await upload("secondImageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.deepEqual(a.posts()[0]!.body!.values, { modelId: FX.id, effect: "hug_pro", imageAssetId: ASSET, secondImageAssetId: ASSET });
  // Back to a one-photo scene: no second input, and the request carries one photo only.
  await click(q('[data-effect="snowglobe"]'));
  assert.ok(!q('[data-field="secondImageAssetId"]'));
  await click(q("[data-studio-submit]"));
  await settle();
  assert.deepEqual(a.posts()[1]!.body!.values, { modelId: FX.id, effect: "snowglobe", imageAssetId: ASSET }, "MUTATSIYA: one-photo scene sends the second photo");
});
