import { extractMeta } from "./meta";
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
  translation: 240_000,
  glossary: 150_000,
  keys: 150_000,
  "lesson-plan": 120_000,
  "texnologik-xarita": 150_000,
  resume: 90_000,
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

/**
 * @param cap Yuqori chegara (`WORKER_JOB_TIMEOUT_MS`). Byudjet undan
 *   oshmaydi — operator bitta o'zgaruvchi bilan hamma narsani cheklay
 *   olishi kerak.
 */
export function budgetFor(tool: ToolConfig, values: FormValues, cap: number): number {
  const fixed = FIXED[tool.id];
  let want = fixed;
  if (want === undefined) {
    // Slaydda `targetPages` — betlar emas, SLAYDLAR soni (`extractMeta`).
    const size = extractMeta(tool, values).targetPages;
    want =
      tool.id === "slide"
        ? SLIDE_BASE_MS + size * SLIDE_PER_SLIDE_MS
        : MIN_BUDGET_MS + size * PER_PAGE_MS;
  }
  return Math.max(MIN_BUDGET_MS, Math.min(want, Math.max(MIN_BUDGET_MS, cap)));
}
