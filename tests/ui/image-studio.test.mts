import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, act, waitFor, within } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { ImageStudio } from "../../components/forms/ImageStudio.tsx";
import { TOOL_BY_ID, priceFor, formatTanga } from "../../lib/tools.ts";
import { IMAGE_FORM_FIELDS, IMAGE_PROMPT_LIMIT } from "../../lib/generation/image-params.ts";

/**
 * Rasm formasi (WP-E, Formalar 3) — jsdom, interaktiv xatti-harakat.
 *
 * Ilgari `ToolChrome`siz, o'z chizg'ichi bilan edi (1 359 px, etalon
 * nomuvofiqligi); endi kartalar + sticky narx (`ToolChrome`), har
 * parametr `data-field` bilan (`IMAGE_FORM_FIELDS` — qamrov shu yerda
 * ikki yo'nalishda tekshiriladi).
 */
afterEach(() => cleanup());

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
  for (const id of IMAGE_FORM_FIELDS) assert.ok(rendered.includes(id), `reyestrda bor, formada yo'q: «${id}»`);
  for (const id of rendered) assert.ok(IMAGE_FORM_FIELDS.includes(id!), `formada bor, reyestrda yo'q: «${id}»`);
  assert.equal(new Set(rendered).size, rendered.length, "har maydon faqat BITTA joyda");
});

test("sticky narx (data-price-total) standart holatda priceFor bilan bir xil (1 rasm = 2 000)", () => {
  mount();
  const el = document.querySelector("[data-price-total]");
  assert.ok(el, "sticky narx yo'q — ToolChrome ishlatilmagan bo'lishi mumkin");
  assert.equal(el!.textContent, formatTanga(priceFor(tool, { imageCount: 1 })));
  assert.equal(el!.textContent, formatTanga(2000));
});

test("«Nechta rasm» o'zgarsa narx DARHOL o'zgaradi (1→2 000, 2→3 500, 4→6 000) — ikkala narx ko'rsatkichi ham", () => {
  mount();
  const group = screen.getByRole("radiogroup", { name: "Nechta rasm" });
  fireEvent.click(within(group).getByRole("radio", { name: "2" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatTanga(3500));
  assert.equal(document.querySelector("[data-price]")!.textContent, formatTanga(3500));
  fireEvent.click(within(group).getByRole("radio", { name: "4" }));
  assert.equal(document.querySelector("[data-price-total]")!.textContent, formatTanga(6000));
  // MUTATSIYA: `priceFor` o'rniga qattiq yozilgan narx qaytarilsa — bu qator qizil bo'ladi.
  assert.notEqual(document.querySelector("[data-price-total]")!.textContent, formatTanga(2000));
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
  fireEvent.click(screen.getByText(/Ishonchingiz komilmi/));
  assert.equal(textarea.value, "", "ikkinchi bosishda forma tozalanadi");
});
