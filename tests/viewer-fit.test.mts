import test from "node:test";
import assert from "node:assert/strict";
import { A4, FIT_MAX, LANDSCAPE, ZOOM_STEPS, fitZoom, zoomStep } from "../lib/viewers/metrics.ts";

/**
 * Varaqli ko'ruvchilarning standart masshtabi (viewer redesign V1,
 * `docs/viewer/PLAN.md` egasi qarori 3): ustun eniga sig'dirish, PASTGA
 * yaxlitlash (hech qachon ustundan keng emas), 125 % chegara, telefonda
 * haqiqiy sig'dirish (50 % pol yo'q).
 *
 * Mutatsiyalar (har biri qizardi):
 *   1. `FIT_MAX` o'rniga 150 → «keng ekranda 125 %» testi;
 *   2. pastga emas, ENG YAQIN zinaga (eski `reduce`) → «hech qachon keng
 *      emas» testi (albom 1 110 px ustunda 100 % bo'lib chiqib ketardi);
 *   3. `Math.max(50, …)` pol qaytarildi → «telefonda haqiqiy sig'dirish».
 */

/** Sig'dirilgan varaq eni ustundan oshmaydi — asosiy kafolat. */
function assertFits(avail: number, sheet: number) {
  const z = fitZoom(avail, sheet);
  assert.ok((sheet * z) / 100 <= avail + 1e-6, `avail=${avail} sheet=${sheet}: ${z}% → ${(sheet * z) / 100}px ustundan keng`);
  return z;
}

test("fitZoom: keng ustunda 125 % dan oshmaydi (150 % da A4 1,8 ekran bo'yi edi)", () => {
  assert.equal(FIT_MAX, 125);
  assert.equal(fitZoom(1600, A4.wPx), 125);
  assert.equal(fitZoom(5000, A4.wPx), 125);
  assert.equal(fitZoom(5000, LANDSCAPE.wPx), 125);
});

test("fitZoom: 100 % dan yuqorida ZOOM_STEPS zinasiga PASTGA (99 % emas, 113 → 100)", () => {
  assert.equal(fitZoom(A4.wPx, A4.wPx), 100, "aniq 100 % — suzuvchi nuqta 99.999… ga tushmasin");
  assert.equal(fitZoom(900, A4.wPx), 100, "113 % → 100");
  assert.equal(fitZoom(Math.ceil(A4.wPx * 1.25), A4.wPx), 125);
  assert.equal(fitZoom(Math.ceil(A4.wPx * 1.25) - 2, A4.wPx), 100, "124.8 % → 100 (yuqoriga emas)");
  for (const z of [100, 125]) assert.ok((ZOOM_STEPS as readonly number[]).includes(z));
});

test("fitZoom: hech qachon ustundan keng emas — 200…2 600 px har 7 px, A4 va albom", () => {
  for (let avail = 200; avail <= 2600; avail += 7) {
    assertFits(avail, A4.wPx);
    assertFits(avail, LANDSCAPE.wPx);
  }
});

test("fitZoom: albom varaq (texnologik xarita) O'Z eni bo'yicha sig'adi — 1 110 px ustunda 98 %, 100 % emas", () => {
  // R2: albom 1 123 px; eski «eng yaqin zina» 96 % → 100 % qilib har o'lchamda yonga chiqarardi.
  assert.equal(assertFits(1110, LANDSCAPE.wPx), 98);
  assert.equal(assertFits(1664, LANDSCAPE.wPx), 125);
  assert.equal(assertFits(700, LANDSCAPE.wPx), 62, "tor ustunda 50 zinasiga emas — haqiqiy sig'dirish");
});

test("fitZoom: telefonda haqiqiy sig'dirish — 50 % pol yo'q (390 px ekran, px-3 chekinish)", () => {
  const avail = 390 - 24;
  assert.equal(assertFits(avail, A4.wPx), 46);
  assert.equal(assertFits(avail, LANDSCAPE.wPx), 32);
  assert.equal(assertFits(360 - 24, A4.wPx), 42);
});

test("fitZoom: o'lchab bo'lmasa (0, manfiy, NaN) — 100 % (jsdom/SSR)", () => {
  assert.equal(fitZoom(0, A4.wPx), 100);
  assert.equal(fitZoom(-10, A4.wPx), 100);
  assert.equal(fitZoom(Number.NaN, A4.wPx), 100);
  assert.equal(fitZoom(800, 0), 100);
  assert.ok(fitZoom(5, A4.wPx) >= 10, "juda tor ustunda ham musbat");
});

test("zoomStep: qo'shni zina joriy qiymatdan — zinada bo'lmagan 46 % dan «−» kattaroqqa sakramaydi", () => {
  assert.equal(zoomStep(46, 1), 50);
  assert.equal(zoomStep(46, -1), 46, "eng kichik zinadan past — o'zgarmaydi");
  assert.equal(zoomStep(88, -1), 75);
  assert.equal(zoomStep(88, 1), 90);
  assert.equal(zoomStep(100, 1), 125);
  assert.equal(zoomStep(100, -1), 90);
  assert.equal(zoomStep(150, 1), 150);
  assert.equal(zoomStep(50, -1), 50);
});
