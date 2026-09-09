import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { SlideEditor } from "../../components/viewers/SlideEditor.tsx";
import { readSlideField } from "../../lib/generation/slide-edit.ts";
import { bodyRules } from "../../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel, SlideSrc } from "../../lib/generation/slide-types.ts";

/**
 * `SlideEditor` — joyida tahrir qatlami (jsdom).
 *
 * Sinovning butun mazmuni bitta shartnomada: ikki bosilgan matn
 * MODELNING qaysi maydonidan kelganini `data-src` aytadi, `textarea`
 * o'sha maydonning AYNAN qiymati bilan ochiladi va faqat HAQIQIY
 * o'zgarish operatsiyaga aylanadi. Shu uch bo'g'inning biri uzilsa —
 * foydalanuvchi boshqa slaydning matnini tahrirlaydi yoki har bosishda
 * bo'sh PATCH ketadi.
 */

/*
 * Har testdan keyin DOM tozalanadi: yiqilgan test o'z ramkasini
 * qoldirsa, keyingi testlarda `getByLabelText` «bir nechta element»
 * deb yiqilardi va MUTATSIYA jadvali qaysi assertion sinishini
 * ko'rsatolmasdi (hammasi qizil bo'lardi).
 */
afterEach(() => cleanup());

const theme = getSlideTheme("atlas");
const rules = bodyRules({ planItems: 6, textVolume: "standart" }, "lecture");

function bulletsSlide(): SlideModel {
  return {
    id: "s0",
    layout: "bullets",
    title: "Sarlavha matni",
    bullets: ["Birinchi band", "Ikkinchi band"],
  };
}

type Calls = {
  text: [SlideSrc, string][];
  style: [SlideSrc, number | null][];
  image: (string | null)[];
  regen: number;
  upload: number;
};

function mount(slide: SlideModel) {
  const calls: Calls = { text: [], style: [], image: [], regen: 0, upload: 0 };
  const common = {
    slide,
    theme,
    visual: "classic" as const,
    audience: "auto" as const,
    templateId: "lecture" as const,
    bodyType: rules,
    index: 1,
    total: 3,
  };
  render(
    // Sahna ramkasi: `SlideCanvas` va overlay BITTA ota tugunda —
    // `SlideStage` dagi tuzilma ayni shunday, hodisa shu tugunda ushlanadi.
    h(
      "div",
      null,
      h(SlideCanvas, { key: "canvas", ...common }),
      h(SlideEditor, {
        key: "editor",
        ...common,
        scale: 1,
        redrawsLeft: 5,
        onText: (src: SlideSrc, value: string) => calls.text.push([src, value]),
        onStyle: (src: SlideSrc, size: number | null) => calls.style.push([src, size]),
        onImage: (url: null) => calls.image.push(url),
        onUpload: () => calls.upload++,
        onRegenerate: () => calls.regen++,
      }),
    ),
  );
  return calls;
}

function box() {
  return screen.getByLabelText("Matnni tahrirlash") as HTMLTextAreaElement;
}

function firstBullet() {
  const el = document.querySelector("li[data-src]");
  assert.ok(el, "bandda data-src bo'lishi kerak");
  return el as HTMLElement;
}

test("ikki bosish → textarea modeldagi AYNAN qiymat bilan ochiladi", () => {
  const slide = bulletsSlide();
  mount(slide);
  fireEvent.doubleClick(firstBullet());
  assert.equal(box().value, readSlideField(slide, { f: "bullets", i: 0 }));
  cleanup();
});

test("sarlavha ham tahrirlanadi (bir maydonli qatlam)", () => {
  const slide = bulletsSlide();
  mount(slide);
  const el = document.querySelector('[data-src=\'{"f":"title"}\']');
  assert.ok(el, "sarlavha qatlamida data-src bo'lishi kerak");
  fireEvent.doubleClick(el as HTMLElement);
  assert.equal(box().value, slide.title);
  cleanup();
});

test("Enter → matn operatsiyasi to'g'ri manba bilan chiqadi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "O‘zgargan band" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  assert.deepEqual(calls.text, [[{ f: "bullets", i: 0 }, "O‘zgargan band"]]);
  assert.equal(document.querySelectorAll("textarea").length, 0, "saqlagach maydon yopiladi");
  cleanup();
});

test("Esc → hech narsa saqlanmaydi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Bekor qilinadi" } });
  fireEvent.keyDown(box(), { key: "Escape" });
  assert.deepEqual(calls.text, []);
  assert.equal(document.querySelectorAll("textarea").length, 0);
  cleanup();
});

test("blur → saqlanadi (boshqa joyga bosish ham tahrirni yakunlaydi)", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Blur bilan" } });
  fireEvent.blur(box());
  assert.deepEqual(calls.text, [[{ f: "bullets", i: 0 }, "Blur bilan"]]);
  cleanup();
});

test("matn o'zgarmasa operatsiya YUBORILMAYDI", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.blur(box());
  assert.deepEqual(calls.text, [], "bo'sh PATCH hujjat versiyasini bekorga oshirardi");
  cleanup();
});

test("«+ band» ro'yxat OXIRIGA yangi element qo'shadi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.click(screen.getByText("+ band"));
  assert.equal(box().value, "", "yangi band bo'sh maydondan boshlanadi");
  fireEvent.change(box(), { target: { value: "Uchinchi band" } });
  fireEvent.keyDown(box(), { key: "Enter" });
  assert.deepEqual(calls.text, [[{ f: "bullets", i: 2 }, "Uchinchi band"]]);
  cleanup();
});

test("Shift+Enter ko'p qatorli maydonda yangi qator (saqlamaydi)", () => {
  const slide: SlideModel = { id: "s0", layout: "section", title: "Bo‘lim", subtitle: "Izoh matni" };
  const calls = mount(slide);
  const el = document.querySelector('[data-src=\'{"f":"subtitle"}\']');
  assert.ok(el, "subtitle qatlamida data-src bo'lishi kerak");
  fireEvent.doubleClick(el as HTMLElement);
  fireEvent.change(box(), { target: { value: "Birinchi qator" } });
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  assert.deepEqual(calls.text, [], "Shift+Enter saqlamaydi");
  fireEvent.keyDown(box(), { key: "Enter" });
  assert.deepEqual(calls.text, [[{ f: "subtitle" }, "Birinchi qator"]]);
  cleanup();
});

test("bandda Shift+Enter ham SAQLAYDI — band bir qatorli", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Bitta qator" } });
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  assert.deepEqual(calls.text, [[{ f: "bullets", i: 0 }, "Bitta qator"]]);
  cleanup();
});

test("rasm boshqaruvi: qayta chizish limiti va «Rasmsiz» faqat rasm bor bo'lsa", () => {
  const calls = mount(bulletsSlide());
  assert.ok(screen.getByText("Qayta chizish (5/5)"), "rasm joyi bor maketda tugma chiqadi");
  assert.equal(screen.queryByText("Rasmsiz"), null, "rasmi yo'q slaydda «Rasmsiz» kerak emas");
  fireEvent.click(screen.getByText("Qayta chizish (5/5)"));
  assert.equal(calls.regen, 1);
  cleanup();

  const withImage: SlideModel = {
    ...bulletsSlide(),
    image: { url: "/api/generations/gen1/assets/abcdef0123456789" },
  };
  const c2 = mount(withImage);
  fireEvent.click(screen.getByText("Rasmsiz"));
  assert.deepEqual(c2.image, [null]);
  cleanup();
});

test("maketda rasm joyi bo'lmasa rasm tugmalari CHIQMAYDI", () => {
  mount({
    id: "s0",
    layout: "table",
    title: "Jadval",
    table: { headers: ["A", "B"], rows: [["1", "2"]] },
  });
  assert.equal(screen.queryByText("O‘z rasmim"), null);
  cleanup();
});

// ══════════════════════════════════ Shrift paneli

/** Panel ko'rsatayotgan joriy o'lcham (qatlamdan hisoblangan). */
function curFont(): number {
  const el = screen.getByLabelText("Joriy shrift o‘lchami");
  return Number(el.textContent);
}

test("shrift paneli tahrir bilan birga ochiladi, «Barcha bandlar» deb ogohlantiradi", () => {
  mount(bulletsSlide());
  assert.equal(screen.queryByText("Barcha bandlar"), null, "tahrirsiz panel bo'lmasin");
  fireEvent.doubleClick(firstBullet());
  assert.ok(screen.getByText("Barcha bandlar"), "ro'yxatda o'lcham butun qatlamga tegishli");
  assert.ok(curFont() > 0, "joriy o'lcham qatlamdan olinadi");
  cleanup();
});

test("«+» va «−» — style operatsiyasi, qadam 2 pt", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  const size = curFont();
  fireEvent.click(screen.getByLabelText("Shriftni kattalashtirish"));
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, size + 2]], "«+» o'lchamni oshiradi");
  fireEvent.click(screen.getByLabelText("Shriftni kichraytirish"));
  assert.deepEqual(calls.style[1], [{ f: "bullets", i: 0 }, size - 2], "«−» kamaytiradi");
  cleanup();
});

test("tayyor o'lcham ANIQ son beradi, «Standart» — null", () => {
  const withFont: SlideModel = { ...bulletsSlide(), fontSize: { '{"f":"bullets","i":0}': 44 } };
  const calls = mount(withFont);
  fireEvent.doubleClick(firstBullet());
  assert.equal(curFont(), 44, "modeldagi o'lcham qatlamga qo'llangan bo'lishi kerak");
  fireEvent.click(screen.getByLabelText("Shrift 24 pt"));
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, 24]]);
  fireEvent.click(screen.getByText("Standart"));
  assert.deepEqual(calls.style[1], [{ f: "bullets", i: 0 }, null]);
  cleanup();
});

test("ikkinchi bandda ham o'lcham BUTUN ro'yxatga tegishli", () => {
  const calls = mount(bulletsSlide());
  const items = document.querySelectorAll("li[data-src]");
  assert.equal(items.length, 2, "ikkita band bo'lishi kerak");
  fireEvent.doubleClick(items[1] as HTMLElement);
  assert.equal(box().value, "Ikkinchi band", "matn ikkinchi banddan ochiladi");
  fireEvent.click(screen.getByLabelText("Shrift 36 pt"));
  // `applyFontOverrides` kalit sifatida `srcLines[0]` ni o'qiydi —
  // ikkinchi bandning kaliti bilan yuborilgan o'lcham HECH QAYERGA
  // qo'llanmasdi (tanladim, hech narsa o'zgarmadi).
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, 36]]);
  cleanup();
});

test("«Standart» o'lcham tanlanmagan bo'lsa O'CHIQ", () => {
  mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  const btn = screen.getByText("Standart") as HTMLButtonElement;
  assert.equal(btn.disabled, true, "o'chirishga narsa yo'q — tugma ishlamasin");
  cleanup();
});

test("bir maydonli qatlamda panel «Shrift» deydi va o'z manbasini yuboradi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(document.querySelector('[data-src=\'{"f":"title"}\']') as HTMLElement);
  assert.ok(screen.getByText("Shrift"));
  assert.equal(screen.queryByText("Barcha bandlar"), null);
  fireEvent.click(screen.getByLabelText("Shrift 32 pt"));
  assert.deepEqual(calls.style, [[{ f: "title" }, 32]]);
  cleanup();
});

test("panelga bosish tahrirni YOPMAYDI (matn maydoni joyida qoladi)", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Yozilmoqda" } });
  fireEvent.mouseDown(screen.getByLabelText("Shrift 20 pt"));
  fireEvent.click(screen.getByLabelText("Shrift 20 pt"));
  assert.equal(document.querySelectorAll("textarea").length, 1, "o'lcham tanlash matnni uzmasin");
  assert.deepEqual(calls.text, [], "matn hali saqlanmagan");
  cleanup();
});

test("tashqariga BITTA bosish tahrirni yopadi va saqlaydi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Tashqariga bosildi" } });
  fireEvent.mouseDown(document.body);
  assert.deepEqual(calls.text, [[{ f: "bullets", i: 0 }, "Tashqariga bosildi"]]);
  assert.equal(document.querySelectorAll("textarea").length, 0, "maydon yopiladi");
  cleanup();
});

test("tashqariga bosish + blur BIR MARTA saqlaydi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  fireEvent.change(box(), { target: { value: "Bir marta" } });
  const ta = box();
  fireEvent.mouseDown(document.body);
  // Brauzer `mousedown` dan keyin `blur` ni ham yuboradi — ikkinchi
  // operatsiya ketsa hujjat versiyasi bekorga oshardi.
  fireEvent.blur(ta);
  assert.equal(calls.text.length, 1);
  cleanup();
});
