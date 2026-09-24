import { plannedBlocks, type SlideBlockId } from "../slide-blocks";
import { bodyWantOf } from "../slide-params";
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
  /*
   * Bloklar ro'yxati `blocksToBeats` bilan AYNAN bir manbadan —
   * beats'da bor slayd promptda tushib qolsa, model uni qanday
   * to'ldirishni bilmaydi va slayd bo'sh chiqadi (AUDIT-8).
   * Shuning uchun `internetSearch` ham shu yerga uzatiladi: u
   * `references` beat'ini keltiradi, demak qoidasi ham kerak.
   */
  /*
   * AUDIT-25: blok endi sig'masa TASHLANADI — shuning uchun «yoqilgan»
   * bloklar emas, dekaga HAQIQATAN tushadiganlar (`plannedBlocks`,
   * `blocksToBeats` bilan bitta hisob). Aks holda prompt tashlangan
   * `references`/`diagramma` qoidasini va'da qilardi (P1 sharhi, 2-band).
   * Agenda ham shu yerdan: 4 slaydli «reja + test» dekada agenda reja
   * slaydiga yon beradi, prompt esa uni so'rab turmasin.
   */
  const plan = plannedBlocks(meta, bodyWantOf(meta.targetPages || undefined, meta.titleSlide));
  const has = (id: string) => plan.kept.includes(id as SlideBlockId);
  const agenda = plan.agenda;
  const planN = plan.planN;

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
    agenda ? `agenda: AYNAN ${planN} ta band, har biri 3–7 so‘z, raqamlanmagan.` : "",
    /*
     * REJA = SHARTNOMA (AUDIT-25). Rejadagi har bandning o'z slaydi bor —
     * ketma-ketlikda «REJA i-band: …» roli bilan (`blocksToBeats`
     * 10-qoidasi). Ilgari agenda bandlari mavzudan, slaydlar esa
     * shablondan alohida yozilardi va biri ikkinchisiga mos kelmasdi.
     * Agenda baribir yozuvdan keyin shu slaydlar sarlavhasidan qayta
     * quriladi (`writeSlidesWithLlm`) — bu qator model sarlavhani
     * reja bandi NOMI qilib yozishi uchun.
     */
    `REJA BANDLARI: rejada ${planN} ta band bor — ketma-ketlikdagi «REJA i-band: …» slaydlari aynan shu bandlar, tartibi bilan. Band bo‘lim (section) bilan ochilsa — bo‘lim sarlavhasi band nomi, keyingi slayd uning mazmuni. «:» dan keyingi so‘z faqat slayd shakliga ishora, band nomi emas: band nomini mavzudan o‘zingiz tuzing (3–7 so‘z). «REJA i-band:» yozuvini sarlavhaga ko‘chirmang.${agenda ? " agenda bandlari AYNAN shu slaydlar sarlavhalari, shu tartibda." : ""}`,
    `Sarlavha boshida TARTIB raqami bo‘lmasin («1.», «2)», «I.» yo‘q; «3D», «5 ta qoida» — mumkin) — tartib raqamini maket o‘zi qo‘yadi.`,
    /*
     * SAVOLLAR SONI bu qatordan OLINDI (X-3).
     *
     * Ilgari bu yerda «${quizCount} ta savol» turardi va model shuncha
     * savolni BITTA `quiz` slaydiga solardi; `finalizeQuiz` esa uni
     * savol soncha slaydga ajratib, dekani rejadan uzun qilardi.
     * Endi reja `blocksToBeats` da savol soncha `quiz` beat qo'yadi
     * (8-qoida) va SON rollarda keladi («…jami 5 ta savol — 2-savol»).
     * Bu qator faqat SLAYD ichidagi sxemani aytadi: bitta savol, 4
     * variant. Ikkita manba bo'lsa ular ajralib ketardi — deka
     * uzunligiga sig'magan savollar tashlanadi, prompt esa hamon eski
     * sonni talab qilib turardi.
     */
    has("test")
      ? `quiz layout: HAR quiz slaydida AYNAN BITTA savol (nechta savol kerakligi rejadagi quiz slaydlari sonidan ko‘rinadi), har savolda AYNAN 4 variant (options), answer — to‘g‘ri variant indeksi 0..3, bittasi to‘g‘ri; savol shu dekaning mazmunidan; variantlar bir xil uzunlikda, «hammasi to‘g‘ri» yo‘q. Savollar bir-birini takrorlamasin.`
      : "",
    /*
     * `answers` slaydi rejada bo'lsa (izohlar o'chiq) uni `finalizeQuiz`
     * to'ldiradi — model yozgani baribir ustiga yoziladi. Shuning uchun
     * modelga «vaqt sarflama» deb aytiladi: aks holda u kalitni
     * O'YLAB TOPADI va uning javoblari savollarga mos kelmasdi.
     */
    has("test") ? `answers layout: javob kalitini O‘ZINGIZ yozmang — bo‘sh bullets qoldiring, kalit avtomatik to‘ldiriladi.` : "",
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
    plan.kept.length ? `TUZILMA BLOKLARI (rejada shu tartibda): ${plan.kept.join(", ")}.` : "",
  ];
}
