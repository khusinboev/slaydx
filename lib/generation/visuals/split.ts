import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "../slide-layout";
import type { SlideModel, SlideTheme } from "../slide-types";
import type { VisualSpec } from "./spec";

/**
 * «Ikkiga» (split) — qiyos va munozara shabloni dizayni.
 *
 * Bitta g'oya butun dekaga tarqalgan: HAR slayd tik chok bilan ikkiga
 * bo'linadi — bir yarmi to'q (`titleBg`), ikkinchisi yorug'
 * (`surface`), orasida ingichka aksent chok. Sarlavha chapda,
 * mazmun o'ngda; yakuniy slaydda esa aksincha (oyna aksi).
 *
 * Nega yarim fon `bg` emas, `surface`: to'q palitralarda (`orbit`,
 * `chalk`) `bg` va `titleBg` deyarli bir xil — bunday temada chok
 * KO'RINMASDI. `surface` har palitrada `titleBg` dan bir pog'ona
 * yorug'roq, ustiga to'q yarmiga yengil qora qoplama qo'yiladi —
 * shunda «ikkiga bo'lingan» taassurot 15 palitrada ham saqlanadi.
 */
const SEAM = 6.55;
/** To'q yarmning qo'shimcha qoralanishi — to'q temada chokni ko'rsatadi. */
const PANEL_DIM = 0.2;
const INK = "#000000";

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Ikki yarm + chok. `mirror` — to'q yarm o'ngda (yakuniy slayd). */
function pushHalves(layers: SlideLayer[], theme: SlideTheme, mirror = false): void {
  const { W, H } = LAYOUT_KIT;
  const dark: Box = mirror ? { x: SEAM, y: 0, w: W - SEAM, h: H } : { x: 0, y: 0, w: SEAM, h: H };
  const light: Box = mirror ? { x: 0, y: 0, w: SEAM, h: H } : { x: SEAM, y: 0, w: W - SEAM, h: H };
  layers.push({ t: "rect", box: light, fill: { color: theme.surface } });
  layers.push({ t: "rect", box: dark, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: dark, fill: { color: INK, alpha: PANEL_DIM } });
  layers.push({ t: "rect", box: { x: SEAM - 0.03, y: 0, w: 0.06, h: H }, fill: { color: theme.accent } });
}

/** Titul — chapda kicker + sarlavha, o'ngda rasm (yoki yirik raqam). */
function planTitle(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme);
  const x = 0.85;
  const tw = 5.0;
  if (s.kicker) {
    layers.push({
      t: "text",
      box: { x, y: 1.35, w: tw, h: 0.42 },
      text: s.kicker,
      color: theme.titleMuted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.2,
      src: { f: "kicker" },
    });
  }
  const titleBox: Box = { x, y: 1.9, w: tw, h: 2.5 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 34, 20),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x, y: 4.58, w: 1.4, h: 0.07 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.9, w: tw, h: 1.55 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 17, 12),
      src: { f: "subtitle" },
    });
  }
  // O'ng yarm: rasm ramka ichida; rasm yo'q bo'lsa — yirik kontur raqam.
  const slot = splitVisual.photo!.title as Box;
  if (s.image?.url) {
    layers.push({ t: "rect", box: { x: slot.x - 0.12, y: slot.y - 0.12, w: slot.w + 0.24, h: slot.h + 0.24 }, fill: { color: theme.accent, alpha: 0.16 } });
    photo(layers, s.image.url, slot, 0);
  } else {
    layers.push({ t: "rect", box: { x: 7.6, y: 1.35, w: 4.7, h: 4.7 }, line: { color: theme.accent, width: 1.5 } });
    layers.push({
      t: "text",
      box: { x: 7.6, y: 1.35, w: 4.7, h: 4.7 },
      text: two(index + 1),
      color: theme.accentInk,
      size: 110,
      bold: true,
      align: "center",
      valign: "middle",
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 7.1, w: 5.68 }, false);
  return { bg: theme.surface, layers };
}

/** Bo'lim — chapda ulkan raqam, o'ngda bo'lim nomi. */
function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme);
  layers.push({
    t: "text",
    box: { x: 0.85, y: 1.9, w: 5.0, h: 3.6 },
    text: two(index + 1),
    color: theme.titleText,
    size: 150,
    bold: true,
    align: "center",
    valign: "middle",
  });
  layers.push({ t: "rect", box: { x: 2.55, y: 5.55, w: 1.6, h: 0.07 }, fill: { color: theme.accent } });
  const x = 7.1;
  const tw = 5.68;
  const titleBox: Box = { x, y: 2.15, w: tw, h: 2.1 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 32, 20),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x, y: 4.42, w: 1.3, h: 0.07 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.75, w: tw, h: 1.7 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 17, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.surface, layers };
}

/** Bandlar — sarlavha to'q chapda, ro'yxat yorug' o'ngda. */
function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, fitLines, bulletGap, photo, pushFooter, BULLET_GAP_MIN } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme);
  const x = 0.85;
  const tw = 5.0;
  const headBox: Box = { x, y: 1.0, w: tw, h: 1.9 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, headBox, 28, 17),
    bold: true,
    valign: "bottom",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x, y: 3.08, w: 1.4, h: 0.07 }, fill: { color: theme.accent } });
  // Chap yarmning pasti: rasm tasmasi yoki dekorativ zinapoya.
  const slot = splitVisual.photo!.bullets as Box;
  if (s.image?.url) {
    photo(layers, s.image.url, slot, 0);
  } else {
    [4.4, 3.2, 2.0].forEach((w, i) => {
      layers.push({
        t: "rect",
        box: { x, y: 3.95 + i * 0.5, w, h: 0.11 },
        fill: { color: i === 1 ? theme.accent2 : theme.accent },
      });
    });
  }
  const items = (s.bullets ?? []).slice(0, ctx.bodyType.maxBullets);
  if (items.length) {
    const box: Box = { x: 7.1, y: 1.0, w: 5.68, h: 5.75 };
    const size = fitLines(items, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, BULLET_GAP_MIN);
    layers.push({
      t: "text",
      box,
      lines: items,
      bullets: true,
      color: theme.text,
      size,
      paraSpace: bulletGap(items, box, size),
      valign: "middle",
      srcLines: items.map((_, i) => ({ f: "bullets", i })),
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 7.1, w: 5.68 }, false);
  return { bg: theme.surface, layers };
}

/** Reja — bandlar chok bo'ylab navbatma-navbat chapga va o'ngga. */
function planAgenda(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme);
  const headBox: Box = { x: 0.85, y: 0.55, w: 5.0, h: 0.95 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, headBox, 26, 17),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: 0.85, y: 1.6, w: 1.2, h: 0.07 }, fill: { color: theme.accent } });

  const items = (s.bullets ?? []).slice(0, ctx.bodyType.agendaMax);
  const n = Math.max(1, items.length);
  const rowH = Math.min(1.05, 4.7 / n);
  const y0 = 2.05 + Math.max(0, (4.7 - n * rowH) / 2);
  const chip = 0.55;
  items.forEach((line, i) => {
    const y = y0 + i * rowH;
    const cy = y + (rowH - chip) / 2;
    const left = i % 2 === 0;
    const chipX = left ? SEAM - 0.78 : SEAM + 0.23;
    layers.push({
      t: "rect",
      box: { x: chipX, y: cy, w: chip, h: chip },
      fill: { color: left ? theme.surface : theme.titleBg },
      radius: 0.08,
    });
    layers.push({
      t: "text",
      box: { x: chipX, y: cy, w: chip, h: chip },
      text: two(i + 1),
      color: left ? theme.text : theme.titleText,
      size: 14,
      bold: true,
      align: "center",
      valign: "middle",
    });
    const box: Box = left
      ? { x: 0.85, y, w: SEAM - 0.78 - 0.85 - 0.22, h: rowH }
      : { x: SEAM + 0.98, y, w: 13.333 - 0.85 - (SEAM + 0.98), h: rowH };
    layers.push({
      t: "text",
      box,
      text: line,
      color: left ? theme.titleText : theme.text,
      size: fitSize(line, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt - 1),
      align: left ? "right" : "left",
      valign: "middle",
      src: { f: "bullets", i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: 7.1, w: 5.68 }, false);
  return { bg: theme.surface, layers };
}

/** Iqtibos — serif matn to'q chapda, muallif va dumaloq rasm o'ngda. */
function planQuote(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { fitSize, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme);
  const x = 0.85;
  const tw = 5.0;
  layers.push({
    t: "text",
    box: { x, y: 0.95, w: 1.6, h: 1.2 },
    text: "“",
    color: theme.titleMuted,
    size: 78,
    bold: true,
    font: "Georgia",
    valign: "middle",
  });
  const quote = s.quote || s.title;
  const qBox: Box = { x, y: 2.15, w: tw, h: 3.6 };
  layers.push({
    t: "text",
    box: qBox,
    text: quote,
    color: theme.titleText,
    size: fitSize(quote, qBox, 27, 14),
    italic: true,
    font: "Georgia",
    valign: "middle",
    src: { f: "quote" },
  });
  const slot = splitVisual.photo!.quote as Box;
  if (s.image?.url) {
    layers.push({
      t: "rect",
      box: { x: slot.x - 0.14, y: slot.y - 0.14, w: slot.w + 0.28, h: slot.h + 0.28 },
      fill: { color: theme.accent },
      radius: (slot.w + 0.28) / 2,
    });
    layers.push({ t: "image", box: { ...slot }, url: s.image.url, shape: "circle" });
  } else {
    layers.push({ t: "rect", box: { ...slot }, fill: { color: theme.surface }, radius: slot.w / 2 });
    layers.push({
      t: "rect",
      box: { x: slot.x - 0.14, y: slot.y - 0.14, w: slot.w + 0.28, h: slot.h + 0.28 },
      line: { color: theme.accent, width: 1.5 },
      radius: (slot.w + 0.28) / 2,
    });
    layers.push({
      t: "text",
      box: { ...slot },
      text: "“",
      color: theme.accentInk,
      size: 66,
      bold: true,
      font: "Georgia",
      align: "center",
      valign: "middle",
    });
  }
  layers.push({ t: "rect", box: { x: 9.44, y: 4.98, w: 1.0, h: 0.05 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 7.1, y: 5.2, w: 5.68, h: 0.7 },
    text: s.quoteBy || "",
    color: theme.text,
    size: 17,
    bold: true,
    align: "center",
    valign: "middle",
    src: { f: "quoteBy" },
  });
  pushFooter(layers, s, theme, index, total, { x: 7.1, w: 5.68 }, false);
  return { bg: theme.surface, layers };
}

/** Yakun — oyna aksi: yorug' yarm chapda, to'q rasm o'ngda. */
function planClosing(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const { W, H, fitSize, photo, pushFooter } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  pushHalves(layers, theme, true);
  const slot = splitVisual.photo!.closing as Box;
  if (s.image?.url) {
    photo(layers, s.image.url, slot, 0.32);
  } else {
    const cx = SEAM + (W - SEAM) / 2;
    layers.push({ t: "rect", box: { x: cx - 1.8, y: H / 2 - 1.8, w: 3.6, h: 3.6 }, fill: { color: theme.accent, alpha: 0.22 }, radius: 1.8 });
    layers.push({ t: "rect", box: { x: cx - 1.0, y: H / 2 - 1.0, w: 2.0, h: 2.0 }, fill: { color: theme.accent2, alpha: 0.4 }, radius: 1.0 });
  }
  const x = 0.85;
  const tw = 5.0;
  const titleBox: Box = { x, y: 1.95, w: tw, h: 2.1 };
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
  layers.push({ t: "rect", box: { x, y: 4.22, w: 1.4, h: 0.07 }, fill: { color: theme.accent } });
  if (s.subtitle) {
    const subBox: Box = { x, y: 4.55, w: tw, h: 1.8 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.muted,
      size: fitSize(s.subtitle, subBox, 18, 12),
      src: { f: "subtitle" },
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: 5.0 }, false);
  return { bg: theme.surface, layers };
}

/**
 * Qiyos (`compare`) va ikki ustun (`twoCol`) — dizaynning IMZO maketi.
 *
 * Yuqorida sarlavha lentasi, ostida ikki yarm: chap to'q (`leftTitle`),
 * o'ng yorug' (`rightTitle`), chokda esa dumaloq «VS» nishoni.
 * Rasm tasmasi (`stripCut`) bo'lsa butun kompozitsiya shuncha torayadi.
 */
function planCompare(s: SlideModel, theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { H, fitSize, fitLines, stripCut, pushFooter, BULLET_GAP_MIN } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  const cut = stripCut(s);
  const zoneW = 13.333 - cut;
  const seam = zoneW * 0.492;
  const top = 1.5;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 13.333, h: H }, fill: { color: theme.surface } });
  const titleBox: Box = { x: 0.85, y: 0.36, w: zoneW - 1.7 - ctx.reserve, h: 0.82 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 26, 17),
    bold: true,
    valign: "middle",
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: 0.85, y: 1.24, w: 1.5, h: 0.06 }, fill: { color: theme.accent } });

  layers.push({ t: "rect", box: { x: seam, y: top, w: zoneW - seam, h: H - top }, fill: { color: theme.surface } });
  layers.push({ t: "rect", box: { x: 0, y: top, w: seam, h: H - top }, fill: { color: theme.titleBg } });
  layers.push({ t: "rect", box: { x: 0, y: top, w: seam, h: H - top }, fill: { color: INK, alpha: PANEL_DIM } });
  layers.push({ t: "rect", box: { x: seam - 0.03, y: top, w: 0.06, h: H - top }, fill: { color: theme.accent } });

  const colW = seam - 1.7;
  const cols: { title?: string; items: string[]; dark: boolean; x: number; tk: "leftTitle" | "rightTitle"; ik: "left" | "right" }[] = [
    { title: s.leftTitle, items: s.left ?? [], dark: true, x: 0.85, tk: "leftTitle", ik: "left" },
    { title: s.rightTitle, items: s.right ?? [], dark: false, x: seam + 0.85, tk: "rightTitle", ik: "right" },
  ];
  for (const col of cols) {
    const w = col.dark ? colW : zoneW - seam - 1.7;
    if (col.title) {
      layers.push({
        t: "text",
        box: { x: col.x, y: 1.9, w, h: 0.62 },
        text: col.title,
        color: col.dark ? theme.titleText : theme.text,
        size: 19,
        bold: true,
        uppercase: true,
        tracking: 1.4,
        valign: "middle",
        src: { f: col.tk },
      });
      layers.push({ t: "rect", box: { x: col.x, y: 2.6, w: 0.9, h: 0.06 }, fill: { color: theme.accent } });
    }
    const items = col.items.slice(0, ctx.bodyType.maxBullets);
    if (!items.length) continue;
    const box: Box = { x: col.x, y: 2.9, w, h: 3.9 };
    const size = fitLines(items, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, BULLET_GAP_MIN);
    layers.push({
      t: "text",
      box,
      lines: items,
      bullets: true,
      color: col.dark ? theme.titleText : theme.text,
      size,
      paraSpace: BULLET_GAP_MIN,
      valign: "top",
      srcLines: items.map((_, i) => ({ f: col.ik, i })),
    });
  }
  // «VS» nishoni chokda: aksent halqa + `surface` disk (aksent — faqat to'ldirish).
  const badge = 1.15;
  const by = 4.35;
  layers.push({ t: "rect", box: { x: seam - badge / 2, y: by, w: badge, h: badge }, fill: { color: theme.accent }, radius: badge / 2 });
  layers.push({ t: "rect", box: { x: seam - 0.475, y: by + 0.1, w: 0.95, h: 0.95 }, fill: { color: theme.surface }, radius: 0.475 });
  layers.push({
    t: "text",
    box: { x: seam - 0.475, y: by + 0.1, w: 0.95, h: 0.95 },
    text: "VS",
    color: theme.text,
    size: 19,
    bold: true,
    align: "center",
    valign: "middle",
  });
  pushFooter(layers, s, theme, index, total, { x: seam + 0.85, w: zoneW - seam - 1.7 }, false);
  return { bg: theme.surface, layers };
}

export const splitVisual: VisualSpec = {
  id: "split",
  base: "hero-split",
  photo: {
    title: { x: 7.1, y: 0.9, w: 5.7, h: 5.7 },
    section: null,
    bullets: { x: 0.85, y: 3.85, w: 5.0, h: 2.9 },
    agenda: null,
    quote: { x: 8.64, y: 1.75, w: 2.6, h: 2.6 },
    closing: { x: SEAM, y: 0, w: 13.333 - SEAM, h: 7.5 },
  },
  plan: {
    title: planTitle,
    section: planSection,
    bullets: planBullets,
    agenda: planAgenda,
    quote: planQuote,
    closing: planClosing,
    compare: planCompare,
    twoCol: planCompare,
  },
};
