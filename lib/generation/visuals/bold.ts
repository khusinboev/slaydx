import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Qalin» (bold) — pitch va muammo→yechim shabloni dizayni.
 *
 * Pitch dekasining tili: KAM element, KATTA o'lcham. Bandlar ro'yxat
 * emas — har biri butun kenglikni egallagan QATOR, chapida ulkan «01»
 * raqami; raqamlar slaydi kartasiz «afisha raqamlari»; bo'lim to'la to'q
 * sahifa, yakun esa bitta yirik chaqiruv bloki. Ramka, soya, kartochka
 * yo'q — faqat tipografika va bitta aksent.
 */
function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Yuqori sarlavha — qalin aksent lentasi ostidagi yirik matn. */
function pushHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, w: number, reserve: number): void {
  const { fitSize } = LAYOUT_KIT;
  const box: Box = { x: 0.85, y: 0.42, w: w - reserve, h: 0.86 };
  layers.push({
    t: "text",
    box,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, box, 27, 17),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: 0.85, y: 1.36, w, h: 0.11 }, fill: { color: theme.accent } });
}

/** Titul — chapda to'la balandlikdagi kadr, o'ngda ulkan sarlavha. */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.bg } });
  const slot = boldVisual.photo!.title as Box;
  if (s.image?.url) {
    photo(layers, s.image.url, slot, 0);
  } else {
    // Rasmsiz ham chap ustun BO'SH qolmaydi: to'q blok + yirik strelka.
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.titleBg } });
    layers.push({
      t: "text",
      box: { x: slot.x, y: 2.2, w: slot.w, h: 3.1 },
      text: "→",
      color: theme.titleText,
      size: 130,
      bold: true,
      align: "center",
      valign: "middle",
    });
  }
  const x = 6.5;
  const tw = 6.15;
  if (s.kicker) {
    const kw = Math.min(tw, 0.6 + s.kicker.length * 0.135);
    layers.push({ t: "rect", box: { x, y: 1.12, w: kw, h: 0.52 }, fill: { color: theme.titleBg } });
    layers.push({
      t: "text",
      box: { x: x + 0.22, y: 1.12, w: kw - 0.44, h: 0.52 },
      text: s.kicker,
      color: theme.titleText,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 1.8,
      valign: "middle",
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x, y: 1.95, w: tw, h: 2.85 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 43, 24),
    bold: true,
    valign: "top",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x, y: 4.95, w: 1.7, h: 0.11 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x, y: 5.25, w: tw, h: 1.4 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Bo'lim — butun sahifa to'q, chapda aksent ustun, ulkan nom. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { H, fitSize, inkHeight, pushFooter, SECTION_TOP, SECTION_BOTTOM } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.titleBg } });
  const x = 1.75;
  const tw = 10.7;
  const titleSize = fitSize(s.title, { x, y: 0, w: tw, h: 2.6 }, 52, 26);
  const subSize = s.subtitle ? fitSize(s.subtitle, { x, y: 0, w: tw, h: 1.4 }, 20, 13) : 0;
  const avail = SECTION_BOTTOM - SECTION_TOP - 0.85;
  const titleH = Math.min(avail * (s.subtitle ? 0.66 : 1), Math.max(0.7, inkHeight(s.title, tw, titleSize)));
  const subH = s.subtitle ? Math.min(avail - titleH, Math.max(0.4, inkHeight(s.subtitle, tw, subSize))) : 0;
  const blockH = 0.55 + titleH + (s.subtitle ? 0.34 + subH : 0);
  const y0 = SECTION_TOP + Math.max(0, (SECTION_BOTTOM - SECTION_TOP - blockH) / 2);
  // Aksent ustuni matn blokining O'ZI bilan bir balandlikda — aks holda
  // u zonaning to'liq bo'yiga cho'zilib, matndan uzilib qolardi.
  layers.push({ t: "rect", box: { x: 0.85, y: y0, w: 0.35, h: blockH }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x, y: y0, w: 2.0, h: 0.45 },
    text: two(index + 1),
    color: theme.titleMuted,
    size: 15,
    bold: true,
    tracking: 2.4,
    valign: "middle",
  });
  layers.push({
    t: "text",
    box: { x, y: y0 + 0.55, w: tw, h: titleH },
    text: s.title,
    color: theme.titleText,
    size: titleSize,
    bold: true,
    src: { f: "title" },
  });
  if (s.subtitle) {
    layers.push({
      t: "text",
      box: { x, y: y0 + 0.55 + titleH + 0.34, w: tw, h: subH },
      text: s.subtitle,
      color: theme.titleMuted,
      size: subSize,
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: 10.7 }, true);
  return { bg: theme.titleBg, layers };
}

/** Bandlar/reja qatorlari — ulkan raqam + matn, orasida ingichka chiziq. */
function planRows(
  s: SlideModel,
  theme: SlideTheme,
  index: number,
  total: number,
  ctx: PlanCtx,
  agenda: boolean,
): SlidePlan {
  const { H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.bg } });
  const slot = boldVisual.photo!.bullets as Box;
  const withImg = !agenda && Boolean(s.image?.url);
  if (withImg) photo(layers, s.image!.url, slot, 0);
  const tw = withImg ? slot.x - 0.85 - 0.45 : 11.6;
  pushHead(layers, s, theme, tw, ctx.reserve);

  const items = (s.bullets ?? []).slice(0, agenda ? ctx.bodyType.agendaMax : ctx.bodyType.maxBullets);
  const n = Math.max(1, items.length);
  const zoneY = 1.75;
  const zoneH = 6.75 - zoneY;
  const rowH = zoneH / n;
  const numW = agenda ? 1.45 : 1.15;
  items.forEach((line, i) => {
    const y = zoneY + i * rowH;
    if (i > 0) {
      layers.push({ t: "rect", box: { x: 0.85, y, w: tw, h: 0.02 }, fill: { color: theme.accent, alpha: 0.45 } });
    }
    const numBox: Box = { x: 0.85, y, w: numW, h: rowH };
    layers.push({
      t: "text",
      box: numBox,
      text: two(i + 1),
      color: theme.accentInk,
      size: fitSize(two(i + 1), numBox, agenda ? 54 : 42, 20),
      bold: true,
      valign: "middle",
    });
    const box: Box = { x: 0.85 + numW + 0.2, y: y + 0.05, w: tw - numW - 0.2, h: rowH - 0.1 };
    layers.push({
      t: "text",
      box,
      text: line,
      color: theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt + (agenda ? 3 : 0), ctx.bodyType.minPt - 1),
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: tw }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  return planRows(s, theme, index, total, ctx, false);
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  return planRows(s, theme, index, total, ctx, true);
}

/**
 * Raqamlar — AFISHA: kartochka yo'q, faqat ulkan qiymatlar.
 *
 * `dense`/`classic` dagi kartali variantdan ataylab voz kechildi: pitch
 * dekasida raqam KO'rsatkich emas, da'vo — shuning uchun u sahifadagi
 * eng katta element bo'ladi.
 */
function planStats(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { H, fitSize, stripCut, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  const cut = stripCut(s);
  const tw = 11.6 - cut;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.bg } });
  pushHead(layers, s, theme, tw, ctx.reserve);
  const items = (s.stats ?? []).slice(0, 4);
  const n = Math.max(1, items.length);
  const gap = 0.35;
  const colW = (tw - gap * (n - 1)) / n;
  items.forEach((st, i) => {
    const x = 0.85 + i * (colW + gap);
    const valBox: Box = { x, y: 2.5, w: colW, h: 2.0 };
    layers.push({
      t: "text",
      box: valBox,
      text: st.value,
      color: theme.accentInk,
      size: fitSize(st.value, valBox, 66, 24),
      bold: true,
      align: "center",
      valign: "middle",
      src: { f: "stats", i, k: "value" },
    });
    layers.push({ t: "rect", box: { x: x + colW / 2 - 0.55, y: 4.72, w: 1.1, h: 0.08 }, fill: { color: theme.accent } });
    const labBox: Box = { x: x + 0.1, y: 5.02, w: colW - 0.2, h: 1.7 };
    layers.push({
      t: "text",
      box: labBox,
      text: st.label,
      color: theme.muted,
      size: fitSize(st.label, labBox, 17, 11),
      align: "center",
      valign: "top",
      src: { f: "stats", i, k: "label" },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 0.85, w: tw }, false);
  return { bg: theme.bg, layers };
}

/** Iqtibos — to'q sahifa, qalin yirik matn, aksent tagchiziqli muallif. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.titleBg } });
  photo(layers, s.image?.url, { x: 0, y: 0, w: 13.333, h: H }, 0.7);
  layers.push({ t: "rect", box: { x: 1.3, y: 1.35, w: 0.11, h: 4.3 }, fill: { color: theme.accent } });
  const quote = s.quote || s.title;
  const qBox: Box = { x: 1.85, y: 1.55, w: 10.0, h: 3.4 };
  layers.push({
    t: "text",
    box: qBox,
    text: quote,
    color: theme.titleText,
    size: fitSize(quote, qBox, 38, 18),
    bold: true,
    valign: "middle",
    src: { f: "quote" },
  });
  layers.push({ t: "rect", box: { x: 1.85, y: 5.25, w: 1.4, h: 0.08 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 1.85, y: 5.45, w: 8.0, h: 0.5 },
    text: s.quoteBy || "",
    color: theme.titleMuted,
    size: 14,
    bold: true,
    uppercase: true,
    tracking: 2.4,
    valign: "middle",
    src: { f: "quoteBy" },
  });
  // Kolontitul yorug' kadr ustida yo'qolib ketmasin — pastki plashka.
  if (s.image?.url) {
    layers.push({ t: "rect", box: { x: 0, y: 6.95, w: 13.333, h: 0.55 }, fill: { color: "#000000", alpha: 0.45 } });
  }
  pushFooter(layers, s, theme, index, total, { x: 1.3, w: 10.55 }, true);
  return { bg: theme.titleBg, layers };
}

/** Yakun — yorug' sahifa va bitta yirik chaqiruv bloki. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { H, fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.bg } });
  const block: Box = { x: 1.15, y: 1.3, w: 11.05, h: 4.65 };
  layers.push({ t: "rect", box: block, fill: { color: theme.titleBg }, radius: 0.2 });
  layers.push({ t: "rect", box: { x: block.x + 4.98, y: block.y + 0.62, w: 1.1, h: 0.1 }, fill: { color: theme.accent } });
  const titleBox: Box = { x: block.x + 0.8, y: block.y + 1.05, w: block.w - 1.6, h: 2.1 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 42, 22),
    bold: true,
    align: "center",
    valign: "middle",
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: block.x + 1.2, y: block.y + 3.25, w: block.w - 2.4, h: 1.15 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 19, 12),
      align: "center",
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 1.15, w: 11.05 }, false);
  return { bg: theme.bg, layers };
}

export const boldVisual: VisualSpec = {
  id: "bold",
  base: "hero-split",
  photo: {
    title: { x: 0, y: 0, w: 6.0, h: 7.5 },
    section: null,
    bullets: { x: 9.4, y: 0, w: 3.933, h: 7.5 },
    agenda: null,
    quote: { x: 0, y: 0, w: 13.333, h: 7.5 },
    closing: null,
  },
  fullBleed: ["quote"],
  plan: {
    title: planTitle,
    section: planSection,
    bullets: planBullets,
    agenda: planAgenda,
    quote: planQuote,
    closing: planClosing,
    stats: planStats,
  },
};
