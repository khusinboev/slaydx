import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { ELEVENLABS_VOICES, GEMINI_VOICES } from "../../lib/media/catalog-speech.ts";
import { GPT, NANO, PRICING, USER, catalogBody, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { studioSpeechPrice } = await import("../../lib/media/studio-speech.ts");
const { voiceRows, daysLeft } = await import("../../components/studio/voice/VoiceList.tsx");
const { cloneBlocker } = await import("../../components/studio/voice/ClonePanel.tsx");

/**
 * Studio «Ovoz» tab (docs/studio/P5-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries.
 *
 * Locked here:
 *   - the third tab «Ovoz»; its catalog (`purpose=studio.speech`) is asked only once the tab opens; `?tab=ovoz` opens it;
 *     no «Fon musiqa» (P6) control is drawn;
 *   - voice list: filter chips Hammasi / Erkak / Ayol / Mening ovozlarim (the last only for a model that takes clones),
 *     each chip filters the rows; a row's ▶ mounts ONE preview player for that voice (nothing before the click);
 *   - the price on the button = the server formula («Ovozlash · ElevenLabs v3 · ~2 100 so'm» for 1 000 characters), the
 *     character line with «~N s»; the submit sends slug `studio-speech`, `{modelId, …schema}` and that `expectedPrice`;
 *   - «every param must work»: each schema param of the chosen model has exactly one `data-field`;
 *   - clone: the consent checkbox is REQUIRED (button disabled, the reason shown); with it, the sample upload carries
 *     `consent=1`, then `studio-voice` is bought at the clone price; a user with a clone sees no clone button.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. «Mening ovozlarim» chip shown for Gemini                              -> «voice list»;
 *   2. gender filter ignored (`filter === "all"` path for every chip)          -> «voice list»;
 *   3. preview player mounted for every row                                   -> «voice list» (one player);
 *   4. button priced without the session's formula (`price = null`)           -> «price button»;
 *   5. consent check dropped from `cloneBlocker`                              -> «clone»;
 *   6. sample upload sends `consent=0`                                        -> «clone»;
 *   7. `takesClones` ignored in the tab (clone button for Gemini)             -> «voice list».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const ids = ["elevenlabs/eleven-v3", "google/gemini-tts", "elevenlabs/v3-dialogue", "google/gemini-dialogue"];
const SPEECH = ids.map((id) => view.find((e) => e.id === id)!);
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const CLONE_ID = "0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a";

type Opts = { mine?: unknown[]; available?: boolean };
function api(o: Opts = {}) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  const extra: { url: string; method: string; form?: FormData }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/media/catalog?purpose=studio.speech")) {
      base.calls.push({ url, method, body: null, key: null });
      return json(200, { purpose: "studio.speech", defaultModelId: ids[0], models: SPEECH, pricing: RATE });
    }
    if (url === "/api/media/voices") {
      extra.push({ url, method });
      return json(200, {
        library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
        mine: o.mine ?? [],
        clone: { available: o.available ?? true, price: 5000, consentText: "Bu ovozdan foydalanishga haqqim bor.", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
      });
    }
    if (url === "/api/media/voices/samples") {
      extra.push({ url, method, form: init?.body as FormData });
      return json(200, { sampleId: "abcdefabcdefabcdefabcdef", seconds: 35 });
    }
    if (url.startsWith("/api/media/voices/")) {
      extra.push({ url, method });
      return json(200, { deleted: true, providerDeleted: true });
    }
    return inner(input as never, init);
  };
  return { ...base, extra };
}

beforeEach(() => {
  dropMediaCatalog();
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
/** Text with the digit-group spaces (NBSP from `groupDigits`) as plain spaces. */
const txt = (sel: string) => (q(sel)?.textContent ?? "").replace(/\s/g, " ");
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
async function openVoice() {
  await click(q('[data-studio-tab="ovoz"]'));
  await settle();
}
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel);
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}

test("tab: «Ovoz» is the third tab, its catalog waits for it, ?tab=ovoz opens it, no «Fon musiqa»", async () => {
  const a = api();
  await mount();
  assert.deepEqual(qa("[data-studio-tab]").map((b) => b.textContent), ["Rasm", "Video", "Ovoz"]);
  assert.equal(a.calls.filter((c) => c.url.includes("studio.speech")).length, 0);
  await openVoice();
  assert.ok(q("[data-voice-tab]"));
  assert.equal(a.calls.filter((c) => c.url.includes("studio.speech")).length, 1);
  assert.ok(!(document.body.textContent ?? "").includes("Fon musiqa"), "P6 is not drawn");
  cleanup();
  window.history.replaceState(null, "", "/uz/studio?tab=ovoz");
  await mount();
  assert.equal(q('[data-studio-tab="ovoz"]')!.getAttribute("aria-selected"), "true");
});

test("voice list: chips filter rows; «Mening ovozlarim» only where clones speak; one preview player per click", async () => {
  api({ mine: [{ id: CLONE_ID, name: "Mening ovozim", status: "ready", createdAt: "", lastUsedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString() }] });
  await mount();
  await openVoice();
  assert.deepEqual(qa("[data-voice-filter]").map((b) => b.textContent), ["Hammasi", "Erkak", "Ayol", "Mening ovozlarim"]);
  assert.equal(qa("[data-voice-row]").length, ELEVENLABS_VOICES.length + 1, "library + my clone");
  await click(q('[data-voice-filter="male"]'));
  assert.equal(qa("[data-voice-row]").length, ELEVENLABS_VOICES.filter((v) => v.gender === "male").length);
  await click(q('[data-voice-filter="mine"]'));
  assert.deepEqual(qa("[data-voice-row]").map((r) => r.getAttribute("data-voice-row")), [`clone:${CLONE_ID}`]);
  assert.match(q(`[data-voice-row="clone:${CLONE_ID}"]`)!.textContent ?? "", /20 kundan keyin/, "the 30-day notice in the app");
  assert.ok(q("[data-clone-has]"), "one clone per user: no clone button");
  assert.ok(!q("[data-clone-open]"));
  await click(q('[data-voice-filter="all"]'));
  assert.ok(!q("[data-voice-preview]"), "no preview before a click");
  await click(q(`[data-voice-play="elevenlabs:${ELEVENLABS_VOICES[1]!.id}"]`));
  const players = qa("[data-voice-preview]");
  assert.equal(players.length, 1);
  assert.equal(players[0]!.getAttribute("src"), `/api/media/voices/preview/${encodeURIComponent(`elevenlabs:${ELEVENLABS_VOICES[1]!.id}`)}`);
  // Gemini takes no clones: three chips, no clone button.
  await click(q("[data-model-card=\"google/gemini-tts\"]"));
  assert.deepEqual(qa("[data-voice-filter]").map((b) => b.textContent), ["Hammasi", "Erkak", "Ayol"]);
  assert.equal(qa("[data-voice-row]").length, GEMINI_VOICES.length);
  assert.ok(!q("[data-clone-open]") && !q("[data-clone-has]"));
  // Pure helpers behind the list.
  assert.equal(voiceRows(GEMINI_VOICES, "gemini", [], false, "female").every((r) => r.gender === "female"), true);
  assert.equal(daysLeft(new Date(Date.now() + 2.5 * 86_400_000).toISOString()), 3);
});

test("price button, character line, request; every schema param has exactly one data-field", async () => {
  const a = api();
  await mount();
  await openVoice();
  const text = "x".repeat(1000);
  await type("[data-voice-text] textarea", text);
  assert.equal(txt("[data-voice-chars]"), "1 000 / 4 000 belgi · ~67 s");
  const price = studioSpeechPrice({ modelId: ids[0], text }, RATE)!;
  assert.equal(price, 2100);
  assert.match(txt("[data-studio-submit]"), /Ovozlash · ElevenLabs v3 · ~2 100/);
  for (const p of SPEECH[0]!.params) assert.equal(qa(`[data-field="${p.name}"]`).length, 1, `data-field ${p.name}`);
  await click(q('[data-voice-pick="pNInz6obpgDQGcFmaJgB"]'));
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-speech");
  assert.equal(post.body!.expectedPrice, 2100);
  assert.deepEqual(post.body!.values, { modelId: "elevenlabs/eleven-v3", text, voice: "pNInz6obpgDQGcFmaJgB", speed: "1", stability: "0.5", lang: "uz" });
  // Dialogue: its params, one data-field each; the script keeps its lines in the request.
  await click(qa('[data-voice-mode] [role="radio"]').find((b) => b.textContent === "Suhbat"));
  for (const p of SPEECH[2]!.params) assert.equal(qa(`[data-field="${p.name}"]`).length, 1, `dialogue data-field ${p.name}`);
  await type("[data-voice-text] textarea", "Ali: Salom!\nVali: Xayr!");
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts()[1]!.body!.values && (a.posts()[1]!.body!.values as Record<string, unknown>).script, "Ali: Salom!\nVali: Xayr!");
});

test("result page: the audio viewer plays a Studio speech file and lists its lines (`doc.speech`)", async () => {
  const { AudioViewer } = await import("../../components/viewers/AudioViewer.tsx");
  const doc = {
    meta: { topic: "Salom" },
    titlePage: false,
    toc: false,
    sections: [],
    speech: { model: "elevenlabs/v3-dialogue", seconds: 12, chars: 20, voices: ["Rachel", "Adam"], lines: [{ speaker: "Ali", text: "Salom!" }, { speaker: "Vali", text: "Xayr!" }], clone: false },
  };
  render(h(AudioViewer, { doc: doc as never, gen: { id: "g1" } }));
  assert.equal(q("[data-audio-player] audio")?.getAttribute("src"), "/api/generations/g1/file?inline=1");
  assert.match(q("[data-audio-transcript]")?.textContent ?? "", /AliSalom!.*ValiXayr!/);
});

test("clone: consent required; the sample carries consent=1, then studio-voice at the clone price", async () => {
  const a = api();
  // The browser decoder: a 35 s mono recording.
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    decodeAudioData() {
      return Promise.resolve({ duration: 35, numberOfChannels: 1, sampleRate: 24_000, getChannelData: () => new Float32Array(24_000 * 35) });
    }
    close() {
      return Promise.resolve();
    }
  };
  await mount();
  await openVoice();
  await click(q("[data-clone-open]"));
  assert.ok(q("[data-clone-tos]"), "the ToS line");
  const submit = () => q<HTMLButtonElement>("[data-clone-submit]")!;
  assert.equal(submit().disabled, true);
  assert.match(txt("[data-clone-submit]"), /Klonlash · 5 000/);
  const file = new File([new Uint8Array([1, 2, 3, 4])], "men.m4a", { type: "audio/mp4" });
  await act(async () => void fireEvent.change(q("[data-clone-file]")!, { target: { files: [file] } }));
  await settle();
  assert.match(q("[data-clone-sample-seconds]")!.textContent ?? "", /0:35/);
  assert.equal(submit().disabled, true, "MUTATSIYA: consent not required → green button");
  assert.match(q("[data-clone-blocker]")!.textContent ?? "", /haqqim bor/);
  await click(q("[data-clone-consent]"));
  assert.equal(submit().disabled, false);
  await click(submit());
  await settle(20);
  const sample = a.extra.find((c) => c.url === "/api/media/voices/samples")!;
  assert.equal(sample.form!.get("consent"), "1");
  assert.equal((sample.form!.get("file") as File).type, "audio/wav", "converted to WAV in the browser");
  const buy = a.posts().find((p) => p.body!.slug === "studio-voice")!;
  assert.equal(buy.body!.expectedPrice, 5000);
  assert.deepEqual(buy.body!.values, { name: "Mening ovozim", sampleId: "abcdefabcdefabcdefabcdef" });
  const offer = { available: true, price: 5000, consentText: "", consentVersion: "", minSeconds: 30, maxSeconds: 180, maxBytes: 10, unusedDays: 30 };
  assert.match(String(cloneBlocker({ name: "x", sample: { blob: new Blob([]), seconds: 20, fileName: "a" }, consent: true, offer })), /kamida 30/);
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
});
