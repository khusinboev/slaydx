import { sourceBlock } from "../prompts";
import type { SlideTemplate } from "../slide-templates";
import type { DocMeta } from "../types";
import type { SlidePromptCtx } from "./ctx";

/**
 * Manba — foydalanuvchi fayli (`sourceBlock`) va internet tadqiqoti.
 *
 * Ikkovi BIRGA kelishi mumkin: foydalanuvchi hujjat yuklagan va ustiga
 * internet qidiruvini yoqqan. Shuning uchun `sourceBlock` hech qachon
 * almashtirilmaydi, tadqiqot uning USTIGA qo'shiladi.
 *
 * Tadqiqot yo'q bo'lsa (`ctx.research` — `null`) prompt AYNAN ilgarigidek
 * qoladi: qidiruvni yoqmagan foydalanuvchi uchun regressiya yo'q.
 */
export function researchLines(meta: DocMeta, tpl: SlideTemplate, ctx: SlidePromptCtx): string[] {
  void tpl;
  const lines = [sourceBlock(meta)];
  const research = ctx.research;
  const facts = research?.facts.trim();
  if (!facts) return lines;

  lines.push(
    `TADQIQOT NATIJASI (internetdan, tekshirilgan):`,
    `--- FAKTLAR BOSHI ---`,
    facts,
    `--- FAKTLAR OXIRI ---`,
    `Bu faktlarga tayanib yozing. Faktda yo‘q raqamni o‘ylab topmang.`,
  );

  /*
   * Manbalar RAQAMLANGAN holda beriladi, chunki model matnda ularga
   * murojaat qiladi («[2] ma'lumotiga ko'ra»). Havolalarni promptga
   * qo'ymaymiz: references slaydini koordinator `SlideResearch.sources`
   * dan o'zi quradi, model esa uzun URL ni bandga ko'chirib, slaydni
   * buzardi.
   */
  if (research && research.sources.length) {
    const list = research.sources.map((s, i) => `${i + 1}) ${s.title}`).join(" ");
    lines.push(`MANBALAR (references slaydi uchun, faqat shulardan): ${list}`);
  }
  return lines;
}
