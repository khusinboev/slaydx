import { LAYOUT_KIT, type Box, type PlanCtx, type SlideLayer, type SlidePlan } from "./slide-layout";
import { QUIZ_LETTERS } from "./slide-quiz";
import type { SlideVisual } from "./slide-templates";
import type { SlideModel, SlideTheme } from "./slide-types";

/**
 * Yangi maketlar — `quiz` (nazorat testi), `references` (adabiyotlar),
 * `answers` (test javoblari, izoh o'chiq bo'lganda).
 *
 * Uchalasi ham FAQAT `LAYOUT_KIT` dan foydalanadi — `slide-layout.ts`
 * ga qatnov yo'q, shuning uchun bu fayl o'sganda ham 2100 qatorlik
 * maket fayliga tegilmaydi.
 *
 * Rang qoidasi (`tests/themes.test.mts` da O'LCHANGAN juftliklar):
 * yorug' sahifada `text/bg`, `accentInk/bg`, `accentInk/surface`;
 * to'q sahifada (`dense`) `titleText/titleBg`, `titleMuted/titleBg`.
 * `accent` faqat TO'LDIRISH (chiziq, tasma, nuqta) — matn rangi
 * sifatida ishlatilmaydi, chunki uning kontrasti o'lchanmagan.
 */
/*
 * `LAYOUT_KIT` FAQAT chaqiruv vaqtida o'qiladi — modul darajasida
 * destrukturasiya qilinmaydi. `slide-layout.ts` ↔ bu fayl ESM sikli:
 * `slide-layout.ts` yuklanayotganda bu modul avval baholanadi va
 * `LAYOUT_KIT` hali TDZ da bo'ladi («Cannot access before initialization»
 * — 0b da aynan shu xato beshta test faylini yuklanmaydigan qilib qo'ydi).
 */

/** Chap va o'ng ustun chegaralari — `slide-layout.ts` dagi `hero-split` bilan bir xil. */
const PANEL_W = 5.15;
/** Kolontituldan yuqoridagi oxirgi foydali qator. */
const BOTTOM = 6.85;

function pageX() {
  return LAYOUT_KIT.M + 0.18;
}

/** Sahifa foni + chrome + sarlavha — yorug' maketlarning umumiy boshi. */
function lightHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, ctx: PlanCtx, textW = 12.1) {
  const { planHeading, pushChrome, W, H } = LAYOUT_KIT;
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  pushChrome(layers, theme, "full");
  planHeading(layers, s, theme, textW, pageX(), ctx.reserve);
}

/**
 * To'q sahifa boshi (`dense`).
 *
 * Sarlavha `planHeading` dan EMAS: u `theme.text` bilan yozadi, u esa
 * to'q fonda o'lchanmagan juft (`planTwoCol` dagi `dense` tarmog'ida ham
 * aynan shu sabab bilan qo'lda chiziladi).
 */
function denseHead(layers: SlideLayer[], s: SlideModel, theme: SlideTheme, ctx: PlanCtx, textW = 12.1) {
  const { fitSize, W, H } = LAYOUT_KIT;
  const x = pageX();
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.titleBg } });
  const titleBox: Box = { x, y: 0.34, w: textW - ctx.reserve, h: 0.7 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 22, 16),
    bold: true,
  });
  layers.push({ t: "rect", box: { x, y: 1.1, w: textW, h: 0.035 }, fill: { color: theme.accent } });
}

/** Ma'lumot kelmagan holat: maket buzilmasin — bandlar ro'yxati chiziladi. */
function asList(s: SlideModel, lines: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx, note?: string, srcLines?: Array<{f: "quiz", i: number, k: "q"} | {f: "bullets", i: number}>): SlidePlan {
  const { pushFooter, fitLines } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  lightHead(layers, s, theme, ctx);
  const x = pageX();
  const box = { x, y: 1.5, w: 12.1, h: note ? 4.85 : 5.35 };
  layers.push({
    t: "text",
    box,
    lines,
    bullets: true,
    color: theme.text,
    size: fitLines(lines, box, ctx.bodyType.bodyPt, ctx.bodyType.minPt, 10),
    paraSpace: 10,
    srcLines,
  });
  if (note) pushNote(layers, note, theme, x, 12.1, false);
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, false);
  return { bg: theme.bg, layers };
}

/** Manbalar ostidagi kichik izoh — ro'yxat qayerdan kelganini AYTADI. */
function pushNote(layers: SlideLayer[], note: string, theme: SlideTheme, x: number, w: number, dark: boolean) {
  layers.push({
    t: "text",
    box: { x, y: 6.5, w, h: 0.3 },
    text: note,
    color: dark ? theme.titleMuted : theme.muted,
    size: 12,
    italic: true,
    valign: "middle",
  });
}

// ─────────────────────────────────────────────────────────────── quiz

/**
 * Nazorat testi slaydi: savol + A/B/C/D variantlari.
 *
 * JAVOB SLAYDDA YO'Q — u `finalizeQuiz` orqali notiq izohiga, izohlar
 * o'chiq bo'lsa esa alohida `answers` slaydiga tushadi. Shuning uchun
 * `q.answer` bu yerda UMUMAN o'qilmaydi: to'g'ri javob indeksi
 * chizmaning birorta qatlamiga (rang, ramka, tartib) ta'sir qilmasligi
 * kerak, aks holda o'quvchi javobni ekrandan o'qib oladi.
 *
 * `s.quiz` da bir nechta savol bo'lsa shu slaydda BIRINCHISI chiziladi;
 * qolganlarini `finalizeQuiz` alohida slaydlarga ajratadi.
 */
export function planQuiz(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const q = s.quiz?.[0];
  const options = (q?.options ?? []).slice(0, QUIZ_LETTERS.length);
  if (!q || options.length < 2) {
    // Savol kelmadi — slayd bo'sh ramka bo'lib qolmasin.
    const lines = (s.quiz ?? []).map((item) => item.q).filter(Boolean);
    return asList(s, lines.length ? lines : s.bullets ?? [], theme, index, total, ctx);
  }
  if (visual === "dense") return quizDense(s, q.q, options, theme, index, total, ctx);
  if (visual === "cards") return quizCards(s, q.q, options, theme, index, total, ctx);
  if (visual === "timeline") return quizTimeline(s, q.q, options, theme, index, total, ctx);
  if (visual === "magazine") return quizMagazine(s, q.q, options, theme, index, total, ctx);
  if (visual === "hero-split") return quizHero(s, q.q, options, theme, index, total, ctx);
  return quizClassic(s, q.q, options, theme, index, total, ctx);
}

/** classic (va `lab`): savol yirik, ostida 2×2 karta, chap chekkasi aksent tasma. */
function quizClassic(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  lightHead(layers, s, theme, ctx);
  const x = pageX();
  const qBox: Box = { x, y: 1.5, w: 12.1, h: 1.25 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.text,
    size: fitSize(question, qBox, 26, 17),
    bold: true,
    src: { f: "quiz", i: 0, k: "q" },
  });
  const top = 3.0;
  const gap = 0.26;
  const cardW = (12.1 - gap) / 2;
  const cardH = (BOTTOM - top - gap) / 2;
  options.forEach((line, i) => {
    const cx = x + (i % 2) * (cardW + gap);
    const cy = top + Math.floor(i / 2) * (cardH + gap);
    layers.push({ t: "rect", box: { x: cx, y: cy, w: cardW, h: cardH }, fill: { color: theme.surface }, radius: 0.1 });
    layers.push({ t: "rect", box: { x: cx, y: cy, w: 0.09, h: cardH }, fill: { color: theme.accent }, radius: 0.04 });
    layers.push({
      t: "text",
      box: { x: cx + 0.26, y: cy + 0.2, w: 0.46, h: cardH - 0.4 },
      text: QUIZ_LETTERS[i],
      color: theme.accentInk,
      size: 20,
      bold: true,
      valign: "middle",
    });
    const textBox: Box = { x: cx + 0.84, y: cy + 0.2, w: cardW - 1.08, h: cardH - 0.4 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, false);
  return { bg: theme.bg, layers };
}

/** dense: to'q hisobot sahifasi — kartasiz, shaffof yo'lakchali 2×2. */
function quizDense(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  denseHead(layers, s, theme, ctx);
  const x = pageX();
  const qBox: Box = { x, y: 1.35, w: 12.1, h: 1.2 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.titleText,
    size: fitSize(question, qBox, 24, 16),
    bold: true,
    src: { f: "quiz", i: 0, k: "q" },
  });
  const top = 2.75;
  const gap = 0.2;
  const cardW = (12.1 - gap) / 2;
  const cardH = (BOTTOM - top - gap) / 2;
  options.forEach((line, i) => {
    const cx = x + (i % 2) * (cardW + gap);
    const cy = top + Math.floor(i / 2) * (cardH + gap);
    // To'q sahifada karta emas, shaffof yo'lakcha — `planTable` dagi naqsh.
    layers.push({ t: "rect", box: { x: cx, y: cy, w: cardW, h: cardH }, fill: { color: "#ffffff", alpha: 0.08 } });
    layers.push({ t: "rect", box: { x: cx, y: cy, w: 0.06, h: cardH }, fill: { color: theme.accent } });
    layers.push({
      t: "text",
      box: { x: cx + 0.22, y: cy + 0.18, w: 0.44, h: cardH - 0.36 },
      text: QUIZ_LETTERS[i],
      color: theme.titleText,
      size: 18,
      bold: true,
      valign: "middle",
    });
    const textBox: Box = { x: cx + 0.78, y: cy + 0.18, w: cardW - 1.02, h: cardH - 0.36 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.titleText,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, true);
  return { bg: theme.titleBg, layers };
}

/** cards: har variant tepasida aksent tasma bo'lgan mustaqil karta. */
function quizCards(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  lightHead(layers, s, theme, ctx);
  const x = pageX();
  const qBox: Box = { x, y: 1.5, w: 12.1, h: 1.3 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.text,
    size: fitSize(question, qBox, 25, 16),
    bold: true,
    src: { f: "quiz", i: 0, k: "q" },
  });
  const top = 3.05;
  const gap = 0.3;
  const cardW = (12.1 - gap) / 2;
  const cardH = (BOTTOM - top - gap) / 2;
  options.forEach((line, i) => {
    const cx = x + (i % 2) * (cardW + gap);
    const cy = top + Math.floor(i / 2) * (cardH + gap);
    layers.push({ t: "rect", box: { x: cx, y: cy, w: cardW, h: cardH }, fill: { color: theme.surface }, radius: 0.14 });
    layers.push({ t: "rect", box: { x: cx, y: cy, w: cardW, h: 0.1 }, fill: { color: theme.accent }, radius: 0.04 });
    layers.push({
      t: "text",
      box: { x: cx + 0.28, y: cy + 0.26, w: 0.5, h: 0.42 },
      text: QUIZ_LETTERS[i],
      color: theme.accentInk,
      size: 17,
      bold: true,
    });
    const textBox: Box = { x: cx + 0.28, y: cy + 0.76, w: cardW - 0.56, h: cardH - 0.94 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, false);
  return { bg: theme.bg, layers };
}

/** timeline: variantlar tik o'q bo'ylab — nuqta, harf, matn. */
function quizTimeline(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  lightHead(layers, s, theme, ctx);
  const x = pageX();
  const qBox: Box = { x, y: 1.45, w: 12.1, h: 1.05 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.text,
    size: fitSize(question, qBox, 23, 16),
    bold: true,
    src: { f: "quiz", i: 0, k: "q" },
  });
  const railX = x + 0.22;
  const top = 2.7;
  const n = Math.max(1, options.length);
  const rowH = (BOTTOM - top) / n;
  /*
   * Nuqta qator MATNI bilan bir markazda.
   *
   * Ilgari nuqta qatorning TEPASIGA (`y + 0.06`) qo'yilardi, matn esa
   * `valign: "middle"` bilan markazda chizilardi — PDF da har nuqta o'z
   * variantidan ~0.3 dyuym yuqorida turardi va o'q variantlar bilan
   * emas, ular orasidagi bo'shliq bilan hizalangandek ko'rinardi.
   */
  const rowMid = (y: number) => y + (rowH - 0.14) / 2;
  // O'q birinchi nuqtaning markazidan oxirgisinikigacha — `planTwoCol` naqshi.
  layers.push({
    t: "rect",
    box: { x: railX + 0.085, y: rowMid(top), w: 0.05, h: Math.max(0.05, (n - 1) * rowH) },
    fill: { color: theme.accent, alpha: 0.5 },
  });
  options.forEach((line, i) => {
    const y = top + i * rowH;
    layers.push({ t: "rect", box: { x: railX, y: rowMid(y) - 0.11, w: 0.22, h: 0.22 }, fill: { color: theme.accent }, radius: 0.11 });
    layers.push({
      t: "text",
      box: { x: railX + 0.42, y, w: 0.42, h: rowH - 0.14 },
      text: QUIZ_LETTERS[i],
      color: theme.accentInk,
      size: 16,
      bold: true,
      valign: "middle",
    });
    const textBox: Box = { x: railX + 0.96, y, w: 12.1 - (railX + 0.96 - x) - 0.1, h: rowH - 0.14 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, false);
  return { bg: theme.bg, layers };
}

/** magazine: tarqatma sahifa — karta yo'q, harf bosh harf (bukvitsa) bo'lib turadi. */
function quizMagazine(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize, W } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: LAYOUT_KIT.H }, fill: { color: theme.bg } });
  const x0 = 0.7;
  const magW = W - 1.4;
  const titleBox: Box = { x: x0, y: 0.5, w: magW - ctx.reserve, h: 0.95 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.text,
    size: fitSize(s.title, titleBox, 30, 20),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: x0, y: 1.6, w: magW, h: 0.045 }, fill: { color: theme.accent } });
  const qBox: Box = { x: x0, y: 1.85, w: magW, h: 1.15 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.text,
    size: fitSize(question, qBox, 24, 16),
    src: { f: "quiz", i: 0, k: "q" },
  });
  const top = 3.15;
  const divW = 0.035;
  const gap = 0.5;
  const colW = (magW - gap * 2 - divW) / 2;
  const rowH = (BOTTOM - top) / 2;
  layers.push({
    t: "rect",
    box: { x: x0 + colW + gap, y: top, w: divW, h: BOTTOM - top },
    fill: { color: theme.accent, alpha: 0.55 },
  });
  options.forEach((line, i) => {
    const cx = x0 + (i % 2) * (colW + gap * 2 + divW);
    const cy = top + Math.floor(i / 2) * rowH;
    layers.push({
      t: "text",
      box: { x: cx, y: cy + 0.05, w: 0.45, h: 0.6 },
      text: QUIZ_LETTERS[i],
      color: theme.accentInk,
      size: 22,
      bold: true,
    });
    const textBox: Box = { x: cx + 0.55, y: cy + 0.05, w: colW - 0.55, h: rowH - 0.3 };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, 18, 13),
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
    layers.push({ t: "rect", box: { x: cx, y: cy + rowH - 0.18, w: colW, h: 0.012 }, fill: { color: theme.accent, alpha: 0.3 } });
  });
  pushFooter(layers, s, theme, index, total, { x: x0, w: magW }, false);
  return { bg: theme.bg, layers };
}

/** hero-split: savol chap to'q panelda, variantlar o'ngda ustma-ust. */
function quizHero(s: SlideModel, question: string, options: string[], theme: SlideTheme, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize, W, H, M } = LAYOUT_KIT;
  const layers: SlideLayer[] = [];
  layers.push({ t: "rect", box: { x: 0, y: 0, w: W, h: H }, fill: { color: theme.bg } });
  layers.push({ t: "rect", box: { x: 0, y: 0, w: PANEL_W, h: H }, fill: { color: theme.titleBg } });
  const px = M + 0.05;
  const pw = PANEL_W - px - 0.45;
  const titleBox: Box = { x: px, y: 0.62, w: pw - ctx.reserve, h: 1.2 };
  layers.push({
    t: "text",
    box: titleBox,
    text: s.title,
    color: theme.titleText,
    size: fitSize(s.title, titleBox, 24, 16),
    bold: true,
    src: { f: "title" },
  });
  layers.push({ t: "rect", box: { x: px, y: 1.95, w: 1.2, h: 0.08 }, fill: { color: theme.accent } });
  const qBox: Box = { x: px, y: 2.25, w: pw, h: 3.6 };
  layers.push({
    t: "text",
    box: qBox,
    text: question,
    color: theme.titleText,
    size: fitSize(question, qBox, 22, 14),
    src: { f: "quiz", i: 0, k: "q" },
  });
  const rx = PANEL_W + 0.55;
  const rw = W - rx - 0.55;
  const top = 1.5;
  const n = Math.max(1, options.length);
  const rowH = (BOTTOM - top) / n;
  options.forEach((line, i) => {
    const y = top + i * rowH;
    const h = rowH - 0.18;
    layers.push({ t: "rect", box: { x: rx, y, w: rw, h }, fill: { color: theme.surface }, radius: 0.08 });
    layers.push({
      t: "text",
      box: { x: rx + 0.24, y, w: 0.44, h },
      text: QUIZ_LETTERS[i],
      color: theme.accentInk,
      size: 18,
      bold: true,
      valign: "middle",
    });
    const textBox: Box = { x: rx + 0.82, y, w: rw - 1.06, h };
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: theme.text,
      size: fitSize(line, textBox, ctx.bodyType.bodyPt, ctx.bodyType.minPt),
      valign: "middle",
      src: { f: "quiz", i: 0, k: "option", j: i },
    });
  });
  pushFooter(layers, s, theme, index, total, { x: rx, w: rw }, false);
  return { bg: theme.bg, layers };
}

// ───────────────────────────────────────────────────────── references

/** URL ni ko'rinadigan uzunlikka keltiradi: protokol va `www.` tashlanadi. */
export function shortSource(src: string): string {
  const t = String(src || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
  return t.length <= 60 ? t : `${t.slice(0, 59)}…`;
}

/**
 * Manba ro'yxati QAYERDAN kelgani.
 *
 * `applyResearchRefs` tadqiqot manbalarini `uri` bilan yozadi, ya'ni
 * har `source` haqiqiy havola bo'ladi. Model o'zidan yozgan manbada
 * havola bo'lmaydi (yoki uydirma nom bo'ladi) — bunday ro'yxat
 * «tekshirilmagan» deb belgilanadi, jimgina ishonchli ko'rinmaydi.
 */
function refsAreLive(refs: { title: string; source: string }[]): boolean {
  return refs.length > 0 && refs.every((r) => /^https?:\/\//i.test(r.source.trim()));
}

const NOTE_LIVE = "Manba: internet (Google Search)";
const NOTE_UNVERIFIED = "Tekshirilmagan ro‘yxat";

/**
 * Adabiyotlar slaydi: raqamlangan ro'yxat, har qatorda nom va havola.
 *
 * `refs` bo'sh bo'lsa model manbasiz yozgan — bandlar chiziladi va
 * ostidagi izoh buni AYTADI (uydirma havola ko'rsatilmaydi).
 */
export function planReferences(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const refs = (s.refs ?? []).filter((r) => r.title || r.source).slice(0, 6);
  if (!refs.length) return asList(s, s.bullets ?? [], theme, index, total, ctx, NOTE_UNVERIFIED);

  const dense = visual === "dense";
  const layers: SlideLayer[] = [];
  if (dense) denseHead(layers, s, theme, ctx);
  else lightHead(layers, s, theme, ctx);
  const x = pageX();
  const w = 12.1;
  const titleInk = dense ? theme.titleText : theme.text;
  const numInk = dense ? theme.titleText : theme.accentInk;
  const srcInk = dense ? theme.titleMuted : theme.muted;

  const top = dense ? 1.4 : 1.5;
  /*
   * Qator balandligi CHEKLANGAN (uzun ro'yxat cho'zilib ketmasin), lekin
   * qolgan bo'shliq tepa va pastga TENG bo'linadi.
   *
   * Ilgari qatorlar tepaga tizilardi: ikki manbali slaydda pastki ~3.5
   * dyuym bo'sh oq maydon bo'lib qolardi (PDF da ko'rindi — AUDIT-8 dagi
   * N-5 bilan bir xil naqsh).
   */
  const usable = 6.35 - top;
  const rowH = Math.min(1.2, usable / Math.max(1, refs.length));
  const startY = top + Math.max(0, (usable - rowH * refs.length) / 2);
  refs.forEach((ref, i) => {
    const y = startY + i * rowH;
    layers.push({
      t: "text",
      box: { x, y: y + 0.04, w: 0.46, h: Math.max(0.3, rowH * 0.5) },
      text: String(i + 1).padStart(2, "0"),
      color: numInk,
      size: 15,
      bold: true,
      align: "right",
    });
    const nameBox: Box = { x: x + 0.62, y: y + 0.02, w: w - 0.72, h: Math.max(0.3, rowH * 0.52) };
    layers.push({
      t: "text",
      box: nameBox,
      text: ref.title || shortSource(ref.source),
      color: titleInk,
      size: fitSize(ref.title || shortSource(ref.source), nameBox, 17, 12),
      bold: true,
      src: { f: "refs", i, k: "title" },
    });
    const srcBox: Box = { x: x + 0.62, y: y + rowH * 0.56, w: w - 0.72, h: Math.max(0.24, rowH * 0.36) };
    layers.push({
      t: "text",
      box: srcBox,
      text: shortSource(ref.source),
      color: srcInk,
      size: fitSize(shortSource(ref.source), srcBox, 13, 10),
      src: { f: "refs", i, k: "source" },
    });
    layers.push({
      t: "rect",
      box: { x, y: y + rowH - 0.06, w, h: 0.01 },
      fill: { color: dense ? theme.titleMuted : theme.accent, alpha: 0.3 },
    });
  });
  pushNote(layers, refsAreLive(refs) ? NOTE_LIVE : NOTE_UNVERIFIED, theme, x, w, dense);
  pushFooter(layers, s, theme, index, total, { x, w }, dense);
  return { bg: dense ? theme.titleBg : theme.bg, layers };
}

// ─────────────────────────────────────────────────────────── answers

/**
 * Kalit rejimlari — javoblar SONIGA qarab (X-4).
 *
 * `hero` (1–2 javob): kalit varag'i bo'lib chiziladi — karta maydonni
 * bo'lib oladi, matn markazda va yirik. `ANSWERS_ONE_COL_MAX` gacha
 * bitta ustun (kalit tabiiy holda PASTGA o'qiladi), undan ortig'i ikki
 * ustunga bo'linadi (10 savol 5 qatorli ikki ustunga bemalol sig'adi).
 */
const ANSWERS_HERO_MAX = 2;
const ANSWERS_ONE_COL_MAX = 6;
/** Kalitda ko'rsatiladigan eng ko'p javob (formadagi eng katta test — 10 ta). */
const ANSWERS_MAX = 12;
/**
 * Shrift SHIFTI (poli auditoriyadan — `ctx.bodyType.minPt`).
 *
 * Ikkala son PDF da ko'z bilan tanlangan: 60 pt li yirik kalit 9.4″
 * kartaning uchdan bir qismini ham egallamasdi va karta bo'sh
 * ko'rinardi. Kalit qatori qisqa («1 — B», 5–6 belgi), shuning uchun
 * bunday shrift ham bemalol sig'adi — `fitSize` uzun qator kelsa uni
 * o'zi kichraytiradi.
 */
const ANSWERS_PT_HERO = 96;
const ANSWERS_PT_ROW = 48;
/** Karta balandligining shriftga aylanish koeffitsienti — qator bo'yidan o'lchangan. */
const ANSWERS_PT_RATIO = 0.42;

/**
 * Test javoblari — «1 — B», «2 — D».
 *
 * O'LCHAM JAVOBLAR SONIDAN kelib chiqadi. Jonli dekada (10 slayd,
 * 7 blok) rejaga bitta savol sig'di va kalitda BITTA qator qoldi:
 * qator qat'iy 1.15″ qutida, maydon o'rtasida chizilardi — 13.3×7.5″
 * slaydning ~86% i bo'sh oq maydon bo'lib qolardi (AUDIT-8 N-3/N-5
 * naqshining aynan o'zi). Endi qatorlar maydonni QOLDIQSIZ bo'lib
 * oladi (`rowH = usable / rows`), 1–2 javob esa yirik kalit kartasiga
 * aylanadi. Matn qatlamlari qamragan balandlik (slayd balandligiga
 * nisbatan) — o'lchangan: 1 javob 14% → 63%, 2 javob 27% → 56%,
 * 3 javob 41% → 60%, 10 javob 63% → 59%. Ya'ni qamrov endi javoblar
 * sonidan deyarli MUSTAQIL (o'lchov `tests/slide-quiz.test.mts` da
 * qulflangan).
 *
 * Shrift karta bo'yiga qarab tanlanadi, lekin `fitSize` uni AUDITORIYA
 * polidan (`ctx.bodyType.minPt`: ma'ruzada 15, maktabda 20–24 pt)
 * pastga tushira olmaydi — Slide Law shu polda.
 */
export function planAnswers(s: SlideModel, theme: SlideTheme, visual: SlideVisual, index: number, total: number, ctx: PlanCtx): SlidePlan {
  const { pushFooter, fitSize } = LAYOUT_KIT;
  const items = (s.bullets ?? []).filter(Boolean).slice(0, ANSWERS_MAX);
  if (!items.length) return asList(s, [], theme, index, total, ctx);

  const dense = visual === "dense";
  const layers: SlideLayer[] = [];
  if (dense) denseHead(layers, s, theme, ctx);
  else lightHead(layers, s, theme, ctx);
  const x = pageX();
  const ink = dense ? theme.titleText : theme.text;

  const n = items.length;
  const hero = n <= ANSWERS_HERO_MAX;
  const cols = n > ANSWERS_ONE_COL_MAX ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const gap = 0.3;
  // Bitta ustun kalitni O'QILADIGAN kenglikda ushlab turadi: yirik
  // kartada matn markazda, oddiy qatorda esa chap chekkadan boshlanadi.
  const colW = cols === 2 ? (12.1 - gap) / 2 : hero ? 10.2 : 8.2;
  const x0 = x + (12.1 - (colW * cols + gap * (cols - 1))) / 2;
  const top = dense ? 1.45 : 1.55;
  const usable = BOTTOM - top;
  /*
   * Qator balandligi endi CHEKLANMAYDI: qolgan bo'shliq qatorlarga
   * to'liq taqsimlanadi. Ilgari `Math.min(1.15, …)` shifti bor edi va
   * kam javobli kalit slayd o'rtasidagi kichkina karta bo'lib qolardi
   * (markazlashtirish bo'sh maydonni faqat SURARDI, kamaytirmasdi).
   */
  const rowH = usable / rows;
  const vgap = Math.min(0.26, rowH * 0.16);
  items.forEach((line, i) => {
    const c = Math.floor(i / rows);
    const r = i % rows;
    const cx = x0 + c * (colW + gap);
    const y = top + r * rowH;
    const h = rowH - vgap;
    layers.push({
      t: "rect",
      box: { x: cx, y, w: colW, h },
      fill: dense ? { color: "#ffffff", alpha: 0.08 } : { color: theme.surface },
      radius: hero ? 0.1 : 0.06,
    });
    // Yirik kartada aksent tasma TEPADA (`quizCards` naqshi) — markazlashgan
    // matnning yonidagi ingichka chiziq kartani qiyshiq ko'rsatardi.
    if (hero) layers.push({ t: "rect", box: { x: cx, y, w: colW, h: 0.1 }, fill: { color: theme.accent }, radius: 0.04 });
    else layers.push({ t: "rect", box: { x: cx, y, w: 0.07, h }, fill: { color: theme.accent } });
    const textBox: Box = hero
      ? { x: cx + 0.4, y: y + 0.16, w: colW - 0.8, h: h - 0.28 }
      : { x: cx + 0.32, y, w: colW - 0.5, h };
    const minPt = ctx.bodyType.minPt;
    const basePt = Math.max(minPt, Math.min(hero ? ANSWERS_PT_HERO : ANSWERS_PT_ROW, Math.round(h * 72 * ANSWERS_PT_RATIO)));
    layers.push({
      t: "text",
      box: textBox,
      text: line,
      color: ink,
      size: fitSize(line, textBox, basePt, minPt),
      bold: true,
      valign: "middle",
      src: { f: "bullets", i },
      ...(hero ? { align: "center" as const } : {}),
    });
  });
  pushFooter(layers, s, theme, index, total, { x, w: 12.1 }, dense);
  return { bg: dense ? theme.titleBg : theme.bg, layers };
}
