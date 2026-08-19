import { llmComplete, llmEnabled } from "./llm";
import { essaySystemPrompt, lessonSystemPrompt, writerSystemPrompt } from "./prompts";
import type { AcademicDoc, Block } from "./types";

function systemFor(doc: AcademicDoc) {
  const id = doc.meta.toolId;
  if (id === "essay") return essaySystemPrompt(doc.meta);
  if (id === "lesson-plan" || id === "texnologik-xarita") return lessonSystemPrompt(doc.meta);
  return writerSystemPrompt(doc.meta);
}

function parseParagraphs(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((s) => s.replace(/^\s*(?:\d+[\).]|[-*])\s*/, "").trim())
    .filter((s) => s.length > 40);
}

export async function enrichWithLlm(doc: AcademicDoc): Promise<AcademicDoc> {
  if (!llmEnabled()) return doc;

  const sys = systemFor(doc);
  const maxSections = doc.meta.toolId === "essay" ? 4 : 6;
  const targets = doc.sections.filter((s) => s.blocks.some((b) => b.kind === "p")).slice(0, maxSections);

  const updated = [...doc.sections];
  for (const section of targets) {
    const outline = section.blocks
      .filter((b) => b.kind === "p" || b.kind === "h2")
      .map((b) => b.text)
      .slice(0, 4)
      .join("\n");
    const user = [
      `Bo‘lim: ${section.title}`,
      `Mavzu: ${doc.meta.topic}`,
      `Til: ${doc.meta.language}`,
      `Quyidagi reja asosida 3–5 ta to‘la akademik paragraf yozing. Sarlavha yozmang. Fakt uydirmang.`,
      outline,
    ].join("\n");
    const text = await llmComplete(sys, user);
    if (!text) continue;
    const paras = parseParagraphs(text);
    if (paras.length < 2) continue;
    const heads = section.blocks.filter((b) => b.kind !== "p");
    const body: Block[] = paras.map((t) => ({ kind: "p", text: t }));
    const idx = updated.findIndex((s) => s.id === section.id);
    if (idx >= 0) updated[idx] = { ...section, blocks: [...heads, ...body] };
  }
  return { ...doc, sections: updated };
}
