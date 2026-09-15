/**
 * Maqola QO'RIQCHISI (Maqola 2) — model javobini qabul qilishdan oldin.
 *
 * Umumiy qism (iqtibos tozalash, manbasiz foizlar, foydalanuvchi
 * raqamlari, «suv» iboralar, so'z hisobi) AUDIT-19 R0-A da NEYTRAL
 * qatlamga ko'chdi — `lib/generation/report/guard.ts`: kurs ishi, referat
 * va insho dvigatellari ham aynan shu tekshiruvdan o'tadi. Bu yerda
 * RE-EXPORT (mavjud importlar o'z joyida) va maqolaga XOS qism —
 * `skeletonCoverage` (skelet `ArticleType` ga bog'liq).
 */
import type { Block } from "../types";
import type { ArticleType } from "./types";

export { factNumbers, guardSection, missingFactNumbers, numbersOf, wordsOf } from "../report/guard";
export type { GuardOpts, SectionGuardReport } from "../report/guard";

/**
 * Skeletga moslik: `required` bo'limlar (ixtiyoriysiz) rejada/hujjatda
 * bormi. `body` kabi erkin bo'limlar `body-1`, `body-2` id bilan keladi —
 * prefiks bo'yicha mos deb olinadi.
 */
export function skeletonCoverage(type: ArticleType, sections: { id: string; blocks?: Block[] }[]): { missing: string[]; hardMissing: string[] } {
  const present = (id: string) => sections.some((s) => (s.id === id || s.id.startsWith(`${id}-`)) && (s.blocks === undefined || s.blocks.length > 0));
  const missing = type.skeleton.filter((s) => s.required && !present(s.id)).map((s) => s.id);
  const hardMissing = type.skeleton.filter((s) => s.hard && !present(s.id)).map((s) => s.id);
  return { missing, hardMissing };
}
