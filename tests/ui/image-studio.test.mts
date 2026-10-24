import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ImageStudio } from "../../components/forms/ImageStudio.tsx";
import { CONFIRM_MIN_MS } from "../../components/overlays/useConfirmClick.ts";
import { TOOL_BY_ID, priceFor } from "../../lib/tools.ts";
import { IMAGE_CONDITIONAL_FIELDS, IMAGE_FORM_FIELDS, IMAGE_PROMPT_LIMIT } from "../../lib/generation/image-params.ts";
import { useAppStore } from "../../lib/store.ts";
import { formatSom } from "../../lib/format.ts";

/**
 * Rasm formasi (WP-E, Formalar 3) — jsdom, interaktiv xatti-harakat.
 *
 * Ilgari `ToolChrome`siz, o'z chizg'ichi bilan edi (1 359 px, etalon
 * nomuvofiqligi); endi kartalar + sticky narx (`ToolChrome`), har
 * parametr `data-field` bilan (`IMAGE_FORM_FIELDS` — qamrov shu yerda
 * ikki yo'nalishda tekshiriladi).
 */
afterEach(() => {
  cleanup();
  useAppStore.setState({ features: null });
});

/** The session's `features.imageModels` (the server filters by enabled provider + key). */
function offer(models: string[] | undefined) {
  useAppStore.setState({ features: { llm: true, images: true, telegram: false, telegramBot: null, devLogin: false, pdf: false, payments: { click: false, payme: false }, imageModels: models } });
}

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push: (u: string) => void pushes.push(u), replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.image;

type Call = { url: string; method: string; body?: unknown };
function stubApi() {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "44444444-4444-4444-8444-444444444444", price: 2000 });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

function mount() {
  pushes.length = 0;
  render(h(AppRouterContext.Provider, { value: router }, h(ImageStudio, { tool })));
}

test("har reyestr maydoni AYNAN bitta data-field bilan chiziladi (bezak maydon yo'q, ikki yo'nalishda)", () => {
  mount();
  const rendered = Array.from(document.querySelectorAll("[data-field]")).map((el) => el.getAttribute("data-field"));
  // Faqat Gemini (standart) holatda `model` chizilmaydi — shartli maydon (ikkinchi holat pastdagi testda).
  for (const id of IMAGE_FORM_FIELDS.filter((f) => !IMAGE_CONDITIONAL_FIELDS.includes(f))) assert.ok(rendered.includes(id), `reyestrda bor, formada yo'q: «${id}»`);
  for (const id of IMAGE_CONDITIONAL_FIELDS) assert.ok(!rendered.includes(id), `«${id}» bitta modelda yashirin bo'lishi kerak`);
  for (const id of rendered) assert.ok(IMAGE_FORM_FIELDS.includes(id!), `formada bor, reyestrda yo'q: «${id}»`);
  assert.equal(new Set(rendered).size, rendered.length, "har maydon faqat BITTA joyda");
});

test("sticky narx (data-price-total) standart holatda priceFor bilan bir xil (1 rasm = 2 000)", () => {
  mount();
  const el = document.querySelector("[data-price-total]");
  assert.ok(el, "sticky narx yo'q — ToolChrome ishlatilmagan bo'lishi mumkin");
  assert.equal(el!.textContent, formatSom(priceFor(tool, { imageCount: 1 })));
  assert.equal(el!.textContent, formatSom(2000));
});

test("«Nechta rasm» o'zgarsa narx DARHOL o'zgaradi (1→2 000, 2→3 500, 4→6 000) — ikkala narx ko'rsatkichi ham", () => {
  mount();
  const group = screen.getByRole("radiogroup", { name: "Nechta rasm" });
  fireEvent.click(within(group).getByRole("radio", { name: "2" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(3500));
  assert.equal(document.querySelector("[data-price]")!.textContent, formatSom(3500));
  fireEvent.click(within(group).getByRole("radio", { name: "4" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(6000));
  // MUTATSIYA: `priceFor` o'rniga qattiq yozilgan narx qaytarilsa — bu qator qizil bo'ladi.
  assert.notEqual(document.querySelector("[data-price-total]")!.textContent, formatSom(2000));
});

test("Tavsif — LimitedTextarea IMAGE_PROMPT_LIMIT dan uzun matnni kesadi, hisoblagich ko'rinadi", () => {
  mount();
  const textarea = screen.getByLabelText("Rasm tavsifi") as HTMLTextAreaElement;
  const long = "a".repeat(IMAGE_PROMPT_LIMIT + 50);
  fireEvent.change(textarea, { target: { value: long } });
  assert.equal(textarea.value.length, IMAGE_PROMPT_LIMIT);
  const counter = document.querySelector("[data-counter]");
  assert.ok(counter, "hisoblagich yo'q");
  assert.ok(counter!.textContent!.includes(String(IMAGE_PROMPT_LIMIT)), `hisoblagich chegarani ko'rsatishi kerak: ${counter!.textContent}`);
});

test("misol chip bosilsa tavsif maydoniga tushadi", () => {
  mount();
  const textarea = screen.getByLabelText("Rasm tavsifi") as HTMLTextAreaElement;
  assert.equal(textarea.value, "");
  fireEvent.click(screen.getByText("Registon maydoni erta tongda, tuman, keng kadr"));
  assert.equal(textarea.value, "Registon maydoni erta tongda, tuman, keng kadr");
});

test("qisqa tavsif bilan yuborilsa xato — generatsiya so'ralmaydi", async () => {
  const calls = stubApi();
  mount();
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  assert.ok(screen.getByText("Nima chizish kerakligini yozing"));
  assert.equal(calls.filter((c) => c.url === "/api/generations").length, 0, "xato holatda so'rov ketmasligi kerak");
});

test("yetarli tavsif bilan yuborilsa generatsiya so'raladi va natija sahifasiga o'tadi", async () => {
  const calls = stubApi();
  mount();
  const textarea = screen.getByLabelText("Rasm tavsifi") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: "Registon maydoni erta tongda" } });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => {
    assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST"));
  });
  const body = calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, string> };
  assert.equal(body.values.prompt, "Registon maydoni erta tongda");
  await waitFor(() => assert.equal(pushes.length, 1));
  assert.ok(pushes[0].startsWith("/uz/files/"));
});

test("▸ Sozlamalar yopiq details ichida — «Formani tozalash» ikki bosqichli tasdiq bilan tozalaydi", async () => {
  mount();
  const d = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(d, "Sozlamalar details bo'lishi kerak");
  assert.equal(d.open, false, "standart holatda yopiq");
  const textarea = screen.getByLabelText("Rasm tavsifi") as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: "Registon maydoni erta tongda" } });
  const btn = screen.getByText("Formani tozalash");
  fireEvent.click(btn);
  assert.equal(textarea.value, "Registon maydoni erta tongda", "birinchi bosish faqat ogohlantiradi");
  // FE-07: tasdiq qo'sh bosish emas — ongli ikkinchi bosish.
  await new Promise((r) => setTimeout(r, CONFIRM_MIN_MS + 30));
  fireEvent.click(screen.getByText(/Ishonchingiz komilmi/));
  assert.equal(textarea.value, "", "ikkinchi bosishda forma tozalanadi");
});

// ───────────────────────────── model tanlovi (program-17 item 5)

/** «Nechta rasm» qatorining ⓘ izohi (bo'shliqlar normallashtirilgan). */
const countHint = () => (document.querySelector('[title*="1 rasm"]')?.getAttribute("title") ?? "").replace(/\s/g, " ");
const modelGroup = () => screen.queryByRole("radiogroup", { name: "Model" });
const bodyOf = (calls: Call[]) => calls.find((c) => c.url === "/api/generations" && c.method === "POST")!.body as { values: Record<string, unknown> };

async function submitWith(calls: Call[], text = "Registon maydoni erta tongda") {
  fireEvent.change(screen.getByLabelText("Rasm tavsifi") as HTMLTextAreaElement, { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByText(tool.submitLabel));
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations" && c.method === "POST")));
  return bodyOf(calls);
}

test("model: sessiya yuklanmagan yoki faqat Gemini — tanlagich YO'Q, forma va so'rov avvalgidek (parity)", async () => {
  for (const models of [undefined, ["gemini"]]) {
    cleanup();
    offer(models);
    if (models === undefined) useAppStore.setState({ features: null });
    const calls = stubApi();
    mount();
    assert.ok(!modelGroup(), "tanlagich yashirin");
    assert.ok(!document.querySelector('[data-field="model"]'));
    assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(2000));
    assert.equal(countHint(), "1 rasm 2 000 · 2 rasm 3 500 · 4 rasm 6 000", "narx izohi avvalgi matn bilan bir xil");
    const body = await submitWith(calls);
    assert.ok(!("model" in body.values), "yuborilgan qiymatlarda `model` kaliti yo'q — avvalgi so'rov bilan bir xil");
    assert.equal(body.values.imageCount, 1);
  }
});

test("model: ikki model bor — tanlagich chiziladi, standart Gemini, har reyestr maydoni bitta data-field", () => {
  offer(["gemini", "openai"]);
  mount();
  const group = modelGroup();
  assert.ok(group, "tanlagich ko'rinishi kerak");
  const radios = within(group!).getAllByRole("radio");
  assert.deepEqual(radios.map((r) => r.textContent), ["Nano Banana (Google Gemini)", "ChatGPT (OpenAI gpt-image)"]);
  assert.equal(within(group!).getByRole("radio", { name: "Nano Banana (Google Gemini)" }).getAttribute("aria-checked"), "true");
  const rendered = Array.from(document.querySelectorAll("[data-field]")).map((el) => el.getAttribute("data-field"));
  assert.deepEqual([...rendered].sort(), [...IMAGE_FORM_FIELDS].sort(), "ikki yo'nalishda to'liq qamrov");
  assert.equal(new Set(rendered).size, rendered.length);
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(2000));
});

test("model: ChatGPT tanlansa narx va izoh DARHOL o'zgaradi (4 000 / 7 000 / 12 000) va so'rovga `model: openai` ketadi", async () => {
  offer(["gemini", "openai"]);
  const calls = stubApi();
  mount();
  fireEvent.click(within(modelGroup()!).getByRole("radio", { name: "ChatGPT (OpenAI gpt-image)" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(priceFor(tool, { model: "openai" })));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(4000));
  assert.equal(countHint(), "1 rasm 4 000 · 2 rasm 7 000 · 4 rasm 12 000");
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nechta rasm" })).getByRole("radio", { name: "4" }));
  assert.equal(document.querySelector("[data-price]")!.textContent, formatSom(12000));
  const body = await submitWith(calls);
  assert.equal(body.values.model, "openai");
  assert.equal(body.values.imageCount, 4);
  // Gemini'ga qaytsa narx ham qaytadi.
  fireEvent.click(within(modelGroup()!).getByRole("radio", { name: "Nano Banana (Google Gemini)" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(6000));
});

test("model: faqat ChatGPT mavjud (Gemini o'chiq) — tanlagich yo'q, lekin forma ChatGPT narxi bilan `model: openai` yuboradi", async () => {
  offer(["openai"]);
  const calls = stubApi();
  mount();
  assert.ok(!modelGroup());
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(4000));
  const body = await submitWith(calls);
  assert.equal(body.values.model, "openai", "yagona mavjud model serverga aniq aytiladi");
});

test("model: tanlangan model ro'yxatdan chiqib ketsa (sessiya yangilandi) forma birinchi mavjudiga qaytadi", () => {
  offer(["gemini", "openai"]);
  mount();
  fireEvent.click(within(modelGroup()!).getByRole("radio", { name: "ChatGPT (OpenAI gpt-image)" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(4000));
  act(() => offer(["gemini"]));
  assert.ok(!modelGroup());
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatSom(2000), "Gemini narxi va tanlagichsiz forma");
});
