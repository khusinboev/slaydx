import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { ELEVENLABS_VOICES, GEMINI_VOICES } from "../../lib/media/catalog-speech.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json, withParams } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { useFavorites } = await import("../../components/studio/Favorite.tsx");
const { formatSom } = await import("../../lib/format.ts");

/**
 * Studio P7b (docs/studio/P7-SPEC.md «P7b»): chains («Keyingi qadam») and favourites, on the full Studio page with the
 * API stubbed at `fetch` and the REAL catalog entries.
 *
 * Locked here:
 *   - «Videoga aylantirish» on a finished picture: the picture travels as the user's OWN input — `POST
 *     /api/media/inputs/from-result {generationId, assetId}` of that stored result (no client URL is sent anywhere
 *     else); the Video tab opens on «Matndan / rasmdan» with that asset as the start frame and the picture's prompt;
 *     the picker offers ONLY the models that take a start image; the submit is a normal priced job (the button's price
 *     = `expectedPrice`, `imageAssetId` = the copied asset); removing the frame lifts the filter;
 *   - a job of several pictures asks which one; the chosen one is copied;
 *   - no start-image video model offered: a message, and NO input copy is made;
 *   - «Ovoz qo'shish» (picture / clip) → «Ovoz», «Matn», the prompt as the text; «Musiqa yaratish» (clip) → «Audio»,
 *     «Musiqa», the prompt as the description; an effect clip / a utility job offers no prompt handoff;
 *   - gallery cards: «Keyingi qadam» disclosure with the same handoffs (picture → video from `thumbs[0]`, clip → music);
 *   - favourites: the star on a result and on a gallery card `PUT`s / `DELETE`s `/api/media/favorites/<id>`,
 *     `aria-pressed` follows, a failure reverts with the server's message; a star set on a result shows on its gallery
 *     card; the server's `favorite: true` shows as starred; «Sevimlilar» asks `?favorites=1` and has its own empty state.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. VideoTab without the `startImageModels` filter                         -> «picture → video»;
 *   2. `videoFromPicture` leaves the start frame out of `raw`                  -> «picture → video»;
 *   3. handoff copies the input BEFORE checking the catalog                    -> «no start-image model»;
 *   4. the multi-picture chooser always sends the first picture                -> «several pictures»;
 *   5. `voiceFromText` writes `script` instead of the model's text field       -> «Ovoz qo'shish»;
 *   6. `musicFromPrompt` sets the mode but not the prompt                      -> «clip → music»;
 *   7. `toggleFavorite` does not revert on a failed request                    -> «favourites: results»;
 *   8. `FavoriteButton` ignores the store (only `initial`)                     -> «favourites: results» (gallery card);
 *   9. `fetchGallery` drops `favorites=1`                                      -> «favourites: gallery»;
 *  10. removing the start frame keeps `fromPicture`                            -> «picture → video».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const OMNI = view.find((e) => e.id === "google/omni-video")!;
const K3 = view.find((e) => e.id === "kling/kling-3")!;
const FX = view.find((e) => e.id === "kling/effects")!;
// A text-only video model (no start image) — today every catalog model takes one, the filter must still hold.
const TEXT_ONLY = withParams(OMNI, "test/text-only-video", OMNI.params.filter((p) => p.name !== "imageAssetId"), "Faqat matn");
const SPEECH_IDS = ["elevenlabs/eleven-v3", "google/gemini-tts", "elevenlabs/v3-dialogue"];
const SPEECH = SPEECH_IDS.map((id) => view.find((e) => e.id === id)!);
const AUDIO = ["elevenlabs/music", "elevenlabs/sfx"].map((id) => view.find((e) => e.id === id)!);
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const COPIED = "0123456789abcdef01234567";
const COPIED_2 = "fedcba9876543210fedcba98";
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;

type Opts = {
  video?: unknown[];
  pictures?: number;
  gallery?: Record<string, unknown>;
  favFail?: boolean;
};

/** A finished picture job whose pictures are stored result assets (hex asset ids, as the server writes them). */
function pictureDetail(id: string, n: number) {
  const images = Array.from({ length: n }, (_, i) => ({ id: `im${i}`, url: `/api/generations/${id}/assets/abcdef0${i + 1}`, w: 1024, h: 1024, mime: "image/png", alt: "natija" }));
  return generationDetail(id, { doc: { meta: { topic: "p", language: "uz" }, images, imageModel: NANO.id } });
}

function api(o: Opts = {}) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: (id) => pictureDetail(id, o.pictures ?? 1), gallery: o.gallery });
  const inner = globalThis.fetch;
  const extra: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) {
      extra.push({ url, method, body });
      return json(200, { purpose: "studio.video", defaultModelId: OMNI.id, models: o.video ?? [TEXT_ONLY, OMNI, K3, FX], pricing: RATE });
    }
    if (url.startsWith("/api/media/catalog?purpose=studio.speech")) {
      extra.push({ url, method, body });
      return json(200, { purpose: "studio.speech", defaultModelId: SPEECH_IDS[0], models: SPEECH, pricing: RATE });
    }
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) {
      extra.push({ url, method, body });
      return json(200, { purpose: "studio.audio", defaultModelId: AUDIO[0]!.id, models: AUDIO, pricing: RATE });
    }
    if (url === "/api/media/voices") {
      return json(200, {
        library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
        mine: [],
        clone: { available: true, price: 5000, consentText: "", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
      });
    }
    if (url === "/api/media/inputs/from-result" && method === "POST") {
      extra.push({ url, method, body });
      const asset = String(body?.assetId ?? "").endsWith("2") ? COPIED_2 : COPIED;
      return json(200, { assetId: asset, mime: "image/png", size: 10, w: 1024, h: 1024 });
    }
    if (url.startsWith("/api/uploads/photo")) return json(200, { assetId: "aaaaaaaaaaaaaaaaaaaaaaaa", originalAssetId: "" });
    if (url.startsWith("/api/media/favorites/")) {
      extra.push({ url, method, body });
      if (o.favFail) return json(404, { error: "Natija topilmadi", code: "not_found" });
      return json(200, { id: url.split("/").pop(), favorite: method === "PUT" });
    }
    if (url.startsWith("/api/media/gallery") && url.includes("favorites=1")) {
      extra.push({ url, method, body });
      return json(200, (o.gallery?.favorites as unknown) ?? { items: [], nextCursor: null });
    }
    return inner(input as never, init);
  };
  return { ...base, extra, imports: () => extra.filter((c) => c.url === "/api/media/inputs/from-result"), favs: () => extra.filter((c) => c.url.startsWith("/api/media/favorites/")) };
}

beforeEach(() => {
  dropMediaCatalog();
  useFavorites.setState({ on: {}, busy: {} });
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
async function settle(n = 10) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 3));
  });
}
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel);
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
async function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
}
/** jsdom has no canvas / image decoding: the minimum the crop dialog needs (as studio-video-p4.test.mts). */
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
async function uploadStart() {
  stubCanvas();
  const input = q<HTMLInputElement>('[data-field="imageAssetId"] input[type="file"]');
  assert.ok(input, "start frame file input");
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(500)], "p.jpg", { type: "image/jpeg" })] } });
  });
  const done = await screen.findByText("Tayyor");
  await waitFor(() => assert.ok(!(done as HTMLButtonElement).closest("button")!.disabled));
  await act(async () => void fireEvent.click(done));
  await waitFor(() => assert.ok(q('[data-field="imageAssetId"] img'), "uploaded"));
}
const selectedTab = () => q('[data-studio-tab][aria-selected="true"]')?.getAttribute("data-studio-tab");
const cards = () => qa("[data-model-card]").map((c) => c.dataset.modelCard);

/** Draw one picture job (the stubbed generation is finished at once). */
async function drawPicture(prompt = "Registon maydoni kechqurun, oltin nur") {
  await type("[data-studio-prompt] textarea", prompt);
  await click(q("[data-studio-submit]"));
  await settle(30);
  assert.ok(q("[data-studio-pictures]"), "the finished picture");
}

test("picture → video: its own input copy is the start frame, the prompt carries, only start-image models; a normal priced job", async () => {
  const a = api();
  await mount();
  await drawPicture();
  const jobId = a.created[0]!;
  await click(q('[data-studio-job] [data-result-action="to-video"]'));
  await settle(20);
  assert.deepEqual(a.imports().map((c) => c.body), [{ generationId: jobId, assetId: "abcdef01" }], "the stored asset of that job, copied by the server");
  assert.equal(selectedTab(), "video");
  assert.ok(q("[data-video-from-picture]"), "the «Rasmdan video» note");
  assert.deepEqual(cards(), [OMNI.id, K3.id], "MUTATSIYA: start-image filtri bo'lmasa «Faqat matn» ham chiqadi");
  assert.equal(q<HTMLTextAreaElement>("[data-video-prompt] textarea")!.value, "Registon maydoni kechqurun, oltin nur");
  const frame = q<HTMLImageElement>('[data-field="imageAssetId"] img');
  assert.ok(frame, "MUTATSIYA: start frame yo'q bo'lsa qizaradi");
  assert.equal(frame.getAttribute("src"), `/api/uploads/photo/${COPIED}`);
  // Omni, 5 s: $0.10 × 5 × 12 700 × 2 — the tab's own price, unchanged by the handoff.
  const price = up100(0.1 * 5 * 12_700 * 2);
  assert.equal(q("[data-studio-submit]")?.textContent, `Yaratish · 5 soniya · ${formatSom(price)}`);
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts().at(-1)!.body!;
  assert.equal(sent.slug, "studio-video");
  assert.equal((sent.values as Record<string, unknown>).imageAssetId, COPIED);
  assert.equal((sent.values as Record<string, unknown>).modelId, OMNI.id);
  assert.equal(sent.expectedPrice, price);
  // Removing the frame lifts the filter: every text/image model is offered again.
  await click(qa('[data-field="imageAssetId"] button').find((b) => b.textContent === "Olib tashlash"));
  await settle();
  assert.ok(!q("[data-video-from-picture]"));
  assert.deepEqual(cards(), [TEXT_ONLY.id, OMNI.id, K3.id]);
  // A start frame the user uploads by hand afterwards is an ordinary one: the handoff filter does not come back.
  await uploadStart();
  assert.ok(!q("[data-video-from-picture]"), "MUTATSIYA: fromPicture qolsa qizaradi");
  assert.deepEqual(cards(), [TEXT_ONLY.id, OMNI.id, K3.id]);
});

test("several pictures: «Videoga aylantirish» asks which one; the chosen picture is the one copied", async () => {
  const a = api({ pictures: 2 });
  await mount();
  await drawPicture();
  await click(q('[data-result-action="to-video"]'));
  await settle();
  assert.equal(a.imports().length, 0, "nothing copied before the choice");
  assert.equal(q('[data-result-action="to-video"]')?.getAttribute("aria-expanded"), "true");
  assert.equal(qa("[data-video-pick]").length, 2);
  await click(q('[data-video-pick="1"]'));
  await settle(20);
  assert.equal(a.imports()[0]?.body?.assetId, "abcdef02", "MUTATSIYA: doim 1-rasm yuborilsa qizaradi");
  assert.equal(q<HTMLImageElement>('[data-field="imageAssetId"] img')?.getAttribute("src"), `/api/uploads/photo/${COPIED_2}`);
});

test("no start-image model offered: a message, the Rasm tab stays, NO input copy is made", async () => {
  const a = api({ video: [TEXT_ONLY, FX] });
  await mount();
  await drawPicture();
  await click(q('[data-result-action="to-video"]'));
  await settle(20);
  assert.equal(a.imports().length, 0, "MUTATSIYA: katalog tekshiruvidan oldin nusxa olinsa qizaradi");
  assert.equal(selectedTab(), "rasm");
  assert.match(q("[data-handoff-error]")?.textContent ?? "", /Rasmdan video yaratish hozircha mavjud emas/);
  // Switching tab clears the message.
  await click(q('[data-studio-tab="ovoz"]'));
  assert.ok(!q("[data-handoff-error]"));
});

test("«Ovoz qo'shish» on a picture: the «Ovoz» tab, «Matn», the prompt as the text; a utility job offers no prompt handoff", async () => {
  const a = api();
  await mount();
  await drawPicture("Toshkent tongi, sokin ko‘cha");
  await click(q('[data-result-action="to-voice"]'));
  await settle(20);
  assert.equal(selectedTab(), "ovoz");
  assert.equal(q<HTMLTextAreaElement>("[data-voice-text] textarea")?.value, "Toshkent tongi, sokin ko‘cha", "MUTATSIYA: matn maydoni noto'g'ri bo'lsa qizaradi");
  assert.ok(a.extra.some((c) => c.url.includes("studio.speech")));
  assert.equal(a.posts().length, 1, "nothing is charged by the handoff");
  cleanup();
  // A job of another purpose (upscale) has a label, not a description: no «Ovoz qo'shish»; the video prompt starts empty.
  const { StudioResults } = await import("../../components/studio/StudioResults.tsx");
  const id = "33333333-3333-4333-8333-333333333333";
  const got: string[] = [];
  render(
    h(
      AppRouterContext.Provider,
      { value: router },
      h(StudioResults, {
        jobs: [{ id, modelId: "x", modelLabel: "X", prompt: "Sifatini oshirish", price: 500, sent: {}, purpose: "studio.upscale", gen: pictureDetail(id, 1) as never, error: null }],
        busy: false,
        onAgain: () => {},
        onOtherModel: () => {},
        onVideo: (_url: string, p: string) => void got.push(p),
        onVoice: () => assert.fail("no voice handoff for a utility job"),
      }),
    ),
  );
  assert.ok(!q('[data-result-action="to-voice"]'));
  await click(q('[data-result-action="to-video"]'));
  assert.deepEqual(got, [""]);
});

test("clip → music / voice: «Musiqa yaratish» opens «Audio» «Musiqa» with the prompt; an effect clip has no prompt handoff", async () => {
  const { VideoResults } = await import("../../components/studio/video/VideoResults.tsx");
  const done = "44444444-4444-4444-8444-444444444444";
  const clip = generationDetail(done, { type: "studio-video", format: "mp4", doc: { meta: { topic: "x", language: "uz" }, video: { provider: "kling", prompt: "p", aspect: "16:9", requestedSeconds: 5, seconds: 5, fromImage: false, model: K3.id } } });
  const music: string[] = [];
  const voice: string[] = [];
  const job = (sent: Record<string, unknown>, prompt: string) => ({ id: done, modelId: K3.id, modelLabel: K3.label, prompt, price: 10_700, sent, gen: clip as never, error: null });
  render(h(AppRouterContext.Provider, { value: router }, h(VideoResults, { jobs: [job({ effect: "" }, "Registon tongda, kamera sekin")], busy: false, onAgain: () => {}, onMusic: (p: string) => void music.push(p), onVoice: (t: string) => void voice.push(t) })));
  await click(q('[data-result-action="to-music"]'));
  await click(q('[data-result-action="to-voice"]'));
  assert.deepEqual(music, ["Registon tongda, kamera sekin"]);
  assert.deepEqual(voice, ["Registon tongda, kamera sekin"]);
  cleanup();
  render(h(AppRouterContext.Provider, { value: router }, h(VideoResults, { jobs: [job({ effect: "snowglobe" }, "Effekt: Qorli shar")], busy: false, onAgain: () => {}, onMusic: () => {}, onVoice: () => {} })));
  assert.ok(!q("[data-next-step]"), "an effect clip: nothing to hand over");
  cleanup();

  // The page: a gallery clip → «Audio», «Musiqa», the prompt in the description box.
  const vid = "55555555-5555-4555-8555-555555555555";
  const a = api({
    gallery: {
      "": {
        items: [{ id: vid, kind: "video", createdAt: "2026-11-01T10:05:00.000Z", modelId: K3.id, modelLabel: K3.label, prompt: "Samarqand osmoni, sekin parallaks", images: [], fileUrl: `/api/generations/${vid}/file`, video: { seconds: 5, requestedSeconds: 5, aspect: "16:9" } }],
        nextCursor: null,
      },
    },
  });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  await click(q(`[data-gallery-item="${vid}"] [data-gallery-next-toggle]`));
  assert.deepEqual(qa(`[data-gallery-item="${vid}"] [data-gallery-action]`).map((b) => b.dataset.galleryAction), ["to-music", "to-voice"]);
  await click(q(`[data-gallery-item="${vid}"] [data-gallery-action="to-music"]`));
  await settle(20);
  assert.equal(selectedTab(), "audio");
  assert.equal(q("[data-audio-tab]")?.getAttribute("data-audio-mode"), "music");
  assert.equal(q<HTMLTextAreaElement>("[data-audio-prompt] textarea")?.value, "Samarqand osmoni, sekin parallaks", "MUTATSIYA: prompt o'tmasa qizaradi");
  assert.equal(a.posts().length, 0, "nothing is charged by the handoff");
});

test("gallery picture → «Keyingi qadam» «Videoga aylantirish»: the card's first stored picture is copied, the Video tab opens", async () => {
  const pic = "66666666-6666-4666-8666-666666666666";
  const a = api({
    gallery: { "": { items: [{ id: pic, kind: "image", createdAt: "2026-11-01T10:05:00.000Z", modelId: NANO.id, modelLabel: NANO.label, prompt: "Chorsu bozori", images: [{ url: `/api/generations/${pic}/assets/abc1`, w: 1, h: 1 }], fileUrl: "" }], nextCursor: null } },
  });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  const toggle = q(`[data-gallery-item="${pic}"] [data-gallery-next-toggle]`);
  assert.equal(toggle?.getAttribute("aria-expanded"), "false");
  assert.ok(!q("[data-gallery-action]"), "closed until pressed");
  await click(toggle);
  assert.deepEqual(qa("[data-gallery-action]").map((b) => b.dataset.galleryAction), ["to-video", "to-voice"]);
  await click(q('[data-gallery-action="to-video"]'));
  await settle(20);
  assert.deepEqual(a.imports()[0]?.body, { generationId: pic, assetId: "abc1" });
  assert.ok(!q("[data-studio-gallery]"), "back to the create view");
  assert.equal(selectedTab(), "video");
  assert.equal(q<HTMLTextAreaElement>("[data-video-prompt] textarea")?.value, "Chorsu bozori");
});

test("favourites: results — the star PUTs / DELETEs, aria-pressed follows, a failure reverts; the gallery card shows the result's star", async () => {
  const a = api();
  await mount();
  await drawPicture();
  const id = a.created[0]!;
  const star = () => q(`[data-studio-job] [data-favorite="${id}"]`);
  assert.equal(star()?.getAttribute("aria-pressed"), "false");
  await click(star());
  await settle();
  assert.deepEqual(a.favs().map((c) => `${c.method} ${c.url}`), [`PUT /api/media/favorites/${id}`]);
  assert.equal(star()?.getAttribute("aria-pressed"), "true");
  assert.equal(star()?.getAttribute("aria-label"), "Sevimlilardan olib tashlash");
  // The gallery lists the same job without the flag yet (stale page) — the star set here still shows.
  cleanup();
  api({ gallery: { "": { items: [{ id, kind: "image", createdAt: "2026-11-01T10:05:00.000Z", modelId: NANO.id, modelLabel: NANO.label, prompt: "p", images: [], fileUrl: "", favorite: false }], nextCursor: null } } });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  assert.equal(q(`[data-gallery-item="${id}"] [data-favorite]`)?.getAttribute("aria-pressed"), "true", "MUTATSIYA: store e'tiborsiz bo'lsa qizaradi");
  await click(q(`[data-gallery-item="${id}"] [data-favorite]`));
  await settle();
  assert.equal(q(`[data-gallery-item="${id}"] [data-favorite]`)?.getAttribute("aria-pressed"), "false");
  cleanup();
  // A failed request flips the star back and says why.
  useFavorites.setState({ on: {}, busy: {} });
  const b = api({ favFail: true });
  await mount();
  await drawPicture();
  const id2 = b.created[0]!;
  await click(q(`[data-favorite="${id2}"]`));
  await settle();
  assert.equal(q(`[data-favorite="${id2}"]`)?.getAttribute("aria-pressed"), "false", "MUTATSIYA: xatoda qaytarilmasa qizaradi");
  assert.match(q("[data-favorite-error]")?.textContent ?? "", /Natija topilmadi/);
});

test("favourites: gallery — the server's flag shows, «Sevimlilar» asks ?favorites=1 and has its own empty state; «Hammasi» reloads the list", async () => {
  const fav = "77777777-1111-4111-8111-111111111111";
  const plain = "77777777-2222-4222-8222-222222222222";
  const row = (id: string, favorite: boolean) => ({ id, kind: "image", createdAt: "2026-11-01T10:05:00.000Z", modelId: NANO.id, modelLabel: NANO.label, prompt: `p ${id}`, images: [{ url: `/api/generations/${id}/assets/ab`, w: 1, h: 1 }], fileUrl: "", favorite });
  const a = api({ gallery: { "": { items: [row(fav, true), row(plain, false)], nextCursor: null }, favorites: { items: [row(fav, true)], nextCursor: null } } });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  assert.equal(q(`[data-gallery-item="${fav}"] [data-favorite]`)?.getAttribute("aria-pressed"), "true", "the server's flag");
  assert.equal(q(`[data-gallery-item="${plain}"] [data-favorite]`)?.getAttribute("aria-pressed"), "false");
  assert.equal(q('[data-gallery-filter-chip="all"]')?.getAttribute("aria-checked"), "true");
  await click(q('[data-gallery-filter-chip="favorites"]'));
  await settle();
  assert.ok(a.extra.some((c) => c.url === "/api/media/gallery?favorites=1"), "MUTATSIYA: favorites=1 yuborilmasa qizaradi");
  assert.deepEqual(qa("[data-gallery-item]").map((e) => e.getAttribute("data-gallery-item")), [fav]);
  assert.equal(q('[data-gallery-filter-chip="favorites"]')?.getAttribute("aria-checked"), "true");
  await click(q('[data-gallery-filter-chip="all"]'));
  await settle();
  assert.deepEqual(qa("[data-gallery-item]").map((e) => e.getAttribute("data-gallery-item")), [fav, plain]);
  cleanup();
  api({ gallery: { "": { items: [row(plain, false)], nextCursor: null } } });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  await click(q('[data-gallery-filter-chip="favorites"]'));
  await settle();
  assert.equal(q("[data-gallery-empty]")?.getAttribute("data-gallery-empty"), "favorites");
  assert.match(q("[data-gallery-empty]")?.textContent ?? "", /Sevimlilar hozircha yo‘q/);
  assert.ok(q('[data-gallery-filter-chip="all"]'), "the chips stay on the empty view");
});
