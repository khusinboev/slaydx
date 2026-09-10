import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Jurnal» dizayni — foto-esse va hayotnoma («Foto-hikoya» shabloni, `ink`).
 *
 * Naqsh: kadr HUKMRON. Titul, bo'lim, iqtibos va yakun — to'la ekranli
 * rasm, matn esa uning ustidagi to'q gradient tasmada (ikki qavat qora
 * qoplama). Bandlar — chapda to'la balandlikdagi kadr ustuni, o'ngda
 * serif sarlavha va ABZATS matn (band belgilari yo'q). Reja —
 * «Mundarija»: yirik serif raqamlar va ingichka chiziqlar.
 *
 * Butun oila serif (Georgia) — jurnal ruknining ovozi.
 */

const FULL: Box = { x: 0, y: 0, w: 13.333, h: 7.5 };
const BULLETS_PHOTO: Box = { x: 0, y: 0, w: 4.6, h: 7.5 };
const SERIF = "Georgia";
const TEXT_X = 0.85;
const ZONE_W = 11.63;

/** Kadr ostidagi qoralatish — ikki qavat, pastga qarab quyuqlashadi. */
function pushScrim(layers: SlideLayer[], from: number, mid: number): void {
  const { H, W } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: 0, y: from, w: W, h: H - from }, fill: { color: "#000000", alpha: 0.25 } });
  layers.push({ t: "rect", box: { x: 0, y: mid, w: W, h: H - mid }, fill: { color: "#000000", alpha: 0.55 } });
}

/** Rasm yo'q sahifada dekor: yirik serif raqam va ingichka chiziq. */
function pushNumberDecor(layers: SlideLayer[], theme: SlideTheme, index: number, box: Box, size: number, ruleY: number): void {
  layers.push({
    t: "text",
    box: { ...box },
    text: String(index + 1).padStart(2, "0"),
    color: theme.titleMuted,
    size,
    font: SERIF,
    valign: "middle",
  });
  layers.push({ t: "rect", box: { x: box.x, y: ruleY, w: ZONE_W, h: 0.03 }, fill: { color: theme.titleMuted, alpha: 0.5 } });
}

function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  const img = s.image?.url;
  if (img) {
    photo(layers, img, { ...FULL }, 0);
    pushScrim(layers, 2.6, 4.3);
  } else {
    // Kadrsiz muqova ham TUZILGAN ko'rinsin: yirik raqam va chiziq.
    pushNumberDecor(layers, theme, index, { x: TEXT_X, y: 1.1, w: 5.0, h: 2.6 }, 140, 4.1);
  }
  layers.push({ t: "rect", box: { x: TEXT_X, y: 4.25, w: 2.2, h: 0.06 }, fill: { color: theme.accent } });
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: TEXT_X, y: 4.5, w: ZONE_W, h: 0.42 },
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
  const titleBox: Box = { x: TEXT_X, y: 4.98, w: 11.0, h: 1.35 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 40, 24),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: TEXT_X, y: 6.42, w: 11.0, h: 0.6 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 17, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, true);
  return { bg: theme.titleBg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  photo(layers, s.image?.url, { ...FULL }, theme.darkContent ? 0.1 : 0.18);
  // Chapdagi to'q panel — matn ustuni.
  const panelW = 5.2;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: panelW, h: H }, fill: { color: theme.titleBg, alpha: 0.88 } });
  layers.push({ t: "rect", box: { x: panelW, y: 0, w: 0.06, h: H }, fill: { color: theme.accent } });

  const x = 0.75;
  const tw = 3.75;
  layers.push({
    t: "text",
    box: { x, y: 1.15, w: 3.0, h: 1.6 },
    text: String(index + 1).padStart(2, "0"),
    color: theme.titleMuted,
    size: 84,
    font: SERIF,
    valign: "middle",
  });
  layers.push({ t: "rect", box: { x, y: 3.05, w: 1.5, h: 0.05 }, fill: { color: theme.accent } });
  const titleBox: Box = { x, y: 3.35, w: tw, h: 1.9 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 30, 18),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 5.4, w: tw, h: 1.35 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 15, 11),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: 4.05 }, true);
  return { bg: theme.titleBg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, fitLines, bulletGap, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  // Chap ustun — to'la balandlikdagi kadr; rasmsiz bo'lsa to'q blok + raqam.
  layers.push({ t: "rect", box: { ...BULLETS_PHOTO }, fill: { color: theme.titleBg } });
  if (s.image?.url) {
    photo(layers, s.image.url, { ...BULLETS_PHOTO }, 0);
  } else {
    layers.push({
      t: "text",
      box: { x: 0.6, y: 2.9, w: 3.4, h: 1.7 },
      text: String(index + 1).padStart(2, "0"),
      color: theme.titleMuted,
      size: 96,
      font: SERIF,
      align: "center",
      valign: "middle",
    });
    layers.push({ t: "rect", box: { x: 1.55, y: 4.85, w: 1.5, h: 0.05 }, fill: { color: theme.accent } });
  }

  const x = 5.3;
  const tw = 7.53;
  const headBox: Box = { x, y: 0.6, w: Math.max(3, tw - ctx.reserve), h: 0.92 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 27, 17),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x, y: 1.58, w: 1.5, h: 0.05 }, fill: { color: theme.accent } });
  // Matn blokining chap chetidagi ingichka chiziq — jurnal hoshiyasi.
  layers.push({ t: "rect", box: { x: 5.0, y: 1.9, w: 0.04, h: 4.75 }, fill: { color: theme.accent, alpha: 0.4 } });

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  if (items.length) {
    const box: Box = { x, y: 1.9, w: tw, h: 4.75 };
    const size = fitLines(items, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, 12);
    layers.push({
      t: "text",
      box,
      lines: items,
      // Bandlar EMAS, abzaslar — foto-esse matni. Qoldiq bo'shliq
      // abzaslar orasiga taqsimlanadi, aks holda ustunning pastki
      // uchdan ikkisi bo'sh qolardi.
      bullets: false,
      color: theme.text,
      size,
      paraSpace: Math.max(12, bulletGap(items, box, size)),
      valign: "middle",
      srcLines: items.map((_, i) => ({ f: "bullets", i })),
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  const headBox: Box = { x: TEXT_X, y: 0.6, w: Math.max(3, ZONE_W - ctx.reserve), h: 0.95 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 30, 18),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.62, w: ZONE_W, h: 0.045 }, fill: { color: theme.accent } });

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const top = 1.95;
  const zoneH = 4.9;
  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    // Yirik serif raqam — dekorativ, `src` yo'q.
    layers.push({
      t: "text",
      box: { x: TEXT_X, y, w: 1.2, h: rowH - 0.12 },
      text: String(i + 1).padStart(2, "0"),
      color: theme.accentInk,
      size: Math.max(16, Math.min(46, Math.round(rowH * 36))),
      font: SERIF,
      valign: "middle",
    });
    const textBox: Box = { x: 2.35, y, w: 10.08, h: rowH - 0.14 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
    layers.push({
      t: "rect",
      box: { x: TEXT_X, y: y + rowH - 0.05, w: ZONE_W, h: 0.012 },
      fill: { color: theme.accent, alpha: 0.35 },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  photo(layers, s.image?.url, { ...FULL }, theme.darkContent ? 0.4 : 0.58);

  // Chiziq + iqtibos + muallif bitta blok bo'lib markazlashtiriladi.
  const text = s.quote || s.title;
  const tw = W - 3.4;
  const qSize = fitSize(text, { x: 1.7, y: 0, w: tw, h: 2.5 }, 30, 17);
  const qH = Math.min(2.5, Math.max(0.55, inkHeight(text, tw, qSize)));
  const byH = s.quoteBy ? 0.5 : 0;
  const blockH = 0.05 + 0.45 + qH + (s.quoteBy ? 0.45 + byH : 0);
  const y0 = 1.7 + Math.max(0, (5.0 - blockH) / 2);
  layers.push({ t: "rect", box: { x: (W - 1.8) / 2, y: y0, w: 1.8, h: 0.05 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 1.7, y: y0 + 0.5, w: tw, h: qH },
    text,
    color: theme.titleText,
    size: qSize,
    italic: true,
    align: "center",
    font: SERIF,
    src: { f: "quote" },
  });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: 1.7, y: y0 + 0.5 + qH + 0.45, w: tw, h: byH },
      text: s.quoteBy,
      color: theme.titleMuted,
      size: 14,
      uppercase: true,
      tracking: 2,
      align: "center",
      src: { f: "quoteBy" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, true);
  return { bg: theme.titleBg, layers };
}

function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  photo(layers, s.image?.url, { ...FULL }, theme.darkContent ? 0.12 : 0.2);
  // Pastki to'q tasma — yakun matni uchun.
  layers.push({ t: "rect", box: { x: 0, y: 4.25, w: W, h: H - 4.25 }, fill: { color: theme.titleBg, alpha: 0.86 } });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 4.62, w: 2.2, h: 0.07 }, fill: { color: theme.accent } });

  const titleBox: Box = { x: TEXT_X, y: 4.92, w: 11.0, h: 1.35 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 38, 24),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: TEXT_X, y: 6.38, w: 11.0, h: 0.62 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, true);
  return { bg: theme.titleBg, layers };
}

/** Ikki ustun / qiyos — jurnal tarqatmasi: tik ajratgich, abzats matn. */
function planTwoCol(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, fitLines, bulletGap, pushFooter, stripCut, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const zoneW = ZONE_W - stripCut(s);

  const headBox: Box = { x: TEXT_X, y: 0.6, w: Math.max(3, zoneW - ctx.reserve), h: 0.95 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 28, 18),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.62, w: zoneW, h: 0.045 }, fill: { color: theme.accent } });

  const gap = 0.8;
  const colW = (zoneW - gap) / 2;
  layers.push({
    t: "rect",
    box: { x: TEXT_X + colW + gap / 2 - 0.015, y: 2.0, w: 0.03, h: 4.6 },
    fill: { color: theme.accent, alpha: 0.45 },
  });
  const cols: { title?: string; items?: string[]; f: "left" | "right"; tf: "leftTitle" | "rightTitle" }[] = [
    { title: s.leftTitle, items: s.left, f: "left", tf: "leftTitle" },
    { title: s.rightTitle, items: s.right, f: "right", tf: "rightTitle" },
  ];
  cols.forEach((col, ci) => {
    const x = TEXT_X + ci * (colW + gap);
    if (col.title) {
      layers.push({
        t: "text",
        box: { x, y: 2.0, w: colW, h: 0.5 },
        text: col.title,
        color: theme.accentInk,
        size: 15,
        bold: true,
        uppercase: true,
        tracking: 1.4,
        valign: "middle",
        src: { f: col.tf },
      });
    }
    layers.push({ t: "rect", box: { x, y: 2.58, w: 1.1, h: 0.04 }, fill: { color: theme.accent } });
    const items = (col.items ?? []).slice(0, ctx.bodyType.maxBullets + 2);
    if (items.length) {
      const box: Box = { x, y: 2.85, w: colW, h: 3.75 };
      const size = fitLines(items, box, ctx.bodyType.bodyPt - 2, ctx.bodyType.minPt - 2, 10);
      layers.push({
        t: "text",
        box,
        lines: items,
        bullets: false,
        color: theme.text,
        size,
        paraSpace: Math.max(10, bulletGap(items, box, size)),
        valign: "middle",
        srcLines: items.map((_, i) => ({ f: col.f, i })),
      });
    }
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: zoneW }, false);
  return { bg: theme.bg, layers };
}

export const storyVisual: VisualSpec = {
  id: "story",
  base: "magazine",
  photo: {
    title: { ...FULL },
    section: { ...FULL },
    bullets: { ...BULLETS_PHOTO },
    agenda: null,
    quote: { ...FULL },
    closing: { ...FULL },
  },
  fullBleed: ["title", "section", "quote", "closing"],
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
