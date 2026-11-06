import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage, tabFromSearch } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom } = await import("../../lib/format.ts");
const { PHOTO_MAX_BYTES, photoHint } = await import("../../lib/photo-accept.ts");

/**
 * Studio «Video» tab (docs/studio/P3-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries.
 *
 * Locked here:
 *   - tabs: «Rasm» | «Video»; switching to Video and back keeps the Rasm prompt and model; `?tab=video` opens Video;
 *   - the video catalog (`purpose=studio.video`) is asked only once the tab is opened; a picture model in that answer is
 *     never offered;
 *   - effects: the 3×3 grid of the catalog's effect scenes with the 5 s badge, the chosen scene on the button
 *     («Yaratish · «Tug‘ilgan kun» · 21 400 so'm»), the photo is REQUIRED (no photo = no request);
 *   - text/image: «Matndan / rasmdan» shows the prompt, the model picker (video models only, «so'm / N s» cards) and the
 *     chosen model's settings; every schema param has exactly one `data-field`; length / sound move the button price;
 *   - submit sends slug `studio-video` + `{modelId, …schema}` + the displayed price as `expectedPrice`;
 *   - a finished clip plays from its own file URL; the paid balance (not bonus) is what the bar compares.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. Rasm state (`setRaw({})`) reset when the tab changes                    -> «tabs»;
 *   2. effect submit without the photo check                                   -> «effects grid»;
 *   3. the button names «effekt» instead of the chosen scene                   -> «effects grid»;
 *   4. picker cards without the video `priceOf` («so'm / rasm» wording)          -> «text form»;
 *   5. `parseCatalog` keeps picture models in the video purpose                -> «text form»;
 *   6. `videoAgain` without `chosen: item.modelId`                             -> «gallery Yana yaratish»;
 *   7. `videoAgain` without the stored length / sound                          -> «gallery Yana yaratish»;
 *   8. effect cells without `aria-pressed`                                     -> «effects grid»;
 *   9. upload hint hard-coded («10 MB»)                                         -> «effects grid».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const OMNI = view.find((e) => e.id === "google/omni-video")!;
const K3 = view.find((e) => e.id === "kling/kling-3")!;
const K3P = view.find((e) => e.id === "kling/kling-3-pro")!;
const FX = view.find((e) => e.id === "kling/effects")!;
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const ASSET = "0123456789abcdef01234567";
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;

const videoCatalog = (models = [OMNI, K3, K3P, FX], extra: unknown[] = []) => ({ purpose: "studio.video", defaultModelId: "google/omni-video", models: [...models, ...extra], pricing: RATE });

function api(opts: { video?: unknown; generation?: (id: string, n: number) => Record<string, unknown>; gallery?: Record<string, unknown> } = {}) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: opts.generation, gallery: opts.gallery });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) {
      base.calls.push({ url, method: "GET", body: null, key: null });
      return json(200, opts.video ?? videoCatalog());
    }
    if (url.startsWith("/api/uploads/photo")) return json(200, { assetId: ASSET, originalAssetId: "" });
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, points: 900_000, balance: 48_200 } as never });
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

test("tabs: «Rasm» | «Video»; switching keeps the Rasm prompt + model and the Video form; ?tab=video opens Video; catalog asked on first open", async () => {
  const a = api();
  await mount();
  assert.deepEqual(qa("[data-studio-tab]").map((b) => b.textContent), ["Rasm", "Video", "Ovoz", "Audio"]);
  assert.equal(a.calls.filter((c) => c.url.includes("studio.video")).length, 0, "the video catalog waits for the tab");
  await type('[data-studio-prompt] textarea', "Samarqand kechasi");
  await click(q(`[data-model-card="${GPT.id}"]`));
  await tab("video");
  await settle();
  assert.equal(q('[data-studio-tab="video"]')!.getAttribute("aria-selected"), "true");
  assert.ok(q("[data-video-tab]"));
  assert.ok(!q("[data-studio-prompt]"), "the Rasm form is not drawn on the Video tab");
  assert.equal(a.calls.filter((c) => c.url.includes("studio.video")).length, 1);
  await mode("Matndan / rasmdan");
  await type('[data-video-prompt] textarea', "Registon tongda");
  await tab("rasm");
  assert.equal(q<HTMLTextAreaElement>("[data-studio-prompt] textarea")!.value, "Samarqand kechasi", "MUTATSIYA: Rasm holati tab almashganda yo'qolsa qizaradi");
  assert.equal(q(`[data-model-card="${GPT.id}"]`)!.getAttribute("aria-pressed"), "true");
  await tab("video");
  assert.equal(q<HTMLTextAreaElement>("[data-video-prompt] textarea")!.value, "Registon tongda", "the Video form survives too");
  assert.equal(tabFromSearch("?tab=video"), "video");
  assert.equal(tabFromSearch("?tab=x"), "rasm");
  cleanup();
  window.history.replaceState(null, "", "/uz/studio?tab=video");
  await mount();
  assert.equal(q('[data-studio-tab="video"]')!.getAttribute("aria-selected"), "true");
});

test("effects grid: 10 catalog scenes with the 5 s badge, the chosen one on the button with its price; the photo is required", async () => {
  const a = api();
  await mount();
  await tab("video");
  await settle();
  // Effects first (the canvas order), a grid of the catalog's own scenes.
  const cells = qa("[data-effects-grid] [data-effect]");
  const opts = (FX.params.find((p) => p.name === "effect") as unknown as { options: { value: string; label: string }[] }).options;
  assert.deepEqual(cells.map((c) => c.dataset.effect), opts.map((o) => o.value));
  // P4: the nine single-photo scenes + «Quchoqlash» (two photos).
  assert.equal(cells.length, 10);
  for (const c of cells) assert.match(c.textContent ?? "", /5 s/);
  const fxPrice = up100(0.84 * 12_700 * 2);
  assert.equal(fxPrice, 21_400);
  assert.equal(button(), `Yaratish · «Tug‘ilgan kun» · ${formatSom(fxPrice)}`);
  // Plain buttons with `aria-pressed` (like the model cards): Tab / Enter / Space work natively, no radio roles.
  assert.equal(qa('[data-effects-grid] [role="radio"]').length, 0);
  for (const c of cells) assert.equal(c.tagName, "BUTTON");
  assert.equal(cells[0]!.getAttribute("aria-pressed"), "true", "the first scene starts chosen");
  await click(q('[data-effect="zombie_transform"]'));
  assert.equal(q('[data-effect="zombie_transform"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(cells[0]!.getAttribute("aria-pressed"), "false");
  assert.equal(button(), `Yaratish · «Zombi» · ${formatSom(fxPrice)}`, "MUTATSIYA: effekt nomi tugmadan tushsa qizaradi");
  // The upload hint states the limit the upload endpoint enforces (one constant).
  assert.equal((FX.params.find((p) => p.name === "imageAssetId") as unknown as { maxBytes: number }).maxBytes, PHOTO_MAX_BYTES, "the schema states the endpoint's limit");
  assert.ok((q('[data-field="imageAssetId"]')?.textContent ?? "").includes(photoHint()), "the hint from photoHint()");
  assert.match(photoHint(), /5 MB/);
  // Fields: exactly the effect entry's schema.
  assert.deepEqual(qa("[data-field]").map((e) => e.getAttribute("data-field")).sort(), ["effect", "imageAssetId"]);
  // No photo → no request, a clear message.
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 0, "MUTATSIYA: suratsiz effekt yuborilsa qizaradi");
  assert.match(q("[data-studio-error]")?.textContent ?? "", /surat yuklang/i);
});

test("text form: video models only, «so'm / N s» cards, schema rows (one data-field each), length + sound move the price; submit contract", async () => {
  // A picture model FIRST in the answer: were it kept, it would take a card of the row.
  const a = api({ video: { ...videoCatalog(), models: [NANO, OMNI, K3, K3P, FX] } });
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  const cards = qa("[data-model-card]").map((c) => c.dataset.modelCard);
  assert.ok(!cards.includes(NANO.id), "MUTATSIYA: rasm modeli video tabida chiqsa qizaradi");
  assert.deepEqual(cards, [OMNI.id, K3.id, K3P.id]);
  // Omni (default), 5 s: $0.10 × 5 × 12 700 × 2.
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(12_700)}`);
  assert.match(q(`[data-model-card="${K3.id}"] [data-model-price]`)!.textContent ?? "", /so'm \/ 5 s$/);
  await click(q(`[data-model-card="${K3.id}"]`));
  const names = qa("[data-field]").map((e) => e.getAttribute("data-field")).sort();
  assert.deepEqual(names, K3.params.map((p) => p.name).sort(), "one data-field per schema param");
  assert.equal(new Set(names).size, names.length);
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(10_700)}`);
  await click(q('[data-field="seconds"] [aria-label="Davomiylik: ko‘paytirish"]'));
  assert.equal(button(), `Yaratish · 6 soniya · ${formatSom(up100(0.084 * 6 * 12_700 * 2))}`);
  await click(q('[data-field="sound"] [role="switch"]'));
  assert.equal(button(), `Yaratish · 6 soniya · ${formatSom(up100(0.126 * 6 * 12_700 * 2))}`);
  // Too short a prompt: nothing sent.
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 0);
  await type('[data-video-prompt] textarea', "  Registon   tongda, kamera sekin  ");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.equal(sent.slug, "studio-video");
  assert.deepEqual(sent.values, { modelId: K3.id, prompt: "Registon tongda, kamera sekin", seconds: 6, aspect: "16:9", sound: true, imageAssetId: "", endImageAssetId: "" });
  assert.equal(sent.expectedPrice, up100(0.126 * 6 * 12_700 * 2));
});

test("«Yaxshilash (AI)» in the Video box: sends the prompt as kind video, writes the rewrite back; nothing generated", async () => {
  const a = api({ video: { ...videoCatalog(), models: [OMNI, K3, K3P, FX] } });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input) !== "/api/media/enhance") return inner(input as never, init);
    a.calls.push({ url: String(input), method: "POST", body: JSON.parse(String(init?.body)), key: null });
    return json(200, { prompt: "Slow dolly toward Registon at dawn" });
  };
  await mount();
  await tab("video");
  await settle();
  await mode("Matndan / rasmdan");
  const box = q<HTMLTextAreaElement>("[data-video-prompt] textarea")!;
  assert.equal(q<HTMLButtonElement>('[data-video-prompt] [data-prompt-tool="enhance"]')!.disabled, true, "empty box");
  await act(async () => void fireEvent.change(box, { target: { value: "Tongda  Registon" } }));
  await click(q('[data-video-prompt] [data-prompt-tool="enhance"]'));
  await settle();
  assert.deepEqual(a.calls.find((c) => c.url === "/api/media/enhance")?.body, { prompt: "Tongda Registon", kind: "video" });
  assert.equal(q<HTMLTextAreaElement>("[data-video-prompt] textarea")!.value, "Slow dolly toward Registon at dawn");
  assert.equal(a.posts().length, 0);
});

test("results: a running clip shows the progress panel, a finished one plays its own file + download; the bar shows the PAID balance", async () => {
  api();
  useAppStore.setState({ user: { ...USER, points: 900_000, balance: 30_000 } as never });
  await mount();
  await tab("video");
  await settle();
  assert.match(q("[data-studio-balance]")?.textContent ?? "", /To‘langan balans: 30/, "bonus so'm is not counted for video");
  cleanup();

  const { VideoResults } = await import("../../components/studio/video/VideoResults.tsx");
  const done = "11111111-1111-4111-8111-111111111111";
  const running = "22222222-2222-4222-8222-222222222222";
  const job = (id: string, gen: Record<string, unknown>) => ({ id, modelId: FX.id, modelLabel: FX.label, prompt: "Effekt: Qorli shar", price: 21_400, sent: {}, gen: gen as never, error: null });
  const finished = generationDetail(done, { type: "studio-video", format: "mp4", fileName: "video.mp4", doc: { meta: { topic: "x", language: "uz" }, video: { provider: "kling", prompt: "", aspect: "", requestedSeconds: 5, seconds: 5, fromImage: true, model: FX.id, effect: "snowglobe" } } });
  const inProgress = generationDetail(running, { type: "studio-video", status: "IN_PROGRESS", progress: 40, step: "Video tayyorlanmoqda", doc: null, format: "mp4" });
  render(h(AppRouterContext.Provider, { value: router }, h(VideoResults, { jobs: [job(running, inProgress), job(done, finished)], busy: false, onAgain: () => {} })));
  await settle();
  const cards = qa("[data-studio-job]");
  assert.equal(cards.length, 2);
  assert.ok(!cards[0]!.querySelector("[data-video-player]"), "a running clip has no player");
  const player = cards[1]!.querySelector<HTMLVideoElement>("[data-video-player]")!;
  assert.ok(player);
  assert.equal(player.getAttribute("src"), `/api/generations/${done}/file?inline=1`);
  assert.ok(cards[1]!.querySelector('[data-result-action="download"]'));
  assert.ok(cards[1]!.querySelector('[data-result-action="again"]'));
  assert.match(cards[1]!.querySelector("[data-studio-job-meta]")!.textContent ?? "", /5 soniya/);
});

test("gallery «Yana yaratish»: a text clip re-opens with ITS model, prompt, length, aspect and sound (same price); an effect with its scene", async () => {
  const clip = "33333333-3333-4333-8333-333333333333";
  const fx = "44444444-4444-4444-8444-444444444444";
  const item = (id: string, patch: Record<string, unknown>) => ({ id, kind: "video", createdAt: "2026-11-02T10:00:00.000Z", images: [], fileUrl: `/api/generations/${id}/file`, ...patch });
  api({
    gallery: {
      "": {
        items: [
          item(clip, { modelId: K3P.id, modelLabel: K3P.label, prompt: "Registon kechasi", video: { src: "x", seconds: 10, requestedSeconds: 10, aspect: "9:16", sound: true, effect: null, effectLabel: null } }),
          item(fx, { modelId: FX.id, modelLabel: FX.label, prompt: "Effekt: Qorli shar", video: { src: "x", seconds: 5, requestedSeconds: null, aspect: null, sound: null, effect: "snowglobe", effectLabel: "Qorli shar" } }),
        ],
        nextCursor: null,
      },
    },
  });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  const again = (id: string) => q(`[data-gallery-item="${id}"] [data-gallery-other-model]`);
  assert.match(again(clip)?.textContent ?? "", /Yana yaratish/);
  await click(again(clip));
  await settle();
  assert.equal(q('[data-studio-tab="video"]')!.getAttribute("aria-selected"), "true");
  assert.equal(q(`[data-model-card="${K3P.id}"]`)!.getAttribute("aria-pressed"), "true", "MUTATSIYA: klipning modeli tiklanmasa qizaradi");
  assert.equal(q<HTMLTextAreaElement>("[data-video-prompt] textarea")!.value, "Registon kechasi");
  assert.equal(q('[data-field="sound"] [role="switch"]')!.getAttribute("aria-checked"), "true");
  assert.equal(q('[data-field="aspect"] [role="radio"][aria-checked="true"]')!.textContent, "9:16");
  // Kling 3.0 Pro, 10 s, with sound: $0.168 × 10 × 12 700 × 2 — the price the clip was bought at.
  assert.equal(button(), `Yaratish · 10 soniya · ${formatSom(up100(0.168 * 10 * 12_700 * 2))}`, "MUTATSIYA: uzunlik/ovoz tiklanmasa qizaradi");

  await click(q("[data-studio-gallery-link]"));
  await settle();
  await click(again(fx));
  await settle();
  assert.equal(q('[data-effect="snowglobe"]')!.getAttribute("aria-pressed"), "true");
  assert.equal(button(), `Yaratish · «Qorli shar» · ${formatSom(21_400)}`);
});
