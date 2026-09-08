import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Tuzilma — layout qoidalari, bo'sh slaydlarni to'ldirish, jadval.
 *
 * WP-0a: hozirgi qatorlar AYNAN. WP-B: bloklar (reja bandlari soni,
 * quiz/references qoidalari, diagramma signali) qo'shiladi.
 */
export function structureLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void meta;
  void tpl;
  void ctx;
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
  ];
}
