import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ImageViewer } from "../../components/viewers/ImageViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * Rasm / infografika ko'ruvchisi — flow ramka (viewer redesign V4).
 *
 * Shartnoma:
 *  - ichki vertikal scroll qutisi YO'Q (sahifa scroll bo'ladi), sarlavha
 *    qatori `sticky top-[var(--result-header-h)]`;
 *  - rasm amallari (kattalashtirish, yuklash) hover'ga bog'lanmagan:
 *    `opacity-0`/`group-hover` yo'q — sensorli ekranda ko'rinadi;
 *  - lightbox: Esc yopadi va fokus ochgan tugmaga qaytadi, ←/→ almashtiradi;
 *  - infografika: bitta tik plakat ustun kengligida, «To'liq o'lcham» tabiiy
 *    o'lchamda ochadi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. amallar konteyneriga `opacity-0 group-hover:opacity-100` qaytarildi → «hover'siz»;
 *   2. tanaga `overflow-auto` qaytarildi → «ichki scroller yo'q»;
 *   3. `useDialog` o'rniga qo'lda Esc (fokus qaytarilmaydi) → «fokus qaytadi»;
 *   4. `openAt(0, true)` → `openAt(0)` → «to'liq o'lcham».
 */
afterEach(() => cleanup());

const img = (id: string, w = 800, h2 = 800) => ({ id, url: `/${id}.png`, w, h: h2, mime: "image/png" });

function multiDoc(): AcademicDoc {
  return {
    meta: { topic: "Bahor" },
    images: [img("i1"), img("i2"), img("i3")],
    imageStyle: "photo",
    imageRatio: "1:1",
  } as unknown as AcademicDoc;
}

function posterDoc(): AcademicDoc {
  return {
    meta: { topic: "Suv aylanishi" },
    images: [img("p1", 1080, 1630)],
    infographic: { v: 1, spec: { title: "Suv aylanishi", type: "list", blocks: [{ id: "b1" }], palette: "indigo", size: "A4", language: "uz" } },
  } as unknown as AcademicDoc;
}

test("flow: ichki vertikal scroller yo'q, sarlavha qatori sticky (--result-header-h)", () => {
  const { container } = render(h(ImageViewer, { doc: multiDoc() }));
  const all = [container, ...Array.from(container.querySelectorAll("*"))];
  const traps = all.filter((el) => /(^|\s)overflow-(y-)?(auto|scroll)\b/.test(el.getAttribute("class") ?? ""));
  assert.equal(traps.length, 0, "ichki scroll qutisi bo'lmasligi kerak");
  const root = container.firstElementChild as HTMLElement;
  assert.ok(!/\bh-full\b|min-h-\[70vh\]/.test(root.className), "ildiz qat'iy balandlikka bog'lanmasin");
  const bar = container.querySelector("[data-image-bar]") as HTMLElement;
  assert.ok(bar.className.includes("sticky"), "sarlavha sticky");
  assert.ok(bar.className.includes("top-[var(--result-header-h,0px)]"), "natija sarlavhasi ostida");
});

test("sensorli ekran: amallar doim ko'rinadi (opacity-0 / group-hover yo'q), har rasmda kattalashtirish + yuklash", () => {
  const { container } = render(h(ImageViewer, { doc: multiDoc() }));
  const boxes = container.querySelectorAll("[data-image-actions]");
  assert.equal(boxes.length, 3);
  for (const b of Array.from(boxes)) {
    assert.ok(!/opacity-0|group-hover/.test(b.className), "amallar hover'ga bog'lanmagan bo'lishi kerak");
    assert.ok(b.querySelector('button[aria-label="Kattalashtirish"]'));
    assert.ok(b.querySelector('button[aria-label="Yuklab olish"]'));
  }
  const html = container.innerHTML;
  assert.ok(!/group-hover/.test(html), "hech qayerda group-hover yo'q");
});

test("lightbox: Esc yopadi va fokus ochgan tugmaga qaytadi; ←/→ almashtiradi, chegarada to'xtaydi", async () => {
  const { container } = render(h(ImageViewer, { doc: multiDoc() }));
  const opener = container.querySelectorAll('[data-image-actions] button[aria-label="Kattalashtirish"]')[1] as HTMLButtonElement;
  opener.focus();
  fireEvent.click(opener);
  const box = container.querySelector("[data-image-lightbox]") as HTMLElement;
  assert.ok(box, "lightbox ochildi");
  assert.equal(box.getAttribute("role"), "dialog");
  assert.equal(box.getAttribute("aria-modal"), "true");
  const src = () => (container.querySelector("[data-image-lightbox] img") as HTMLImageElement).getAttribute("src");
  assert.equal(src(), "/i2.png");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  assert.equal(src(), "/i3.png");
  fireEvent.keyDown(window, { key: "ArrowRight" });
  assert.equal(src(), "/i3.png", "oxirgi rasmdan keyin to'xtaydi");
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  assert.equal(src(), "/i1.png", "birinchi rasmdan keyin to'xtaydi");
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  assert.ok(!container.querySelector("[data-image-lightbox]"), "Esc yopdi");
  assert.ok(document.activeElement === opener, "fokus ochgan tugmaga qaytdi");
});

test("lightbox: sensorli almashtirish tugmalari (oldingi/keyingi) + yopish tugmasi + fon bosilsa yopiladi", () => {
  const { container } = render(h(ImageViewer, { doc: multiDoc() }));
  fireEvent.click(container.querySelector('[data-image-grid] figure button[aria-label="Kattalashtirish"]') as HTMLElement);
  const q = (l: string) => container.querySelector(`[data-image-lightbox] button[aria-label="${l}"]`) as HTMLButtonElement;
  assert.ok(q("Oldingi rasm").disabled, "birinchida «oldingi» o'chiq");
  fireEvent.click(q("Keyingi rasm"));
  assert.equal((container.querySelector("[data-image-lightbox] img") as HTMLImageElement).getAttribute("src"), "/i2.png");
  fireEvent.click(q("Yopish"));
  assert.ok(!container.querySelector("[data-image-lightbox]"));
  fireEvent.click(container.querySelector('[data-image-grid] figure button[aria-label="Kattalashtirish"]') as HTMLElement);
  fireEvent.click(container.querySelector("[data-image-lightbox]") as HTMLElement); // fon
  assert.ok(!container.querySelector("[data-image-lightbox]"), "fon yopadi");
});

test("infografika: bitta tik plakat ustun kengligida, sticky qatorda «To'liq o'lcham» — tabiiy o'lchamda lightbox", () => {
  const { container } = render(h(ImageViewer, { doc: posterDoc() }));
  const grid = container.querySelector("[data-image-grid]") as HTMLElement;
  assert.match(grid.className, /\bmax-w-3xl\b/, "plakat ustun kengligida");
  assert.match(grid.className, /\bgrid-cols-1\b/);
  const bar = container.querySelector("[data-image-bar]") as HTMLElement;
  const full = bar.querySelector("[data-poster-full]") as HTMLButtonElement;
  assert.ok(full, "«To'liq o'lcham» sticky qatorda");
  assert.match(full.textContent ?? "", /To‘liq o‘lcham/);
  fireEvent.click(full);
  const stage = container.querySelector("[data-lightbox-stage]") as HTMLElement;
  assert.ok(stage, "lightbox ochildi");
  assert.match(stage.className, /overflow-auto/, "tabiiy o'lchamda lightbox ichida scroll");
  const im = stage.querySelector("img") as HTMLImageElement;
  assert.equal(im.style.width, "1080px", "tabiiy kenglik");
  // Almashtirgich ekranga sig'dirishga qaytaradi.
  const toggle = container.querySelector("[data-lightbox-size]") as HTMLButtonElement;
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  fireEvent.click(toggle);
  assert.ok(!/overflow-auto/.test((container.querySelector("[data-lightbox-stage]") as HTMLElement).className));
});

test("oddiy rasm lightbox'i ekranga sig'adi (to'liq o'lcham faqat so'ralganda)", () => {
  const { container } = render(h(ImageViewer, { doc: multiDoc() }));
  fireEvent.click(container.querySelector('[data-image-grid] figure button[aria-label="Kattalashtirish"]') as HTMLElement);
  const stage = container.querySelector("[data-lightbox-stage]") as HTMLElement;
  assert.ok(!/overflow-auto/.test(stage.className));
  assert.equal((stage.querySelector("img") as HTMLImageElement).style.width, "");
});
