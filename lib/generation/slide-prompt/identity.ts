import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Kimlik — muallif, lavozim, tashkilot.
 *
 * Titul slaydining `subtitle` maydoni shu ma'lumotdan yig'iladi (model
 * yozadi), kolontitul esa `deckFooter` dan (maket). Logo promptga
 * tushmaydi — u `planSlide` qatlami. Bo'sh maydon qatorsiz qoladi;
 * uchalasi bo'sh bo'lsa umumiy ko'rsatma ham chiqmaydi.
 */
export function identityLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  const lines: string[] = [];
  if (meta.author) lines.push(`MUALLIF: ${meta.author}`);
  if (meta.position) lines.push(`LAVOZIM: ${meta.position}`);
  const org = meta.organization || meta.university;
  if (org) lines.push(`TASHKILOT: ${org}`);
  if (lines.length) {
    lines.push(
      `Titul slaydining subtitle maydoniga muallif, lavozim va tashkilotni «Muallif — Lavozim, Tashkilot» tartibida yozing; boshqa slaydlarda takrorlamang.`,
    );
  }
  return lines;
}
