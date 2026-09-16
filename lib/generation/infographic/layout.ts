/**
 * INFOGRAFIKA MAKETI (AUDIT-21 WP-C) — `layoutInfographic(spec)`.
 *
 * SOF va IZOMORF: DOM, `sharp`, `fs` yoki `AcademicDoc` importi YO'Q.
 * Kirish — `InfographicSpec` (unda `size` va `language` ham bor, R0
 * ATAYLAB shunday qildi), chiqish — rangsiz GEOMETRIYA. Ranglarni
 * `svg.ts` ROL bo'yicha beradi: maket palitrani BILMAYDI, shuning
 * uchun palitra almashganda geometriya bitini ham o'zgartirmaydi
 * (`tests/infographic-layout` shuni qulflaydi).
 *
 * BIRLIK — MILLIMETR. `figures/layout.ts` px @ 96 dpi da ishlaydi,
 * chunki u DOCX ichidagi 160 mm li sxema; plakat esa QOG'OZ: hisobot
 * §3 jadvali chekka 12 mm, ikon 14 mm, karta 85×50 mm deb yozilgan va
 * `figurePng({ widthMm })` ham mm kutadi. Oraliq birlikka o'girish
 * faqat xato manbai bo'lardi. Shrift pt da e'lon qilinadi va `PT`
 * ko'paytuvchisi bilan mm ga o'tadi (`textWidth` — em asosida, ya'ni
 * birlikka BEFARQ: mm bersang mm qaytaradi).
 *
 * A3 — A4 ning MASSHTABI (k = 297/210 ≈ 1.414): chekka, shrift, ikon,
 * oraliq — hammasi bitta ko'paytuvchi bilan. Bu «A3 da ko'proq matn»
 * emas, «A3 da o'sha plakat kattaroq» degani; plakat devorga osiladi va
 * uzoqroqdan o'qiladi, ya'ni shrift ham kattalashishi KERAK.
 *
 * `overflow` — hisobotning `noOverflow` qoidasi manbasi: matn kartaga
 * sig'masa maket uni «…» bilan kesadi (plakat baribir chiqadi) va blok
 * id sini shu ro'yxatga qo'yadi. Dvigatel (`engine.ts`) ro'yxat bo'sh
 * bo'lmasa modeldan BIR MARTA qisqaroq matn so'raydi.
 */
import { textWidth, wrapToWidth } from "../figures/model";
import { INFOGRAPHIC_LIMITS, SIZE_MM, iconOf, type InfographicBlock, type InfographicSize, type InfographicSpec, type InfographicTypeId } from "./types";

/* ══════════════════════════ chiqish shakli ══════════════════════════ */

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Shakl ROLI — `svg.ts` rangni shu nomdan tanlaydi. Maketda rang yo'q:
 * hisobotning `contrast` bandi palitralarni statik qulflagan, ya'ni
 * «qaysi rang qayerda» qarori BITTA joyda (`svg.ts ROLE_FILL`) turishi
 * kerak, aks holda yangi maket eski juftlikni buzib qo'yardi.
 */
export type ShapeRole =
  | "page"
  | "header"
  | "card"
  | "cardTint"
  | "columnTint"
  | "columnHead"
  | "columnHeadAlt"
  | "badge"
  | "iconRing"
  | "rail"
  | "dot"
  | "divider"
  | "rule"
  | "root"
  | "connector"
  | "flow";

export type InfographicShape =
  | ({ k: "rect"; role: ShapeRole; rx?: number } & Rect)
  | { k: "circle"; role: ShapeRole; cx: number; cy: number; r: number }
  | { k: "line"; role: ShapeRole; x1: number; y1: number; x2: number; y2: number; w: number; arrow?: boolean; dash?: boolean }
  | { k: "icon"; role: "icon"; name: string; x: number; y: number; size: number };

export type TextRole = "title" | "subtitle" | "heading" | "body" | "stat" | "statLabel" | "badge" | "when" | "source" | "columnHead" | "columnHeadAlt" | "root";

export type InfographicText = {
  x: number;
  /** BIRINCHI qatorning baza chizig'i (mm). */
  y: number;
  lines: string[];
  /** Shrift o'lchami mm (pt × `PT`). */
  size: number;
  /** Qator oralig'i mm. */
  lh: number;
  bold?: boolean;
  anchor?: "start" | "middle" | "end";
  role: TextRole;
};

export type InfographicLayout = {
  type: InfographicTypeId;
  size: InfographicSize;
  /** Sahifa o'lchami mm (portret). */
  mm: { w: number; h: number };
  /** Matn yo'nalishi — RTL tillarda butun maket ko'zguda aks etadi. */
  rtl: boolean;
  shapes: InfographicShape[];
  texts: InfographicText[];
  /** Blok id → karta qutisi (test va kelgusi tahrir uchun). */
  boxes: (Rect & { id: string })[];
  /** Matni sig'magan (kesilgan) blok id lari — `noOverflow` qoidasi. */
  overflow: string[];
};

/* ══════════════════════════ o'lchamlar ══════════════════════════ */

/** 1 pt = 25.4/72 mm. */
export const PT = 25.4 / 72;

/** Qator oralig'i (shriftga nisbatan) — plakat matni zich emas. */
export const LINE_K = 1.28;

/**
 * A4 uchun asos o'lchamlar (mm va pt), hisobot §3 jadvalidan.
 * A3 da hammasi `k` ga ko'paytiriladi.
 */
const BASE = {
  margin: INFOGRAPHIC_LIMITS.marginMm, // 12
  gap: 6,
  headerPad: 9,
  headerGap: 8,
  cardPad: 5,
  cardRx: 3,
  iconMm: INFOGRAPHIC_LIMITS.iconMm, // 14
  /* shriftlar (pt) */
  titlePt: 28,
  subtitlePt: 13,
  headingPt: 13,
  bodyPt: 10.5,
  statPt: 26,
  statLabelPt: 9.5,
  badgePt: 13,
  whenPt: 11,
  sourcePt: 8.5,
  columnHeadPt: 12,
} as const;

type Scale = ReturnType<typeof scaleOf>;

function scaleOf(size: InfographicSize) {
  const page = SIZE_MM[size];
  const k = page.width / SIZE_MM.A4.width;
  const mm = (v: number) => v * k;
  const pt = (v: number) => v * k * PT;
  return {
    k,
    page,
    margin: mm(BASE.margin),
    gap: mm(BASE.gap),
    headerPad: mm(BASE.headerPad),
    headerGap: mm(BASE.headerGap),
    cardPad: mm(BASE.cardPad),
    cardRx: mm(BASE.cardRx),
    iconR: mm(BASE.iconMm) / 2,
    title: pt(BASE.titlePt),
    subtitle: pt(BASE.subtitlePt),
    heading: pt(BASE.headingPt),
    body: pt(BASE.bodyPt),
    stat: pt(BASE.statPt),
    statLabel: pt(BASE.statLabelPt),
    badge: pt(BASE.badgePt),
    when: pt(BASE.whenPt),
    source: pt(BASE.sourcePt),
    columnHead: pt(BASE.columnHeadPt),
  };
}

/* ══════════════════════════ til ══════════════════════════ */

/**
 * Plakatdagi YAGONA tayyor qatorlar: manba prefiksi va sabab/natija
 * ustun sarlavhalari. Boshqa hamma narsa modeldan keladi.
 *
 * Uch til — hujjat skeletlari bilan AYNI qamrov (`lib/languages.ts`
 * TARGET_LANGUAGES); noma'lum til inglizchaga tushadi, o'zbekchaga
 * emas: ruscha plakatga o'zbekcha «Manba:» yozilgani kabi xato
 * boshqa tillarda ham takrorlanmasin.
 */
const LABELS: Record<string, { source: string; cause: string; effect: string }> = {
  uz: { source: "Manba:", cause: "Sabablar", effect: "Natijalar" },
  ru: { source: "Источник:", cause: "Причины", effect: "Следствия" },
  en: { source: "Source:", cause: "Causes", effect: "Effects" },
};

export function infographicLabels(language: string) {
  return LABELS[String(language ?? "").toLowerCase()] ?? LABELS.en;
}

/** O'ngdan chapga yoziladigan tillar — butun maket ko'zguda aks etadi. */
const RTL = new Set(["ar", "fa", "he", "ur", "ps"]);
export const isRtl = (language: string): boolean => RTL.has(String(language ?? "").toLowerCase());

/* ══════════════════════════ matn o'lchash ══════════════════════════ */

/** Cheksiz o'rash — nechta qator KERAKLIGINI bilish uchun. */
const WRAP_MAX = 64;

export type Fitted = { lines: string[]; clipped: boolean };

/**
 * Kenglik bo'yicha o'rash + SIG'DI/SIG'MADI bayrog'i.
 *
 * `wrapToWidth` (AUDIT-18 WP-B) allaqachon «…» bilan kesadi, lekin
 * KESGANINI aytmaydi. Hisobotning `noOverflow` bandiga esa aynan shu
 * fakt kerak, shuning uchun o'rash ikki marta chaqiriladi: avval
 * chegarasiz (haqiqiy qator soni), keyin chegara bilan (chiziladigan
 * matn). Ikkinchi chaqiruv arzon — matn ≤40 so'z.
 */
export function fit(text: string, maxW: number, font: number, maxLines: number): Fitted {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return { lines: [], clipped: false };
  if (maxLines < 1 || maxW <= 0) return { lines: [], clipped: true };
  const full = wrapToWidth(s, maxW, font, WRAP_MAX);
  if (full.length <= maxLines) return { lines: full, clipped: false };
  return { lines: wrapToWidth(s, maxW, font, maxLines), clipped: true };
}

/**
 * Bitta blok matni ko'pi bilan shuncha qator — `blockTextWordsMax` (40)
 * chegarasiga mos tabiiy shift. Chegarasiz qoldirilsa uzun matnli bitta
 * blok butun plakatni egallab, qolganlarini nolga siqardi.
 */
const BODY_LINES_MAX = 8;

/** Karta chizish sozlamalari — `card()` va `cardNeed()` bir xil o'qiydi. */
export type CardOpts = { iconR?: number; tint?: boolean; headLines?: number };

/** Nechta qator sig'adi (balandlik → qator soni). */
const linesIn = (h: number, lh: number): number => Math.max(0, Math.floor((h + lh * 0.12) / lh));

/* ══════════════════════════ quruvchi ══════════════════════════ */

/**
 * Maket quruvchisi — shakl/matn to'plovchi va `overflow` hisobchisi.
 * Har tur funksiyasi shu obyekt bilan ishlaydi, natijada «karta
 * chizish» mantig'i (ikon halqasi, sarlavha, tana matni) BIR MARTA
 * yoziladi va yetti turda bir xil ko'rinadi.
 */
class Builder {
  readonly shapes: InfographicShape[] = [];
  readonly texts: InfographicText[] = [];
  readonly boxes: (Rect & { id: string })[] = [];
  readonly overflow: string[] = [];

  constructor(readonly s: Scale) {}

  rect(role: ShapeRole, r: Rect, rx?: number) {
    this.shapes.push({ k: "rect", role, ...r, ...(rx === undefined ? {} : { rx }) });
  }

  circle(role: ShapeRole, cx: number, cy: number, r: number) {
    this.shapes.push({ k: "circle", role, cx, cy, r });
  }

  line(role: ShapeRole, x1: number, y1: number, x2: number, y2: number, w: number, o: { arrow?: boolean; dash?: boolean } = {}) {
    this.shapes.push({ k: "line", role, x1, y1, x2, y2, w, ...o });
  }

  text(role: TextRole, x: number, y: number, f: Fitted, size: number, o: { bold?: boolean; anchor?: InfographicText["anchor"] } = {}) {
    if (!f.lines.length) return;
    this.texts.push({ x, y, lines: f.lines, size, lh: size * LINE_K, role, ...o });
  }

  /** Sig'magan blokni belgilaydi (takrorlanmaydi). */
  mark(id: string, clipped: boolean) {
    if (clipped && !this.overflow.includes(id)) this.overflow.push(id);
  }

  /** Ikon halqasi: rangli doira + ichida markazlashgan Tabler chizmasi. */
  iconRing(name: string, cx: number, cy: number, r: number) {
    this.circle("iconRing", cx, cy, r);
    // Chizma doiraning 64 % i — Tabler ikonining o'z «havo» nisbati.
    const g = r * 2 * 0.64;
    this.shapes.push({ k: "icon", role: "icon", name: iconOf(name), x: cx - g / 2, y: cy - g / 2, size: g });
  }

  /**
   * STANDART KARTA — yetti turning oltitasi shundan quriladi.
   *
   * Tartib: ikon halqasi (chap yuqori) + sarlavha uning o'ng yonida,
   * tana matni ikkalasining ostida to'liq kenglikda. Sarlavha ikon
   * bilan bir qatorda turgani uchun tor kartada ham ikki qatorga
   * sig'adi, tana esa butun kenglikni oladi.
   *
   * Mazmun karta ichida VERTIKAL MARKAZDA: qutini maket TABIIY
   * balandlikdan kattaroq bergan bo'lishi mumkin (`fitRows` qolgan
   * joyni qatorlarga bo'lib beradi), va o'shanda matn yuqoriga
   * yopishib, karta ostida katta bo'sh maydon qolardi — ko'z sinovida
   * (7 namuna) aynan shu eng ko'zga tashlanadigan nuqson bo'ldi.
   */
  card(b: InfographicBlock, box: Rect, o: CardOpts = {}) {
    const s = this.s;
    const pad = s.cardPad;
    const iconR = o.iconR ?? s.iconR;
    this.rect(o.tint ? "cardTint" : "card", box, s.cardRx);
    this.boxes.push({ id: b.id, ...box });

    const headDx = pad + iconR * 2 + pad * 0.8;
    const head = fit(b.heading, box.w - pad - headDx, s.heading, o.headLines ?? 2);
    const headH = head.lines.length * s.heading * LINE_K;
    // Yuqori zona — ikon va sarlavhadan qaysi biri balandroq bo'lsa o'sha.
    const topH = Math.max(iconR * 2, headH);
    const bodyLH = s.body * LINE_K;
    const bodyMax = Math.min(BODY_LINES_MAX, linesIn(box.h - pad * 2 - topH - pad * 0.6, bodyLH));
    const body = fit(b.text, box.w - pad * 2, s.body, bodyMax);
    const contentH = topH + (body.lines.length ? pad * 0.6 + body.lines.length * bodyLH : 0);
    const top = box.y + Math.max(pad, (box.h - contentH) / 2);

    const iconCx = box.x + pad + iconR;
    const iconCy = top + topH / 2;
    this.iconRing(b.icon, iconCx, iconCy, iconR);
    this.text("heading", box.x + headDx, iconCy - headH / 2 + s.heading * 0.86, head, s.heading, { bold: true, anchor: "start" });
    this.text("body", box.x + pad, top + topH + pad * 0.6 + s.body * 0.86, body, s.body, { anchor: "start" });
    this.mark(b.id, head.clipped || body.clipped);
  }
}

/**
 * Kartaning TABIIY balandligi — `card()` bilan AYNI arifmetika.
 *
 * Ikki funksiya bir xil formulani takrorlaydi, chunki o'lchash
 * CHIZISHDAN OLDIN kerak: maket avval hamma kartani o'lchaydi, keyin
 * qatorlarni taqsimlaydi va shundan keyingina chizadi. Formula
 * ajralib ketmasligi uchun ikkalasi ham `topH`/`bodyLH` ni bir xil
 * nomlar bilan hisoblaydi va `tests/infographic-layout` «tabiiy
 * balandlik chizilgan mazmundan kichik emas» bandi bilan qulflangan.
 */
function cardNeed(s: Scale, b: InfographicBlock, w: number, o: CardOpts = {}): number {
  const pad = s.cardPad;
  const iconR = o.iconR ?? s.iconR;
  const headDx = pad + iconR * 2 + pad * 0.8;
  const head = fit(b.heading, w - pad - headDx, s.heading, o.headLines ?? 2);
  const topH = Math.max(iconR * 2, head.lines.length * s.heading * LINE_K);
  const body = fit(b.text, w - pad * 2, s.body, BODY_LINES_MAX);
  return pad * 2 + topH + (body.lines.length ? pad * 0.6 + body.lines.length * s.body * LINE_K : 0);
}

/* ══════════════════════════ shapka / poyabzal ══════════════════════════ */

type Frame = { content: Rect };

function header(bd: Builder, spec: InfographicSpec): number {
  const s = bd.s;
  const W = s.page.width;
  const inner = W - s.margin * 2;
  const title = fit(spec.title, inner, s.title, 2);
  const sub = spec.subtitle ? fit(spec.subtitle, inner, s.subtitle, 1) : { lines: [], clipped: false };
  const titleH = title.lines.length * s.title * LINE_K;
  const subH = sub.lines.length * s.subtitle * LINE_K;
  const h = s.headerPad * 2 + titleH + (subH ? subH + s.headerPad * 0.25 : 0);

  bd.rect("header", { x: 0, y: 0, w: W, h });
  bd.text("title", W / 2, s.headerPad + s.title * 0.86, title, s.title, { bold: true, anchor: "middle" });
  if (subH) bd.text("subtitle", W / 2, s.headerPad + titleH + s.headerPad * 0.25 + s.subtitle * 0.86, sub, s.subtitle, { anchor: "middle" });
  return h;
}

function footer(bd: Builder, spec: InfographicSpec): number {
  const s = bd.s;
  const src = String(spec.source ?? "").trim();
  if (!src) return 0;
  const W = s.page.width;
  const H = s.page.height;
  const label = infographicLabels(spec.language).source;
  const line = `${label} ${src}`;
  const y = H - s.margin;
  bd.line("rule", s.margin, y - s.source * 1.9, W - s.margin, y - s.source * 1.9, s.k * 0.25);
  bd.text("source", s.margin, y - s.source * 0.3, fit(line, W - s.margin * 2, s.source, 1), s.source, { anchor: "start" });
  return s.source * 2.6 + s.gap;
}

function frameOf(bd: Builder, spec: InfographicSpec): Frame {
  const s = bd.s;
  bd.rect("page", { x: 0, y: 0, w: s.page.width, h: s.page.height });
  const headH = header(bd, spec);
  const footH = footer(bd, spec);
  const top = headH + s.headerGap;
  return {
    content: {
      x: s.margin,
      y: top,
      w: s.page.width - s.margin * 2,
      h: s.page.height - s.margin - footH - top,
    },
  };
}

/* ══════════════════════════ panjara ══════════════════════════ */

/** Ustun soni: ≤3 blok — bitta ustun, aks holda ikkita (hisobot §3). */
export function columnsFor(count: number): number {
  return count <= INFOGRAPHIC_LIMITS.oneColumnMaxBlocks ? 1 : 2;
}

/**
 * Blok indekslari → qatorlar. Ikki ustunli panjarada TOQ qolgan oxirgi
 * blok yolg'iz qatorga tushadi va `cellsOf` unga BUTUN kenglikni
 * beradi: 5 blokli plakatda oxirgi karta chap ustunda yolg'iz turib,
 * o'ng tomonda katta bo'shliq qoldirardi (ko'z sinovi, `list` namunasi).
 */
export function rowsOf(n: number, cols: number): number[][] {
  if (cols <= 1) return Array.from({ length: n }, (_, i) => [i]);
  const rows: number[][] = [];
  for (let i = 0; i < n; i += cols) rows.push(Array.from({ length: Math.min(cols, n - i) }, (_, j) => i + j));
  return rows;
}

/**
 * Tabiiy balandliklar → qator balandliklari, yuqori chekinish va QATOR
 * ORALIG'I.
 *
 * Qolgan bo'sh joy KARTALARGA emas, ORALIQQA beriladi (`growMax` 1.15 —
 * atigi bir oz «havo»). Ko'z sinovi (7 namuna, ikkinchi aylanish) buni
 * aynan shu tartibda ko'rsatdi: kartani mazmunidan ikki barobar
 * cho'zish uning ICHIDA katta bo'sh maydon qoldiradi, oraliqni
 * kengaytirish esa plakatga tartibli, «nafas oladigan» ko'rinish beradi.
 *
 * Uch holat:
 *   • kerakli joy mavjuddan KO'P — qatorlar PROPORSIONAL siqiladi
 *     (matni ko'p blok ko'proq joy saqlab qoladi) va matn kesiladi
 *     (`overflow`);
 *   • kerakli joy mavjuddan KAM — kartalar `growMax` gacha cho'ziladi,
 *     qolgani oraliqlarga (yuqori, oraliq, quyi) teng bo'linadi; oraliq
 *     `gap` ning 6 baravaridan oshmaydi, ortig'i guruhni markazga
 *     suradi;
 *   • aynan teng — hech narsa o'zgarmaydi.
 */
export function fitRows(avail: number, needs: number[], gap: number, growMax = 1.15): { heights: number[]; top: number; gap: number } {
  const n = needs.length;
  if (!n) return { heights: [], top: 0, gap };
  const inner = avail - gap * (n - 1);
  const want = needs.reduce((a, b) => a + b, 0);
  const g = want > 0 ? Math.min(inner / want, growMax) : 1;
  const heights = needs.map((h) => Math.max(0, h * g));
  const slack = avail - heights.reduce((a, b) => a + b, 0);
  if (slack <= gap * (n - 1)) return { heights, top: 0, gap };
  const each = Math.min(gap * 6, slack / (n + 1));
  const rest = slack - each * (n - 1);
  return { heights, top: Math.max(0, rest / 2), gap: each };
}

/** Qator/ustun panjarasi → qutilar (blok tartibida). */
function cellsOf(area: Rect, rows: number[][], cols: number, colGap: number, gap: number, heights: number[], top: number): Rect[] {
  const colW = (area.w - colGap * (cols - 1)) / cols;
  const out: Rect[] = [];
  let y = area.y + top;
  rows.forEach((row, r) => {
    row.forEach((idx, c) => {
      // Yolg'iz qolgan oxirgi karta butun kenglikni oladi.
      const w = row.length === 1 && cols > 1 ? area.w : colW;
      out[idx] = { x: area.x + c * (colW + colGap), y, w, h: heights[r] };
    });
    y += heights[r] + gap;
  });
  return out;
}

/**
 * Panjara: bloklarni o'lchaydi, qatorlarni taqsimlaydi va qutilarni
 * qaytaradi. `list`, `stat` va `map-structure` shundan foydalanadi.
 */
function gridNeeds(s: Scale, area: Rect, blocks: InfographicBlock[], cols: number, need: (b: InfographicBlock, w: number) => number): number[] {
  const colW = (area.w - s.gap * (cols - 1)) / cols;
  return rowsOf(blocks.length, cols).map((row) => Math.max(...row.map((i) => need(blocks[i], row.length === 1 && cols > 1 ? area.w : colW))));
}

/**
 * `align: "top"` — guruh markazlashtirilmaydi.
 *
 * Tuzilma (`map-structure`) uchun kerak: u katakchalarni SHOX bilan
 * bog'laydi, markazlashtirish esa shoxdan katakchagacha uzun bo'sh
 * chiziq cho'zardi (ko'z sinovi, uchinchi aylanish). U yerda butun
 * daraxt — ildiz, shox va katakchalar — BIRGA suriladi.
 */
function gridBoxes(
  s: Scale,
  area: Rect,
  blocks: InfographicBlock[],
  cols: number,
  need: (b: InfographicBlock, w: number) => number,
  o: { align?: "center" | "top"; growMax?: number } = {},
): Rect[] {
  const rows = rowsOf(blocks.length, cols);
  const r = fitRows(area.h, gridNeeds(s, area, blocks, cols, need), s.gap, o.growMax);
  return cellsOf(area, rows, cols, s.gap, r.gap, r.heights, o.align === "top" ? 0 : r.top);
}

/** Bitta ustundagi n ta quti — tabiiy balandlik bo'yicha. */
function stackBoxes(s: Scale, area: Rect, needs: number[], gap = s.gap): Rect[] {
  const r = fitRows(area.h, needs, gap);
  const out: Rect[] = [];
  let y = area.y + r.top;
  r.heights.forEach((h) => {
    out.push({ x: area.x, y, w: area.w, h });
    y += h + r.gap;
  });
  return out;
}

/* ══════════════════════════ turlar ══════════════════════════ */

/** RO'YXAT — mustaqil bandlar, ustunli kartalar. */
function drawList(bd: Builder, blocks: InfographicBlock[], area: Rect) {
  const boxes = gridBoxes(bd.s, area, blocks, columnsFor(blocks.length), (b, w) => cardNeed(bd.s, b, w));
  blocks.forEach((b, i) => bd.card(b, boxes[i]));
}

/**
 * JARAYON — raqamli zanjir. Bosqichlar `order` bo'yicha tartiblanadi
 * (model tartibni buzib yuborsa ham plakat to'g'ri chiqsin), badge
 * yo'lagi chapda, o'q qo'shni badge lar orasida.
 */
function drawProcess(bd: Builder, blocks: InfographicBlock[], area: Rect) {
  const s = bd.s;
  const ordered = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const badgeR = s.iconR * 0.62;
  const lane = badgeR * 2;
  const gapV = s.gap * 1.4;
  const cardArea: Rect = { x: area.x + lane + s.gap, y: area.y, w: area.w - lane - s.gap, h: area.h };
  const opts = { iconR: s.iconR * 0.78 };
  const rows = stackBoxes(s, cardArea, ordered.map((b) => cardNeed(s, b, cardArea.w, opts)), gapV);

  ordered.forEach((b, i) => {
    const box = rows[i];
    bd.card(b, box, opts);
    const cx = area.x + badgeR;
    const cy = box.y + badgeR + s.cardPad;
    bd.circle("badge", cx, cy, badgeR);
    bd.text("badge", cx, cy + s.badge * 0.35, { lines: [String(b.order ?? i + 1)], clipped: false }, s.badge, { bold: true, anchor: "middle" });
    if (i < ordered.length - 1) {
      // O'q badge chetidan keyingi badge chetigacha; uchi doiraga
      // tegib turmasin deb ikki tomondan 0.8 mm bo'shliq qoldiriladi.
      const air = s.k * 0.8;
      bd.line("flow", cx, cy + badgeR + air, cx, rows[i + 1].y + s.cardPad - air, s.k * 1.1, { arrow: true });
    }
  });
}

/**
 * TAQQOSLASH — ikki ustun, juftlar bir qatorda.
 *
 * Ustun sarlavhalari `subtitle` dan olinadi: prompt modeldan uni
 * «Chap — O'ng» ko'rinishida so'raydi (`prompts.ts`). Ajratuvchi
 * topilmasa sarlavha tasmasi CHIZILMAYDI va ost sarlavha shapkada
 * qoladi — plakat baribir to'g'ri, faqat ustun nomlarisiz.
 */
export function compareHeads(subtitle: string | undefined): [string, string] | null {
  const s = String(subtitle ?? "").trim();
  const m = /^(.{1,40}?)\s*(?:—|–|—|\svs\.?\s|\/)\s*(.{1,40})$/iu.exec(s);
  if (!m) return null;
  const a = m[1].trim();
  const b = m[2].trim();
  return a && b ? [a, b] : null;
}

/**
 * Ikki ustun sarlavha tasmasi.
 *
 * KARTALARDAN KEYIN chiziladi va `y` ni birinchi qatordan oladi:
 * tasmani mazmun maydonining tepasiga qotirib qo'yilsa, `fitRows`
 * kartalar guruhini markazga surganda tasma bilan birinchi karta
 * orasida 40 mm bo'sh joy qolardi (ko'z sinovi, `cause-effect`).
 */
function columnHeads(bd: Builder, x0: number, x1: number, colW: number, y: number, labels: [string, string]) {
  const s = bd.s;
  const hh = s.columnHead * 2.4;
  // Ikki tasma — IKKI QULFLANGAN JUFTLIK: chap `dominant`+`onDominant`,
  // o'ng `accent`+`onAccent`. Yengil tint ustiga oq yozuv qo'yilsa
  // kontrast 1.1:1 bo'lardi (hisobotning o'z `contrast` bandi).
  ([
    [x0, labels[0], "columnHead"],
    [x1, labels[1], "columnHeadAlt"],
  ] as const).forEach(([x, label, role]) => {
    bd.rect(role, { x, y, w: colW, h: hh }, s.cardRx);
    bd.text(role, x + colW / 2, y + hh / 2 + s.columnHead * 0.35, fit(label, colW - s.cardPad * 2, s.columnHead, 1), s.columnHead, { bold: true, anchor: "middle" });
  });
}

/** Ikki ustunli qatorlar (taqqoslash, sabab-natija) — juft-juft. */
function twoColumns(bd: Builder, left: InfographicBlock[], right: InfographicBlock[], area: Rect, colW: number, rightX: number, opts: CardOpts) {
  const s = bd.s;
  const rows = Math.max(left.length, right.length, 1);
  const needs = Array.from({ length: rows }, (_, i) =>
    Math.max(left[i] ? cardNeed(s, left[i], colW, opts) : 0, right[i] ? cardNeed(s, right[i], colW, { ...opts, tint: true }) : 0),
  );
  const cells = stackBoxes(s, area, needs);
  left.forEach((b, i) => bd.card(b, { x: area.x, y: cells[i].y, w: colW, h: cells[i].h }, opts));
  right.forEach((b, i) => bd.card(b, { x: rightX, y: cells[i].y, w: colW, h: cells[i].h }, { ...opts, tint: true }));
  return cells;
}

function drawCompare(bd: Builder, blocks: InfographicBlock[], area: Rect, spec: InfographicSpec) {
  const s = bd.s;
  const left = blocks.filter((b) => b.side !== "right");
  const right = blocks.filter((b) => b.side === "right");
  const colW = (area.w - s.gap) / 2;
  const rightX = area.x + colW + s.gap;
  const heads = compareHeads(spec.subtitle);
  const headH = heads ? s.columnHead * 2.4 + s.gap : 0;
  const body: Rect = { x: area.x, y: area.y + headH, w: area.w, h: area.h - headH };
  const cells = twoColumns(bd, left, right, body, colW, rightX, { iconR: s.iconR * 0.72 });
  const first = cells[0];
  const last = cells[cells.length - 1];
  if (heads) columnHeads(bd, area.x, rightX, colW, first.y - headH, heads);
  bd.line("divider", area.x + colW + s.gap / 2, first.y, area.x + colW + s.gap / 2, last.y + last.h, s.k * 0.25, { dash: true });
}

/** STATISTIKA — katta raqam + yorliq, ostida sarlavha va izoh. */
function statNeed(s: Scale, b: InfographicBlock, w: number): number {
  const pad = s.cardPad;
  const iconR = s.iconR * 0.66;
  const topH = Math.max(iconR * 2, s.stat * LINE_K);
  const label = b.stat?.label ? s.statLabel * LINE_K : 0;
  const body = fit(b.text, w - pad * 2, s.body, BODY_LINES_MAX);
  return pad * 2 + topH + pad * 0.5 + label + s.heading * LINE_K + pad * 0.3 + body.lines.length * s.body * LINE_K;
}

function drawStat(bd: Builder, blocks: InfographicBlock[], area: Rect) {
  const s = bd.s;
  const boxes = gridBoxes(s, area, blocks, columnsFor(blocks.length), (b, w) => statNeed(s, b, w));
  blocks.forEach((b, i) => {
    const box = boxes[i];
    const pad = s.cardPad;
    bd.rect("card", box, s.cardRx);
    bd.boxes.push({ id: b.id, ...box });

    const iconR = s.iconR * 0.66;
    const raw = String(b.stat?.value ?? "").trim();
    const valueDx = pad + iconR * 2 + pad * 0.8;
    const valueW = box.w - pad - valueDx;
    /*
     * Raqam BITTA qatorda turishi shart — «73%» ni ikki qatorga bo'lish
     * plakatni buzadi. Sig'masa shrift kichraytiriladi, lekin 60 % dan
     * past tushmaydi: o'shanda blok `overflow` ga tushadi va dvigatel
     * modeldan qisqaroq qiymat so'raydi.
     */
    let statFont = s.stat;
    if (raw) {
      const need = textWidth(raw, s.stat);
      if (need > valueW) statFont = Math.max(s.stat * 0.6, (s.stat * valueW) / need);
    }
    const topH = Math.max(iconR * 2, statFont * LINE_K);
    const label = b.stat?.label ? fit(b.stat.label, box.w - pad * 2, s.statLabel, 1) : { lines: [], clipped: false };
    const labelH = label.lines.length * s.statLabel * LINE_K;
    const head = fit(b.heading, box.w - pad * 2, s.heading, 1);
    const headH = head.lines.length * s.heading * LINE_K;
    const bodyLH = s.body * LINE_K;
    const bodyMax = Math.min(BODY_LINES_MAX, linesIn(box.h - pad * 2 - topH - pad * 0.5 - labelH - headH - pad * 0.3, bodyLH));
    const body = fit(b.text, box.w - pad * 2, s.body, bodyMax);
    const contentH = topH + pad * 0.5 + labelH + headH + pad * 0.3 + body.lines.length * bodyLH;
    let y = box.y + Math.max(pad, (box.h - contentH) / 2);

    const iconCy = y + topH / 2;
    bd.iconRing(b.icon, box.x + pad + iconR, iconCy, iconR);
    if (raw) bd.text("stat", box.x + valueDx, iconCy - (statFont * LINE_K) / 2 + statFont * 0.86, { lines: [raw], clipped: false }, statFont, { bold: true, anchor: "start" });
    y += topH + pad * 0.5;
    if (labelH) {
      bd.text("statLabel", box.x + pad, y + s.statLabel * 0.86, label, s.statLabel, { anchor: "start" });
      y += labelH;
    }
    bd.text("heading", box.x + pad, y + s.heading * 0.86, head, s.heading, { bold: true, anchor: "start" });
    y += headH + pad * 0.3;
    bd.text("body", box.x + pad, y + s.body * 0.86, body, s.body, { anchor: "start" });
    bd.mark(b.id, head.clipped || body.clipped || label.clipped || (Boolean(raw) && statFont < s.stat * 0.601));
  });
}

/** XRONOLOGIYA — vertikal chiziq, chapda sana, o'ngda karta. */
function drawTimeline(bd: Builder, blocks: InfographicBlock[], area: Rect) {
  const s = bd.s;
  // Sana zonasi — eng uzun `when` ni bitta qatorga sig'diradigan kenglik,
  // 12–26 mm oralig'ida (bo'sh chap chekka qolmasin).
  const widest = Math.max(0, ...blocks.map((b) => textWidth(String(b.when ?? ""), s.when)));
  const whenW = Math.min(s.iconR * 3.6, Math.max(s.iconR * 1.7, widest + s.cardPad));
  const railX = area.x + whenW + s.gap;
  const dotR = s.iconR * 0.34;
  const cardArea: Rect = { x: railX + s.gap + dotR, y: area.y, w: area.x + area.w - (railX + s.gap + dotR), h: area.h };
  const opts = { iconR: s.iconR * 0.72 };
  const rows = stackBoxes(s, cardArea, blocks.map((b) => cardNeed(s, b, cardArea.w, opts)));

  const first = rows[0];
  const last = rows[rows.length - 1];
  bd.line("rail", railX, first.y + first.h / 2, railX, last.y + last.h / 2, s.k * 0.8);

  blocks.forEach((b, i) => {
    const box = rows[i];
    const cy = box.y + box.h / 2;
    bd.circle("dot", railX, cy, dotR);
    const when = fit(String(b.when ?? ""), whenW, s.when, 2);
    const whenH = when.lines.length * s.when * LINE_K;
    bd.text("when", railX - s.gap - dotR, cy - whenH / 2 + s.when * 0.86, when, s.when, { bold: true, anchor: "end" });
    bd.card(b, box, opts);
    bd.mark(b.id, when.clipped);
  });
}

/**
 * SABAB — NATIJA. Chapda sabablar, o'ngda natijalar, orasida gorizontal
 * o'q. Ustun sarlavhalari TARJIMA jadvalidan (`LABELS`): bu yagona
 * tur bo'lib, unda ustunning MA'NOSI chizmadan ko'rinmaydi.
 */
function drawCauseEffect(bd: Builder, blocks: InfographicBlock[], area: Rect, spec: InfographicSpec) {
  const s = bd.s;
  const labels = infographicLabels(spec.language);
  const causes = blocks.filter((b) => b.role !== "effect");
  const effects = blocks.filter((b) => b.role === "effect");
  const gut = s.iconR * 2.4;
  const colW = (area.w - gut) / 2;
  const rightX = area.x + colW + gut;
  const headH = s.columnHead * 2.4 + s.gap;
  const body: Rect = { x: area.x, y: area.y + headH, w: area.w, h: area.h - headH };
  const cells = twoColumns(bd, causes, effects, body, colW, rightX, { iconR: s.iconR * 0.7 });
  const first = cells[0];
  const last = cells[cells.length - 1];
  columnHeads(bd, area.x, rightX, colW, first.y - headH, [labels.cause, labels.effect]);
  const midY = (first.y + last.y + last.h) / 2;
  bd.line("flow", area.x + colW + gut * 0.1, midY, area.x + colW + gut * 0.9, midY, s.k * 1.8, { arrow: true });
}

/**
 * TUZILMA — ikki darajali daraxt: yuqorida butun (sarlavha), ostida
 * qismlar; `parent` ko'rsatgan bloklar O'Z ota kartasining ostida
 * chip bo'lib chiziladi (hisobot §3: «ko'pi bilan ikki daraja»).
 */
function drawStructure(bd: Builder, blocks: InfographicBlock[], area: Rect, spec: InfographicSpec) {
  const s = bd.s;
  const ids = new Set(blocks.map((b) => b.id));
  const tops = blocks.filter((b) => !b.parent || !ids.has(b.parent) || b.parent === b.id);
  const kidsOf = (id: string) => blocks.filter((b) => b.parent === id && b.id !== id);

  const rootH = s.heading * 3;
  const rootW = Math.min(area.w * 0.72, s.page.width * 0.55);
  const cols = tops.length <= 3 ? Math.max(1, tops.length) : tops.length <= 4 ? 2 : 3;
  const chipH = s.body * 2.6;
  const chipGap = s.gap * 0.4;
  const opts = { iconR: s.iconR * 0.66 };
  // Farzand chiplari OTA kartasining qutisidan TASHQARIDA turadi,
  // shuning uchun katakning tabiiy balandligi karta + chiplar.
  const cellNeed = (b: InfographicBlock, w: number) => cardNeed(s, b, w, opts) + kidsOf(b.id).length * (chipH + chipGap);

  /*
   * Daraxt BUTUNLIGICHA (ildiz + shox + katakchalar) markazlashtiriladi,
   * lekin katakchalar avval `growMax` 1.6 gacha cho'ziladi. Ko'z sinovi
   * (`map-structure`, uch aylanish) uchta muqobilni ko'rsatdi:
   *   • katakchalarni alohida markazlashtirish — shox bilan karta
   *     orasida 40 mm bo'sh vertikal chiziq;
   *   • tabiiy balandlikda markazlashtirish — daraxt sahifa o'rtasida
   *     kichkina bo'lib qoladi;
   *   • katakchalarni oxirigacha cho'zish — kartalar ichi bo'm-bo'sh.
   * Shuning uchun ORALIQ yo'l: bir oz cho'zish + guruhni markazga.
   */
  const CELL_GROW = 1.6;
  const probe: Rect = { x: area.x, y: area.y, w: area.w, h: area.h };
  const needs = gridNeeds(s, probe, tops, cols, cellNeed);
  const grown = fitRows(Math.max(0, area.h - rootH - s.gap * 2), needs, s.gap, CELL_GROW);
  const used = grown.heights.reduce((a, b) => a + b, 0) + grown.gap * (needs.length - 1);
  const off = Math.max(0, (area.h - (rootH + s.gap * 2 + used)) / 2);

  const rootY = area.y + off;
  const rootX = area.x + (area.w - rootW) / 2;
  bd.rect("root", { x: rootX, y: rootY, w: rootW, h: rootH }, s.cardRx);
  bd.text("root", area.x + area.w / 2, rootY + rootH / 2 + s.heading * 0.35, fit(spec.title, rootW - s.cardPad * 2, s.heading, 1), s.heading, {
    bold: true,
    anchor: "middle",
  });

  const busY = rootY + rootH + s.gap;
  const cellTop = busY + s.gap;
  const cellArea: Rect = { x: area.x, y: cellTop, w: area.w, h: used };
  const cells = gridBoxes(s, cellArea, tops, cols, cellNeed, { align: "top", growMax: CELL_GROW });

  bd.line("connector", area.x + area.w / 2, rootY + rootH, area.x + area.w / 2, busY, s.k * 0.6);
  const centers = cells.map((c) => c.x + c.w / 2);
  bd.line("connector", Math.min(...centers, area.x + area.w / 2), busY, Math.max(...centers, area.x + area.w / 2), busY, s.k * 0.6);

  tops.forEach((b, i) => {
    const cell = cells[i];
    if (i < cols) bd.line("connector", cell.x + cell.w / 2, busY, cell.x + cell.w / 2, cell.y, s.k * 0.6);
    const kids = kidsOf(b.id);
    const kidsH = kids.length * (chipH + chipGap);
    const cardBox: Rect = { x: cell.x, y: cell.y, w: cell.w, h: Math.max(chipH, cell.h - kidsH) };
    bd.card(b, cardBox, opts);
    kids.forEach((kid, j) => {
      const y = cardBox.y + cardBox.h + chipGap + j * (chipH + chipGap);
      const box: Rect = { x: cell.x + s.gap, y, w: cell.w - s.gap, h: chipH };
      bd.rect("cardTint", box, s.cardRx * 0.7);
      bd.boxes.push({ id: kid.id, ...box });
      bd.line("connector", cell.x + cell.w / 2, y - chipGap, cell.x + cell.w / 2, y, s.k * 0.5);
      const f = fit(`${kid.heading}${kid.text ? ` — ${kid.text}` : ""}`, box.w - s.cardPad * 1.6, s.body, 2);
      bd.text("body", box.x + s.cardPad * 0.8, box.y + box.h / 2 - (f.lines.length * s.body * LINE_K) / 2 + s.body * 0.86, f, s.body, { anchor: "start" });
      bd.mark(kid.id, f.clipped);
    });
  });
}

/* ══════════════════════════ ko'zgu (RTL) ══════════════════════════ */

/** Butun maketni vertikal o'q bo'yicha aks ettiradi (arabcha, forscha…). */
function mirror(layout: InfographicLayout): InfographicLayout {
  const W = layout.mm.w;
  const flip = (a: InfographicText["anchor"]): InfographicText["anchor"] => (a === "start" ? "end" : a === "end" ? "start" : a);
  return {
    ...layout,
    shapes: layout.shapes.map((sh) => {
      if (sh.k === "rect") return { ...sh, x: W - sh.x - sh.w };
      if (sh.k === "circle") return { ...sh, cx: W - sh.cx };
      if (sh.k === "icon") return { ...sh, x: W - sh.x - sh.size };
      return { ...sh, x1: W - sh.x1, x2: W - sh.x2 };
    }),
    texts: layout.texts.map((t) => ({ ...t, x: W - t.x, anchor: flip(t.anchor) })),
    boxes: layout.boxes.map((b) => ({ ...b, x: W - b.x - b.w })),
  };
}

/* ══════════════════════════ kirish nuqtasi ══════════════════════════ */

/**
 * `InfographicSpec` → geometriya. SOF: bir xil kirish — bit-ma-bit bir
 * xil chiqish (tasodifiy son, `Date`, muhit o'zgaruvchisi YO'Q).
 */
export function layoutInfographic(spec: InfographicSpec): InfographicLayout {
  const size = spec.size === "A3" ? "A3" : "A4";
  const s = scaleOf(size);
  const bd = new Builder(s);
  const blocks = spec.blocks.slice(0, INFOGRAPHIC_LIMITS.blocksMax);
  const { content } = frameOf(bd, spec);

  if (blocks.length) {
    switch (spec.type) {
      case "process":
        drawProcess(bd, blocks, content);
        break;
      case "compare":
        drawCompare(bd, blocks, content, spec);
        break;
      case "stat":
        drawStat(bd, blocks, content);
        break;
      case "timeline":
        drawTimeline(bd, blocks, content);
        break;
      case "cause-effect":
        drawCauseEffect(bd, blocks, content, spec);
        break;
      case "map-structure":
        drawStructure(bd, blocks, content, spec);
        break;
      default:
        drawList(bd, blocks, content);
    }
  }

  const layout: InfographicLayout = {
    type: spec.type,
    size,
    mm: { w: s.page.width, h: s.page.height },
    rtl: isRtl(spec.language),
    shapes: bd.shapes,
    texts: bd.texts,
    boxes: bd.boxes,
    overflow: bd.overflow,
  };
  return layout.rtl ? mirror(layout) : layout;
}
