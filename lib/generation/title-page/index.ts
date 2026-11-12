import type { FormValues } from "../../types";
import type { AcademicDoc, BuiltFile, DocMeta } from "../types";
import { titulInputFromValues } from "./input";
import { planTitlePage, titulRuns } from "./layout";
import { renderTitulDocx } from "./render-docx";
import type { TitulModel } from "./types";

export { planTitlePage } from "./layout";
export { titulInputFromValues } from "./input";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The «Titul» document: the model (`doc.titul`) is the whole content. The
 * flat `sections` copy (one paragraph per text run) exists only for the
 * cards / search / HTML fallback that read `sections`; nothing draws from it.
 */
export function titulDoc(meta: DocMeta, model: TitulModel): AcademicDoc {
  const runs = titulRuns(planTitlePage(model)).filter((r) => r.text.trim());
  return {
    meta: { ...meta, topic: model.input.topic || meta.topic, language: model.input.lang === "ru" ? "ru" : "uz", year: model.input.year },
    titlePage: false,
    toc: false,
    sections: [{ id: "titul", title: "", blocks: runs.map((r) => ({ kind: "p" as const, text: r.text })) }],
    titul: model,
  };
}

/** Pure template render — no LLM, no network. */
export async function buildTitulArtifact(meta: DocMeta, values: FormValues, fileName: string): Promise<BuiltFile> {
  const model: TitulModel = { input: titulInputFromValues(values), overrides: {} };
  const doc = titulDoc(meta, model);
  const bytes = await renderTitulDocx(model);
  return { html: "", bytes, fileName, mime: DOCX, doc };
}
