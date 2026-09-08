import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * «Ko'rdim = oldim» — test slaydi uchun.
 *
 * PPTX da javob YO'Q, lekin ko'ruvchida bor bo'lsa (yoki aksincha)
 * o'quvchi taqdimotni saytda ochib javobni oldindan ko'rardi. Ikkala
 * chiqish ham BITTA `planSlide` dan chizilgani uchun bu holat faqat
 * ko'ruvchi qatlamini alohida chizishga urinilganda yuzaga keladi —
 * shuning uchun HTML ning O'ZI tekshiriladi.
 */

const theme = getSlideTheme("atlas");

const OPTIONS = ["Okean yuzasida", "Bulut ichida", "Yer ostida", "Muzliklarda"];

const quiz: SlideModel = {
  id: "q",
  layout: "quiz",
  title: "Nazorat testi",
  footer: "Muallif · TDPU",
  // Javob — ikkinchi variant (B). Slaydda hech qanday belgisi bo'lmasligi kerak.
  quiz: [{ q: "Suvning bug‘lanishi asosan qayerda ro‘y beradi?", options: OPTIONS, answer: 1 }],
  notes: "Javob: B — Bulut ichida",
};

const render = (slide: SlideModel, visual: "classic" | "dense" = "classic") =>
  renderToStaticMarkup(h(SlideCanvas, { slide, theme, visual, index: 3, total: 10 }));

test("ko'ruvchi test slaydida to'rtala variant matni bor", () => {
  const html = render(quiz);
  for (const o of OPTIONS) assert.ok(html.includes(o), `«${o}» varianti HTML da yo'q`);
  assert.ok(html.includes("Suvning bug‘lanishi asosan qayerda ro‘y beradi?"), "savol matni HTML da yo'q");
  for (const letter of ["A", "B", "C", "D"]) {
    assert.ok(html.includes(`>${letter}</div>`), `«${letter}» harfi HTML da yo'q`);
  }
});

test("ko'ruvchi to'g'ri javobni ko'rsatmaydi", () => {
  const html = render(quiz);
  assert.ok(!html.includes("Javob"), "javob izohi slayd tuvaliga chizilgan");
  /*
   * Javob indeksi chizmaga UMUMAN ta'sir qilmasligi kerak: to'rt xil
   * `answer` bilan HTML aynan bir xil bo'lsin. Rang, ramka yoki tartib
   * orqali sizib chiqish ham shu tekshiruvda ushlanadi.
   */
  const variants = [0, 1, 2, 3].map((answer) => render({ ...quiz, quiz: [{ ...quiz.quiz![0], answer }] }));
  assert.equal(new Set(variants).size, 1, "javob indeksi ko'ruvchi chizmasini o'zgartirdi");
});

test("dense test slaydi to'q sahifada chiziladi (PPTX bilan bir xil fon)", () => {
  const html = render(quiz, "dense");
  assert.ok(html.includes(`background:${theme.titleBg}`), "to'q sahifa foni ko'ruvchida yo'q");
  for (const o of OPTIONS) assert.ok(html.includes(o), `dense: «${o}» varianti yo'q`);
});

test("javoblar slaydi ko'ruvchida to'liq chiziladi", () => {
  const answers: SlideModel = {
    id: "a",
    layout: "answers",
    title: "Test javoblari",
    footer: "Muallif · TDPU",
    bullets: ["1 — A", "2 — B", "3 — C"],
  };
  const html = render(answers);
  for (const b of answers.bullets!) assert.ok(html.includes(b), `«${b}» javobi HTML da yo'q`);
});

test("adabiyotlar slaydi ko'ruvchida havola va izoh bilan chiziladi", () => {
  const refs: SlideModel = {
    id: "r",
    layout: "references",
    title: "Foydalanilgan adabiyotlar",
    footer: "Muallif · TDPU",
    refs: [{ title: "uz.wikipedia.org", source: "https://uz.wikipedia.org/wiki/Suv_aylanishi" }],
  };
  const html = render(refs);
  assert.ok(html.includes("uz.wikipedia.org/wiki/Suv_aylanishi"), "havola HTML da yo'q");
  assert.ok(html.includes("Manba: internet (Google Search)"), "manba izohi HTML da yo'q");
});
