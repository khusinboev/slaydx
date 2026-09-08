import test from "node:test";
import assert from "node:assert/strict";
import { planSlide, statUnit, type SlideLayer } from "../lib/generation/slide-layout.ts";
import { getSlideTheme } from "../lib/generation/slide-themes.ts";
import { SLIDE_THEMES } from "../lib/generation/slide-themes.ts";
import type { SlideModel } from "../lib/generation/slide-types.ts";

/**
 * AUDIT-8 da PDF orqali topilgan uch nuqson.
 *
 * Alohida faylda, chunki `tests/slide-layout.test.mts` ni ayni paytda
 * boshqa ish oqimlari ham to'ldirmoqda.
 */

const theme = getSlideTheme("atlas");
const texts = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "text" }> => l.t === "text");
const rects = (ls: SlideLayer[]) => ls.filter((l): l is Extract<SlideLayer, { t: "rect" }> => l.t === "rect");

const chartable: SlideModel = {
  id: "s",
  layout: "stats",
  title: "Ko‘rsatkichlar",
  stats: [
    { value: "97.5%", label: "Okeanlar ulushi" },
    { value: "2.5%", label: "Chuchuk suv" },
    { value: "0.3%", label: "Ko‘l va daryolar" },
  ],
};

// ------------------------------------------------------- N-1: dense o'qi

test("dense diagrammasi to'q sahifada oq tasma qoldirmaydi", () => {
  const dense = planSlide(chartable, theme, "dense", 1, 10);
  const light = planSlide(chartable, theme, "classic", 1, 10);

  // Yorug' sahifada yo'lakcha `surface` (krem, shaffofmas).
  assert.ok(
    rects(light.layers).some((r) => r.fill?.color === theme.surface && r.fill?.alpha == null),
    "classic da yo'lakcha `surface` bo'lishi kerak",
  );
  /*
   * To'q sahifada yo'lakcha YORUG' va shaffofmas bo'lmasin — aynan shu
   * 2.5% li qatorni ham «to'la» qilib ko'rsatardi. Eng uzun ustunning
   * o'zi to'la bo'lishi TABIIY (u `max`), shuning uchun tekshiruv
   * uzunlikka emas, YO'LAKCHA RANGIGA qaraydi.
   */
  const lightTrack = rects(dense.layers).filter(
    (r) => r.fill?.color === theme.surface && (r.fill.alpha ?? 1) > 0.5,
  );
  assert.equal(lightTrack.length, 0, `to'q sahifada ${lightTrack.length} ta yorug' yo'lakcha qoldi`);
  assert.ok(
    rects(dense.layers).some((r) => r.fill?.color === "#ffffff" && (r.fill.alpha ?? 1) < 0.3),
    "dense da yo'lakcha shaffof oq bo'lishi kerak",
  );

  /*
   * To'q sahifada hamma ustun `accent` dan bo'lsin: `accent2` shaffof
   * yo'lakcha bilan qo'shilib ketardi va kichik qiymatlar (2.5%, 0.3%)
   * PDF da umuman ko'rinmasdi.
   */
  /*
   * Ustunlar RANG bo'yicha emas, JOYLASHUV bo'yicha topiladi.
   *
   * `atlas` da `accent2` (#0B1F3A) — bu aynan `titleBg`, ya'ni `dense`
   * sahifaning foni. Ranggа qarab filtrlansa, to'la ekranli fon
   * to'rtburchagi ham «ustun» bo'lib sanalardi. Aynan shu ustma-ustlik
   * nuqsonning o'zi ham edi: eski kodda 2- va 3-ustun navy fonda navy
   * chizilardi.
   */
  const barX = 0.5 + 0.18 + 3.6 + 0.2;
  const barsAt = (ls: SlideLayer[]) =>
    rects(ls).filter(
      (r) => Math.abs(r.box.x - barX) < 0.01 && (r.fill?.color === theme.accent || r.fill?.color === theme.accent2),
    );
  const denseBars = barsAt(dense.layers);
  assert.equal(denseBars.length, 3, `dense da 3 ta ustun kutilgan, ${denseBars.length} ta chiqdi`);
  assert.equal(
    denseBars.filter((r) => r.fill?.color === theme.accent2).length,
    0,
    "to'q sahifada `accent2` ustun qolmasligi kerak — u fon bilan qo'shilib ketadi",
  );
  // Yorug' sahifada ajratish saqlanadi.
  assert.equal(
    barsAt(light.layers).filter((r) => r.fill?.color === theme.accent2).length,
    2,
    "classic da 2- va 3-ustun `accent2` bilan qoladi",
  );

  // Qiymat matni o'lchangan juftlikdan: `titleText`/`titleBg`.
  assert.ok(
    texts(dense.layers).some((t) => t.text === "97.5%" && t.color === theme.titleText),
    "dense da qiymat `titleText` bilan chizilishi kerak",
  );
  assert.ok(
    texts(light.layers).some((t) => t.text === "97.5%" && t.color === theme.accentInk),
    "classic da qiymat `accentInk` bilan qoladi",
  );
});

// -------------------------------------------- N-2: birlik taqqoslanishi

test("statUnit qiymatdan birlikni ajratadi", () => {
  assert.equal(statUnit("97.5%"), "%");
  assert.equal(statUnit("4 bosqich"), "bosqich");
  assert.equal(statUnit("12"), "");
  assert.equal(statUnit("2,3 mlrd"), "");
  assert.equal(statUnit("15 °C"), "°C".toLowerCase());
});

test("har xil birlikli qiymatlar bitta o'qqa chizilmaydi", () => {
  const mixed: SlideModel = {
    ...chartable,
    stats: [
      { value: "97.5%", label: "Okeanlar" },
      { value: "2.5%", label: "Chuchuk suv" },
      { value: "4 bosqich", label: "Aylanish" },
    ],
  };
  /*
   * «4» ni «97.5» ga nisbatan o'lchash yolg'on taqqoslash beradi —
   * jonli `report` dekasida aynan shu chiqqan edi. Bunday holatda
   * karta ko'rinishi to'g'riroq: u qiymatlarni bir-biriga o'lchamaydi.
   */
  const p = planSlide(mixed, theme, "dense", 1, 10);
  assert.equal(
    texts(p.layers).filter((t) => t.size === 16 && t.bold && t.text === "4 bosqich").length,
    0,
    "aralash birlikda diagramma chizilmasligi kerak",
  );
  assert.ok(
    texts(p.layers).some((t) => t.text === "4 bosqich" && (t.align === "center")),
    "aralash birlikda karta ko'rinishiga tushishi kerak",
  );

  // Bir xil birlik — diagramma chiziladi.
  const chart = planSlide(chartable, theme, "dense", 1, 10);
  assert.ok(
    texts(chart.layers).some((t) => t.text === "0.3%" && !t.align),
    "bir xil birlikda diagramma qolishi kerak",
  );
});

// --------------------------------------- N-7: magazine titul rasmsiz

test("magazine titul rasmsiz ham classic dan farq qiladi", () => {
  const cover: SlideModel = { id: "t", layout: "title", title: "Suvning aylanishi", kicker: "Geografiya", subtitle: "Taqdimot" };
  const mag = planSlide(cover, theme, "magazine", 0, 10);
  const classic = planSlide(cover, theme, "classic", 0, 10);
  assert.notDeepEqual(mag, classic, "rasmsiz magazine muqovasi classic bilan bir xil chiqmoqda");

  // Sarlavha pastki yarmida (jurnal muqovasi naqshi), yuqorida emas.
  const magTitle = texts(mag.layers).find((t) => t.text === "Suvning aylanishi");
  const classicTitle = texts(classic.layers).find((t) => t.text === "Suvning aylanishi");
  assert.ok(magTitle && magTitle.box.y > 4, `magazine sarlavhasi pastda bo'lishi kerak, y=${magTitle?.box.y}`);
  assert.ok(classicTitle && classicTitle.box.y < 3.5, "classic sarlavhasi yuqorida qoladi");

  // Rasm bo'lmaganda qorong'ulatuvchi qoplama chizilmaydi (fon allaqachon to'q).
  assert.equal(
    rects(mag.layers).filter((r) => r.fill?.color === "#000000" && (r.fill.alpha ?? 0) > 0).length,
    0,
    "rasmsiz muqovada qora qoplama keraksiz",
  );
});

// ---------------------------------------------------- 15 temada ham

test("dense diagrammasi 15 temaning hammasida o'qiladigan qoladi", () => {
  for (const t of SLIDE_THEMES) {
    const th = getSlideTheme(t.id);
    const p = planSlide(chartable, th, "dense", 1, 10);
    for (const l of p.layers) {
      assert.ok(l.box.x + l.box.w <= 13.34 && l.box.y + l.box.h <= 7.51, `${t.id}: chegaradan chiqdi`);
    }
    assert.ok(
      texts(p.layers).some((x) => x.text === "97.5%" && x.color === th.titleText),
      `${t.id}: qiymat rangi o'lchangan juftlikdan emas`,
    );
  }
});
