import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Muharrir» (editorial) — keys va hikoya shabloni dizayni.
 *
 * Jurnal maketi tili: o'ngda TIK kadr ustuni (butun balandlik, ichida
 * ingichka aksent ramkasi), chapda esa tipografika — mayda kapital
 * kicker, ulkan DEKORATIV raqam, qalin sarlavha. Bandlar ro'yxat emas,
 * ikki ustunli ABZATSLAR (har birining oldida yirik raqam — «drop cap»
 * o'rnida), reja esa ingichka chiziqlar bilan ajratilgan, raqamlari
 * o'ngga tekislangan ro'yxat. Iqtibos — Georgia serif pull-quote.
 */
/** O'ng kadr ustuni — dizaynning imzo elementi. */
const COL: Box = { x: 8.55, y: 0, w: 4.783, h: 7.5 };
/** Chap (matn) zonasi. */
const TX = 0.9;
const TW = 7.15;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * O'ng ustun: `surface` mat, ustida kadr, ustida ingichka aksent ramka.
 *
 * Rasm YO'Q bo'lsa ustun to'q blokka aylanadi va ichida yirik
 * dekorativ tirnoq turadi — maket baribir «yarim bo'sh» ko'rinmaydi.
 */
function pushColumn(layers: SlideLayer[], s: SlideModel, theme: SlideTheme): void {
  if (s.image?.url) {
    layers.push({ t: "rect", box: { ...COL }, fill: { color: theme.surface } });
    layers.push({ t: "image", box: { ...COL }, url: s.image.url });
  } else {
    layers.push({ t: "rect", box: { ...COL }, fill: { color: theme.titleBg } });
    layers.push({
      t: "text",
      box: { x: COL.x, y: 2.1, w: COL.w, h: 3.0 },
      text: "”",
      color: theme.titleText,
      size: 150,
      bold: true,
      font: "Georgia",
      align: "center",
      valign: "middle",
    });
  }
  layers.push({
    t: "rect",
    box: { x: COL.x + 0.3, y: 0.32, w: COL.w - 0.6, h: 6.86 },
    line: { color: theme.accent, width: 1.25 },
  });
}

/** Jurnal sarlavhasi — mayda kapital matn + butun kenglikdagi ingichka chiziq. */
function pushHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, w: number, reserve: number): void {
  const { fitSize } = LAYOUT_KIT;
  const box: Box = { x: TX, y: 0.45, w: w - reserve, h: 0.92 };
  layers.push({
    t: "text",
    box,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, box, 30, 18),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TX, y: 1.5, w, h: 0.05 }, fill: { color: theme.accent } });
}

/** Titul — chapda kicker + ulkan raqam + sarlavha, o'ngda kadr ustuni. */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushColumn(layers, s, theme);
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: TX, y: 1.0, w: TW, h: 0.4 },
      text: s.kicker,
      color: theme.muted,
      size: 12,
      bold: true,
      uppercase: true,
      tracking: 2.6,
      src: { f: "kicker" },
    });
  }
  layers.push({
    t: "text",
    box: { x: TX - 0.05, y: 1.45, w: 3.0, h: 1.6 },
    text: two(index + 1),
    color: theme.accentInk,
    size: 84,
    bold: true,
    valign: "middle",
  });
  layers.push({ t: "rect", box: { x: TX, y: 3.12, w: TW, h: 0.04 }, fill: { color: theme.accent, alpha: 0.6 } });
  const titleBox: Box = { x: TX, y: 3.35, w: TW, h: 2.0 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 36, 21),
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: TX, y: 5.5, w: TW, h: 1.1 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 16, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TX, w: TW }, false);
  return { bg: theme.bg, layers };
}

/** Bo'lim — tepada ulkan dekorativ raqam, ostida chiziq va bo'lim nomi. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push({
    t: "text",
    box: { x: 0.8, y: 0.95, w: 5.0, h: 2.15 },
    text: two(index + 1),
    color: theme.accentInk,
    size: 108,
    bold: true,
    valign: "middle",
  });
  layers.push({ t: "rect", box: { x: 0.85, y: 3.35, w: 11.6, h: 0.03 }, fill: { color: theme.accent } });
  const titleBox: Box = { x: 0.85, y: 3.65, w: 11.6, h: 1.4 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 44, 24),
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: 0.85, y: 5.2, w: 11.6, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 13),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/**
 * Bandlar — IKKI USTUNLI abzatslar, har birining oldida yirik raqam.
 *
 * Nuqtali ro'yxat ATAYLAB ishlatilmadi (`bullets: false`): keys va
 * hikoya matni gap bo'lib o'qiladi, ro'yxat esa uni «konspekt»ga
 * aylantirardi. Har band alohida qatlam — shuning uchun har biri
 * o'z `src` ini ko'taradi va ko'ruvchida joyida tahrirlanadi.
 */
function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const tw = 11.6;
  pushHead(layers, s, theme, tw, ctx.reserve);
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const cols = items.length > 2 ? 2 : 1;
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const gutter = 0.7;
  const colW = (tw - gutter * (cols - 1)) / cols;
  const zoneY = 1.85;
  const zoneH = 6.7 - zoneY;
  /*
   * Katakcha balandligi CHEKLANADI: qisqa bandda zonani teng bo'lish
   * abzatslar orasida 2 dyuymli bo'shliq qoldirar va ustun «yarim
   * yuklangan» ko'rinardi (PDF da ko'rindi).
   */
  const rowH = Math.min(1.95, zoneH / rows);
  items.forEach((line, i) => {
    // Ustun bo'yicha to'ldiriladi (gazeta ustuni kabi), qator bo'yicha emas.
    const c = Math.floor(i / rows);
    const r = i % rows;
    const x = TX + c * (colW + gutter);
    const y = zoneY + r * rowH;
    // Har abzats ustida ingichka chiziq — gazeta ustunini bog'lab turadi.
    layers.push({ t: "rect", box: { x, y, w: colW, h: 0.02 }, fill: { color: theme.accent, alpha: 0.4 } });
    layers.push({
      t: "text",
      box: { x, y: y + 0.14, w: 0.72, h: 0.62 },
      text: two(i + 1),
      color: theme.accentInk,
      size: 32,
      bold: true,
      valign: "middle",
    });
    const box: Box = { x: x + 0.8, y: y + 0.16, w: colW - 0.8, h: rowH - 0.42 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt + 1, ctx.bodyType.minPt - 1),
      valign: "top",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TX, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Reja — mundarija: chapda nom, o'ngda raqam, ostida ingichka chiziq. */
function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const tw = 11.6;
  pushHead(layers, s, theme, tw, ctx.reserve);
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const n = Math.max(1, items.length);
  const zoneY = 2.0;
  const zoneH = 6.6 - zoneY;
  const rowH = Math.min(1.1, zoneH / n);
  const y0 = zoneY + Math.max(0, (zoneH - n * rowH) / 2);
  items.forEach((line, i) => {
    const y = y0 + i * rowH;
    const box: Box = { x: TX, y, w: tw - 1.4, h: rowH - 0.1 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt + 2, ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
    layers.push({
      t: "text",
      box: { x: TX + tw - 1.0, y, w: 1.0, h: rowH - 0.1 },
      text: two(i + 1),
      color: theme.accentInk,
      size: 22,
      bold: true,
      align: "right",
      valign: "middle",
    });
    layers.push({ t: "rect", box: { x: TX, y: y + rowH - 0.08, w: tw, h: 0.02 }, fill: { color: theme.accent, alpha: 0.45 } });
  });
  pushFooter(layers, s, theme, index, total, { x: TX, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos — chapda yirik Georgia pull-quote, o'ngda kadr ustuni. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushColumn(layers, s, theme);
  layers.push({
    t: "text",
    box: { x: TX - 0.1, y: 0.85, w: 2.0, h: 1.3 },
    text: "“",
    color: theme.accentInk,
    size: 84,
    bold: true,
    font: "Georgia",
    valign: "middle",
  });
  const quote = s.quote || s.title;
  const qBox: Box = { x: TX, y: 2.15, w: TW, h: 3.0 };
  layers.push({
    t: "text",
    box: qBox,
    text: quote,
    color: theme.text,
    size: fitSize(quote, qBox, 30, 15),
    italic: true,
    font: "Georgia",
    valign: "middle",
    src: { f: "quote" },
  });
  layers.push({ t: "rect", box: { x: TX, y: 5.35, w: 1.5, h: 0.04 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: TX, y: 5.55, w: TW, h: 0.55 },
    text: s.quoteBy || "",
    color: theme.muted,
    size: 14,
    bold: true,
    uppercase: true,
    tracking: 2.4,
    valign: "middle",
    src: { f: "quoteBy" },
  });
  pushFooter(layers, s, theme, index, total, { x: TX, w: TW }, false);
  return { bg: theme.bg, layers };
}

/** Yakun — kadr ustuni va chapda aksent ramkaga olingan xulosa. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushColumn(layers, s, theme);
  layers.push({ t: "rect", box: { x: 0.72, y: 1.4, w: 7.5, h: 4.55 }, line: { color: theme.accent, width: 1.25 } });
  const titleBox: Box = { x: 1.15, y: 2.0, w: 6.65, h: 1.95 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 38, 22),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: 1.15, y: 4.08, w: 1.6, h: 0.06 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: 1.15, y: 4.35, w: 6.65, h: 1.35 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 17, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TX, w: TW }, false);
  return { bg: theme.bg, layers };
}

export const editorialVisual: VisualSpec = {
  id: "editorial",
  base: "cards",
  photo: {
    title: { ...COL },
    section: null,
    bullets: null,
    agenda: null,
    quote: { ...COL },
    closing: { ...COL },
  },
  plan: {
    title: planTitle,
    section: planSection,
    bullets: planBullets,
    agenda: planAgenda,
    quote: planQuote,
    closing: planClosing,
  },
};
