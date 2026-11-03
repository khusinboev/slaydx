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
const { studioAudioPrice } = await import("../../lib/media/studio-audio.ts");

/**
 * Studio «Audio» tab (docs/studio/P6-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries.
 *
 * Locked here:
 *   - the fourth tab «Audio»; its listing (`purpose=studio.audio`) is asked only once the tab opens; `?tab=audio` opens
 *     it; an empty listing (switch off) shows no mode and the «not available» line;
 *   - mode chips Musiqa / Effekt / Ovozni almashtirish / Shovqindan tozalash; each mode draws ONLY its own params —
 *     exactly one `data-field` per schema param of that model, none of another mode's;
 *   - the price on the button = the server formula («Yaratish · Musiqa · ~4 200 so'm» for 60 s), the submit sends slug
 *     `studio-audio`, `{modelId, …schema}` and that `expectedPrice`; an SFX with 3 variants says «×3» and prices them;
 *   - an audio-input mode: no price and no send before an upload; the recording / file is converted in the browser
 *     (WAV) and uploaded to `/api/media/audio-inputs`; the server's billed seconds price the job and go out as
 *     `inputSeconds`; the ToS line is shown (no checkbox).
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `OWN_ROWS` misses `inputSeconds` (ParamRows draws a second stepper)        -> «modes» (two data-fields);
 *   2. `offeredModes` ignores the listing (every mode drawn)                      -> «tab» (empty listing);
 *   3. button priced with `price = null`                                          -> «price button»;
 *   4. upload answer's seconds not stored (`inputSeconds` from raw dropped)        -> «upload»;
 *   5. `audioBlocker` ignores the missing input                                   -> «upload» (sent before the upload);
 *   6. voice list shows clones still being made (`status` filter dropped)         -> «voice changer»;
 *   7. the viewer's variant list needs > 3 variants (`length > 3`)                -> «result page».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const IDS = ["elevenlabs/music", "elevenlabs/sfx", "elevenlabs/voice-changer", "elevenlabs/isolator"];
const AUDIO = IDS.map((id) => view.find((e) => e.id === id)!);
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const READY_CLONE = { id: "0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a", voice: "clone:0e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a", name: "Mening ovozim", status: "ready", createdAt: "2026-11-01T00:00:00Z", lastUsedAt: "2026-11-01T00:00:00Z", expiresAt: null };
const MAKING_CLONE = { ...READY_CLONE, id: "1e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a", voice: "clone:1e7a1d3c-9b1f-4b6a-8a52-1f2e3d4c5b6a", name: "Yangi klon", status: "creating" };

function api(o: { models?: typeof AUDIO; mine?: unknown[] } = {}) {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  const extra: { url: string; method: string; form?: FormData }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/media/catalog?purpose=studio.audio")) {
      base.calls.push({ url, method, body: null, key: null });
      const models = o.models ?? AUDIO;
      return json(200, { purpose: "studio.audio", defaultModelId: models[0]?.id ?? null, models, pricing: RATE });
    }
    if (url === "/api/media/voices") {
      extra.push({ url, method });
      return json(200, {
        library: { elevenlabs: ELEVENLABS_VOICES, gemini: GEMINI_VOICES },
        mine: o.mine ?? [],
        clone: { available: true, price: 5000, consentText: "", consentVersion: "v", minSeconds: 30, maxSeconds: 180, maxBytes: 10485760, unusedDays: 30 },
      });
    }
    if (url === "/api/media/audio-inputs") {
      extra.push({ url, method, form: init?.body as FormData });
      return json(200, { id: "abcdefabcdefabcdefabcdef", seconds: 60, mime: "audio/wav", size: 100 });
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
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
});

const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);
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
async function openAudio() {
  await click(q('[data-studio-tab="audio"]'));
  await settle();
}
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel);
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const mode = (m: string) => click(q(`[data-audio-mode-chip="${m}"]`));
/** Every `data-field` of the form, by name, with how often it appears. */
function fields(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of qa("[data-audio-tab] [data-field]")) out[el.dataset.field!] = (out[el.dataset.field!] ?? 0) + 1;
  return out;
}

test("tab: «Audio» is the fourth tab, its listing waits for it, ?tab=audio opens it; an empty listing shows no mode", async () => {
  const a = api();
  await mount();
  assert.deepEqual(qa("[data-studio-tab]").map((b) => b.textContent), ["Rasm", "Video", "Ovoz", "Audio"]);
  assert.equal(a.calls.filter((c) => c.url.includes("studio.audio")).length, 0);
  await openAudio();
  assert.ok(q("[data-audio-tab]"));
  assert.equal(a.calls.filter((c) => c.url.includes("studio.audio")).length, 1);
  assert.deepEqual(qa("[data-audio-mode-chip]").map((b) => b.textContent), ["Musiqa", "Effekt", "Ovozni almashtirish", "Shovqindan tozalash"]);
  cleanup();
  dropMediaCatalog();
  window.history.replaceState(null, "", "/uz/studio?tab=audio");
  api({ models: [] });
  await mount();
  await settle();
  assert.equal(q('[data-studio-tab="audio"]')!.getAttribute("aria-selected"), "true");
  assert.ok(q("[data-audio-none]"), "switch off: the «not available» line");
  assert.equal(qa("[data-audio-mode-chip]").length, 0);
});

test("modes: each mode draws exactly its own params (one data-field each), nothing of another mode", async () => {
  api();
  await mount();
  await openAudio();
  for (const [m, id] of [["music", IDS[0]], ["sfx", IDS[1]], ["voice-changer", IDS[2]], ["isolate", IDS[3]]] as const) {
    await mode(m);
    await settle();
    const want = Object.fromEntries(MEDIA_CATALOG.byId(id)!.params.map((p) => [p.name, 1]));
    assert.deepEqual(fields(), want, `${m}: one data-field per param`);
    assert.equal(q("[data-audio-tab]")!.dataset.audioMode, m);
  }
  // The ToS line on the upload modes (text, no checkbox).
  assert.match(txt("[data-audio-tos]"), /Faqat o‘zingizning yoki ruxsatingiz bor yozuvni yuklang/);
  assert.ok(!q('[data-audio-input] input[type="checkbox"]'));
});

test("price button: the server formula, the request, SFX variants", async () => {
  const a = api();
  await mount();
  await openAudio();
  assert.match(txt("[data-studio-submit]"), /^Yaratish$/, "no price before a description");
  await type("[data-audio-prompt] textarea", "calm lo-fi piano, rainy evening");
  assert.match(txt("[data-studio-submit]"), /Yaratish · Musiqa · ~2 100/);
  await click(qa('[data-field="length"] [role="radio"]').find((b) => b.textContent === "1 daq"));
  const price = studioAudioPrice({ modelId: IDS[0], length: "60" }, RATE)!;
  assert.equal(price, 4200);
  assert.match(txt("[data-studio-submit]"), /Yaratish · Musiqa · ~4 200/);
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.slug, "studio-audio");
  assert.equal(post.body!.expectedPrice, 4200);
  assert.deepEqual(post.body!.values, { modelId: "elevenlabs/music", prompt: "calm lo-fi piano, rainy evening", length: "60", instrumental: false });
  // Effekt: its own text, 3 variants → ×3 and three times the price of one.
  await mode("sfx");
  await type("[data-audio-prompt] textarea", "door creaks open");
  await click(qa('[data-field="variants"] [role="radio"]').find((b) => b.textContent === "3"));
  const three = studioAudioPrice({ modelId: IDS[1], duration: 5, variants: 3 }, RATE)!;
  assert.equal(three, 2800);
  assert.match(txt("[data-studio-submit]"), /Yaratish · Effekt ×3 · ~2 800/);
});

test("upload: no send before an upload; the browser converts, the server's seconds price the job", async () => {
  const a = api();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    decodeAudioData() {
      return Promise.resolve({ duration: 59.6, numberOfChannels: 1, sampleRate: 24_000, getChannelData: () => new Float32Array(2400) });
    }
    close() {
      return Promise.resolve();
    }
  };
  await mount();
  await openAudio();
  await mode("isolate");
  assert.match(txt("[data-studio-submit]"), /^Yaratish$/);
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 0, "nothing sent without an input");
  assert.match(txt("[data-studio-error]"), /audio faylni yuklang/);
  const file = new File([new Uint8Array([1, 2, 3, 4])], "intervyu.m4a", { type: "audio/mp4" });
  await act(async () => void fireEvent.change(q("[data-audio-file]")!, { target: { files: [file] } }));
  await settle(20);
  const up = a.extra.find((c) => c.url === "/api/media/audio-inputs")!;
  assert.equal((up.form!.get("file") as File).type, "audio/wav", "converted to WAV in the browser");
  assert.match(txt("[data-audio-input-seconds]"), /1:00 \(60 s\)/);
  assert.match(txt("[data-studio-submit]"), /Shovqindan tozalash · ~4 700/);
  await click(q("[data-studio-submit]"));
  await settle();
  const post = a.posts()[0]!;
  assert.equal(post.body!.expectedPrice, 4700);
  assert.deepEqual(post.body!.values, { modelId: "elevenlabs/isolator", inputId: "abcdefabcdefabcdefabcdef", inputSeconds: 60 });
});

test("result page: the audio viewer plays the file, names the mode, lists every SFX variant (`doc.studioAudio`)", async () => {
  const { AudioViewer } = await import("../../components/viewers/AudioViewer.tsx");
  const variants = [1, 2, 3].map((n) => ({ assetId: String(n).repeat(24), seconds: 5 }));
  const doc = { meta: { topic: "Eshik" }, titlePage: false, toc: false, sections: [], studioAudio: { mode: "sfx", model: IDS[1], seconds: 5, prompt: "door creaks open", inputSeconds: null, voices: [], clone: false, variants } };
  render(h(AudioViewer, { doc: doc as never, gen: { id: "g1" } }));
  assert.equal(q("[data-audio-player] audio")?.getAttribute("src"), "/api/generations/g1/file?inline=1");
  assert.match(txt("[data-audio-details]"), /Ovoz effekti.*door creaks open/);
  assert.deepEqual(qa("[data-audio-variant] audio").map((a) => a.getAttribute("src")), variants.map((v) => `/api/generations/g1/assets/${v.assetId}`));
  assert.equal(qa("[data-variant-download]").length, 3);
});

test("voice changer: the ElevenLabs library + ready own clones; the pick goes out as `voice`", async () => {
  const a = api({ mine: [READY_CLONE, MAKING_CLONE] });
  await mount();
  await openAudio();
  await mode("voice-changer");
  await settle(20);
  assert.ok(q(`[data-voice-pick="${ELEVENLABS_VOICES[0]!.id}"]`));
  assert.ok(q(`[data-voice-pick="${READY_CLONE.voice}"]`), "a ready clone is offered");
  assert.ok(!q(`[data-voice-pick="${MAKING_CLONE.voice}"]`), "a clone still being made is not");
  assert.ok(!q('[data-voice-pick="Kore"]'), "no Gemini voices");
  await click(q(`[data-voice-pick="${READY_CLONE.voice}"]`));
  // Fake an uploaded input through the real upload path.
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
    decodeAudioData() {
      return Promise.resolve({ duration: 60, numberOfChannels: 1, sampleRate: 24_000, getChannelData: () => new Float32Array(2400) });
    }
    close() {
      return Promise.resolve();
    }
  };
  await act(async () => void fireEvent.change(q("[data-audio-file]")!, { target: { files: [new File([new Uint8Array([1])], "a.wav", { type: "audio/wav" })] } }));
  await settle(20);
  await click(q("[data-studio-submit]"));
  await settle();
  const values = a.posts()[0]!.body!.values as Record<string, unknown>;
  assert.equal(values.voice, READY_CLONE.voice);
  assert.equal(values.removeNoise, false);
});
