import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Dumaloq» dizayni — maktab darsi va trening («Dars / trening», `lumen`).
 *
 * Naqsh: yorug' sahifa, DOIRA hamma joyda — rasm dumaloq (aksent2 halqa
 * ichida), bandlarning raqami dumaloq nishonchada, dekorativ katta doiralar
 * burchaklarda. Yumshoq burchakli (radius 0.16–0.24) kartalar va soya.
 *
 * Rang qoidasi: nishoncha DOIRASI `titleBg` bilan to'ldiriladi va raqam
 * `titleText` bo'ladi — shunda o'lchangan juftlik saqlanadi (`accent`
 * ustidagi matn hech qaysi temada o'lchanmagan). Sahifa matni esa
 * `text`/`muted`/`accentInk`.
 */

/** Titul: dumaloq kadr KVADRAT qutida (aks holda ellips chiqadi). */
const TITLE_PHOTO: Box = { x: 8.0, y: 1.45, w: 4.6, h: 4.6 };
const QUOTE_PHOTO: Box = { x: 1.6, y: 2.6, w: 2.4, h: 2.4 };
const CLOSING_PHOTO: Box = { x: 7.9, y: 1.6, w: 4.3, h: 4.3 };
const BULLETS_PHOTO = null;

const TEXT_X = 0.85;
const ZONE_W = 11.63;

/** Doira — kvadrat quti + radius yarim tomon. */
function circle(box: Box, fill: { color: string; alpha?: number }): SlideLayer {
  return { t: "rect", box, fill, radius: box.w / 2 };
}

/**
 * Dumaloq kadr: orqada aksent2 halqa, ustida rasm. Rasm bo'lmasa —
 * aksent disk va undan «tishlangan» surface doira (yarim oy naqshi).
 */
function pushRoundPhoto(layers: SlideLayer[], theme: SlideTheme, url: string | undefined, box: Box): void {

  const ring = 0.18;
  layers.push(circle({ x: box.x - ring, y: box.y - ring, w: box.w + ring * 2, h: box.h + ring * 2 }, { color: theme.accent2 }));
  if (url) {
    layers.push({ t: "image", box: { ...box }, url, shape: "circle" });
    return;
  }
  layers.push(circle({ ...box }, { color: theme.accent }));
  const d = box.w * 0.48;
  layers.push(circle({ x: box.x + box.w * 0.26, y: box.y + box.h * 0.26, w: d, h: d }, { color: theme.surface }));
}

/** Sarlavha + yumaloq aksent tagchizig'i — kontent maketlari uchun bitta naqsh. */
function pushRoundHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, reserve: number, zoneW: number): void {
  const { fitSize } = LAYOUT_KIT;
  const headBox: Box = { x: TEXT_X, y: 0.5, w: Math.max(3, zoneW - reserve), h: 0.85 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 26, 16),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.45, w: 1.5, h: 0.12 }, fill: { color: theme.accent }, radius: 0.06 });
}

/** Raqamli dumaloq nishoncha: `titleBg` doira + `titleText` raqam. */
function pushBadge(layers: SlideLayer[], theme: SlideTheme, box: Box, label: string, size: number): void {
  layers.push(circle({ ...box }, { color: theme.titleBg }));
  layers.push({
    t: "text",
    box: { ...box },
    text: label,
    color: theme.titleText,
    size,
    bold: true,
    align: "center",
    valign: "middle",
  });
}

function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  // Dekorativ doiralar — o'ng yuqorida, slayd chegarasiga TEGIB turadi.
  layers.push(circle({ x: 9.73, y: 0, w: 3.6, h: 3.6 }, { color: theme.accent, alpha: 0.14 }));
  // Ikkinchi doira YUQORIDA — pastda u kolontitul va sahifa raqamiga tegib turardi.
  layers.push(circle({ x: 6.75, y: 0.3, w: 1.3, h: 1.3 }, { color: theme.accent2, alpha: 0.2 }));

  const tw = 6.6;
  layers.push(circle({ x: TEXT_X, y: 1.62, w: 0.34, h: 0.34 }, { color: theme.accent2 }));
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: TEXT_X + 0.5, y: 1.58, w: tw - 0.5, h: 0.42 },
      text: s.kicker,
      color: theme.accentInk,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 1.8,
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x: TEXT_X, y: 2.25, w: tw, h: 2.1 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 36, 22),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 4.5, w: 1.7, h: 0.12 }, fill: { color: theme.accent }, radius: 0.06 });
  if (s.subtitle) {
    const subBox: Box = { x: TEXT_X, y: 4.8, w: tw, h: 1.45 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushRoundPhoto(layers, theme, s.image?.url, { ...TITLE_PHOTO });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: tw }, false);
  return { bg: theme.bg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  /*
   * Katta aksent doira, ichida `titleBg` doira va `titleText` raqam.
   * Ikkisi orasida `bg` rangli ingichka halqa: ba'zi palitralarda
   * (`lumen`, `atlas`) `accent` va `titleBg` AYNAN bir xil rang — halqasiz
   * ular bitta tekis dog'ga qo'shilib ketardi.
   */
  layers.push(circle({ x: 0.9, y: 1.7, w: 4.1, h: 4.1 }, { color: theme.accent }));
  layers.push(circle({ x: 1.28, y: 2.08, w: 3.34, h: 3.34 }, { color: theme.bg }));
  pushBadge(layers, theme, { x: 1.4, y: 2.2, w: 3.1, h: 3.1 }, String(index + 1).padStart(2, "0"), 72);

  const x = 5.65;
  const tw = 7.05;
  const top = 1.7;
  const bottom = 5.8;
  const titleSize = fitSize(s.title, { x, y: 0, w: tw, h: 2.3 }, 38, 22);
  const subSize = s.subtitle ? fitSize(s.subtitle, { x, y: 0, w: tw, h: 1.6 }, 19, 13) : 0;
  const avail = bottom - top - 0.34 - (s.subtitle ? 0.3 : 0);
  const titleH = Math.min(avail * (s.subtitle ? 0.6 : 1), Math.max(0.6, inkHeight(s.title, tw, titleSize)));
  const subH = s.subtitle ? Math.min(avail - titleH, Math.max(0.34, inkHeight(s.subtitle, tw, subSize))) : 0;
  const blockH = 0.12 + 0.34 + titleH + (s.subtitle ? 0.3 + subH : 0);
  const y0 = top + Math.max(0, (bottom - top - blockH) / 2);
  layers.push({ t: "rect", box: { x, y: y0, w: 1.3, h: 0.12 }, fill: { color: theme.accent2 }, radius: 0.06 });
  layers.push({
    t: "text",
    box: { x, y: y0 + 0.46, w: tw, h: titleH },
    text: s.title,
    color: theme.text,
    size: titleSize,
    bold: true,
    src: { f: "title" },
  });
  if (s.subtitle) {
    layers.push({
      t: "text",
      box: { x, y: y0 + 0.46 + titleH + 0.3, w: tw, h: subH },
      text: s.subtitle,
      color: theme.muted,
      size: subSize,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushRoundHead(layers, s, theme, ctx.reserve, ZONE_W);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const zone: Box = { x: TEXT_X, y: 1.85, w: ZONE_W, h: 5.0 };
  const n = Math.max(1, items.length);
  const cols = n >= 3 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gap = 0.28;
  const cardW = (zone.w - gap * (cols - 1)) / cols;
  const cardH = (zone.h - gap * (rows - 1)) / rows;
  items.forEach((line, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = zone.x + c * (cardW + gap);
    const y = zone.y + r * (cardH + gap);
    // Toq sondagi oxirgi karta ikki ustunni egallaydi — pastki burchak bo'sh qolmasin.
    const last = i === items.length - 1;
    const w = last && cols === 2 && c === 0 ? zone.w : cardW;
    layers.push({ t: "rect", box: { x, y, w, h: cardH }, fill: { color: theme.surface }, radius: 0.16, shadow: true });
    const bd = Math.max(0.36, Math.min(0.66, cardH - 0.4));
    pushBadge(layers, theme, { x: x + 0.3, y: y + (cardH - bd) / 2, w: bd, h: bd }, String(i + 1), Math.max(11, Math.round(bd * 27)));
    const textBox: Box = { x: x + 0.3 + bd + 0.34, y: y + 0.2, w: w - (0.3 + bd + 0.34) - 0.34, h: cardH - 0.4 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push(circle({ x: 10.53, y: 4.7, w: 2.8, h: 2.8 }, { color: theme.accent, alpha: 0.12 }));
  pushRoundHead(layers, s, theme, ctx.reserve, ZONE_W);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const top = 1.85;
  const zoneH = 5.0;
  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    const ringD = Math.max(0.44, Math.min(0.86, rowH - 0.16));
    const inner = ringD * 0.7;
    layers.push(circle({ x: TEXT_X, y: y + (rowH - ringD) / 2, w: ringD, h: ringD }, { color: theme.accent, alpha: 0.28 }));
    pushBadge(
      layers,
      theme,
      { x: TEXT_X + (ringD - inner) / 2, y: y + (rowH - inner) / 2, w: inner, h: inner },
      String(i + 1),
      Math.max(11, Math.round(inner * 26)),
    );
    const lineBox: Box = { x: TEXT_X + ringD + 0.42, y, w: ZONE_W - ringD - 0.42, h: rowH - 0.12 };
    layers.push({
      t: "text",
      box: lineBox,
      text: line,
      color: theme.text,
      size: fitSize(line, lineBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
    layers.push({
      t: "rect",
      box: { x: TEXT_X + ringD + 0.42, y: y + rowH - 0.06, w: ZONE_W - ringD - 0.42, h: 0.04 },
      fill: { color: theme.accent, alpha: 0.22 },
      radius: 0.02,
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push(circle({ x: 9.93, y: 4.1, w: 3.4, h: 3.4 }, { color: theme.accent, alpha: 0.12 }));
  layers.push({ t: "rect", box: { x: 1.15, y: 1.35, w: 11.0, h: 4.9 }, fill: { color: theme.surface }, radius: 0.24, shadow: true });

  pushRoundPhoto(layers, theme, s.image?.url, { ...QUOTE_PHOTO });

  // Blok siyoh balandligi bo'yicha yig'iladi va kartada markazlashtiriladi.
  const x = 4.6;
  const tw = 7.1;
  const text = s.quote || s.title;
  const qSize = fitSize(text, { x, y: 0, w: tw, h: 2.6 }, 28, 16);
  const qH = Math.min(2.6, Math.max(0.5, inkHeight(text, tw, qSize)));
  const byH = s.quoteBy ? 0.45 : 0;
  const blockH = 0.12 + 0.34 + qH + (s.quoteBy ? 0.4 + byH : 0);
  const y0 = 1.35 + Math.max(0, (4.9 - blockH) / 2);
  layers.push({ t: "rect", box: { x, y: y0, w: 1.1, h: 0.12 }, fill: { color: theme.accent }, radius: 0.06 });
  layers.push({
    t: "text",
    box: { x, y: y0 + 0.46, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    src: { f: "quote" },
  });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x, y: y0 + 0.46 + qH + 0.4, w: tw, h: byH },
      text: s.quoteBy,
      color: theme.muted,
      size: 14,
      uppercase: true,
      tracking: 1.4,
      src: { f: "quoteBy" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  // Dekorativ doira YUQORI chapda — pastda u kolontitul va izohga tegib turardi.
  layers.push(circle({ x: 0, y: 0, w: 2.5, h: 2.5 }, { color: theme.accent, alpha: 0.13 }));

  const tw = 6.4;
  const titleBox: Box = { x: TEXT_X, y: 2.2, w: tw, h: 1.9 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 38, 24),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 4.3, w: 1.6, h: 0.12 }, fill: { color: theme.accent }, radius: 0.06 });
  if (s.subtitle) {
    const subBox: Box = { x: TEXT_X, y: 4.6, w: tw, h: 1.4 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 13),
      src: { f: "subtitle" },
    });
  }
  pushRoundPhoto(layers, theme, s.image?.url, { ...CLOSING_PHOTO });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

/** Ikki ustun / qiyos — ikkita yumaloq karta, sarlavhasida harfli nishoncha. */
function planTwoCol(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, fitLines, bulletGap, pushFooter, stripCut, W, H, BULLET_GAP_MIN } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  // Rasm tasmasi (`pushStrip`) kontent zonasini toraytiradi.
  const zoneW = ZONE_W - stripCut(s);
  pushRoundHead(layers, s, theme, ctx.reserve, zoneW);

  const gap = 0.4;
  const colW = (zoneW - gap) / 2;
  const cols: { title?: string; items?: string[]; f: "left" | "right"; tf: "leftTitle" | "rightTitle" }[] = [
    { title: s.leftTitle, items: s.left, f: "left", tf: "leftTitle" },
    { title: s.rightTitle, items: s.right, f: "right", tf: "rightTitle" },
  ];
  cols.forEach((col, ci) => {
    const x = TEXT_X + ci * (colW + gap);
    layers.push({ t: "rect", box: { x, y: 1.85, w: colW, h: 5.0 }, fill: { color: theme.surface }, radius: 0.18, shadow: true });
    pushBadge(layers, theme, { x: x + 0.32, y: 2.15, w: 0.56, h: 0.56 }, ci === 0 ? "A" : "B", 17);
    if (col.title) {
      const tBox: Box = { x: x + 1.04, y: 2.15, w: colW - 1.38, h: 0.56 };
      layers.push({
        t: "text",
        box: tBox,
        text: col.title,
        color: theme.text,
        size: fitSize(col.title, tBox, 19, 13),
        bold: true,
        valign: "middle",
        src: { f: col.tf },
      });
    }
    layers.push({ t: "rect", box: { x: x + 0.32, y: 2.94, w: colW - 0.64, h: 0.03 }, fill: { color: theme.accent, alpha: 0.4 } });
    const items = (col.items ?? []).slice(0, ctx.bodyType.maxBullets + 2);
    if (items.length) {
      const box: Box = { x: x + 0.32, y: 3.16, w: colW - 0.64, h: 3.5 };
      const size = fitLines(items, box, ctx.bodyType.bodyPt - 2, ctx.bodyType.minPt - 2, BULLET_GAP_MIN);
      layers.push({
        t: "text",
        box,
        lines: items,
        bullets: true,
        color: theme.text,
        size,
        // Qoldiq bo'shliq bandlar orasiga taqsimlanadi — aks holda karta
        // pastki uchdan ikkisi bo'sh qolardi.
        paraSpace: bulletGap(items, box, size),
        valign: "middle",
        srcLines: items.map((_, i) => ({ f: col.f, i })),
      });
    }
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: zoneW }, false);
  return { bg: theme.bg, layers };
}

export const circleVisual: VisualSpec = {
  id: "circle",
  base: "cards",
  photo: {
    title: { ...TITLE_PHOTO },
    section: null,
    bullets: BULLETS_PHOTO,
    agenda: null,
    quote: { ...QUOTE_PHOTO },
    closing: { ...CLOSING_PHOTO },
  },
  plan: {
    title: (s, theme, index, total) => planTitle(s, theme, index, total),
    section: (s, theme, index, total) => planSection(s, theme, index, total),
    bullets: (s, theme, index, total, ctx) => planBullets(s, theme, index, total, ctx),
    agenda: (s, theme, index, total, ctx) => planAgenda(s, theme, index, total, ctx),
    quote: (s, theme, index, total) => planQuote(s, theme, index, total),
    closing: (s, theme, index, total) => planClosing(s, theme, index, total),
    twoCol: (s, theme, index, total, ctx) => planTwoCol(s, theme, index, total, ctx),
    compare: (s, theme, index, total, ctx) => planTwoCol(s, theme, index, total, ctx),
  },
};
