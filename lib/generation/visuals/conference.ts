import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Konferensiya» (conference) — ilmiy konferensiya / loyiha himoyasi dizayni
 * (Program 17, 17-band; «Ilmiy konferensiya» shabloni).
 *
 * `formal` («Himoya») hujjat tilida — serif, qo'sh ramka, rasmsiz. Bu dizayn
 * esa ZAMONAVIY ma'ruza tilida: sans, TO'Q SARLAVHA TASMASI har mazmun
 * slaydi tepasida, titul tasmasi kadr bilan tasma chetidan osilib chiqadi,
 * bo'lim — chapda to'q panel va ulkan raqam, reja — raqamli plitka-qatorlar,
 * yakun («Rahmat») — to'q sahifa va chiziqli «tasma» naqshi. Natija
 * slaydlari (raqamlar, diagramma, jadval, ikki ustun, bosqichlar) `dense`
 * bazasidan — TO'Q sahifada: ma'ruza ritmi «yorug' dalil → to'q natija».
 *
 * Rang qoidasi: aksent (`accent`) faqat to'ldirish; matn — o'lchangan
 * juftliklar (`titleText/titleBg` tasmada, `text/bg`, `muted/bg`).
 */
const X = 0.7;
const ZONE_W = 11.93;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Mazmun slaydi tepasidagi to'q tasma: sarlavha + reja nishoni, ostida aksent chizig'i. */
function pushBand(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, w: number, reserve: number): void {
  const { badgedTitle, pushPlanBadge, W } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: 1.3 }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: 0, y: 1.3, w: W, h: 0.07 }, fill: { color: theme.accent } });
  const boxT = badgedTitle(s, { x: X, y: 0.22, w: w - reserve, h: 0.86 }, 28, 18);
  // To'q tasmada nishon — `titleMuted` (to'q sahifa qoidasi), sarlavha o'qida.
  pushPlanBadge(layers, s, boxT, theme, { dark: true, titleValign: "middle" });
  layers.push({
    t: "text",
    box: boxT.box,
    text: s.title,
    color: theme.titleText,
    size: boxT.size,
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
}

/** Titul: to'q tasma, kadr tasma chetidan osilib chiqadi (offset aksent blok bilan). */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, photo, pushFooter, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: 4.75 }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: 0, y: 4.75, w: W, h: 0.09 }, fill: { color: theme.accent } });
  const slot = conferenceVisual.photo!.title as Box;
  // Offset blok — kadr ostidan chiqib turadi; rasm yo'q bo'lsa ham kompozitsiya to'liq.
  layers.push({ t: "rect", box: { x: slot.x + 0.22, y: slot.y + 0.22, w: slot.w, h: slot.h }, fill: { color: theme.accent } });
  if (s.image?.url) {
    photo(layers, s.image.url, slot, 0);
  } else {
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.titleBg } });
    layers.push({ t: "rect", box: { x: slot.x + 0.35, y: slot.y + 0.35, w: slot.w - 0.7, h: slot.h - 0.7 }, line: { color: theme.titleMuted, width: 1 } });
  }
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: 0.9, y: 0.95, w: 7.7, h: 0.42 },
      text: s.kicker,
      color: theme.titleMuted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.2,
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x: 0.9, y: 1.5, w: 7.7, h: 2.95 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 40, 22, CHAR_EM_BOLD),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: 0.9, y: 5.2, w: 7.7, h: 1.45 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 0.9, w: 7.7 }, false);
  return { bg: theme.bg, layers };
}

/** Bo'lim: chapda to'q panel va ulkan reja raqami, o'ngda sarlavha. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, inkHeight, pushFooter, planNumber, SECTION_TOP, SECTION_BOTTOM, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const PANEL = 4.6;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: PANEL, h: H }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: PANEL, y: 0, w: 0.1, h: H }, fill: { color: theme.accent } });
  // Raqam FAQAT rejadan (`s.plan`); yo'q bo'lsa panel aksent chiziq bilan to'ladi.
  const no = planNumber(s);
  if (no) {
    layers.push({
      t: "text",
      box: { x: 0.6, y: 2.0, w: PANEL - 1.0, h: 2.4 },
      text: no,
      color: theme.titleText,
      size: 110,
      bold: true,
      valign: "middle",
    });
  } else {
    layers.push({ t: "rect", box: { x: 0.9, y: 3.45, w: 1.6, h: 0.1 }, fill: { color: theme.accent } });
  }
  const x = PANEL + 0.9;
  const tw = W - x - 0.7;
  const titleSize = fitSize(s.title, { x, y: 0, w: tw, h: 2.6 }, 42, 22, CHAR_EM_BOLD);
  const subSize = s.subtitle ? fitSize(s.subtitle, { x, y: 0, w: tw, h: 1.7 }, 19, 12) : 0;
  const avail = SECTION_BOTTOM - SECTION_TOP - 0.3;
  const titleH = Math.min(avail * (s.subtitle ? 0.62 : 1), Math.max(0.8, inkHeight(s.title, tw, titleSize, CHAR_EM_BOLD)));
  const subH = s.subtitle ? Math.min(avail - titleH - 0.5, Math.max(0.45, inkHeight(s.subtitle, tw, subSize))) : 0;
  const blockH = titleH + (s.subtitle ? 0.5 + subH : 0);
  const y0 = SECTION_TOP + Math.max(0, (SECTION_BOTTOM - SECTION_TOP - blockH) / 2);
  layers.push({
    t: "text",
    box: { x, y: y0, w: tw, h: titleH },
    text: s.title,
    color: theme.text,
    size: titleSize,
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  if (s.subtitle) {
    layers.push({ t: "rect", box: { x, y: y0 + titleH + 0.2, w: 1.3, h: 0.07 }, fill: { color: theme.accent } });
    layers.push({
      t: "text",
      box: { x, y: y0 + titleH + 0.5, w: tw, h: subH },
      text: s.subtitle,
      color: theme.muted,
      size: subSize,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Bandlar — har biri chapida aksent qirrali keng plitka (kamida bir qator = bir fikr). */
function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = conferenceVisual.photo!.bullets as Box;
  const withImg = Boolean(s.image?.url);
  const zoneW = withImg ? slot.x - X - 0.35 : ZONE_W;
  pushBand(layers, s, theme, ZONE_W, ctx.reserve);
  if (withImg) {
    layers.push({ t: "rect", box: { x: slot.x - 0.12, y: slot.y - 0.12, w: 0.06, h: slot.h + 0.24 }, fill: { color: theme.accent } });
    photo(layers, s.image!.url, slot, 0);
  }

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const n = Math.max(1, items.length);
  const top = 1.8;
  const zoneH = 6.85 - top;
  const gap = 0.16;
  const rowH = Math.min(1.25, (zoneH - gap * (n - 1)) / n);
  const used = rowH * n + gap * (n - 1);
  const y0 = top + Math.max(0, (zoneH - used) / 2);
  items.forEach((line, i) => {
    const y = y0 + i * (rowH + gap);
    layers.push({ t: "rect", box: { x: X, y, w: zoneW, h: rowH }, fill: { color: theme.surface }, radius: 0.06 });
    layers.push({ t: "rect", box: { x: X, y, w: 0.14, h: rowH }, fill: { color: theme.accent } });
    const box: Box = { x: X + 0.4, y: y + 0.06, w: zoneW - 0.7, h: rowH - 0.12 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

/** Reja — chapida to'q kvadrat raqam, yonida matn plitkasi. */
function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, agendaFit, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushBand(layers, s, theme, ZONE_W, ctx.reserve);
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const n = Math.max(1, items.length);
  const top = 1.8;
  const zoneH = 6.85 - top;
  const gap = 0.14;
  const rowH = Math.min(1.15, (zoneH - gap * (n - 1)) / n);
  const used = rowH * n + gap * (n - 1);
  const y0 = top + Math.max(0, (zoneH - used) / 2);
  const tile = Math.min(rowH, 1.05);
  items.forEach((line, i) => {
    const y = y0 + i * (rowH + gap);
    layers.push({ t: "rect", box: { x: X, y, w: tile, h: rowH }, fill: { color: theme.titleBg } });
    layers.push({ t: "rect", box: { x: X, y, w: tile, h: 0.06 }, fill: { color: theme.accent } });
    layers.push({
      t: "text",
      box: { x: X, y: y + 0.06, w: tile, h: rowH - 0.06 },
      text: two(i + 1),
      color: theme.titleText,
      size: 22,
      bold: true,
      align: "center",
      valign: "middle",
    });
    layers.push({ t: "rect", box: { x: X + tile, y, w: ZONE_W - tile, h: rowH }, fill: { color: theme.surface } });
    const box: Box = { x: X + tile + 0.3, y: y + 0.05, w: ZONE_W - tile - 0.6, h: rowH - 0.1 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: agendaFit(line, box, ctx.bodyType.bodyPt + 2),
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos — chapda to'q panel (tirnoq + muallif), o'ngda katta matn. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, inkHeight, pushFooter, pushPlanBadgeAt, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const PANEL = 4.2;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: PANEL, h: H }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: PANEL, y: 0, w: 0.1, h: H }, fill: { color: theme.accent } });
  // Dekorativ tirnoq: matn modeldan emas — `src` yo'q.
  layers.push({
    t: "text",
    box: { x: 0.6, y: 0.9, w: PANEL - 1.2, h: 2.4 },
    text: "“",
    color: theme.titleMuted,
    size: 150,
    bold: true,
    font: "Georgia",
    valign: "middle",
  });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: 0.6, y: 4.6, w: PANEL - 1.0, h: 1.4 },
      text: s.quoteBy,
      color: theme.titleMuted,
      size: 15,
      bold: true,
      uppercase: true,
      tracking: 2,
      valign: "top",
      src: { f: "quoteBy" },
    });
  }
  const text = s.quote || s.title;
  const x = PANEL + 0.9;
  const tw = W - x - 0.8;
  const qSize = fitSize(text, { x, y: 0, w: tw, h: 4.2 }, 34, 18, CHAR_EM_BOLD);
  const qH = Math.min(4.2, Math.max(0.8, inkHeight(text, tw, qSize, CHAR_EM_BOLD)));
  const qY = Math.max(2.3, (H - qH) / 2);
  // Reja nishoni (faqat `plan` li iqtibos) — iqtibos USTIDA.
  pushPlanBadgeAt(layers, s, x, qY - 0.7, theme.accentInk, { size: 18 });
  layers.push({
    t: "text",
    box: { x, y: qY, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    bold: true,
    valign: "top",
    src: { f: "quote" },
  });
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Yakun («Rahmat») — to'q sahifa, ulkan sarlavha, pastda tasma naqshi. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, photo, pushFooter, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  const slot = conferenceVisual.photo!.closing as Box;
  if (s.image?.url) {
    layers.push({ t: "rect", box: { x: slot.x - 0.2, y: slot.y + 0.2, w: slot.w, h: slot.h }, fill: { color: theme.accent } });
    photo(layers, s.image.url, slot, 0);
  } else {
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.accent, alpha: 0.35 } });
    layers.push({ t: "rect", box: { x: slot.x + 0.3, y: slot.y + 0.3, w: slot.w - 0.6, h: slot.h - 0.6 }, line: { color: theme.titleMuted, width: 1 } });
  }
  const tw = 7.3;
  const titleBox: Box = { x: 0.9, y: 1.4, w: tw, h: 2.5 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 54, 26, CHAR_EM_BOLD),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: 0.9, y: 4.15, w: 1.8, h: 0.09 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: 0.9, y: 4.45, w: tw, h: 1.5 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 20, 13),
      src: { f: "subtitle" },
    });
  }
  // Pastki tasma naqshi: uchta aksent chiziq, uzunligi kamayib boradi.
  [5.2, 3.4, 1.8].forEach((w, i) => {
    layers.push({ t: "rect", box: { x: 0.9, y: 6.2 + i * 0.22, w, h: 0.07 }, fill: { color: theme.accent, alpha: 1 - i * 0.25 } });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.9, w: W - 1.8 }, true);
  return { bg: theme.titleBg, layers };
}

export const conferenceVisual: VisualSpec = {
  id: "conference",
  base: "dense",
  photo: {
    title: { x: 9.0, y: 0.95, w: 3.5, h: 4.9 },
    section: null,
    bullets: { x: 9.4, y: 1.9, w: 3.2, h: 4.9 },
    agenda: null,
    quote: null,
    closing: { x: 8.9, y: 1.3, w: 3.6, h: 4.3 },
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
