/**
 * OMR JAVOBLAR VARAG'I — SVG chizuvchi (AUDIT-20 WP-B).
 *
 * Nega `layout.ts` emas, ALOHIDA modul: umumiy sxema maketi tugun/qirra
 * grafigini chizadi (`FigureLayout`), OMR esa MILLIMETRDA o'lchangan
 * bosma blanka — doira radiusi 2,6 mm, qator qadami 9 mm, registratsiya
 * kvadrati 6 mm. Bu o'lchovlar qog'ozda aniq chiqishi kerak, shuning
 * uchun maket birligi ham millimetr: 1 mm = `MM_PX` SVG birligi (96 dpi),
 * ya'ni `figurePng(svg, { widthMm: 180 })` da har o'lcham AYNAN o'zi
 * bo'lib chiqadi.
 *
 * Maket (`docs/research/test.md` §3.6):
 *   — yuqori chap: muassasa / fan / sinf / sana chiziqlari;
 *   — yuqori o'ng: Variant doiralari (Ⓐ Ⓑ …);
 *   — F.I.Sh. — bitta uzun chiziq (katak emas: tekshiruv qo'lda);
 *   — Test kodi — `idBoxes` katak, har biri ostida 0–9 doiralari;
 *   — javob to'ri: USTUN = 10 savol, ≤4 ustun ⇒ ≤40 savol;
 *   — `truefalse` ham A/B doirasi oladi (A = to'g'ri) — `hasMulti` bo'lsa
 *     ko'rsatmada «bu savolda 2 ta doira» satri chiqadi;
 *   — pastda namuna va DTM qoidasi (S-10: ko'k siyoh, to'liq bo'yash);
 *   — uch burchakda 6×6 mm to'ldirilgan kvadrat (registratsiya belgisi).
 *
 * Izomorf: `sharp`/DOM importi YO'Q — PNG ga aylantirish `figures/png.ts`
 * (`figurePng`) ning ishi, bu modul faqat satr qaytaradi.
 */
import { xmlEscape } from "../xml";
import type { FigureSpec } from "../types";

export type OmrSpec = Extract<FigureSpec, { kind: "omr" }>;

/** 1 mm SVG birligida (96 dpi): librsvg ham, brauzer ham shu nisbatni oladi. */
export const MM_PX = 96 / 25.4;

/** Blanka o'lchovlari — millimetrda (R3 §3.6). Testlar shu jadvalni qulflaydi. */
export const OMR_MM = {
  /** Chop etiladigan kenglik (A4 210 mm − 2×15 mm chekka). */
  width: 180,
  pad: 6,
  /** Javob doirasi radiusi. */
  radius: 2.6,
  /** Doiralar orasidagi qadam (markazdan markazgacha). */
  optionStep: 8,
  /** Javob qatori balandligi. */
  rowHeight: 9,
  /** Registratsiya kvadrati. */
  markerSize: 6,
  /** Ustunda nechta savol. */
  perColumn: 10,
  /** Test kodi katagi. */
  idBox: 7,
  /** Kod doirasi radiusi (0–9 ustuni). */
  idRadius: 1.9,
  idStep: 4.6,
} as const;

export type OmrLabels = {
  title: string;
  institution: string;
  subject: string;
  grade: string;
  date: string;
  variant: string;
  name: string;
  code: string;
  rules: string[];
  multiNote: string;
  openNote: string;
};

const LABELS: Record<"uz" | "ru" | "en", OmrLabels> = {
  uz: {
    title: "JAVOBLAR VARAG'I",
    institution: "Muassasa",
    subject: "Fan",
    grade: "Sinf",
    date: "Sana",
    variant: "Variant",
    name: "F.I.Sh.",
    code: "Test kodi",
    rules: [
      "Doira TO'LIQ bo'yaladi (●), faqat KO'K siyohli ruchka bilan.",
      "Bitta savolga bitta doira; ikkita doira yoki chala bo'yash — ball berilmaydi.",
      "Xato belgilangan doirani tuzatib bo'lmaydi — o'qituvchiga murojaat qiling.",
    ],
    multiNote: "Ko'p javobli savollarda 2 ta doira belgilanadi (savol matnida ko'rsatilgan).",
    openNote: "Ochiq savollar javobi — test varag'ining o'zida yoziladi.",
  },
  ru: {
    title: "ЛИСТ ОТВЕТОВ",
    institution: "Учреждение",
    subject: "Предмет",
    grade: "Класс",
    date: "Дата",
    variant: "Вариант",
    name: "Ф.И.О.",
    code: "Код теста",
    rules: [
      "Кружок закрашивается ПОЛНОСТЬЮ (●), только СИНЕЙ ручкой.",
      "На один вопрос — один кружок; два кружка или частичная заливка — балл не начисляется.",
      "Ошибочно закрашенный кружок исправить нельзя — обратитесь к учителю.",
    ],
    multiNote: "В вопросах с несколькими ответами закрашиваются 2 кружка (указано в тексте вопроса).",
    openNote: "Ответы на открытые вопросы пишутся в самом тестовом листе.",
  },
  en: {
    title: "ANSWER SHEET",
    institution: "School",
    subject: "Subject",
    grade: "Grade",
    date: "Date",
    variant: "Variant",
    name: "Full name",
    code: "Test code",
    rules: [
      "Fill the bubble COMPLETELY (●), blue pen only.",
      "One bubble per question; two bubbles or a partial fill scores nothing.",
      "A wrongly filled bubble cannot be corrected — ask the teacher.",
    ],
    multiNote: "Multiple-answer questions take 2 bubbles (stated in the question).",
    openNote: "Open questions are answered on the test paper itself.",
  },
};

export function omrLabels(lang: string): OmrLabels {
  const c = (lang || "uz").toLowerCase();
  return LABELS[c === "ru" ? "ru" : c === "en" ? "en" : "uz"];
}

/** Variant harflari — `TEST_VARIANT_IDS` bilan bir xil, lekin bu modul mustaqil. */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

const n = (v: number): string => String(Math.round(v * 100) / 100);

type Ctx = { out: string[]; mm: (v: number) => number };

function text(ctx: Ctx, xMm: number, yMm: number, s: string, opts: { size?: number; anchor?: "start" | "middle" | "end"; bold?: boolean } = {}) {
  const size = (opts.size ?? 3.2) * MM_PX;
  ctx.out.push(
    `<text x="${n(ctx.mm(xMm))}" y="${n(ctx.mm(yMm))}" font-size="${n(size)}" text-anchor="${opts.anchor ?? "start"}"${opts.bold ? ' font-weight="bold"' : ""}>${xmlEscape(s)}</text>`,
  );
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w = 0.3) {
  ctx.out.push(
    `<line x1="${n(ctx.mm(x1))}" y1="${n(ctx.mm(y1))}" x2="${n(ctx.mm(x2))}" y2="${n(ctx.mm(y2))}" stroke="#000" stroke-width="${n(ctx.mm(w))}"/>`,
  );
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill = "none", stroke = "#000") {
  ctx.out.push(
    `<rect x="${n(ctx.mm(x))}" y="${n(ctx.mm(y))}" width="${n(ctx.mm(w))}" height="${n(ctx.mm(h))}" fill="${fill}" stroke="${stroke}" stroke-width="${n(ctx.mm(0.3))}"/>`,
  );
}

function bubble(ctx: Ctx, cx: number, cy: number, r: number, label: string, size = 2.2) {
  ctx.out.push(`<circle cx="${n(ctx.mm(cx))}" cy="${n(ctx.mm(cy))}" r="${n(ctx.mm(r))}" fill="#fff" stroke="#000" stroke-width="${n(ctx.mm(0.3))}"/>`);
  if (label) {
    const fs = size * MM_PX;
    // Baza chizig'i qo'lda (librsvg `dominant-baseline` ni to'liq qo'llamaydi — `svg.ts` bilan bir xil qoida).
    ctx.out.push(`<text x="${n(ctx.mm(cx))}" y="${n(ctx.mm(cy) + fs * 0.35)}" font-size="${n(fs)}" text-anchor="middle">${xmlEscape(label)}</text>`);
  }
}

/** Blanka BALANDLIGI (mm) — ustun soni va qo'shimcha satrlardan. */
export function omrHeightMm(spec: OmrSpec): number {
  const rows = Math.min(OMR_MM.perColumn, Math.max(1, spec.count));
  const notes = 1 + (spec.hasMulti ? 1 : 0);
  return Math.round(HEAD_MM + rows * OMR_MM.rowHeight + 6 + notes * 5 + LABELS.uz.rules.length * 5 + OMR_MM.pad * 2);
}

/** Shapka (sarlavha + maydonlar + kod) balandligi. */
const HEAD_MM = 52;

/**
 * OMR blankasining SVG i.
 *
 * Deterministik: bir xil `spec` da bayt-bayt bir xil satr (tasodif,
 * sana, tashqi holat yo'q) — `tests/teacher-omr.test.mts` shunga tayanadi.
 */
export function omrSvg(spec: OmrSpec, opts: { lang?: string } = {}): string {
  const L = omrLabels(opts.lang ?? "uz");
  const W = OMR_MM.width;
  const H = omrHeightMm(spec);
  const mm = (v: number) => v * MM_PX;
  const ctx: Ctx = { out: [], mm };

  const count = Math.max(0, Math.round(spec.count));
  const optionCount = Math.max(2, Math.min(LETTERS.length, Math.round(spec.optionCount) || 4));
  const columns = Math.max(1, Math.round(spec.columns) || 1);
  const variantIds = (spec.variantIds ?? []).map((v) => String(v)).filter(Boolean);
  const idBoxes = Math.max(0, Math.round(spec.idBoxes) || 0);

  /* ── ramka va registratsiya belgilari ── */
  ctx.out.push(`<rect x="0" y="0" width="${n(mm(W))}" height="${n(mm(H))}" fill="#fff"/>`);
  const m = OMR_MM.markerSize;
  for (const [x, y] of [
    [OMR_MM.pad, OMR_MM.pad],
    [W - OMR_MM.pad - m, OMR_MM.pad],
    [OMR_MM.pad, H - OMR_MM.pad - m],
  ] as const) {
    rect(ctx, x, y, m, m, "#000", "#000");
  }

  /* ── shapka ── */
  const left = OMR_MM.pad + m + 4;
  let y = OMR_MM.pad + 6;
  text(ctx, W / 2, y, L.title, { size: 4.6, anchor: "middle", bold: true });
  y += 9;

  const fieldW = 62;
  for (const [i, label] of [L.institution, L.subject, L.grade, L.date].entries()) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * (fieldW + 6);
    const yy = y + row * 8;
    text(ctx, x, yy, `${label}:`, { size: 3 });
    line(ctx, x + 22, yy + 0.8, x + fieldW, yy + 0.8);
  }
  y += 16;
  text(ctx, left, y, `${L.name}:`, { size: 3 });
  line(ctx, left + 16, y + 0.8, left + 108, y + 0.8);

  /* ── variant doiralari (o'ng yuqori) ── */
  if (variantIds.length) {
    const vx = W - OMR_MM.pad - m - 4 - (variantIds.length - 1) * OMR_MM.optionStep;
    const vy = OMR_MM.pad + 20;
    text(ctx, vx - 6, vy + 1, `${L.variant}:`, { size: 3, anchor: "end" });
    variantIds.forEach((id, i) => bubble(ctx, vx + i * OMR_MM.optionStep, vy, OMR_MM.radius, id));
  }

  /* ── test kodi: kataklar + 0–9 doiralari ── */
  if (idBoxes > 0) {
    const cx0 = W - OMR_MM.pad - m - 4 - idBoxes * OMR_MM.idBox;
    const cy0 = OMR_MM.pad + 28;
    text(ctx, cx0 - 4, cy0 + 4, `${L.code}:`, { size: 3, anchor: "end" });
    for (let b = 0; b < idBoxes; b++) {
      rect(ctx, cx0 + b * OMR_MM.idBox, cy0, OMR_MM.idBox - 1, OMR_MM.idBox);
      for (let d = 0; d < 10; d++) {
        bubble(ctx, cx0 + b * OMR_MM.idBox + (OMR_MM.idBox - 1) / 2, cy0 + OMR_MM.idBox + 3 + d * OMR_MM.idStep, OMR_MM.idRadius, String(d), 1.7);
      }
    }
  }

  /* ── javob to'ri ── */
  const gridTop = HEAD_MM + OMR_MM.pad;
  const colW = (W - 2 * (OMR_MM.pad + m + 2)) / columns;
  const rowsPerCol = OMR_MM.perColumn;
  for (let c = 0; c < columns; c++) {
    const x0 = OMR_MM.pad + m + 2 + c * colW;
    // Ustun sarlavhasi — harflar (A B C D) doiralar ustida.
    for (let o = 0; o < optionCount; o++) {
      text(ctx, x0 + 12 + o * OMR_MM.optionStep, gridTop - 2, LETTERS[o], { size: 2.6, anchor: "middle" });
    }
    for (let r = 0; r < rowsPerCol; r++) {
      const qn = c * rowsPerCol + r + 1;
      if (qn > count) break;
      const yy = gridTop + r * OMR_MM.rowHeight + OMR_MM.rowHeight / 2;
      text(ctx, x0 + 7, yy + 1, String(qn), { size: 3, anchor: "end" });
      for (let o = 0; o < optionCount; o++) bubble(ctx, x0 + 12 + o * OMR_MM.optionStep, yy, OMR_MM.radius, "");
    }
  }

  /* ── izohlar va namuna ── */
  let ny = gridTop + Math.min(rowsPerCol, count || 1) * OMR_MM.rowHeight + 7;
  if (spec.hasMulti) {
    text(ctx, left, ny, `• ${L.multiNote}`, { size: 2.8 });
    ny += 5;
  }
  text(ctx, left, ny, `• ${L.openNote}`, { size: 2.8 });
  ny += 5;
  for (const rule of L.rules) {
    text(ctx, left, ny, `• ${rule}`, { size: 2.8 });
    ny += 5;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(mm(W))} ${n(mm(H))}" width="${n(mm(W))}" height="${n(mm(H))}" font-family="Times New Roman, Liberation Serif, Noto Serif, serif" fill="#000">`,
    ...ctx.out,
    `</svg>`,
  ].join("");
}
