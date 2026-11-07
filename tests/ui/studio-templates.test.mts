import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, generationDetail, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { dropLibraryCache } = await import("../../components/studio/LibrarySheet.tsx");
const { dropTemplatesCache } = await import("../../components/studio/TemplatesRow.tsx");
const { draftKey, readDraft } = await import("../../lib/studio-draft-store.ts");
const { applyVideoTemplate, videoTemplateTarget } = await import("../../components/studio/studio-modes.ts");
const { SentPrompt } = await import("../../components/studio/JobResult.tsx");

/**
 * Studio package G (docs/studio/P11-SPEC.md «G»): the Video tab's «Shablonlar» and «Namuna promptlar», the music and effect
 * samples, and the «AI yaxshilash» switch of every prompt box, with the API stubbed at `fetch` and the REAL catalog entries.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `TemplatesRow` keeps filtering by `modelIds` on the Video tab             -> «video templates: fallback»;
 *   2. `videoTemplateTarget` returns the suggested id without the catalog check  -> «target»;
 *   3. `videoTemplateTarget` keeps avatars                                       -> «target»;
 *   4. `setPrompt` does not leave the template                                   -> «video templates: suggested»;
 *   5. `LibrarySheet` ignores `media` (the cache shared by kinds)                -> «samples»;
 *   6. the switch's value not sent from the Video tab                            -> «switch: video»;
 *   7. the choice not stored                                                      -> «switch: remembered»;
 *   8. the button's own answer rewritten again (`shown` ignored)                  -> «switch: the button's answer»;
 *   9. the switch shown on the edit box                                           -> «switch: where it shows»;
 *  10. `parseTemplates` drops `fallback`                                          -> «video templates: suggested»;
 *  11. `SentPrompt` left out of a results list                                    -> «card».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const OMNI = view.find((e) => e.id === "google/omni-video")!;
const FLASH = view.find((e) => e.id === "kling/kling-4-flash")!;
const AVATAR = view.find((e) => e.id === "heygen/avatar")!;
const FX = view.find((e) => e.id === "kling/effects")!;
const MUSIC = view.find((e) => e.id === "elevenlabs/music")!;
const SFX = view.find((e) => e.id === "elevenlabs/sfx")!;
const NB_EDIT = view.find((e) => e.id === "google/nano-banana-edit")!;
const RATE = { ...PRICING, soumPerUsd: 12_700 };

const TEMPLATE = {
  id: "9",
  media: "video",
  category: "reklama",
  title: "Mahsulot reklamasi",
  modelId: FLASH.id,
  params: { seconds: 5, aspect: "9:16" },
  skeleton: "One continuous shot: {mahsulot} on a table, the camera orbits it",
  slots: [{ name: "mahsulot", label: "Mahsulot", placeholder: "shisha atir flakoni", fallback: "a glass perfume bottle", max: 80 }],
  previewUrl: null,
};
const SAMPLE = (media: string, title: string, prompt: string) => ({ categories: [{ id: "reklama", label: "Reklama", count: 1 }], items: [{ id: `${media}1`, media, category: "reklama", title, prompt, previewUrl: null }] });

function api(models = [OMNI, FLASH, FX]) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) return json(200, { purpose: "studio.video", defaultModelId: OMNI.id, models, pricing: RATE });
    if (url.startsWith("/api/media/catalog?purpose=studio.edit")) return json(200, { purpose: "studio.edit", defaultModelId: NB_EDIT.id, models: [NB_EDIT], pricing: RATE });
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) return json(200, { purpose: "studio.audio", defaultModelId: null, models: [MUSIC, SFX], pricing: RATE });
    if (url === "/api/media/templates?media=video") return json(200, { items: [TEMPLATE] });
    if (url === "/api/media/library?media=video") return json(200, SAMPLE("video", "Mahsulot aylanmasi", "One continuous shot: a bottle turns slowly"));
    if (url === "/api/media/library?media=music") return json(200, SAMPLE("music", "Sokin fortepiano", "Calm instrumental piano background"));
    if (url === "/api/media/library?media=sfx") return json(200, SAMPLE("sfx", "Eski eshik", "An old wooden door creaks open"));
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
  dropLibraryCache();
  dropTemplatesCache();
  window.localStorage.clear();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: { ...USER, points: 900_000, balance: 900_000 } as never });
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
async function mount(search = "?tab=video") {
  window.history.replaceState(null, "", `/uz/studio${search}`);
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle(12);
}
const textMode = async () => {
  await click(qa('[data-video-mode] [role="radio"]').find((b) => b.textContent === "Matndan / rasmdan"));
  await settle();
};
const chosen = () => q('[data-model-card][aria-pressed="true"]')?.getAttribute("data-model-card");
const videoPrompt = () => q<HTMLTextAreaElement>("[data-video-prompt] textarea")!;
const aiSwitch = () => q('[data-prompt-tool="ai-improve"] [role="switch"]');

test("target: the suggested model when offered, else the one on screen, never an avatar", () => {
  assert.equal(videoTemplateTarget([OMNI, FLASH], FLASH.id, OMNI.id)?.id, FLASH.id);
  assert.equal(videoTemplateTarget([OMNI], FLASH.id, OMNI.id)?.id, OMNI.id, "MUTATSIYA: an unavailable model must not be picked");
  assert.equal(videoTemplateTarget([AVATAR, OMNI], FLASH.id, AVATAR.id)?.id, OMNI.id, "an avatar's prompt is a script");
  assert.equal(videoTemplateTarget([AVATAR], FLASH.id, AVATAR.id), null);
});

test("apply: what the fallback model cannot take is dropped, the prompt is filled", () => {
  const raw = applyVideoTemplate(OMNI, TEMPLATE as never, {}, { seconds: 7, aspect: "bad", [`extra`]: 1 });
  assert.equal(raw.prompt, "One continuous shot: a glass perfume bottle on a table, the camera orbits it", "an empty slot takes the English fallback, not the Uzbek example");
  assert.ok(!("extra" in raw), "only what the model knows");
  assert.equal(raw.aspect, "9:16");
  const onFlash = applyVideoTemplate(FLASH, TEMPLATE as never, { mahsulot: "qo‘l soati" }, {});
  assert.equal(onFlash.seconds, 5);
  assert.match(String(onFlash.prompt), /qo‘l soati/);
});

test("video templates: suggested — the card picks its model and fills the prompt; slots rebuild it; typing leaves the template", async () => {
  api();
  await mount();
  await textMode();
  assert.equal(chosen(), OMNI.id);
  await click(q('[data-template-card="9"]'));
  await settle();
  assert.equal(chosen(), FLASH.id, "the suggested model is on offer");
  assert.equal(q('[data-template-card="9"]')!.getAttribute("aria-pressed"), "true");
  assert.match(videoPrompt().value, /a glass perfume bottle/);
  assert.ok(!q("[data-switch-notice]"), "no fallback, nothing to say");
  const slot = q<HTMLInputElement>('[data-field="slot.mahsulot"] input')!;
  assert.equal(slot.placeholder, "shisha atir flakoni", "the user sees the Uzbek example");
  await act(async () => void fireEvent.change(slot, { target: { value: "qo‘l soati" } }));
  assert.match(videoPrompt().value, /qo‘l soati on a table/);
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "o‘zim yozdim" } }));
  assert.ok(!q("[data-template-slots]"), "MUTATSIYA: typing leaves the template");
  assert.equal(videoPrompt().value, "o‘zim yozdim");
});

test("video templates: fallback — the suggested model is off, the card applies to the model on screen and says so", async () => {
  api([OMNI, FX]);
  await mount();
  await textMode();
  const card = q('[data-template-card="9"]');
  assert.ok(card, "MUTATSIYA: a clip template shows whichever models are on");
  await click(card);
  await settle();
  assert.equal(chosen(), OMNI.id);
  assert.match(videoPrompt().value, /One continuous shot/);
  assert.match(document.body.textContent!, /Google|Omni/);
  assert.match(document.body.textContent!, /tavsiya etilgan model hozir mavjud emas/);
});

test("video templates: an avatar's box has neither templates nor samples nor the switch", async () => {
  api([OMNI, AVATAR, FX]);
  await mount();
  await textMode();
  assert.ok(q("[data-studio-templates]"));
  assert.ok(aiSwitch());
  await click(q(`[data-model-card="${AVATAR.id}"]`));
  await settle();
  assert.ok(!q("[data-studio-templates]"));
  assert.ok(!q('[data-prompt-tool="samples"]'));
  assert.ok(!aiSwitch());
});

test("samples: each box opens its own kind; a tap fills that box", async () => {
  api();
  await mount();
  await textMode();
  await click(q('[data-prompt-tool="samples"]'));
  await settle();
  assert.match(q("[data-library-sheet]")!.textContent!, /Mahsulot aylanmasi/);
  await click(q("[data-library-item]"));
  await settle();
  assert.equal(videoPrompt().value, "One continuous shot: a bottle turns slowly");
  await click(q('[data-studio-tab="audio"]'));
  await settle(12);
  await click(q('[data-prompt-tool="samples"]'));
  await settle();
  assert.match(q("[data-library-sheet]")!.textContent!, /Sokin fortepiano/, "MUTATSIYA: the kinds share one cache");
  await click(q("[data-library-item]"));
  await settle();
  assert.equal(q<HTMLTextAreaElement>("[data-audio-prompt] textarea")!.value, "Calm instrumental piano background");
  await click(q('[data-audio-mode-chip="sfx"]'));
  await settle();
  await click(q('[data-prompt-tool="samples"]'));
  await settle();
  assert.match(q("[data-library-sheet]")!.textContent!, /Eski eshik/);
});

test("switch: video — on by default, the job says so; off, it says that", async () => {
  const a = api();
  await mount();
  await textMode();
  assert.equal(aiSwitch()!.getAttribute("aria-checked"), "true", "on by default");
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "Registon tongda, kamera sekin" } }));
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal((a.posts()[0]!.body!.values as Record<string, unknown>).aiImprove, true, "MUTATSIYA: the switch must reach the job");
  await click(aiSwitch());
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "Registon tongda, kamera tez" } }));
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal((a.posts()[1]!.body!.values as Record<string, unknown>).aiImprove, false);
});

test("switch: remembered — per user, across the tabs, past a submit that clears the form's draft", async () => {
  const a = api();
  await mount();
  await textMode();
  await click(aiSwitch());
  assert.equal(readDraft(draftKey(String(USER.id), "ai-improve")), false);
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "Registon tongda, kamera sekin" } }));
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal(a.posts().length, 1);
  await click(q('[data-studio-tab="rasm"]'));
  await settle();
  assert.equal(aiSwitch()!.getAttribute("aria-checked"), "false", "one choice for every box");
  cleanup();
  await mount();
  await textMode();
  assert.equal(aiSwitch()!.getAttribute("aria-checked"), "false", "MUTATSIYA: a submit or a refresh must not turn it back on");
  // Another user on the same browser starts from the default.
  cleanup();
  useAppStore.setState({ user: { ...USER, id: "777", points: 900_000, balance: 900_000 } as never });
  await mount();
  await textMode();
  assert.equal(aiSwitch()!.getAttribute("aria-checked"), "true");
});

test("switch: the button's answer — the text the user read goes as it is; an edit makes it theirs again", async () => {
  const a = api();
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => (String(input) === "/api/media/enhance" ? json(200, { prompt: "An improved English prompt" }) : inner(input as never, init));
  await mount();
  await textMode();
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "Registon tongda, kamera sekin" } }));
  await click(q('[data-prompt-tool="enhance"]'));
  await settle(12);
  assert.equal(videoPrompt().value, "An improved English prompt");
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal((a.posts()[0]!.body!.values as Record<string, unknown>).aiImprove, false, "MUTATSIYA: the reviewed text must not be rewritten behind the user's back");
  await act(async () => void fireEvent.change(videoPrompt(), { target: { value: "An improved English prompt, at night" } }));
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal((a.posts()[1]!.body!.values as Record<string, unknown>).aiImprove, true);
});

test("switch: where it shows — drawing, music and effect; not the edit box, whose job is to change only what was asked", async () => {
  const a = api();
  await mount("?tab=rasm");
  assert.ok(aiSwitch(), "drawing");
  await act(async () => void fireEvent.change(q<HTMLTextAreaElement>("[data-studio-prompt] textarea")!, { target: { value: "Samarqand kechasi" } }));
  await click(q("[data-studio-submit]"));
  await settle(12);
  assert.equal((a.posts()[0]!.body!.values as Record<string, unknown>).aiImprove, true);
  cleanup();
  await mount("?tab=rasm&mode=edit");
  await settle(12);
  assert.ok(q("[data-studio-prompt]"), "the edit box");
  assert.ok(!aiSwitch(), "MUTATSIYA: no switch on an edit instruction");
  cleanup();
  await mount("?tab=audio");
  await settle(12);
  assert.ok(aiSwitch(), "music");
  await click(q('[data-audio-mode-chip="sfx"]'));
  await settle();
  assert.ok(aiSwitch(), "effect");
});

test("card: every results list shows the English under the user's own words, only when there is one", async () => {
  render(h(SentPrompt, { text: undefined }));
  assert.ok(!q("[data-sent-prompt]"));
  cleanup();
  const { VideoResults } = await import("../../components/studio/video/VideoResults.tsx");
  const { VoiceResults } = await import("../../components/studio/voice/VoiceResults.tsx");
  const { StudioResults } = await import("../../components/studio/StudioResults.tsx");
  const id = "11111111-1111-4111-8111-111111111111";
  const job = (doc: Record<string, unknown>) => ({ id, modelId: FLASH.id, modelLabel: FLASH.label, prompt: "Registon tongda", price: 21_400, sent: {}, error: null, gen: generationDetail(id, { format: "mp4", fileName: "x.mp4", doc: { meta: { topic: "x", language: "uz" }, sentPrompt: "A wide shot", ...doc } }) as never });
  const lists = [
    h(VideoResults, { jobs: [job({ video: { provider: "kling", prompt: "Registon tongda", aspect: "16:9", requestedSeconds: 5, seconds: 5 } })], busy: false, onAgain: () => {} }),
    h(VoiceResults, { jobs: [job({ studioAudio: { mode: "music", model: "elevenlabs/music", seconds: 5, prompt: "Registon tongda", inputSeconds: null, voices: [], clone: false, variants: [] } })], busy: false, onAgain: () => {}, failed: "x" }),
    h(StudioResults, { jobs: [job({ images: [{ id: "img1", url: "/x.png", alt: "", w: 10, h: 10 }] })], busy: false, onAgain: () => {}, onOtherModel: () => {}, onTool: () => {}, onVideo: () => {}, onVoice: () => {} }),
  ];
  for (const list of lists) {
    render(h(AppRouterContext.Provider, { value: router }, list));
    await settle();
    assert.equal(q("[data-studio-job-prompt]")!.textContent!.trim(), "Registon tongda", "the card keeps the user's text");
    assert.match(q("[data-sent-prompt]")?.textContent ?? "", /Yuborilgan prompt[\s\S]*A wide shot/, "MUTATSIYA: the list must show what was sent");
    cleanup();
  }
});
