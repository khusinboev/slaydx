import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup, within } from "@testing-library/react";
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
