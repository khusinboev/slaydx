import "server-only";
import { polishGeneration, type PolishDeps, type PolishDocResult } from "./doc-polish";

/**
 * ESKI NOM — mantiq `doc-polish.ts` ga ko'chdi (AUDIT-19 WP-E1).
 *
 * Maqola 3 (AUDIT-18) da bu modul maqolaga QATTIQ bog'langan edi
 * (`cur.adapter.id !== "article"` → 409). Insho ham hisobot + avto-sayqal
 * bilan kelgach, farq faqat uch nuqtada ekani ko'rindi va server qismi
 * umumlashtirildi. Bu fayl yupqa o'ram bo'lib qoladi: eski
 * chaqiruvchilar va testlar sinmasin.
 */

export { POLISH_TIMEOUT_MS } from "./doc-polish";
export type { PolishDeps };
export type PolishArticleResult = PolishDocResult;

/** @deprecated `polishGeneration` — adapter bo'yicha (maqola/insho). */
export const polishArticle = polishGeneration;
