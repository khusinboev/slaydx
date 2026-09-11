import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, useState } from "react";
import { render, fireEvent, screen, cleanup, within } from "@testing-library/react";
import { PhoneInput } from "../../components/forms/PhoneInput.tsx";
import { Combobox } from "../../components/forms/Combobox.tsx";
import { MonthPicker } from "../../components/forms/MonthPicker.tsx";
import { YearPicker } from "../../components/forms/YearPicker.tsx";
import { RowList, reorder } from "../../components/forms/RowList.tsx";
import { searchProfessions } from "../../lib/professions.ts";

/**
 * Rezyume formasi primitivlari (Rezyume 2): telefon formatlash, kasb
 * tavsiyasi (chip bilan), oy/yil tanlagich, satrlar ro'yxati.
 *
 * jsdom da klaviatura va bosish hodisalari sinaladi — SSR testi buni
 * ko'rmaydi (`↓ Enter` bilan tanlash, chipni bosib olib tashlash).
 */
afterEach(() => cleanup());

const suggest = (q: string) => searchProfessions(q, 6).map((m) => ({ id: m.id, label: m.label }));

function Harness<T>({ initial, render: r }: { initial: T; render: (v: T, set: (v: T) => void) => React.ReactNode }) {
  const [v, setV] = useState<T>(initial);
  return h("div", null, r(v, setV));
}

test("PhoneInput: raqam yozilganda + va guruhlar o'zi qo'yiladi, tashqariga normal shakl chiqadi", () => {
  const seen: string[] = [];
  render(
    h(Harness<string>, {
      initial: "",
      render: (v, set) =>
        h(PhoneInput, {
          value: v,
          onChange: (x: string) => {
            seen.push(x);
            set(x);
          },
        }),
    }),
  );
  const input = screen.getByLabelText("Telefon") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "998901234567" } });
  assert.equal(input.value, "+998 90 123 45 67", "ekranda guruhlangan");
  assert.equal(seen.at(-1), "+998901234567", "tashqariga normal shakl");
  // Bo'shliqli qo'yib yozish ham bir xil natija beradi.
  fireEvent.change(input, { target: { value: "+998 71 200 00 00" } });
  assert.equal(seen.at(-1), "+998712000000");
});

test("Combobox: yozilgan matn bo'yicha tavsiya, ↓ Enter bilan tanlash", () => {
  render(
    h(Harness<string>, {
      initial: "",
      render: (v, set) => h(Combobox, { value: v, onChange: set, suggest, ariaLabel: "Lavozim", placeholder: "Lavozim" }),
    }),
  );
  const input = screen.getByLabelText("Lavozim") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "бухг" } });
  const list = screen.getByRole("listbox");
  const options = within(list).getAllByRole("option");
  assert.ok(options.length >= 1, "tavsiya chiqadi");
  assert.match(options[0].textContent ?? "", /Buxgalter/i);
  assert.equal(input.getAttribute("aria-expanded"), "true");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.match(input.value, /Buxgalter/i, "tanlangan variant maydonga tushdi");
});

test("Combobox multi: Enter bilan o'z matnini qo'shadi, chipni bosib olib tashlaydi", () => {
  render(
    h(Harness<string[]>, {
      initial: [],
      render: (v, set) => h(Combobox, { multi: true, value: v, onChange: set, suggest, ariaLabel: "Ko'nikmalar" }),
    }),
  );
  const input = screen.getByLabelText("Ko'nikmalar") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "IFRS" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(input, { key: "Enter" });
  let chips = document.querySelectorAll("[data-combo-chip]");
  assert.equal(chips.length, 1);
  assert.match(chips[0].textContent ?? "", /IFRS/);
  // Ro'yxatda bo'lmagan matn ham qabul qilinadi — ro'yxat cheklov emas.
  fireEvent.change(input, { target: { value: "Sun'iy intellekt" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.keyDown(input, { key: "Enter" });
  assert.equal(document.querySelectorAll("[data-combo-chip]").length, 2);
  // Chipni bosish uni olib tashlaydi.
  fireEvent.click(document.querySelectorAll("[data-combo-chip]")[0]);
  chips = document.querySelectorAll("[data-combo-chip]");
  assert.equal(chips.length, 1);
  assert.match(chips[0].textContent ?? "", /intellekt/);
  // Bo'sh maydonda Backspace oxirgi chipni oladi.
  fireEvent.keyDown(input, { key: "Backspace" });
  assert.equal(document.querySelectorAll("[data-combo-chip]").length, 0);
});

test("MonthPicker: oy+yil «YYYY-MM», faqat yil «YYYY», «hozir» — now", () => {
  const seen: string[] = [];
  render(
    h(Harness<string>, {
      initial: "",
      render: (v, set) =>
        h(MonthPicker, {
          label: "Boshlanish",
          value: v,
          allowNow: true,
          onChange: (x: string) => {
            seen.push(x);
            set(x);
          },
        }),
    }),
  );
  fireEvent.change(screen.getByLabelText("Boshlanish — yil"), { target: { value: "2021" } });
  assert.equal(seen.at(-1), "2021", "faqat yil");
  fireEvent.change(screen.getByLabelText("Boshlanish — oy"), { target: { value: "03" } });
  assert.equal(seen.at(-1), "2021-03");
  fireEvent.click(screen.getByLabelText("Hozir ishlayman"));
  assert.equal(seen.at(-1), "now");
  // «Hozir» yoqilganda sana tanlagichlari o'chadi.
  assert.equal((screen.getByLabelText("Boshlanish — yil") as HTMLSelectElement).disabled, true);
});

test("YearPicker: OY YO'Q — qiymat «YYYY», «hozir» tumbleri tugash yilini o'chiradi", () => {
  /*
   * AUDIT-16: ta'lim va sertifikat sanasida oy so'ralmaydi. Test aynan
   * shuni qulflaydi: tanlagichda oy `<select>` i BO'LMASLIGI kerak.
   */
  const seen: string[] = [];
  render(
    h(Harness<string>, {
      initial: "",
      render: (v, set) =>
        h(YearPicker, {
          label: "Tugash yili",
          value: v,
          allowNow: true,
          onChange: (x: string) => {
            seen.push(x);
            set(x);
          },
        }),
    }),
  );
  assert.ok(!screen.queryByLabelText("Tugash yili — oy"), "oy tanlagichi bo'lmasligi kerak");
  assert.equal(document.querySelectorAll("select").length, 1, "bitta tanlagich — faqat yil");
  const year = screen.getByLabelText("Tugash yili") as HTMLSelectElement;
  fireEvent.change(year, { target: { value: "2019" } });
  assert.equal(seen.at(-1), "2019", "qiymat «YYYY»");
  // Ro'yxat 1960 dan joriy+6 gacha.
  const values = Array.from(year.options).map((o) => o.value).filter(Boolean);
  assert.equal(values[0], String(new Date().getFullYear() + 6), "eng yangi yil boshida");
  assert.equal(values.at(-1), "1960");
  fireEvent.click(screen.getByLabelText("Hozir o‘qiyapman"));
  assert.equal(seen.at(-1), "now");
  assert.equal((screen.getByLabelText("Tugash yili") as HTMLSelectElement).disabled, true, "«hozir» da yil tanlanmaydi");
  // Bo'sh variant qiymatni tozalaydi.
  fireEvent.click(screen.getByLabelText("Hozir o‘qiyapman"));
  fireEvent.change(screen.getByLabelText("Tugash yili"), { target: { value: "" } });
  assert.equal(seen.at(-1), "");
});

test("YearPicker: «hozir» siz (sertifikat) tumbler umuman chizilmaydi", () => {
  render(h(YearPicker, { label: "Sertifikat yili", value: "2021", onChange: () => {} }));
  assert.equal((screen.getByLabelText("Sertifikat yili") as HTMLSelectElement).value, "2021");
  assert.equal(document.querySelectorAll('[role="switch"]').length, 0, "sertifikat «hozir» olinmaydi");
});

test("RowList: qo'shish, tartib almashtirish va o'chirish satr ma'lumotini saqlaydi", () => {
  type Row = { id: string; title: string };
  render(
    h(Harness<Row[]>, {
      initial: [
        { id: "a", title: "Birinchi" },
        { id: "b", title: "Ikkinchi" },
      ],
      render: (rows, set) =>
        h(RowList<Row>, {
          name: "test",
          rows,
          onChange: set,
          max: 4,
          addLabel: "Satr",
          add: () => ({ id: "c", title: "Uchinchi" }),
          render: (row, set2) =>
            h("input", {
              "aria-label": `title-${row.id}`,
              value: row.title,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => set2({ title: e.target.value }),
            }),
        }),
    }),
  );
  assert.equal(document.querySelectorAll("[data-row]").length, 2);
  fireEvent.click(screen.getByText("+ Satr"));
  assert.equal(document.querySelectorAll("[data-row]").length, 3);
  // Ikkinchi satrni yuqoriga ko'tarish — MATNI bilan birga ko'chadi.
  fireEvent.change(screen.getByLabelText("title-b"), { target: { value: "O'zgargan" } });
  const ups = screen.getAllByLabelText("Yuqoriga");
  fireEvent.click(ups[1]);
  const inputs = Array.from(document.querySelectorAll("[data-row] input")) as HTMLInputElement[];
  assert.equal(inputs[0].value, "O'zgargan", "tartib bilan qiymat ham ko'chdi");
  fireEvent.click(screen.getAllByLabelText("O'chirish")[0]);
  assert.equal(document.querySelectorAll("[data-row]").length, 2);
});

test("reorder: chegaradan tashqari indekslar ro'yxatni o'zgartirmaydi", () => {
  const rows = [1, 2, 3];
  assert.deepEqual(reorder(rows, 0, 2), [2, 3, 1]);
  assert.deepEqual(reorder(rows, 0, -1), rows);
  assert.deepEqual(reorder(rows, 5, 1), rows);
});
