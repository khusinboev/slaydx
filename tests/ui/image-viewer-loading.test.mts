import "./setup.ts";
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { ImageViewer } from "../../components/viewers/ImageViewer.tsx";
import type { AcademicDoc } from "../../lib/generation/types.ts";

/**
 * Rasm / infografika: yuklash holatlari va bitta «Yuklab olish» (V5b).
 *
 * Shartnoma:
 *  - PNG yuklanguncha qora quti emas — rasm NISBATIDAGI neytral skelet
 *    (`aspect-ratio` = w/h, yo'q bo'lsa 1/1); yuklangach yumshoq paydo bo'ladi
 *    (`opacity-0` → `opacity-100`), skelet yo'qoladi;
 *  - yuklanmasa — «Rasm yuklanmadi» + «Qayta urinish» (rasm elementi qayta o'rnatiladi);
 *  - YUKLAB OLISH: sarlavha («Yuklab olish») generatsiya faylini beradi — bitta rasmda
 *    bu AYNAN o'sha PNG, shuning uchun ko'ruvchi satri/plakat/lightbox'da takror tugma YO'Q;
 *    bir nechta rasmda sarlavha ZIP beradi, rasm tugmasi esa BITTA PNG — boshqa fayl, qoladi.
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `onLoad={() => setStatus("loaded")}` olib tashlandi → «yuklangach skelet yo'qoladi»;
 *   2. `style={{ aspectRatio: ratio }}` → qattiq «1 / 1» → «nisbat w/h dan»;
 *   3. `onDownload={single ? undefined : …}` → har doim → «bitta rasmda takror yuklash yo'q»;
 *   4. retry'dagi `setAttempt` olib tashlandi → «qayta urinish img ni qayta o'rnatadi».
 */
afterEach(() => cleanup());

const img = (id: string, w = 800, h2 = 800) => ({ id, url: `/${id}.png`, w, h: h2, mime: "image/png" });
const doc = (images: unknown[], extra: Record<string, unknown> = {}) =>
  ({ meta: { topic: "Bahor" }, images, imageStyle: "photo", imageRatio: "1:1", ...extra }) as unknown as AcademicDoc;
const poster = () =>
  doc([img("p1", 1080, 1630)], { infographic: { v: 1, spec: { title: "Suv aylanishi", type: "list", blocks: [{ id: "b1" }], palette: "indigo", size: "A4", language: "uz" } } });

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const tile = () => q("[data-image-tile]")!;
const pic = () => tile().querySelector("img")!;

test("yuklanguncha: rasm nisbatidagi neytral skelet (qora quti emas), rasm ko'rinmas, amallar bor", () => {
  render(h(ImageViewer, { doc: poster() }));
  assert.equal(tile().getAttribute("data-image-state"), "loading");
  assert.ok(q("[data-image-skeleton]"), "skelet");
  assert.equal(q("[data-image-skeleton]")!.getAttribute("role"), "status");
  assert.match(pic().className, /opacity-0/);
  assert.equal(pic().style.aspectRatio, "1080 / 1630", "MUTATSIYA: qattiq 1/1 bo'lsa plakat nisbati yo'qoladi");
  assert.ok(!/bg-black\b/.test(tile().className), "yuklanguncha qora quti yo'q");
  assert.ok(/bg-white/.test(tile().className), "neytral fon");
});

test("nisbat yo'q (w/h = 0) bo'lsa — 1:1 zaxira", () => {
  render(h(ImageViewer, { doc: doc([img("x", 0, 0)]) }));
  assert.equal(pic().style.aspectRatio, "1 / 1");
});

test("yuklangach: skelet yo'qoladi, rasm paydo bo'ladi (fade-in sinfi), holat «loaded»", () => {
  render(h(ImageViewer, { doc: doc([img("a")]) }));
  fireEvent.load(pic());
  assert.equal(tile().getAttribute("data-image-state"), "loaded");
  assert.ok(!q("[data-image-skeleton]"), "MUTATSIYA: onLoad bo'lmasa skelet abadiy qolardi");
  assert.match(pic().className, /opacity-100/);
  assert.match(pic().className, /transition-opacity/, "yumshoq paydo bo'lish");
  assert.ok(/bg-black/.test(tile().className), "yuklangach to'liq rasm foni");
});

test("yuklanmadi: xabar + «Qayta urinish»; bosilganda img qayta o'rnatiladi va yana yuklanadi", () => {
  render(h(ImageViewer, { doc: doc([img("a")]) }));
  const first = pic();
  fireEvent.error(first);
  assert.equal(tile().getAttribute("data-image-state"), "error");
  assert.match(q("[data-image-error]")!.textContent ?? "", /Rasm yuklanmadi/);
  assert.ok(!q("[data-image-skeleton]"));
  assert.equal(qa("[data-image-actions]").length, 0, "rasm yo'q — kattalashtirish/yuklash amallari ham yo'q");
  fireEvent.click(q("[data-image-retry]")!);
  assert.equal(tile().getAttribute("data-image-state"), "loading", "qayta urinish skeletga qaytaradi");
  assert.notEqual(pic(), first, "MUTATSIYA: setAttempt bo'lmasa img qayta o'rnatilmaydi (brauzer yangidan so'ramaydi)");
  fireEvent.load(pic());
  assert.equal(tile().getAttribute("data-image-state"), "loaded");
  assert.ok(!q("[data-image-error]"));
});

test("har rasm o'z holatiga ega: bittasi xato bo'lsa boshqasi ta'sirlanmaydi", () => {
  render(h(ImageViewer, { doc: doc([img("a"), img("b")]) }));
  const [a, b] = qa("[data-image-tile]");
  fireEvent.error(a.querySelector("img")!);
  fireEvent.load(b.querySelector("img")!);
  assert.equal(a.getAttribute("data-image-state"), "error");
  assert.equal(b.getAttribute("data-image-state"), "loaded");
});

test("BITTA yuklash: bitta rasmda ko'ruvchi ichida «Yuklab olish» yo'q (sarlavhadagi yagona)", () => {
  render(h(ImageViewer, { doc: doc([img("a")]) }));
  fireEvent.load(pic());
  assert.equal(document.querySelectorAll('button[aria-label="Yuklab olish"]').length, 0, "MUTATSIYA: onDownload doim berilsa bitta rasmda takror chiqadi");
  assert.ok(q('[data-image-actions] button[aria-label="Kattalashtirish"]'), "kattalashtirish qoladi");
  // Lightbox ham.
  fireEvent.click(q('[data-image-actions] button[aria-label="Kattalashtirish"]')!);
  assert.ok(q("[data-image-lightbox]"));
  assert.equal(document.querySelectorAll('[data-image-lightbox] button[aria-label="Yuklab olish"]').length, 0, "lightbox da ham takror yuklash yo'q");
});

test("BITTA yuklash: infografika plakatida sarlavha qatorida «Yuklab olish» yo'q, «To'liq o'lcham» qoladi", () => {
  render(h(ImageViewer, { doc: poster() }));
  assert.equal(document.querySelectorAll('button[aria-label="Yuklab olish"]').length, 0);
  assert.ok(!/Yuklab olish/.test(q("[data-image-bar]")!.textContent ?? ""));
  assert.ok(q("[data-poster-full]"), "«To'liq o'lcham» qoladi");
});

test("bir nechta rasm: sarlavha ZIP beradi, shuning uchun har rasmda BITTA PNG yuklash (va lightbox da) qoladi", () => {
  render(h(ImageViewer, { doc: doc([img("a"), img("b"), img("c")]) }));
  assert.equal(qa("[data-image-actions]").length, 3);
  for (const box of qa("[data-image-actions]")) assert.ok(box.querySelector('button[aria-label="Yuklab olish"]'));
  fireEvent.click(qa('[data-image-actions] button[aria-label="Kattalashtirish"]')[1]);
  assert.ok(q('[data-image-lightbox] button[aria-label="Yuklab olish"]'), "lightbox: joriy rasmni yuklash");
});

test("yuklash tugmasi tanlangan rasmning o'zini yuklaydi (a.download = rasm-N.png)", async () => {
  render(h(ImageViewer, { doc: doc([img("a"), img("b")]) }));
  const clicked: Array<{ href: string; download: string }> = [];
  const proto = window.HTMLAnchorElement.prototype as unknown as { click: () => void };
  const orig = proto.click;
  proto.click = function (this: HTMLAnchorElement) {
    clicked.push({ href: this.getAttribute("href") ?? "", download: this.download });
  };
  try {
    await act(async () => fireEvent.click(qa('[data-image-actions] button[aria-label="Yuklab olish"]')[1]));
  } finally {
    proto.click = orig;
  }
  assert.deepEqual(clicked, [{ href: "/b.png", download: "rasm-2.png" }]);
});
