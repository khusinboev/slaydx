import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Minimal grid» (grid) — jurnal setkasi dizayni (Program 17, 17-band).
 *
 * Tili: hamma narsa 12 ustunli setkaga oturgan plitkalar; ulkan raqamlar
 * (reja raqami, bandlar tartibi), ingichka «gazeta» chiziqlari, rasm —
 * plitkalardan biri (mozaikada rang bloklari bilan yonma-yon). Kartasoya,
 * dumaloq burchak, ramka-bezak YO'Q: faqat to'g'ri burchakli plitkalar va
 * tipografika. Eski oilalardan farqi: bandlar ro'yxat emas — har biri o'z
 * plitkasi (raqam + matn), reja — ikki ustunli raqamli setka.
 *
 * Rasm — `s.image` (bitta); u setkaning bitta plitkasiga tushadi, qolgan
 * plitkalar rang (`titleBg`, `accent`, `surface`) — shuning uchun rasm
 * bo'lmasa ham mozaika to'liq.
 *
 * Rang: aksent faqat to'ldirish; matn — `text/bg`, `accentInk/surface|bg`,
 * `titleText/titleBg`, `titleMuted/titleBg` (o'lchangan juftliklar).
 */
const X = 0.6;
const ZW = 12.13;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Jurnal chizig'i — to'liq kenglikdagi ingichka qora chiziq. */
function rule(layers: SlideLayer[], theme: SlideTheme, y: number, x = X, w = ZW, h = 0.03): void {
  layers.push({ t: "rect", box: { x, y, w, h }, fill: { color: theme.text, alpha: 0.85 } });
}

/** Sarlavha (chapda) + ostida jurnal chizig'i. */
function pushHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, reserve: number): void {
  const { badgedTitle, pushPlanBadge } = LAYOUT_KIT;
  const boxT = badgedTitle(s, { x: X, y: 0.4, w: ZW - reserve, h: 0.95 }, 30, 18);
  pushPlanBadge(layers, s, boxT, theme, { titleValign: "middle" });
  layers.push({
    t: "text",
    box: boxT.box,
    text: s.title,
    color: theme.text,
    size: boxT.size,
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  rule(layers, theme, 1.5);
}

/** Dekorativ plitka: rangli blok; `arrow` bo'lsa ichida yirik strelka. */
function pushArrowTile(layers: SlideLayer[], theme: SlideTheme, box: Box): void {
  layers.push({ t: "rect", box, fill: { color: theme.surface }, line: { color: theme.accent, width: 1 } });
  layers.push({
    t: "text",
    box,
    text: "→",
    color: theme.accentInk,
    size: 54,
    bold: true,
    align: "center",
    valign: "middle",
  });
}

/** Titul: chapda ulkan pastga tekis sarlavha, o'ngda 3 plitkali mozaika. */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, photo, pushFooter, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = gridVisual.photo!.title as Box;
  if (s.image?.url) photo(layers, s.image.url, slot, 0);
  else layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: slot.x, y: 4.62, w: 1.87, h: 2.2 }, fill: { color: theme.accent } });
  pushArrowTile(layers, theme, { x: slot.x + 2.0, y: 4.62, w: slot.w - 2.0, h: 2.2 });
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: X, y: 0.45, w: 7.9, h: 0.45 },
      text: s.kicker,
      color: theme.muted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.4,
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  rule(layers, theme, 1.0, X, 7.9);
  const titleBox: Box = { x: X, y: 1.3, w: 7.9, h: 4.15 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 48, 24, CHAR_EM_BOLD),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: X, y: 5.65, w: 7.9, h: 1.2 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: X, w: 7.9 }, false);
  return { bg: theme.bg, layers };
}

/** Bo'lim: tepada ulkan reja raqami, ostida chiziq, sarlavha va izoh yonma-yon ustunlarda. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter, planNumber, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const no = planNumber(s);
  if (no) {
    layers.push({
      t: "text",
      box: { x: X, y: 0.7, w: 7.0, h: 3.7 },
      text: no,
      color: theme.accentInk,
      size: 160,
      bold: true,
      valign: "middle",
    });
  } else {
    layers.push({ t: "rect", box: { x: X, y: 1.6, w: 1.6, h: 1.6 }, fill: { color: theme.accent } });
  }
  rule(layers, theme, 4.65);
  const hasSub = Boolean(s.subtitle);
  const tw = hasSub ? 7.4 : ZW;
  const titleBox: Box = { x: X, y: 4.9, w: tw, h: 1.9 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 36, 20, CHAR_EM_BOLD),
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  if (hasSub) {
    const subBox: Box = { x: 8.35, y: 4.95, w: ZW - 7.75, h: 1.85 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle!,
      color: theme.muted,
      size: fitSize(s.subtitle!, subBox, 16, 11),
      valign: "top",
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: X, w: ZW }, false);
  return { bg: theme.bg, layers };
}

/**
 * Plitka setkasi: `items` qatorlari `cols` ustunda; har plitka — raqam
 * (yirik, `accentInk`) + matn. Plitka baland bo'lsa (balandligi eniga
 * yaqin) raqam tepada, past bo'lsa — chapda.
 */
function pushTiles(
  layers: SlideLayer[],
  theme: SlideTheme,
  items: string[],
  zone: Box,
  cols: number,
  opts: { pad: boolean; basePt: number; minPt: number; agenda: boolean; ctx: PlanCtx },
): void {
  const { fitSize, agendaFit } = LAYOUT_KIT;
  const n = items.length;
  const rows = Math.ceil(n / cols);
  const gap = 0.18;
  const tw0 = (zone.w - gap * (cols - 1)) / cols;
  const th = (zone.h - gap * (rows - 1)) / rows;
  items.forEach((line, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = zone.x + c * (tw0 + gap);
    const y = zone.y + r * (th + gap);
    // Oxirgi yolg'iz plitka butun qatorni egallaydi — setkada bo'sh katak qolmasin.
    const alone = cols > 1 && i === n - 1 && n % cols === 1;
    const tw = alone ? zone.w : tw0;
    const tall = th >= tw * 0.85;
    layers.push({ t: "rect", box: { x, y, w: tw, h: th }, fill: { color: theme.surface }, line: { color: theme.accent, width: 1 } });
    layers.push({ t: "rect", box: { x, y, w: tw, h: 0.07 }, fill: { color: theme.accent } });
    const label = opts.pad ? two(i + 1) : String(i + 1);
    const numBox: Box = tall ? { x: x + 0.28, y: y + 0.2, w: tw - 0.56, h: 1.1 } : { x: x + 0.2, y: y + 0.07, w: Math.min(1.1, tw * 0.22), h: th - 0.07 };
    layers.push({
      t: "text",
      box: numBox,
      text: label,
      color: theme.accentInk,
      size: tall ? 54 : Math.min(opts.pad ? 40 : 44, Math.max(22, Math.floor(th * 40))),
      bold: true,
      valign: tall ? "top" : "middle",
    });
    const box: Box = tall
      ? { x: x + 0.28, y: y + 1.4, w: tw - 0.56, h: th - 1.6 }
      : { x: numBox.x + numBox.w + 0.1, y: y + 0.12, w: tw - numBox.w - 0.45, h: th - 0.2 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: opts.agenda ? agendaFit(line, box, opts.basePt) : fitSize(line, box, opts.basePt, opts.minPt),
      valign: tall ? "top" : "middle",
      src: { f: opts.agenda ? "bullets" : "bullets", i },
    });
  });
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushHead(layers, s, theme, ctx.reserve);
  const slot = gridVisual.photo!.bullets as Box;
  const withImg = Boolean(s.image?.url);
  if (withImg) photo(layers, s.image!.url, slot, 0);
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const n = Math.max(1, items.length);
  const zone: Box = withImg ? { x: slot.x + slot.w + 0.2, y: slot.y, w: X + ZW - (slot.x + slot.w + 0.2), h: slot.h } : { x: X, y: 1.75, w: ZW, h: 5.1 };
  const cols = withImg ? (n <= 2 ? 1 : 2) : n <= 3 ? n : n === 4 ? 2 : 3;
  pushTiles(layers, theme, items, zone, cols, { pad: false, basePt: ctx.bodyType.bodyPt, minPt: ctx.bodyType.minPt - 1, agenda: false, ctx });
  pushFooter(layers, s, theme, index, total, { x: X, w: ZW }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushHead(layers, s, theme, ctx.reserve);
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const n = Math.max(1, items.length);
  const cols = n >= 4 ? 2 : 1;
  pushTiles(layers, theme, items, { x: X, y: 1.75, w: ZW, h: 5.1 }, cols, {
    pad: true,
    basePt: ctx.bodyType.bodyPt + 2,
    minPt: ctx.bodyType.minPt - 1,
    agenda: true,
    ctx,
  });
  pushFooter(layers, s, theme, index, total, { x: X, w: ZW }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos: chapda yirik tirnoq va matn, o'ngda baland kadr plitkasi. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, inkHeight, photo, pushFooter, pushPlanBadgeAt, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = gridVisual.photo!.quote as Box;
  if (s.image?.url) photo(layers, s.image.url, slot, 0);
  else {
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.titleBg } });
    layers.push({ t: "rect", box: { x: slot.x, y: slot.y + slot.h - 1.4, w: slot.w, h: 1.4 }, fill: { color: theme.accent } });
  }
  layers.push({
    t: "text",
    box: { x: X, y: 0.45, w: 2.0, h: 2.0 },
    text: "“",
    color: theme.accentInk,
    size: 150,
    bold: true,
    font: "Georgia",
    valign: "middle",
  });
  const text = s.quote || s.title;
  const tw = slot.x - X - 0.6;
  const qSize = fitSize(text, { x: X, y: 0, w: tw, h: 3.4 }, 34, 18, CHAR_EM_BOLD);
  const qH = Math.min(3.4, Math.max(0.8, inkHeight(text, tw, qSize, CHAR_EM_BOLD)));
  const qY = 2.75;
  // Reja nishoni (faqat `plan` li iqtibos) — iqtibos USTIDA, tirnoq yonida.
  pushPlanBadgeAt(layers, s, X + 2.1, qY - 0.75, theme.accentInk, { size: 18 });
  layers.push({
    t: "text",
    box: { x: X, y: qY, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    bold: true,
    valign: "top",
    src: { f: "quote" },
  });
  const ruleY = Math.min(6.4, qY + qH + 0.35);
  rule(layers, theme, ruleY, X, tw);
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: X, y: ruleY + 0.15, w: tw, h: 0.5 },
      text: s.quoteBy,
      color: theme.muted,
      size: 14,
      bold: true,
      uppercase: true,
      tracking: 2,
      valign: "middle",
      src: { f: "quoteBy" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: X, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Yakun: katta to'q plitka (sarlavha) + o'ngda kadr / aksent / strelka plitkalari. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, photo, pushFooter, CHAR_EM_BOLD } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const big: Box = { x: X, y: 0.6, w: 8.1, h: 6.2 };
  layers.push({ t: "rect", box: big, fill: { color: theme.titleBg } });
  const titleBox: Box = { x: big.x + 0.6, y: big.y + 0.8, w: big.w - 1.2, h: 2.9 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 48, 24, CHAR_EM_BOLD),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: big.x + 0.6, y: big.y + 3.95, w: 1.6, h: 0.08 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: big.x + 0.6, y: big.y + 4.25, w: big.w - 1.2, h: 1.6 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 20, 13),
      src: { f: "subtitle" },
    });
  }
  const slot = gridVisual.photo!.closing as Box;
  if (s.image?.url) photo(layers, s.image.url, slot, 0);
  else layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.surface }, line: { color: theme.accent, width: 1 } });
  layers.push({ t: "rect", box: { x: slot.x, y: 4.05, w: 1.8, h: 2.75 }, fill: { color: theme.accent } });
  pushArrowTile(layers, theme, { x: slot.x + 1.95, y: 4.05, w: slot.w - 1.95, h: 2.75 });
  pushFooter(layers, s, theme, index, total, { x: X, w: ZW }, false);
  void W;
  void H;
  return { bg: theme.bg, layers };
}

export const gridVisual: VisualSpec = {
  id: "grid",
  base: "cards",
  photo: {
    title: { x: 8.85, y: 0.6, w: 3.88, h: 3.9 },
    section: null,
    bullets: { x: X, y: 1.75, w: 3.9, h: 5.1 },
    agenda: null,
    quote: { x: 9.0, y: 0.6, w: 3.73, h: 6.2 },
    closing: { x: 8.9, y: 0.6, w: 3.83, h: 3.3 },
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
