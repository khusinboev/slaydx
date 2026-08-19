import { buildAcademicDoc } from "./content";
import { llmEnabled as llmKeyPresent } from "./llm";
import { extractMeta } from "./meta";
import { targetWords, wordCount } from "./quality";
import { renderDocx } from "./render-docx";
import { renderHtml } from "./render-html";
import { renderPptx } from "./render-pptx";
import { buildImageArtifact } from "./image-studio";
import { buildSlideAcademicDoc } from "./slide-write";
import { scaleDoc } from "./scale";
import { writeWithLlm } from "./write-llm";
import type { BuiltFile } from "./types";
import type { FormValues, ToolConfig } from "../types";

export type { BuiltFile } from "./types";
export {
  writerSystemPrompt,
  essaySystemPrompt,
  lessonSystemPrompt,
  glossarySystemPrompt,
  keysSystemPrompt,
} from "./prompts";
export { llmEnabled, llmModel } from "./llm";


const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const NO_SCALE = new Set([
  "glossary",
  "keys",
  "lesson-plan",
  "texnologik-xarita",
  "resume",
  "translation",
]);

/**
 * Hajm darvozasi qo'llanadigan vositalar.
 *
 * Bular foydalanuvchiga «N bet» deb va'da beradi va narxi ham shu betga
 * bog'langan. Qolganlari (glossariy, dars rejasi, rezyume, tarjima…)
 * bet bilan emas, tuzilma bilan o'lchanadi.
 *
 * IMRAD (`kind === "imrad"`) hozircha darvozadan tashqarida: uning o'z
 * to'ldirish mexanizmi yo'q, shuning uchun darvoza uni faqat xatoga
 * aylantirardi. Sprint 2 da IMRAD ga alohida to'ldirish qo'shiladi.
 */
const LENGTH_GATED = new Set(["referat", "coursework", "mustaqil-ish", "article", "thesis", "essay"]);

/** Va'da qilingan hajmning shu ulushi majburiy. */
const MIN_LENGTH_RATIO = 0.8;



export type BuildOptions = {
  /**
   * Absolyut muddat (ms) — MAJBURIY.
   *
   * Ilgari bu ixtiyoriy edi va berilmasa 105 soniyalik standart byudjet
   * ishlatilardi. Amalda uni hech kim ishlatmasdi (worker doim o'z
   * muddatini uzatadi), lekin u jim turadigan tuzoq edi: opsiyasiz
   * chaqiruvda 40 betlik kurs ishi yarim yozilib to'xtardi. Byudjet
   * chaqiruvchining ongli qarori bo'lishi kerak.
   */
  deadline: number;
};

export async function buildArtifact(
  tool: ToolConfig,
  values: FormValues,
  opts: BuildOptions,
): Promise<BuiltFile> {
  const meta = extractMeta(tool, values);
  const deadline = opts.deadline;

  if (tool.id === "slide") {
    const slideDoc = await buildSlideAcademicDoc(meta, deadline);
    const file = await renderPptx(slideDoc, `${meta.fileNameHint}.pptx`);
    file.html = renderHtml(slideDoc);
    file.doc = slideDoc;
    return file;
  }

  if (tool.id === "image") {
    return buildImageArtifact(tool, values);
  }

  const llmDoc = await writeWithLlm(meta, values, deadline);
  if (tool.id === "translation" && !llmDoc) {
    throw new Error("Tarjima qilinmadi. Matn yoki fayldan yetarli matn olinmadi.");
  }

  /**
   * Kalit bor, lekin AI matn yozmadi — shablonga tushmaymiz.
   *
   * `content.ts` har qanday mavzuga bir xil matn beradi («… tizimli
   * o'rganishni talab qiladigan mavzu», «… alohida fakt emas, balki
   * bog'liq tushunchalar tizimi»). Ilgari shu matn `COMPLETED` bo'lib
   * chiqardi va pul qaytmasdi. Endi xato qaytadi — worker kreditni
   * o'zi qaytaradi. Shablon faqat kalitsiz (dev/demo) muhitda qoladi.
   */
  if (!llmDoc && llmKeyPresent()) {
    throw new Error("Matn yozilmadi — AI javob bermadi. Kredit qaytariladi, qayta urinib ko‘ring.");
  }

  let academic = llmDoc ?? buildAcademicDoc(meta, values);
  if (!llmDoc && !NO_SCALE.has(tool.id)) academic = scaleDoc(academic);

  /**
   * Hajm darvozasi.
   *
   * `writeWriterWithLlm` allaqachon 90% ga yetguncha qo'shimcha tahlil
   * yozishga urinadi. Shundan keyin ham va'daning 80% i chiqmasa, ishni
   * «tayyor» deb belgilash foydalanuvchini aldash bo'lardi: u 15–20 bet
   * uchun to'lab, 9 betlik fayl olardi. Xato + kredit qaytishi halolroq.
   */
  if (llmDoc && LENGTH_GATED.has(tool.id) && meta.kind !== "imrad") {
    const want = targetWords(meta.targetPages);
    const got = wordCount(academic);
    if (got < want * MIN_LENGTH_RATIO) {
      const pages = Math.max(1, Math.round(got / 230));
      console.warn(`[gen] length gate: ${tool.id} ${got}/${want} so'z`);
      throw new Error(
        `Matn hajmi yetarli chiqmadi (~${pages} bet, kerak: ${meta.pagesLabel} bet). ` +
          `Kredit qaytariladi — qayta urinib ko‘ring yoki kichikroq hajm tanlang.`,
      );
    }
  }

  const bytes = await renderDocx(academic);
  const suffix =
    tool.id === "translation"
      ? "-tarjima.docx"
      : tool.id === "lesson-plan"
        ? "-dars.docx"
        : tool.id === "texnologik-xarita"
          ? "-xarita.docx"
          : ".docx";
  return {
    html: renderHtml(academic),
    bytes,
    fileName: `${meta.fileNameHint}${suffix}`,
    mime: DOCX,
    doc: academic,
  };
}
