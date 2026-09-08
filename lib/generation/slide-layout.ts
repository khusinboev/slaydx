import { audienceRules, type SlideAudience, type SlideTemplateId, type SlideVisual } from "./slide-templates";
import type { SlideModel, SlideTheme } from "./slide-types";

/** Widescreen 16:9 in inches — same coordinate space as PPTX and the on-site viewer. */
export const SLIDE_IN = { w: 13.333, h: 7.5 } as const;
export const PX_PER_IN = 96;
/**
 * Slayd shrifti — PPTX va sayt ko'ruvchisi uchun BITTA ro'yxat.
 *
 * `Calibri` edi, lekin u faqat Windows'da bor. macOS va Linux uni
 * almashtiradi, almashtiruv esa metrik mos EMAS (bu mashinada
 * `fc-match Calibri` → Noto Sans, ~10% kengroq) — ya'ni bir xil deck
 * uch platformada uch xil joylashadi.
 *
 * `Arial` tanlandi, chunki u uchala platformada ham hal bo'ladi:
 * Windows va macOS'da o'zi bor, Linux'da esa `fc-match Arial` →
 * Liberation Sans, u Arial bilan METRIK MOS (belgilar kengligi bir xil)
 * va o'zbek `ʻ` (U+02BB) belgisini chizadi.
 *
 * Bepul shriftlar (Open Sans, Noto Sans) ko'rib chiqildi va rad etildi:
 * Open Sans'da U+02BB umuman yo'q — «oʻ», «gʻ» buziladi; Noto Sans esa
 * Windows va macOS'da yo'q, ya'ni muammoni Linux'dan Windows'ga
 * ko'chirardi (foydalanuvchilarimizning ko'pchiligi aynan Windows'da).
 */
/** PPTX `fontFace` — bitta nom (CSS ro'yxati emas). */
export const PPTX_FONT = "Arial";

export const SLIDE_FONT = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';

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
  // `magazine` bo'lim slaydi ham to'la ekran — muqova bilan bir tilda
  // gapirsin. Bu slot rasm SO'ROVIGA ham tushadi (`slide-images.ts`),
  // ya'ni fal.ai dan darhol 16:9 kadr so'raladi, keyin qirqilmaydi.
  if (layout === "section" && visual === "magazine") return { x: 0, y: 0, w: W, h: H };
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
  if (s.table?.rows.length) {
    return [s.table.headers.join(" | "), ...s.table.rows.map((r) => r.join(" | "))].join("\n");
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
/**
 * Belgining o'rtacha kengligi (em ulushida).
 *
 * Arial va uning metrik-mos almashtiruvi Liberation Sans ~0.52 em.
 * Bu yerda 0.55 turadi — ataylab biroz kengroq: hisob xatosi matnni
 * qutidan CHIQARIB yuborishdan ko'ra, slaydni bir oz siyrak qoldirgani
 * yaxshi. Calibri davridagi ~10% lik platformalararo tafovut endi yo'q,
 * chunki uchala platformada ham metrikasi bir xil shrift chiziladi.
 */
const CHAR_EM = 0.55;

/**
 * So'z chegarasida ochko'zlik (greedy) bilan qatorlash — CSS matn oqimi
 * (va PowerPoint) shu tartibda ishlaydi.
 *
 * AUDIT-6 B4: ilgari qator soni `ceil(chars / perLine)` bilan, ya'ni
 * matn xuddi so'z oralig'i yo'qdek baholanardi. Real oqimda bitta so'z
 * qatorga sig'may qolsa, qolgan joy BEKORGA ketadi va butun so'z keyingi
 * qatorga o'tadi — bu haqiqiy qator sonini oshiradi. Zich banddagi
 * matnda farq bir necha qatorgacha yetishi mumkin edi, natijada shrift
 * kerakidan kattaroq tanlanib, matn quti ichida SIG'MAY qolardi (viewer
 * va PPTX'da kesilish — ikkalasi ham shu funksiyaga tayanadi).
 *
 * Qatordan uzunroq bitta "so'z" (masalan URL) CSS `overflow-wrap:
 * anywhere` kabi o'zi bir necha qatorga bo'linadi.
 */
function wrapRows(text: string, perLine: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let rows = 1;
  let col = 0;
  for (const word of words) {
    const w = word.length;
    if (w > perLine) {
      if (col > 0) rows += 1;
      rows += Math.ceil(w / perLine) - 1;
      col = w % perLine || perLine;
      continue;
    }
    const next = col === 0 ? w : col + 1 + w;
    if (next <= perLine) {
      col = next;
    } else {
      rows += 1;
      col = w;
    }
  }
  return rows;
}

function fitSize(text: string, box: Box, base: number, min: number): number {
  const t = text.trim();
  if (!t) return base;
  for (let size = base; size > min; size -= 1) {
    const perLine = Math.max(1, Math.floor((box.w * 72) / (size * CHAR_EM)));
    const rows = wrapRows(t, perLine);
    if (rows * size * 1.3 <= box.h * 72) return size;
  }
  return min;
}

/**
 * Ro'yxat berilgan shriftda necha QATOR egallashini hisoblaydi.
 *
 * `fitLines` (shrift tanlash) va `bulletGap` (bo'shliqni taqsimlash)
 * ikkalasi ham shu funksiyaga tayanadi — aks holda biri boshqasidan
 * boshqacha qator soni chiqarib, matn qutidan chiqib ketishi mumkin edi.
 */
function listRows(lines: string[], box: Box, size: number): number {
  const perLine = Math.max(1, Math.floor(((box.w - 0.28) * 72) / (size * CHAR_EM)));
  let rows = 0;
  for (const l of lines) rows += Math.max(1, wrapRows(l, perLine));
  return rows;
}

/** Ko'p qatorli ro'yxat uchun: har band alohida qatordan boshlanadi. */
function fitLines(lines: string[], box: Box, base: number, min: number, paraSpacePt = 0): number {
  const items = lines.filter(Boolean);
  if (!items.length) return base;
  for (let size = base; size > min; size -= 1) {
    if (listRows(items, box, size) * size * 1.3 + items.length * paraSpacePt <= box.h * 72) return size;
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

  /*
   * `magazine` titul RASMSIZ ham o'z maketida qoladi.
   *
   * Ilgari sharti `visual === "magazine" && img` edi va rasm kelmagan
   * dekada muqova pastdagi umumiy tarmoqqa tushardi — «Esse»,
   * «Adabiyot», «Hayotnoma» tanlagan foydalanuvchi `classic` bilan
   * AYNAN bir xil titul olardi. fal.ai bloklangan davrda bu 100%
   * hollarda sodir bo'lgan (AUDIT-8 N-7: `magazine-01.png` bilan
   * `lecture-01.png` ni ajratib bo'lmasdi).
   *
   * `hero-split` bu muammodan xoli edi — u rasm o'rniga rangli blok
   * chizadi. Shu naqsh bu yerga ham ko'chirildi: qoplama faqat rasm
   * bo'lganda kerak, to'q muqova esa har doim.
   */
  if (visual === "magazine") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    photo(layers, img, photoSlot("title", "magazine")!, 0.42);
    layers.push({ t: "rect", box: { x: 0, y: 3.85, w: W, h: 3.65 }, fill: { color: "#000000", alpha: img ? 0.55 : 0 } });
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

/**
 * `magazine` maketidagi bo'lim slaydi: to'la ekran kadr va pastki matn
 * tasmasi.
 *
 * Ilgari `magazine` faqat TITUL slaydiga ta'sir qilardi, ya'ni «Esse»
 * yoki «Adabiyot» tanlagan foydalanuvchi 16 slaydning 15 tasini
 * `classic` bilan bir xil olardi. Tasma rasmsiz ham chiziladi —
 * fal.ai yiqilsa maket «buzilib» emas, shunchaki to'q muqova bo'lib
 * qoladi.
 */
function planSectionMagazine(s: SlideModel, theme: SlideTheme, index: number, total: number): SlidePlan {
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  // To'q temada fon allaqachon qorong'i — qoplama fotoni yo'q qilmasin.
  photo(layers, s.image?.url, { x: 0, y: 0, w: W, h: H }, theme.darkContent ? 0.3 : 0.44);
  /*
   * Matn tasmasi RASM BORLIGIGA qarab joylashadi.
   *
   * Ilgari u har doim pastda (y=4.15) turardi. Rasmsiz slaydda — ya'ni
   * fal.ai kalitsiz yoki byudjet tugagan har bir generatsiyada — slaydning
   * yuqori 4 dyuymi butunlay bo'sh to'q maydon bo'lib qolardi. PDF ga
   * o'girib ko'rilganda aynan shu ko'rindi.
   */
  const img = Boolean(s.image?.url);
  const bandY = img ? 4.15 : 2.35;
  layers.push({
    t: "rect",
    box: { x: 0, y: bandY, w: W, h: H - bandY },
    fill: { color: theme.titleBg, alpha: img ? 0.82 : 0 },
  });
  const x = 0.9;
  const tw = W - 1.8;
  layers.push({ t: "rect", box: { x, y: bandY + 0.35, w: 1.35, h: 0.08 }, fill: { color: theme.accent } });
  const titleBox: Box = { x, y: bandY + 0.63, w: tw, h: 1.0 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 30, 20),
    bold: true,
  });
  if (s.subtitle) {
    const subBox: Box = { x, y: bandY + 1.71, w: tw, h: 1.14 };
    layers.push({
      t: "text",
      box: subBox,
      text: s.subtitle,
      color: theme.titleMuted,
      size: fitSize(s.subtitle, subBox, 16, 12),
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, true);
  return { bg: theme.titleBg, layers };
}

function planSection(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  if (visual === "magazine") return planSectionMagazine(s, theme, index, total);
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

/**
 * Iqtibos (`quote`) va yakuniy (`closing`) slayd — to'la ekran kadr
 * ustidagi matn.
 *
 * AUDIT-7 O-2: `twoCol` bilan bir qatorda bu ikkisi ham `visual` ga
 * javob bermasdi. `closing` HAR BIR dekada bor, `quote` esa 14 dan 11
 * shablonda — ya'ni «shablonni almashtirdim, deka o'sha-o'sha» hissining
 * yarmi shu funksiyadan kelardi.
 *
 *   magazine    markazlashgan panel emas, pastki tasmada yirik iqtibos
 *   dense       hisobot sahifasi: chapga tekislangan, zich, kichik shrift
 *   cards       yorug' sahifa + surface kartasi (fon rangining o'zi ham
 *               o'zgaradi, ya'ni farq bir qarashda ko'rinadi)
 *   classic/timeline/hero-split  bazaviy markazlashgan panel
 */
function planOverlay(
  s: SlideModel,
  theme: SlideTheme,
  visual: SlideVisual,
  index: number,
  total: number,
  kind: "quote" | "closing",
): SlidePlan {
  const img = s.image?.url;
  const layers: SlideLayer[] = [];

  // ── magazine: muqova tili. Panel yo'q — kadr to'la ekranda qoladi,
  // matn esa pastki tasmada chapga tekislanib, yirik shriftda beriladi.
  if (visual === "magazine") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    photo(layers, img, photoSlot(kind)!, theme.darkContent ? 0.32 : 0.5);
    // Rasmsiz tasma yuqoriroq boshlanadi — aks holda sahifaning yuqori
    // yarmi bo'sh to'q maydon bo'lib qolardi (`planSectionMagazine` da
    // aynan shu nuqson PDF da ko'rilgan).
    const bandY = img ? 3.35 : 2.0;
    layers.push({
      t: "rect",
      box: { x: 0, y: bandY, w: W, h: H - bandY },
      fill: { color: theme.titleBg, alpha: img ? 0.84 : 0 },
    });
    const x = 0.9;
    const tw = W - 1.8;
    // Iqtibos belgisi RASM emas, aksent brus: `accent` to'q fonda matn
    // rangi sifatida o'lchanmagan (`tests/themes.test.mts`).
    layers.push({ t: "rect", box: { x, y: bandY + 0.4, w: 1.7, h: 0.1 }, fill: { color: theme.accent } });
    if (kind === "quote") {
      const qText = s.quote || s.title;
      // Quti ATAYLAB past: ilgari 2.05 edi va ikki qatorli iqtibosdan
      // keyin muallifgacha bir dyuymlik bo'shliq qolardi (PDF da ko'rindi).
      const qBox: Box = { x, y: bandY + 0.72, w: tw, h: 1.75 };
      layers.push({
        t: "text",
        box: qBox,
        text: qText,
        color: theme.titleText,
        size: fitSize(qText, qBox, 32, 19),
        bold: true,
      });
      if (s.quoteBy) {
        layers.push({
          t: "text",
          box: { x, y: bandY + 2.6, w: tw, h: 0.42 },
          text: `— ${s.quoteBy}`,
          color: theme.titleMuted,
          size: 15,
          uppercase: true,
          tracking: 1.2,
        });
      }
    } else {
      const tBox: Box = { x, y: bandY + 0.72, w: tw, h: 1.15 };
      layers.push({
        t: "text",
        box: tBox,
        text: s.title,
        color: theme.titleText,
        size: fitSize(s.title, tBox, 34, 22),
        bold: true,
      });
      if (s.subtitle) {
        const sBox: Box = { x, y: bandY + 1.98, w: tw, h: 1.05 };
        layers.push({
          t: "text",
          box: sBox,
          text: s.subtitle,
          color: theme.titleMuted,
          size: fitSize(s.subtitle, sBox, 17, 13),
        });
      }
    }
    if (img) layers.push({ t: "rect", box: { x: 0, y: 6.92, w: W, h: 0.58 }, fill: { color: "#000000", alpha: 0.35 } });
    pushFooter(layers, s, theme, index, total, { x, w: tw }, true);
    return { bg: theme.titleBg, layers };
  }

  // ── dense: himoya/hisobot yakuni. Rasm FON darajasiga tushiriladi,
  // matn chapga tekislanadi va kichikroq bo'ladi — sahifa «plakat» emas,
  // hujjat bo'lib qoladi.
  if (visual === "dense") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    photo(layers, img, photoSlot(kind)!, theme.darkContent ? 0.34 : 0.5);
    layers.push({ t: "rect", box: { x: 0, y: 0, w: 0.14, h: H }, fill: { color: theme.accent } });
    const x = M + 0.18;
    const tw = 12.25;
    /*
     * Blok sahifa MARKAZIDA turadi, yuqorisida emas.
     *
     * Ilgari u y=1.5 dan boshlanardi va sarlavhadan keyin sahifaning
     * pastki 3.5 dyuymi butunlay bo'sh qolardi — PDF da yakuniy slayd
     * «yarim chizilgan» ko'rinardi. Qutilar ham qisqartirildi: sarlavha
     * bilan izoh orasida deyarli bir dyuymlik bo'shliq bor edi.
     */
    const blockY = 2.55;
    /*
     * Matn ostidagi tasma.
     *
     * Ilgari dense tarmog'i faqat qoplamaga tayanardi (0.68). PDF da
     * ko'rilganda kadrdagi shakllar matn ORQASIDA baribir ko'rinib
     * turardi — «Xulosa» o'qilardi, izoh esa deyarli yo'qolardi.
     * Endi blok ostida deyarli shaffofmas tasma bor, qoplama esa
     * yumshoqroq: kadr tasmadan tashqarida ko'rinib qoladi.
     */
    layers.push({
      t: "rect",
      box: { x: 0, y: blockY - 0.45, w: W, h: 3.4 },
      fill: { color: theme.titleBg, alpha: img ? 0.92 : 0 },
    });
    layers.push({ t: "rect", box: { x, y: blockY, w: tw, h: 0.035 }, fill: { color: theme.accent } });
    if (kind === "quote") {
      const qText = s.quote || s.title;
      layers.push({
        t: "text",
        box: { x, y: blockY + 0.22, w: tw, h: 0.36 },
        text: s.title,
        color: theme.titleMuted,
        size: 13,
        bold: true,
        uppercase: true,
        tracking: 1.5,
      });
      const qBox: Box = { x, y: blockY + 0.7, w: tw, h: 1.5 };
      layers.push({
        t: "text",
        box: qBox,
        text: qText,
        color: theme.titleText,
        size: fitSize(qText, qBox, 22, 15),
        italic: true,
      });
      if (s.quoteBy) {
        layers.push({
          t: "text",
          box: { x, y: blockY + 2.32, w: tw, h: 0.4 },
          text: `— ${s.quoteBy}`,
          color: theme.titleMuted,
          size: 14,
        });
      }
    } else {
      const tBox: Box = { x, y: blockY + 0.25, w: tw, h: 0.85 };
      layers.push({
        t: "text",
        box: tBox,
        text: s.title,
        color: theme.titleText,
        size: fitSize(s.title, tBox, 26, 18),
        bold: true,
      });
      if (s.subtitle) {
        const sBox: Box = { x, y: blockY + 1.2, w: tw, h: 1.3 };
        layers.push({
          t: "text",
          box: sBox,
          text: s.subtitle,
          // Hisobot sahifasida izoh ham asosiy matn rangida: `titleMuted`
          // (aksent) 16 pt da sarlavha ostidagi izoh emas, sarlavha osti
          // yozuvidek ko'rinardi.
          color: theme.titleText,
          size: fitSize(s.subtitle, sBox, 16, 12),
        });
      }
    }
    // Kolontitul ham kadr ustida qolmasin: `titleMuted` faqat `titleBg`
    // ustida o'lchangan (PDF da pastki qator kadrning och qismiga tushib
    // deyarli ko'rinmay qolgandi).
    if (img) layers.push({ t: "rect", box: { x: 0, y: 6.9, w: W, h: 0.6 }, fill: { color: theme.titleBg, alpha: 0.92 } });
    pushFooter(layers, s, theme, index, total, { x, w: tw }, true);
    return { bg: theme.titleBg, layers };
  }

  // ── cards: sahifa yorug' qoladi (`bg`), matn esa `surface` kartasida —
  // shu shablonlarning band slaydlaridagi karta tili bilan bir xil.
  if (visual === "cards") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    // Karta to'la to'ldirilgan, shuning uchun kadr deyarli qoplamasiz
    // qoladi — «foto + karta» ko'rinishi.
    photo(layers, img, photoSlot(kind)!, 0.12);
    const card: Box = kind === "quote" ? { x: 1.3, y: 1.9, w: 10.7, h: 3.4 } : { x: 2.1, y: 2.15, w: 9.1, h: 3.2 };
    layers.push({ t: "rect", box: card, fill: { color: theme.surface }, radius: 0.14 });
    layers.push({ t: "rect", box: { x: card.x, y: card.y, w: 0.12, h: card.h }, fill: { color: theme.accent }, radius: 0.06 });
    const tx = card.x + 0.6;
    const twc = card.w - 1.2;
    if (kind === "quote") {
      const qText = s.quote || s.title;
      const qBox: Box = { x: tx, y: card.y + 0.5, w: twc, h: 1.9 };
      layers.push({
        t: "text",
        box: qBox,
        text: qText,
        color: theme.text,
        size: fitSize(qText, qBox, 24, 16),
        italic: true,
      });
      if (s.quoteBy) {
        layers.push({
          t: "text",
          box: { x: tx, y: card.y + 2.5, w: twc, h: 0.4 },
          text: `— ${s.quoteBy}`,
          color: theme.accentInk,
          size: 14,
          bold: true,
        });
      }
    } else {
      const tBox: Box = { x: tx, y: card.y + 0.55, w: twc, h: 1.0 };
      layers.push({
        t: "text",
        box: tBox,
        text: s.title,
        color: theme.text,
        size: fitSize(s.title, tBox, 30, 20),
        bold: true,
      });
      if (s.subtitle) {
        const sBox: Box = { x: tx, y: card.y + 1.75, w: twc, h: 1.1 };
        layers.push({
          t: "text",
          box: sBox,
          text: s.subtitle,
          // `accentInk`/`surface` — o'lchangan juft. `muted` karta ustida
          // o'lchanmagan, shuning uchun ishlatilmaydi.
          color: theme.accentInk,
          size: fitSize(s.subtitle, sBox, 16, 12),
        });
      }
    }
    // Pastki tasma to'la to'ldirilgan: kolontitul rangi (`muted`) faqat
    // `bg` ustida o'lchangan, kadr ustida emas.
    layers.push({ t: "rect", box: { x: 0, y: 6.9, w: W, h: 0.6 }, fill: { color: theme.bg } });
    pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, false);
    return { bg: theme.bg, layers };
  }

  // ── classic (va timeline / hero-split): markazlashgan panel.
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

/**
 * Tana matni chegarasi auditoriyaga bog'liq: maktab sinfida 24 pt dan
 * boshlanib 20 pt dan pastga tushmaydi, himoyada 18/15 yetarli.
 *
 * Chegara PARAMETR sifatida uzatiladi, modul o'zgaruvchisi sifatida emas —
 * yashirin holat bu fayldа ilgari haqiqiy bug bergan (rasm keshi).
 */
type BodyType = ReturnType<typeof audienceRules>;

/** Bandlar orasidagi eng kichik oraliq (pt) — zich matnda aynan shu qoladi. */
const BULLET_GAP_MIN = 10;
/**
 * Eng katta oraliq — tana shriftining ulushi sifatida.
 *
 * Bundan kattasi ro'yxatni ro'yxat bo'lmay qo'yadi: bandlar bir-biridan
 * uzilib, alohida gaplar bo'lib ko'rinadi. 18 pt tanada 1.6× ≈ 29 pt,
 * ya'ni qator balandligining ~1.2 baravari — havodor, lekin bog'liq.
 */
const BULLET_GAP_RATIO = 1.6;

/**
 * AUDIT-7 O-4. `classic` bandlari qutiga TEPADAN tizilar edi.
 *
 * `fitLines` shriftni tanlagach, oraliq har doim qat'iy 10 pt qolardi —
 * ya'ni band qisqa bo'lsa (jonli o'lchovda 75–120 belgi odatiy) matn
 * qutining faqat yuqori qismini egallab, pastki yarmi bo'sh oq maydon
 * bo'lib qolardi. O'lchov: 3 × 48 belgi → 5.35″ qutining 26% i, pastda
 * 3.96″ bo'sh joy. `cards` da bu muammo yo'q (kartalar maydonni bo'lib
 * oladi), `classic` esa eng ko'p ishlatiladigan maket.
 *
 * Yechim shrift EMAS (u 18 pt shifti va auditoriya polida qulflangan),
 * balki qolgan bo'shliq: u bandlar orasiga MUTANOSIB taqsimlanadi.
 * Qolgani (chegara urilganda) `valign: "middle"` bilan tepa va pastga
 * teng bo'linadi.
 *
 * Tartib muhim: avval shrift (o'qish qulayligi), keyin qoldiq. Shuning
 * uchun uzun matnda (4 × 165 belgi) shrift ham, zichlik ham o'zgarmaydi
 * — u yerda qoldiq deyarli yo'q va oraliq 10 pt atrofida qoladi.
 */
function bulletGap(lines: string[], box: Box, size: number): number {
  const items = lines.filter(Boolean);
  if (!items.length) return BULLET_GAP_MIN;
  const slack = box.h * 72 - listRows(items, box, size) * size * 1.3;
  const even = slack / items.length;
  return Math.round(Math.max(BULLET_GAP_MIN, Math.min(size * BULLET_GAP_RATIO, even)));
}

/**
 * `cards` maketida bandlar RO'YXAT emas, alohida kartalar.
 *
 * `cards` `SlideVisual` da 21 shablon davridayoq bor edi, lekin
 * `slide-layout.ts` da unga BIRORTA tarmoq yo'q edi: `compare`, `case`,
 * `lesson`, `debate`, `workshop` — beshtasi ham `classic` bilan
 * piksel-bapiksel bir xil chiqardi. Aynan shu «har xil shablon tanlasam
 * ham bitta narsa chiqadi» shikoyatining vizual tomoni edi.
 *
 * Karta soni 4 tadan oshmaydi (`AUDIENCE_RULES.maxBullets`), shuning
 * uchun 1 ta ustun (n≤2) yoki 2×2 to'r yetarli. Shrift `fitSize` bilan
 * kartaning O'Z qutisiga sig'diriladi — ro'yxatdagi `fitLines` emas.
 */
function planBulletCards(
  layers: SlideLayer[],
  items: string[],
  theme: SlideTheme,
  zone: Box,
  bodyType: BodyType,
): void {
  const n = Math.max(1, items.length);
  const cols = n >= 3 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gap = 0.24;
  const cardW = (zone.w - gap * (cols - 1)) / cols;
  const cardH = (zone.h - gap * (rows - 1)) / rows;
  items.forEach((line, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = zone.x + c * (cardW + gap);
    const y = zone.y + r * (cardH + gap);
    /*
     * Toq sondagi oxirgi karta ikki ustunni egallaydi.
     *
     * 3 ta band 2×2 to'rda chizilganda pastki o'ng burchak bo'sh qolardi
     * — PDF da slayd «yarim to'ldirilgan» ko'rinardi.
     */
    const last = i === items.length - 1;
    const w = last && cols === 2 && c === 0 ? zone.w : cardW;
    layers.push({ t: "rect", box: { x, y, w, h: cardH }, fill: { color: theme.surface }, radius: 0.1 });
    layers.push({ t: "rect", box: { x, y, w: 0.09, h: cardH }, fill: { color: theme.accent }, radius: 0.04 });
    layers.push({
      t: "text",
      box: { x: x + 0.32, y: y + 0.2, w: 0.6, h: 0.42 },
      text: String(i + 1).padStart(2, "0"),
      color: theme.accentInk,
      size: 15,
      bold: true,
    });
    const textBox: Box = { x: x + 0.32, y: y + 0.72, w: w - 0.64, h: cardH - 0.94 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, bodyType.bodyPt, bodyType.minPt),
    });
  });
}

/**
 * `lab` maketi — laboratoriya daftari. AUDIT-7 O-3.
 *
 * `science` (Tajriba) ning `visual` i `classic` edi, ya'ni u `lecture`
 * bilan piksel-bapiksel bir xil chizilardi — farqi faqat `beats` va rol
 * matnida edi. Foydalanuvchi uchun bu «Tajriba» ni tanlaganida hech
 * narsa o'zgarmagandek ko'rinardi.
 *
 * Endi tajriba slaydi kuzatuv daftariga o'xshaydi: chap chekkada
 * o'lchov chizig'i (shkala) va uning bo'linmalari, har band esa
 * raqamlangan KUZATUV QATORI — ostiga chizilgan ingichka chiziq bilan.
 * Bu `cards` (alohida kartalar) dan ham, `classic` (bitta o'q ro'yxat)
 * dan ham ko'zga tashlanadigan darajada boshqacha.
 *
 * Ranglar: matn faqat `text`/`accentInk` (ikkalasi ham `surface` ustida
 * AA bo'yicha o'lchanadigan juftlik); `accent` faqat chiziq va
 * bo'linmalarda — matn rangi sifatida ISHLATILMAYDI.
 */
function planLabRows(
  layers: SlideLayer[],
  items: string[],
  theme: SlideTheme,
  zone: Box,
  bodyType: BodyType,
): void {
  const pad = 0.24;
  const ruleX = zone.x + 0.62;
  const textX = ruleX + 0.36;
  const textW = zone.w - (textX - zone.x) - 0.28;
  const top = zone.y + pad;
  const usable = zone.h - pad * 2;

  // Daftar varag'i.
  layers.push({ t: "rect", box: zone, fill: { color: theme.surface }, radius: 0.1 });
  // O'lchov chizig'i va uning mayda bo'linmalari (o'lchov asbobi hissi).
  layers.push({ t: "rect", box: { x: ruleX, y: top, w: 0.022, h: usable }, fill: { color: theme.accent } });
  const ticks = 20;
  for (let i = 0; i <= ticks; i++) {
    layers.push({
      t: "rect",
      box: { x: ruleX + 0.022, y: top + (usable * i) / ticks - 0.008, w: 0.11, h: 0.016 },
      fill: { color: theme.accent, alpha: 0.42 },
    });
  }

  const n = Math.max(1, items.length);
  const rowH = usable / n;
  items.forEach((line, i) => {
    const y = top + i * rowH;
    // Katta bo'linma — kuzatuv qatorining boshlanishi.
    layers.push({ t: "rect", box: { x: ruleX + 0.022, y: y - 0.014, w: 0.26, h: 0.028 }, fill: { color: theme.accent } });
    layers.push({
      t: "text",
      box: { x: zone.x + 0.14, y, w: 0.42, h: 0.4 },
      text: String(i + 1).padStart(2, "0"),
      color: theme.accentInk,
      size: 14,
      bold: true,
      align: "right",
    });
    const textBox: Box = { x: textX, y: y + 0.06, w: textW, h: rowH - 0.32 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, bodyType.bodyPt, bodyType.minPt),
      valign: "middle",
    });
    // Kuzatuv qatorining ostidagi chiziq — daftar chizig'i.
    layers.push({
      t: "rect",
      box: { x: textX, y: y + rowH - 0.16, w: textW, h: 0.01 },
      fill: { color: theme.accent, alpha: 0.3 },
    });
  });
}

function planBullets(
  s: SlideModel,
  theme: SlideTheme,
  visual: SlideVisual,
  index: number,
  total: number,
  agenda: boolean,
  bodyType: BodyType,
): SlidePlan {
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
  if (!agenda && visual === "cards" && items.length) {
    planBulletCards(layers, items, theme, { x, y: 1.5, w: tw, h: 5.35 }, bodyType);
    pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
    return { bg: theme.bg, layers };
  }
  if (!agenda && visual === "lab" && items.length) {
    planLabRows(layers, items, theme, { x, y: 1.5, w: tw, h: 5.35 }, bodyType);
    pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
    return { bg: theme.bg, layers };
  }
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
        size: fitSize(line, lineBox, bodyType.bodyPt, bodyType.minPt - 1),
        valign: "middle",
      });
    });
  } else {
    const bulletBox: Box = { x, y: 1.5, w: tw, h: 5.35 };
    // Slide Law: tana matni 18 pt dan boshlanadi va 15 pt dan pastga
    // tushmaydi. Sig'masa — muammo kontentda, shriftda emas.
    const size = fitLines(items, bulletBox, bodyType.bodyPt, bodyType.minPt, BULLET_GAP_MIN);
    layers.push({
      t: "text",
      box: bulletBox,
      lines: items,
      bullets: true,
      color: theme.text,
      size,
      // AUDIT-7 O-4: qoldiq bo'shliq bandlar orasiga taqsimlanadi...
      paraSpace: bulletGap(items, bulletBox, size),
      // ...chegara urilganda qolgani tepa va pastga TENG bo'linadi.
      valign: "middle",
    });
  }
  pushFooter(layers, s, theme, index, total, { x, w: tw }, false);
  return { bg: theme.bg, layers };
}

/**
 * Ikki ustunli slayd (`twoCol`) va qiyos (`compare`).
 *
 * AUDIT-7 O-2: bu maket 14 shablonning HAMMASIDA piksel-bapiksel bir xil
 * chiqardi — `visual` parametri unga umuman yetib bormasdi. Holbuki
 * `twoCol` HAR BIR shablonning beats yoki fillers ro'yxatida bor
 * (`SLIDE_TEMPLATES`), ya'ni foydalanuvchi shablonni almashtirganda
 * dekaning uchdan bir qismi o'zgarmagan holda qolardi.
 *
 * Endi har bir `visual` uchun alohida tarmoq bor va u shablonning
 * `nameUz`/`blurb` va'dasiga mos keladi:
 *
 *   dense       to'q hisobot sahifasi, ramkasiz zich qatorlar (6 tagacha)
 *   magazine    jurnal tarqatmasi: yirik sarlavha + ustun ajratgichi
 *   hero-split  chap ustun to'la balandlikdagi to'q panel
 *   timeline    har ustun tik o'q bo'ylab nuqtalar
 *   cards       har band alohida karta
 *   classic     bazaviy: ikki to'ldirilgan ustun
 */
function planTwoCol(
  s: SlideModel,
  theme: SlideTheme,
  visual: SlideVisual,
  index: number,
  total: number,
  compare: boolean,
): SlidePlan {
  const layers: SlideLayer[] = [];
  const sides = [
    { head: s.leftTitle || "", lines: s.left ?? [] },
    { head: s.rightTitle || "", lines: s.right ?? [] },
  ];
  const zoneX = M + 0.12;
  const zoneW = 12.25;
  const bottom = 6.85;

  // ── dense: himoya/hisobot. To'q sahifa, karta yo'q, qatorlar orasida
  // faqat ingichka ajratgich — bir slaydga ko'proq dalil sig'adi.
  if (visual === "dense") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
    const x0 = M + 0.18;
    // Sarlavha `planHeading` dan EMAS: u `theme.text` bilan yozadi, u esa
    // to'q sahifada o'lchanmagan juft. To'q fonda faqat `titleText`.
    const titleBox: Box = { x: x0, y: 0.34, w: zoneW, h: 0.7 };
    layers.push({
      t: "text",
      box: titleBox,
      text: s.title,
      color: theme.titleText,
      size: fitSize(s.title, titleBox, 22, 16),
      bold: true,
    });
    layers.push({ t: "rect", box: { x: x0, y: 1.1, w: zoneW, h: 0.035 }, fill: { color: theme.accent } });
    const gap = 0.4;
    const colW = (zoneW - gap) / 2;
    const top = 1.45;
    sides.forEach((c, i) => {
      const cx = x0 + i * (colW + gap);
      layers.push({
        t: "text",
        box: { x: cx, y: top, w: colW, h: 0.36 },
        text: c.head,
        color: theme.titleMuted,
        size: 13,
        bold: true,
        uppercase: true,
        tracking: 1.4,
      });
      // Qiyosda chap ustun to'la kenglikdagi aksent chiziq bilan belgilanadi.
      const ruleW = compare && i === 0 ? colW : 1.2;
      layers.push({ t: "rect", box: { x: cx, y: top + 0.42, w: ruleW, h: 0.03 }, fill: { color: theme.accent } });
      const items = c.lines.slice(0, 6);
      const rowsTop = top + 0.6;
      // Qator balandligi CHEKLANADI: bo'sh joyni bo'lib yuborsa, uch banddan
      // iborat ustun 1.6 dyuymlik qatorlarga cho'zilib «zich» emas, siyrak
      // ko'rinardi — PDF da aynan shu ko'rindi. Endi qatorlar yuqorida zich
      // turadi, ortiqcha joy pastda qoladi (hujjat sahifasidagi kabi).
      const rowH = Math.min(1.05, (bottom - rowsTop) / Math.max(1, items.length));
      items.forEach((line, r) => {
        const y = rowsTop + r * rowH;
        if (r > 0) {
          layers.push({ t: "rect", box: { x: cx, y, w: colW, h: 0.012 }, fill: { color: theme.titleMuted, alpha: 0.4 } });
        }
        const box: Box = { x: cx, y: y + 0.08, w: colW, h: rowH - 0.16 };
        layers.push({
          t: "text",
          box,
          text: line,
          color: theme.titleText,
          size: fitSize(line, box, 15, 11),
          valign: "middle",
        });
      });
    });
    pushFooter(layers, s, theme, index, total, { x: x0, w: zoneW }, true);
    return { bg: theme.titleBg, layers };
  }

  // ── magazine: tarqatma sahifa. Karta ham, ramka ham yo'q — yirik
  // sarlavha, ostidagi to'la kenglikdagi chiziq va ustunlar orasidagi
  // tik ajratgich. Bandlar nuqtasiz abzas bo'lib oqadi.
  if (visual === "magazine") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    const x0 = 0.7;
    const magW = W - 1.4;
    const titleBox: Box = { x: x0, y: 0.5, w: magW, h: 1.05 };
    layers.push({
      t: "text",
      box: titleBox,
      text: s.title,
      color: theme.text,
      size: fitSize(s.title, titleBox, 34, 22),
      bold: true,
    });
    layers.push({ t: "rect", box: { x: x0, y: 1.68, w: magW, h: 0.045 }, fill: { color: theme.accent } });
    const top = 2.0;
    const divW = 0.035;
    const gap = 0.5;
    const colW = (magW - gap * 2 - divW) / 2;
    layers.push({
      t: "rect",
      box: { x: x0 + colW + gap, y: top, w: divW, h: bottom - top },
      fill: { color: theme.accent, alpha: 0.55 },
    });
    sides.forEach((c, i) => {
      const cx = x0 + i * (colW + gap * 2 + divW);
      layers.push({
        t: "text",
        box: { x: cx, y: top, w: colW, h: 0.44 },
        text: c.head,
        color: theme.accentInk,
        size: 15,
        bold: true,
        uppercase: true,
        tracking: 1.6,
      });
      const items = c.lines.slice(0, 4);
      const bodyBox: Box = { x: cx, y: top + 0.6, w: colW, h: bottom - top - 0.6 };
      layers.push({
        t: "text",
        box: bodyBox,
        lines: items,
        color: theme.text,
        size: fitLines(items, bodyBox, 19, 14, 14),
        paraSpace: 14,
      });
    });
    pushFooter(layers, s, theme, index, total, { x: x0, w: magW }, false);
    return { bg: theme.bg, layers };
  }

  // ── hero-split: titul slaydidagi kabi chap yarim to'q panel. Slayd
  // sarlavhasi ham, chap ustun ham shu panel ichida — «muammo/yechim» va
  // «pitch» shablonlari aynan shu qarama-qarshilikka quriladi.
  if (visual === "hero-split") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    layers.push({ t: "rect", box: { x: 0, y: 0, w: LEFT_IMG_W, h: H }, fill: { color: theme.titleBg } });
    // Qiyosda ikki tomon orasiga tik chok qo'yiladi.
    if (compare) layers.push({ t: "rect", box: { x: LEFT_IMG_W, y: 0, w: 0.07, h: H }, fill: { color: theme.accent } });
    const px = M + 0.05;
    const pw = LEFT_IMG_W - px - 0.45;
    const titleBox: Box = { x: px, y: 0.62, w: pw, h: 1.5 };
    layers.push({
      t: "text",
      box: titleBox,
      text: s.title,
      color: theme.titleText,
      size: fitSize(s.title, titleBox, 26, 17),
      bold: true,
    });
    layers.push({ t: "rect", box: { x: px, y: 2.25, w: 1.2, h: 0.08 }, fill: { color: theme.accent } });
    layers.push({
      t: "text",
      box: { x: px, y: 2.55, w: pw, h: 0.4 },
      text: sides[0].head,
      color: theme.titleMuted,
      size: 14,
      bold: true,
      uppercase: true,
      tracking: 1.4,
    });
    const lItems = sides[0].lines.slice(0, 5);
    const lBox: Box = { x: px, y: 3.05, w: pw, h: 3.75 };
    layers.push({
      t: "text",
      box: lBox,
      lines: lItems,
      bullets: true,
      color: theme.titleText,
      size: fitLines(lItems, lBox, 17, 13, 10),
      paraSpace: 10,
    });
    const rx = RIGHT_COL_X();
    const rw = RIGHT_COL_W();
    layers.push({
      t: "text",
      box: { x: rx, y: 0.75, w: rw, h: 0.4 },
      text: sides[1].head,
      color: theme.accentInk,
      size: 14,
      bold: true,
      uppercase: true,
      tracking: 1.4,
    });
    layers.push({ t: "rect", box: { x: rx, y: 1.22, w: 1.2, h: 0.07 }, fill: { color: theme.accent } });
    const rItems = sides[1].lines.slice(0, 5);
    const rBox: Box = { x: rx, y: 1.5, w: rw, h: 5.35 };
    layers.push({
      t: "text",
      box: rBox,
      lines: rItems,
      bullets: true,
      color: theme.text,
      size: fitLines(rItems, rBox, 18, 14, 12),
      paraSpace: 12,
    });
    pushFooter(layers, s, theme, index, total, { x: rx, w: rw }, false);
    return { bg: theme.bg, layers };
  }

  // ── timeline: har ustun tik o'q. `process` maketidagi gorizontal
  // chiziqning ikki ustunli varianti — bandlar ketma-ketlik bo'lib
  // o'qiladi, oddiy ro'yxat emas.
  if (visual === "timeline") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    pushChrome(layers, theme, "full");
    planHeading(layers, s, theme, 12.2, M + 0.18);
    const gap = 0.45;
    const colW = (zoneW - gap) / 2;
    const top = 1.5;
    sides.forEach((c, i) => {
      const cx = zoneX + i * (colW + gap);
      layers.push({
        t: "text",
        box: { x: cx, y: top, w: colW, h: 0.38 },
        text: c.head,
        color: theme.accentInk,
        size: 14,
        bold: true,
        uppercase: true,
        tracking: 1.4,
      });
      const items = c.lines.slice(0, 5);
      const n = Math.max(1, items.length);
      const rowsTop = top + 0.55;
      const rowH = (bottom - rowsTop) / n;
      const railX = cx + 0.16;
      // O'q birinchi nuqtaning markazidan oxirgisinikigacha cho'ziladi.
      layers.push({
        t: "rect",
        box: { x: railX + 0.085, y: rowsTop + 0.15, w: 0.05, h: Math.max(0.05, (n - 1) * rowH) },
        fill: { color: theme.accent },
      });
      items.forEach((line, r) => {
        const y = rowsTop + r * rowH;
        layers.push({
          t: "rect",
          box: { x: railX, y: y + 0.04, w: 0.22, h: 0.22 },
          fill: { color: theme.accent },
          radius: 0.11,
        });
        const box: Box = { x: cx + 0.62, y, w: colW - 0.62, h: rowH - 0.18 };
        layers.push({ t: "text", box, text: line, color: theme.text, size: fitSize(line, box, 16, 12) });
      });
    });
    pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, false);
    return { bg: theme.bg, layers };
  }

  // ── cards: ustun ichidagi har band alohida karta. `planBulletCards`
  // bilan bir tilda gapiradi, lekin ikki ustunli.
  if (visual === "cards") {
    layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
    pushChrome(layers, theme, "full");
    planHeading(layers, s, theme, 12.2, M + 0.18);
    const gap = 0.34;
    const colW = (zoneW - gap) / 2;
    const top = 1.45;
    sides.forEach((c, i) => {
      const dark = compare && i === 0;
      const cx = zoneX + i * (colW + gap);
      layers.push({
        t: "text",
        box: { x: cx + 0.06, y: top, w: colW - 0.12, h: 0.38 },
        text: c.head,
        color: theme.accentInk,
        size: 14,
        bold: true,
        uppercase: true,
        tracking: 1.4,
      });
      const items = c.lines.slice(0, 4);
      const n = Math.max(1, items.length);
      const cardsTop = top + 0.5;
      const cardGap = 0.16;
      const cardH = (bottom - cardsTop - cardGap * (n - 1)) / n;
      items.forEach((line, r) => {
        const y = cardsTop + r * (cardH + cardGap);
        layers.push({
          t: "rect",
          box: { x: cx, y, w: colW, h: cardH },
          fill: { color: dark ? theme.titleBg : theme.surface },
          radius: 0.1,
        });
        layers.push({ t: "rect", box: { x: cx, y, w: 0.09, h: cardH }, fill: { color: theme.accent }, radius: 0.04 });
        const box: Box = { x: cx + 0.32, y: y + 0.16, w: colW - 0.56, h: cardH - 0.32 };
        layers.push({
          t: "text",
          box,
          text: line,
          color: dark ? theme.titleText : theme.text,
          size: fitSize(line, box, 16, 12),
          valign: "middle",
        });
      });
    });
    pushFooter(layers, s, theme, index, total, { x: M + 0.18, w: 12.2 }, false);
    return { bg: theme.bg, layers };
  }

  // ── classic: bazaviy ikki to'ldirilgan ustun.
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  planHeading(layers, s, theme, 12.2, M + 0.18);
  const colW = 5.85;
  const gap = 0.28;
  const y = 1.35;
  const h = 5.5;
  const cols = [
    { x: zoneX, head: s.leftTitle, lines: s.left, dark: compare },
    { x: zoneX + colW + gap, head: s.rightTitle, lines: s.right, dark: false },
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
/**
 * Qiymatning BIRLIGI: «97.5%» → «%», «4 bosqich» → «bosqich», «12» → «».
 *
 * Gorizontal diagramma faqat BIR XIL birlikli qiymatlarda ma'noli.
 * Jonli sinovda `report` shablonida «97.5%», «2.5%» va «4 bosqich»
 * bitta o'qqa chizilgan edi: 4 soni 97.5 ga nisbatan o'lchanib, uchinchi
 * ustun deyarli nolga tushardi — diagramma YOLG'ON taqqoslash
 * ko'rsatardi (AUDIT-8 N-2). Birliklar har xil bo'lsa karta ko'rinishi
 * to'g'riroq: u qiymatlarni bir-biriga nisbatan o'lchamaydi.
 */
export function statUnit(value: string): string {
  return String(value)
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/-?\d[\d\s.,]*/, " ")
    .replace(/\b(mlrd|milliard|billion|mln|million|ming|thousand)\b/g, " ")
    .replace(/[^\p{L}%°]/gu, "");
}

function planStatChart(
  s: SlideModel,
  theme: SlideTheme,
  items: { value: string; label: string; n: number }[],
  layers: SlideLayer[],
  ink: string,
  dense: boolean,
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
    /*
     * Fon yo'lakchasi — ustunlar qanchalik to'lganini ko'rsatadi.
     *
     * Rangi SAHIFAGA bog'liq. Ilgari qat'iy `theme.surface` (yorug' krem)
     * edi, `dense` sahifa esa to'q — natijada to'q fonda TO'LA
     * uzunlikdagi oq tasmalar chiqar va diagramma teskari o'qilardi:
     * 2.5% li qator ham «to'la» ko'rinardi (AUDIT-8 N-1,
     * `png/report-02.png`).
     */
    layers.push({
      t: "rect",
      box: { x: barX, y: cy, w: barMaxW, h: barH },
      fill: dense ? { color: "#ffffff", alpha: 0.14 } : { color: theme.surface },
      radius: 0.04,
    });
    /*
     * To'q sahifada HAMMA ustun `accent` dan.
     *
     * Yorug' sahifada birinchi ustun `accent`, qolgani `accent2` bilan
     * ajratilgan. To'q sahifada esa `accent2` (ko'p temada bo'g'iq
     * ko'k/kulrang) shaffof oq yo'lakcha bilan qo'shilib ketadi — PDF da
     * 2.5% va 0.3% li ustunlar UMUMAN ko'rinmasdi. Bu yerda urg'u emas,
     * o'qilishi ustun turadi.
     */
    layers.push({
      t: "rect",
      box: { x: barX, y: cy, w: Math.max(0.08, (Math.abs(it.n) / max) * barMaxW), h: barH },
      fill: { color: dense || i === 0 ? theme.accent : theme.accent2 },
      radius: 0.04,
    });
    layers.push({
      t: "text",
      box: { x: barX + barMaxW + 0.14, y: cy - 0.06, w: valueW, h: barH + 0.12 },
      text: it.value,
      /*
       * `accentInk` faqat `bg` va `surface` (yorug') ga qarshi
       * o'lchangan (`tests/themes.test.mts`). To'q sahifada o'lchangan
       * juftlik — `titleText`/`titleBg`.
       */
      color: dense ? theme.titleText : theme.accentInk,
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

  // Diagramma faqat qiymatlar TAQQOSLANADIGAN bo'lsa (bir xil birlik).
  const oneUnit = new Set(numeric.map((x) => statUnit(x.value))).size <= 1;
  if (numeric.length >= 3 && numeric.length === items.length && oneUnit) {
    planStatChart(s, theme, numeric, layers, ink, dense);
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
    /*
     * Yorliq quti ICHIDA vertikal markazda.
     *
     * Quti 2.3 dyuym, yorliq esa odatda bir-ikki qator — u tepaga
     * yopishib qolar va karta pastki yarmi bo'sh ko'rinardi (AUDIT-8
     * N-4, `png/defense-06.png`). Quti o'lchami o'zgarmaydi (uzun
     * yorliq hamon sig'adi), faqat matn markazlashtiriladi.
     */
    const labBox: Box = { x: x + 0.18, y: 3.65, w: colW - 0.36, h: 2.3 };
    layers.push({
      t: "text",
      box: labBox,
      text: st.label,
      color: dense ? theme.titleMuted : theme.muted,
      size: fitSize(st.label, labBox, 15, 11),
      align: "center",
      valign: "middle",
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
  const totalH = 6.85 - 1.65;
  /*
   * Bitta qatorli oqimda karta butun balandlikni EGALLAMAYDI.
   *
   * Ilgari `rowH = totalH` edi: 3 bosqichli slaydda karta 5.2 dyuym
   * bo'lar, matni esa 1 dyuymga sig'ardi — pastki 4 dyuym bo'sh oq
   * maydon bo'lib qolardi (PDF da ko'rindi). Endi karta 3.7 dyuymgacha
   * va maydon markazida turadi. Ikki qatorli oqimda (5–6 bosqich)
   * balandlik hamon to'liq bo'linadi.
   */
  const rowH = twoRows ? (totalH - rowGap) / 2 : Math.min(3.7, totalH);
  const top = twoRows ? 1.65 : 1.65 + (totalH - rowH) / 2;

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

/**
 * Ma'lumot jadvali.
 *
 * `pptx.addTable` ATAYLAB ishlatilmaydi: u faqat PPTX da mavjud va
 * saytdagi ko'ruvchi uni takrorlay olmasdi — `planSlide` ning yagona
 * manba bo'lish xususiyati buzilardi. Jadval `rect` va `text`
 * qatlamlaridan quriladi, shuning uchun preview eksport bilan bir xil.
 *
 * Sarlavha qatori `titleBg`/`titleText` juftidan foydalanadi — u
 * `tests/themes.test.mts` da kontrast bo'yicha o'lchanadi.
 */
function planTable(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number): SlidePlan {
  /*
   * `dense` (himoya / hisobot) jadvali to'q sahifada chiziladi — xuddi
   * shu maketdagi `stats` slaydi kabi. Ilgari `dense` FAQAT `stats` ga
   * ta'sir qilardi, ya'ni 8 slaydli hisobotning bittasi farq qilardi.
   *
   * Rang juftliklari ATAYLAB `titleText`/`titleMuted` — ikkalasi ham
   * `tests/themes.test.mts` da `titleBg` ga qarshi AA bo'yicha
   * o'lchanadi. `accent` bu yerda ishlatilmaydi: uning to'q fondagi
   * kontrasti o'lchanmagan.
   */
  const dense = visual === "dense";
  const pageBg = dense ? theme.titleBg : theme.bg;
  const headFill = dense ? "#ffffff" : theme.titleBg;
  const headAlpha = dense ? 0.14 : 1;
  const headInk = theme.titleText;
  const bodyFill = dense ? "#ffffff" : theme.surface;
  const bodyAlpha = dense ? 0.06 : 1;
  const keyInk = dense ? theme.titleText : theme.text;
  const cellInk = dense ? theme.titleMuted : theme.muted;
  const ruleInk = dense ? theme.titleMuted : theme.muted;

  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: pageBg } });
  if (!dense) pushChrome(layers, theme, "full");
  const headBox: Box = { x: M + 0.18, y: 0.3, w: 12.2, h: 0.88 };
  layers.push({
    t: "text",
    box: headBox,
    text: s.title,
    color: dense ? theme.titleText : theme.text,
    size: fitSize(s.title, headBox, 22, 16),
    bold: true,
  });
  layers.push({ t: "rect", box: { x: M + 0.18, y: 1.22, w: 1.1, h: 0.07 }, fill: { color: theme.accent } });

  const data = s.table ?? { headers: [], rows: [] };
  const cols = Math.max(1, data.headers.length);
  const rows = data.rows.slice(0, 6);
  const x0 = M + 0.18;
  const totalW = 12.25;
  const colW = totalW / cols;
  const top = 1.55;
  const headH = 0.6;
  /*
   * Qator balandligi chegarasi 0.95 edi: 3 qatorli jadval 6.75 dyuymlik
   * maydonning atigi 2.85 ini egallar, pastki 1.75 dyuym bo'sh qolardi
   * (PDF da ko'rindi, `dense` to'q sahifada ayniqsa yaqqol). 1.3 —
   * jadval maydonini to'ldiradi, lekin 2 qatorli jadvalni ham
   * cho'zilgan bantga aylantirmaydi.
   */
  const bodyH = Math.min(1.3, (6.75 - top - headH) / Math.max(1, rows.length));
  const pad = 0.14;

  // Sarlavha qatori.
  layers.push({
    t: "rect",
    box: { x: x0, y: top, w: totalW, h: headH },
    fill: { color: headFill, alpha: headAlpha },
    radius: 0.05,
  });
  data.headers.forEach((h, i) => {
    const box: Box = { x: x0 + i * colW + pad, y: top, w: colW - pad * 2, h: headH };
    layers.push({
      t: "text",
      box,
      text: h,
      color: headInk,
      size: fitSize(h, box, 15, 11),
      bold: true,
      valign: "middle",
    });
  });

  // Tana.
  const bodyTop = top + headH;
  layers.push({
    t: "rect",
    box: { x: x0, y: bodyTop, w: totalW, h: bodyH * rows.length },
    fill: { color: bodyFill, alpha: bodyAlpha },
  });
  rows.forEach((row, r) => {
    const y = bodyTop + r * bodyH;
    if (r > 0) {
      layers.push({
        t: "rect",
        box: { x: x0, y, w: totalW, h: 0.012 },
        fill: { color: ruleInk, alpha: 0.28 },
      });
    }
    for (let c = 0; c < cols; c++) {
      if (c > 0) {
        layers.push({
          t: "rect",
          box: { x: x0 + c * colW, y, w: 0.012, h: bodyH },
          fill: { color: ruleInk, alpha: 0.2 },
        });
      }
      const cell = row[c] ?? "";
      if (!cell) continue;
      const box: Box = { x: x0 + c * colW + pad, y, w: colW - pad * 2, h: bodyH };
      layers.push({
        t: "text",
        box,
        text: cell,
        color: c === 0 ? keyInk : cellInk,
        size: fitSize(cell, box, 14, 10),
        bold: c === 0,
        valign: "middle",
      });
    }
  });

  pushFooter(layers, s, theme, index, total, { x: x0, w: 12.2 }, dense);
  return { bg: pageBg, layers };
}

export function planSlide(
  s: SlideModel,
  theme: SlideTheme,
  visual: SlideVisual,
  index: number,
  total: number,
  audience: SlideAudience = "auto",
  templateId: SlideTemplateId = "lecture",
): SlidePlan {
  const bodyType = audienceRules(audience, templateId);
  switch (s.layout) {
    case "title":
      return planTitle(s, theme, visual, index, total);
    case "section":
      return planSection(s, theme, visual, index, total);
    case "quote":
      return planOverlay(s, theme, visual, index, total, "quote");
    case "closing":
      return planOverlay(s, theme, visual, index, total, "closing");
    case "agenda":
      return planBullets(s, theme, visual, index, total, true, bodyType);
    case "twoCol":
      return planTwoCol(s, theme, visual, index, total, false);
    case "compare":
      return planTwoCol(s, theme, visual, index, total, true);
    case "stats":
      return planStats(s, theme, visual, index, total);
    case "process":
      return planProcess(s, theme, visual, index, total);
    case "table":
      return planTable(s, theme, visual, index, total);
    default:
      return planBullets(s, theme, visual, index, total, false, bodyType);
  }
}

export function photoLayouts() {
  return ["title", "section", "bullets", "agenda", "quote", "closing"] as const;
}

/** Text boxes that must not collide with a side photo (used by tests / QA). */
export function sidePhotoBox(s: SlideModel, visual: SlideVisual): Box | null {
  if (!hasPhoto(s)) return null;
  if (s.layout === "quote" || s.layout === "closing") return null;
  // `magazine` da title va section rasmi to'la ekran: matn ustiga
  // ATAYLAB qo'yiladi (qoplama + tasma bilan), ya'ni «to'qnashuv» emas.
  if (visual === "magazine" && (s.layout === "title" || s.layout === "section")) return null;
  return photoSlot(s.layout, visual);
}
