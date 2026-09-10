import { extractMeta } from "./meta";
import { translationChars } from "../tools";
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
  glossary: 150_000,
  keys: 150_000,
  "lesson-plan": 120_000,
  "texnologik-xarita": 150_000,
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
 * @param cap Yuqori chegara (`WORKER_JOB_TIMEOUT_MS`). Byudjet undan
 *   oshmaydi — operator bitta o'zgaruvchi bilan hamma narsani cheklay
 *   olishi kerak.
 */
export function budgetFor(tool: ToolConfig, values: FormValues, cap: number): number {
  const fixed = FIXED[tool.id];
  let want = fixed;
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
          : MIN_BUDGET_MS + size * PER_PAGE_MS;
  }
  return Math.max(MIN_BUDGET_MS, Math.min(want, Math.max(MIN_BUDGET_MS, cap)));
}
