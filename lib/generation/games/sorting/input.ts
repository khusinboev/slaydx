/**
 * SARALASH O'YINI KIRISHI (AUDIT-22 WP-D) — formadan dvigatelgacha.
 *
 * `flashcards/input.ts` naqshi: `FormValues` bilan `SortingInput`
 * orasidagi YAGONA ko'prik. `extractMeta` umumiy va u `categoryCount`,
 * `itemsPerCategory`, `sortingType` maydonlarini BILMAYDI; mavzu, til,
 * fan va sinf esa `meta` dan keladi.
 *
 * ── Nega «va'da» toifa sonidan emas, KO'PAYTMADAN hisoblanadi
 *
 * Formada toifa soni 2–6 chipi bilan so'raladi, lekin «Qarama-qarshi
 * juftlik» turida toifa REYESTR bo'yicha doim IKKITA
 * (`limits.categories: [2]`). Agar dvigatel shunda 2 × `itemsPerCategory`
 * element bersa, `gamePromisedCount` (toifa × element — u turni
 * BILMAYDI) ko'proq va'da qilgan bo'lib chiqar va darvoza
 * (`gameGateFail`) hujjatni RAD ETARDI: 4 toifa × 5 element tanlagan
 * o'qituvchi ikki qutbli o'yinni STANDART forma bilan umuman ola
 * olmasdi (20 va'da, 10 natija — 70 % chegarasidan past).
 *
 * Shuning uchun VA'DA (`promisedItems`) saqlanadi va elementlar mavjud
 * toifalarga QAYTA TAQSIMLANADI: ikki qutbli o'yinda har qutb ko'proq
 * element oladi, JAMI esa o'zgarmaydi — o'quvchi baribir shuncha
 * kartani joylashtiradi va narx ham shu hajmga to'langan. Oddiy
 * «Toifalar bo'yicha» turida formula ayni forma qiymatlarini qaytaradi
 * (`promised / categoryCount === itemsPerCategory`), ya'ni bu shox u
 * yerda hech narsani o'zgartirmaydi.
 *
 * Server importi YO'Q (izomorf: forma zondidan ham chaqiriladi).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import { gameTypeOf, type SortingTypeSpec } from "../registry";
import { GAME_LIMITS, normalizeCategoryCount, normalizeItemsPerCategory } from "../types";

export type SortingLang = "uz" | "ru" | "en";

export type SortingInput = {
  /** Reyestr tur id (`toifa` | `qarama-qarshi`) — `GameModel.type` bilan AYNI. */
  type: string;
  topic: string;
  subject: string;
  /** Hujjat tili (18 til, to'liq kod) — promptga ham, modelga ham shu ketadi. */
  language: string;
  /** Prompt yozilishi uchun uch guruhga siqilgan til. */
  lang: SortingLang;
  /** 1–11; 0 — sinf ko'rsatilmagan. */
  grade: number;
  categoryCount: number;
  itemsPerCategory: number;
  extra: string;
};

/**
 * Bitta toifadagi elementning MUTLAQ chegarasi.
 *
 * Forma chipi 3–8 (`itemsPerCategoryCounts`), lekin ikki qutbli o'yinda
 * eng katta buyurtma (6 × 8 = 48) IKKI ustunga taqsimlanadi — 24 tadan.
 * Chegara shu eng yomon holatga qo'yilgan: undan pastda va'da
 * bajarilmasdi va darvoza hujjatni rad etardi.
 */
export const SORT_ITEMS_PER_CATEGORY_CAP = GAME_LIMITS.itemsPerCategoryMax * 3;

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";

export function sortingLangOf(language: string): SortingLang {
  const l = String(language ?? "").toLowerCase();
  return l === "ru" ? "ru" : l === "en" ? "en" : "uz";
}

/** Tur QO'LLAYDIGAN toifa soni; chip ro'yxatidan tashqari qiymat → turning standarti. */
export function sortingCategoryCount(spec: SortingTypeSpec, v: unknown): number {
  const n = Number(v);
  return spec.limits.categories.includes(n) ? n : spec.limits.categoriesDefault;
}

/**
 * Va'da qilingan JAMI element — `gamePromisedCount("sorting", …)` bilan
 * AYNI formula (darvoza, byudjet va `delivered` bitta sondan o'qisin).
 */
export function promisedItems(values: FormValues): number {
  return normalizeCategoryCount(values.categoryCount) * normalizeItemsPerCategory(values.itemsPerCategory);
}

export function sortingInputFromValues(meta: DocMeta, values: FormValues): SortingInput {
  const spec = gameTypeOf("sorting", values.sortingType);
  const language = str(values.language, 12) || meta.language || "uz";
  const grade = Math.max(0, Math.min(11, Math.round(Number(values.grade ?? meta.grade ?? 0)) || 0));
  const categoryCount = sortingCategoryCount(spec, values.categoryCount);
  const perCategory = Math.round(promisedItems(values) / categoryCount);
  return {
    type: spec.id,
    topic: str(values.topic, GAME_LIMITS.topicChars) || str(meta.topic, GAME_LIMITS.topicChars),
    subject: str(values.subject, 120) || str(meta.subject, 120),
    language,
    lang: sortingLangOf(language),
    grade,
    categoryCount,
    itemsPerCategory: Math.min(SORT_ITEMS_PER_CATEGORY_CAP, Math.max(GAME_LIMITS.itemsPerCategoryMin, perCategory)),
    extra: typeof values.extra === "string" ? values.extra.trim().slice(0, GAME_LIMITS.extraChars) : str(meta.extra, GAME_LIMITS.extraChars),
  };
}
