import { QUIZ_COUNT_FALLBACK, orderedBlocks } from "../slide-blocks";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Tuzilma — layout qoidalari, bo'sh slaydlarni to'ldirish, jadval.
 *
 * WP-0a: hozirgi qatorlar AYNAN. WP-B: bloklar qatorlari qo'shildi —
 * reja bandlari SONI, quiz/references qoidalari, diagramma signali.
 *
 * Nega bu qatorlar kerak. `blocksToBeats` blokni beats'ga qo'yadi va
 * model rolni (`Nazorat testi — 5 ta savol…`) ko'radi, lekin ROL
 * SXEMANI aytmaydi: `quiz` da nechta variant bo'lishi, `references`
 * da manbani uydirmaslik, `stats` da birlik bir xil bo'lishi. AUDIT-8
 * shuni ko'rsatdi — model ko'rsatmaga to'liq rioya qilsa ham, ko'rsatma
 * o'zi to'liq bo'lmasa chiqish buziladi. Shuning uchun har blok
 * yoqilganda unga TEGISHLI qoida ham promptga tushadi, yoqilmaganda
 * esa tushmaydi (ortiqcha qator modelni chalg'itadi).
 */
export function structureLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  void ctx;
  const blocks = orderedBlocks(meta.blocks, meta.quizCount ?? 0);
  const has = (id: string) => blocks.some((b) => b.id === id);
  // `blocksToBeats` bilan BIR XIL shart: reja bloki bor va agenda so'ralgan.
  const agenda = has("reja") && meta.agendaSlide !== false;
  const quizCount = (meta.quizCount ?? 0) > 0 ? meta.quizCount : QUIZ_COUNT_FALLBACK;

  return [
    /*
     * BO'SH SLAYDLARNI to'ldirish — section/closing subtitle sig'imi
     * maketdan o'lchangan (~325 / ~160 belgi).
     */
    `section slaydda subtitle — BO‘SH QOLMASIN: 20–35 so‘zlik kirish, shu bo‘limda nima ko‘rilishini aytadi.`,
    `closing slaydda subtitle — 15–25 so‘zlik xulosa: asosiy fikr va keyingi qadam. «Savollar va muhokama» kabi bo‘sh ibora emas.`,
    `twoCol va compare: har ustunda 3–4 band, har biri to‘liq gap (10–15 so‘z). Bir so‘zli yorliq emas.`,
    `process: har bosqichning text maydoni to‘liq gap (10–15 so‘z) — nima qilinadi va natija nima.`,
    `stats ga uydirma milliard/tonna/foiz YOZILMASIN. Formula, bosqich soni, ma’lum birlik (masalan C6H12O6, 2 bosqich) mumkin.`,
    /*
     * Qator soni POLI 3: «2–5» so'ralganda model 2 qator qaytarar,
     * jadval slaydning yuqori uchdan birida qolardi (AUDIT-8).
     */
    `table layout: 2–4 ustun, 3–5 qator. Katak matni qisqa (2–5 so‘z). Uydirma raqam emas — tasnif, qiyos yoki bosqich xossalari.`,

    // ── Bloklar (AUDIT-9 WP-B). Har qator faqat O'Z bloki yoqilganda.
    /*
     * Reja bandlari soni ANIQ aytiladi. `brief.ts` dagi «agenda'da N–M»
     * oralig'i auditoriya qoidasidan keladi va model doim pastki
     * chegarani tanlardi — foydalanuvchi 6 ta band so'raganda 5 tasi
     * chiqardi. Bu qator oraliqni emas, SONNI qo'yadi.
     */
    agenda ? `agenda: AYNAN ${meta.planItems} ta band, har biri 3–7 so‘z, raqamlanmagan.` : "",
    has("test")
      ? `quiz layout: ${quizCount} ta savol, har savolda AYNAN 4 variant (options), answer — to‘g‘ri variant indeksi 0..3, bittasi to‘g‘ri; savol shu dekaning mazmunidan; variantlar bir xil uzunlikda, «hammasi to‘g‘ri» yo‘q.`
      : "",
    has("adabiyotlar")
      ? `references layout: refs — faqat berilgan manbalardan (TADQIQOT bo‘limi), bo‘lmasa bo‘sh qoldiring; uydirma muallif/DOI YOZMANG.`
      : "",
    has("diagramma")
      ? `stats (diagramma): 3–4 ko‘rsatkich, HAMMASI bir xil birlikda (masalan hammasi %), taqqoslanadigan; chart: true.`
      : "",
    /*
     * Umumiy niyat. Rollar beats'da alohida keladi, lekin butun deka
     * qanday tuzilishini bitta qatorda ko'rish modelga bloklarni
     * bir-biriga bog'lashga yordam beradi (masalan «maqsadlar» dagi
     * fe'l «uyga vazifa» da takrorlanmasin).
     */
    blocks.length ? `TUZILMA BLOKLARI (rejada shu tartibda): ${blocks.map((b) => b.id).join(", ")}.` : "",
  ];
}
