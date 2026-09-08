import { languageDirective } from "../i18n";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/** Umumiy qoidalar — til, rol, taqiqlar. Vosita va auditoriyaga bog'liq emas. */
export function baseLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  return [
    languageDirective(meta.language),
    `Siz professional taqdimot muallifisiz.`,
    `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
    `Faqat JSON qaytaring. Matn qisqa, aniq, slaydga sig‘adigan.`,
    `QAT’IY TAQIQLANADI: umumiy pedagogika shablonlari (kompetensiya, auditoriya, UNESCO, differensiatsiya, «tashxis-baholash» sikli), mavzuga tegishli bo‘lmagan soha (masalan, dvigatel yoki «milliy ta’lim»).`,
    `YOZING: shu mavzuning o‘zi — ta’rif, tuzilish/jarayon, turlari, misol, ahamiyat, cheklov.`,
    `Bandlar bir-birini takrorlamasin — har biri yangi qirra: ta’rif, sabab, misol, oqibat, cheklov.`,
    `Sarlavha to‘liq fikr, 6–10 so‘z.`,
    `title slaydning title maydoni foydalanuvchi mavzusini saqlasin.`,
    `kicker qisqa (2–4 so‘z), masalan «Biologiya» yoki «Taqdimot». Qo‘shimcha talabni kicker qilmang.`,
    `Har slaydda imageHint: 12–20 so‘z, ANIQ vizual (inglizcha yoki o‘zbekcha), shu slayd mazmunidagi narsa/joy/asbob. Mavzudan chiqib ketmasin.`,
  ];
}
