import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { VideoResults } = await import("../../components/studio/video/VideoResults.tsx");
const { VoiceResults } = await import("../../components/studio/voice/VoiceResults.tsx");
const { MixHandoffContext } = await import("../../components/studio/audio/mix-handoff.tsx");
const { mixFromResult, INITIAL_MIX_STATE } = await import("../../components/studio/audio/mix-api.ts");
const { MIX_MODES, setClientMixPrice } = await import("../../lib/media/catalog-mix.ts");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");

/**
 * Studio P8c «Montaj» (docs/studio/P8-SPEC.md «P8c») with the API stubbed at `fetch`.
 *
 * Locked here:
 *   - the «Audio» tab ends with a «Montaj» chip; it opens the panel and asks `/api/media/mix-sources` (the user's own
 *     results per role + the base price); two sub-modes, each draws EXACTLY its schema (one `data-field` per param: the
 *     two pickers + the options), nothing of the other;
 *   - no price and no send before both pickers hold a result (the blocker names the missing one); then the button reads
 *     «Montaj qilish · ~<server base + tool %>», the submit sends slug `studio-mix`, `{modelId, …schema}` and
 *     that `expectedPrice`;
 *   - «Keyingi qadam»: a finished clip offers «Videoga ovoz qo'shish»; a finished speech «Videoga qo'shish» + «Fon musiqa
 *     qo'shish»; music / an effect only «Videoga qo'shish»; without the Studio's provider no «Montaj» button; on the page
 *     a finished music job's «Videoga qo'shish» opens «Montaj» with that result pre-picked as the audio.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `formEntry` keeps the id params (ParamRows draws a text box per id)          -> «sub-modes» (two data-fields);
 *   2. `mixBlocker` ignores the second picker                                       -> «price button» (sent without audio);
 *   3. `mixClientPrice` ignores the server's base (always the default 500)          -> «price button» (700 expected);
 *   4. VoiceResults offers «Fon musiqa qo'shish» on music too (`speechLike` = true) -> «Keyingi qadam»;
 *   5. `mixFromResult` writes the audio id into the video picker                    -> «Keyingi qadam» (page), «mixFromResult».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const AUDIO = ["elevenlabs/music", "elevenlabs/sfx"].map((id) => view.find((e) => e.id === id)!);
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const VID = "11111111-1111-4111-8111-111111111111";
const SPEECH = "22222222-2222-4222-8222-222222222222";
const MUSIC = "33333333-3333-4333-8333-333333333333";
const SOURCES = {
  price: 700,
  video: [{ id: VID, title: "Registon tongda", kind: "Video", seconds: 5, createdAt: "2026-11-01T10:00:00Z" }],
  audio: [
    { id: SPEECH, title: "Salom", kind: "Ovoz", seconds: 3, createdAt: "2026-11-01T10:00:00Z" },
    { id: MUSIC, title: "Kuy", kind: "Musiqa", seconds: 30, createdAt: "2026-11-01T10:00:00Z" },
  ],
  speech: [{ id: SPEECH, title: "Salom", kind: "Ovoz", seconds: 3, createdAt: "2026-11-01T10:00:00Z" }],
  music: [{ id: MUSIC, title: "Kuy", kind: "Musiqa", seconds: 30, createdAt: "2026-11-01T10:00:00Z" }],
  limits: { videoSeconds: 180, audioSeconds: 600 },
};
const musicDetail = (id: string) =>
  generationDetail(id, { type: "studio-audio", format: "mp3", fileName: "a.mp3", doc: { meta: { topic: "Kuy", language: "uz" }, studioAudio: { mode: "music", model: "elevenlabs/music", seconds: 30, prompt: "kuy", inputSeconds: null, voices: [], clone: false, variants: [] } } });

function api() {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: (id) => musicDetail(id) });
  const inner = globalThis.fetch;
  const extra: string[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) return json(200, { purpose: "studio.audio", defaultModelId: AUDIO[0]!.id, models: AUDIO, pricing: RATE });
    if (url === "/api/media/mix-sources") {
      extra.push(url);
      return json(200, SOURCES);
    }
    return inner(input as never, init);
  };
  return { ...base, extra };
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
async function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
}
async function openMontaj() {
  await click(q('[data-studio-tab="audio"]'));
  await settle();
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
}
async function pick(field: string, value: string) {
  const el = q<HTMLSelectElement>(`[data-field="${field}"] select`);
  assert.ok(el, field);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
function fields(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of qa("[data-mix-panel] [data-field]")) out[el.dataset.field!] = (out[el.dataset.field!] ?? 0) + 1;
  return out;
}

test("tab: «Montaj» is the last «Audio» chip; it opens the panel and loads the user's sources", async () => {
  const a = api();
  await mount();
  await click(q('[data-studio-tab="audio"]'));
  await settle();
  assert.deepEqual(qa("[data-audio-mode-chip]").map((b) => b.textContent), ["Musiqa", "Effekt", "Montaj"]);
  assert.equal(a.extra.length, 0, "sources are asked only when «Montaj» opens");
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
  assert.ok(q("[data-mix-panel]"));
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "mix");
  assert.equal(a.extra.length, 1);
  assert.deepEqual(qa("[data-mix-mode-chip]").map((b) => b.textContent), ["Videoga ovoz qo‘shish", "Ovoz + fon musiqa"]);
  assert.deepEqual(qa('[data-field="videoId"] option').map((o) => o.textContent), ["— tanlang —", "Registon tongda · Video · 5 s"]);
});

test("sub-modes: each draws exactly its schema (one data-field per param), nothing of the other", async () => {
  api();
  await mount();
  await openMontaj();
  for (const m of MIX_MODES) {
    await click(q(`[data-mix-mode-chip="${m.mode}"]`));
    await settle();
    assert.deepEqual(fields(), Object.fromEntries(m.entry.params.map((p) => [p.name, 1])), m.mode);
  }
});

test("price button: no price / no send before both picks; then the server base + tool %, the request", async () => {
  const a = api();
  await mount();
  await openMontaj();
  assert.ok(!/so‘m|so'm/.test(txt("[data-studio-submit]")), "no price before the picks");
  await click(q("[data-studio-submit]"));
  assert.match(txt("[data-studio-error]"), /Videoni tanlang/);
  await pick("videoId", VID);
  await click(q("[data-studio-submit]"));
  assert.match(txt("[data-studio-error]"), /Audioni tanlang/);
  assert.equal(a.posts().length, 0, "nothing sent");
  await pick("audioId", SPEECH);
  assert.match(txt("[data-studio-submit]"), /Montaj qilish · ~700/);
  await click(q('[data-field="keepOriginal"] [role="switch"], [data-field="keepOriginal"] button'));
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-mix");
  assert.equal(post.body!.expectedPrice, 700);
  assert.deepEqual(post.body!.values, { modelId: "studio/mix-video", videoId: VID, audioId: SPEECH, keepOriginal: true, audioVolume: 100, startOffset: 0 });
});

test("mixFromResult: the handed result lands in the right picker of the right sub-mode", () => {
  assert.deepEqual(mixFromResult(INITIAL_MIX_STATE, "video", VID), { mode: "video-voice", raw: { "video-voice": { videoId: VID } } });
  assert.deepEqual(mixFromResult(INITIAL_MIX_STATE, "audio", MUSIC), { mode: "video-voice", raw: { "video-voice": { audioId: MUSIC } } });
  const s = mixFromResult({ mode: "video-voice", raw: { "video-voice": { videoId: VID } } }, "speech", SPEECH);
  assert.deepEqual(s, { mode: "voice-music", raw: { "video-voice": { videoId: VID }, "voice-music": { speechId: SPEECH } } });
});

test("«Keyingi qadam»: clip / speech / music buttons; none without the Studio; the page pre-picks the result", async () => {
  const got: [string, string][] = [];
  const spy = (k: string, id: string) => void got.push([k, id]);
  const clip = generationDetail(VID, { type: "studio-video", format: "mp4", doc: { meta: { topic: "x", language: "uz" }, video: { provider: "kling", prompt: "p", aspect: "16:9", requestedSeconds: 5, seconds: 5, fromImage: false, model: "kling/kling-3" } } });
  const speech = generationDetail(SPEECH, { type: "studio-speech", format: "mp3", doc: { meta: { topic: "x", language: "uz" }, speech: { model: "elevenlabs/eleven-v3", seconds: 3, chars: 5, voices: ["A"], lines: [], clone: false } } });
  const job = (id: string, gen: unknown, modelId = "kling/kling-3") => ({ id, modelId, modelLabel: "M", prompt: "Effekt: Qor", price: 1, sent: { effect: "snow" }, gen: gen as never, error: null });
  const wrap = (child: unknown) => h(AppRouterContext.Provider, { value: router }, h(MixHandoffContext.Provider, { value: spy }, child as never));
  // An effect clip has no prompt handoff, but it still takes a voice.
  render(wrap(h(VideoResults, { jobs: [job(VID, clip)], busy: false, onAgain: () => {} })));
  assert.deepEqual(qa("[data-next-step] [data-result-action]").map((b) => b.dataset.resultAction), ["to-mix-video"]);
  await click(q('[data-result-action="to-mix-video"]'));
  cleanup();
  render(wrap(h(VoiceResults, { jobs: [job(SPEECH, speech, "elevenlabs/eleven-v3")], busy: false })));
  assert.deepEqual(qa("[data-next-step] [data-result-action]").map((b) => b.dataset.resultAction), ["to-mix-audio", "to-mix-music"]);
  await click(q('[data-result-action="to-mix-music"]'));
  cleanup();
  render(wrap(h(VoiceResults, { jobs: [job(MUSIC, musicDetail(MUSIC), "elevenlabs/music")], busy: false })));
  assert.deepEqual(qa("[data-next-step] [data-result-action]").map((b) => b.dataset.resultAction), ["to-mix-audio"], "music takes no background music");
  cleanup();
  assert.deepEqual(got, [["video", VID], ["speech", SPEECH]]);
  render(h(AppRouterContext.Provider, { value: router }, h(VoiceResults, { jobs: [job(SPEECH, speech)], busy: false })));
  assert.ok(!q("[data-next-step]"), "outside the Studio: no «Montaj» button");
  cleanup();

  // The page: a finished music job of the «Audio» tab → «Videoga qo'shish» → «Montaj», the audio pre-picked.
  const a = api();
  await mount();
  await click(q('[data-studio-tab="audio"]'));
  await settle();
  const ta = q<HTMLTextAreaElement>("[data-audio-prompt] textarea")!;
  await act(async () => void fireEvent.change(ta, { target: { value: "calm lo-fi piano, rainy evening" } }));
  await click(q("[data-studio-submit]"));
  await settle(30);
  const made = a.created[0]!;
  await click(q('[data-result-action="to-mix-audio"]'));
  await settle();
  assert.equal(q("[data-audio-tab]")!.dataset.audioMode, "mix");
  assert.equal(q("[data-mix-panel]")!.dataset.mixMode, "video-voice");
  assert.equal(q<HTMLSelectElement>('[data-field="audioId"] select')!.value, made, "the music job is the picked audio");
  assert.equal(q<HTMLSelectElement>('[data-field="videoId"] select')!.value, "");
  assert.equal(a.posts().length, 1, "nothing is charged by the handoff");
});
