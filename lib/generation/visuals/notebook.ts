import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Daftar» dizayni — laboratoriya kundaligi («Tajriba» shabloni, `graphite`).
 *
 * Naqsh: HAR slaydda mayda katakli qog'oz (ingichka, deyarli ko'rinmas
 * chiziqlar) va uning ustidagi «qo'lda yasalgan» elementlar: polaroid
 * ramkali kadr (skotch bilan), yorliq bloki, daftar tabi, punktir chiziq,
 * o'lchov shkalasi bo'ylab kuzatuv qatorlari, katakchali ro'yxat va
 * yopishqoq varaqcha (sticky-note).
 *
 * Qog'oz chizig'i `accent2` (kulrang/neytral) — `accent` esa faqat
 * belgilarda (skotch, tab, shkala) ishlaydi, shunda 15 palitrada ham
 * sahifa «chizilgan qog'oz» bo'lib qoladi, «rangli to'r» emas.
 */

const TEXT_X = 0.9;
const ZONE_W = 11.53;

/** Titul: polaroid ramka va uning ichidagi kadr. */
const TITLE_FRAME: Box = { x: 7.55, y: 1.25, w: 5.0, h: 5.0 };
const TITLE_PHOTO: Box = { x: 7.73, y: 1.43, w: 4.64, h: 3.9 };
/** Iqtibos: o'ngdagi kichik polaroid. */
const QUOTE_FRAME: Box = { x: 8.3, y: 1.9, w: 4.2, h: 4.0 };
const QUOTE_PHOTO: Box = { x: 8.45, y: 2.05, w: 3.9, h: 3.2 };
/** Yakun: shtamp ramkasi ichidagi kadr. */
const CLOSING_PHOTO: Box = { x: 2.85, y: 1.45, w: 7.63, h: 2.6 };

/** Katakli qog'oz — 0.5 dyuymli to'r, alfa 0.10 (juda so'nik). */
function pushGrid(layers: SlideLayer[], theme: SlideTheme): void {
  const { W, H } = LAYOUT_KIT;
  const step = 0.5;
  const fill = { color: theme.accent2, alpha: 0.1 };
  for (let x = step; x < W - 0.01; x += step) {
    layers.push({ t: "rect", box: { x, y: 0, w: 0.012, h: H }, fill });
  }
  for (let y = step; y < H - 0.01; y += step) {
    layers.push({ t: "rect", box: { x: 0, y, w: W, h: 0.012 }, fill });
  }
  // Hoshiya — daftarning qizil chetdagi chizig'i.
  layers.push({ t: "rect", box: { x: 1.0, y: 0, w: 0.02, h: H }, fill: { color: theme.accent, alpha: 0.4 } });
}

/** Polaroid: `surface` ramka + kadr + ustidagi «skotch». */
function pushPolaroid(
  layers: SlideLayer[],
  theme: SlideTheme,
  url: string | undefined,
  frame: Box,
  slot: Box,
  tapeW: number,
): void {
  const { photo } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { ...frame }, fill: { color: theme.surface }, radius: 0.03, shadow: true });
  if (url) {
    photo(layers, url, { ...slot }, 0);
  } else {
    // Kadr yo'q — ramka ichi bo'sh qolmasin: aksent maydon va tartib raqami.
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.accent, alpha: 0.16 } });
    layers.push({
      t: "text",
      box: { ...slot },
      text: "№",
      color: theme.accentInk,
      size: 54,
      bold: true,
      align: "center",
      valign: "middle",
    });
  }
  // Ramka pastidagi «imzo» chizig'i.
  layers.push({
    t: "rect",
    box: { x: slot.x + 0.2, y: slot.y + slot.h + (frame.y + frame.h - slot.y - slot.h) / 2, w: slot.w - 0.4, h: 0.022 },
    fill: { color: theme.accent2, alpha: 0.5 },
  });
  // Skotch — ramkaning yuqori chetini kesib o'tadi.
  layers.push({
    t: "rect",
    box: { x: frame.x + (frame.w - tapeW) / 2, y: frame.y - 0.24, w: tapeW, h: 0.44 },
    fill: { color: theme.accent, alpha: 0.85 },
  });
}

/** Sarlavha + qo'sh chiziq (daftar ustuni) — kontent maketlari uchun. */
function pushNotebookHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, reserve: number): void {
  const { fitSize } = LAYOUT_KIT;
  const headBox: Box = { x: TEXT_X + 0.25, y: 0.45, w: Math.max(3, ZONE_W - 0.25 - reserve), h: 0.8 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 25, 16),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: TEXT_X + 0.25, y: 1.3, w: ZONE_W - 0.25, h: 0.045 }, fill: { color: theme.accent } });
  layers.push({ t: "rect", box: { x: TEXT_X + 0.25, y: 1.4, w: ZONE_W - 0.25, h: 0.018 }, fill: { color: theme.accent, alpha: 0.45 } });
}

function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);

  // Chapdagi yorliq bloki.
  const block: Box = { x: 1.15, y: 1.55, w: 5.95, h: 4.35 };
  layers.push({ t: "rect", box: { ...block }, fill: { color: theme.surface }, radius: 0.05, shadow: true });
  layers.push({ t: "rect", box: { x: block.x, y: block.y, w: 0.12, h: block.h }, fill: { color: theme.accent } });
  const tx = block.x + 0.42;
  const tw = block.w - 0.72;
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x: tx, y: 1.85, w: tw, h: 0.38 },
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
  const titleBox: Box = { x: tx, y: 2.32, w: tw, h: 1.85 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 32, 20),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: tx, y: 4.32, w: 1.3, h: 0.06 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x: tx, y: 4.55, w: tw, h: 1.2 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushPolaroid(layers, theme, s.image?.url, { ...TITLE_FRAME }, { ...TITLE_PHOTO }, 1.5);
  pushFooter(layers, s, theme, index, total, { x: 1.15, w: 5.95 }, false);
  return { bg: theme.bg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);

  // Daftar tabi: to'q blok + tepasida aksent qirra, ichida tartib raqami.
  const tab: Box = { x: 1.15, y: 1.35, w: 1.95, h: 0.82 };
  layers.push({ t: "rect", box: { ...tab }, fill: { color: theme.titleBg }, radius: 0.06 });
  layers.push({ t: "rect", box: { x: tab.x, y: tab.y, w: tab.w, h: 0.13 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: tab.x, y: tab.y + 0.15, w: tab.w, h: tab.h - 0.15 },
    text: String(index + 1).padStart(2, "0"),
    color: theme.titleText,
    size: 26,
    bold: true,
    align: "center",
    valign: "middle",
  });

  const x = 1.15;
  const tw = 11.2;
  const titleBox: Box = { x, y: 2.6, w: tw, h: 2.0 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 40, 24),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  // Punktir — mayda to'g'ri to'rtburchaklar ketma-ketligi.
  for (let i = 0; i < 14; i++) {
    layers.push({ t: "rect", box: { x: x + i * 0.62, y: 4.82, w: 0.36, h: 0.05 }, fill: { color: theme.accent } });
  }
  if (s.subtitle) {
    const subBox: Box = { x, y: 5.18, w: 10.4, h: 1.35 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 20, 13),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: 11.2 }, false);
  return { bg: theme.bg, layers };
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);
  pushNotebookHead(layers, s, theme, ctx.reserve);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  const top = 1.8;
  const zoneH = 5.05;
  const ruleX = 1.62;
  // O'lchov shkalasi va uning bo'linmalari.
  layers.push({ t: "rect", box: { x: ruleX, y: top, w: 0.03, h: zoneH }, fill: { color: theme.accent } });
  for (let i = 0; i <= 12; i++) {
    layers.push({
      t: "rect",
      box: { x: ruleX + 0.03, y: top + (zoneH * i) / 12 - 0.008, w: 0.1, h: 0.016 },
      fill: { color: theme.accent, alpha: 0.45 },
    });
  }

  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    const cy = y + rowH / 2;
    // Shkaladagi kuzatuv nuqtasi.
    layers.push({
      t: "rect",
      box: { x: ruleX - 0.14, y: cy - 0.155, w: 0.31, h: 0.31 },
      fill: { color: theme.accent },
      radius: 0.155,
    });
    layers.push({
      t: "text",
      box: { x: 0.62, y: cy - 0.22, w: 0.82, h: 0.44 },
      text: String(i + 1).padStart(2, "0"),
      color: theme.accentInk,
      size: 14,
      bold: true,
      align: "right",
      valign: "middle",
    });
    const textBox: Box = { x: 2.05, y: y + 0.06, w: 10.35, h: rowH - 0.32 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "bullets", i },
    });
    layers.push({
      t: "rect",
      box: { x: 2.05, y: y + rowH - 0.16, w: 10.35, h: 0.014 },
      fill: { color: theme.accent, alpha: 0.35 },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X + 0.25, w: ZONE_W - 0.25 }, false);
  return { bg: theme.bg, layers };
}

function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);
  pushNotebookHead(layers, s, theme, ctx.reserve);

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const top = 1.8;
  const zoneH = 5.05;
  const rowH = zoneH / Math.max(1, items.length);
  items.forEach((line, i) => {
    const y = top + i * rowH;
    const side = Math.max(0.3, Math.min(0.46, rowH - 0.22));
    // Katakcha — faqat kontur (belgilanmagan bandning ko'rinishi).
    layers.push({
      t: "rect",
      box: { x: 1.2, y: y + (rowH - side) / 2, w: side, h: side },
      line: { color: theme.accent, width: 1.5 },
      radius: 0.03,
    });
    const textBox: Box = { x: 1.2 + side + 0.36, y, w: 12.35 - (1.2 + side + 0.36), h: rowH - 0.1 };
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
      box: { x: textBox.x, y: y + rowH - 0.09, w: textBox.w, h: 0.012 },
      fill: { color: theme.accent, alpha: 0.3 },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: TEXT_X + 0.25, w: ZONE_W - 0.25 }, false);
  return { bg: theme.bg, layers };
}

function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, inkHeight, pushFooter, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);

  // Yopishqoq varaqcha: orqada surilgan «soya» to'rtburchak.
  layers.push({ t: "rect", box: { x: 1.32, y: 1.82, w: 6.5, h: 4.3 }, fill: { color: theme.accent2, alpha: 0.3 } });
  const note: Box = { x: 1.15, y: 1.65, w: 6.5, h: 4.3 };
  layers.push({ t: "rect", box: { ...note }, fill: { color: theme.surface }, shadow: true });
  layers.push({ t: "rect", box: { x: note.x, y: note.y, w: note.w, h: 0.3 }, fill: { color: theme.accent } });

  layers.push({
    t: "text",
    box: { x: note.x + 0.28, y: note.y + 0.42, w: 1.2, h: 1.0 },
    text: "“",
    color: theme.accentInk,
    size: 58,
    bold: true,
  });
  const text = s.quote || s.title;
  const tw = note.w - 0.8;
  const qSize = fitSize(text, { x: 0, y: 0, w: tw, h: 2.1 }, 24, 14);
  const qH = Math.min(2.1, Math.max(0.5, inkHeight(text, tw, qSize)));
  layers.push({
    t: "text",
    box: { x: note.x + 0.4, y: note.y + 1.4, w: tw, h: qH },
    text,
    color: theme.text,
    size: qSize,
    src: { f: "quote" },
  });
  if (s.quoteBy) {
    layers.push({
      t: "text",
      box: { x: note.x + 0.4, y: Math.min(note.y + 3.6, note.y + 1.4 + qH + 0.4), w: tw, h: 0.45 },
      text: s.quoteBy,
      color: theme.muted,
      size: 14,
      uppercase: true,
      tracking: 1.3,
      src: { f: "quoteBy" },
    });
  }
  pushPolaroid(layers, theme, s.image?.url, { ...QUOTE_FRAME }, { ...QUOTE_PHOTO }, 1.2);
  pushFooter(layers, s, theme, index, total, { x: 1.15, w: ZONE_W - 0.25 }, false);
  return { bg: theme.bg, layers };
}

function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter, photo, W, H } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushGrid(layers, theme);

  // «Shtamp» — qo'sh konturli ramka.
  layers.push({ t: "rect", box: { x: 2.4, y: 1.0, w: 8.53, h: 5.3 }, fill: { color: theme.surface } });
  layers.push({ t: "rect", box: { x: 2.4, y: 1.0, w: 8.53, h: 5.3 }, line: { color: theme.accent, width: 2 } });
  layers.push({ t: "rect", box: { x: 2.55, y: 1.15, w: 8.23, h: 5.0 }, line: { color: theme.accent, width: 0.75 } });

  layers.push({ t: "rect", box: { ...CLOSING_PHOTO }, fill: { color: theme.accent, alpha: 0.14 } });
  photo(layers, s.image?.url, { ...CLOSING_PHOTO }, 0);
  layers.push({ t: "rect", box: { x: 2.85, y: 4.25, w: 1.4, h: 0.06 }, fill: { color: theme.accent } });
  const titleBox: Box = { x: 2.85, y: 4.5, w: 7.63, h: 1.0 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 32, 20),
    bold: true,
    src: { f: "title" },
  });
  if (s.subtitle) {
    const subBox: Box = { x: 2.85, y: 5.55, w: 7.63, h: 0.6 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 17, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 2.4, w: 8.53 }, false);
  return { bg: theme.bg, layers };
}

export const notebookVisual: VisualSpec = {
  id: "notebook",
  base: "lab",
  photo: {
    title: { ...TITLE_PHOTO },
    section: null,
    bullets: null,
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
  },
};
