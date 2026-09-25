import { plannedBlocks } from "../slide-blocks";
import { bodyWantOf } from "../slide-params";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Kengaytmalar — ma'ruzachi izohi, test, qo'shimcha istaklar.
 *
 * WP-0a: `notes` qatori `speakerNotes` bayrog'iga BOG'LANDI (ilgari
 * shartsiz). WP-H: test savollari soni va boshqa bayroqlar.
 *
 * INT-08 (AUDIT-25 integratsiya sharhi): savollar soni endi
 * `meta.quizCount` dan emas, `plannedBlocks(...).quizBeats` dan olinadi —
 * `structure.ts` xuddi shu hisobni ishlatadi (bitta savol = bitta quiz
 * slayd, `QUIZ_PER_SLIDE`). Sig'im savolni qirqishi mumkin (masalan
 * `quizCount: 10` lekin dekada joy 6 taga yetadi) — promptdagi son BERILGAN
 * emas, REJADA borini aytishi kerak, aks holda model va'da qilingan sondan
 * ortiqni bitta slaydga siqib solardi. Xuddi shunday «Javoblar» slaydi
 * FAQAT `plan.answers` true bo'lganda va'da qilinadi — sig'im uni tashlab
 * yuborgan bo'lsa (`answers: wantAnswers && quizBeats + 1 <= slots`),
 * prompt ham va'da qilmaydi.
 */
export function extensionLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  const plan = plannedBlocks(meta, bodyWantOf(meta.targetPages || undefined, meta.titleSlide));
  return [
    `Uzun IZOHNI (nazariy chekinish, tarixiy tafsilot) notes ga yozing — bandlar to‘liq bo‘lsin, lekin izohga aylanmasin.`,
    meta.speakerNotes === false
      ? `notes YOZMANG — notes maydonini bo‘sh qoldiring.`
      : `Har slaydda notes: notiq OG‘ZAKI aytadigan matn, 40–80 so‘z. Slayddagi bandlarni takrorlamang — misol, izoh yoki savol qo‘shing.`,
    plan.quizBeats > 0
      ? `NAZORAT TESTI: ${plan.quizBeats} ta savol quiz layoutda; javobni SLAYDGA yozmang — faqat answer indeksiga.`
      : "",
    // Izoh o'chiq bo'lsa javoblar yo'qolmasin — oxirida «Javoblar» slaydi (answers layout).
    // FAQAT rejada bu slayd bor bo'lsa (`plan.answers`) — aks holda sig'im uni
    // tashlab yuborgan va prompt bo'lmagan slaydni va'da qilib qo'yardi (INT-08).
    plan.answers
      ? `Test javoblari ma’ruzachi izohisiz ko‘rinmaydi — ular oxirgi «Javoblar» slaydida beriladi (answers layout).`
      : "",
    meta.extra ? `Qo‘shimcha talab: ${meta.extra}` : "",
  ];
}
