import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { SpeechToolResults } = await import("../../components/studio/audio/SpeechToolPanel.tsx");
const { studioEntryPrice } = await import("../../lib/media/studio-pricing.ts");
const { setClientMixPrice } = await import("../../lib/media/catalog-mix.ts");
const { formatSom } = await import("../../lib/format.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");

/**
 * Studio P10 «Transkripsiya» / «Dublyaj» in the «Audio» tab (docs/studio/P10-SPEC.md), API stubbed at `fetch`.
 *
 * Locked here:
 *   - the chips follow the catalog listing: a P10 chip only when its model is listed (its switch on), between the
 *     provider modes and «Montaj»; with no provider mode listed, the first P10 tool opens by itself;
 *   - each panel draws EXACTLY its schema (one `data-field` per param), and «Subtitrni videoga yopishtirish» appears only
 *     once a VIDEO source is picked (an audio source hides it);
 *   - no price and no send before a source; then «Matnga aylantirish · ~<studioEntryPrice of the billed seconds>», the
 *     submit sends slug `studio-transcribe`, `{modelId, source, sourceSeconds, …schema}` and that `expectedPrice`; the
 *     dub refuses the same source and target language in the browser;
 *   - a finished transcript shows its text and SRT / VTT / TXT buttons; a dubbed MP4 plays as a video.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `formEntry` keeps `burn` for an audio source                             -> «fields»;
 *   2. `OWN_ROWS` emptied (ParamRows draws a text box for `source`)             -> «fields» (two `source` fields);
 *   3. `pickResult` rounds the seconds down (`Math.floor`, not `billedSeconds`)  -> «price button» (price / sent seconds);
 *   4. the P10 chips dropped from `chips()`                                     -> «chips»;
 *   5. `speechToolBlocker` ignores the language clash                           -> «dub».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const entry = (id: string) => view.find((e) => e.id === id)!;
const MUSIC = entry("elevenlabs/music");
const STT = entry("elevenlabs/scribe-v2");
const DUB = entry("elevenlabs/dubbing");
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

function api(models: unknown[]) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: (id) => generationDetail(id) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) return json(200, { purpose: "studio.audio", defaultModelId: null, models, pricing: RATE });
    if (url === "/api/media/mix-sources") return json(200, SOURCES);
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  setClientMixPrice(null);
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, points: 0, balance: 90_000 } as never });
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
async function openAudio() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
  await click(q('[data-studio-tab="audio"]'));
  await settle();
}
async function pick(value: string) {
  const el = q<HTMLSelectElement>('[data-field="source"] select');
  assert.ok(el, "the source picker");
  await act(async () => void fireEvent.change(el, { target: { value } }));
  await settle(2);
}
function fields(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of qa("[data-speech-tool] [data-field]")) out[el.dataset.field!] = (out[el.dataset.field!] ?? 0) + 1;
  return out;
}

test("chips: P10 chips only when listed, before «Montaj»; with no provider mode the first tool opens by itself", async () => {
  api([MUSIC, STT]);
  await openAudio();
  assert.deepEqual(qa("[data-audio-mode-chip]").map((b) => b.textContent), ["Musiqa", "Transkripsiya", "Montaj"], "dub switched off → no chip");
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "music");
  cleanup();
  dropMediaCatalog();
  api([STT, DUB]);
  await openAudio();
  assert.deepEqual(qa("[data-audio-mode-chip]").map((b) => b.textContent), ["Transkripsiya", "Dublyaj", "Montaj"]);
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "transcribe", "no provider mode: the first tool opens");
  assert.ok(q('[data-speech-tool="transcribe"]'));
});

test("fields: each panel draws exactly its schema; the burn row only for a video source", async () => {
  api([STT, DUB]);
  await openAudio();
  const names = (e: typeof STT, drop: string[] = []) => Object.fromEntries(e.params.filter((p) => !drop.includes(p.name)).map((p) => [p.name, 1]));
  assert.deepEqual(fields(), names(STT, ["burn"]), "no source yet: no burn row");
  await pick(VID);
  assert.deepEqual(fields(), names(STT), "a video: the burn row appears");
  await pick(SPEECH);
  assert.deepEqual(fields(), names(STT, ["burn"]), "an audio: the burn row goes again");
  await click(q('[data-audio-mode-chip="dub"]'));
  await settle();
  assert.deepEqual(fields(), names(DUB));
});

test("price button: no price / no send before a source; then the shared formula on the billed seconds, the request", async () => {
  const a = api([STT, DUB]);
  await openAudio();
  assert.ok(!/so‘m|so'm/.test(txt("[data-studio-submit]")), "no price before a source");
  await click(q("[data-studio-submit]"));
  assert.match(txt("[data-studio-error]"), /manbani tanlang/);
  assert.equal(a.posts().length, 0);
  await pick(VID);
  const want = studioEntryPrice(STT, { sourceSeconds: 9 }, RATE);
  assert.equal(want, 300, "9 s × 5.5 credits × $22 / 121 000 × 2 × 12 700 = 229 → 300");
  assert.ok(txt("[data-studio-submit]").includes(`Matnga aylantirish · ~${formatSom(want).replace(/\s/g, " ")}`), txt("[data-studio-submit]"));
  assert.match(txt("[data-speech-seconds]"), /9 soniya/);
  await click(q('[data-field="burn"] [role="switch"], [data-field="burn"] button'));
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-transcribe");
  assert.equal(post.body!.expectedPrice, want);
  assert.deepEqual(post.body!.values, { modelId: "elevenlabs/scribe-v2", source: `result:${VID}`, sourceSeconds: 9, language: "auto", speakers: false, burn: true });
});

test("dub: the same source and target language is refused in the browser; then sent with its own slug", async () => {
  const a = api([DUB]);
  await openAudio();
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "dub");
  await pick(SPEECH);
  const sel = (field: string) => q<HTMLSelectElement>(`[data-field="${field}"] select`);
  assert.ok(sel("target") && sel("sourceLang"), "both language pickers");
  await act(async () => void fireEvent.change(sel("sourceLang")!, { target: { value: "uz" } }));
  await click(q("[data-studio-submit]"));
  assert.match(txt("[data-studio-error]"), /bir xil/);
  assert.equal(a.posts().length, 0, "nothing sent");
  await act(async () => void fireEvent.change(sel("target")!, { target: { value: "ru" } }));
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-dub");
  assert.equal(post.body!.expectedPrice, studioEntryPrice(DUB, { sourceSeconds: 30 }, RATE));
  assert.deepEqual(post.body!.values, { modelId: "elevenlabs/dubbing", source: `result:${SPEECH}`, sourceSeconds: 30, target: "ru", sourceLang: "uz" });
});

test("results: a transcript shows its text + SRT / VTT / TXT, opens in full and copies; a dubbed MP4 plays as a video", async () => {
  const cue = { start: 0, end: 1, lines: ["Salom"], speaker: null };
  const transcript = generationDetail(VID, {
    type: "studio-transcribe",
    format: "txt",
    doc: { meta: { topic: "x", language: "uz" }, transcribe: { model: "elevenlabs/scribe-v2", source: "result", sourceId: SPEECH, sourceKind: "audio", sourceSeconds: 3, requestedLanguage: "auto", language: "uz", speakers: false, burned: false, output: "txt", text: "Salom, oʻrtoqlar", cues: [cue] } },
  });
  const dub = generationDetail(SPEECH, {
    type: "studio-dub",
    format: "mp4",
    doc: { meta: { topic: "x", language: "uz" }, dub: { model: "elevenlabs/dubbing", source: "result", sourceId: VID, sourceKind: "video", sourceSeconds: 8, target: "ru", sourceLang: "auto", output: "mp4", seconds: 8 } },
  });
  const job = (id: string, gen: unknown, modelId: string) => ({ id, modelId, modelLabel: "M", prompt: "p", price: 1600, sent: {}, gen: gen as never, error: null });
  render(h(AppRouterContext.Provider, { value: router }, h(SpeechToolResults, { jobs: [job(VID, transcript, "elevenlabs/scribe-v2"), job(SPEECH, dub, "elevenlabs/dubbing")], busy: false, onAgain: () => {} })));
  const cards = qa("[data-speech-result]");
  assert.equal(cards.length, 2);
  assert.match(cards[0]!.querySelector("[data-speech-text]")?.textContent ?? "", /Salom, oʻrtoqlar/);
  // P11 §D: «To‘liq matn» and «Nusxalash» sit above the subtitle downloads; the repeat is «Qayta yaratish» everywhere.
  assert.deepEqual([...cards[0]!.querySelectorAll<HTMLElement>("[data-result-action]")].map((b) => b.dataset.resultAction), ["full-text", "copy", "srt", "vtt", "download", "again"]);
  assert.equal(cards[0]!.querySelector('[data-result-action="again"]')!.textContent, "Qayta yaratish");
  const text = cards[0]!.querySelector<HTMLElement>("[data-speech-text]")!;
  assert.equal(text.dataset.speechTextFull, "false", "clamped first");
  assert.ok(text.className.includes("line-clamp-6"));
  await click(cards[0]!.querySelector('[data-result-action="full-text"]'));
  assert.equal(text.dataset.speechTextFull, "true", "MUTATSIYA: the full text opens");
  assert.ok(!text.className.includes("line-clamp-6"));
  assert.equal(cards[0]!.querySelector('[data-result-action="full-text"]')!.textContent, "Qisqartirish");
  // The copy goes through the clipboard with the whole text; the button says so.
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (s: string) => void written.push(s) } });
  try {
    await click(cards[0]!.querySelector('[data-result-action="copy"]'));
    await settle(2);
    assert.deepEqual(written, ["Salom, oʻrtoqlar"], "MUTATSIYA: the transcript, as the provider wrote it");
    assert.equal(cards[0]!.querySelector('[data-result-action="copy"]')!.textContent, "Nusxalandi");
  } finally {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  }
  assert.ok(!cards[0]!.querySelector("video"), "no burned clip: no video");
  assert.ok(cards[1]!.querySelector("[data-speech-video]"), "a dubbed MP4 plays as a video");
  assert.deepEqual([...cards[1]!.querySelectorAll<HTMLElement>("[data-result-action]")].map((b) => b.dataset.resultAction), ["download", "again"]);
  assert.ok(cards[1]!.querySelector("[data-favorite]"), "the star on a speech-tool result (a gallery item now)");
});
