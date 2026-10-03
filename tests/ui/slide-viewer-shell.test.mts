import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, act } from "react";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import { SlideViewer, zoomStep, SLIDE_ZOOM_STEPS } from "../../components/viewers/SlideViewer.tsx";
import { CONFIRM_MIN_MS } from "../../components/overlays/useConfirmClick.ts";
import type { AcademicDoc } from "../../lib/generation/types.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * Slayd ko'ruvchisi QOBIG'I (viewer redesign V2) — jsdom.
 *
 * Tekshiriladi: (a) asboblar paneli yorlig'i HAQIQIY (moslashda o'lchangan)
 * foizni ko'rsatadi va «Moslash» holati bor; (b) kattalashtirilgan slayd
 * sahna ichida har ikki o'qda aylanadi, «Moslash» da esa markazda turadi;
 * (c) sahifa navigatsiyasi YAGONA; (d) mobil «Boshqa amallar» menyusi va
 * sensorli rasm tugmalari; (e) taqdimot rejimi o'zgarmagan.
 *
 * jsdom o'lcham bermaydi — `ResizeObserver` va sahna o'lchamlari ataylab
 * qo'lda beriladi. Haqiqiy brauzer tekshiruvi (aylantirish chegaralari,
 * sensorli CSS) — Playwright smoke (`docs/viewer/PLAN.md`, V2).
 */

// ── boshqariladigan ResizeObserver ──
const observers: { cb: () => void; el: Element }[] = [];
(globalThis as unknown as Record<string, unknown>).ResizeObserver = class {
  cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
  }
  observe(el: Element) {
    observers.push({ cb: this.cb, el });
  }
  unobserve() {}
  disconnect() {
    for (let k = observers.length - 1; k >= 0; k--) if (observers[k].cb === this.cb) observers.splice(k, 1);
  }
};

/** Sahnaga (`data-slide-stage`) o'lcham beradi va kuzatuvchilarni uyg'otadi. */
async function sizeStage(w: number, hgt: number) {
  const stage = document.querySelector("[data-slide-stage]") as HTMLElement;
  assert.ok(stage, "sahna topilmadi");
  Object.defineProperty(stage, "clientWidth", { value: w, configurable: true });
  Object.defineProperty(stage, "clientHeight", { value: hgt, configurable: true });
  await act(async () => {
    for (const o of [...observers]) if (o.el === stage) o.cb();
  });
}

afterEach(() => {
  cleanup();
  observers.length = 0;
});

const slides: SlideModel[] = [
  { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh" },
  { id: "s1", layout: "bullets", title: "Birinchi", bullets: ["Bir", "Ikki"] },
  { id: "s2", layout: "bullets", title: "Ikkinchi", bullets: ["Uch"] },
];

function makeDoc(list: SlideModel[] = slides): AcademicDoc {
  return {
    meta: { topic: "Mavzu", author: "Aliyev", workLabel: "Taqdimot", language: "uz", speakerNotes: true },
    titlePage: false,
    toc: false,
    sections: [],
    slides: list,
  } as unknown as AcademicDoc;
}

function gen(doc: AcademicDoc) {
  return { id: "gen1", type: "slide", status: "COMPLETED", doc, docVersion: 1, fileVersion: 1, imageRedraws: 0, hasFile: true, hasPrev: false };
}

const stage = () => document.querySelector("[data-slide-stage]") as HTMLElement;
const frame = () => document.querySelector("[data-slide-stage] > div") as HTMLElement;
const label = () => document.querySelector("[data-zoom-label]") as HTMLElement;
const fitBtn = () => document.querySelector("[data-zoom-fit]") as HTMLElement;

// ══════════════════════════════════ (a) Yorliq
test("zoomStep: moslash foizidan keyingi/oldingi pog'ona, chetda null", () => {
  assert.equal(zoomStep(43, 1), 50);
  assert.equal(zoomStep(43, -1), 25);
  assert.equal(zoomStep(50, 1), 75, "aynan pog'onada turilsa — keyingisi");
  assert.equal(zoomStep(50, -1), 25);
  assert.equal(zoomStep(18, -1), null, "eng pastdan pastga yo'q");
  assert.equal(zoomStep(200, 1), null, "eng yuqoridan yuqoriga yo'q");
  assert.deepEqual([...SLIDE_ZOOM_STEPS], [...SLIDE_ZOOM_STEPS].sort((a, b) => a - b));
});

test("yorliq «moslash»da HAQIQIY foizni ko'rsatadi (eskirgan 75% emas) va «Moslash» yoqiq", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  await sizeStage(1000, 500); // min(1000/1280, 500/720) = 0.694
  assert.equal(label().textContent, "69%", "o'lchangan masshtab");
  assert.equal(label().getAttribute("data-zoom-mode"), "fit");
  assert.equal(fitBtn().getAttribute("aria-pressed"), "true", "«Moslash» yoqiq holati aytiladi");
  // MUTATSIYA: `zoomPct = fitOn ? Math.round(fitScale*100) : zoom` da `zoom` qaytarilsa — «75%» chiqadi.
  assert.notEqual(label().textContent, "75%");
  // O'lcham o'zgarsa yorliq ergashadi.
  await sizeStage(640, 500); // 0.5
  assert.equal(label().textContent, "50%");
});

test("± moslash foizidan pog'onaga o'tadi; «Moslash» qaytaradi", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  await sizeStage(1000, 500);
  fireEvent.click(screen.getByLabelText("Kattalashtirish"));
  assert.equal(label().textContent, "75%", "69 dan keyingi pog'ona");
  assert.equal(label().getAttribute("data-zoom-mode"), "manual");
  assert.equal(fitBtn().getAttribute("aria-pressed"), "false");
  assert.equal(stage().getAttribute("data-slide-stage"), "zoom");
  fireEvent.click(screen.getByLabelText("Kichraytirish"));
  assert.equal(label().textContent, "50%", "75 dan oldingi pog'ona");
  fireEvent.click(fitBtn());
  assert.equal(label().textContent, "69%", "«Moslash» yana o'lchangan foizga qaytaradi");
  assert.equal(stage().getAttribute("data-slide-stage"), "fit");
  // Moslashdan «−» — fitdan KICHIK pog'ona (50), 69 ning o'zi emas.
  fireEvent.click(screen.getByLabelText("Kichraytirish"));
  assert.equal(label().textContent, "50%");
});

// ══════════════════════════════════ (b) Over-zoom
test("kattalashtirilgan slayd sahna ichida aylanadi (ikki o'q), «moslash»da markazda va aylantirgichsiz", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  await sizeStage(1000, 500);
  // Moslash: aylantirgich yo'q, slayd sahnadan KATTA emas.
  assert.ok(stage().className.includes("overflow-hidden"), "moslashda aylantirgich yo'q");
  assert.ok(!stage().className.includes("overflow-auto"));
  const fitW = parseFloat(frame().style.width);
  assert.ok(fitW <= 1000, `moslashda slayd sig'adi (${fitW})`);

  // 75 → 100 → 125 → 150 %: sahnadan keng.
  for (let k = 0; k < 4; k++) fireEvent.click(screen.getByLabelText("Kattalashtirish"));
  assert.equal(label().textContent, "125%");
  assert.equal(parseFloat(frame().style.width), 1600, "1280 × 1.25");
  assert.ok(stage().className.includes("overflow-auto"), "over-zoom sahna ichida aylanadi (x va y)");
  assert.ok(!stage().className.includes("overflow-hidden"));
  /*
   * MUTATSIYA: sahnaga `justify-center`/`items-center` qaytarilsa — ramka
   * ikki tomonga teng toshadi va CHAP yarmini aylantirib bo'lmaydi
   * (asl xato). `m-auto` + `shrink-0` — to'g'ri naqsh.
   */
  assert.ok(!/justify-center|items-center/.test(stage().className), "markazlash m-auto bilan, justify bilan emas");
  assert.ok(/\bm-auto\b/.test(frame().className) && /\bshrink-0\b/.test(frame().className));
});

// ══════════════════════════════════ (c) Yagona navigatsiya
test("sahifa navigatsiyasi YAGONA: bitta oldingi/keyingi, bitta «n / N»", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  assert.equal(screen.getAllByLabelText("Oldingi sahifa").length, 1);
  assert.equal(screen.getAllByLabelText("Keyingi sahifa").length, 1);
  assert.equal(document.querySelectorAll("[data-slide-page]").length, 1);
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "1 / 3");
  assert.ok(!/Slayd \d+ \/ \d+/.test(document.body.textContent ?? ""), "pastki qatordagi «Slayd 1 / 3» yo'q");
  assert.equal(screen.getAllByLabelText("To‘liq ekran").length, 1, "to'liq ekran tugmasi ham bitta");
  fireEvent.click(screen.getByLabelText("Keyingi sahifa"));
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "2 / 3");
  fireEvent.click(screen.getByLabelText("Oldingi sahifa"));
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "1 / 3");
  assert.ok((screen.getByLabelText("Oldingi sahifa") as HTMLButtonElement).disabled, "birinchida «oldingi» o'chiq");
});

// ══════════════════════════════════ (d) Mobil menyu
test("asboblar paneli gorizontal aylantirilmaydi (kesilmaydi) va ikkilamchi amallar menyuda", () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  const bar = document.querySelector("[data-slide-toolbar]") as HTMLElement;
  assert.ok(bar, "slayd asboblar paneli");
  assert.ok(!bar.innerHTML.includes("overflow-x-auto"), "gorizontal aylantirish yo'q — mobilda «O'chirish» kesilardi");
  const more = screen.getByLabelText("Boshqa amallar");
  assert.equal(more.getAttribute("aria-haspopup"), "menu");
  assert.equal(more.getAttribute("aria-expanded"), "false");
  assert.ok(more.parentElement!.className.includes("md:hidden"), "menyu faqat mobilda");
  // Yopiq menyuda band YO'Q (DOM da takroriy «O'chirish» bo'lmasin).
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0);
  // Katta ekranda inline «O'chirish» bor, mobilda yashirin.
  const inline = screen.getByText("O‘chirish").closest("button")!;
  assert.ok(inline.className.includes("hidden") && inline.className.includes("md:inline-flex"));
});

test("menyu: ochiladi, fokus birinchi bandda, Escape yopadi va fokusni qaytaradi, tashqariga bosish yopadi", () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  const more = screen.getByLabelText("Boshqa amallar");
  fireEvent.click(more);
  assert.equal(more.getAttribute("aria-expanded"), "true");
  const item = screen.getByRole("menuitem");
  assert.equal(item.textContent, "Slaydni o‘chirish");
  assert.ok(document.activeElement === item, "ochilganda fokus birinchi bandda");
  assert.equal(more.getAttribute("aria-controls"), document.querySelector("[data-slide-more-panel]")!.id);
  assert.ok(document.querySelector("[data-slide-more-panel]")!.textContent?.includes(" · "), "shablon nomi menyuda ko'rinadi");

  fireEvent.keyDown(item, { key: "Escape" });
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0, "Escape yopadi");
  assert.ok(document.activeElement === more, "fokus tugmaga qaytadi");

  fireEvent.click(more);
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 1);
  fireEvent.pointerDown(document.body);
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0, "tashqariga bosish yopadi");
});

test("menyu orqali slaydni o'chirish ham IKKI bosishda (FE-07), bitta slaydli dekada band o'chiq", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  fireEvent.click(screen.getByLabelText("Boshqa amallar"));
  fireEvent.click(screen.getByRole("menuitem"));
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "1 / 3", "birinchi bosish faqat tasdiq so'raydi");
  assert.equal(screen.getByRole("menuitem").textContent, "Rostdan?");
  await act(async () => {
    await new Promise((r) => setTimeout(r, CONFIRM_MIN_MS + 30));
  });
  fireEvent.click(screen.getByRole("menuitem"));
  assert.equal(document.querySelector("[data-slide-page]")?.textContent, "1 / 2", "tasdiqdan keyin slayd o'chdi");
  cleanup();

  render(h(SlideViewer, { doc: makeDoc([slides[0]]), gen: gen(makeDoc([slides[0]])) }));
  fireEvent.click(screen.getByLabelText("Boshqa amallar"));
  assert.equal(document.querySelectorAll('[role="menuitem"]:not([disabled])').length, 0, "yagona slaydni o'chirib bo'lmaydi");
});

test("passiv ko'ruvchida (gen yo'q) menyu faqat ma'lumot beradi, o'chirish bandi yo'q", () => {
  render(h(SlideViewer, { doc: makeDoc() }));
  fireEvent.click(screen.getByLabelText("Boshqa amallar"));
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0);
});

// ══════════════════════════════════ Mobil eskiz tasmasi va sensorli rasm tugmalari
test("mobil eskiz tasmasi: moslashda to'r (qolgan joyni egallaydi), kattalashtirilganda bir qator", async () => {
  render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  const strip = () => document.querySelector('[data-rail="strip"]') as HTMLElement;
  assert.equal(strip().getAttribute("data-strip-layout"), "grid");
  assert.ok(strip().className.includes("md:hidden"));
  assert.ok(strip().className.includes("overflow-y-auto") && strip().className.includes("flex-1"));
  // Sahna mobilda 16:9 (slayd kengligi bo'yicha), pastda joy qoladi.
  assert.ok(stage().className.includes("max-md:aspect-video"));
  fireEvent.click(screen.getByLabelText("Kattalashtirish"));
  assert.equal(strip().getAttribute("data-strip-layout"), "row", "kattalashtirilganda sahnaga joy beriladi");
  assert.ok(strip().className.includes("overflow-x-auto"));
  assert.ok(!stage().className.includes("max-md:aspect-video"), "kattalashtirilganda sahna qolgan balandlikni oladi");
  assert.equal(strip().querySelectorAll("[data-strip-index]").length, slides.length);
});

test("rasm tugmalari sensorli qurilmada slayd ustida DOIM turmaydi: tegilganda chiqadi", () => {
  const withImg: SlideModel[] = [
    { id: "s0", layout: "title", title: "Muqova", subtitle: "Izoh", image: { url: "data:image/png;base64,AAAA" } } as SlideModel,
    ...slides.slice(1),
  ];
  render(h(SlideViewer, { doc: makeDoc(withImg), gen: gen(makeDoc(withImg)) }));
  const controls = document.querySelector("[data-slide-image-controls]");
  assert.ok(controls, "rasm tugmalari qatlami bor");
  assert.ok(controls!.textContent?.includes("O‘z rasmim"));
  const f = frame();
  // MUTATSIYA: CSS qoidasi olib tashlansa — sensorli qurilmada tugmalar slaydni doim yopadi.
  assert.ok(f.className.includes("[@media(hover:none)]:[&:not([data-touch-sel])_[data-slide-image-controls]]:hidden"), "sensorli yashirish qoidasi");
  assert.equal(f.hasAttribute("data-touch-sel"), false, "dastlab tanlanmagan");
  fireEvent.pointerDown(f, { pointerType: "mouse" });
  assert.equal(f.hasAttribute("data-touch-sel"), false, "sichqoncha tanlov holatini o'zgartirmaydi");
  fireEvent.pointerDown(f, { pointerType: "touch" });
  assert.equal(f.hasAttribute("data-touch-sel"), true, "slaydga tegilganda tugmalar chiqadi");
  fireEvent.pointerDown(stage(), { pointerType: "touch" });
  assert.equal(f.hasAttribute("data-touch-sel"), false, "sahnaning bo'sh joyiga tegilsa tushadi");
  fireEvent.pointerDown(f, { pointerType: "touch" });
  fireEvent.click(screen.getByLabelText("Keyingi sahifa"));
  assert.equal(frame().hasAttribute("data-touch-sel"), false, "boshqa slaydga o'tilganda tushadi");
});

// ══════════════════════════════════ (e) Taqdimot
test("taqdimot rejimi: panel yo'q, sahna AVVALGI klasslar bilan, Escape yopadi", async () => {
  const { container } = render(h(SlideViewer, { doc: makeDoc(), gen: gen(makeDoc()) }));
  fireEvent.click(screen.getByLabelText("To‘liq ekran"));
  assert.equal(document.querySelector("[data-slide-toolbar]"), null, "taqdimotda asboblar paneli yo'q");
  assert.equal(stage().getAttribute("data-slide-stage"), "present");
  assert.equal(stage().className, "flex min-h-0 flex-1 items-center justify-center", "taqdimot sahnasi o'zgarmagan");
  assert.ok((container.firstElementChild as HTMLElement).className.includes("fixed inset-0 z-50 bg-black"));
  assert.equal(document.querySelector('[data-rail="strip"]'), null);
  assert.ok(!/overflow-(auto|hidden)/.test(stage().className));
  fireEvent.keyDown(document.body, { key: "Escape" });
  assert.ok(document.querySelector("[data-slide-toolbar]"), "Escape taqdimotni yopadi");
});
