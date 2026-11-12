import { languageDirective } from "../i18n";
import { TITLE_CHARS, TITLE_WORDS } from "../slide-quality";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";
import { slideVoice, voiceLines } from "../slide-voice";

/** Umumiy qoidalar — til, rol, taqiqlar. Vosita va auditoriyaga bog'liq emas. */
export function baseLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void ctx;
  return [
    languageDirective(meta.language),
    // Voice by the resolved audience (docs/slide-quality/SPEC.md §C): a good student presenting, or a professional.
    ...voiceLines(slideVoice(meta.slideAudience, tpl.id)),
    `Mavzu: «${meta.topic}». Fan: ${meta.subject || "—"}.`,
    `Faqat JSON qaytaring. Matn qisqa, aniq, slaydga sig‘adigan.`,
    `QAT’IY TAQIQLANADI: umumiy pedagogika shablonlari (kompetensiya, auditoriya, UNESCO, differensiatsiya, «tashxis-baholash» sikli), mavzuga tegishli bo‘lmagan soha (masalan, dvigatel yoki «milliy ta’lim»).`,
    `YOZING: shu mavzuning o‘zi — ta’rif, tuzilish/jarayon, turlari, misol, ahamiyat, cheklov.`,
    `Bandlar bir-birini takrorlamasin — har biri yangi qirra: ta’rif, sabab, misol, oqibat, cheklov.`,
    `Sarlavha to‘liq fikr, ${TITLE_WORDS.min}–${TITLE_WORDS.max} so‘z, ≤ ${TITLE_CHARS} belgi.`,
    `title slaydning title maydoni foydalanuvchi mavzusini saqlasin.`,
    `Formulalarni (kimyo, matematika, fizika, geometriya) Unicode belgilari bilan yozing: H₂O, CₙH₂ₙ₊₁COOH, Ca²⁺, x² + y² = r², √2, π, sin²α, E = mc², v = v₀ + at, F = m·a, 30°, ∠ABC, △ABC, a ⊥ b, a ∥ b, Σ, ∫, ≤, ≠, →. Formulada LaTeX, «_» va «^» yozmang (C_n, x^2, \\frac emas).`,
    `kicker qisqa (2–4 so‘z), masalan «Biologiya» yoki «Taqdimot». Qo‘shimcha talabni kicker qilmang.`,
    `Har slaydda imageHint: 12–20 so‘z, ANIQ vizual (inglizcha yoki o‘zbekcha), shu slayd mazmunidagi narsa/joy/asbob. Mavzudan chiqib ketmasin.`,
  ];
}
