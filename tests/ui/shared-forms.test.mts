import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { render, fireEvent, screen, cleanup, waitFor } from "@testing-library/react";
import {
  AuthorRows,
  ClearFormButton,
  ColorDots,
  Field,
  LimitedTextarea,
  RangeRow,
  SettingsDetails,
  SourceFileRow,
  TopicRow,
} from "../../components/forms/shared/index.tsx";
import { formatTanga } from "../../lib/tools.ts";

/**
 * FORMALAR 3 (AUDIT-24 R0) — umumiy forma bo'laklari.
 *
 * Bu bo'laklar 17 forma tomonidan ishlatiladi; ularning shartnomasi
 * buzilsa hamma forma birdan buziladi. Shuning uchun har birining
 * ASOSIY va'dasi shu yerda qulflanadi:
 *   • SettingsDetails — yopiq keladi, chevron bor, xulosa chiplari bo'sh
 *     qiymatlarni tashlaydi, boshqariladigan rejim `onToggle` chaqiradi;
 *   • Field — `data-field` zond belgisi;
 *   • TopicRow/LimitedTextarea — limitdan uzun matn KESILADI va
 *     hisoblagich ko'rinadi;
 *   • AuthorRows — har id uchun `data-field`, majburiylar «*» bilan,
 *     vositaga xos yorliq;
 *   • SourceFileRow — katta fayl rad etiladi (fetch chaqirilmaydi),
 *     muvaffaqiyatda `sourceText` va belgi soni ko'rinadi;
 *   • RangeRow — qiymat/narx ko'rsatiladi, narx hisoblanmaydi (berilgan
 *     raqam aynan chiqadi), o'zgarish `onChange` ga boradi;
 *   • ColorDots/ClearFormButton — ARIA holati va ikki bosqichli matn.
 *
 * Mutatsiyalar (har biri qizardi): SettingsDetails dan chevron/xulosa
 * olib tashlandi; LimitedTextarea `.slice` siz; AuthorRows `data-field`
 * siz.
 */
afterEach(() => cleanup());

test("SettingsDetails: yopiq keladi, chevron va xulosa chiplari (bo'shlar tashlanadi); ochilganda onToggle", () => {
  const seen: boolean[] = [];
  render(h(SettingsDetails, { summary: ["10 bet", "", null, "vizualsiz"], onToggle: (o) => seen.push(o) }, h("p", null, "ichki")));
  const details = document.querySelector("details[data-settings]") as HTMLDetailsElement;
  assert.ok(details, "details bor");
  assert.equal(details.open, false, "yopiq keladi");
  assert.ok(details.querySelector("summary span[aria-hidden]"), "chevron belgisi bor");
  const chips = [...details.querySelectorAll("[data-summary-chips] span")].map((s) => s.textContent);
  assert.deepEqual(chips, ["10 bet", "vizualsiz"], "bo'sh qiymatlar chiplarga chiqmaydi");
  details.open = true;
  fireEvent(details, new window.Event("toggle"));
  assert.deepEqual(seen, [true], "onToggle ochilishni bildiradi");
});

test("SettingsDetails: boshqariladigan rejim `open` ni hurmat qiladi", () => {
  render(h(SettingsDetails, { summary: [], open: true }, h("p", null, "ichki")));
  assert.equal((document.querySelector("details[data-settings]") as HTMLDetailsElement).open, true);
  assert.ok(!document.querySelector("[data-summary-chips]"), "xulosa bo'sh bo'lsa chip konteyneri chizilmaydi");
});

test("Field: data-field zond belgisi", () => {
  render(h(Field, { id: "topic" }, h("input", { "aria-label": "x" })));
  assert.ok(document.querySelector('[data-field="topic"] input'));
});

test("TopicRow: limitdan uzun matn kesiladi, hisoblagich ko'rinadi", () => {
  let got = "";
  render(h(TopicRow, { value: "abc", onChange: (v) => (got = v), limit: 5, placeholder: "Mavzu" }));
  const input = screen.getByPlaceholderText("Mavzu") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "abcdefgh" } });
  assert.equal(got, "abcde", "5 belgida kesildi");
  assert.equal(document.querySelector("[data-counter]")?.textContent, "3 / 5");
  assert.ok(document.querySelector('[data-field="topic"]'), "zond belgisi bor");
});

test("LimitedTextarea: slice + hisoblagich, chegaraga yaqin rang", () => {
  function Wrap() {
    const [v, setV] = useState("");
    return h(LimitedTextarea, { value: v, onChange: setV, limit: 10, ariaLabel: "Qo'shimcha" });
  }
  render(h(Wrap));
  const ta = screen.getByLabelText("Qo'shimcha") as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: "0123456789ABC" } });
  assert.equal(ta.value, "0123456789", "10 belgida kesildi");
  const counter = document.querySelector("[data-counter]") as HTMLElement;
  assert.equal(counter.textContent, "10 / 10");
  assert.match(counter.className, /amber/, "chegarada ogohlantirish rangi");
});

test("AuthorRows: har id uchun data-field, majburiy «*», vositaga xos yorliq", () => {
  const values = { university: "TDIU", author: "Aliyev" };
  const set: string[] = [];
  render(
    h(AuthorRows, {
      ids: ["university", "author", "city"],
      values,
      set: (id, v) => set.push(`${id}=${v}`),
      required: ["university", "author"],
      labels: { university: "Muassasa" },
    }),
  );
  for (const id of ["university", "author", "city"]) assert.ok(document.querySelector(`[data-field="${id}"] input`), `${id} chizildi`);
  assert.ok(screen.getByText("Muassasa *"), "vositaga xos yorliq + majburiy belgisi");
  assert.ok(screen.getByText("Muallif *"));
  assert.ok(screen.getByText("Shahar"), "ixtiyoriy — yulduzchasiz");
  fireEvent.change(screen.getByPlaceholderText("Toshkent"), { target: { value: "Samarqand" } });
  assert.deepEqual(set, ["city=Samarqand"]);
});

test("SourceFileRow: katta fayl rad etiladi (fetch chaqirilmaydi); muvaffaqiyatda matn va belgi soni", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ text: "Salom dunyo" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    function Wrap() {
      const [v, setV] = useState({ fileName: "", sourceText: "" });
      return h(SourceFileRow, { value: v, onChange: setV });
    }
    render(h(Wrap));
    const input = screen.getByLabelText("Fayl") as HTMLInputElement;
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "katta.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [big] } });
    assert.ok(await screen.findByText(/MB dan katta/), "katta fayl xatosi");
    assert.equal(calls.length, 0, "fetch chaqirilmadi");

    const ok = new File(["x"], "manba.docx");
    fireEvent.change(input, { target: { files: [ok] } });
    await waitFor(() => assert.ok(screen.getByText("manba.docx")));
    await waitFor(() => assert.ok(screen.getByText(/11 belgi/)), "belgi soni ko'rinadi");
    assert.equal(calls.length, 1);
    assert.ok(screen.getByText("Olib tashlash"));
    assert.ok(document.querySelector('[data-field="sourceText"]'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("RangeRow: qiymat formatlanadi, narx AYNAN berilganicha chiqadi, slayder onChange", () => {
  let got = 0;
  render(h(RangeRow, { label: "Hajm", id: "pages", value: 20, min: 10, max: 45, onChange: (v) => (got = v), format: (v) => `${v} bet`, price: 16000, rule: "10 betgacha 12 000" }));
  assert.equal(document.querySelector("[data-range-value]")?.textContent, "20 bet");
  assert.equal(document.querySelector("[data-price]")?.textContent, formatTanga(16000), "narx priceFor natijasi bilan bir xil formatda");
  assert.equal(document.querySelector("[data-price-rule]")?.textContent, "10 betgacha 12 000");
  fireEvent.change(screen.getByLabelText("Hajm"), { target: { value: "30" } });
  assert.equal(got, 30);
  assert.ok(document.querySelector('[data-field="pages"]'));
});

test("ColorDots: radiogroup, tanlangan aria-checked, bosish onChange", () => {
  let got = "";
  render(h(ColorDots, { options: [{ id: "a", hex: "#f00", label: "Qizil" }, { id: "b", hex: "#00f", label: "Ko'k" }], value: "a", onChange: (v) => (got = v) }));
  assert.equal(screen.getByLabelText("Qizil").getAttribute("aria-checked"), "true");
  assert.equal(screen.getByLabelText("Ko'k").getAttribute("aria-checked"), "false");
  fireEvent.click(screen.getByLabelText("Ko'k"));
  assert.equal(got, "b");
});

test("ClearFormButton: ikki bosqichli matn", () => {
  const { rerender } = render(h(ClearFormButton, { armed: false, onClick() {} }));
  assert.equal(document.querySelector("[data-clear-form]")?.textContent, "Formani tozalash");
  rerender(h(ClearFormButton, { armed: true, onClick() {} }));
  assert.match(document.querySelector("[data-clear-form]")?.textContent ?? "", /Yana bosing/);
});
