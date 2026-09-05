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
  slide: 180_000,
  translation: 240_000,
  glossary: 150_000,
  keys: 150_000,
  "lesson-plan": 120_000,
  "texnologik-xarita": 150_000,
  resume: 90_000,
};

const PER_PAGE_MS = 9_000;

/**
 * @param cap Yuqori chegara (`WORKER_JOB_TIMEOUT_MS`). Byudjet undan
 *   oshmaydi — operator bitta o'zgaruvchi bilan hamma narsani cheklay
 *   olishi kerak.
 */
export function budgetFor(tool: ToolConfig, values: FormValues, cap: number): number {
  const fixed = FIXED[tool.id];
  const want = fixed ?? MIN_BUDGET_MS + extractMeta(tool, values).targetPages * PER_PAGE_MS;
  return Math.max(MIN_BUDGET_MS, Math.min(want, Math.max(MIN_BUDGET_MS, cap)));
}
