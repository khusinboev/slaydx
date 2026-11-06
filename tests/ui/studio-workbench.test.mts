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
const { VoiceResults } = await import("../../components/studio/voice/VoiceResults.tsx");
const { switchChanges, switchNotice } = await import("../../components/studio/studio-values.ts");
const { mixBlocker, startOffsetMax } = await import("../../components/studio/audio/MixPanel.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { setClientMixPrice } = await import("../../lib/media/catalog-mix.ts");
const { formatSom } = await import("../../lib/format.ts");

/**
 * Studio P11 package D «Ish stoli» (docs/studio/P11-SPEC.md §D): one `StudioWorkbench` on every tab — the form column with
 * its price button, the results column with its empty text — the tab bar with «Galereya» and the balance, the phone's scroll
 * to the result after a submit, the one-line notice of a model switch, the «Montaj» start offset capped to the video and
 * the audition of a picked source.
 *
 * Locked here:
 *   - every tab and mode (Rasm, Video text, Ovoz, Audio music, Montaj, Transkripsiya) renders the workbench: the button in
 *     the form column, the results column with `data-studio-empty` while no job runs, the tab's own results hook when one does;
 *   - the bar: the four tabs, «Galereya» (→ «Yaratish» inside the gallery, no form drawn), the balance link;
 *   - the submit scrolls the results into view in ONE column (matchMedia says so) and never in two;
 *   - `switchChanges`: a setting the new model lacks or does not accept is named with its old value (and the new default);
 *     an untouched default or the prompt is never named; the Video tab shows the line and lets it be closed;
 *   - «Montaj»: the start offset ends where the picked video ends (the row's cap, the pre-press blocker); a picked source
 *     plays in place.
 *
 * Mutations (each turned the named test red, then restored):
 *   `useResultsScroll` without the `twoColumns()` early return                 -> «the submit scrolls…» (two columns);
 *   `scrollToResults()` dropped from the Rasm `send`                            -> «the submit scrolls…» (one column);
 *   `switchChanges` skips the default check (`normalize(...) === p.default`)     -> «switchChanges» (the untouched aspect);
 *   `switchChanges` forgets `to: null` for a missing param                       -> «switchChanges» (the sound on Omni);
 *   `startOffsetMax` returns `undefined` always                                 -> «Montaj: the start offset…»;
 *   `mixBlocker` ignores `videoSeconds`                                          -> «Montaj: the start offset…» (the blocker);
 *   `StudioWorkbench` draws `results` even with `hasResults` false              -> «every tab…» (the empty text).
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const realMatchMedia = window.matchMedia;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const OMNI = by("google/omni-video");
const K3 = by("kling/kling-3");
const K4 = by("kling/kling-4");
const K4F = by("kling/kling-4-flash");
const FX = by("kling/effects");
const SPEECH = [by("elevenlabs/eleven-v3"), by("google/gemini-tts")];
const AUDIO = [by("elevenlabs/music"), by("elevenlabs/sfx"), by("elevenlabs/scribe-v2")];
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const VID = "11111111-1111-4111-8111-111111111111";
const SPEECH_ID = "22222222-2222-4222-8222-222222222222";
const SOURCES = {
  price: 700,
  video: [{ id: VID, title: "Registon tongda", kind: "Video", seconds: 5, createdAt: "2026-11-01T10:00:00Z" }],
  audio: [{ id: SPEECH_ID, title: "Salom", kind: "Ovoz", seconds: 3, createdAt: "2026-11-01T10:00:00Z" }],
  speech: [{ id: SPEECH_ID, title: "Salom", kind: "Ovoz", seconds: 3, createdAt: "2026-11-01T10:00:00Z" }],
  music: [],
  limits: { videoSeconds: 180, audioSeconds: 600 },
};
const VOICES = {
  library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
  mine: [],
  clone: { available: false, price: 5000, consentText: "", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
};

function api() {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 20, step: "Chizilmoqda" }) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) return json(200, { purpose: "studio.video", defaultModelId: OMNI.id, models: [OMNI, K3, K4, K4F, FX], pricing: RATE });
    if (url.startsWith("/api/media/catalog?purpose=studio.speech")) return json(200, { purpose: "studio.speech", defaultModelId: SPEECH[0]!.id, models: SPEECH, pricing: RATE });
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) return json(200, { purpose: "studio.audio", defaultModelId: AUDIO[0]!.id, models: AUDIO, pricing: RATE });
    if (url === "/api/media/voices") return json(200, VOICES);
    if (url === "/api/media/mix-sources") return json(200, SOURCES);
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
  window.matchMedia = realMatchMedia;
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
async function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
}
async function tab(t: string) {
  await click(q(`[data-studio-tab="${t}"]`));
  await settle();
}
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel);
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
/** The workbench of the screen: the form column holds the button, the results column its empty text or `hook`. */
function expectWorkbench(where: string, hook: string | null) {
  const wb = q("[data-studio-workbench]");
  assert.ok(wb, `${where}: the workbench`);
  assert.ok(wb.querySelector("[data-studio-form] [data-studio-submit]"), `${where}: the button is in the form column`);
  const pane = wb.querySelector('[data-studio-pane="results"]');
  assert.ok(pane, `${where}: the results column`);
  if (hook) assert.ok(pane.querySelector(hook), `${where}: ${hook} in the results column`);
  else assert.ok(pane.querySelector("[data-studio-empty]"), `${where}: the empty text`);
}

test("every tab and mode renders the workbench: the form column with the button, the results column with the empty text", async () => {
  api();
  await mount();
  expectWorkbench("Rasm", null);
  assert.equal(q("[data-studio-empty]")!.textContent, "Yaratilgan rasmlar shu yerda ko‘rinadi.");
  await tab("video");
  await click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === "Matndan / rasmdan"));
  expectWorkbench("Video", null);
  assert.equal(q("[data-studio-empty]")!.textContent, "Yaratilgan videolar shu yerda ko‘rinadi.");
  await tab("ovoz");
  expectWorkbench("Ovoz", null);
  await tab("audio");
  expectWorkbench("Audio · Musiqa", null);
  await click(q('[data-audio-mode-chip="transcribe"]'));
  await settle();
  expectWorkbench("Audio · Transkripsiya", null);
  assert.equal(q("[data-studio-empty]")!.textContent, "Transkripsiyalar shu yerda ko‘rinadi.");
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
  expectWorkbench("Audio · Montaj", null);
  // A running job: the tab's own results hook sits in the results column, the empty text is gone.
  await tab("rasm");
  await type('[data-field="prompt"] textarea', "Registon tongda");
  await click(q("[data-studio-submit]"));
  await settle();
  expectWorkbench("Rasm with a job", "[data-studio-results] [data-studio-job]");
  assert.ok(!q("[data-studio-empty]"), "MUTATSIYA: the empty text with a job");
  assert.ok(q("[data-studio-pane-title]"), "the column is titled");
});

test("the bar: four tabs, «Galereya» ↔ «Yaratish», the balance link; no form inside the gallery", async () => {
  api();
  await mount();
  assert.deepEqual(qa("[data-studio-bar] [data-studio-tabs] [role=tab]").map((b) => b.textContent), ["Rasm", "Video", "Ovoz", "Audio"]);
  assert.ok(q("[data-studio-bar] [data-studio-gallery-link]"));
  assert.equal(q("[data-studio-bar-balance]")!.textContent, formatSom(900_000));
  assert.equal(q<HTMLAnchorElement>("[data-studio-bar-balance]")!.getAttribute("href"), "/uz/wallet");
  await click(q("[data-studio-gallery-link]"));
  await settle();
  assert.ok(!q("[data-studio-form]"), "no form in the gallery");
  assert.ok(q("[data-studio-bar] [data-studio-create-link]"), "the bar now offers «Yaratish»");
  assert.equal(qa('[data-studio-tabs] [role=tab][aria-selected="true"]').length, 0, "no tab is current in the gallery");
  // A tab press leaves the gallery for that tab.
  await tab("video");
  assert.ok(q("[data-video-tab]"));
  assert.equal(q('[data-studio-tab="video"]')!.getAttribute("aria-selected"), "true");
});

test("the submit scrolls the results into view in one column, never in two", async () => {
  const calls: Element[] = [];
  const proto = window.HTMLElement.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
  const realScroll = proto.scrollIntoView;
  proto.scrollIntoView = function (this: Element) {
    calls.push(this);
  };
  let wide = false;
  window.matchMedia = ((query: string) => ({ matches: wide && query === "(min-width: 768px)", media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  try {
    api();
    await mount();
    await type('[data-field="prompt"] textarea', "Registon tongda");
    await click(q("[data-studio-submit]"));
    await settle();
    assert.ok(calls.some((el) => el.matches('[data-studio-pane="results"]')), "MUTATSIYA: one column — the results pane scrolled into view");
    // Two columns: the results are beside the form.
    calls.length = 0;
    wide = true;
    await tab("video");
    await click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === "Matndan / rasmdan"));
    await type("[data-video-prompt] textarea", "Registon tongda, kamera sekin");
    await click(q("[data-studio-submit]"));
    await settle();
    assert.ok(q("[data-video-results] [data-studio-job]"), "the clip is queued");
    assert.ok(!calls.some((el) => el.matches('[data-studio-pane="results"]')), "MUTATSIYA: two columns — no scroll");
    // One column on the Video tab scrolls too.
    wide = false;
    await click(q("[data-studio-submit]"));
    await settle();
    assert.ok(calls.some((el) => el.matches('[data-studio-pane="results"]')), "one column on Video — scrolled");
  } finally {
    proto.scrollIntoView = realScroll;
  }
});

test("switchChanges: a lacking or refused setting is named with its old value; untouched defaults and the prompt are not", () => {
  // Kling 3 with sound on and 9:16 → Omni: no `sound` param (dropped, old value named); 9:16 accepted (silent); prompt silent.
  assert.deepEqual(switchChanges(K3, OMNI, { prompt: "x", sound: true, aspect: "9:16" }), [{ name: "sound", label: "Ovoz", from: "ha", to: null }]);
  assert.equal(switchNotice(K3, OMNI, { prompt: "x", sound: true, aspect: "9:16" }), "Google Veo (Gemini): Ovoz (ha) bu modelda yo‘q");
  // Kling 4 at 1080p → Flash (720p only): the quality is lacking; 15 s is accepted by both.
  const k4 = switchChanges(K4, K4F, { resolution: "1080p", seconds: 15 });
  assert.deepEqual(k4.map((c) => c.name), ["resolution"]);
  assert.equal(k4[0]!.from, "1080p (Full HD)", "the option's label, not its value");
  // Kling 4 at 15 s → Omni (≤ 8 s): the seconds are refused, the new default is named.
  assert.deepEqual(switchChanges(K4, OMNI, { seconds: 15 }), [{ name: "seconds", label: "Davomiylik", from: "15", to: "5" }]);
  // Untouched (still the old default) or empty: nothing to say — even when the new model lacks the param.
  assert.deepEqual(switchChanges(K3, OMNI, { sound: false, aspect: "16:9", prompt: "x" }), [], "MUTATSIYA: the default must not be named");
  assert.equal(switchNotice(OMNI, K3, { prompt: "x" }), null);
  // The ElevenLabs «1 daq» has no Lyria value: the Lyria default is named.
  assert.deepEqual(switchChanges(by("elevenlabs/music"), by("google/lyria-3"), { length: "60" }), [{ name: "length", label: "Uzunligi", from: "1 daq", to: "Qisqa (30 s)" }]);
});

test("Video: the switch's line is shown, closable, replaced by the next switch, absent when nothing changed", async () => {
  api();
  await mount();
  await tab("video");
  await click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === "Matndan / rasmdan"));
  await click(q(`[data-model-card="${K3.id}"]`));
  assert.ok(!q("[data-switch-notice]"), "Omni → Kling 3 with an empty form: nothing changed");
  await click(q('[data-field="sound"] [role="switch"]'));
  await click(q(`[data-model-card="${OMNI.id}"]`));
  assert.equal(q("[data-switch-notice]")!.textContent, "Google Veo (Gemini): Ovoz (ha) bu modelda yo‘q", "MUTATSIYA: the silent reset");
  await click(q('[data-switch-notice] button[aria-label="Yopish"]'));
  assert.ok(!q("[data-switch-notice]"), "closed");
});

test("result cards: the running card names the model and the price; SFX variants each play and download; the star on audio", async () => {
  const running = { id: "r1", modelId: "elevenlabs/sfx", modelLabel: "Ovoz effekti", prompt: "eshik g‘ichirlaydi", price: 1600, sent: {}, error: null, gen: generationDetail("r1", { type: "studio-audio", status: "IN_PROGRESS", progress: 40, step: "Yaratilmoqda" }) };
  const variants = [1, 2, 3].map((n) => ({ assetId: String(n).repeat(24), seconds: 5 }));
  const done = {
    id: "d1",
    modelId: "elevenlabs/sfx",
    modelLabel: "Ovoz effekti",
    prompt: "eshik g‘ichirlaydi",
    price: 4800,
    sent: {},
    error: null,
    gen: generationDetail("d1", { type: "studio-audio", format: "mp3", doc: { meta: { topic: "x" }, studioAudio: { mode: "sfx", model: "elevenlabs/sfx", seconds: 5, prompt: "eshik", inputSeconds: null, voices: [], clone: false, variants } } }),
  };
  render(h(AppRouterContext.Provider, { value: router }, h(VoiceResults, { jobs: [running, done] as never, busy: false, onAgain: () => {} })));
  const card = q("[data-studio-running]")!;
  assert.ok(card, "the waiting card");
  assert.equal(card.querySelector("[data-studio-job-meta]")!.textContent, `Ovoz effekti · ${formatSom(1600)}`, "MUTATSIYA: the progress panel alone said neither");
  assert.ok(card.querySelector("[data-generation-progress]"), "…above the app's progress panel");
  assert.match(card.querySelector("[data-studio-job-prompt]")!.textContent ?? "", /eshik/);
  const audio = q("[data-studio-audio]")!;
  assert.deepEqual([...audio.querySelectorAll("[data-result-variant] audio")].map((a) => a.getAttribute("src")), variants.map((v) => `/api/generations/d1/assets/${v.assetId}`), "MUTATSIYA: every paid variant plays");
  assert.equal(audio.querySelectorAll('[data-result-action="download-variant"]').length, 3);
  assert.ok(audio.querySelector("[data-favorite]"), "the star on an audio card");
  assert.equal(audio.querySelector('[data-result-action="again"]')!.textContent, "Qayta yaratish");
  cleanup();
  // One clip: no variant list (the result file is the clip).
  const one = { ...done, gen: generationDetail("d2", { type: "studio-audio", format: "mp3", doc: { meta: { topic: "x" }, studioAudio: { mode: "sfx", model: "elevenlabs/sfx", seconds: 5, prompt: "eshik", inputSeconds: null, voices: [], clone: false, variants: [] } } }) };
  render(h(AppRouterContext.Provider, { value: router }, h(VoiceResults, { jobs: [one] as never, busy: false })));
  assert.ok(!q("[data-result-variants]"));
});

test("Transkripsiya / Dublyaj take the user's own video: the «Video yuklash» tab, the MP4 check, the upload with kind=video, the billed seconds", async () => {
  const uploads: { kind: string | null; name: string }[] = [];
  const base = api();
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input) === "/api/media/audio-inputs" && init?.method === "POST") {
      const form = init.body as FormData;
      const file = form.get("file") as File;
      uploads.push({ kind: (form.get("kind") as string | null) ?? null, name: file.name });
      return json(200, { id: "a".repeat(24), seconds: 7, mime: "video/mp4", size: 1000 });
    }
    return inner(input as never, init);
  };
  void base;
  await mount();
  await tab("audio");
  await click(q('[data-audio-mode-chip="transcribe"]'));
  await settle();
  const tabs = () => qa('[data-field="source"] [role="radio"]').map((b) => b.textContent);
  assert.deepEqual(tabs(), ["Natijalarimdan", "Audio yuklash", "Video yuklash"], "MUTATSIYA: the video tab");
  await click(qa('[data-field="source"] [role="radio"]').find((b) => b.textContent === "Video yuklash"));
  assert.ok(q("[data-video-input]"), "the video row");
  assert.match(q("[data-video-input-seconds]")!.textContent ?? "", /Hali video tanlanmagan/);
  const input = q<HTMLInputElement>("[data-video-file]")!;
  // Not an MP4: refused in the browser, nothing uploaded.
  await act(async () => void fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], "a.mov", { type: "video/quicktime" })] } }));
  await settle(2);
  assert.match(q("[data-video-input-error]")!.textContent ?? "", /Faqat MP4/);
  assert.equal(uploads.length, 0, "MUTATSIYA: no request for a refused file");
  // An MP4: uploaded with kind=video; the server's seconds show and price the job; the burn row appears (a video source).
  await act(async () => void fireEvent.change(input, { target: { files: [new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" })] } }));
  await settle(4);
  assert.deepEqual(uploads, [{ kind: "video", name: "clip.mp4" }], "MUTATSIYA: the upload says it is a video");
  assert.match(q("[data-video-input-seconds]")!.textContent ?? "", /Yuklandi: 0:07 \(7 s\)/);
  assert.equal(q("[data-speech-seconds]")!.textContent, "Narx 7 soniya uchun hisoblanadi.", "the server's seconds price the job");
  assert.ok(q('[data-field="burn"]'), "a video source may be burned");
  assert.ok(!q("[data-video-input-error]"));
});

test("Montaj: the start offset ends where the picked video ends (the row, the blocker); a picked source plays in place", async () => {
  assert.equal(startOffsetMax(null), undefined, "no video known: the schema's own cap");
  assert.equal(startOffsetMax(5), 4);
  assert.equal(startOffsetMax(0.4), 0);
  assert.equal(mixBlocker("video-voice", { videoId: VID, audioId: SPEECH_ID, startOffset: 7 }, 5), "Audio boshlanishi videodan qisqa bo‘lsin (video 5 soniya).");
  assert.equal(mixBlocker("video-voice", { videoId: VID, audioId: SPEECH_ID, startOffset: 4 }, 5), null);
  assert.equal(mixBlocker("video-voice", { videoId: VID, audioId: SPEECH_ID, startOffset: 7 }, null), null, "MUTATSIYA: an unknown length cannot block");
  api();
  await mount();
  await tab("audio");
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
  // No video yet: the schema's range (0–179) as presets + input.
  assert.ok(q('[data-field="startOffset"] [data-presets]'), "the long range before a pick");
  assert.ok(!q('[data-mix-audition="video"]'), "nothing to audition yet");
  const select = q<HTMLSelectElement>('[data-field="videoId"] select')!;
  await act(async () => void fireEvent.change(select, { target: { value: VID } }));
  await settle(2);
  // A 5 s video: 0–4, few enough values for chips; the input is gone with them.
  assert.deepEqual(qa('[data-field="startOffset"] [role="radio"]').map((b) => b.textContent), ["0", "1", "2", "3", "4"], "MUTATSIYA: the cap of the chosen video");
  const audition = q<HTMLVideoElement>('[data-mix-audition="video"]');
  assert.ok(audition, "the picked video plays in place");
  assert.match(audition.getAttribute("src") ?? "", new RegExp(`/api/generations/${VID}/file\\?inline=1`));
  const audio = q<HTMLSelectElement>('[data-field="audioId"] select')!;
  await act(async () => void fireEvent.change(audio, { target: { value: SPEECH_ID } }));
  await settle(2);
  assert.ok(q('[data-mix-audition="audio"]'), "the picked audio plays in place");
});

test("price button: on a narrow phone the words give way, the price keeps its own box, the text reads the same", async () => {
  const { PriceButton } = await import("../../components/studio/PriceButton.tsx");
  const label = `Yaratish · «Juda uzun effekt nomi» · ${formatSom(21_400)}`;
  render(h(PriceButton, { count: 1, price: 21_400, balance: null, loading: false, disabled: false, typing: false, label, onSubmit: () => {} }));
  const total = document.querySelector("[data-price-total]")!;
  assert.equal(total.textContent, label);
  const tail = total.querySelector<HTMLElement>("[data-price-tail]");
  assert.ok(tail, "the price is its own box");
  assert.equal(tail.textContent, ` · ${formatSom(21_400)}`);
  assert.match(tail.className, /shrink-0/);
});

