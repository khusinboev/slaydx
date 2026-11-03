import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, catalogBody, installApi, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { formatSom } = await import("../../lib/format.ts");

/**
 * Studio P9 «Video» tab — the HeyGen avatar (docs/studio/P9-HEYGEN.md), API stubbed at `fetch`, the REAL catalog entry:
 *   - the form is the entry's ParamSchema with ONE `data-field` per param, except the computed length (`seconds`: no
 *     row); the own speech is the tab's own picker (`data-field="audioId"`, the user's speeches from
 *     `GET /api/media/mix-sources`, a known length ≤ 1 min only); the prompt box reads «Avatar nima desin?»;
 *   - the button price follows the script length (12 characters / s) and the engine; the submit sends `seconds`;
 *   - picking an own speech hides the script box and the voice / language rows (they would change nothing), prices that
 *     speech's length and sends `audioId` with an empty script;
 *   - no script and no speech: refused before any request.
 *
 * Mutations (each turned the named test red, then restored):
 *   1. `avatarHiddenParams` keeps `seconds` as a row                    -> «form»;
 *   2. VideoTab prices without `avatarRequest` (default 10 s)           -> «form» (price), «own speech»;
 *   3. own speech keeps the voice / language rows                       -> «own speech»;
 *   4. `avatarSpeeches` lists a speech without a known length            -> «own speech».
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

const view = MEDIA_CATALOG.clientView();
const by = (id: string) => view.find((e) => e.id === id)!;
const OMNI = by("google/omni-video");
const HG = by("heygen/avatar");
const RATE = { ...PRICING, soumPerUsd: 12_700 };
const up100 = (n: number) => Math.ceil(n / 100 - 1e-9) * 100;
const SPEECH = "0f0e0d0c-0b0a-4908-8706-050403020100";
const SCRIPT = "Assalomu alaykum! Bugun yangi kurs haqida gapiramiz."; // 52 characters → 5 s

function api() {
  const base = installApi({ catalog: catalogBody([NANO, GPT]) });
  const inner = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/media/catalog?purpose=studio.video")) return json(200, { purpose: "studio.video", defaultModelId: "google/omni-video", models: [OMNI, HG], pricing: RATE });
    if (url.startsWith("/api/media/mix-sources")) {
      base.calls.push({ url, method: "GET", body: null, key: null });
      return json(200, {
        price: 500,
        video: [],
        audio: [],
        music: [],
        speech: [
          { id: SPEECH, title: "Salomlashish", kind: "Ovoz", seconds: 12.3, createdAt: "2026-11-03T10:00:00.000Z" },
          { id: "11111111-2222-4333-8444-555555555555", title: "Uzun podkast", kind: "Podkast", seconds: 300, createdAt: "2026-11-02T10:00:00.000Z" },
          { id: "66666666-7777-4888-8999-000000000000", title: "Noma'lum", kind: "Ovoz", seconds: null, createdAt: "2026-11-01T10:00:00.000Z" },
        ],
      });
    }
    return inner(input as never, init);
  };
  return base;
}

beforeEach(() => {
  dropMediaCatalog();
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
async function settle(n = 8) {
  await act(async () => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 3));
  });
}
async function open() {
  render(h(AppRouterContext.Provider, { value: router }, h(StudioPage)));
  await settle();
  await click(q('[data-studio-tab="video"]'));
  await settle();
  await click(q("[data-model-all]"));
  await click(q(`[data-model-option="${HG.id}"]`));
  await click(q("[data-model-confirm]"));
  await settle();
}
const button = () => q("[data-studio-submit]")?.textContent ?? "";
async function type(sel: string, value: string) {
  const el = q<HTMLTextAreaElement>(sel)!;
  assert.ok(el, sel);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const radio = (field: string, label: string) => qa(`[data-field="${field}"] [role="radio"]`).find((b) => b.textContent === label);
const price = (secs: number, usd = 0.0805) => up100(usd * secs * 12_700 * 2);

test("form: ParamSchema rows minus the computed length; «Avatar nima desin?»; price follows the script and the engine; submit sends seconds", async () => {
  const a = api();
  await open();
  const names = qa("[data-field]").map((e) => e.getAttribute("data-field")).sort();
  assert.deepEqual(names, HG.params.map((p) => p.name).filter((n) => n !== "seconds").sort(), "MUTATSIYA: the computed length drawn as a row");
  assert.equal(q("[data-video-prompt] label")?.textContent, "Avatar nima desin?");
  assert.ok(a.calls.some((c) => c.url.startsWith("/api/media/mix-sources")), "the speeches are loaded for the picker");
  await type("[data-video-prompt] textarea", SCRIPT);
  assert.equal(button(), `Yaratish · 5 soniya · ${formatSom(price(5))}`, "MUTATSIYA: priced at the default 10 s");
  await type("[data-video-prompt] textarea", "x".repeat(300));
  assert.equal(button(), `Yaratish · 25 soniya · ${formatSom(price(25))}`);
  await click(radio("engine", "Avatar III (arzon)"));
  assert.equal(button(), `Yaratish · 25 soniya · ${formatSom(price(25, 0.0167))}`);
  await click(radio("voice", "Erkak ovozi"));
  await click(radio("aspect", "9:16"));
  await type("[data-video-prompt] textarea", SCRIPT);
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: HG.id, prompt: SCRIPT, audioId: "", avatar: "Angela-inblackskirt-20220820", voice: "male", language: "uz", engine: "avatar_iii", aspect: "9:16", seconds: 5 });
  assert.equal(sent.expectedPrice, price(5, 0.0167));
});

test("own speech: only known lengths ≤ 1 min listed; picking one hides the script / voice / language, prices its length, sends audioId", async () => {
  const a = api();
  await open();
  const select = q<HTMLSelectElement>('[data-field="audioId"] select');
  assert.ok(select, "the own-speech picker");
  assert.deepEqual([...select.options].map((o) => o.value), ["", SPEECH], "MUTATSIYA: a speech without a length / over a minute listed");
  await act(async () => void fireEvent.change(select, { target: { value: SPEECH } }));
  await settle(2);
  assert.ok(!q("[data-video-prompt]"), "the script box hides");
  assert.ok(!q('[data-field="voice"]') && !q('[data-field="language"]'), "MUTATSIYA: voice / language rows kept with an own speech");
  assert.ok(q('[data-field="avatar"]') && q('[data-field="engine"]') && q('[data-field="aspect"]'));
  assert.equal(button(), `Yaratish · 13 soniya · ${formatSom(price(13))}`, "12.3 s → 13 s");
  await click(q("[data-studio-submit]"));
  await settle();
  const sent = a.posts()[0]!.body!;
  assert.equal((sent.values as Record<string, unknown>).audioId, SPEECH);
  assert.equal((sent.values as Record<string, unknown>).prompt, "");
  assert.equal((sent.values as Record<string, unknown>).seconds, 13);
  assert.equal(sent.expectedPrice, price(13));
  // Back to the script: the box returns.
  await act(async () => void fireEvent.change(q<HTMLSelectElement>('[data-field="audioId"] select')!, { target: { value: "" } }));
  await settle(2);
  assert.ok(q("[data-video-prompt]"));
});

test("no script and no speech: refused in the form, nothing sent", async () => {
  const a = api();
  await open();
  await click(q("[data-studio-submit]"));
  await settle();
  assert.equal(a.posts().length, 0);
  assert.match(q("[data-studio-error]")?.textContent ?? "", /Avatar aytadigan matnni yozing/);
});
