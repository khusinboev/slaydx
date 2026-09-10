import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within, act, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { TranslationForm } from "../../components/forms/TranslationForm.tsx";
import { TOOL_BY_ID, translationPrice, formatTanga, TRANSLATION_LANGUAGES } from "../../lib/tools.ts";

/**
 * Tarjimon formasi (Tarjimon 2, WP4): rejim, narx chip'i, ⇄, bir xil til,
 * uslub, fayl yuklash (fetch stub) → nom/belgi/narx, yuborishda
 * `sourceAssetId` bor va `sourceText` YO'Q, sudrab tashlash.
 */
afterEach(() => cleanup());

const pushes: string[] = [];
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push(u: string) { pushes.push(u); }, replace() {}, prefetch() {} };
const tool = TOOL_BY_ID.translation;

type Call = { url: string; method: string; body?: unknown };
function stubApi() {
  const calls: Call[] = [];
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    const body = typeof opts?.body === "string" ? JSON.parse(opts.body) : opts?.body;
    calls.push({ url, method, body });
    if (url === "/api/uploads/source" && method === "POST") {
      const f = (body as FormData).get("file") as File;
      return json(200, { assetId: "a".repeat(24), name: f.name, kind: "docx", size: f.size, chars: 12_345, text: "Olingan matn namunasi", truncatedPreview: false });
    }
    if (url.startsWith("/api/uploads/source/") && method === "DELETE") return json(200, { ok: true });
    if (url === "/api/generations" && method === "POST") return json(200, { id: "22222222-2222-4222-8222-222222222222", price: 5000 });
    return json(404, { error: "yo'q" });
  };
  return calls;
}

function mount() {
  render(h(AppRouterContext.Provider, { value: router }, h(TranslationForm, { tool })));
}
const price = () => (document.querySelector("[data-price-total]") as HTMLElement).textContent ?? "";
const chars = () => (document.querySelector("[data-chars]") as HTMLElement).textContent ?? "";
const textarea = () => screen.getByLabelText("Tarjima qilinadigan matn") as HTMLTextAreaElement;
const submitBtn = () => screen.getByRole("button", { name: new RegExp(`^${tool.submitLabel}`) });

test("standart: matn rejimi, 18 til ikkala tomonda + Avto, narx 3 000, ⇄ avto'da o'chiq, submit bo'sh matnda o'chiq", () => {
  stubApi();
  mount();
  assert.equal(within(screen.getByRole("radiogroup", { name: "Manba turi" })).getByRole("radio", { name: "Matn" }).getAttribute("aria-checked"), "true");
  const src = screen.getByLabelText("Manba tili") as HTMLSelectElement;
  const dst = screen.getByLabelText("Maqsad tili") as HTMLSelectElement;
  assert.equal(src.options.length, TRANSLATION_LANGUAGES.length + 1, "Avto + 18");
  assert.equal(dst.options.length, TRANSLATION_LANGUAGES.length, "18 maqsad");
  assert.ok(Array.from(dst.options).some((o) => o.value === "tr") && Array.from(dst.options).some((o) => o.value === "de"));
  assert.equal(price().trim(), formatTanga(3000));
  assert.equal((screen.getByRole("button", { name: "Tillarni almashtirish" }) as HTMLButtonElement).disabled, true);
  assert.equal((submitBtn() as HTMLButtonElement).disabled, true);
});

test("narx matn hajmidan: 9 999 → 3 000, 10 001 → 4 000; chegara oshsa amber + submit o'chiq", () => {
  stubApi();
  mount();
  fireEvent.change(textarea(), { target: { value: "a".repeat(9_999) } });
  assert.ok(price().replace(/\s/g, "").includes(formatTanga(translationPrice(9_999)).replace(/\s/g, "")));
  assert.ok(chars().includes("9 999"));
  fireEvent.change(textarea(), { target: { value: "a".repeat(10_001) } });
  assert.ok(price().replace(/\s/g, "").includes(formatTanga(4000).replace(/\s/g, "")), `narx: ${price()}`);
  assert.equal((submitBtn() as HTMLButtonElement).disabled, false);
  fireEvent.change(textarea(), { target: { value: "a".repeat(200_001) } });
  assert.equal((submitBtn() as HTMLButtonElement).disabled, true);
  assert.ok((document.querySelector("[data-chars]") as HTMLElement).className.includes("amber"));
});

test("⇄ tillarni almashtiradi; manba = maqsad bo'lsa xato va submit o'chiq; uslub tanlovi chipda ko'rinadi", () => {
  stubApi();
  mount();
  fireEvent.change(textarea(), { target: { value: "Salom dunyo, bu sinov matni." } });
  const src = screen.getByLabelText("Manba tili") as HTMLSelectElement;
  const dst = screen.getByLabelText("Maqsad tili") as HTMLSelectElement;
  fireEvent.change(src, { target: { value: "ru" } });
  fireEvent.change(dst, { target: { value: "en" } });
  fireEvent.click(screen.getByRole("button", { name: "Tillarni almashtirish" }));
  assert.equal((screen.getByLabelText("Manba tili") as HTMLSelectElement).value, "en");
  assert.equal((screen.getByLabelText("Maqsad tili") as HTMLSelectElement).value, "ru");
  fireEvent.change(screen.getByLabelText("Maqsad tili"), { target: { value: "en" } });
  assert.ok(screen.getByText("Manba va maqsad tili bir xil"));
  assert.equal((submitBtn() as HTMLButtonElement).disabled, true);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Uslub" })).getByRole("radio", { name: "Biznes" }));
  assert.ok((document.querySelector("[data-summary-chips]") as HTMLElement).textContent?.includes("Biznes"));
});

test("fayl rejimi: yuklash → nom · DOCX · belgi, narx serverdagi chars dan; yuborishda sourceAssetId bor, sourceText yo'q; Olib tashlash DELETE", async () => {
  const calls = stubApi();
  mount();
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Manba turi" })).getByRole("radio", { name: "Fayl" }));
  assert.ok(document.querySelector("[data-dropzone]"));
  const input = screen.getByLabelText("Fayl tanlash") as HTMLInputElement;
  const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], "hisobot.docx");
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
  await waitFor(() => assert.ok(document.querySelector("[data-upload]")));
  const box = document.querySelector("[data-upload]") as HTMLElement;
  assert.ok(box.textContent?.includes("hisobot.docx") && box.textContent?.includes("DOCX") && box.textContent?.includes("12 345"));
  assert.ok(price().replace(/\s/g, "").includes(formatTanga(translationPrice(12_345)).replace(/\s/g, "")), `narx: ${price()}`);
  assert.ok(screen.getByText(/Natija: DOCX/));
  await act(async () => {
    fireEvent.click(submitBtn());
  });
  await waitFor(() => assert.ok(calls.some((c) => c.url === "/api/generations")));
  const body = calls.find((c) => c.url === "/api/generations")!.body as { values: Record<string, unknown> };
  assert.equal(body.values.sourceAssetId, "a".repeat(24));
  assert.equal(body.values.mode, "file");
  assert.equal(body.values.sourceText, undefined, "fayl rejimida matn yuborilmaydi");
  assert.equal(body.values.style, "formal");
  assert.equal(pushes.at(-1), "/uz/files/22222222-2222-4222-8222-222222222222");
});

test("fayl olib tashlash → DELETE va zona qaytadi; sudrab tashlash yuklaydi; docx bo'lmagan kengaytma serverga bormaydi", async () => {
  const calls = stubApi();
  mount();
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Manba turi" })).getByRole("radio", { name: "Fayl" }));
  const zone = document.querySelector("[data-dropzone]") as HTMLElement;
  await act(async () => {
    fireEvent.drop(zone, { dataTransfer: { files: [new File([new Uint8Array(4)], "slayd.pptx")] } });
  });
  await waitFor(() => assert.ok(document.querySelector("[data-upload]")));
  assert.ok(calls.some((c) => c.url === "/api/uploads/source" && c.method === "POST"), "drop yuklaydi");
  fireEvent.click(screen.getByText("Olib tashlash"));
  await waitFor(() => assert.ok(calls.some((c) => c.method === "DELETE" && c.url.endsWith("a".repeat(24)))));
  assert.ok(document.querySelector("[data-dropzone]"));
  const posts = calls.filter((c) => c.method === "POST").length;
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Fayl tanlash"), { target: { files: [new File([new Uint8Array(4)], "rasm.png")] } });
  });
  assert.ok(screen.getByText(/Format qo‘llanmaydi/));
  assert.equal(calls.filter((c) => c.method === "POST").length, posts);
});
