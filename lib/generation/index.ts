import { buildAcademicDoc } from "./content";
import { extractMeta } from "./meta";
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
 * Byudjet endi chaqiruvchidan keladi: navbatdagi worker uchun bu bir necha
 * daqiqa bo'lishi mumkin, HTTP so'rovi ichidagi zaxira yo'l uchun esa qisqa.
 */
const BUILD_BUDGET_MS = 105_000;

export type BuildOptions = {
  /** Absolyut muddat (ms). Berilmasa standart byudjet ishlatiladi. */
  deadline?: number;
};

export async function buildArtifact(
  tool: ToolConfig,
  values: FormValues,
  opts: BuildOptions = {},
): Promise<BuiltFile> {
  const meta = extractMeta(tool, values);
  const deadline = opts.deadline ?? Date.now() + BUILD_BUDGET_MS;

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
  let academic = llmDoc ?? buildAcademicDoc(meta, values);
  if (!llmDoc && !NO_SCALE.has(tool.id)) academic = scaleDoc(academic);
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
