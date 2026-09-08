import { bodyRules } from "../slide-audience";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Brif — auditoriya, taqdimot turi, asosiy g'oyalar, mahalliy misollar.
 *
 * WP-0a: hozirgi `slideSystem` qatorlari AYNAN ko'chirildi (regressiya
 * yo'q). WP-A: 14 auditoriya `note` si allaqachon `AUDIENCE_RULES` da;
 * taqdimot turi, `keyIdeas`, `localExamples` qatorlari qo'shiladi.
 */
export function briefLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void ctx;
  const rules = bodyRules(meta, tpl.id);
  return [
    /*
     * ORALIQ beriladi, faqat yuqori chegara emas — model faqat shift
     * berilsa eng qisqasini tanlaydi (jonli o'lchovda 36% to'ldirish).
     */
    `Har slaydda ${rules.minBullets}–${rules.maxBullets} ta bullet (agenda'da ${Math.max(3, rules.agendaMax - 1)}–${rules.agendaMax}).`,
    `Har bullet — TO‘LIQ gap, ${Math.round((rules.bulletChars * 0.55) / 8)}–${Math.round(rules.bulletChars / 8)} so‘z. Bir-ikki so‘zli sarlavhasimon parcha YOZMANG: fikr tugallangan bo‘lsin.`,
    rules.note,
    /*
     * «Premium» paket KONTENTGA ham ta'sir qiladi (oddiy vosita).
     */
    meta.premiumVisuals
      ? [
          `PREMIUM DARAJA:`,
          `— notes 80–120 so‘z: notiq nima deyishi, misol va o‘tish jumlasi bilan;`,
          `— kamida bitta slaydda taqqoslash mumkin bo‘lgan ANIQ ko‘rsatkichlar (stats), lekin uydirma emas — mavzuning o‘z birliklari;`,
          `— kamida bitta slaydda qarama-qarshi qo‘yish (compare yoki twoCol) chuqur tahlil bilan.`,
        ].join("\n")
      : "",
  ];
}
