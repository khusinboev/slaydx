import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { SlideEditor, readItems, readText, type StylePatch } from "../../components/viewers/SlideEditor.tsx";
import { listCap, type ListField } from "../../lib/generation/slide-edit.ts";
import { bodyRules } from "../../lib/generation/slide-audience.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel, SlideSrc } from "../../lib/generation/slide-types.ts";

/**
 * `SlideEditor` — WYSIWYG joyida tahrir qatlami (jsdom, Muharrir 2).
 *
 * Shartnoma: ikki bosilgan matn MODELNING qaysi maydonidan kelganini
 * `data-src` aytadi; maydon (contentEditable) o'sha qiymat bilan,
 * qatlam bilan BIR XIL stilda, slaydning o'z koordinatalarida ochiladi;
 * ro'yxat BUTUNICHA (PowerPoint qutisi) tahrirlanadi va faqat HAQIQIY
 * o'zgarish operatsiyaga aylanadi.
 *
 * jsdom da brauzerning tahrir xatti-harakati (Enter → yangi `<li>`)
 * YO'Q — u DOM ga qo'lda `<li>` qo'shib taqlid qilinadi; komponent esa
 * har doim DOM dan o'qiydi (`readItems`), ya'ni test aynan haqiqiy
 * yo'lni sinaydi.
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
  list: [ListField, string[]][];
  footer: string[];
  answer: [number, number][];
  style: [SlideSrc, StylePatch][];
  image: (string | null)[];
  upload: number;
  restore: number;
  editing: (string | null)[];
};

function mount(slide: SlideModel, scale = 1) {
  const calls: Calls = { text: [], list: [], footer: [], answer: [], style: [], image: [], upload: 0, restore: 0, editing: [] };
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
      { "data-slide-frame": "" },
      h(SlideCanvas, { key: "canvas", ...common }),
      h(SlideEditor, {
        key: "editor",
        ...common,
        scale,
        onText: (src: SlideSrc, value: string) => calls.text.push([src, value]),
        onList: (field: ListField, items: string[]) => calls.list.push([field, items]),
        onFooter: (value: string) => calls.footer.push(value),
        onAnswer: (q: number, answer: number) => calls.answer.push([q, answer]),
        onStyle: (src: SlideSrc, patch: StylePatch) => calls.style.push([src, patch]),
        onImage: (url: null) => calls.image.push(url),
        onUpload: () => calls.upload++,
        onRestoreImage: () => calls.restore++,
        onEditing: (key: string | null) => calls.editing.push(key),
      }),
    ),
  );
  return calls;
}

/** Ochiq tahrir maydoni (contentEditable div yoki ul). */
function box(): HTMLElement {
  return screen.getByLabelText("Matnni tahrirlash");
}
function boxOpen(): boolean {
  return screen.queryByLabelText("Matnni tahrirlash") !== null;
}
/** Foydalanuvchi yozganini taqlid qilish — brauzer DOM matnini o'zgartiradi. */
function type(el: HTMLElement, text: string) {
  el.textContent = text;
  fireEvent.input(el);
}
function canvasEl(src: string): HTMLElement {
  const el = document.querySelector(`[data-src='${src}']`);
  assert.ok(el, `${src} qatlamida data-src bo'lishi kerak`);
  return el as HTMLElement;
}
function firstBullet() {
  return canvasEl('{"f":"bullets","i":0}');
}
function titleEl() {
  return canvasEl('{"f":"title"}');
}
function items(): HTMLElement[] {
  return Array.from(box().querySelectorAll("li"));
}

// ══════════════════════════════════ Bitta matn (sarlavha)

test("sarlavhaga ikki bosish → contentEditable maydon modeldagi AYNAN qiymat bilan, textarea YO'Q", () => {
  const slide = bulletsSlide();
  mount(slide);
  fireEvent.doubleClick(titleEl());
  assert.equal(box().tagName, "DIV");
  assert.equal(box().getAttribute("contenteditable"), "true");
  assert.equal(box().textContent, slide.title);
  assert.equal(document.querySelectorAll("textarea").length, 0, "oq textarea qutisi yo'q — matn slaydning o'zida");
});

test("Enter → text op to'g'ri manba bilan, maydon yopiladi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Yangi sarlavha");
  fireEvent.keyDown(box(), { key: "Enter" });
  assert.deepEqual(calls.text, [[{ f: "title" }, "Yangi sarlavha"]]);
  assert.equal(boxOpen(), false, "saqlagach maydon yopiladi");
});

test("Esc → hech narsa saqlanmaydi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Bekor qilinadi");
  fireEvent.keyDown(box(), { key: "Escape" });
  assert.deepEqual(calls.text, []);
  assert.equal(boxOpen(), false);
});

test("blur → saqlanadi; matn o'zgarmasa operatsiya YUBORILMAYDI", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Blur bilan");
  fireEvent.blur(box());
  assert.deepEqual(calls.text, [[{ f: "title" }, "Blur bilan"]]);
  fireEvent.doubleClick(titleEl());
  fireEvent.blur(box());
  assert.equal(calls.text.length, 1, "bo'sh PATCH hujjat versiyasini bekorga oshirardi");
});

test("Shift+Enter ko'p qatorli maydonda yangi qator (`\\n`), saqlamaydi; oddiy Enter saqlaydi", () => {
  const slide: SlideModel = { id: "s0", layout: "section", title: "Bo‘lim", subtitle: "Izoh matni" };
  const calls = mount(slide);
  fireEvent.doubleClick(canvasEl('{"f":"subtitle"}'));
  type(box(), "Birinchi qator");
  // Brauzerda kursor yozilgan matnning OXIRIDA turadi — jsdom da buni tanlov bilan aniq qo'yamiz.
  const sel = window.getSelection()!;
  sel.selectAllChildren(box());
  sel.collapseToEnd();
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  assert.equal(calls.text.length, 0, "Shift+Enter saqlamaydi");
  assert.ok(boxOpen(), "maydon ochiq qoladi");
  // Foydalanuvchi ikkinchi qatorni yozadi (jsdom da kursor yo'q — matn tuguni qo'shiladi).
  box().appendChild(document.createTextNode("Ikkinchi qator"));
  // MUTATSIYA: `insertAtCaret` chaqiruvi olib tashlansa — ikki qator bitta bo'lib qo'shilib ketadi.
  assert.equal(readText(box()), "Birinchi qator\nIkkinchi qator", "yangi qator matnga `\\n` bo'lib tushadi");
  fireEvent.keyDown(box(), { key: "Enter" });
  const sent = calls.text as [SlideSrc, string][];
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1], "Birinchi qator\nIkkinchi qator", "qator ajratgichi saqlanadi");
});

test("sarlavhada (bir qatorli) Shift+Enter ham SAQLAYDI", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Bitta qator");
  fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
  assert.deepEqual(calls.text, [[{ f: "title" }, "Bitta qator"]]);
});

test("qo'yish (paste) faqat MATN — HTML formatlash sizmaydi", () => {
  mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "");
  const ev = new window.Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
  ev.clipboardData = { getData: () => "Qo‘yilgan <b>matn</b>\r\nikkinchi" };
  box().dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, "brauzerning HTML qo'yishi to'xtatiladi");
  assert.equal(readText(box()), "Qo‘yilgan <b>matn</b>\nikkinchi", "matn sifatida, CRLF → LF");
});

// ══════════════════════════════════ Ro'yxat — butun quti (PowerPoint kabi)

test("bandga ikki bosish → BUTUN ro'yxat `<ul>` bo'lib ochiladi, bandlar modeldagi bilan bir xil", () => {
  const slide = bulletsSlide();
  mount(slide);
  fireEvent.doubleClick(firstBullet());
  assert.equal(box().tagName, "UL");
  assert.deepEqual(items().map((li) => li.textContent), slide.bullets);
  assert.equal(screen.queryByText("+ band") === null, true, "«+ band» tugmasi yo'q — Enter yangi band");
});

test("ro'yxat: band matni o'zgarsa → `list` op BUTUN ro'yxat bilan (text op emas)", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  type(items()[1], "O‘zgargan band");
  fireEvent.mouseDown(document.body);
  assert.deepEqual(calls.list, [["bullets", ["Birinchi band", "O‘zgargan band"]]]);
  assert.deepEqual(calls.text, [], "ro'yxat band-ma-band text op yubormaydi");
  assert.equal(boxOpen(), false);
});

test("ro'yxat: brauzer qo'shgan yangi `<li>` (Enter taqlidi) bandga aylanadi, bo'sh `<li>` tashlanadi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  const ul = box();
  const fresh = document.createElement("li");
  fresh.textContent = "  Uchinchi   band ";
  ul.appendChild(fresh);
  ul.appendChild(document.createElement("li"));
  fireEvent.blur(ul);
  // MUTATSIYA: `readItems` da `.filter(Boolean)` olib tashlansa — bo'sh band ketadi, bo'shliq siqilmasa — "  Uchinchi   band ".
  assert.deepEqual(calls.list, [["bullets", ["Birinchi band", "Ikkinchi band", "Uchinchi band"]]]);
});

test("ro'yxat: band o'chirilsa qolganlari ketadi; hech narsa o'zgarmasa op YO'Q", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  items()[0].remove();
  fireEvent.blur(box());
  assert.deepEqual(calls.list, [["bullets", ["Ikkinchi band"]]]);
  fireEvent.doubleClick(firstBullet());
  fireEvent.blur(box());
  assert.equal(calls.list.length, 1, "o'zgarmagan ro'yxat uchun op yo'q");
});

test("ro'yxat: Enter SAQLAMAYDI (brauzer yangi band ochadi), chegarada Enter BLOKLANADI, Esc bekor qiladi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  const ok = fireEvent.keyDown(box(), { key: "Enter" });
  assert.equal(ok, true, "chegaradan pastda Enter brauzerga qoldiriladi (preventDefault yo'q)");
  assert.deepEqual(calls.list, [], "Enter ro'yxatni saqlamaydi");
  assert.ok(boxOpen());
  // Chegara: `listCap` — shu yerdan ham, `list` op dan ham bir xil o'qiladi.
  const max = listCap(bulletsSlide(), "bullets", rules).max;
  const ul = box();
  while (ul.querySelectorAll("li").length < max) ul.appendChild(Object.assign(document.createElement("li"), { textContent: "x" }));
  const blocked = fireEvent.keyDown(ul, { key: "Enter" });
  assert.equal(blocked, false, "band soni chegarada — yangi band ochilmaydi");
  fireEvent.keyDown(ul, { key: "Escape" });
  assert.deepEqual(calls.list, []);
  assert.equal(boxOpen(), false);
});

test("ikki ustun: chap ustun `left` maydoni bilan saqlanadi", () => {
  const slide: SlideModel = { id: "s0", layout: "twoCol", title: "T", leftTitle: "Chap", left: ["L1", "L2"], rightTitle: "O‘ng", right: ["R1"] };
  const calls = mount(slide);
  fireEvent.doubleClick(canvasEl('{"f":"left","i":1}'));
  assert.deepEqual(items().map((li) => li.textContent), ["L1", "L2"]);
  type(items()[0], "L1 yangi");
  fireEvent.blur(box());
  assert.deepEqual(calls.list, [["left", ["L1 yangi", "L2"]]]);
});

// ══════════════════════════════════ WYSIWYG — stil qatlam bilan bir xil, masshtab egizak konteynerda

test("tahrir qutisi qatlam bilan BIR XIL stilda: o'lcham, rang, qalinlik, joy; oq fon YO'Q", () => {
  mount(bulletsSlide());
  const layer = titleEl();
  fireEvent.doubleClick(layer);
  const editBox = document.querySelector("[data-slide-edit-box]") as HTMLElement;
  assert.ok(editBox, "tahrir qutisi bo'lishi kerak");
  for (const k of ["fontSize", "color", "fontWeight", "left", "top", "width", "textAlign", "lineHeight"] as const) {
    assert.equal(editBox.style[k], layer.style[k], `${k}: quti qatlam bilan bir xil bo'lishi kerak`);
  }
  assert.equal(editBox.style.background, "", "fon yo'q — slaydning o'zi ko'rinadi");
  assert.equal(editBox.style.overflow, "visible", "toshgan matn ko'rinsin (qatlamda hidden)");
});

test("egizak konteyner sahna masshtabida — quti koordinatalari QATLAMNIKI (dyuym→px), transform masshtab", () => {
  mount(bulletsSlide(), 0.5);
  const layer = titleEl();
  fireEvent.doubleClick(layer);
  const editBox = document.querySelector("[data-slide-edit-box]") as HTMLElement;
  const twin = editBox.parentElement as HTMLElement;
  // MUTATSIYA: quti `pos * scale` bilan chizilsa — `left` qatlamdan farq qiladi.
  assert.equal(editBox.style.left, layer.style.left, "masshtab qo'lda ko'paytirilmaydi");
  assert.equal(twin.style.transform, "scale(0.5)", "masshtab egizak konteynerning transformida");
  assert.equal(twin.style.width, "1280px");
});

test("tahrirlanayotgan qatlam kaliti `onEditing` ga: ochilganda layerKey, yopilganda null; ro'yxatda birinchi band kaliti", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  assert.deepEqual(calls.editing, ['{"f":"title"}']);
  fireEvent.keyDown(box(), { key: "Escape" });
  assert.deepEqual(calls.editing, ['{"f":"title"}', null]);
  fireEvent.doubleClick(canvasEl('{"f":"bullets","i":1}'));
  assert.equal(calls.editing[2], '{"f":"bullets","i":0}', "ro'yxat qatlami butunicha yashirinadi — kalit birinchi band");
});

// ══════════════════════════════════ Shrift paneli

function curFont(): number {
  return Number(screen.getByLabelText("Joriy shrift o‘lchami").textContent);
}
function fontSelect(): HTMLSelectElement {
  return screen.getByLabelText("Shrift oilasi") as HTMLSelectElement;
}

test("shrift paneli tahrir bilan ochiladi; ro'yxatda «Barcha bandlar»; select 8 shrift + Standart", () => {
  mount(bulletsSlide());
  assert.equal(screen.queryByText("Barcha bandlar") === null, true, "tahrirsiz panel bo'lmasin");
  fireEvent.doubleClick(firstBullet());
  assert.ok(screen.getByText("Barcha bandlar"), "ro'yxatda o'lcham/oila butun qatlamga tegishli");
  assert.ok(curFont() > 0, "joriy o'lcham qatlamdan olinadi");
  assert.equal(fontSelect().options.length, 9, "Standart + 8 xavfsiz shrift");
  assert.equal(fontSelect().value, "", "tanlanmagan — Standart");
});

test("shrift oilasi tanlovi → style {font}; «Standart» → {font: null}; tanlangan oila maydonda DARHOL", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  fireEvent.change(fontSelect(), { target: { value: "georgia" } });
  assert.deepEqual(calls.style, [[{ f: "title" }, { font: "georgia" }]]);
  fireEvent.change(fontSelect(), { target: { value: "" } });
  assert.deepEqual(calls.style[1], [{ f: "title" }, { font: null }]);
  cleanup();
  // Modelda oila bor — quti ham, select ham uni ko'rsatadi («ko'rdim = oldim» yozayotganda).
  mount({ ...bulletsSlide(), font: { '{"f":"title"}': "georgia" } });
  fireEvent.doubleClick(titleEl());
  assert.equal(fontSelect().value, "georgia");
  const editBox = document.querySelector("[data-slide-edit-box]") as HTMLElement;
  assert.ok(editBox.style.fontFamily.includes("Georgia"), "maydon tanlangan shriftda");
  assert.equal(editBox.style.fontFamily, titleEl().style.fontFamily, "qatlam bilan bir xil ro'yxat");
});

test("select ga fokus o'tganda (blur relatedTarget panel) tahrir YOPILMAYDI", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Yozilmoqda");
  fireEvent.blur(box(), { relatedTarget: fontSelect() });
  assert.ok(boxOpen(), "oila tanlash matnni uzmasin");
  assert.deepEqual(calls.text, [], "hali saqlanmagan");
  fireEvent.mouseDown(document.body);
  assert.deepEqual(calls.text, [[{ f: "title" }, "Yozilmoqda"]]);
});

test("«+» va «−» — style {size}, qadam 2 pt", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  const size = curFont();
  fireEvent.click(screen.getByLabelText("Shriftni kattalashtirish"));
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, { size: size + 2 }]], "«+» o'lchamni oshiradi");
  fireEvent.click(screen.getByLabelText("Shriftni kichraytirish"));
  assert.deepEqual(calls.style[1], [{ f: "bullets", i: 0 }, { size: size - 2 }], "«−» kamaytiradi");
});

test("tayyor o'lcham ANIQ son beradi, «Standart» — {size: null}; tanlanmagan bo'lsa O'CHIQ", () => {
  const withFont: SlideModel = { ...bulletsSlide(), fontSize: { '{"f":"bullets","i":0}': 44 } };
  const calls = mount(withFont);
  fireEvent.doubleClick(firstBullet());
  assert.equal(curFont(), 44, "modeldagi o'lcham qatlamga qo'llangan bo'lishi kerak");
  fireEvent.click(screen.getByLabelText("Shrift 24 pt"));
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, { size: 24 }]]);
  fireEvent.click(screen.getByText("Standart"));
  assert.deepEqual(calls.style[1], [{ f: "bullets", i: 0 }, { size: null }]);
  cleanup();
  mount(bulletsSlide());
  fireEvent.doubleClick(firstBullet());
  assert.equal((screen.getByText("Standart") as HTMLButtonElement).disabled, true, "o'chirishga narsa yo'q — tugma ishlamasin");
});

test("ikkinchi bandda ham o'lcham BUTUN ro'yxatga tegishli (birinchi band kaliti)", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(canvasEl('{"f":"bullets","i":1}'));
  fireEvent.click(screen.getByLabelText("Shrift 36 pt"));
  assert.deepEqual(calls.style, [[{ f: "bullets", i: 0 }, { size: 36 }]]);
});

test("bir maydonli qatlamda panel «Shrift» deydi va o'z manbasini yuboradi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  assert.ok(screen.getByText("Shrift"));
  assert.equal(screen.queryByText("Barcha bandlar") === null, true);
  fireEvent.click(screen.getByLabelText("Shrift 32 pt"));
  assert.deepEqual(calls.style, [[{ f: "title" }, { size: 32 }]]);
});

test("panelga bosish tahrirni YOPMAYDI; tashqariga BITTA bosish yopadi va BIR MARTA saqlaydi", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(titleEl());
  type(box(), "Yozilmoqda");
  fireEvent.mouseDown(screen.getByLabelText("Shrift 20 pt"));
  fireEvent.click(screen.getByLabelText("Shrift 20 pt"));
  assert.ok(boxOpen(), "o'lcham tanlash matnni uzmasin");
  assert.deepEqual(calls.text, [], "matn hali saqlanmagan");
  const el = box();
  fireEvent.mouseDown(document.body);
  // Brauzer `mousedown` dan keyin `blur` ni ham yuboradi — ikkinchi
  // operatsiya ketsa hujjat versiyasi bekorga oshardi.
  fireEvent.blur(el);
  assert.deepEqual(calls.text, [[{ f: "title" }, "Yozilmoqda"]]);
  assert.equal(boxOpen(), false, "maydon yopiladi");
});

// ══════════════════════════════════ Kolontitul (deka darajasida)

function footerEl(): HTMLElement {
  return canvasEl('{"f":"footer"}');
}

test("kolontitul ikki bosishda ochiladi va `onFooter` beradi (matn opi EMAS)", () => {
  const calls = mount({ ...bulletsSlide(), footer: "Aliyev · TDPU" });
  fireEvent.doubleClick(footerEl());
  assert.equal(box().textContent, "Aliyev · TDPU", "maydon modeldagi kolontitul bilan ochiladi");
  type(box(), "Aliyev · TDPU · 2026");
  fireEvent.keyDown(box(), { key: "Enter" });
  // MUTATSIYA: `commit` dagi `if (e.src.f === "footer")` shoxi olib
  // tashlansa — `onText` chaqiriladi va server 422 qaytarardi.
  assert.deepEqual(calls.footer, ["Aliyev · TDPU · 2026"]);
  assert.deepEqual(calls.text, [], "kolontitul matn operatsiyasiga tushmasligi kerak");
});

test("kolontitulsiz slaydda maydon BO'SH ochiladi (qo'shish yo'li); o'zgarmasa op yo'q", () => {
  const calls = mount(bulletsSlide());
  fireEvent.doubleClick(footerEl());
  assert.equal(box().textContent, "", "kolontitul yo'q — bo'sh maydon");
  type(box(), "Yangi kolontitul");
  fireEvent.keyDown(box(), { key: "Enter" });
  assert.deepEqual(calls.footer, ["Yangi kolontitul"]);
  fireEvent.doubleClick(footerEl());
  fireEvent.blur(box());
  assert.equal(calls.footer.length, 1, "bo'sh PATCH hujjat versiyasini bekorga oshirardi");
});

// ══════════════════════════════════ Rasm tugmalari

test("rasm boshqaruvi: «Qayta chizish» YO'Q, «Rasmsiz» faqat rasm bor bo'lsa", () => {
  mount(bulletsSlide());
  assert.ok(screen.getByText("O‘z rasmim"), "rasm joyi bor maketda yuklash tugmasi chiqadi");
  assert.equal(screen.queryByText(/Qayta chizish/) === null, true, "AI qayta chizish olib tashlangan");
  assert.equal(screen.queryByText("Rasmsiz") === null, true, "rasmi yo'q slaydda «Rasmsiz» kerak emas");
  cleanup();
  const c2 = mount({ ...bulletsSlide(), image: { url: "/api/generations/gen1/assets/abcdef0123456789" } });
  fireEvent.click(screen.getByText("Rasmsiz"));
  assert.deepEqual(c2.image, [null]);
});

test("«Rasmni qaytarish» FAQAT asl rasm (`imageOrig`) bo'lganda chiqadi va `onRestoreImage` beradi", () => {
  mount(bulletsSlide());
  assert.equal(screen.queryByText("Rasmni qaytarish") === null, true, "qaytaradigan narsa yo'q — tugma yo'q");
  cleanup();
  const calls = mount({ ...bulletsSlide(), imageOrig: { url: "/api/generations/gen1/assets/abcdef0123456789" } });
  assert.equal(screen.queryByText("Rasmsiz") === null, true, "rasm yo'q — «Rasmsiz» ham yo'q");
  fireEvent.click(screen.getByText("Rasmni qaytarish"));
  // MUTATSIYA: tugma `onImage(null)` ga ulansa — `calls.image` to'ladi, `restore` 0 qoladi.
  assert.equal(calls.restore, 1);
  assert.deepEqual(calls.image, []);
});

test("maketda rasm joyi bo'lmasa rasm tugmalari CHIQMAYDI", () => {
  // DIQQAT: DOM tugunini `assert.equal(el, null)` bilan solishtirmang — jsdom
  // tugunini `util.inspect` chizishga urinib jarayon qotadi (AUDIT-10 Y-2).
  mount({ id: "s0", layout: "answers", title: "Javoblar", bullets: ["1 — A", "2 — C"] });
  assert.equal(screen.queryByText("O‘z rasmim") === null, true, "rasm joyi yo'q maketda rasm tugmasi chiqmasligi kerak");
});

// ══════════════════════════════════ Test javobi

function quizSlide(answer = 0): SlideModel {
  return {
    id: "s0",
    layout: "quiz",
    title: "Nazorat savoli",
    quiz: [{ q: "Bug‘lanish qayerda kuchli?", options: ["Okean", "Bulut", "Daryo", "Muz"], answer }],
  };
}

test("quiz: joriy to'g'ri javob belgilangan, boshqalari oddiy tugma", () => {
  mount(quizSlide(0));
  assert.equal(document.querySelectorAll("[data-answer-mark]").length, 4, "har variantga bitta belgi");
  assert.equal(document.querySelectorAll('[data-answer-mark="current"]').length, 1, "to'g'ri javob BITTA");
  const cur = screen.getByLabelText("A — to‘g‘ri javob");
  assert.equal(cur.getAttribute("data-answer-mark"), "current", "modeldagi answer=0 → A belgilanadi");
  assert.equal(cur.getAttribute("aria-pressed"), "true");
});

test("quiz: variant belgisiga bosish `onAnswer` beradi; belgi modelga ERGASHADI; boshqa slaydda yo'q", () => {
  const calls = mount(quizSlide(0));
  fireEvent.click(screen.getByLabelText("C — to‘g‘ri javob"));
  assert.deepEqual(calls.answer, [[0, 2]]);
  assert.deepEqual(calls.text, [], "javob tanlash matnni o'zgartirmaydi");
  cleanup();
  mount(quizSlide(3));
  assert.equal(screen.getByLabelText("D — to‘g‘ri javob").getAttribute("data-answer-mark"), "current", "answer=3 → D");
  cleanup();
  mount(bulletsSlide());
  assert.equal(document.querySelector("[data-answer-mark]") === null, true);
});

// ══════════════════════════════════ readText / readItems (brauzer DOM shakllari)

test("readText: <br>, <div> va matn tugunlari `\\n` ga tushadi; oxirgi <br> hisobga olinmaydi", () => {
  const el = document.createElement("div");
  el.innerHTML = "Bir<br>Ikki<div>Uch</div><div>To‘rt<br></div>";
  assert.equal(readText(el), "Bir\nIkki\nUch\nTo‘rt");
});

test("readItems: li siz qolgan ul (hammasi o'chirilgan) matndan o'qiladi; ichki `\\n` alohida band", () => {
  const ul = document.createElement("ul");
  ul.innerHTML = "<li>Bir\nIkki</li><li> </li><li>Uch</li>";
  assert.deepEqual(readItems(ul), ["Bir", "Ikki", "Uch"]);
  ul.innerHTML = "Yolg‘iz matn";
  assert.deepEqual(readItems(ul), ["Yolg‘iz matn"]);
});
