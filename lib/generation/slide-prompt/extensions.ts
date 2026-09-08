import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Kengaytmalar — ma'ruzachi izohi, test, qo'shimcha istaklar.
 *
 * WP-0a: `notes` qatori `speakerNotes` bayrog'iga BOG'LANDI (ilgari
 * shartsiz). WP-H: test savollari soni va boshqa bayroqlar.
 */
export function extensionLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  return [
    `Uzun IZOHNI (nazariy chekinish, tarixiy tafsilot) notes ga yozing — bandlar to‘liq bo‘lsin, lekin izohga aylanmasin.`,
    meta.speakerNotes === false
      ? `notes YOZMANG — notes maydonini bo‘sh qoldiring.`
      : `Har slaydda notes: notiq OG‘ZAKI aytadigan matn, 40–80 so‘z. Slayddagi bandlarni takrorlamang — misol, izoh yoki savol qo‘shing.`,
    meta.extra ? `Qo‘shimcha talab: ${meta.extra}` : "",
  ];
}
