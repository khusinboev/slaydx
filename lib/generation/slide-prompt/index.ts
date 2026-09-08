import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import { baseLines } from "./base";
import { briefLines } from "./brief";
import type { SlidePromptCtx } from "./ctx";
import { extensionLines } from "./extensions";
import { identityLines } from "./identity";
import { researchLines } from "./research";
import { structureLines } from "./structure";

export type { SlidePromptCtx } from "./ctx";
export { deckJsonSchema } from "./schema";

/**
 * Slayd tizim prompti — nomlangan BO'LIMLARDAN yig'iladi.
 *
 * Ilgari 90 qatorlik bitta funksiya `slide-write.ts` ichida edi va unga
 * har parametr qo'shganda bir necha ish oqimi bitta faylga tegardi.
 * Endi har bo'lim o'z faylida (`brief` — auditoriya/tur, `structure` —
 * bloklar, `research` — tadqiqot…); `slide-write.ts` prompt matnini
 * umuman bilmaydi. Bo'lim `string[]` qaytaradi, bo'sh satr tashlanadi.
 */
export function slideSystem(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx = {}): string {
  return [
    ...baseLines(meta, tpl, ctx),
    ...identityLines(meta, tpl, ctx),
    ...briefLines(meta, tpl, ctx),
    ...structureLines(meta, tpl, ctx),
    ...extensionLines(meta, tpl, ctx),
    ...researchLines(meta, tpl, ctx),
  ]
    .filter(Boolean)
    .join("\n");
}
