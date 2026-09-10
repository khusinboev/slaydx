import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Rasmiy» dizayni — dissertatsiya himoyasi («Himoya» shabloni, `legal`).
 *
 * Naqsh: hujjat tili. Serif (Georgia) sarlavhalar, qo'sh ingichka ramka,
 * to'la kenglikdagi aksent tasma, markazga tekislangan titul va yakun,
 * mundarija ko'rinishidagi reja (raqamlar o'ng ustunda, har qator ostida
 * ingichka chiziq), bandlarda keng qatorlararo masofa.
 *
 * Bu dizaynda titul/bo'lim/bandlar/reja/iqtibos/yakunda RASM ATAYLAB
 * YO'Q (`photo: null`) — himoya slaydi hujjat, plakat emas. Rasm faqat
 * kontent maketlarida (`dense` bazasi, o'ng tasma) qoladi.
 *
 * Rang qoidasi: aksent tasma ustiga MATN QO'YILMAYDI — `accent` ustidagi
 * matn hech qaysi palitrada o'lchanmagan. Rukn tasmadan pastda, to'q
 * sahifada `titleMuted` bilan yoziladi.
 */

const TEXT_X = 0.9;
const ZONE_W = 11.53;
const SERIF = "Georgia";

/** Serif sarlavha + tepa va past ingichka chiziq — kontent maketlari uchun. */
function pushFormalHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, reserve: number, zoneW: number): void {
  const { fitSize } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: TEXT_X, y: 0.6, w: zoneW, h: 0.03 }, fill: { color: theme.accent } });
  const headBox: Box = { x: TEXT_X, y: 0.76, w: Math.max(3, zoneW - reserve), h: 0.78 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 26, 16),
    bold: true,
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X, y: 1.6, w: zoneW, h: 0.015 }, fill: { color: theme.accent, alpha: 0.5 } });
}

function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  // Yuqori aksent tasma — dizaynning imzosi (matn ustida EMAS).
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: 0.5 }, fill: { color: theme.accent } });
  // Qo'sh ramka: tashqi aksent, ichki so'nik.
  layers.push({ t: "rect", box: { x: 0.25, y: 0.75, w: W - 0.5, h: 6.05 }, line: { color: theme.accent, width: 1.5 } });
  layers.push({ t: "rect", box: { x: 0.4, y: 0.9, w: W - 0.8, h: 5.75 }, line: { color: theme.titleMuted, width: 0.75 } });

  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: 1.5, y: 1.35, w: W - 3.0, h: 0.42 },
      text: s.kicker,
      color: theme.titleMuted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.4,
      align: "center",
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x: 1.3, y: 2.1, w: W - 2.6, h: 2.1 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 38, 22),
    bold: true,
    align: "center",
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: (W - 2.0) / 2, y: 4.4, w: 2.0, h: 0.05 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: 2.0, y: 4.72, w: W - 4.0, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      align: "center",
      font: SERIF,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, true);
  return { bg: theme.titleBg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  // Bo'lim raqami — tasmadan yuqorida, kichik harflar oralig'i katta.
  layers.push({
    t: "text",
    box: { x: TEXT_X, y: 1.85, w: ZONE_W, h: 0.45 },
    text: `${String(index + 1).padStart(2, "0")}`,
    color: theme.accentInk,
    size: 16,
    bold: true,
    uppercase: true,
    tracking: 3,
    align: "center",
    valign: "middle",
  });
  // To'q tasma sahifa o'rtasidan o'tadi, ustida ingichka aksent qirra.
  layers.push({ t: "rect", box: { x: 0, y: 2.47, w: W, h: 0.08 }, fill: { color: theme.accent } });
  layers.push({ t: "rect", box: { x: 0, y: 2.55, w: W, h: 2.35 }, fill: { color: theme.titleBg } });
  // Pastki qirra ham aksent: `chalk` kabi palitrada `bg` va `titleBg`
  // deyarli bir xil to'q rang — chiziqsiz tasma sahifadan ajralmasdi.
  layers.push({ t: "rect", box: { x: 0, y: 4.9, w: W, h: 0.08 }, fill: { color: theme.accent } });
  const titleBox: Box = { x: 1.2, y: 2.85, w: W - 2.4, h: 1.75 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 36, 20),
    bold: true,
    align: "center",
    valign: "middle",
    font: SERIF,
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: 1.6, y: 5.2, w: W - 3.2, h: 1.2 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      align: "center",
      font: SERIF,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitLines, bulletGap, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushFormalHead(layers, s, theme, ctx.reserve, ZONE_W);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const box: Box = { x: 1.15, y: 2.0, w: 10.4, h: 4.6 };
  if (items.length) {
    // Hujjat matni — qatorlararo masofa KENG (eng kichigi 14 pt).
    const size = fitLines(items, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, 14);
    layers.push({
      t: "text",
      box,
      lines: items,
      bullets: true,
      color: theme.text,
      size,
      paraSpace: Math.max(14, bulletGap(items, box, size)),
      valign: "middle",
      srcLines: items.map((_, i) => ({ f: "bullets", i })),
    });
  }
  // O'ng chetdagi «sahifa chizig'i» — hujjat hoshiyasi.
  layers.push({ t: "rect", box: { x: 12.3, y: 2.0, w: 0.03, h: 4.6 }, fill: { color: theme.accent, alpha: 0.45 } });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushFormalHead(layers, s, theme, ctx.reserve, ZONE_W);

  // Mundarija: nom chapda, raqam O'NG ustunda, har qator ostida chiziq.
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const top = 2.0;
  const zoneH = 4.85;
  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    const textBox: Box = { x: 1.0, y, w: 10.5, h: rowH - 0.12 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      valign: "middle",
      font: SERIF,
      src: { f: "bullets", i },
    });
    layers.push({
      t: "text",
      box: { x: 11.7, y, w: 0.73, h: rowH - 0.12 },
      text: String(i + 1).padStart(2, "0"),
      color: theme.accentInk,
      size: 15,
      bold: true,
      align: "right",
      valign: "middle",
    });
    layers.push({
      t: "rect",
      box: { x: TEXT_X, y: y + rowH - 0.07, w: ZONE_W, h: 0.014 },
      fill: { color: theme.accent, alpha: 0.4 },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });

  /*
   * Yirik dekorativ tirnoq. Brifda «accent» aytilgan, lekin `accent`
   * yorug' sahifada matn rangi sifatida o'lchanmagan — o'lchangan siyoh
   * varianti `accentInk` olinadi. Matn modeldan emas: `src` YO'Q.
   */
  layers.push({
    t: "text",
    box: { x: 0.95, y: 1.15, w: 2.2, h: 2.0 },
    text: "“",
    color: theme.accentInk,
    size: 100,
    bold: true,
    font: SERIF,
  });
  // Iqtibos va muallif SIYOH balandligi bo'yicha ketma-ket — qat'iy
  // koordinatalarda qisqa iqtibosdan keyin bir dyuymlik bo'shliq qolardi.
  const text = s.quote || s.title;
  const tw = 10.13;
  const qSize = fitSize(text, { x: 1.6, y: 0, w: tw, h: 2.5 }, 32, 18);
  const qH = Math.min(2.5, Math.max(0.55, inkHeight(text, tw, qSize)));
  const qY = 2.85;
  layers.push({
    t: "text",
    box: { x: 1.6, y: qY, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    italic: true,
    font: SERIF,
    src: { f: "quote" },
  });
  const ruleY = Math.min(6.0, qY + qH + 0.5);
  layers.push({ t: "rect", box: { x: 1.6, y: ruleY, w: 1.6, h: 0.045 }, fill: { color: theme.accent } });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: 1.6, y: ruleY + 0.25, w: tw, h: 0.5 },
      text: s.quoteBy,
      color: theme.muted,
      size: 15,
      uppercase: true,
      tracking: 1.8,
      src: { f: "quoteBy" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, false);
  return { bg: theme.bg, layers };
}

function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  const f1: Box = { x: 0.45, y: 0.45, w: W - 0.9, h: 6.15 };
  layers.push({ t: "rect", box: { ...f1 }, line: { color: theme.accent, width: 1.75 } });
  layers.push({ t: "rect", box: { x: 0.62, y: 0.62, w: W - 1.24, h: 5.81 }, line: { color: theme.titleMuted, width: 0.75 } });
  // Ramkaning to'rt burchagidagi aksent kvadratlar — muhr naqshi.
  const c = 0.18;
  for (const [cx, cy] of [
    [f1.x, f1.y],
    [f1.x + f1.w - c, f1.y],
    [f1.x, f1.y + f1.h - c],
    [f1.x + f1.w - c, f1.y + f1.h - c],
  ]) {
    layers.push({ t: "rect", box: { x: cx, y: cy, w: c, h: c }, fill: { color: theme.accent } });
  }

  layers.push({ t: "rect", box: { x: (W - 2.4) / 2, y: 2.5, w: 2.4, h: 0.045 }, fill: { color: theme.accent } });
  const titleBox: Box = { x: 1.6, y: 2.88, w: W - 3.2, h: 1.5 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 40, 24),
    bold: true,
    align: "center",
    font: SERIF,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: (W - 2.4) / 2, y: 4.52, w: 2.4, h: 0.045 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: 2.2, y: 4.85, w: W - 4.4, h: 1.1 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 19, 13),
      align: "center",
      font: SERIF,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: TEXT_X, w: ZONE_W }, true);
  return { bg: theme.titleBg, layers };
}

export const formalVisual: VisualSpec = {
  id: "formal",
  base: "dense",
  photo: {
    title: null,
    section: null,
    bullets: null,
    agenda: null,
    quote: null,
    closing: null,
  },
  plan: {
    title: (s, theme, index, total) => planTitle(s, theme, index, total),
    section: (s, theme, index, total) => planSection(s, theme, index, total),
    bullets: (s, theme, index, total, ctx) => planBullets(s, theme, index, total, ctx),
    agenda: (s, theme, index, total, ctx) => planAgenda(s, theme, index, total, ctx),
    quote: (s, theme, index, total) => planQuote(s, theme, index, total),
    closing: (s, theme, index, total) => planClosing(s, theme, index, total),
  },
};
