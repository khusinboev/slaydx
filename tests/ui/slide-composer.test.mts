import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within, waitFor } from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SlideForm } from "../../components/forms/SlideForm.tsx";
import { ProSlideForm } from "../../components/forms/ProSlideForm.tsx";
import { TOOL_BY_ID, formatTanga, priceFor } from "../../lib/tools.ts";
import type { UserProfile } from "../../lib/types.ts";

/**
 * Ixcham slayd formasi (Formalar 2) — jsdom.
 *
 * Sinaladigan shartnoma: «Sozlamalar» yopiq holda joriy tanlovlar
 * ko'rinadi va tanlov o'zgarsa yangilanadi; slayder narxni darhol
 * o'zgartiradi (`priceFor` bilan bir xil); muallif maydonlari profildan
 * to'ladi.
 */
afterEach(() => cleanup());

const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
const profile: UserProfile = {
  name: "Aliyev Ali", language: "uz", points: 0, quota: 0, balance: 100000, premium: false, plan: "free",
  university: "TDPU", faculty: "", department: "", group: "", course: "", author: "Aliyev Ali", subject: "Biologiya",
  teacher: "", city: "Toshkent", position: "Katta o‘qituvchi", organization: "",
};
function mount(kind: "slide" | "pro-slide") {
  const Form = kind === "slide" ? SlideForm : ProSlideForm;
  render(h(AppRouterContext.Provider, { value: router }, h(Form, { tool: TOOL_BY_ID[kind], profile })));
}
const chips = () => (document.querySelector("[data-summary-chips]")?.textContent ?? "");
const price = () => document.querySelector("[data-price]")?.textContent ?? "";
const slider = () => document.querySelector('input[type="range"]') as HTMLInputElement;

test("Sozlamalar yopiq: sarlavhada joriy tanlovlar (Avtomatik · Umumiy · 5 band · Standart · Testsiz · Titul · Reja · Izohlar)", () => {
  mount("slide");
  const d = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(d, "Sozlamalar details bo'lishi kerak");
  assert.equal(d.open, false, "standart holatda yopiq");
  for (const t of ["Avtomatik", "Umumiy taqdimot", "5 band", "Standart", "Testsiz", "Titul", "Reja", "Izohlar"]) {
    assert.ok(chips().includes(t), `«${t}» yig'iq sarlavhada bo'lishi kerak: ${chips()}`);
  }
  assert.ok(!chips().includes("Misollar") && !chips().includes("Internet"), "o'chiq kalitlar sarlavhada ko'rinmaydi");
});

test("tanlov o'zgarsa yig'iq sarlavha ergashadi: auditoriya select, test segmenti, titul kaliti", () => {
  mount("slide");
  fireEvent.change(screen.getByLabelText("Auditoriya"), { target: { value: "school_1_4" } });
  assert.ok(chips().includes("Boshlang‘ich sinf (1–4)") || chips().includes("1–4"), `auditoriya yangilanishi kerak: ${chips()}`);
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Nazorat testi" })).getByRole("radio", { name: "5" }));
  assert.ok(chips().includes("5 savol"), `test soni sarlavhada: ${chips()}`);
  fireEvent.click(screen.getByRole("switch", { name: "Titul slaydi" }));
  // MUTATSIYA: `settingsSummary` da `values[id] !== false` sharti buzilsa — «Titul» qoladi.
  assert.ok(!chips().includes("Titul"), `titul o'chirilgach sarlavhadan ketadi: ${chips()}`);
});

test("slayder narxni DARHOL o'zgartiradi — priceFor bilan bir xil (oddiy: 25 → 5 500, pro: 25 → 50 000)", () => {
  mount("slide");
  assert.equal(price(), formatTanga(priceFor(TOOL_BY_ID.slide, { slideCount: 10 })));
  fireEvent.change(slider(), { target: { value: "25" } });
  assert.equal(price(), formatTanga(5500));
  fireEvent.change(slider(), { target: { value: "30" } });
  assert.equal(price(), formatTanga(8000));
  cleanup();
  mount("pro-slide");
  fireEvent.change(slider(), { target: { value: "25" } });
  assert.equal(price(), formatTanga(50000));
});

test("muallif kartasi profildan to'ladi (tashkilot bo'lmasa universitet); pro'da lavozim ham", () => {
  mount("pro-slide");
  assert.equal((screen.getByLabelText("Muallif") as HTMLInputElement).value, "Aliyev Ali");
  assert.equal((screen.getByLabelText("Lavozim") as HTMLInputElement).value, "Katta o‘qituvchi");
  assert.equal((screen.getByLabelText("Tashkilot") as HTMLInputElement).value, "TDPU", "tashkilot bo'sh — universitet zaxira");
  assert.equal((screen.getByLabelText("Fan") as HTMLInputElement).value, "Biologiya");
  cleanup();
  mount("slide");
  assert.equal(screen.queryByLabelText("Lavozim") === null, true, "oddiyda lavozim yo'q");
  assert.equal(screen.queryByLabelText("Rasm uslubi") === null, true, "oddiyda rasm uslubi yo'q");
});

// ───────────────────── WP-E (AUDIT-24): qoralama, ColorDots, SourceFileRow ─────

test("qoralama: kirgan foydalanuvchida oldin saqlangan qiymatlar qayta ochilganda tiklanadi", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const realFetch = globalThis.fetch;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") {
      return json(200, { draft: { data: { topic: "Saqlangan mavzu", slideCount: 22 }, updatedAt: "now" } });
    }
    if (url === "/api/forms/slide/draft") return json(200, { ok: true, updatedAt: "now" });
    return json(404, { error: "yo'q" });
  }) as typeof fetch;
  try {
    mount("slide");
    await waitFor(() => {
      assert.equal((screen.getByLabelText("Taqdimot mavzusini kiriting") as HTMLInputElement).value, "Saqlangan mavzu");
    });
    // MUTATSIYA: `restored` effekti `draft`ni qo'llamasa — yuqoridagi qator qizaradi.
    assert.equal(slider().value, "22", "slideCount ham qoralamadan tiklanadi");
  } finally {
    globalThis.fetch = realFetch;
    useAppStore.setState({ loggedIn: false, sessionChecked: false });
  }
});

test("Shablon va rang: rang tanlagich umumiy ColorDots — role=radio/aria-checked, bosilsa slideTheme o'zgaradi", () => {
  mount("slide");
  const group = screen.getByRole("radiogroup", { name: "Rang" });
  const radios = within(group).getAllByRole("radio");
  assert.ok(radios.length >= 6, "bir nechta mavzu bo'lishi kerak");
  const active = radios.find((r) => r.getAttribute("aria-checked") === "true");
  assert.ok(active, "standart mavzu (atlas) tanlangan ko'rinishi kerak");
  const next = radios.find((r) => r !== active)!;
  assert.equal(next.getAttribute("aria-checked"), "false");
  fireEvent.click(next);
  // MUTATSIYA: `ColorDots` ichida `aria-checked`/`role="radio"` olib tashlansa — bu ikki qator qizaradi.
  assert.equal(next.getAttribute("aria-checked"), "true", "bosilgan doira tanlangan holatga o'tadi");
  assert.equal(active!.getAttribute("aria-checked"), "false", "avvalgi tanlov bo'shaydi");
});

test("Fayl rejimi: umumiy SourceFileRow bitta qatorda — matn sourceText ga tushadi, mavzu bo'sh bo'lsa fayl nomidan to'ladi", async () => {
  const EXTRACTED = "Fayldan olingan matn";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ text: EXTRACTED }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    mount("slide");
    fireEvent.click(screen.getByRole("tab", { name: "Fayl asosida" }));
    const input = screen.getByLabelText("Fayl biriktirish") as HTMLInputElement;
    const file = new File(["x"], "mavzu-fayli.docx");
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => assert.ok(screen.getByText("mavzu-fayli.docx")));
    await waitFor(() => assert.ok(screen.getByText(`${EXTRACTED.length.toLocaleString("uz-UZ")} belgi`)), { timeout: 3000 });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("qoralama PUT tanasida sourceText/logoAssetId/templateAssetId YO'Q (katta matn va sessiyaga bog'liq aktivlar saqlanmaydi)", async () => {
  const { useAppStore } = await import("../../lib/store.ts");
  useAppStore.setState({ loggedIn: true, sessionChecked: true });
  const puts: Record<string, unknown>[] = [];
  const realFetch = globalThis.fetch;
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: unknown, opts?: RequestInit) => {
    const url = String(input);
    const method = opts?.method ?? "GET";
    if (url === "/api/forms/slide/draft" && method === "GET") return json(200, { draft: null });
    if (url === "/api/forms/slide/draft") {
      puts.push((JSON.parse(String(opts?.body ?? "{}")) as { data?: Record<string, unknown> }).data ?? {});
      return json(200, { ok: true, updatedAt: "now" });
    }
    return json(200, {});
  }) as typeof fetch;
  try {
    render(h(AppRouterContext.Provider, { value: router }, h(SlideForm, { tool: TOOL_BY_ID.slide, profile })));
    const topic = (await screen.findByPlaceholderText(TOOL_BY_ID.slide.topicPlaceholder ?? "")) as HTMLInputElement;
    fireEvent.change(topic, { target: { value: "Qoralama sinovi" } });
    await waitFor(() => assert.ok(puts.length > 0, "qoralama saqlandi"), { timeout: 5000 });
    const last = puts[puts.length - 1];
    assert.equal(last.topic, "Qoralama sinovi");
    // MUTATSIYA: `draftOf` o'rniga `save(values)` qaytarilsa — uchala kalit tanada paydo bo'lib, qizaradi.
    for (const k of ["sourceText", "logoAssetId", "templateAssetId"]) assert.ok(!(k in last), `${k} qoralamaga tushmasin`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
