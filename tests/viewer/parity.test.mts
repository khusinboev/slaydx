import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement as h } from "react";
import { LayerView, SlideCanvas } from "../../components/viewers/SlideCanvas.tsx";
import { fontCss } from "../../lib/generation/slide-fonts.ts";
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

// ══════════════════════════════════ Shrift oilasi va `hideSrc` (tahrir qatlami uchun)

test("qatlamda `font` bo'lsa ko'ruvchi `font-family` beradi — reyestrdagi CSS ro'yxati bilan", () => {
  /*
   * Tahoma ning `em` i Arial bilan bir xil (0.55) — `applyFontOverrides`
   * o'lchamni qayta hisoblamaydi, ya'ni HTML dagi YAGONA farq
   * `font-family` bo'lishi kerak. (Georgia/Verdana bilan o'lcham ham
   * qisqarardi — u alohida, `slide-font-size.test` da sinalgan.)
   */
  const withFont: SlideModel = { ...slide, font: { '{"f":"title"}': "tahoma" } };
  const plain = renderToStaticMarkup(h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10 }));
  const html = renderToStaticMarkup(h(SlideCanvas, { slide: withFont, theme, visual: "classic", index: 1, total: 10 }));
  const count = (s: string) => s.split("font-family:").length - 1;
  assert.equal(count(plain), 1, "standart yo'lda faqat ildiz font-family (SLIDE_FONT)");
  assert.equal(count(html), 2, "tanlangan qatlam o'z font-family sini oladi");
  // React `"` ni `&quot;` qilib chizadi — reyestr CSS i ham shu shaklda qidiriladi.
  const css = fontCss("Tahoma").replace(/"/g, "&quot;");
  const tail = `;font-family:${css}"`;
  assert.ok(html.includes(tail), "PPTX fontFace (Tahoma) bilan bir xil oiladan CSS ro'yxati, style OXIRIDA");
  // Boshqa hamma narsa HTML da AYNAN o'zgarmaydi (bayt-baytiga).
  assert.equal(html.replace(`;font-family:${css}`, ""), plain, "faqat tanlangan qatlam farq qilishi kerak");
});

test("`hideSrc` — faqat o'sha qatlam visibility:hidden, HTML boshqa joyda o'zgarmaydi", () => {
  const plain = renderToStaticMarkup(h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10 }));
  const key = '{"f":"bullets","i":0}';
  const html = renderToStaticMarkup(h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10, hideSrc: key }));
  assert.equal(html.split("visibility:hidden").length - 1, 1, "aynan bitta qatlam yashirinadi");
  const i = html.indexOf("visibility:hidden");
  const listStart = html.indexOf('data-src-list="1"');
  assert.ok(i > 0 && listStart > i && listStart - i < 80, "yashiringan qatlam — bandlar ro'yxati (srcLines[0] kaliti)");
  assert.equal(html.replace("visibility:hidden;", "").replace(";visibility:hidden", ""), plain, "qolgan HTML aynan eskicha");
  const none = renderToStaticMarkup(h(SlideCanvas, { slide, theme, visual: "classic", index: 1, total: 10, hideSrc: '{"f":"quote"}' }));
  assert.equal(none, plain, "mos qatlam bo'lmasa hech narsa yashirinmaydi");
});

// ══════════════════════════════════ Shablonlar 2: dumaloq rasm va soya pariteti

test("dumaloq rasm (`shape: circle`) → border-radius:50%, soya (`shadow`) → box-shadow; yo'q bo'lsa HTML eskicha", () => {
  const box = { x: 1, y: 1, w: 2, h: 2 };
  const plain = renderToStaticMarkup(h(LayerView, { layer: { t: "image", box, url: "https://example.test/a.png" } }));
  const round = renderToStaticMarkup(h(LayerView, { layer: { t: "image", box, url: "https://example.test/a.png", shape: "circle" } }));
  assert.ok(!plain.includes("border-radius"), "oddiy rasm — burchak yo'q");
  assert.ok(round.includes("border-radius:50%"), "dumaloq rasm — PPTX `rounding: true` bilan bir xil");
  assert.equal(round.replace(";border-radius:50%", ""), plain, "boshqa hech narsa o'zgarmaydi");

  const flat = renderToStaticMarkup(h(LayerView, { layer: { t: "rect", box, fill: { color: "#ffffff" }, radius: 0.1 } }));
  const shadow = renderToStaticMarkup(h(LayerView, { layer: { t: "rect", box, fill: { color: "#ffffff" }, radius: 0.1, shadow: true } }));
  assert.ok(!flat.includes("box-shadow"), "soyasiz karta");
  assert.ok(shadow.includes("box-shadow:0 2px 6px rgba(0,0,0,0.22)"), "soya PPTX `shadow` (blur 6, offset 2, 22%) bilan bir xil");
  assert.equal(shadow.replace(";box-shadow:0 2px 6px rgba(0,0,0,0.22)", ""), flat);
});
