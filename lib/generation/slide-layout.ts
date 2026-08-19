import type { SlideVisual } from "./slide-templates";
import type { SlideModel, SlideTheme } from "./slide-types";

/** Widescreen 16:9 in inches — same coordinate space as PPTX and the on-site viewer. */
export const SLIDE_IN = { w: 13.333, h: 7.5 } as const;
export const PX_PER_IN = 96;
export const SLIDE_FONT = 'Calibri, "Segoe UI", system-ui, sans-serif';

export type Box = { x: number; y: number; w: number; h: number };
export type Fill = { color: string; alpha?: number };

export type SlideLayer =
  | { t: "rect"; box: Box; fill?: Fill; line?: { color: string; width: number }; radius?: number }
  | { t: "image"; box: Box; url: string }
  | {
      t: "text";
      box: Box;
      text?: string;
      lines?: string[];
      color: string;
      size: number;
      bold?: boolean;
      italic?: boolean;
      align?: "left" | "center" | "right";
      valign?: "top" | "middle" | "bottom";
      bullets?: boolean;
      paraSpace?: number;
      tracking?: number;
      uppercase?: boolean;
      font?: string;
    };

export type SlidePlan = { bg: string; layers: SlideLayer[] };

const W = SLIDE_IN.w;
const H = SLIDE_IN.h;
const M = 0.5;
const FOOT_Y = 7.14;
const FOOT_H = 0.24;
const RIGHT_IMG_X = 8.1;
const LEFT_IMG_W = 5.15;
const TEXT_GAP = 0.28;

function usesPhoto(layout: string) {
  return layout === "title" || layout === "section" || layout === "bullets" || layout === "agenda" || layout === "quote" || layout === "closing";
}

/** Inch box where a photo sits for this layout — used before the image exists. */
export function photoSlot(layout: string, visual: SlideVisual = "classic"): Box | null {
  if (!usesPhoto(layout)) return null;
  if (layout === "quote" || layout === "closing") return { x: 0, y: 0, w: W, h: H };
  if (layout === "title") {
    if (visual === "magazine") return { x: 0, y: 0, w: W, h: H };
    if (visual === "hero-split") return { x: 0, y: 0, w: LEFT_IMG_W, h: H };
    return { x: RIGHT_IMG_X, y: 0, w: W - RIGHT_IMG_X, h: H };
  }
  return { x: RIGHT_IMG_X, y: 0, w: W - RIGHT_IMG_X, h: H };
}

/** Flux pixel size matching a slide slot. Long side 1024, multiples of 8. */
export function slotPixels(box: Box, longSide = 1024): { width: number; height: number } {
  const ar = box.w / Math.max(0.01, box.h);
  const snap = (n: number) => Math.max(384, Math.min(1440, Math.round(n / 8) * 8));
  if (ar >= 1) return { width: snap(longSide), height: snap(longSide / ar) };
  return { width: snap(longSide * ar), height: snap(longSide) };
}

function hasPhoto(s: SlideModel) {
  return Boolean(s.image?.url) && usesPhoto(s.layout);
}

export function cssColor(hex: string, alpha?: number) {
  if (alpha == null || alpha >= 0.995) return hex;
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function ptToPx(pt: number) {
  return (pt * PX_PER_IN) / 72;
}

export function boxStyle(box: Box): { left: number; top: number; width: number; height: number } {
  return {
    left: box.x * PX_PER_IN,
    top: box.y * PX_PER_IN,
    width: box.w * PX_PER_IN,
    height: box.h * PX_PER_IN,
  };
}

export function slideNotes(s: SlideModel) {
  // Model yozgan notiq matni birinchi navbatda: u slaydni takrorlamaydi.
  // Bo'lmasa — slayd mazmunidan tuzilgan zaxira eslatma.
  const written = (s.notes || "").trim();
  if (written) return written;
  if (s.layout === "quote") return [s.quote, s.quoteBy ? `— ${s.quoteBy}` : ""].filter(Boolean).join("\n");
  if (s.steps?.length) return s.steps.map((st) => `${st.n}. ${st.title}: ${st.text}`).join("\n");
  if (s.stats?.length) return s.stats.map((st) => `${st.value} — ${st.label}`).join("\n");
  if (s.left?.length || s.right?.length) {
    return [
      s.leftTitle ? `${s.leftTitle}:` : "",
      ...(s.left ?? []),
      "",
      s.rightTitle ? `${s.rightTitle}:` : "",
      ...(s.right ?? []),
    ]
      .filter((x, i, a) => x || a[i - 1])
      .join("\n");
  }
  if (s.bullets?.length) return s.bullets.map((b, i) => `${i + 1}. ${b}`).join("\n");
  return [s.subtitle, s.footer].filter(Boolean).join("\n");
}

function pushChrome(
  layers: SlideLayer[],
  theme: SlideTheme,
  mode: "none" | "left" | "full",
) {
  if (mode === "none") return;
  const accent = theme.accent;
  if (theme.chrome === "bar-top") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: mode === "left" ? RIGHT_IMG_X : W, h: 0.12 }, fill: { color: accent } });
    return;
  }
  if (theme.chrome === "frame" && mode === "full") {
    layers.push({
      t: "rect",
      box: { x: 0.2, y: 0.2, w: W - 0.4, h: H - 0.4 },
      line: { color: accent, width: 1.25 },
    });
    return;
  }
  if (theme.chrome === "block") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: 0.28, h: H }, fill: { color: accent } });
    return;
  }
  if (theme.chrome === "split") {
    // Ilgari `split` alohida ishlanmagan va pastdagi `bar-left` ga tushib
    // ketardi — ya'ni temaning `chrome` maydoni yolg'on va'da edi.
    layers.push({ t: "rect", box: { x: 0, y: 0, w: mode === "left" ? RIGHT_IMG_X : W, h: 0.09 }, fill: { color: accent } });
    layers.push({ t: "rect", box: { x: 0, y: 0, w: 0.09, h: H }, fill: { color: theme.accent2 } });
    return;
  }
  layers.push({ t: "rect", box: { x: 0, y: 0, w: 0.16, h: H }, fill: { color: accent } });
}

function pushFooter(
  layers: SlideLayer[],
  s: SlideModel,
  theme: SlideTheme,
  index: number,
  total: number,
  zone: { x: number; w: number },
  light: boolean,
) {
  const color = light ? theme.titleMuted : theme.muted;
  const pageW = 1.05;
  layers.push({
    t: "text",
    box: { x: zone.x, y: FOOT_Y, w: Math.max(1.4, zone.w - pageW - 0.12), h: FOOT_H },
    text: s.footer || "",
    color,
    size: 11,
    valign: "middle",
  });
  layers.push({
    t: "text",
    box: { x: zone.x + zone.w - pageW, y: FOOT_Y, w: pageW, h: FOOT_H },
    text: `${index + 1} / ${total}`,
    color,
    size: 11,
    align: "right",
    valign: "middle",
  });
}

/**
 * Matnni qutiga sig'diradigan eng katta shrift.
 *
 * Ilgari bu ish `pptxgenjs` ning `shrinkText` bayrog'iga topshirilgan edi.
 * Ikki muammo bor edi: (1) u ba'zan matnni 11 pt gacha tushirib yuborardi —
 * proyektorda o'qib bo'lmasdi; (2) sayt ko'ruvchisi kichraytirmasdi, ya'ni
 * preview va yuklab olingan PPTX bir xil ko'rinmasdi. Endi o'lcham SHU
 * YERDA hisoblanadi, demak ikkala chiqish ham bir xil bo'ladi.
 */
function fitSize(text: string, box: Box, base: number, min: number): number {
  const chars = text.trim().length;
  if (!chars) return base;
  for (let size = base; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor((box.w * 72) / (size * 0.5)));
    const rows = Math.ceil(chars / perLine);
    if (rows * size * 1.3 <= box.h * 72) return size;
  }
  return min;
}

/** Ko'p qatorli ro'yxat uchun: har band alohida qatordan boshlanadi. */
function fitLines(lines: string[], box: Box, base: number, min: number, paraSpacePt = 0): number {
  const items = lines.filter(Boolean);
  if (!items.length) return base;
  for (let size = base; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor(((box.w - 0.28) * 72) / (size * 0.5)));
    let rows = 0;
    for (const l of items) rows += Math.max(1, Math.ceil(l.length / perLine));
    if (rows * size * 1.3 + items.length * paraSpacePt <= box.h * 72) return size;
  }
  return min;
}

function photo(layers: SlideLayer[], url: string | undefined, box: Box, dim = 0) {
  if (!url) return;
  layers.push({ t: "image", box, url });
  if (dim > 0) layers.push({ t: "rect", box, fill: { color: "#000000", alpha: dim } });
}

function planTitle(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  const img = s.image?.url;
  const layers: SlideLayer[] = [];
  // Til-bog'liq matn modelda to'ldiriladi (`slide-write.ts`). Layout
  // hech qachon o'zidan matn o'ylab topmaydi — aks holda ruscha yoki
  // inglizcha deckda o'zbekcha so'z paydo bo'lardi.
  const kicker = s.kicker || "";

  if (visual === "magazine" && img) {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    photo(layers, img, photoSlot("title", "magazine")!, 0.42);
    layers.push({ t: "rect", box: { x: 0, y: 3.85, w: W, h: 3.65 }, fill: { color: "#000000", alpha: 0.55 } });
    layers.push({
      t: "text",
      box: { x: 0.7, y: 4.1, w: 11.8, h: 0.38 },
      text: kicker,
      color: theme.titleMuted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 2.2,
    });
    const magTitleBox: Box = { x: 0.7, y: 4.5, w: 11.8, h: s.subtitle ? 1.35 : 1.7 };
    layers.push({
      t: "text",
      box: magTitleBox,
      text: s.title,
      color: theme.titleText,
      size: fitSize(s.title, magTitleBox, 34, 22),
      bold: true,
    });
    // Ilgari magazine tarmog'ida subtitle umuman chizilmasdi — model
    // yozgan matn jimgina yo'qolardi.
    if (s.subtitle) {
      layers.push({
        t: "text",
        box: { x: 0.7, y: 5.95, w: 11.8, h: 0.72 },
        text: s.subtitle,
        color: theme.titleMuted,
        size: 16,
      });
    }
    pushFooter(layers, s, theme, index, total, { x: 0.7, w: 12 }, true);
    return { bg: theme.titleBg, layers };
  }

  if (visual === "hero-split") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    layers.push({ t: "rect", box: { x: 0, y: 0, w: LEFT_IMG_W, h: H }, fill: { color: theme.titleBg } });
    photo(layers, img, photoSlot("title", "hero-split")!, img ? 0.18 : 0);
    const x = RIGHT_COL_X();
    const tw = RIGHT_COL_W();
    layers.push({
      t: "text",
      box: { x, y: 2.05, w: tw, h: 0.38 },
      text: kicker,
      color: theme.muted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 1.6,
    });
    layers.push({
      t: "text",
      box: { x, y: 2.5, w: tw, h: 1.9 },
      text: s.title,
      color: theme.text,
      size: 32,
      bold: true,
    });
    if (s.subtitle) {
      layers.push({
        t: "text",
        box: { x, y: 4.5, w: tw, h: 1.15 },
        text: s.subtitle,
        color: theme.muted,
        size: 16,
      });
    }
    pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
    return { bg: theme.bg, layers };
  }

  if (img) {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    pushChrome(layers, theme, "left");
    photo(layers, img, photoSlot("title", "classic")!, 0);
    const x = M + 0.18;
    const tw = LEFT_COL_W();
    layers.push({
      t: "text",
      box: { x, y: 2.05, w: tw, h: 0.36 },
      text: kicker,
      color: theme.titleMuted,
      size: 13,
      bold: true,
      uppercase: true,
      tracking: 1.8,
    });
    layers.push({
      t: "text",
      box: { x, y: 2.5, w: tw, h: 1.95 },
      text: s.title,
      color: theme.titleText,
      size: 32,
      bold: true,
    });
    if (s.subtitle) {
      layers.push({
        t: "text",
        box: { x, y: 4.55, w: tw, h: 1.15 },
        text: s.subtitle,
        color: theme.titleMuted,
        size: 16,
      });
    }
    pushFooter(layers, s, theme, index, total, { x, w: tw }, true);
    return { bg: theme.titleBg, layers };
  }

  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  pushChrome(layers, theme, "full");
  layers.push({ t: "rect", box: { x: M + 0.2, y: 2.15, w: 1.15, h: 0.08 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: M + 0.2, y: 2.4, w: 11.8, h: 0.36 },
    text: kicker,
    color: theme.titleMuted,
    size: 13,
    bold: true,
    uppercase: true,
    tracking: 1.8,
  });
  layers.push({
    t: "text",
    box: { x: M + 0.2, y: 2.85, w: 11.8, h: 2.1 },
    text: s.title,
    color: theme.titleText,
    size: 36,
    bold: true,
  });
  if (s.subtitle) {
    layers.push({
      t: "text",
      box: { x: M + 0.2, y: 5.05, w: 11.4, h: 0.9 },
      text: s.subtitle,
      color: theme.titleMuted,
      size: 16,
    });
  }
  pushFooter(layers, s, theme, index, total, { x: M + 0.2, w: 12 }, true);
  return { bg: theme.titleBg, layers };
}

function LEFT_COL_W() {
  return RIGHT_IMG_X - M - TEXT_GAP;
}
function RIGHT_COL_X() {
  return LEFT_IMG_W + 0.38;
}
function RIGHT_COL_W() {
  return W - RIGHT_COL_X() - 0.42;
}

function planSection(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const img = s.image?.url;
  const layers: SlideLayer[] = [];
  if (img) {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    pushChrome(layers, theme, "left");
    photo(layers, img, photoSlot("section")!, 0);
    const x = M + 0.18;
    const tw = LEFT_COL_W();
    layers.push({
      t: "text",
      box: { x, y: 2.0, w: tw, h: 1.2 },
      text: s.title,
      color: theme.text,
      size: 26,
      bold: true,
    });
    layers.push({ t: "rect", box: { x, y: 3.32, w: 1.35, h: 0.07 }, fill: { color: theme.accent } });
    if (s.subtitle) {
      layers.push({
        t: "text",
        box: { x, y: 3.52, w: tw, h: 1.45 },
        text: s.subtitle,
        color: theme.muted,
        size: 16,
      });
    }
    pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
    return { bg: theme.bg, layers };
  }
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  layers.push({ t: "rect", box: { x: 0.72, y: 3.15, w: 1.4, h: 0.08 }, fill: { color: theme.accent } });
  layers.push({
    t: "text",
    box: { x: 0.72, y: 2.2, w: 11.6, h: 0.9 },
    text: s.title,
    color: theme.text,
    size: 32,
    bold: true,
  });
  if (s.subtitle) {
    layers.push({
      t: "text",
      box: { x: 0.72, y: 3.4, w: 11.6, h: 1.4 },
      text: s.subtitle,
      color: theme.muted,
      size: 18,
    });
  }
  pushFooter(layers, s, theme, index, total, { x: 0.72, w: 12 }, false);
  return { bg: theme.bg, layers };
}

function planOverlay(s: SlideModel, theme: SlideTheme, index: number, total: number, kind: "quote" | "closing"): SlidePlan {
  const img = s.image?.url;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  if (img) {
    // Qorong'u temada fon allaqachon to'q — 0.52 qoplama fotoni butunlay
    // yo'q qilardi. Yorug' temada esa oq matn uchun qoplama kerak.
    photo(layers, img, photoSlot(kind)!, theme.darkContent ? 0.34 : 0.52);
  } else {
    pushChrome(layers, theme, "full");
  }
  const panel: Box = kind === "quote" ? { x: 1.15, y: 1.55, w: 11.05, h: 4.35 } : { x: 1.7, y: 2.05, w: 9.95, h: 3.35 };
  layers.push({ t: "rect", box: panel, fill: { color: theme.titleBg, alpha: img ? 0.78 : 0 }, radius: 0.1 });
  if (kind === "quote") {
    layers.push({
      t: "text",
      box: { x: panel.x + 0.45, y: panel.y + 0.2, w: panel.w - 0.9, h: 0.7 },
      text: "“",
      color: theme.accent,
      size: 48,
      bold: true,
    });
    const quoteBox: Box = { x: panel.x + 0.45, y: panel.y + 0.95, w: panel.w - 0.9, h: 2.35 };
    layers.push({
      t: "text",
      box: quoteBox,
      text: s.quote || s.title,
      color: theme.titleText,
      size: fitSize(s.quote || s.title, quoteBox, 24, 16),
      italic: true,
    });
    if (s.quoteBy) {
      layers.push({
        t: "text",
        box: { x: panel.x + 0.45, y: panel.y + 3.4, w: panel.w - 0.9, h: 0.4 },
        text: `— ${s.quoteBy}`,
        color: theme.titleMuted,
        size: 14,
      });
    }
  } else {
    layers.push({
      t: "rect",
      box: { x: panel.x + (panel.w - 1.15) / 2, y: panel.y + 0.45, w: 1.15, h: 0.08 },
      fill: { color: theme.accent },
    });
    layers.push({
      t: "text",
      box: { x: panel.x + 0.4, y: panel.y + 0.7, w: panel.w - 0.8, h: 1.25 },
      text: s.title,
      color: theme.titleText,
      size: 32,
      bold: true,
      align: "center",
    });
    layers.push({
      t: "text",
      box: { x: panel.x + 0.5, y: panel.y + 2.05, w: panel.w - 1, h: 0.85 },
      text: s.subtitle || "",
      color: theme.titleMuted,
      size: 16,
      align: "center",
    });
  }
  layers.push({ t: "rect", box: { x: 0, y: 6.92, w: W, h: 0.58 }, fill: { color: "#000000", alpha: 0.4 } });
  pushFooter(layers, s, theme, index, total, { x: 0.7, w: 12 }, true);
  return { bg: theme.titleBg, layers };
}

function planHeading(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, textW: number, x: number) {
  const headBox: Box = { x, y: 0.3, w: textW, h: 0.88 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, headBox, 22, 16),
    bold: true,
  });
  layers.push({ t: "rect", box: { x, y: 1.22, w: 1.1, h: 0.07 }, fill: { color: theme.accent } });
}

function planBullets(s: SlideModel, theme: SlideTheme, index: number, total: number, agenda: boolean): SlidePlan {
  const img = s.image?.url;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  const split = Boolean(img);
  pushChrome(layers, theme, split ? "left" : "full");
  if (split) photo(layers, img, photoSlot(agenda ? "agenda" : "bullets")!, 0);
  const x = M + 0.18;
  const tw = split ? LEFT_COL_W() : 12.1;
  planHeading(layers, s, theme, tw, x);
  const items = (s.bullets ?? []).slice(0, agenda ? 5 : 4);
  if (agenda) {
    const rowH = items.length > 4 ? 0.7 : 0.76;
    items.forEach((line, i) => {
      const y = 1.5 + i * rowH;
      layers.push({
        t: "text",
        box: { x, y, w: 0.7, h: 0.7 },
        text: String(i + 1).padStart(2, "0"),
        color: theme.accentInk,
        size: 18,
        bold: true,
        valign: "middle",
      });
      const lineBox: Box = { x: x + 0.78, y, w: tw - 0.85, h: rowH - 0.06 };
      layers.push({
        t: "text",
        box: lineBox,
        text: line,
        color: theme.text,
        size: fitSize(line, lineBox, 18, 14),
        valign: "middle",
      });
    });
  } else {
    const bulletBox: Box = { x, y: 1.5, w: tw, h: 5.35 };
    layers.push({
      t: "text",
      box: bulletBox,
      lines: items,
      bullets: true,
      color: theme.text,
      // Slide Law: tana matni 18 pt dan boshlanadi va 15 pt dan pastga
      // tushmaydi. Sig'masa — muammo kontentda, shriftda emas.
      size: fitLines(items, bulletBox, 18, 15, 10),
      paraSpace: 10,
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

function planTwoCol(s: SlideModel, theme: SlideTheme, index: number, total: number, compare: boolean): SlidePlan {
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  planHeading(layers, s, theme, 12.2, M + 0.18);
  const colW = 5.85;
  const gap = 0.28;
  const y = 1.35;
  const h = 5.5;
  const cols = [
    { x: M + 0.12, head: s.leftTitle, lines: s.left, dark: compare },
    { x: M + 0.12 + colW + gap, head: s.rightTitle, lines: s.right, dark: false },
  ];
  for (const c of cols) {
    const fill = c.dark ? theme.titleBg : theme.surface;
    const ink = c.dark ? theme.titleText : theme.text;
    const mute = c.dark ? theme.titleMuted : theme.accentInk;
    layers.push({ t: "rect", box: { x: c.x, y, w: colW, h }, fill: { color: fill }, radius: 0.08 });
    layers.push({
      t: "text",
      box: { x: c.x + 0.28, y: y + 0.18, w: colW - 0.56, h: 0.42 },
      text: c.head || "",
      color: mute,
      size: 14,
      bold: true,
    });
    const colLines = (c.lines ?? []).slice(0, 5);
    const colBox: Box = { x: c.x + 0.28, y: y + 0.68, w: colW - 0.56, h: h - 0.9 };
    layers.push({
      t: "text",
      box: colBox,
      lines: colLines,
      bullets: true,
      color: ink,
      size: fitLines(colLines, colBox, 16, 13, 8),
      paraSpace: 8,
    });
  }
  pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, false);
  return { bg: theme.bg, layers };
}

/**
 * Stats qiymatidan sonni ajratadi.
 *
 * «95%» → 95, «2,3 mlrd» → 2300000000, «1 000 000» → 1000000.
 * Kimyoviy formula yoki matn bo'lsa `null` — bunday qiymat diagrammaga
 * tushmaydi va karta ko'rinishida qoladi.
 */
function parseStatNumber(value: string): number | null {
  const t = value.replace(/\u00a0/g, " ").trim().toLowerCase();
  // Formula yoki kod: harf+raqam aralashmasi (C6H12O6) — son emas.
  if (/^[a-z]+\d/i.test(t)) return null;
  const m = t.match(/-?\d[\d\s.,]*/);
  if (!m) return null;
  const raw = m[0].replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (/mlrd|milliard|billion/.test(t)) return n * 1e9;
  if (/mln|million/.test(t)) return n * 1e6;
  if (/ming|thousand/.test(t)) return n * 1e3;
  return n;
}

/**
 * Raqamlar diagramma bo'lishi kerak, katta matn emas.
 *
 * Ilgari `stats` har doim 4 ta «katta raqam kartasi» edi: himoyada
 * «natijalar» deb 4 ta matn kvadrati ko'rsatish ishonchsiz ko'rinardi va
 * qiymatlarni bir-biri bilan taqqoslab bo'lmasdi. Endi kamida 3 ta o'qib
 * bo'ladigan son bo'lsa, gorizontal ustunli diagramma chiziladi.
 *
 * Diagramma `rect` qatlamlaridan quriladi — `pptx.addChart` emas. Sabab:
 * `planSlide` ham PPTX, ham saytdagi ko'ruvchi uchun yagona manba; native
 * chart qo'shilsa preview eksportdan farq qila boshlardi.
 */
function planStatChart(
  s: SlideModel,
  theme: SlideTheme,
  items: { value: string; label: string; n: number }[],
  layers: SlideLayer[],
  ink: string,
): void {
  const max = Math.max(...items.map((x) => Math.abs(x.n)), 1);
  const labelW = 3.6;
  const valueW = 1.5;
  const x0 = M + 0.18;
  const barX = x0 + labelW + 0.2;
  const barMaxW = 12.25 - labelW - valueW - 0.6;
  const top = 1.75;
  const rowH = Math.min(1.15, (6.7 - top) / items.length);

  items.forEach((it, i) => {
    const y = top + i * rowH;
    const barH = Math.min(0.52, rowH - 0.3);
    const cy = y + (rowH - barH) / 2;
    const labBox: Box = { x: x0, y, w: labelW, h: rowH - 0.1 };
    layers.push({
      t: "text",
      box: labBox,
      text: it.label,
      color: ink,
      size: fitSize(it.label, labBox, 15, 11),
      valign: "middle",
    });
    // Fon yo'lakchasi — ustunlar qanchalik to'lganini ko'rsatadi.
    layers.push({
      t: "rect",
      box: { x: barX, y: cy, w: barMaxW, h: barH },
      fill: { color: theme.surface },
      radius: 0.04,
    });
    layers.push({
      t: "rect",
      box: { x: barX, y: cy, w: Math.max(0.08, (Math.abs(it.n) / max) * barMaxW), h: barH },
      fill: { color: i === 0 ? theme.accent : theme.accent2 },
      radius: 0.04,
    });
    layers.push({
      t: "text",
      box: { x: barX + barMaxW + 0.14, y: cy - 0.06, w: valueW, h: barH + 0.12 },
      text: it.value,
      color: theme.accentInk,
      size: 16,
      bold: true,
      valign: "middle",
    });
  });
}

function planStats(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  const layers: SlideLayer[] = [];
  const dense = visual === "dense";
  const bg = dense ? theme.titleBg : theme.bg;
  const ink = dense ? theme.titleText : theme.text;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: bg } });
  if (!dense) pushChrome(layers, theme, "full");
  const titleBox: Box = { x: M + 0.18, y: 0.36, w: 12.2, h: 0.72 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: ink,
    size: fitSize(s.title, titleBox, 24, 17),
    bold: true,
  });

  const items = (s.stats ?? []).slice(0, 5);
  const numeric = items
    .map((st) => ({ ...st, n: parseStatNumber(st.value) }))
    .filter((x): x is { value: string; label: string; n: number } => x.n !== null);

  if (numeric.length >= 3 && numeric.length === items.length) {
    planStatChart(s, theme, numeric, layers, ink);
    pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, dense);
    return { bg, layers };
  }

  const cards = items.slice(0, 4);
  const n = Math.max(1, cards.length);
  const gap = 0.22;
  const colW = (12.25 - gap * (n - 1)) / n;
  cards.forEach((st, i) => {
    const x = M + 0.18 + i * (colW + gap);
    layers.push({
      t: "rect",
      box: { x, y: 1.4, w: colW, h: 5.4 },
      fill: { color: dense ? "#ffffff" : theme.surface, alpha: dense ? 0.1 : 1 },
      radius: 0.1,
    });
    const valBox: Box = { x: x + 0.12, y: 2.15, w: colW - 0.24, h: 1.35 };
    layers.push({
      t: "text",
      box: valBox,
      text: st.value,
      // Yorug' kartada aksent matn `accentInk` dan — WCAG AA.
      color: dense ? theme.accent : theme.accentInk,
      size: fitSize(st.value, valBox, 30, 15),
      bold: true,
      align: "center",
      valign: "middle",
    });
    const labBox: Box = { x: x + 0.18, y: 3.65, w: colW - 0.36, h: 2.3 };
    layers.push({
      t: "text",
      box: labBox,
      text: st.label,
      color: dense ? theme.titleMuted : theme.muted,
      size: fitSize(st.label, labBox, 15, 11),
      align: "center",
    });
  });
  pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, dense);
  return { bg, layers };
}

/**
 * Bosqichlar oqimi.
 *
 * Ilgari bu shunchaki bir qatorga tizilgan kartalar edi: 5 ta ustun 2.3
 * dyuymgacha torayardi, matn 12 pt da 6–7 qatorga cho'zilardi va bosqichlar
 * o'rtasida hech qanday bog'lanish belgisi yo'q edi — ya'ni «jarayon»
 * ko'rinmasdi. Endi bir qatorda ko'pi bilan 4 ta karta, undan ortig'i ikki
 * qatorga bo'linadi, kartalar orasiga esa yo'nalish o'qi qo'yiladi.
 */
function planProcess(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  planHeading(layers, s, theme, 12.2, M + 0.18);

  const items = (s.steps ?? []).slice(0, 6);
  const n = Math.max(1, items.length);
  const twoRows = n > 4;
  const perRow = twoRows ? Math.ceil(n / 2) : n;
  const rowGap = 0.3;
  const top = 1.65;
  const totalH = 6.85 - top;
  const rowH = twoRows ? (totalH - rowGap) / 2 : totalH;

  if (visual === "timeline" && !twoRows) {
    layers.push({ t: "rect", box: { x: M + 0.18, y: 1.42, w: 12.2, h: 0.07 }, fill: { color: theme.accent } });
  }

  const gap = 0.42;
  const zoneW = 12.25;
  const colW = (zoneW - gap * (perRow - 1)) / perRow;

  items.forEach((st, i) => {
    const row = twoRows && i >= perRow ? 1 : 0;
    const col = row === 1 ? i - perRow : i;
    const inRow = row === 1 ? n - perRow : perRow;
    const x = M + 0.18 + col * (colW + gap);
    const y = top + row * (rowH + rowGap);

    layers.push({ t: "rect", box: { x, y, w: colW, h: rowH }, fill: { color: theme.surface }, radius: 0.08 });
    layers.push({
      t: "text",
      box: { x, y: y + 0.16, w: colW, h: 0.5 },
      text: st.n || String(i + 1),
      color: theme.accentInk,
      size: 18,
      bold: true,
      align: "center",
    });
    const tBox: Box = { x: x + 0.12, y: y + 0.72, w: colW - 0.24, h: 0.95 };
    layers.push({
      t: "text",
      box: tBox,
      text: st.title,
      color: theme.text,
      size: fitSize(st.title, tBox, 16, 12),
      bold: true,
      align: "center",
    });
    const dBox: Box = { x: x + 0.14, y: y + 1.78, w: colW - 0.28, h: rowH - 1.95 };
    layers.push({
      t: "text",
      box: dBox,
      text: st.text,
      color: theme.muted,
      size: fitSize(st.text, dBox, 14, 11),
      align: "center",
    });

    // Yo'nalish o'qi — qatordagi oxirgi kartadan keyin qo'yilmaydi.
    if (col < inRow - 1) {
      layers.push({
        t: "text",
        box: { x: x + colW, y: y + rowH / 2 - 0.24, w: gap, h: 0.48 },
        text: "→",
        color: theme.accentInk,
        size: 20,
        bold: true,
        align: "center",
        valign: "middle",
      });
    }
  });

  pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, false);
  return { bg: theme.bg, layers };
}

export function planSlide(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  switch (s.layout) {
    case "title":
      return planTitle(s, theme, visual, index, total);
    case "section":
      return planSection(s, theme, index, total);
    case "quote":
      return planOverlay(s, theme, index, total, "quote");
    case "closing":
      return planOverlay(s, theme, index, total, "closing");
    case "agenda":
      return planBullets(s, theme, index, total, true);
    case "twoCol":
      return planTwoCol(s, theme, index, total, false);
    case "compare":
      return planTwoCol(s, theme, index, total, true);
    case "stats":
      return planStats(s, theme, visual, index, total);
    case "process":
      return planProcess(s, theme, visual, index, total);
    default:
      return planBullets(s, theme, index, total, false);
  }
}

export function photoLayouts() {
  return ["title", "section", "bullets", "agenda", "quote", "closing"] as const;
}

/** Text boxes that must not collide with a side photo (used by tests / QA). */
export function sidePhotoBox(s: SlideModel, visual: SlideVisual): Box | null {
  if (!hasPhoto(s)) return null;
  if (s.layout === "quote" || s.layout === "closing") return null;
  if (s.layout === "title" && visual === "magazine") return null;
  return photoSlot(s.layout, visual);
}
