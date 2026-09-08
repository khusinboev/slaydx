import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { planSlide, ptToPx } from "../../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../../lib/generation/slide-themes.ts";
import type { SlideModel } from "../../lib/generation/slide-types.ts";

/**
 * «Ko'rdim = oldim» — ko'ruvchi va PPTX bitta `planSlide` dan chizadi,
 * lekin QATLAM MAYDONLARINI bir xil BIRLIKDA talqin qilishi ham shart.
 *
 * `paraSpace` punktda o'lchanadi (`fitLines` uni `box.h * 72` byudjetiga
 * qo'shadi, `render-pptx.ts` esa `paraSpaceAfter` ga punkt beradi), lekin
 * ko'ruvchi uni xom son sifatida CSS pikseliga qo'yardi — bandlar orasi
 * ekranda faylga qaraganda ~25% tor chizilardi.
 */

const theme = getSlideTheme("atlas");

const slide: SlideModel = {
  id: "s",
  layout: "bullets",
  title: "Sarlavha",
  bullets: ["Birinchi band gapi bu yerda.", "Ikkinchi band gapi.", "Uchinchi band gapi."],
};

test("ko'ruvchi paraSpace ni punktdan pikselga o'giradi (PPTX bilan bir xil oraliq)", () => {
  const plan = planSlide(slide, theme, "classic", 1, 10);
  const listLayer = plan.layers.find((l) => l.t === "text" && l.lines?.length);
  assert.ok(listLayer && listLayer.t === "text" && listLayer.paraSpace, "band ro'yxati qatlami topilmadi");
  const pt = listLayer.paraSpace!;
  assert.ok(pt > 8, `sinov ma'noli bo'lishi uchun oraliq standartdan katta bo'lsin, ${pt} pt`);

  const html = renderToStaticMarkup(
    h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10 }),
  );

  const expected = ptToPx(pt);
  /*
   * Xom punkt qiymati piksel sifatida chiqib qolmasin. `pt` va
   * `ptToPx(pt)` sonlari har xil bo'lgani uchun bu ikkisi ajraladi.
   */
  assert.ok(
    html.includes(`margin-bottom:${expected}px`),
    `kutilgan margin-bottom:${expected}px topilmadi (paraSpace ${pt} pt)`,
  );
  assert.ok(
    !html.includes(`margin-bottom:${pt}px`),
    `xom punkt qiymati piksel sifatida chizilmoqda: margin-bottom:${pt}px`,
  );
});

test("ko'ruvchi shrift o'lchamini ham punktdan o'giradi", () => {
  const plan = planSlide(slide, theme, "classic", 1, 10);
  const listLayer = plan.layers.find((l) => l.t === "text" && l.lines?.length);
  assert.ok(listLayer && listLayer.t === "text");
  const html = renderToStaticMarkup(
    h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10 }),
  );
  assert.ok(
    html.includes(`font-size:${ptToPx(listLayer.size)}px`),
    `shrift ${listLayer.size} pt → ${ptToPx(listLayer.size)}px bo'lishi kerak`,
  );
});
