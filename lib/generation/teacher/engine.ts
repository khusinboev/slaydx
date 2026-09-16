/**
 * O'QITUVCHI DVIGATELI — STUB (AUDIT-20 R0).
 *
 * Haqiqiy dvigatel WP-A (dars rejasi / xarita / glossariy / keys) va
 * WP-B (test) da yoziladi. R0 da faqat SHARTNOMA qulflanadi: dispatch
 * (`write-llm.ts`) shu funksiyani chaqiradi, u esa `null` qaytaradi.
 *
 * Nega `throw` EMAS: `null` — «men bu ishni bajarmadim» degani, va
 * chaqiruvchi shundan keyin ESKI yo'lga (`write-specials.ts`) tushadi.
 * Agar bu yerda xato tashlansa, R0 kommitidan keyin dars rejasi,
 * glossariy, keys va texnologik xarita ishlab turgan mahsulotda
 * YIQILARDI — substrat kommiti hech qanday xizmatni sindirmasligi
 * kerak. Shu xatti-harakat `tests/generation.test.mts` da qulflangan.
 *
 * `test` vositasida eski yo'l YO'Q (yangi xizmat) — u WP-B gacha
 * hujjat yaratmaydi; R0 dan keyingi birinchi ish shu (AUDIT-20 §6).
 */
import type { CostMeter } from "../llm-roles";
import type { TranslationSource } from "../source-types";
import type { FormValues } from "../../types";
import type { AcademicDoc, DocMeta } from "../types";

/** `WorkStage`/`ArticleStage` bilan AYNI shakl — `write-llm.ts` bittasini uzatadi. */
export type TeacherStage = { progress: number; step: string };

export type TeacherBuildOpts = {
  deadline: number;
  /** Fayl rejimi: yuklangan manba (`worker.ts sourceForJob`). */
  source?: TranslationSource;
  onStage?: (ev: TeacherStage) => void;
};

export type TeacherCost = ReturnType<CostMeter["toJson"]>;

export type TeacherBuilt = { doc: AcademicDoc; cost: TeacherCost };

/**
 * Dvigatelning SHARTNOMASI — WP-A/WP-B da faqat TANASI to'ladi, imzo
 * o'zgarmaydi (boshqa WP lar shu tipga tayanadi).
 */
export type TeacherBuilder = (meta: DocMeta, values: FormValues, opts: TeacherBuildOpts) => Promise<TeacherBuilt | null>;

/** `null` — dvigatel hali yo'q, chaqiruvchi ESKI yo'lni tanlasin. */
export const buildTeacherDoc: TeacherBuilder = async () => null;
