import { extractMeta } from "./meta";
import { translationChars } from "../tools";
import { teacherKindOf } from "./teacher/registry";
import { TEACHER_LIMITS, type TeacherKind } from "./teacher/types";
import { gameKindOf } from "./games/registry";
import { GAME_LIMITS, normalizeGameCount, type GameKind } from "./games/types";
import { normalizeBlockCountFor } from "./infographic/registry";
import { INFOGRAPHIC_LIMITS } from "./infographic/types";
import type { FormValues, ToolConfig, ToolId } from "../types";

/**
 * Ishga ajratiladigan vaqt — hajmdan hisoblanadi, qat'iy yozilmaydi.
 *
 * Ilgari 14 xizmatning hammasiga bitta `WORKER_JOB_TIMEOUT_MS` (300 s)
 * berilardi. Zarar ikki tomonlama edi:
 *
 *   1 varaqlik insho ~40 s da tugaydi, lekin 285 s lik slotni band
 *   qilardi — `WORKER_CONCURRENCY=2` da bu o'tkazuvchanlikning yarmi.
 *
 *   45 betlik kurs ishi (5 bob × 4 ostmavzu = 20 chaqiruv) ~420 s talab
 *   qiladi va 285 s ga sig'masdi: byudjet tugar, hajm darvozasi ishga
 *   tushar, kredit qaytardi. Ya'ni ENG QIMMAT xizmatda (24 000 tanga)
 *   muvaffaqiyatsizlik ehtimoli ENG YUQORI edi, chunki byudjet eng qattiq.
 *
 * Asos: bitta LLM bo'lim chaqiruvi ≈ 25–40 s, bo'limlar qisman parallel
 * ketadi. Bet boshiga 9 s — jonli o'lchovdan olingan (20 betlik kurs
 * ishi ~180 s, 45 betlik ~420 s).
 */

/** Hech qanday ish shundan kam olmaydi. */
export const MIN_BUDGET_MS = 90_000;

/** Bet soniga bog'liq bo'lmagan xizmatlar uchun qat'iy byudjet. */
const FIXED: Partial<Record<ToolId, number>> = {
  image: 90_000,
  /*
   * Rezyume 2: prompt kattalashdi (tuzilmali faktlar JSON, 18 til uchun
   * yorliqlar, boyitish qoidalari) va qisqa summary da BIR marta STRICT
   * retry bor — 90 s da katta tajribali rezyume retry'ga ulgurmasdi.
   */
  resume: 150_000,
};

const PER_PAGE_MS = 9_000;

/**
 * Slayd byudjeti — deka UZUNLIGIGA bog'liq (N-2).
 *
 * Ilgari u `FIXED` da qat'iy 180 000 edi, ya'ni 10 slaydli standart
 * paket ham, 16 slaydli `premium_long` ham (3 000 va 8 000 tanga) bir xil
 * vaqt olardi. 16 slayd ikki bo'lakda yoziladi va har bo'lakning qayta
 * urinishi bor — matn bosqichining o'zi 180 s ga sig'masdi, rasmga esa
 * hech narsa qolmasdi.
 *
 * Asos: bir bo'lak (≤8 slayd) ~40 s, unga rasm ulushi qo'shiladi
 * (`slideStageBudget` 62/38 bo'ladi). Slayd boshiga 11 s shu ikkisini
 * qoplaydi; 120 s tayanch esa reja, tema va PPTX yig'ish uchun.
 */
const SLIDE_BASE_MS = 120_000;
const SLIDE_PER_SLIDE_MS = 11_000;
/*
 * Pro slayd: 30 slayd × har mos slaydda rasm + ixtiyoriy tadqiqot
 * chaqiruvi. Hisob (AUDIT-9 X-1): matn 4 bo'lak ≈ 220 s, rasm ~20 slot /
 * 4 parallel ≈ 80 s, tadqiqot ≤30 s, yig'ish 12 s → 30 slaydda ~570 s.
 * Oddiy formulaning 450 s i yetmasdi.
 */
const PRO_SLIDE_BASE_MS = 150_000;
const PRO_SLIDE_PER_SLIDE_MS = 16_000;

/**
 * Tarjima byudjeti — BELGILAR soniga bog'liq (Tarjimon 2).
 *
 * Ilgari u `FIXED` da qat'iy 240 000 edi, chegara esa 48 000 belgi.
 * Chegara 200 000 ga ko'tarilgach bu son yolg'onga aylandi: 200 000 belgi
 * ≈ 60 partiya, 4 tadan parallel ⇒ 15 to'lqin × ~30 s ≈ 450 s, ustiga
 * 1-o'tish glossariysi va hujjatni yig'ish. 240 s da ish yarmida uzilib,
 * kredit qaytarilardi — ya'ni ENG KATTA hujjat ENG ko'p yiqilardi.
 *
 * Formula: 1 000 belgiga 2 500 ms (bir band ≈ 250 belgi, partiya ≈ 3 500
 * belgi va ~30 s; 4 parallel ⇒ ~2.1 s/1000, zaxira bilan 2.5), ustiga
 * 60 s tayanch (glossariy o'tishi, ekstraksiya, `applySegments`).
 * 200 000 → 560 s; u `cap` (`WORKER_JOB_TIMEOUT_MS`, standart 660 s) ga
 * sig'adi, undan oshsa `budgetFor` ning umumiy klampi kesadi.
 */
const TRANSLATION_BASE_MS = 60_000;
const TRANSLATION_PER_KCHARS_MS = 2_500;

/**
 * Maqola byudjeti (Maqola 2/3): `150 000 + 90 000 + 16 000 × bet` — 15 bet ≈ 480 s.
 *
 * Tayanch katta, chunki bet sonidan qat'i nazar: manba qidiruv (OpenAlex
 * + tanlash, ≤30 s), reja, uch tilli annotatsiya (3 chaqiruv), highlights,
 * iqtibos tekshiruvi. Bet boshiga 16 s — bo'limlar 3 parallel, har biri
 * ≤90 s, ustiga «kengaytir» qayta so'rovi. AUDIT-18: avto-sayqal
 * (`ARTICLE_POLISH_MS`) — ≤6 tuzatish 2 to'lqinda (≤60 s) + baholovchi
 * (≤35 s); dvigatel byudjetdan ≥ 90 s qolgandagina ishga tushiradi, aks
 * holda o'tkazib yuboradi. `WORKER_JOB_TIMEOUT_MS` 660 s (compose) — 15
 * bet sig'adi.
 */
export const ARTICLE_BASE_MS = 150_000;
export const ARTICLE_PER_PAGE_MS = 16_000;
export const ARTICLE_POLISH_MS = 90_000;

/**
 * Talaba ishi byudjeti (Talaba ishlari 2, AUDIT-19): `150 000 + 9 000 ×
 * bet + 90 000` (sayqal) — 45 bet ≈ 645 s, `WORKER_JOB_TIMEOUT_MS`
 * (660 s, compose) ichida.
 *
 * Tayanch katta, chunki bet sonidan qat'i nazar: manba qidiruv (lex.uz +
 * Books + OpenAlex), reja, kirish (7 element, yo'qolgani qayta so'raladi),
 * xulosa, iqtibos tekshiruvi va tayyorlik hisoboti. Bet boshiga 9 s —
 * paragraflar 3 parallel yoziladi (`mapPool(3)`), har biri ≤90 s.
 *
 * X-3: 40–45 betlik paketda avto-sayqalga vaqt qolmaydi — dvigatel uni
 * O'ZI o'tkazib yuboradi (`WORK_POLISH_MAX_PAGES`) va hisobotda
 * `polish.skipped: budget` izohi qoladi; foydalanuvchi natija sahifasida
 * «Hammasini tuzatish» bilan qo'lda ishga tushiradi.
 */
export const WORK_BASE_MS = 150_000;
export const WORK_PER_PAGE_MS = 9_000;
export const WORK_POLISH_MS = 90_000;

/**
 * O'qituvchi hujjati byudjeti (AUDIT-20 R0).
 *
 * Bu oilada BET yo'q — hajm ELEMENT soni bilan o'lchanadi: dars
 * bosqichi, hafta, atama, keys, savol. Shuning uchun `PER_PAGE_MS`
 * formulasi ham, eski `FIXED` (120–150 s) ham yaramasdi:
 *
 *   34 haftalik texnologik xarita chorak bo'yicha 4 chaqiruvda (mapPool)
 *   yoziladi va qayta urinishi bor — 150 s da uzilib qolardi (aynan shu
 *   sabab AUDIT-20 rejasida «xaritada qayta urinish yo'q» deb yozilgan);
 *
 *   30 savolli test — savollar partiyasi + kalit + OMR + hisobot; 120 s
 *   ga sig'maydi, lekin 30 savol 40 savoldan arzonroq bo'lishi kerak.
 *
 * Tayanch (`base`) — turdan qat'i nazar bo'ladigan ish: kirish, reja,
 * hisobot va baholovchi. `per` — element boshiga (jonli o'lchovga qadar
 * hisobdan: test 30 → ~200 s, xarita 34 hafta → ~240 s).
 */
const TEACHER_MS: Record<TeacherKind, { base: number; per: number }> = {
  lesson: { base: 90_000, per: 3_000 },
  map: { base: 120_000, per: 3_500 },
  glossary: { base: 90_000, per: 1_500 },
  keys: { base: 90_000, per: 12_000 },
  test: { base: 90_000, per: 3_500 },
};

/** Hisobotdan keyingi avto-sayqal (`teacher/polish.ts`) ulushi. */
export const TEACHER_POLISH_MS = 60_000;

/**
 * @param kind   Vosita oilasi (`teacherKindOf`).
 * @param n      Element soni: bosqich / hafta / atama / keys / savol.
 * @param polish Sayqal bosqichi ham hisobga olinsinmi (standart — ha,
 *   chunki dvigatel uni O'ZI chaqiradi; `false` — WP-A/B ning «sayqalsiz»
 *   o'lchovini tekshirish uchun).
 */
export function teacherBudgetMs(kind: TeacherKind, n: number, polish = true): number {
  const { base, per } = TEACHER_MS[kind];
  const count = Math.max(1, Math.round(Number.isFinite(n) ? n : 1));
  return base + count * per + (polish ? TEACHER_POLISH_MS : 0);
}

/**
 * Formadan element sonini o'qiydi — byudjet va dvigatel BITTA qoidadan.
 * Noto'g'ri/bo'sh qiymat turning standartiga tushadi (forma ham shunday).
 */
function teacherSize(kind: TeacherKind, values: FormValues): number {
  const num = (v: unknown, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : dflt;
  };
  if (kind === "lesson") return num(values.stageCount, 6);
  if (kind === "map") {
    // Hafta soni — jami soat / haftalik soat (`mapWeeks` bilan bir xil klamp).
    const weeks = Math.ceil(num(values.totalHours, 68) / num(values.weeklyHours, 2));
    return Math.min(TEACHER_LIMITS.weeksMax, Math.max(TEACHER_LIMITS.weeksMin, weeks));
  }
  if (kind === "glossary") return Math.min(TEACHER_LIMITS.termsMax, num(values.termCount, 10));
  if (kind === "keys") return Math.min(TEACHER_LIMITS.casesMax, num(values.caseCount, 5));
  return Math.min(TEACHER_LIMITS.questionsMax, num(values.count, 20));
}

/**
 * O'YIN byudjeti (AUDIT-21 R0) — krossvord va flesh kartalar.
 *
 * Bu oilada BET ham, ko'p bosqichli yozish ham yo'q: LLM BITTA
 * chaqiruvda so'z+savol yoki karta juftliklarini beradi, qolgani —
 * DETERMINISTIK ish (to'r algoritmi, DOCX panjarasi), ya'ni modelga
 * emas, protsessorga bog'liq. Shuning uchun o'qituvchi oilasidagi
 * element boshiga 3 000 ms bu yerda ortiqcha.
 *
 * Hisob: bitta chaqiruv 20 so'z uchun ≈35 s (+ qayta urinish), to'r
 * greedy+backtrack ≤20 s (`crossword/grid.ts`, R5 §3), hisobot +
 * baholovchi ≈30 s, DOCX ≈5 s ⇒ 20 so'zda ~120 s. `base` turdan qat'i
 * nazar bo'ladigan ish, `per` — element boshiga.
 */
const GAME_MS: Record<GameKind, { base: number; per: number }> = {
  crossword: { base: 90_000, per: 1_500 },
  flashcards: { base: 90_000, per: 1_500 },
};

/**
 * @param kind O'yin oilasi (`gameKindOf`).
 * @param n    Element soni: so'z yoki karta (5/10/15/20).
 */
export function gameBudgetMs(kind: GameKind, n: number): number {
  const { base, per } = GAME_MS[kind];
  const count = Math.max(1, Math.round(Number.isFinite(n) ? n : GAME_LIMITS.countDefault));
  return base + Math.min(GAME_LIMITS.countMax, count) * per;
}

/**
 * INFOGRAFIKA byudjeti (AUDIT-21 R0).
 *
 * O'yinlardan uzunroq: spetsifikatsiyadan keyin SVG maketi va `sharp`
 * bilan A4/A3 @300 dpi PNG (2480×3508 px) chiziladi — bu o'nlab
 * soniyalik CPU ishi, ustiga matn sig'ishini tekshirish (`noOverflow`)
 * qayta yozdirishga olib kelishi mumkin. 8 blokda ~150 s.
 */
const INFOGRAPHIC_BASE_MS = 120_000;
const INFOGRAPHIC_PER_BLOCK_MS = 4_000;

/** @param blocks Blok soni (3–8) — `normalizeBlockCountFor` bilan bir qoidadan. */
export function infographicBudgetMs(blocks: number): number {
  const n = Number.isFinite(blocks) ? Math.round(blocks) : INFOGRAPHIC_LIMITS.blocksDefault;
  const clamped = Math.min(INFOGRAPHIC_LIMITS.blocksMax, Math.max(INFOGRAPHIC_LIMITS.blocksMin, n));
  return INFOGRAPHIC_BASE_MS + clamped * INFOGRAPHIC_PER_BLOCK_MS;
}

/**
 * Formadan element sonini o'qiydi — byudjet va dvigatel BITTA qoidadan
 * (`teacherSize` naqshi). Noto'g'ri/bo'sh qiymat standartga tushadi.
 */
function gameSize(kind: GameKind, values: FormValues): number {
  return normalizeGameCount(kind === "crossword" ? values.wordCount : values.cardCount);
}

/** @param pages Paketning o'rtacha beti (`pagesMid("25-30")` → 28). */
export function workBudgetMs(pages: number): number {
  const p = Math.max(1, Number.isFinite(pages) ? pages : 12);
  return WORK_BASE_MS + WORK_POLISH_MS + Math.round(p) * WORK_PER_PAGE_MS;
}

/**
 * @param cap Yuqori chegara (`WORKER_JOB_TIMEOUT_MS`). Byudjet undan
 *   oshmaydi — operator bitta o'zgaruvchi bilan hamma narsani cheklay
 *   olishi kerak.
 */
export function budgetFor(tool: ToolConfig, values: FormValues, cap: number): number {
  const fixed = FIXED[tool.id];
  let want = fixed;
  // O'qituvchi oilasi — element soniga qarab (AUDIT-20 R0), `extractMeta`
  // ning `targetPages` i emas: bu hujjatlarda «bet» tushunchasi yo'q.
  const teacherKind = teacherKindOf(tool.id);
  if (want === undefined && teacherKind) {
    want = teacherBudgetMs(teacherKind, teacherSize(teacherKind, values));
  }
  /*
   * O'yinlar (AUDIT-21): hajm — SO'Z yoki KARTA soni. Ular ham
   * `extractMeta().targetPages` ga tushmaydi: krossvordda «bet»
   * tushunchasi yo'q, to'r bitta betda turadi.
   */
  const gameKind = gameKindOf(tool.id);
  if (want === undefined && gameKind) {
    want = gameBudgetMs(gameKind, gameSize(gameKind, values));
  }
  // Infografika: hajm — BLOK soni (tur chegarasi bilan, forma qoidasi bilan bir xil).
  if (want === undefined && tool.id === "infographic") {
    want = infographicBudgetMs(normalizeBlockCountFor(values.infographicType, values.blockCount));
  }
  if (want === undefined && tool.id === "translation") {
    // Hajm `translationChars` dan — narx bilan BITTA manbadan, ya'ni
    // «pul olindi, lekin vaqt yetmadi» holati kelib chiqmaydi.
    want = TRANSLATION_BASE_MS + Math.ceil(translationChars(values) / 1000) * TRANSLATION_PER_KCHARS_MS;
  }
  if (want === undefined) {
    // Slaydda `targetPages` — betlar emas, SLAYDLAR soni (`extractMeta`).
    const size = extractMeta(tool, values).targetPages;
    want =
      tool.id === "pro-slide"
        ? PRO_SLIDE_BASE_MS + size * PRO_SLIDE_PER_SLIDE_MS
        : tool.id === "slide"
          ? SLIDE_BASE_MS + size * SLIDE_PER_SLIDE_MS
          : tool.id === "article" || tool.id === "thesis"
            ? ARTICLE_BASE_MS + ARTICLE_POLISH_MS + size * ARTICLE_PER_PAGE_MS
            : tool.id === "coursework" || tool.id === "referat" || tool.id === "mustaqil-ish"
              ? workBudgetMs(size)
              : MIN_BUDGET_MS + size * PER_PAGE_MS;
  }
  return Math.max(MIN_BUDGET_MS, Math.min(want, Math.max(MIN_BUDGET_MS, cap)));
}
