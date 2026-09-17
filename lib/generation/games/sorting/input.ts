/**
 * SARALASH O'YINI KIRISHI (AUDIT-22 WP-D/R) — formadan dvigatelgacha.
 *
 * `flashcards/input.ts` naqshi: `FormValues` bilan `SortingInput`
 * orasidagi YAGONA ko'prik. `extractMeta` umumiy va u `categoryCount`,
 * `itemsPerCategory`, `sortingType` maydonlarini BILMAYDI; mavzu, til,
 * fan va sinf esa `meta` dan keladi.
 *
 * ── «Aylanib o'tish» olib tashlandi (AUDIT-22 R)
 *
 * Formada toifa soni 2–6 chipi bilan so'raladi, lekin «Qarama-qarshi
 * juftlik» turida toifa REYESTR bo'yicha doim IKKITA
 * (`limits.categories: [2]`). Ilgari (`gamePromisedCount` TURNI
 * BILMAGANda) bu nomuvofiqlikni QOPLASH uchun elementlar mavjud
 * toifalarga sun'iy QAYTA TAQSIMLANARDI (`SORT_ITEMS_PER_CATEGORY_CAP`
 * bilan 3× inflatsiya) — aks holda darvoza (`gameGateFail`) hujjatni
 * RAD ETARDI.
 *
 * `gamePromisedCount` ENDI turni biladi (`registry.ts`, uchinchi
 * `type` argumenti): «qarama-qarshi juftlik» uchun va'da HAQIQIY toifa
 * soni (2) × `itemsPerCategory` bilan hisoblanadi — aynan shuncha
 * dvigatel beradi. Shuning uchun bu yerda endi hech narsani qayta
 * taqsimlash SHART EMAS: `categoryCount` va `itemsPerCategory` forma
 * qiymatlaridan TO'G'RIDAN-TO'G'RI (spetsifikatsiya bo'yicha
 * qisqartirilib) olinadi.
 *
 * Server importi YO'Q (izomorf: forma zondidan ham chaqiriladi).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import { gamePromisedCount, gameTypeOf, type SortingTypeSpec } from "../registry";
import { GAME_LIMITS, normalizeItemsPerCategory } from "../types";

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
 * Va'da qilingan JAMI element — `gamePromisedCount("sorting", values,
 * TUR)` bilan AYNI (darvoza, byudjet va `delivered` bitta sondan
 * o'qisin). `sortingType` `values` ichida — alohida argument shart emas.
 */
export function promisedItems(values: FormValues): number {
  return gamePromisedCount("sorting", values as { [k: string]: unknown }, values.sortingType);
}

export function sortingInputFromValues(meta: DocMeta, values: FormValues): SortingInput {
  const spec = gameTypeOf("sorting", values.sortingType);
  const language = str(values.language, 12) || meta.language || "uz";
  const grade = Math.max(0, Math.min(11, Math.round(Number(values.grade ?? meta.grade ?? 0)) || 0));
  // Tur-xos qisqartirish (spec.limits.categories) — «qarama-qarshi
  // juftlik»da bu doim 2. Elementlar ENDI qayta taqsimlanmaydi (R
  // izohi): itemsPerCategory forma chipidan TO'G'RIDAN-TO'G'RI.
  const categoryCount = sortingCategoryCount(spec, values.categoryCount);
  const itemsPerCategory = normalizeItemsPerCategory(values.itemsPerCategory);
  return {
    type: spec.id,
    topic: str(values.topic, GAME_LIMITS.topicChars) || str(meta.topic, GAME_LIMITS.topicChars),
    subject: str(values.subject, 120) || str(meta.subject, 120),
    language,
    lang: sortingLangOf(language),
    grade,
    categoryCount,
    itemsPerCategory,
    extra: typeof values.extra === "string" ? values.extra.trim().slice(0, GAME_LIMITS.extraChars) : str(meta.extra, GAME_LIMITS.extraChars),
  };
}
