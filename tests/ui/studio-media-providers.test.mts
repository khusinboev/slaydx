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
const { formatSom } = await import("../../lib/format.ts");

/**
 * Studio P11 package F in the Video tab, the API stubbed at `fetch`, the REAL catalog entries (the admin's switches are the
 * catalog endpoint's answer here):
 *   - effects: one provider = no row; several = a row with each price; the provider, then its effects; the button's price and
 *     the request follow the provider; the fal hug is one photo with its own hint;
 *   - video: a model's form is its ParamSchema, no «Sifat» row for one tier, Grok's price moves with the start image;
 *   - photo avatars: no script box, the speech picker lists only what the model takes, photo and speech are required before any
 *     request, the length and the price come from the speech.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. the provider row drawn for a single provider                    -> «effects: one provider»;
 *   2. the request keeps the first provider (`entry = split.effects`)  -> «effects: the provider»;
 *   3. a fal hug asks for a second photo (`effectPhotos` without the model) -> «effects: the fal hug»;
 *   4. the prompt box stays for a photo avatar                         -> «photo avatars: form»;
 *   5. the photo avatar's speech list keeps a 3 s speech (OmniHuman)   -> «photo avatars: form»;
 *   6. a photo avatar without its photo reaches the server             -> «photo avatars: refused in the form»;
 *   7. «Yo‘q — matnni avatar o‘qiydi» offered on a photo avatar        -> «photo avatars: form».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const OMNI = by("google/omni-video");
const PIXFX = by("pixverse/effects");
const KFX = by("kling/effects-v16");
const GROK = by("xai/grok-imagine-lite");
const HORSE = by("alibaba/happy-horse");
const PIX6 = by("pixverse/v6");
const HUMAN = by("bytedance/omnihuman-2");
const KAV = by("kling/ai-avatar-2");
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const ASSET = "0123456789abcdef01234567";
const SPEECH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SHORT = "11111111-2222-4333-8444-555555555555";
const LONG = "66666666-7777-4888-8999-000000000000";
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;

function api(models: unknown[]) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) return json(200, { purpose: "studio.video", defaultModelId: "google/omni-video", models, pricing: RATE });
    if (url.startsWith("/api/media/mix-sources")) {
      return json(200, {
        price: 500,
        video: [],
        audio: [],
        music: [],
        speech: [
          { id: SPEECH, title: "Salomlashish", kind: "Ovoz", seconds: 7.04, createdAt: "2026-11-03T10:00:00.000Z" },
          { id: SHORT, title: "Qisqa", kind: "Ovoz", seconds: 3, createdAt: "2026-11-03T09:00:00.000Z" },
          { id: LONG, title: "Uzun", kind: "Ovoz", seconds: 45, createdAt: "2026-11-02T10:00:00.000Z" },
        ],
      });
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
async function open() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
  await click(q('[data-studio-tab="video"]'));
  await settle();
}
const button = () => q("[data-studio-submit]")?.textContent ?? "";
const mode = (label: string) => click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === label));
async function pickModel(id: string) {
  await click(q("[data-model-all]"));
  await click(q(`[data-model-option="${id}"]`));
  await click(q("[data-model-confirm]"));
  await settle();
}
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

/* ── effects ── */

test("effects: one provider, no provider row and its own effects", async () => {
  api([OMNI, PIXFX]);
  await open();
  await mode("Shablon effektlar");
  assert.ok(!q("[data-effect-providers]"), "nothing to choose");
  assert.equal(qa("[data-effect]").length, 12);
  assert.ok(q('[data-effect="Liquid Metal"]'));
});

test("effects: the provider, then its effects; the price and the request follow the provider", async () => {
  const a = api([OMNI, PIXFX, KFX]);
  await open();
  await mode("Shablon effektlar");
  const row = qa("[data-effect-provider]");
  assert.deepEqual(row.map((b) => b.dataset.effectProvider), [PIXFX.id, KFX.id]);
  assert.match(row[0]!.textContent!, /PixVerse/);
  assert.match(row[0]!.textContent!, /5\s*100/, "$0.20 × 12 700 × 2 = 5 080 → 5 100");
  assert.match(row[1]!.textContent!, /7\s*200/, "$0.28 × 12 700 × 2 = 7 112 → 7 200");
  assert.equal(row[0]!.getAttribute("aria-pressed"), "true");
  assert.equal(qa("[data-effect]").length, 12);
  assert.match(button(), new RegExp(`«Robot».*${formatSom(5_100).replace(/\s/g, "\\s")}`));

  await click(row[1]);
  assert.equal(qa("[data-effect-provider]")[1]!.getAttribute("aria-pressed"), "true");
  assert.equal(qa("[data-effect]").length, 10, "the nine scenes and the hug");
  assert.ok(q('[data-effect="snowglobe"]'));
  assert.ok(!q('[data-effect="Liquid Metal"]'), "a provider shows only its own effects");
  assert.match(button(), /Tug‘ilgan kun/, "a scene of the other provider falls back to the first");
  assert.equal(button().includes(formatSom(7_200)), true);

  await click(q('[data-effect="snowglobe"]'));
  await upload("imageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: KFX.id, effect: "snowglobe", imageAssetId: ASSET });
  assert.equal(sent.expectedPrice, 7_200);
});

test("effects: the fal hug is one photo, and the hint asks for two people in it", async () => {
  const a = api([OMNI, KFX]);
  await open();
  await mode("Shablon effektlar");
  assert.ok(!q("[data-effect-note]"), "a one-person scene says nothing");
  await click(q('[data-effect="hug_pro"]'));
  assert.ok(!q('[data-field="secondImageAssetId"]'), "fal's page: exactly one image");
  assert.equal(q("[data-effect-note]")?.textContent, "Bitta suratda ikki kishi birga ko‘rinsin");
  await upload("imageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.deepEqual(a.posts()[0]!.body!.values, { modelId: KFX.id, effect: "hug_pro", imageAssetId: ASSET });
});

/* ── video ── */

test("video: one data-field per row, no «Sifat» row for one tier, Happy Horse's tier and Grok's start image move the price", async () => {
  api([OMNI, GROK, PIX6, HORSE]);
  await open();
  await pickModel(GROK.id);
  assert.ok(!q('[data-field="resolution"]'), "no decorative row");
  assert.ok(!q('[data-field="endImageAssetId"]'));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.15 * 12_700 * 2))}`);
  await upload("imageAssetId");
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.16 * 12_700 * 2))}`, "the page's $0.01 per input image");
  assert.ok(!q('[data-field="aspect"]'), "the frame decides");
  await pickModel(PIX6.id);
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.225 * 12_700 * 2))}`);
  await click(q('[data-field="sound"] [role="switch"]'));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.3 * 12_700 * 2))}`, "sound is priced");
  await pickModel(HORSE.id);
  assert.ok(q('[data-field="resolution"]'));
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(up100(0.7 * 12_700 * 2))}`);
});

/* ── photo avatars ── */

test("photo avatars: form — no script box, no voice-less option, only the speeches the model takes, the price from the speech", async () => {
  const a = api([OMNI, HUMAN, KAV]);
  await open();
  await pickModel(HUMAN.id);
  assert.ok(!q("[data-video-prompt]"), "no script: the words are the speech");
  const select = q<HTMLSelectElement>('[data-field="audioId"] select');
  assert.ok(select, "the speech picker");
  assert.deepEqual([...select.options].map((o) => o.value), ["", SPEECH], "3 s is under OmniHuman's 4, 45 s over the 30 s cap");
  assert.equal(select.options[0]!.textContent, "Ovozni tanlang");
  assert.equal(select.options[1]!.textContent, "Salomlashish · 7 s", "the length it is priced at");
  assert.ok(q('[title*="4–30 soniya"]'), "the row states the model's limits");
  assert.ok(q('[data-field="imageAssetId"]'), "the photo upload");
  assert.ok(document.body.textContent!.includes("Avatar surati"));
  await act(async () => void fireEvent.change(select, { target: { value: SPEECH } }));
  await settle(2);
  const price = up100(0.105 * 7 * 12_700 * 2);
  assert.equal(button(), `Yaratish · 7 soniya · ${formatSom(price)}`);
  await upload("imageAssetId");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: HUMAN.id, audioId: SPEECH, imageAssetId: ASSET, seconds: 7 });
  assert.equal(sent.expectedPrice, price);
});

test("photo avatars: Kling states no minimum, so the short speech is offered there", async () => {
  api([OMNI, KAV]);
  await open();
  await pickModel(KAV.id);
  const select = q<HTMLSelectElement>('[data-field="audioId"] select')!;
  assert.deepEqual([...select.options].map((o) => o.value), ["", SPEECH, SHORT]);
});

test("photo avatars: refused in the form without a speech or a photo, nothing sent", async () => {
  const a = api([OMNI, HUMAN]);
  await open();
  await pickModel(HUMAN.id);
  await click(q("[data-studio-submit]"));
  await settle();
  assert.match(q("[data-studio-error]")!.textContent!, /ovozingizni tanlang/);
  await act(async () => void fireEvent.change(q<HTMLSelectElement>('[data-field="audioId"] select')!, { target: { value: SPEECH } }));
  await settle(2);
  await click(q("[data-studio-submit]"));
  await settle();
  assert.match(q("[data-studio-error]")!.textContent!, /suratini yuklang/);
  assert.equal(a.posts().length, 0);
});
