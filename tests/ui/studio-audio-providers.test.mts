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
const { studioEntryPrice } = await import("../../lib/media/studio-pricing.ts");
const { setClientMixPrice } = await import("../../lib/media/catalog-mix.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");

/**
 * Studio P11 package E in the existing «Audio» and «Ovoz» screens (API stubbed at `fetch`). The screens are not redesigned:
 * a picker appears where a mode has two offered models, nothing else moves.
 *
 * Locked here:
 *   - one offered model: no picker, as before; two: the picker, the first is the default, and only the fal model listed opens
 *     the tool on that model (an ElevenLabs key without the permission);
 *   - the picked model is what is sent and priced (`modelId`, `expectedPrice`), a retry keeps the job's own model;
 *   - HeyGen: exactly its schema, no «Audio yuklash», only videos; an audio source is dropped when switching to it;
 *   - fal dubbing's price line says whole minutes;
 *   - «Effekt» and «Shovqindan tozalash» get the same picker, with exactly each model's fields;
 *   - «Ovoz»: a fal model lists only its voices, no clones, no filter left on «Mening ovozlarim», no «Tezlik» it does not have.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `entries.length > 1` removed (a picker always)                        -> «picker»;
 *   2. `offeredSpeechTools` lists only `m.model`                             -> «picker» (fal only opens nothing);
 *   3. `send` prices with the panel's entry (not the retried job's)          -> «retry»;
 *   4. `videoOnly` no longer hides the upload tab                            -> «HeyGen»;
 *   5. `billedLine` always the seconds text                                  -> «price line»;
 *   6. `offeredVoices` returns the whole list                                -> «Ovoz»;
 *   7. the `state.filter === "mine"` fallback removed                        -> «Ovoz».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const entry = (id: string) => view.find((e) => e.id === id)!;
const STT = entry("elevenlabs/scribe-v2");
const FAL_STT = entry("elevenlabs/scribe-v2-fal");
const DUB = entry("elevenlabs/dubbing");
const FAL_DUB = entry("elevenlabs/dubbing-fal");
const HEYGEN = entry("heygen/translate-speed");
const SFX = entry("elevenlabs/sfx");
const FAL_SFX = entry("elevenlabs/sfx-v3-fal");
const ISO = entry("elevenlabs/isolator");
const VEED = entry("veed/clean-audio");
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const VID = "11111111-1111-4111-8111-111111111111";
const SPEECH = "22222222-2222-4222-8222-222222222222";
const SOURCES = {
  price: 500,
  video: [{ id: VID, title: "Registon", kind: "Video", seconds: 8.2, createdAt: "2026-11-01T10:00:00Z" }],
  audio: [{ id: SPEECH, title: "Salom", kind: "Ovoz", seconds: 30, createdAt: "2026-11-01T10:00:00Z" }],
  speech: [],
  music: [],
};
const FAL_V3 = entry("elevenlabs/eleven-v3-fal");
const EL_V3 = entry("elevenlabs/eleven-v3");
const CLONE_ID = "0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a";

function api(models: unknown[], speech: unknown[] = [], generation?: (id: string) => unknown) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: (generation ?? ((id: string) => generationDetail(id))) as never });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) return json(200, { purpose: "studio.audio", defaultModelId: null, models, pricing: RATE });
    if (url.startsWith("/api/media/catalog?purpose=studio.speech")) return json(200, { purpose: "studio.speech", defaultModelId: "elevenlabs/eleven-v3", models: speech, pricing: RATE });
    if (url === "/api/media/mix-sources") return json(200, SOURCES);
    if (url === "/api/media/voices") {
      return json(200, {
        library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
        mine: [{ id: CLONE_ID, voice: `clone:${CLONE_ID}`, name: "Mening ovozim", status: "ready", createdAt: "", lastUsedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString() }],
        clone: { available: true, price: 5000, consentText: "Rozilik.", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
      });
    }
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  setClientMixPrice(null);
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
const txt = (sel: string) => (q(sel)?.textContent ?? "").replace(/\s/g, " ");
const click = async (el: Element | null | undefined) => {
  assert.ok(el, "element to click");
  await act(async () => void fireEvent.click(el));
};
async function settle(n = 10) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 3));
  });
}
async function openTab(tab: string) {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
  await click(q(`[data-studio-tab="${tab}"]`));
  await settle();
}
async function pick(value: string) {
  const el = q<HTMLSelectElement>('[data-field="source"] select');
  assert.ok(el, "the source picker");
  await act(async () => void fireEvent.change(el, { target: { value } }));
  await settle(2);
}
// P11 §D: the mode's models are cards (price + specs); `cardName` is the card's name line.
const modelButtons = () => qa("[data-audio-model-picker] [data-model-card]");
const cardName = (b: HTMLElement) => b.querySelector("span span")!.textContent;
async function pickModel(label: RegExp) {
  await click(modelButtons().find((b) => label.test(cardName(b) ?? "")));
  await settle(2);
}
const fieldNames = (root: string) => [...new Set(qa(`${root} [data-field]`).map((el) => el.dataset.field!))].sort();

test("picker: one offered model draws none; two draw it, default first; the fal model alone opens the tool", async () => {
  api([STT]);
  await openTab("audio");
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "transcribe");
  assert.ok(!q("[data-audio-model-picker]"), "one model: the screen as before");
  cleanup();
  dropMediaCatalog();

  api([STT, FAL_STT]);
  await openTab("audio");
  assert.deepEqual(modelButtons().map(cardName), ["ElevenLabs", "ElevenLabs Scribe v2 · fal"]);
  assert.equal(q("[data-speech-tool]")!.dataset.speechModel, STT.id, "the first is the default");
  cleanup();
  dropMediaCatalog();

  // An ElevenLabs key without `speech_to_text`: the admin leaves only the fal model on.
  api([FAL_STT, FAL_DUB]);
  await openTab("audio");
  assert.deepEqual(qa("[data-audio-mode-chip]").map((b) => b.textContent), ["Transkripsiya", "Dublyaj", "Montaj"]);
  assert.equal(q("[data-speech-tool]")!.dataset.speechModel, FAL_STT.id);
  assert.ok(!q("[data-audio-model-picker]"));
});

test("send: the picked model is priced and sent; the fields follow it", async () => {
  const a = api([STT, FAL_STT]);
  await openTab("audio");
  await pick(SPEECH);
  await pickModel(/fal/);
  assert.equal(q("[data-speech-tool]")!.dataset.speechModel, FAL_STT.id);
  assert.deepEqual(fieldNames("[data-speech-tool]"), FAL_STT.params.filter((p) => p.name !== "burn").map((p) => p.name).sort(), "an audio source: no burn row");
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-transcribe");
  assert.equal(post.body!.expectedPrice, studioEntryPrice(FAL_STT, { sourceSeconds: 30 }, RATE));
  assert.notEqual(post.body!.expectedPrice, studioEntryPrice(STT, { sourceSeconds: 30 }, RATE), "not the other model's price");
  assert.deepEqual(post.body!.values, { modelId: FAL_STT.id, source: `result:${SPEECH}`, sourceSeconds: 30, language: "auto", speakers: false, burn: false });
});

test("retry: «Qayta urinish» resends the job's own model at its own price, whichever is picked now", async () => {
  const failed = (id: string) => generationDetail(id, { status: "FAILED", error: "Dublyaj bajarilmadi. Pul balansingizga qaytariladi." });
  const a = api([DUB, FAL_DUB], [], failed);
  await openTab("audio");
  await click(q('[data-audio-mode-chip="dub"]'));
  await settle();
  await pick(SPEECH);
  await pickModel(/fal/);
  await click(q("[data-studio-submit]"));
  await settle(30);
  await pickModel(/^ElevenLabs$/);
  assert.equal(q("[data-speech-tool]")!.dataset.speechModel, DUB.id);
  await click(q('[data-speech-results] [data-result-action="again"]'));
  await settle();
  const [first, second] = a.posts();
  assert.equal((second!.body!.values as { modelId: string }).modelId, FAL_DUB.id);
  assert.equal(second!.body!.expectedPrice, first!.body!.expectedPrice, "the price of the job's model");
  assert.equal(second!.body!.expectedPrice, studioEntryPrice(FAL_DUB, { sourceSeconds: 30 }, RATE));
});

test("HeyGen: exactly its schema, videos only, no upload tab; an audio source is dropped on the switch", async () => {
  const a = api([DUB, HEYGEN]);
  await openTab("audio");
  await pick(SPEECH);
  await pickModel(/HeyGen/);
  assert.equal(q("[data-speech-tool]")!.dataset.speechModel, HEYGEN.id);
  assert.ok(![...qa('[data-field="source"] [role="radio"]')].some((b) => /Audio yuklash/.test(b.textContent ?? "")), "no upload tab");
  const options = [...q<HTMLSelectElement>('[data-field="source"] select')!.options].map((o) => o.value);
  assert.ok(options.includes(VID) && !options.includes(SPEECH), `only videos: ${options.join()}`);
  assert.equal(q<HTMLSelectElement>('[data-field="source"] select')!.value, "", "the audio source went");
  await click(q("[data-studio-submit]"));
  assert.match(txt("[data-studio-error]"), /manbani tanlang/);
  assert.equal(a.posts().length, 0);

  await pick(VID);
  assert.deepEqual(fieldNames("[data-speech-tool]"), HEYGEN.params.map((p) => p.name).sort());
  const target = q<HTMLSelectElement>('[data-field="target"] select')!;
  assert.deepEqual([...target.options].map((o) => o.value).sort(), (HEYGEN.params.find((p) => p.name === "target") as unknown as { options: { value: string }[] }).options.map((o) => o.value).sort());
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.deepEqual(post.body!.values, { modelId: HEYGEN.id, source: `result:${VID}`, sourceSeconds: 9, target: "uz", translateAudioOnly: false });
  assert.equal(post.body!.expectedPrice, studioEntryPrice(HEYGEN, { sourceSeconds: 9 }, RATE));
});

test("price line: fal dubbing says whole minutes, the per-second models say seconds", async () => {
  api([DUB, FAL_DUB]);
  await openTab("audio");
  await pick(VID);
  assert.match(txt("[data-speech-seconds]"), /9 soniya/);
  await pickModel(/fal/);
  assert.match(txt("[data-speech-seconds]"), /to‘liq daqiqalar.*1 daqiqa/);
  const want = studioEntryPrice(FAL_DUB, { sourceSeconds: 9 }, RATE);
  assert.equal(want, 15_300, "9 s pay the minute fal bills");
  assert.ok(txt("[data-studio-submit]").includes("15 300"), txt("[data-studio-submit]"));
});

test("price line: fal Scribe shows the billed minute on a short source, and its price", async () => {
  api([STT, FAL_STT]);
  await openTab("audio");
  await pick(VID);
  assert.match(txt("[data-speech-seconds]"), /9 soniya/, "ElevenLabs bills seconds");
  await pickModel(/fal/);
  assert.match(txt("[data-speech-seconds]"), /to‘liq daqiqalar.*1 daqiqa/);
  const want = studioEntryPrice(FAL_STT, { sourceSeconds: 60 }, RATE);
  assert.equal(studioEntryPrice(FAL_STT, { sourceSeconds: 9 }, RATE), want, "9 s pay the full minute");
  assert.ok(txt("[data-studio-submit]").includes(`~${want}`), txt("[data-studio-submit]"));
});

test("«Effekt» and «Shovqindan tozalash»: the same picker, each model's own fields and price", async () => {
  const a = api([SFX, FAL_SFX, ISO, VEED]);
  await openTab("audio");
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "sfx");
  assert.deepEqual(modelButtons().map(cardName), ["ElevenLabs Ovoz effekti", "ElevenLabs SFX v3 · fal"]);
  await pickModel(/fal/);
  assert.equal(q("[data-audio-tab]")!.dataset.audioModel, FAL_SFX.id);
  await act(async () => void fireEvent.change(q<HTMLTextAreaElement>("[data-audio-prompt] textarea")!, { target: { value: "eshik ochiladi" } }));
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal((post.body!.values as { modelId: string }).modelId, FAL_SFX.id);
  assert.equal(post.body!.expectedPrice, studioEntryPrice(FAL_SFX, { duration: 5 }, RATE));

  await click(q('[data-audio-mode-chip="isolate"]'));
  await settle();
  assert.deepEqual(modelButtons().map(cardName), ["ElevenLabs", "VEED Clean Audio · fal"]);
  assert.ok(!q('[data-field="strength"]'), "the ElevenLabs model has no such row");
  await pickModel(/VEED/);
  assert.ok(q('[data-field="strength"]'), "VEED's own row");
});

test("«Ovoz»: a fal model lists its voices only, no clones, no filter stuck on «Mening ovozlarim», no setting it lacks", async () => {
  api([], [EL_V3, FAL_V3]);
  await openTab("ovoz");
  assert.deepEqual(qa("[data-voice-filter]").map((b) => b.textContent), ["Hammasi", "Erkak", "Ayol", "Mening ovozlarim"]);
  assert.ok(q('[data-field="speed"]'), "the direct model has «Tezlik»");
  await click(q('[data-voice-filter="mine"]'));
  assert.equal(qa("[data-voice-row]").length, 1, "my clone");

  await click(q(`[data-model-card="${FAL_V3.id}"]`));
  await settle(2);
  assert.deepEqual(qa("[data-voice-filter]").map((b) => b.textContent), ["Hammasi", "Erkak", "Ayol"], "no clones on fal");
  assert.equal(qa("[data-voice-row]").length, 9, "the nine voices the pages name, with the filter back on «Hammasi»");
  const adam = ELEVENLABS_VOICES.find((v) => v.name === "Adam")!;
  assert.ok(!q(`[data-voice-row="${adam.id}"]`), "Adam is not offered");
  assert.ok(!q('[data-field="speed"]'), "the fal pages have no speed");
  assert.ok(q('[data-field="stability"]') && q('[data-field="lang"]'));
});
