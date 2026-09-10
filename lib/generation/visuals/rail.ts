import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Rels» (rail) — vaqt chizig'i va jarayon shabloni dizayni.
 *
 * Butun deka bitta relsga tizilgan: titulda gorizontal rels va uning
 * o'ng uchida dumaloq kadr, bo'limda relsdagi BITTA yoritilgan tugun
 * (uning ichida dumaloq rasm), bandlarda chapdagi TIK rels, yakunda esa
 * rels katta oxirgi tugunga borib tugaydi. Kartochka va o'q emas —
 * tugun, chiziq, halqa.
 */
const NODE = 0.3;
const RAIL_H = 0.06;

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Tugun — aksent disk, ichida sahifa foni (halqa taassuroti). */
function pushNode(layers: SlideLayer[], theme: SlideTheme, cx: number, cy: number, d = NODE): void {
  layers.push({ t: "rect", box: { x: cx - d / 2, y: cy - d / 2, w: d, h: d }, fill: { color: theme.accent }, radius: d / 2 });
  const inner = d * 0.42;
  layers.push({
    t: "rect",
    box: { x: cx - inner / 2, y: cy - inner / 2, w: inner, h: inner },
    fill: { color: theme.bg },
    radius: inner / 2,
  });
}

/** Rels sarlavhasi — chapdagi tik aksent belgisi bilan. */
function pushHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, x: number, w: number, reserve: number): void {
  const { fitSize } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: x - 0.42, y: 0.4, w: 0.09, h: 0.8 }, fill: { color: theme.accent } });
  const box: Box = { x, y: 0.4, w: w - reserve, h: 0.8 };
  layers.push({
    t: "text",
    box,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, box, 25, 16),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
}

/** Titul — gorizontal rels, uning o'ng uchida dumaloq kadr. */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = railVisual.photo!.title as Box;
  const railY = slot.y + slot.h / 2;
  const x = 0.85;
  const railW = slot.x - 0.25 - x;
  layers.push({ t: "rect", box: { x, y: railY - RAIL_H / 2, w: railW, h: RAIL_H }, fill: { color: theme.accent, alpha: 0.55 } });
  [0.06, 0.34, 0.62, 0.9].forEach((k) => pushNode(layers, theme, x + railW * k, railY));

  const tw = railW - 0.2;
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x, y: 1.2, w: tw, h: 0.42 },
      text: s.kicker,
      color: theme.muted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.2,
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x, y: 1.5, w: tw, h: 1.9 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 34, 20),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.3, w: tw, h: 1.7 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushRingPhoto(layers, s, theme, slot, "→");
  pushFooter(layers, s, theme, index, total, { x, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/** Halqali dumaloq kadr; rasm yo'q bo'lsa — `surface` disk va dekor belgi. */
function pushRingPhoto(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, slot: Box, mark: string): void {
  const ring = 0.22;
  layers.push({
    t: "rect",
    box: { x: slot.x - ring, y: slot.y - ring, w: slot.w + ring * 2, h: slot.h + ring * 2 },
    fill: { color: theme.accent },
    radius: slot.w / 2 + ring,
  });
  if (s.image?.url) {
    layers.push({ t: "image", box: { ...slot }, url: s.image.url, shape: "circle" });
    return;
  }
  layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.surface }, radius: slot.w / 2 });
  layers.push({
    t: "text",
    box: { ...slot },
    text: mark,
    color: theme.accentInk,
    size: Math.round(slot.w * 34),
    bold: true,
    align: "center",
    valign: "middle",
  });
}

/** Bo'lim — relsdagi BITTA yirik tugun (ichida kadr), ostida bo'lim nomi. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = railVisual.photo!.section as Box;
  const railY = slot.y + slot.h / 2;
  layers.push({ t: "rect", box: { x: 0.85, y: railY - RAIL_H / 2, w: 11.6, h: RAIL_H }, fill: { color: theme.accent, alpha: 0.4 } });
  const cx = slot.x + slot.w / 2;
  [4.6, 6.35, 8.1, 9.85, 11.6].forEach((nx) => pushNode(layers, theme, nx, railY, 0.24));
  layers.push({
    t: "text",
    box: { x: cx - 1.0, y: 0.82, w: 2.0, h: 0.6 },
    text: two(index + 1),
    color: theme.accentInk,
    size: 26,
    bold: true,
    align: "center",
    valign: "middle",
  });
  pushRingPhoto(layers, s, theme, slot, two(index + 1));
  const x = 0.85;
  const tw = 11.6;
  const titleBox: Box = { x, y: 3.9, w: tw, h: 1.5 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 40, 24),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 5.55, w: tw, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 13),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Bandlar va reja — chapdagi TIK rels, har bandga bitta tugun. */
function planVertical(
  s: SlideModel,
  theme: SlideTheme,
  index: number,
  total: number,
  ctx: PlanCtx,
  agenda: boolean,
): SlidePlan {
  const { W, H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const railX = agenda ? 1.35 : 1.15;
  const withImg = !agenda && Boolean(s.image?.url);
  const slot = railVisual.photo!.bullets as Box;
  const right = withImg ? slot.x - 0.4 : 12.45;
  pushHead(layers, s, theme, railX + 0.55, right - railX - 0.55, ctx.reserve);
  if (withImg) photo(layers, s.image!.url, slot, 0);

  const items = (s.bullets ?? []).slice(0, agenda ? ctx.bodyType.agendaMax : ctx.bodyType.maxBullets);
  const n = Math.max(1, items.length);
  const zoneY = 1.6;
  const zoneH = 6.75 - zoneY;
  const rowH = zoneH / n;
  const d = agenda ? 0.66 : 0.36;
  layers.push({
    t: "rect",
    box: { x: railX - RAIL_H / 2, y: zoneY + rowH / 2, w: RAIL_H, h: Math.max(0, zoneH - rowH) },
    fill: { color: theme.accent, alpha: 0.5 },
  });
  items.forEach((line, i) => {
    const cy = zoneY + i * rowH + rowH / 2;
    if (agenda) {
      // Reja: tugun ichida raqam — to'q disk, yorug' raqam.
      layers.push({ t: "rect", box: { x: railX - d / 2, y: cy - d / 2, w: d, h: d }, fill: { color: theme.titleBg }, radius: d / 2 });
      layers.push({
        t: "text",
        box: { x: railX - d / 2, y: cy - d / 2, w: d, h: d },
        text: two(i + 1),
        color: theme.titleText,
        size: 15,
        bold: true,
        align: "center",
        valign: "middle",
      });
    } else {
      pushNode(layers, theme, railX, cy, d);
    }
    const tx = railX + d / 2 + 0.42;
    const box: Box = { x: tx, y: cy - rowH / 2 + 0.06, w: right - tx, h: rowH - 0.12 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt + (agenda ? 2 : 0), ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: railX + 0.55, w: 12.45 - railX - 0.55 }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  return planVertical(s, theme, index, total, ctx, false);
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  return planVertical(s, theme, index, total, ctx, true);
}

/**
 * Bosqichlar — dizaynning IMZO maketi: gorizontal rels, tugunlar
 * kartalarning USTIDA turadi. Eski `timeline` tarmog'idan farqi:
 * tugunlar raqamli va to'q, o'q belgilari yo'q, kartalar chegarasiz.
 */
function planProcess(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { W, H, fitSize, stripCut, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const cut = stripCut(s);
  const x0 = 0.85;
  const tw = 11.6 - cut;
  pushHead(layers, s, theme, x0, tw, ctx.reserve);
  const items = (s.steps ?? []).slice(0, 5);
  const n = Math.max(1, items.length);
  const gap = 0.34;
  const colW = (tw - gap * (n - 1)) / n;
  const cardY = 2.55;
  const cardH = 3.35;
  const railY = 2.15;
  const centerOf = (i: number) => x0 + i * (colW + gap) + colW / 2;
  if (n >= 2) {
    layers.push({
      t: "rect",
      box: { x: centerOf(0), y: railY - RAIL_H / 2, w: centerOf(n - 1) - centerOf(0), h: RAIL_H },
      fill: { color: theme.accent, alpha: 0.5 },
    });
  }
  items.forEach((st, i) => {
    const x = x0 + i * (colW + gap);
    layers.push({ t: "rect", box: { x, y: cardY, w: colW, h: cardH }, fill: { color: theme.surface }, radius: 0.18 });
    const d = 0.62;
    const cx = centerOf(i);
    layers.push({ t: "rect", box: { x: cx - d / 2, y: railY - d / 2, w: d, h: d }, fill: { color: theme.titleBg }, radius: d / 2 });
    layers.push({
      t: "text",
      box: { x: cx - d / 2, y: railY - d / 2, w: d, h: d },
      text: st.n || String(i + 1),
      color: theme.titleText,
      size: 16,
      bold: true,
      align: "center",
      valign: "middle",
      src: { f: "steps", i, k: "n" },
    });
    const tBox: Box = { x: x + 0.24, y: cardY + 0.38, w: colW - 0.48, h: 1.05 };
    layers.push({
      t: "text",
      box: tBox,
      text: st.title,
      color: theme.text,
      size: fitSize(st.title, tBox, 19, 12),
      bold: true,
      align: "center",
      src: { f: "steps", i, k: "title" },
    });
    layers.push({ t: "rect", box: { x: cx - 0.4, y: cardY + 1.58, w: 0.8, h: 0.05 }, fill: { color: theme.accent } });
    const dBox: Box = { x: x + 0.24, y: cardY + 1.82, w: colW - 0.48, h: cardH - 2.05 };
    layers.push({
      t: "text",
      box: dBox,
      text: st.text,
      color: theme.muted,
      size: fitSize(st.text, dBox, 15, 11),
      align: "center",
      src: { f: "steps", i, k: "text" },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: x0, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos — ikki tugun orasidagi rels, matn relsning o'rtasida. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const railY = 3.55;
  layers.push({ t: "rect", box: { x: 1.5, y: railY - RAIL_H / 2, w: 1.05, h: RAIL_H }, fill: { color: theme.accent, alpha: 0.55 } });
  layers.push({ t: "rect", box: { x: 10.78, y: railY - RAIL_H / 2, w: 1.05, h: RAIL_H }, fill: { color: theme.accent, alpha: 0.55 } });
  pushNode(layers, theme, 1.5, railY, 0.44);
  pushNode(layers, theme, 11.83, railY, 0.44);
  const quote = s.quote || s.title;
  const qBox: Box = { x: 2.85, y: 1.95, w: 7.65, h: 3.2 };
  layers.push({
    t: "text",
    box: qBox,
    text: quote,
    color: theme.text,
    size: fitSize(quote, qBox, 30, 15),
    bold: true,
    align: "center",
    valign: "middle",
    src: { f: "quote" },
  });
  layers.push({ t: "rect", box: { x: 6.29, y: 4.95, w: 0.75, h: 0.05 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 2.85, y: 5.15, w: 7.65, h: 0.5 },
    text: s.quoteBy || "",
    color: theme.muted,
    size: 15,
    bold: true,
    uppercase: true,
    tracking: 1.8,
    align: "center",
    valign: "middle",
    src: { f: "quoteBy" },
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

/** Yakun — rels yirik OXIRGI tugunga borib tugaydi (ichida kadr). */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const slot = railVisual.photo!.closing as Box;
  const railY = slot.y + slot.h / 2;
  const x = 0.85;
  const railW = slot.x - 0.25 - x;
  layers.push({ t: "rect", box: { x, y: railY - RAIL_H / 2, w: railW, h: RAIL_H }, fill: { color: theme.accent, alpha: 0.55 } });
  [0.1, 0.42, 0.74].forEach((k) => pushNode(layers, theme, x + railW * k, railY, 0.26));
  const tw = railW - 0.2;
  const titleBox: Box = { x, y: 1.5, w: tw, h: 1.75 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 38, 22),
    bold: true,
    align: "center",
    valign: "bottom",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: 3.4, w: tw, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 19, 13),
      align: "center",
      src: { f: "subtitle" },
    });
  }
  pushRingPhoto(layers, s, theme, slot, "✦");
  pushFooter(layers, s, theme, index, total, { x, w: 11.6 }, false);
  return { bg: theme.bg, layers };
}

export const railVisual: VisualSpec = {
  id: "rail",
  base: "timeline",
  photo: {
    title: { x: 10.15, y: 2.7, w: 2.4, h: 2.4 },
    section: { x: 1.25, y: 1.83, w: 1.6, h: 1.6 },
    bullets: { x: 9.35, y: 1.6, w: 3.1, h: 4.9 },
    agenda: null,
    quote: null,
    closing: { x: 10.15, y: 4.05, w: 1.9, h: 1.9 },
  },
  plan: {
    title: planTitle,
    section: planSection,
    bullets: planBullets,
    agenda: planAgenda,
    quote: planQuote,
    closing: planClosing,
    process: planProcess,
  },
};
