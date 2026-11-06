import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { StrictMode, createElement as h } from "react";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG, studioPurposeOf } from "../../lib/media/catalog.ts";
import { ASPECT_FOLLOWS_IMAGE } from "../../lib/media/catalog-video.ts";
import { MIX_MODES } from "../../lib/media/catalog-mix.ts";
import { AUDIO_MODES } from "../../lib/media/catalog-audio.ts";
import { SPEECH_TOOL_MODES } from "../../lib/media/catalog-transcribe.ts";
import { ELEVENLABS_VOICES, GEMINI_VOICES } from "../../lib/media/catalog-speech.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog, parseActiveJobs } = await import("../../components/studio/studio-api.ts");
const { formatSom } = await import("../../lib/format.ts");
const { draftKey, readDraft, writeDraft, removeDraft } = await import("../../components/studio/useDraft.ts");
const { parseAudioDraft, parseRasmDraft, parseVideoDraft, parseVoiceDraft } = await import("../../components/studio/studio-drafts.ts");
const { modeFromSearch, studioSearch } = await import("../../components/studio/studio-url.ts");
const { INITIAL_RASM, enterRasmMode, patchRasmForm, rasmForm } = await import("../../components/studio/studio-modes.ts");
const { modelNoun } = await import("../../components/studio/MediaModelPicker.tsx");
const { startImageHint } = await import("../../components/studio/video/VideoTab.tsx");
const { retryLabel } = await import("../../components/studio/JobResult.tsx");
const { REFUND_PHRASE } = await import("../../lib/refund-phrase.ts");
const { useStudioJobs } = await import("../../components/studio/useStudioJobs.ts");
const { installNav } = await import("../../lib/nav/history.ts");
const { studioPrice } = await import("../../components/studio/studio-price.ts");

/**
 * Studio reliability (docs/studio/P11-SPEC.md «C. Reliability»), the page with the API stubbed at `fetch`.
 *
 * Locked here:
 *   - a refresh keeps the tab, the mode, the form and the running jobs; a good submit clears the draft, a retry of an old
 *     job does not; no storage (or broken JSON) renders as usual; one user's draft never reaches another;
 *   - links: `?tab=&mode=` open the right mode, a back press follows the URL, the login keeps the query;
 *   - leaving a mode loses neither its prompt nor its settings, and a result's «Tahrirlash» still starts empty;
 *   - failures that used to be silent: gallery tools, voices in «Ovoz» and «Audio», a voice preview, a lost speech tool
 *     job, the «Montaj» sources; the tablet's empty results column;
 *   - a retry says its price; a music job's fallback does not say «Ovoz»; the Ovoz picker does not say «Rasm».
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `useDraft` writes nothing (`writeDraft` body removed)                              -> «refresh: the prompt»;
 *   2. `rasmDraft.clear()` not called after the submit                                    -> «a good submit clears»;
 *   3. `again()` clears the draft too (`send` in `again` followed by `rasmDraft.clear()`) -> «a retry keeps the draft»;
 *   4. `readDraft` without the try/catch                                                  -> «no storage»;
 *   5. `draftKey` without the user id                                                     -> «another user»;
 *   6. the URL effect removed (`replaceState` never called)                               -> «the tab and the mode live in the URL»;
 *   7. `popstate` listener removed                                                        -> «back follows the URL»;
 *   8. login `returnTo` back to the bare path                                             -> «the login keeps»;
 *   9. `fetchActiveJobs` call dropped                                                     -> «refresh: running jobs»;
 *  10. the tool → tab routing sends every job to «Rasm»                                   -> «refresh: running jobs»;
 *  11. `enterRasmMode` starts the mode from an empty `forms` (the old wipe)               -> «leaving a mode», «enterRasmMode»;
 *  12. `enterRasmMode` carries the prompt into every tool mode                            -> «enterRasmMode», studio-library NIT-9;
 *  13. gallery `SubmitError` removed                                                      -> «gallery tools»;
 *  14. `VoicesState` not drawn in VoiceTab, then in AudioTab                               -> «voices» (each);
 *  15. `onError={onFail}` back to `onEnd`                                                 -> «a voice preview»;
 *  16. `JobResult` hides the failure for a job with an error and no state                 -> «a lost speech tool job»;
 *  17. MixPanel without the retry button                                                  -> «Montaj sources»;
 *  18. `retryLabel` without the price                                                     -> «a retry says its price», «retryLabel»;
 *  19. AudioTab's `failed` prop removed                                                   -> «music»;
 *  20. `modelNoun` always «Rasm»                                                          -> «the sheet's noun», «the Ovoz picker»;
 *  21. `startImageHint` always «nisbat suratdan olinadi»                                  -> «the start image hint»;
 *  22. the empty column back to `xl:block`                                                -> «the tablet's»;
 *  23. `useDraft` keeps the write queued by the restore's own pass (`replaced` ignored)     -> «refresh under StrictMode»;
 *  24. the tabs start without the link's mode (applied only after the first URL write)    -> «the login keeps»;
 *  25. `retryPrice` back to `job.price` for another purpose                               -> «cross-purpose retry: the label»;
 *  26. `again` drops `shown` (the catalog's price goes out)                               -> «cross-purpose retry: a price not known yet»;
 *  27. `<StudioApp />` without the key                                                    -> «an account switched in place»;
 *  28. `onNavigate` subscription removed                                                  -> «a soft navigation»;
 *  29. `useStudioJobs` ignores `open` (restored jobs always polled)                       -> «refresh: running jobs», «restored jobs stop»;
 *  30. `track` without the early return                                                   -> «track: a live card»;
 *  31. `restore` without the early return                                                 -> «restore: a live card»;
 *  32. `signOut` does not drop the drafts                                                 -> «logout»;
 *  33. `onDraftsDropped` not honoured (the pending write lands after the logout)          -> «logout».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const SPEECH = ["elevenlabs/eleven-v3", "google/gemini-tts"].map(by);
const AUDIO = AUDIO_MODES.map((m) => by(m.model));
const TRANSCRIBE = SPEECH_TOOL_MODES[0]!.model;
const EDIT = view.filter((e) => studioPurposeOf(e.id) === "studio.edit");
const OMNI = by("google/omni-video");
const VOICES = {
  library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
  mine: [],
  clone: { available: false, price: 5000, consentText: "", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
};
const SOURCES = { price: 700, video: [], audio: [], speech: [], music: [], limits: { videoSeconds: 180, audioSeconds: 600 } };
const JOB = (n: number) => `4444444${n}-4444-4444-8444-444444444444`;

type Opts = Parameters<typeof installApi>[0] & { voices?: () => Response; sources?: () => Response; fromResult?: () => Response };
function api(o: Opts = {}) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]), ...o });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/media/voices") return o.voices ? o.voices() : json(200, VOICES);
    if (url === "/api/media/mix-sources") return o.sources ? o.sources() : json(200, SOURCES);
    if (url === "/api/media/inputs/from-result") return o.fromResult ? o.fromResult() : json(200, { assetId: "abcdef012345", mime: "image/png", size: 1, w: 1, h: 1 });
    if (url === "/api/media/catalog?purpose=studio.speech") return json(200, { purpose: "studio.speech", defaultModelId: SPEECH[0]!.id, models: SPEECH, pricing: PRICING });
    if (url === "/api/media/catalog?purpose=studio.audio") return json(200, { purpose: "studio.audio", defaultModelId: null, models: [...AUDIO, by(TRANSCRIBE)], pricing: PRICING });
    if (url === "/api/media/catalog?purpose=studio.video") return json(200, { purpose: "studio.video", defaultModelId: OMNI.id, models: [OMNI], pricing: PRICING });
    if (url === "/api/media/catalog?purpose=studio.edit") return json(200, { purpose: "studio.edit", defaultModelId: EDIT[0]!.id, models: EDIT, pricing: PRICING });
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  window.localStorage.clear();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, balance: 90_000 } as never });
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  globalThis.fetch = realFetch;
  dropMediaCatalog();
  window.localStorage.clear();
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
/** A browser refresh, as far as the page can tell: everything in memory goes (the pending draft is written on the way). */
async function refresh() {
  cleanup();
  dropMediaCatalog();
  await mount();
}
const promptBox = () => q<HTMLTextAreaElement>('[data-field="prompt"] textarea');
async function type(el: HTMLTextAreaElement | null, value: string) {
  assert.ok(el, "text box");
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const tab = (t: string) => q(`[data-studio-tab="${t}"]`);
const selected = () => qa("[data-studio-tab]").find((b) => b.getAttribute("aria-selected") === "true")?.getAttribute("data-studio-tab");

/* ─────────────── a refresh keeps the work ─────────────── */

test("refresh: the prompt and the tab come back", async () => {
  api();
  await mount();
  await type(promptBox(), "Registon maydoni kechqurun");
  await refresh();
  assert.equal(promptBox()?.value, "Registon maydoni kechqurun");

  await click(tab("ovoz"));
  await settle();
  await type(q<HTMLTextAreaElement>("[data-voice-text] textarea"), "Assalomu alaykum");
  await refresh();
  assert.equal(selected(), "ovoz");
  assert.equal(q<HTMLTextAreaElement>("[data-voice-text] textarea")?.value, "Assalomu alaykum");
  await click(tab("rasm"));
  await settle();
  assert.equal(promptBox()?.value, "Registon maydoni kechqurun", "each tab keeps its own draft");
});

test("refresh under StrictMode: the remount's flush does not overwrite the draft with the empty form", async () => {
  api();
  await mount();
  await type(promptBox(), "Registon maydoni kechqurun");
  cleanup();
  dropMediaCatalog();
  render(h(StrictMode, null, h(AppRouterContext.Provider, { value: router }, h(StudioPage))));
  await settle();
  assert.equal(promptBox()?.value, "Registon maydoni kechqurun");
  cleanup();
  assert.equal((readDraft(draftKey(USER.id, "rasm")) as { forms: { image: { raw: { prompt: string } } } }).forms.image.raw.prompt, "Registon maydoni kechqurun");
});

test("a good submit clears the draft; the failed one keeps it", async () => {
  let refuse = true;
  const a = api({ create: (body) => (refuse ? json(500, { error: "Xatolik" }) : json(202, { id: JOB(1), price: body.expectedPrice, status: "QUEUED" })), generation: (id) => generationDetail(id) });
  await mount();
  await type(promptBox(), "Registon maydoni kechqurun");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 1);
  await refresh();
  assert.equal(promptBox()?.value, "Registon maydoni kechqurun", "a refused job loses nothing");

  refuse = false;
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(readDraft(draftKey(USER.id, "rasm")), null);
  await refresh();
  assert.equal(promptBox()?.value, "", "nothing left to bring back");
});

test("a retry of an old job keeps the draft of the form", async () => {
  const a = api({ generation: (id) => generationDetail(id, { status: "FAILED", error: "Yiqildi", doc: null }) });
  await mount();
  await type(promptBox(), "Birinchi ish");
  await click(q("[data-studio-submit]"));
  await settle(20);
  await type(promptBox(), "Keyingi matn");
  await settle(1);
  await click(q('[data-studio-failed] [data-result-action="again"]'));
  await settle();
  assert.equal(a.posts().length, 2);
  await refresh();
  assert.equal(promptBox()?.value, "Keyingi matn");
});

test("no storage, or a broken draft: the page renders and works as usual", async (t) => {
  const storage = Object.getPrototypeOf(window.localStorage) as Storage;
  for (const m of ["getItem", "setItem", "removeItem"] as const) {
    t.mock.method(storage, m, () => {
      throw new Error("denied");
    });
  }
  assert.equal(readDraft("k"), null);
  writeDraft("k", { a: 1 });
  removeDraft("k");
  const a = api();
  await mount();
  await type(promptBox(), "Registon maydoni kechqurun");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 1);
  t.mock.restoreAll();

  cleanup();
  dropMediaCatalog();
  window.localStorage.setItem(draftKey(USER.id, "rasm"), "{not json");
  await mount();
  assert.ok(promptBox(), "the form is drawn");
  assert.equal(promptBox()?.value, "");
});

test("a draft of the wrong shape never reaches a tab", () => {
  assert.equal(parseRasmDraft("x"), null);
  assert.deepEqual(parseRasmDraft({ mode: "nope", forms: { image: { chosen: 7, raw: "a" }, junk: {} } }), { mode: "image", forms: { image: { chosen: null, raw: {} } } });
  assert.deepEqual(parseVideoDraft({ mode: "x", raw: 1, effectImage: 2, fromPicture: "yes" }), { mode: null, chosen: null, raw: {}, effect: null, effectImage: "", effectImage2: "", fromPicture: false });
  assert.deepEqual(parseVoiceDraft({ filter: "x", speaker: -1, raw: null }), { mode: null, chosen: null, raw: {}, filter: "all", speaker: 0 });
  const audio = parseAudioDraft({ mode: "mix", raw: { music: { prompt: "kuy" }, junk: { a: 1 } }, filter: "mine", models: { music: "a", sfx: 2 }, mix: { mode: "x", raw: { "voice-music": { a: 1 } } }, tools: { dub: { raw: {}, tab: "upload", kind: "x" } } });
  assert.equal(audio?.mode, "mix");
  assert.deepEqual(audio?.raw, { music: { prompt: "kuy" } });
  assert.deepEqual(audio?.models, { music: "a" });
  assert.deepEqual(audio?.mix, { mode: "video-voice", raw: { "voice-music": { a: 1 } } });
  assert.deepEqual(audio?.tools, { dub: { raw: {}, tab: "upload", kind: null } });
  // P11 §D: the «Video yuklash» tab survives a refresh with its upload; anything else falls back to the results.
  const own = parseAudioDraft({ tools: { transcribe: { raw: { source: "upload:a", sourceSeconds: 5 }, tab: "video", kind: "video" }, dub: { raw: {}, tab: "junk" } } });
  assert.equal(own?.tools?.transcribe?.tab, "video", "MUTATSIYA: the own video's tab is lost on a refresh");
  assert.equal(own?.tools?.dub?.tab, "result");
});

test("another user on the same browser sees none of the draft", async () => {
  api();
  await mount();
  await type(promptBox(), "Birovning matni");
  cleanup();
  dropMediaCatalog();
  useAppStore.setState({ user: { ...USER, id: "u2" } as never });
  await mount();
  assert.equal(promptBox()?.value, "");
});

/* ─────────────── the URL ─────────────── */

test("the tab and the mode live in the URL, other params stay", async () => {
  window.history.replaceState(null, "", "/uz/studio?bt=abc");
  api();
  await mount();
  assert.equal(window.location.search, "?bt=abc", "the defaults are left out");
  await click(tab("video"));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("tab"), "video");
  assert.equal(new URLSearchParams(window.location.search).get("bt"), "abc");
  await click(tab("audio"));
  await settle();
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
  assert.equal(new URLSearchParams(window.location.search).get("tab"), "audio");
  assert.equal(new URLSearchParams(window.location.search).get("mode"), "mix");
  await refresh();
  assert.equal(selected(), "audio");
  assert.ok(q("[data-mix-panel]"), "the refresh lands on «Montaj»");
  await click(tab("rasm"));
  await settle();
  assert.equal(window.location.search, "?bt=abc");
});

for (const [slug, mode, hook] of [
  ["mix", "mix", "[data-mix-panel]"],
  ["transcribe", "transcribe", '[data-speech-tool="transcribe"]'],
] as const) {
  test(`deep link: studio-${slug} opens its own mode of «Audio»`, async () => {
    window.history.replaceState(null, "", `/uz/studio?tab=audio&mode=${mode}`);
    api();
    await mount();
    assert.equal(selected(), "audio");
    assert.ok(q(hook), mode);
  });
}

test("a link's mode wins over the draft's; a mode the tab does not have is ignored", async () => {
  writeDraft(draftKey(USER.id, "audio"), { mode: "sfx", raw: {}, filter: "all" });
  window.history.replaceState(null, "", "/uz/studio?tab=audio&mode=mix");
  api();
  await mount();
  assert.ok(q("[data-mix-panel]"));
  assert.equal(modeFromSearch("audio", "?tab=audio&mode=nope"), null);
  assert.equal(modeFromSearch("video", "?mode=mix"), null);
  assert.equal(modeFromSearch("rasm", "?mode=upscale"), "upscale");
  assert.equal(studioSearch("?a=1&mode=x", "rasm", "image"), "?a=1");
  assert.equal(studioSearch("", "video", null), "?tab=video");
  assert.equal(studioSearch("", "audio", "dub"), "?tab=audio&mode=dub");
});

test("back follows the URL: the tab it left comes back", async () => {
  window.history.replaceState(null, "", "/uz/studio");
  api();
  await mount();
  await click(tab("video"));
  await settle();
  assert.equal(selected(), "video");
  window.history.replaceState(null, "", "/uz/studio?tab=ovoz");
  await act(async () => void window.dispatchEvent(new window.PopStateEvent("popstate")));
  await settle();
  assert.equal(selected(), "ovoz");
});

test("the login keeps the link's tab and mode", async () => {
  window.history.replaceState(null, "", "/uz/studio?tab=audio&mode=mix");
  api();
  useAppStore.setState({ loggedIn: false, sessionChecked: true, user: null });
  await mount();
  assert.equal(useUi.getState().overlay, "login");
  assert.equal(useUi.getState().returnTo, "/uz/studio?tab=audio&mode=mix");
});

/* ─────────────── running jobs ─────────────── */

test("refresh: running jobs come back, each to its tab, and keep being followed", async () => {
  const rows = [
    { id: JOB(1), tool: "studio-video", modelId: OMNI.id, modelLabel: OMNI.label, prompt: "klip", price: 21400, purpose: null, sent: { modelId: OMNI.id } },
    { id: JOB(2), tool: "studio-image", modelId: EDIT[0]!.id, modelLabel: EDIT[0]!.label, prompt: "", price: 800, purpose: "studio.edit", sent: { modelId: EDIT[0]!.id } },
    { id: JOB(3), tool: "studio-speech", modelId: SPEECH[0]!.id, modelLabel: SPEECH[0]!.label, prompt: "matn", price: 500, purpose: null, sent: {} },
    { id: JOB(4), tool: "studio-mix", modelId: MIX_MODES[0]!.model, modelLabel: "Montaj", prompt: "m", price: 700, purpose: null, sent: {} },
    { id: JOB(5), tool: "studio-transcribe", modelId: TRANSCRIBE, modelLabel: "Transkripsiya", prompt: "t", price: 900, purpose: null, sent: {} },
    { id: JOB(6), tool: "studio-audio", modelId: AUDIO[0]!.id, modelLabel: "Musiqa", prompt: "kuy", price: 600, purpose: null, sent: {} },
  ];
  const a = api({ activeJobs: rows, generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Ishlanmoqda", doc: null }) });
  await mount();
  assert.ok(q(`[data-studio-job="${JOB(2)}"]`), "the picture job is in «Rasm»");
  assert.ok(!q(`[data-studio-job="${JOB(1)}"]`), "the clip is not");
  assert.equal(q(`[data-studio-job="${JOB(2)}"]`)?.getAttribute("data-job-status"), "IN_PROGRESS");
  // Rule changed on purpose (review of Package C): a refresh must not start one loop per job for tabs nobody is looking at.
  assert.ok(a.polls.get(JOB(2))! > 0, "the open tab's job is followed");
  assert.equal(a.polls.get(JOB(1)) ?? 0, 0, "a closed tab's job is not polled");
  assert.equal(a.polls.get(JOB(3)) ?? 0, 0, "neither is this one");

  await click(tab("video"));
  await settle();
  assert.ok(a.polls.get(JOB(1))! > 0, "opening the tab starts its job");
  assert.ok(q(`[data-video-results] [data-studio-job="${JOB(1)}"]`), "the clip is in «Video»");
  await click(tab("ovoz"));
  await settle();
  assert.ok(q(`[data-voice-results] [data-studio-job="${JOB(3)}"]`), "the speech is in «Ovoz»");
  await click(tab("audio"));
  await settle();
  assert.ok(q(`[data-audio-results] [data-studio-job="${JOB(6)}"]`), "the music is in «Audio»");
  await click(q('[data-audio-mode-chip="mix"]'));
  await settle();
  assert.ok(q(`[data-mix-results] [data-studio-job="${JOB(4)}"]`), "the mix is in «Montaj»");
  await click(q('[data-audio-mode-chip="transcribe"]'));
  await settle();
  assert.ok(q(`[data-speech-results] [data-studio-job="${JOB(5)}"]`), "the transcript is in its panel");
});

test("restored jobs stop being polled when their tab closes, and start again when it opens", async () => {
  const a = api({
    activeJobs: [{ id: JOB(1), tool: "studio-video", modelId: OMNI.id, modelLabel: OMNI.label, prompt: "klip", price: 21400, purpose: null, sent: { modelId: OMNI.id } }],
    generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Ishlanmoqda", doc: null }),
  });
  window.history.replaceState(null, "", "/uz/studio?tab=video");
  await mount();
  const first = a.polls.get(JOB(1))!;
  assert.ok(first > 0);
  await click(tab("rasm"));
  await settle();
  const closed = a.polls.get(JOB(1))!;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1300));
  });
  assert.equal(a.polls.get(JOB(1)), closed, "no polls while the tab is closed");
  await click(tab("video"));
  await settle();
  assert.ok(a.polls.get(JOB(1))! > closed, "polled again on opening");
});

test("track: a live card survives the same id coming in again", async () => {
  api({ generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Ishlanmoqda", doc: null }) });
  const { result } = renderHook(() => useStudioJobs());
  const job = { id: JOB(1), modelId: NANO.id, modelLabel: NANO.label, prompt: "p", price: 100, sent: {} };
  await act(async () => void result.current.track(job));
  await settle();
  assert.equal(result.current.jobs[0]?.gen?.status, "IN_PROGRESS");
  await act(async () => void result.current.track(job));
  assert.equal(result.current.jobs.length, 1);
  assert.equal(result.current.jobs[0]?.gen?.status, "IN_PROGRESS", "the card keeps its state");
});

test("restore: a live card survives restore running again", async () => {
  api({ generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Ishlanmoqda", doc: null }) });
  const { result } = renderHook(() => useStudioJobs());
  const job = { id: JOB(1), modelId: NANO.id, modelLabel: NANO.label, prompt: "p", price: 100, sent: {} };
  await act(async () => void result.current.restore(job));
  await settle();
  assert.equal(result.current.jobs[0]?.gen?.status, "IN_PROGRESS");
  await act(async () => void result.current.restore(job));
  assert.equal(result.current.jobs.length, 1);
  assert.equal(result.current.jobs[0]?.gen?.status, "IN_PROGRESS");
});

test("an account switched in place keeps no form, job or poller of the one before it", async () => {
  // The server's answer follows the session: the second user has no jobs.
  const rows = [{ id: JOB(1), tool: "studio-image", modelId: NANO.id, modelLabel: NANO.label, prompt: "birinchi", price: 1000, purpose: "studio.image", sent: { modelId: NANO.id } }];
  const a = api({
    activeJobs: () => json(200, { items: useAppStore.getState().user?.id === USER.id ? rows : [] }),
    generation: (id) => generationDetail(id, { status: "IN_PROGRESS", progress: 40, step: "Ishlanmoqda", doc: null }),
  });
  await mount();
  await type(promptBox(), "Birinchi foydalanuvchi matni");
  assert.ok(q(`[data-studio-job="${JOB(1)}"]`));
  // No cleanup() here: the same tree stays mounted, only the session changes.
  await act(async () => void useAppStore.setState({ user: { ...USER, id: "u2", balance: 90_000 } as never }));
  await settle();
  assert.equal(promptBox()?.value, "", "the form is the new user's");
  assert.ok(!q(`[data-studio-job="${JOB(1)}"]`), "the job card is gone");
  const polls = a.polls.get(JOB(1))!;
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1300));
  });
  assert.equal(a.polls.get(JOB(1)), polls, "the old user's poller stopped");
});

test("a soft navigation to /uz/studio from the Video tab lands on Rasm", async () => {
  installNav();
  window.history.replaceState(null, "", "/uz/studio?tab=video");
  api();
  await mount();
  assert.equal(selected(), "video");
  // What Next does for a `<Link href="/uz/studio">` on this very page: a pushState, no popstate, no remount.
  await act(async () => void window.history.pushState(null, "", "/uz/studio"));
  await settle();
  assert.equal(selected(), "rasm");
  assert.equal(window.location.search, "");
});

test("logout: this user's drafts leave the browser, a pending write included; another user's stay", async () => {
  api();
  writeDraft(draftKey("other", "rasm"), { mode: "image", forms: {} });
  await mount();
  await type(promptBox(), "Saqlangan matn");
  cleanup();
  dropMediaCatalog();
  assert.ok(readDraft(draftKey(USER.id, "rasm")), "the draft is stored");
  await mount();
  await type(promptBox(), "Hali yozilmagan matn");
  await act(async () => {
    await useAppStore.getState().signOut().catch(() => {});
  });
  await settle();
  cleanup();
  assert.equal(readDraft(draftKey(USER.id, "rasm")), null);
  assert.ok(readDraft(draftKey("other", "rasm")), "only this user's");
});

test("cross-purpose retry: the label and the charge are one number, from the job's own catalog", async () => {
  const entry = EDIT[0]!;
  const moved = { ...PRICING, markup: 5 };
  const job = { id: JOB(1), tool: "studio-image", modelId: entry.id, modelLabel: entry.label, prompt: "fon", price: 100, purpose: "studio.edit", sent: { modelId: entry.id, prompt: "fon", inputImages: "abcdef012345" } };
  const a = api({ activeJobs: [job], generation: (id) => generationDetail(id, { status: "FAILED", error: "Yiqildi", doc: null }), create: (b) => json(202, { id: JOB(2), price: b.expectedPrice, status: "QUEUED" }) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) =>
    String(input) === "/api/media/catalog?purpose=studio.edit" ? json(200, { purpose: "studio.edit", defaultModelId: entry.id, models: EDIT, pricing: moved }) : inner(input as never, init);
  await mount();
  await settle(20);
  const now = studioPrice(entry, job.sent, moved);
  assert.notEqual(now, job.price, "the markup moved since the job was bought");
  const retry = q('[data-studio-failed] [data-result-action="again"]');
  assert.ok(retry);
  assert.ok(retry.textContent?.includes(formatSom(now)), `${retry.textContent} ~ ${formatSom(now)}`);
  await click(retry);
  await settle();
  assert.equal(a.posts()[0]?.body?.expectedPrice, now, "the charge is the label");
});

test("cross-purpose retry: a price not known yet goes out as shown, and the guard refuses a change", async () => {
  const entry = EDIT[0]!;
  const moved = { ...PRICING, markup: 5 };
  const job = { id: JOB(1), tool: "studio-image", modelId: entry.id, modelLabel: entry.label, prompt: "fon", price: 100, purpose: "studio.edit", sent: { modelId: entry.id, prompt: "fon", inputImages: "abcdef012345" } };
  const a = api({
    activeJobs: [job],
    generation: (id) => generationDetail(id, { status: "FAILED", error: "Yiqildi", doc: null }),
    create: () => json(409, { error: "Narx o‘zgardi", code: "price_changed", price: 999 }),
  });
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    if (String(input) !== "/api/media/catalog?purpose=studio.edit") return inner(input as never, init);
    await gate;
    return json(200, { purpose: "studio.edit", defaultModelId: entry.id, models: EDIT, pricing: moved });
  };
  await mount();
  await settle(20);
  const retry = q('[data-studio-failed] [data-result-action="again"]');
  assert.ok(retry?.textContent?.includes(formatSom(job.price)), "until the catalog is read: what the job cost");
  await click(retry);
  release();
  await settle(20);
  assert.equal(a.posts()[0]?.body?.expectedPrice, job.price, "the price on the button, not the catalog's newer one");
  assert.ok(q("[data-studio-error]"), "the refusal is said");
  assert.equal(q("[data-studio-job]")?.getAttribute("data-studio-job"), JOB(1), "no new job, nothing charged");
});

test("the jobs' list failing is said, and its retry brings them back", async () => {
  let down = true;
  api({ activeJobs: () => (down ? json(500, { error: "Server band" }) : json(200, { items: [{ id: JOB(1), tool: "studio-image", modelId: NANO.id, modelLabel: NANO.label, prompt: "rasm", price: 1000, purpose: "studio.image", sent: {} }] })) });
  await mount();
  assert.ok(q("[data-studio-restore-error]"));
  down = false;
  await click(q("[data-studio-restore-retry]"));
  await settle();
  assert.ok(!q("[data-studio-restore-error]"));
  assert.ok(q(`[data-studio-job="${JOB(1)}"]`));
});

test("a job row without an id or a model is not followed", () => {
  assert.deepEqual(parseActiveJobs({ items: [{ id: "a", tool: "studio-video" }, null, { tool: "x", modelId: "m" }] }), []);
  assert.deepEqual(parseActiveJobs(null), []);
  assert.equal(parseActiveJobs({ items: [{ id: "a", tool: "studio-video", modelId: "m", price: 5 }] })[0]?.price, 5);
});

/* ─────────────── modes ─────────────── */

test("leaving a mode loses neither the prompt nor the settings", async () => {
  const assetUrl = `/api/generations/${JOB(1)}/assets/abcdef0123`;
  api({ create: (b) => json(202, { id: JOB(1), price: b.expectedPrice, status: "QUEUED" }), generation: (id) => {
    const g = generationDetail(id) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    g.doc.images = [{ id: "i1", url: assetUrl, w: 1024, h: 1024, mime: "image/png", alt: "n" }];
    return g;
  } });
  await mount();
  await click(q(`[data-model-card="${GPT.id}"]`));
  await type(promptBox(), "Registon maydoni kechqurun");
  await click(q("[data-studio-submit]"));
  await settle(20);
  await click(q('[data-studio-job] [data-result-action="edit"]'));
  await settle();
  assert.equal(q("[data-studio-mode]")?.getAttribute("data-studio-mode"), "edit");
  await click(q("[data-studio-mode-exit]"));
  await settle();
  assert.equal(promptBox()?.value, "Registon maydoni kechqurun", "the prompt is back");
  assert.equal(q(`[data-model-card="${GPT.id}"]`)?.getAttribute("aria-pressed") ?? "true", "true", "and the model");
});

test("enterRasmMode: each mode has its own form", () => {
  let s = patchRasmForm(INITIAL_RASM, (f) => ({ ...f, chosen: "gpt", raw: { prompt: "chizish", imageCount: 2 } }));
  s = enterRasmMode(s, "edit", "a1");
  assert.deepEqual(rasmForm(s), { chosen: null, raw: { inputImages: ["a1"] } }, "a result's edit starts with no instruction (review NIT-9)");
  s = patchRasmForm(s, (f) => ({ ...f, raw: { ...f.raw, prompt: "fonni o‘zgartir" } }));
  s = enterRasmMode(s, "image");
  assert.deepEqual(rasmForm(s), { chosen: "gpt", raw: { prompt: "chizish", imageCount: 2 } }, "drawing is as it was");
  s = enterRasmMode(s, "edit", "a2");
  assert.deepEqual(rasmForm(s).raw, { prompt: "fonni o‘zgartir", inputImages: ["a2"] }, "the edit keeps its own text, on the new picture");
  assert.deepEqual(rasmForm(enterRasmMode(INITIAL_RASM, "upscale")).raw, { inputImages: [] });

  const typed = patchRasmForm(INITIAL_RASM, (f) => ({ ...f, raw: { prompt: "yozilgan" } }));
  assert.equal(rasmForm(enterRasmMode(typed, "edit", "a1", true)).raw.prompt, "yozilgan", "«Rasm yuklash»: the typed text is the instruction");
  const editing = enterRasmMode(enterRasmMode(INITIAL_RASM, "edit", "a1"), "edit", undefined);
  assert.deepEqual(rasmForm(editing).raw.inputImages, ["a1"], "no new picture: the one chosen stays");
  const text = patchRasmForm(enterRasmMode(INITIAL_RASM, "edit", "a1"), (f) => ({ ...f, raw: { ...f.raw, prompt: "matn" } }));
  assert.equal(rasmForm(enterRasmMode(text, "image")).raw.prompt, "matn", "drawing with nothing of its own takes the text on screen");
});

/* ─────────────── failures that used to be silent ─────────────── */

test("gallery tools: a failed tool says so in the gallery; leaving the gallery drops it", async () => {
  const id = JOB(1);
  const gallery = { "": { items: [{ id, createdAt: "2026-11-02T10:00:00.000Z", modelId: NANO.id, modelLabel: "Nano", prompt: "rasm", images: [{ url: `/api/generations/${id}/assets/abc123`, w: 1, h: 1 }], fileUrl: `/api/generations/${id}/file` }], nextCursor: null } };
  api({ gallery, fromResult: () => json(404, { error: "Rasm topilmadi" }) });
  await mount();
  await click(q("[data-studio-gallery-link]"));
  await settle();
  await click(q(`[data-gallery-item="${id}"] [data-result-action="upscale"]`));
  await settle();
  assert.ok(q("[data-studio-gallery] [data-studio-error]"), "the error is where the user pressed");
  assert.match(q("[data-studio-gallery] [data-studio-error]")?.textContent ?? "", /Rasm topilmadi/);
  await click(q("[data-studio-create-link]"));
  await settle();
  assert.ok(!q("[data-studio-error]"));
});

test("voices: loading, then the failure with a retry — never an empty list", async () => {
  for (const open of ["ovoz", "audio"] as const) {
    let down = true;
    api({ voices: () => (down ? json(503, { error: "Ovozlar kelmadi" }) : json(200, VOICES)) });
    await mount();
    await click(tab(open));
    await settle();
    if (open === "audio") {
      await click(q('[data-audio-mode-chip="voice-changer"]'));
      await settle();
    }
    assert.ok(q("[data-voices-error]"), open);
    assert.ok(!q("[data-voice-empty]"), `${open}: «no voices» is not what happened`);
    down = false;
    await click(q("[data-voices-retry]"));
    await settle();
    assert.ok(!q("[data-voices-error]"), open);
    assert.ok(q("[data-voice-list] [data-voice-row]"), `${open}: the list is back`);
    cleanup();
    dropMediaCatalog();
    window.history.replaceState(null, "", "/");
  }
});

test("a voice preview that fails says so; pressing again clears it", async () => {
  api();
  await mount();
  await click(tab("ovoz"));
  await settle();
  const play = qa("[data-voice-play]")[0]!;
  await click(play);
  const audio = q("[data-voice-preview]");
  assert.ok(audio, "the player is mounted");
  await act(async () => void fireEvent.error(audio));
  assert.ok(q("[data-voice-preview-error]"));
  assert.ok(!q("[data-voice-preview]"), "the player is gone");
  await click(play);
  assert.ok(!q("[data-voice-preview-error]"));
});

test("a lost speech tool job says so and offers the retry", async () => {
  const entry = by(TRANSCRIBE);
  api({
    activeJobs: [{ id: JOB(1), tool: "studio-transcribe", modelId: entry.id, modelLabel: entry.label, prompt: "t", price: 900, purpose: null, sent: { modelId: entry.id, source: "result:x", sourceSeconds: 10 } }],
    generation: () => {
      throw Object.assign(new Error("gone"), {});
    },
  });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => (String(input) === `/api/generations/${JOB(1)}` ? json(404, { error: "Ish topilmadi" }) : inner(input as never, init));
  window.history.replaceState(null, "", "/uz/studio?tab=audio&mode=transcribe");
  await mount();
  await settle(20);
  const failed = q(`[data-speech-results] [data-studio-job="${JOB(1)}"] [data-studio-failed]`);
  assert.ok(failed, "the failure card");
  assert.match(failed.textContent ?? "", /Ish topilmadi.*«Ishlarim»/);
  assert.ok(failed.querySelector('[data-result-action="again"]'), "the retry");
});

test("Montaj sources: the failure offers a retry", async () => {
  let down = true;
  api({ sources: () => (down ? json(503, { error: "Natijalar kelmadi" }) : json(200, SOURCES)) });
  window.history.replaceState(null, "", "/uz/studio?tab=audio&mode=mix");
  await mount();
  assert.ok(q("[data-mix-sources-error]"));
  down = false;
  await click(q("[data-mix-retry]"));
  await settle();
  assert.ok(!q("[data-mix-sources-error]"));
  assert.ok(q('[data-mix-picker="video"]'), "the pickers are back");
});

test("the tablet's empty results column says what goes there", async () => {
  api();
  await mount();
  const empty = q("[data-studio-empty]");
  assert.ok(empty);
  assert.ok(empty.className.includes("md:block"), empty.className);
  assert.ok(!empty.className.includes("xl:block"));
});

/* ─────────────── wording ─────────────── */

test("a retry says its price: the catalog's price now, not an old one", async () => {
  api({ create: (b) => json(202, { id: JOB(1), price: b.expectedPrice, status: "QUEUED" }), generation: (id) => generationDetail(id, { status: "FAILED", error: "Yiqildi", doc: null }) });
  await mount();
  await type(promptBox(), "Registon maydoni kechqurun");
  const shown = /([\d\s ]+so.m)/.exec(q("[data-price-total]")?.textContent ?? "")?.[1];
  await click(q("[data-studio-submit]"));
  await settle(20);
  const retry = q('[data-studio-failed] [data-result-action="again"]');
  assert.ok(retry);
  assert.ok(shown, "the button has a price");
  assert.ok(retry.textContent?.includes(shown), `${retry.textContent} ~ ${shown}`);
});

test("retryLabel: a job with no price offers a plain retry", () => {
  // P11 §D: one name for a repeat on every card («Qayta yaratish»), the retry of a failed job included.
  assert.equal(retryLabel(2600), `Qayta yaratish · ${formatSom(2600)}`);
  assert.equal(retryLabel(0), "Qayta yaratish");
});

test("music: a failure without a server text does not say «Ovoz»", async () => {
  const music = AUDIO[0]!;
  api({ activeJobs: [{ id: JOB(1), tool: "studio-audio", modelId: music.id, modelLabel: "Musiqa", prompt: "kuy", price: 600, purpose: null, sent: { modelId: music.id } }], generation: (id) => generationDetail(id, { status: "FAILED", error: null, doc: null }) });
  window.history.replaceState(null, "", "/uz/studio?tab=audio&mode=music");
  await mount();
  await settle(20);
  const failed = q("[data-audio-results] [data-studio-failed]");
  assert.ok(failed);
  assert.match(failed.textContent ?? "", new RegExp(`Audio yaratilmadi\\. ${REFUND_PHRASE}\\.`));
  assert.ok(!/Ovoz yaratilmadi/.test(failed.textContent ?? ""));
});

test("the sheet's noun follows the catalog", () => {
  assert.equal(modelNoun([{ kind: "speech" }]), "Ovoz");
  assert.equal(modelNoun([{ kind: "video" }]), "Video");
  assert.equal(modelNoun([{ kind: "image" }]), "Rasm");
  assert.equal(modelNoun([{ kind: "music" }]), "Audio");
  assert.equal(modelNoun([]), "Rasm");
});

test("the Ovoz picker's sheet says «Ovoz modeli»", async () => {
  api();
  // P11 §D: the sheet opens only when the row cannot hold every model — four speech models here.
  const inner = globalThis.fetch;
  const four = [...SPEECH, by("elevenlabs/eleven-v3-fal"), by("elevenlabs/eleven-v4-turbo-fal")];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) =>
    String(input) === "/api/media/catalog?purpose=studio.speech" ? json(200, { purpose: "studio.speech", defaultModelId: four[0]!.id, models: four, pricing: PRICING }) : inner(input as never, init);
  await mount();
  await click(tab("ovoz"));
  await settle();
  await click(qa("button").find((b) => /Barcha modellar/.test(b.textContent ?? "")));
  await settle();
  assert.match(q("[data-model-sheet]")?.textContent ?? "", /Ovoz modeli/);
  assert.ok(!/Rasm modeli/.test(q("[data-model-sheet]")?.textContent ?? ""));
});

test("the start image hint tells the truth per model", () => {
  assert.match(startImageHint(OMNI), /«O‘lcham» qatoridan/, "Omni sends the aspect itself");
  assert.ok(!/nisbat suratdan/.test(startImageHint(OMNI)));
  const framed = view.find((e) => ASPECT_FOLLOWS_IMAGE.has(e.id));
  assert.ok(framed, "a catalog model follows the frame");
  assert.match(startImageHint(framed), /nisbat suratdan olinadi/);
  assert.equal(startImageHint({ id: "x", params: [] }), "Surat berilsa video shu suratdan boshlanadi.");
});
