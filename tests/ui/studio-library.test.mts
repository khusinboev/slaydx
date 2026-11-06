import "./setup.ts";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { MEDIA_CATALOG } from "../../lib/media/catalog.ts";
import { GPT, NANO, PRICING, USER, expectedPrice, generationDetail, json } from "./studio-fixtures.ts";

const { StudioPage } = await import("../../components/studio/StudioPage.tsx");
const { useAppStore } = await import("../../lib/store.ts");
const { useUi } = await import("../../lib/ui.ts");
const { dropMediaCatalog } = await import("../../components/studio/studio-api.ts");
const { dropLibraryCache } = await import("../../components/studio/LibrarySheet.tsx");
const { dropTemplatesCache } = await import("../../components/studio/TemplatesRow.tsx");
const { formatSom } = await import("../../lib/format.ts");
const { Gallery } = await import("../../components/studio/Gallery.tsx");

/**
 * Studio P2b UI (docs/studio/P2B-SPEC.md) with the API stubbed at `fetch` and the REAL catalog entries:
 *
 *   samples    «Namuna promptlar» opens the sheet; a category chip filters; a tap fills the prompt and closes it;
 *   templates  only templates of offered models are drawn; a tap picks the model, applies the preset values, builds the
 *              prompt from the slots (placeholders first, then typed values); every slot is exactly one
 *              `data-field="slot.<name>"`; submit sends exactly `{modelId, …schema}` with the template's values;
 *   upload     «Rasm yuklash» → `POST /api/media/inputs` → edit mode (catalog `studio.edit`), the picture as the
 *              `inputImages` field (exactly one `data-field`), submit sends the asset id (comma form) + the price shown;
 *              an edit without a picture sends nothing;
 *   tools      «Sifatini oshirish» on a finished picture → `POST /api/media/inputs/from-result {generationId, assetId}`
 *              → upscale mode (no prompt box), `factor` is a real control (×4 reaches the request);
 *   enhance    «Yaxshilash (AI)» sends the prompt, puts the rewrite in the box; disabled under 3 characters;
 *   gallery    the picture tools are drawn on picture items only, never on a P3 video item.
 *
 * Mutations (each turned the named test(s) red, then restored) — see docs/studio/P2B-SPEC.md «Mutations»:
 *   LibrarySheet `onPick` not called -> "samples"; applyTemplate drops `t.params` -> "templates";
 *   TemplateSlots without `<Field>` -> "templates"; requestValues sends the id list as an array -> "upload", "tools";
 *   pictureTool skips `inputFromResult` -> "tools"; enterMode keeps the image catalog -> "upload" (wrong models);
 *   enhance writes nothing back -> "enhance"; the `!it.video` guard dropped in Gallery -> "gallery".
 */

Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
const realFetch = globalThis.fetch;
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const view = MEDIA_CATALOG.clientView();
const byId = (id: string) => view.find((e) => e.id === id)!;
const NANO_EDIT = byId("google/nano-banana-edit");
const SEED_EDIT = byId("bytedance/seedream-edit");
const UPSCALE = byId("bytedance/seedvr-upscale");
const ASSET = "a1".repeat(12);
const RESULT_ASSET = "b2".repeat(12);

const CATALOGS: Record<string, unknown> = {
  "studio.image": { purpose: "studio.image", defaultModelId: NANO.id, models: [NANO, GPT], pricing: PRICING },
  "studio.edit": { purpose: "studio.edit", defaultModelId: NANO_EDIT.id, models: [NANO_EDIT, SEED_EDIT], pricing: PRICING },
  "studio.upscale": { purpose: "studio.upscale", defaultModelId: UPSCALE.id, models: [UPSCALE], pricing: PRICING },
  "studio.bgremove": { purpose: "studio.bgremove", defaultModelId: null, models: [], pricing: PRICING },
};
const LIBRARY = {
  categories: [
    { id: "logo", label: "Logo", count: 1 },
    { id: "tabiat", label: "Tabiat", count: 1 },
  ],
  items: [
    { id: "1", category: "logo", title: "Qahvaxona logotipi", prompt: "Qahvaxona uchun sodda logotip", previewUrl: null },
    { id: "2", category: "tabiat", title: "Tog' ko'li", prompt: "Qorli tog'lar orasidagi moviy ko'l", previewUrl: null },
  ],
};
const TEMPLATES = {
  items: [
    {
      id: "10",
      category: "reklama",
      title: "Post",
      modelId: GPT.id,
      params: { imageRatio: "16:9", imageCount: 2 },
      skeleton: "{mahsulot} reklamasi, {joy}",
      slots: [
        { name: "mahsulot", label: "Mahsulot", placeholder: "qahva", max: 40 },
        { name: "joy", label: "Joy", max: 30 },
      ],
      previewUrl: null,
    },
    { id: "11", category: "logo", title: "Recraft logo", modelId: "recraft/recraft", params: {}, skeleton: "{a} logo", slots: [{ name: "a", label: "A", max: 20 }], previewUrl: null },
  ],
};

type Call = { url: string; method: string; body: Record<string, unknown> | null; form: boolean };
function installApi() {
  const calls: Call[] = [];
  let n = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const form = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url, method, body, form });
    if (url.startsWith("/api/media/catalog")) return json(200, CATALOGS[new URL(url, "http://x").searchParams.get("purpose") ?? ""] ?? {});
    if (url === "/api/media/library") return json(200, LIBRARY);
    if (url === "/api/media/templates") return json(200, TEMPLATES);
    if (url === "/api/media/inputs" && method === "POST") return json(200, { assetId: ASSET, mime: "image/png", size: 10, w: 800, h: 600 });
    if (url === "/api/media/inputs/from-result" && method === "POST") return json(200, { assetId: RESULT_ASSET, mime: "image/png", size: 10, w: 1024, h: 1024 });
    if (url === "/api/media/enhance" && method === "POST") return json(200, { prompt: "Samarqand Registon maydoni, oltin soat, keng burchakli kadr" });
    if (url === "/api/generations" && method === "POST") return json(202, { id: `5555555${n++}-5555-4555-8555-555555555555`, price: body?.expectedPrice ?? 0, status: "QUEUED" });
    const one = /^\/api\/generations\/([^/?]+)(\?.*)?$/.exec(url);
    if (one && method === "GET") {
      const g = generationDetail(one[1]!) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      g.doc.images = [{ id: "img1", url: `/api/generations/${one[1]}/assets/abcdef0123`, w: 1024, h: 1024, mime: "image/png", alt: "natija" }];
      return json(200, { generation: g });
    }
    if (url === "/api/auth/session") return json(200, { user: USER, features: { llm: true, images: true } });
    if (url.startsWith("/api/channels/required")) return json(200, { ok: true, needsTelegram: false, channels: [] });
    if (url.startsWith("/api/generations")) return json(200, { generations: [], nextCursor: null });
    return json(404, { error: "yo'q" });
  };
  return { calls, posts: () => calls.filter((c) => c.url === "/api/generations" && c.method === "POST") };
}

beforeEach(() => {
  dropMediaCatalog();
  dropLibraryCache();
  dropTemplatesCache();
  useAppStore.setState({ loggedIn: true, sessionChecked: true, user: USER as never });
});
afterEach(async () => {
  cleanup();
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  globalThis.fetch = realFetch;
  dropMediaCatalog();
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
const prompt = () => q<HTMLTextAreaElement>('[data-field="prompt"] textarea');
const fields = () => qa("[data-field]").map((e) => e.getAttribute("data-field")!);
async function type(el: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  assert.ok(el);
  await act(async () => void fireEvent.change(el, { target: { value } }));
}
const submit = async () => {
  await click(q("[data-studio-submit]"));
  await settle();
};

test("samples: the sheet opens, a chip filters, a tap fills the prompt and closes; nothing is sent", async () => {
  const api = installApi();
  await mount();
  await click(q('[data-prompt-tool="samples"]'));
  await settle();
  assert.ok(q("[data-library-sheet]"), "the sheet");
  assert.equal(qa("[data-library-item]").length, 2);
  await click(q('[data-library-chip="tabiat"]'));
  assert.deepEqual(qa("[data-library-item]").map((e) => e.getAttribute("data-library-item")), ["2"]);
  await click(q('[data-library-item="2"]'));
  await settle();
  assert.ok(!q("[data-library-sheet]"), "closed");
  assert.equal(prompt()!.value, "Qorli tog'lar orasidagi moviy ko'l");
  assert.equal(api.posts().length, 0);
});

test("templates: offered models only; a tap applies model + values + slots; every slot one data-field; submit sends them", async () => {
  const api = installApi();
  await mount();
  assert.deepEqual(qa("[data-template-card]").map((e) => e.getAttribute("data-template-card")), ["10"], "the Recraft template's model is not offered here");
  await click(q('[data-template-card="10"]'));
  await settle();
  assert.equal(q(`[data-model-card="${GPT.id}"]`)?.getAttribute("aria-pressed"), "true", "the template's model");
  assert.equal(q('[data-field="imageRatio"] [aria-checked="true"]')?.textContent, "16:9", "preset ratio");
  assert.equal(q('[data-field="imageCount"] [aria-checked="true"]')?.textContent, "2", "preset count");
  assert.equal(prompt()!.value, "qahva reklamasi", "placeholders fill, an empty slot drops out");
  for (const s of ["mahsulot", "joy"]) assert.equal(fields().filter((f) => f === `slot.${s}`).length, 1, `slot ${s}: exactly one data-field`);
  await type(q<HTMLInputElement>('[data-field="slot.mahsulot"] input'), "olma sharbati");
  await type(q<HTMLInputElement>('[data-field="slot.joy"] input'), "yozgi bog'");
  assert.equal(prompt()!.value, "olma sharbati reklamasi, yozgi bog'");
  await submit();
  const sent = api.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: GPT.id, prompt: "olma sharbati reklamasi, yozgi bog'", imageRatio: "16:9", imageCount: 2, imageStyle: "photo" });
  assert.equal(sent.expectedPrice, expectedPrice(GPT, 2));
  // Typing the prompt by hand leaves the template.
  await type(prompt(), "boshqa tavsif matni");
  assert.ok(!q("[data-template-slots]"));
});

test("upload: «Rasm yuklash» → edit mode with the picture; submit sends the asset id; no picture sends nothing", async () => {
  const api = installApi();
  await mount();
  await type(prompt(), "osmonni to'q sariq qil");
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "a.png", { type: "image/png" });
  await act(async () => void fireEvent.change(q<HTMLInputElement>("[data-prompt-upload-file]")!, { target: { files: [file] } }));
  await settle();
  const up = api.calls.find((c) => c.url === "/api/media/inputs");
  assert.ok(up && up.method === "POST" && up.form, "multipart upload");
  assert.equal(q("[data-studio-mode]")?.getAttribute("data-studio-mode"), "edit");
  assert.ok(api.calls.some((c) => c.url === "/api/media/catalog?purpose=studio.edit"), "the edit catalog");
  assert.ok(q(`[data-model-card="${NANO_EDIT.id}"]`) && q(`[data-model-card="${SEED_EDIT.id}"]`), "edit models offered");
  assert.ok(!q(`[data-model-card="${GPT.id}"]`));
  assert.equal(fields().filter((f) => f === "inputImages").length, 1, "the picture is one field");
  assert.ok(q(`[data-image-input="${ASSET}"]`), "its thumbnail");
  assert.match(q('[data-studio-prompt] label')?.textContent ?? "", /Nimani o‘zgartiramiz/);
  assert.equal(prompt()!.value, "osmonni to'q sariq qil", "the prompt became the instruction");
  await submit();
  const sent = api.posts()[0]!.body!;
  assert.deepEqual(sent.values, { modelId: NANO_EDIT.id, prompt: "osmonni to'q sariq qil", inputImages: ASSET, imageCount: 1 });
  assert.equal(sent.expectedPrice, expectedPrice(NANO_EDIT, 1));
  // Remove the picture: nothing is sent, the reason is said.
  await click(q(`[data-image-remove="${ASSET}"]`));
  await submit();
  assert.equal(api.posts().length, 1);
  assert.match(q("[data-studio-error]")?.textContent ?? "", /Avval rasm yuklang/);
  // Back to drawing.
  await click(q("[data-studio-mode-exit]"));
  await settle();
  assert.ok(!q("[data-studio-mode]"));
  assert.ok(q(`[data-model-card="${NANO.id}"]`));
});

test("tools: «Sifatini oshirish» on a finished picture → its own input → upscale mode; ×4 reaches the request", async () => {
  const api = installApi();
  await mount();
  await type(prompt(), "Registon maydoni kechqurun");
  await submit();
  await settle(30);
  assert.equal(api.posts().length, 1);
  const genId = "55555550-5555-4555-8555-555555555555";
  await click(q('[data-studio-job] [data-result-action="upscale"]'));
  await settle();
  const imp = api.calls.find((c) => c.url === "/api/media/inputs/from-result");
  assert.deepEqual(imp?.body, { generationId: genId, assetId: "abcdef0123" }, "the stored asset of that job");
  assert.equal(q("[data-studio-mode]")?.getAttribute("data-studio-mode"), "upscale");
  assert.ok(!q('[data-field="prompt"]'), "no prompt box for an upscale");
  assert.equal(fields().filter((f) => f === "factor").length, 1);
  await click(qa('[data-field="factor"] [role="radio"]').find((b) => b.textContent === "×4"));
  await submit();
  const sent = api.posts()[1]!.body!;
  assert.deepEqual(sent.values, { modelId: UPSCALE.id, inputImages: RESULT_ASSET, factor: "4" });
  assert.match(q("[data-studio-submit]")?.textContent ?? "", new RegExp(formatSom(expectedPrice(UPSCALE, 1)).replace(/\s/g, "\\s")));
});

test("tools: «Tahrirlash» on a result starts with an EMPTY instruction (the old prompt described the picture) — review NIT-9", async () => {
  const api = installApi();
  await mount();
  await type(prompt(), "Registon maydoni kechqurun");
  await submit();
  await settle(30);
  await click(q('[data-studio-job] [data-result-action="edit"]'));
  await settle();
  assert.ok(api.calls.some((c) => c.url === "/api/media/inputs/from-result"));
  assert.equal(q("[data-studio-mode]")?.getAttribute("data-studio-mode"), "edit");
  assert.equal(prompt()!.value, "", "no carried-over picture description");
});

test("enhance: sends the prompt, writes the rewrite back; disabled under 3 characters", async () => {
  const api = installApi();
  await mount();
  await type(prompt(), "ab");
  assert.equal(q<HTMLButtonElement>('[data-prompt-tool="enhance"]')!.disabled, true);
  await type(prompt(), "Registon");
  await click(q('[data-prompt-tool="enhance"]'));
  await settle();
  const call = api.calls.find((c) => c.url === "/api/media/enhance");
  assert.deepEqual(call?.body, { prompt: "Registon", kind: "image" });
  assert.equal(prompt()!.value, "Samarqand Registon maydoni, oltin soat, keng burchakli kadr");
  assert.equal(api.posts().length, 0, "free: nothing is generated");
});

test("gallery: the picture tools sit on picture items only, never on a video item", async () => {
  const img = "66666660-6666-4666-8666-666666666666";
  const vid = "66666661-6666-4666-8666-666666666666";
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown) => {
    if (String(input).startsWith("/api/media/gallery"))
      return json(200, {
        items: [
          { id: img, createdAt: "2026-11-02T10:00:00.000Z", modelId: NANO.id, modelLabel: "Nano Banana", prompt: "rasm", images: [{ url: `/api/generations/${img}/assets/abc123`, w: 1, h: 1 }], fileUrl: `/api/generations/${img}/file` },
          { id: vid, kind: "video", video: { seconds: 5 }, createdAt: "2026-11-02T10:00:00.000Z", modelId: "google/omni-video", modelLabel: "Veo", prompt: "video", images: [{ url: `/api/generations/${vid}/assets/abc124`, w: 1, h: 1 }], fileUrl: `/api/generations/${vid}/file` },
        ],
        nextCursor: null,
      });
    return json(404, {});
  };
  const used: string[] = [];
  render(h(AppRouterContext.Provider, { value: router }, h(Gallery, { onCreate: () => {}, onOtherModel: () => {}, onTool: (m: string, p: { url: string }) => void used.push(`${m} ${p.url}`) })));
  await settle();
  assert.ok(q(`[data-gallery-item="${img}"] [data-picture-tools]`), "a picture item has the tools");
  assert.ok(!q(`[data-gallery-item="${vid}"] [data-picture-tools]`), "a video item has none");
  await click(q(`[data-gallery-item="${img}"] [data-result-action="bgremove"]`));
  assert.deepEqual(used, [`bgremove /api/generations/${img}/assets/abc123`]);
});
