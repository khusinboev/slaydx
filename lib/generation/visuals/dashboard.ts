import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Panel» (dashboard) — hisobot shabloni dizayni.
 *
 * Boshqaruv paneli tili: yorug' sahifa, tepada ingichka aksent lentasi,
 * mazmun esa KO'TARILGAN kartalarda (`surface` + yumaloq burchak +
 * soya). Bandlar ro'yxat emas, 2 ustunli plitalar; raqamlar — tepasida
 * aksent chizig'i bo'lgan KPI plitalari; iqtibos ham keng plita ichida.
 * Butun deka bitta panel taassurotini beradi.
 */
const BAR_H = 0.1;
const RADIUS = 0.13;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Yorug' sahifa + tepadagi aksent lentasi — dizaynning umumiy ramkasi. */
function pushPage(layers: SlideLayer[], theme: SlideTheme): void {
  const { W, H } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: BAR_H }, fill: { color: theme.accent } });
}

/** Panel sarlavhasi — lenta ostida, aksent kvadrat belgisi bilan. */
function pushHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, w: number, reserve: number): void {
  const { fitSize } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: 0.85, y: 0.62, w: 0.26, h: 0.26 }, fill: { color: theme.accent }, radius: 0.05 });
  const box: Box = { x: 1.32, y: 0.45, w: w - 0.47 - reserve, h: 0.62 };
  layers.push({
    t: "text",
    box,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, box, 24, 16),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
}

/** Karta — `surface` + soya; panel dizaynining asosiy g'ishti. */
function card(layers: SlideLayer[], theme: SlideTheme, box: Box): void {
  layers.push({ t: "rect", box, fill: { color: theme.surface }, radius: RADIUS, shadow: true });
}

/** Titul — chapda matn va chiplar, o'ngda kartaga o'rnatilgan kadr. */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const outer: Box = { x: 7.4, y: 1.05, w: 5.45, h: 5.4 };
  card(layers, theme, outer);
  const slot = dashboardVisual.photo!.title as Box;
  if (s.image?.url) {
    photo(layers, s.image.url, slot, 0);
  } else {
    // Rasm o'rniga dekorativ ustunli diagramma — panel tilida.
    const bars = [0.35, 0.62, 0.48, 0.85, 0.7];
    bars.forEach((k, i) => {
      const bw = (slot.w - 0.3 * (bars.length - 1)) / bars.length;
      const bh = slot.h * k;
      layers.push({
        t: "rect",
        box: { x: slot.x + i * (bw + 0.3), y: slot.y + slot.h - bh, w: bw, h: bh },
        fill: { color: i === 3 ? theme.accent : theme.accent2, alpha: i === 3 ? 1 : 0.45 },
        radius: 0.06,
      });
    });
  }
  const x = 0.85;
  const tw = 6.1;
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x, y: 1.25, w: tw, h: 0.4 },
      text: s.kicker,
      color: theme.muted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.2,
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x, y: 1.75, w: tw, h: 2.25 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 35, 21),
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.15, w: tw, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 16, 12),
      src: { f: "subtitle" },
    });
  }
  /*
   * Uch dekorativ «chip» — panel ko'rsatkichlari uchun joy belgisi.
   * ATAYLAB matnsiz: maket hech qachon o'zidan so'z o'ylab topmaydi
   * (aks holda ruscha yoki inglizcha dekada o'zbekcha yozuv chiqardi)
   * va uydirma raqam ham ko'rsatmaydi.
   */
  [0, 1, 2].forEach((i) => {
    const cw = 1.85;
    const cx = x + i * (cw + 0.25);
    layers.push({ t: "rect", box: { x: cx, y: 5.45, w: cw, h: 0.52 }, fill: { color: theme.surface }, radius: 0.26, shadow: true });
    layers.push({ t: "rect", box: { x: cx + 0.22, y: 5.63, w: 0.16, h: 0.16 }, fill: { color: theme.accent }, radius: 0.03 });
    layers.push({ t: "rect", box: { x: cx + 0.52, y: 5.66, w: cw - 0.78, h: 0.1 }, fill: { color: theme.accent2, alpha: 0.35 }, radius: 0.05 });
  });
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Bo'lim — chapda soyali raqam kartasi, o'ngda nom; fonda uch xira chiziq. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  [1.55, 3.75, 5.95].forEach((y) => {
    layers.push({ t: "rect", box: { x: 0.85, y, w: 11.6, h: 0.02 }, fill: { color: theme.accent2, alpha: 0.35 } });
  });
  const numCard: Box = { x: 0.85, y: 2.55, w: 2.2, h: 2.2 };
  card(layers, theme, numCard);
  layers.push({ t: "rect", box: { x: numCard.x, y: numCard.y, w: numCard.w, h: 0.09 }, fill: { color: theme.accent }, radius: 0.04 });
  layers.push({
    t: "text",
    box: { ...numCard },
    text: two(index + 1),
    color: theme.accentInk,
    size: 56,
    bold: true,
    align: "center",
    valign: "middle",
  });
  const x = 3.45;
  const tw = 9.0;
  const titleBox: Box = { x, y: 2.55, w: tw, h: 1.6 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 42, 22),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.3, w: tw, h: 1.35 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/** Bandlar — 2 ustunli plitalar; rasm bo'lsa o'ngda alohida kadr kartasi. */
function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const withImg = Boolean(s.image?.url);
  const tw = withImg ? 7.95 : 11.6;
  pushHead(layers, s, theme, tw, ctx.reserve);
  if (withImg) {
    const outer: Box = { x: 8.95, y: 1.42, w: 3.5, h: 5.1 };
    card(layers, theme, outer);
    photo(layers, s.image!.url, dashboardVisual.photo!.bullets as Box, 0);
  }
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const cols = items.length >= 3 && !withImg ? 2 : 1;
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const gap = 0.26;
  const zone: Box = { x: 0.85, y: 1.42, w: tw, h: 5.1 };
  const tileW = (zone.w - gap * (cols - 1)) / cols;
  const tileH = (zone.h - gap * (rows - 1)) / rows;
  items.forEach((line, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = zone.x + c * (tileW + gap);
    const y = zone.y + r * (tileH + gap);
    const last = i === items.length - 1;
    const w = last && cols === 2 && c === 0 ? zone.w : tileW;
    card(layers, theme, { x, y, w, h: tileH });
    /*
     * Past plita (rasm yonidagi bir ustunli tizim) da belgi matn USTIDA
     * emas, YONIDA turadi — aks holda matn qutisi manfiy balandlikka
     * tushib ketardi (bandlar 4 ta, plita 1.08″).
     */
    const compact = tileH < 1.7;
    const icon: Box = compact
      ? { x: x + 0.3, y: y + (tileH - 0.28) / 2, w: 0.28, h: 0.28 }
      : { x: x + 0.32, y: y + 0.32, w: 0.28, h: 0.28 };
    layers.push({ t: "rect", box: icon, fill: { color: theme.accent }, radius: 0.05 });
    const box: Box = compact
      ? { x: x + 0.78, y: y + 0.16, w: w - 1.1, h: Math.max(0.28, tileH - 0.32) }
      : { x: x + 0.32, y: y + 0.8, w: w - 0.64, h: tileH - 1.1 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: compact ? "middle" : "top",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/** Reja — bir qatorda tik plitalar, tepasida raqam. */
function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  pushHead(layers, s, theme, 11.6, ctx.reserve);
  const items = (s.bullets ?? []).slice(0, Math.min(4, ctx.bodyType.agendaMax));
  const n = Math.max(1, items.length);
  const gap = 0.3;
  const tileW = (11.6 - gap * (n - 1)) / n;
  items.forEach((line, i) => {
    const x = 0.85 + i * (tileW + gap);
    const box: Box = { x, y: 1.9, w: tileW, h: 4.15 };
    card(layers, theme, box);
    layers.push({ t: "rect", box: { x, y: 1.9, w: tileW, h: 0.09 }, fill: { color: theme.accent }, radius: 0.04 });
    layers.push({
      t: "text",
      box: { x: x + 0.28, y: 2.3, w: tileW - 0.56, h: 0.85 },
      text: two(i + 1),
      color: theme.accentInk,
      size: 34,
      bold: true,
    });
    const tBox: Box = { x: x + 0.28, y: 3.3, w: tileW - 0.56, h: 2.45 };
    layers.push({
      t: "text",
      box: tBox,
      text: line,
      color: theme.text,
      size: fitSize(line, tBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "top",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/** Raqamlar — KPI plitalari: tepada aksent chizig'i, ostida qiymat va yorliq. */
function planStats(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, stripCut, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const cut = stripCut(s);
  const tw = 11.6 - cut;
  pushHead(layers, s, theme, tw, ctx.reserve);
  const items = (s.stats ?? []).slice(0, 4);
  const n = Math.max(1, items.length);
  const gap = 0.3;
  const tileW = (tw - gap * (n - 1)) / n;
  items.forEach((st, i) => {
    const x = 0.85 + i * (tileW + gap);
    const box: Box = { x, y: 1.9, w: tileW, h: 3.95 };
    card(layers, theme, box);
    layers.push({ t: "rect", box: { x, y: 1.9, w: tileW, h: 0.08 }, fill: { color: theme.accent }, radius: 0.04 });
    const valBox: Box = { x: x + 0.15, y: 2.45, w: tileW - 0.3, h: 1.4 };
    layers.push({
      t: "text",
      box: valBox,
      text: st.value,
      color: theme.accentInk,
      size: fitSize(st.value, valBox, 42, 18),
      bold: true,
      align: "center",
      valign: "middle",
      src: { f: "stats", i, k: "value" },
    });
    const labBox: Box = { x: x + 0.22, y: 4.0, w: tileW - 0.44, h: 1.6 };
    layers.push({
      t: "text",
      box: labBox,
      text: st.label,
      color: theme.muted,
      size: fitSize(st.label, labBox, 15, 11),
      align: "center",
      valign: "top",
      src: { f: "stats", i, k: "label" },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos — keng plita, chapida aksent ustuni. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const box: Box = { x: 1.35, y: 1.75, w: 10.65, h: 3.95 };
  card(layers, theme, box);
  layers.push({ t: "rect", box: { x: box.x, y: box.y, w: 0.16, h: box.h }, fill: { color: theme.accent }, radius: 0.08 });
  const quote = s.quote || s.title;
  const qBox: Box = { x: 2.05, y: 2.15, w: 8.4, h: 2.4 };
  layers.push({
    t: "text",
    box: qBox,
    text: quote,
    color: theme.text,
    size: fitSize(quote, qBox, 31, 15),
    valign: "middle",
    src: { f: "quote" },
  });
  layers.push({ t: "rect", box: { x: 2.05, y: 4.72, w: 0.85, h: 0.05 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 2.05, y: 4.9, w: 9.6, h: 0.5 },
    text: s.quoteBy || "",
    color: theme.muted,
    size: 14,
    bold: true,
    uppercase: true,
    tracking: 1.8,
    valign: "middle",
    src: { f: "quoteBy" },
  });
  pushFooter(layers, s, theme, index, total, { x: 1.35, w: 10.65 }, false);
  return { bg: theme.bg, layers };
}

/** Yakun — yirik plita (matn) va yonida kadr kartasi. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const withImg = Boolean(s.image?.url);
  const main: Box = { x: 0.85, y: 1.5, w: withImg ? 7.35 : 11.6, h: 4.4 };
  card(layers, theme, main);
  layers.push({ t: "rect", box: { x: main.x, y: main.y, w: main.w, h: 0.1 }, fill: { color: theme.accent }, radius: 0.04 });
  if (withImg) {
    card(layers, theme, { x: 8.6, y: 1.5, w: 3.85, h: 4.4 });
    photo(layers, s.image!.url, dashboardVisual.photo!.closing as Box, 0);
  }
  const titleBox: Box = { x: main.x + 0.6, y: main.y + 0.85, w: main.w - 1.2, h: 1.75 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 36, 21),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: main.x + 0.6, y: main.y + 2.75, w: 1.2, h: 0.07 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: main.x + 0.6, y: main.y + 3.0, w: main.w - 1.2, h: 1.1 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/**
 * Ikki ustun / qiyos — panel tilidagi IKKI PLITA.
 *
 * `base` (`dense`) bu maketni TO'Q sahifada chizardi: hisobot dekasining
 * qolgan sakkiz slaydi yorug' bo'lgani uchun u yagona qora varaq bo'lib
 * ajralib turardi (PDF da ko'rindi). Shuning uchun dizayn uni o'zi
 * chizadi — o'sha soyali plitalar, o'sha aksent chizig'i.
 */
function planTwoCol(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitLines, bulletGap, stripCut, pushFooter, BULLET_GAP_MIN } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushPage(layers, theme);
  const cut = stripCut(s);
  const tw = 11.6 - cut;
  pushHead(layers, s, theme, tw, ctx.reserve);
  const gap = 0.35;
  const colW = (tw - gap) / 2;
  const cols: { title?: string; items: string[]; tk: "leftTitle" | "rightTitle"; ik: "left" | "right" }[] = [
    { title: s.leftTitle, items: s.left ?? [], tk: "leftTitle", ik: "left" },
    { title: s.rightTitle, items: s.right ?? [], tk: "rightTitle", ik: "right" },
  ];
  cols.forEach((col, c) => {
    const x = 0.85 + c * (colW + gap);
    const box: Box = { x, y: 1.55, w: colW, h: 4.95 };
    card(layers, theme, box);
    layers.push({ t: "rect", box: { x, y: 1.55, w: colW, h: 0.09 }, fill: { color: theme.accent }, radius: 0.04 });
    if (col.title) {
      layers.push({
        t: "text",
        box: { x: x + 0.4, y: 1.95, w: colW - 0.8, h: 0.55 },
        text: col.title,
        color: theme.accentInk,
        size: 16,
        bold: true,
        uppercase: true,
        tracking: 1.6,
        valign: "middle",
        src: { f: col.tk },
      });
    }
    const items = col.items.slice(0, ctx.bodyType.maxBullets);
    if (!items.length) return;
    const listBox: Box = { x: x + 0.4, y: 2.65, w: colW - 0.8, h: 3.55 };
    const size = fitLines(items, listBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt, BULLET_GAP_MIN);
    layers.push({
      t: "text",
      box: listBox,
      lines: items,
      bullets: true,
      color: theme.text,
      size,
      paraSpace: bulletGap(items, listBox, size),
      valign: "top",
      srcLines: items.map((_, i) => ({ f: col.ik, i })),
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: tw }, false);
  return { bg: theme.bg, layers };
}

export const dashboardVisual: VisualSpec = {
  id: "dashboard",
  base: "dense",
  photo: {
    title: { x: 7.62, y: 1.27, w: 5.01, h: 4.96 },
    section: null,
    bullets: { x: 9.13, y: 1.6, w: 3.14, h: 4.74 },
    agenda: null,
    quote: null,
    closing: { x: 8.78, y: 1.68, w: 3.49, h: 4.04 },
  },
  plan: {
    title: planTitle,
    section: planSection,
    bullets: planBullets,
    agenda: planAgenda,
    quote: planQuote,
    closing: planClosing,
    stats: planStats,
    twoCol: planTwoCol,
    compare: planTwoCol,
  },
};
