import { bodyRules } from "../slide-audience";
import { purposeDefaults } from "../slide-purpose";
import { layoutWordTargets, wordTargetLines } from "../slide-quality";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Brif — auditoriya, taqdimot turi, asosiy g'oyalar, mahalliy misollar.
 *
 * WP-0a: hozirgi `slideSystem` qatorlari AYNAN ko'chirildi (regressiya
 * yo'q). WP-A: 14 auditoriya `note` si allaqachon `AUDIENCE_RULES` da;
 * taqdimot turi (`PURPOSE_DEFAULTS[…].guidance`), `keyIdeas`,
 * `localExamples` qatorlari qo'shildi.
 */
export function briefLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void ctx;
  const rules = bodyRules(meta, tpl.id);
  const purpose = purposeDefaults(meta.slidePurpose);
  const bullet = layoutWordTargets(rules, tpl.visual).bullet;
  return [
    /*
     * ORALIQ beriladi, faqat yuqori chegara emas — model faqat shift
     * berilsa eng qisqasini tanlaydi (jonli o'lchovda 36% to'ldirish).
     */
    `Har slaydda ${rules.minBullets}–${rules.maxBullets} ta bullet (agenda'da ${Math.max(3, rules.agendaMax - 1)}–${rules.agendaMax}).`,
    /*
     * Band so'z oralig'i — `slide-quality.ts` dagi detektor bilan BIR
     * manba: quyi chegara aynan «yupqa band» chegarasi, yuqorisi qirqish
     * (`bulletChars`) va deka vizualining quti sig'imidan oshmaydi (AUDIT-25).
     */
    `Har bullet — TO‘LIQ gap, ${bullet.min}–${bullet.max} so‘z. Bir-ikki so‘zli sarlavhasimon parcha YOZMANG: fikr tugallangan bo‘lsin.`,
    /*
     * Har maket uchun so'z oralig'i (AUDIT-25 S4) — qo'lda yozilgan son
     * emas: `BodyRules` (auditoriya × matn hajmi) va deka vizualining
     * QUTILARIDAN (`planSlide`, auditoriya shrift poli) hisoblanadi.
     * Jonli dekada process matni 3–4 so'z, section subtitle bo'sh, test
     * variantlari «…» bilan kesilgan edi — endi model aniq oraliq oladi.
     */
    ...wordTargetLines(rules, tpl.visual),
    rules.note,
    /*
     * Taqdimot turi — `general` da `guidance` bo'sh, qator umuman
     * tashlanadi (`slideSystem` bo'sh qatorlarni `.filter(Boolean)`
     * bilan olib tashlaydi).
     */
    purpose.guidance ? `TAQDIMOT TURI — ${purpose.label}. ${purpose.guidance}` : "",
    /*
     * Asosiy g'oyalar — foydalanuvchi kiritgan bo'lsa, har biri kamida
     * bitta slaydda (sarlavha yoki birinchi banddan) ko'rinishi shart.
     */
    ...(meta.keyIdeas.length
      ? [
          `ASOSIY G‘OYALAR — har biri KAMIDA bitta slaydda ochilsin, sarlavhada yoki birinchi bandda ko‘rinsin:`,
          ...meta.keyIdeas.map((idea, i) => `${i + 1}) ${idea}`),
        ]
      : []),
    /*
     * Mahalliy misollar — O'zbekiston kontekstidagi aniq misol, lekin
     * uydirma raqam bilan emas (model bilmagan raqamni o'ylab topmasin).
     */
    meta.localExamples
      ? `MAHALLIY MISOLLAR: kamida 2 slaydda O‘zbekiston kontekstidagi aniq misol (shahar, muassasa, mahsulot, statistika). Uydirma raqam YO‘Q — raqam bilmasang «taxminan» de yoki raqamsiz misol keltir.`
      : "",
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
