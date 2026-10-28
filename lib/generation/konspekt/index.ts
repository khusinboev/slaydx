/**
 * KONSPEKT (lecture notes) — a lightweight engine next to `work/`.
 *
 * A konspekt is dense factual notes written into a notebook: a title, short sub-headings and
 * paragraphs / dash lists — no cover, contents, introduction, conclusion or references. The
 * result is a `WorkModel` of genre `konspekt` (shape `notes`), so the hand-writing renderer, the
 * viewer and the downloads take it through the same `planWork` path as the other student works.
 *
 * Volume is fixed by the CAPACITY of the chosen notebook layout: `wordsPerPage` is derived from the
 * hand geometry (rows per page × characters per row), the tier ("10-20") gives the sheet range and
 * the engine aims at its middle and never goes above its upper bound.
 *
 * Honesty: the model may only use the topic and the supplied source text (file mode) — no invented
 * dates, names, figures or quotations; a point the source is silent about is left out.
 */
import type { FormValues } from "../../types";
import type { AcademicDoc, Block, DocMeta, DocSection } from "../types";
import type { TranslationSource } from "../source-types";
import { languageDirective } from "../i18n";
import { llmEnabled } from "../llm";
import { assertJobTime } from "../deadline";
import { CostMeter, complete as completeRole, type LlmUsage } from "../llm-roles";
import { parseLlmObject } from "../json";
import { mapPool } from "../quality";
import { blocksFromLlm, str } from "../article/parse";
import { WORK_LIMITS, type WorkModel } from "../work/types";
import { konspektInputFromValues, konspektWordPlan, type KonspektInput } from "./input";
import { pagesMid, workKindOf } from "../work/registry";
import { sourceTextOf } from "../work/engine";

export type KonspektStage = { progress: number; step: string };

export type KonspektBuildOpts = {
  deadline: number;
  source?: TranslationSource;
  onStage?: (ev: KonspektStage) => void;
  /** Test seam — role-based LLM. */
  complete?: typeof completeRole;
  onUsage?: (u: LlmUsage) => void;
};

export type KonspektBuildResult = { doc: AcademicDoc; cost: ReturnType<CostMeter["toJson"]>; words: number; target: number };

const OUTLINE_TIMEOUT_MS = 45_000;
const SECTION_TIMEOUT_MS = 60_000;
const MIN_CALL_MS = 8_000;
/** A section shorter than this share of its budget is asked once more to be fuller. */
const EXPAND_BELOW = 0.75;

const wordCount = (blocks: Block[]) => blocks.reduce((n, b) => n + (b.kind === "p" || b.kind === "li" || b.kind === "quote" ? b.text.split(/\s+/).filter(Boolean).length : 0), 0);

type OutlineItem = { title: string; brief: string; words: number };

function systemPrompt(input: KonspektInput): string {
  return [
    languageDirective(input.language),
    "You write LECTURE NOTES (konspekt) for a student who will copy them into a notebook.",
    "Style: compressed, factual, no filler, no rhetoric, no introduction or conclusion; definitions, dates, names, causes and consequences in short sentences.",
    "TRUTHFULNESS: use only the topic and the supplied SOURCE MATERIAL. Never invent dates, names, numbers, quotations or events. If the material is silent about a point, leave it out. Without source material, use only well-established textbook facts and omit anything you are unsure about.",
    "Never add references, citations, footnotes, markdown, headings inside text, or emojis.",
  ].join(" ");
}

function outlinePrompt(input: KonspektInput, target: number, sections: number): string {
  return [
    `TOPIC: «${input.topic}»`,
    input.extra ? `STUDENT WISHES: ${input.extra}` : "",
    input.sourceText ? `SOURCE MATERIAL (authoritative):\n${input.sourceText}` : "SOURCE MATERIAL: none — rely on the topic and well-established facts only.",
    `Plan the notes as about ${sections} sections in the logical order of the topic/source. Total volume ≈ ${target} words.`,
    'Return JSON only: {"sections":[{"title":"short sub-heading (max 80 characters, no numbering)","brief":"which facts of the source belong to this section","words":120}]}',
    "The `words` budgets must add up to about the total volume; a section is at least 80 words.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function sectionPrompt(input: KonspektInput, item: OutlineItem, index: number, all: OutlineItem[]): string {
  return [
    `TOPIC: «${input.topic}»`,
    `SECTION ${index + 1} of ${all.length}: «${item.title}». Brief: ${item.brief}`,
    `The other sections (do not repeat their facts): ${all.filter((_, i) => i !== index).map((x) => x.title).join("; ")}`,
    input.sourceText ? `SOURCE MATERIAL (authoritative):\n${input.sourceText}` : "SOURCE MATERIAL: none.",
    `Write about ${item.words} words (at least ${Math.round(item.words * 0.85)}) of notes for THIS section only.`,
    'Return JSON only: {"blocks":[{"kind":"p","text":"…"},{"kind":"li","text":"one fact, date or definition"}]}',
    'Use "p" for connected statements and "li" for lists of facts/dates/names; no leading dash or number inside the text.',
  ].join("\n\n");
}

function expandPrompt(input: KonspektInput, item: OutlineItem, have: Block[]): string {
  return [
    `TOPIC: «${input.topic}»`,
    `SECTION: «${item.title}». Brief: ${item.brief}`,
    input.sourceText ? `SOURCE MATERIAL (authoritative):\n${input.sourceText}` : "SOURCE MATERIAL: none.",
    `The notes written so far are too short (${wordCount(have)} words, need about ${item.words}). Existing notes:\n${have.map((b) => (b.kind === "li" ? "- " : "") + ("text" in b ? b.text : "")).join("\n")}`,
    "Add MORE FACTS that belong to this section and are not yet written (never repeat). Same rules: only the topic/source.",
    'Return JSON only: {"blocks":[{"kind":"p","text":"…"},{"kind":"li","text":"…"}]} with the ADDITIONAL blocks only.',
  ].join("\n\n");
}

/** Outline sanity: titles trimmed, budgets positive and normalised to the target. */
function normaliseOutline(raw: unknown, target: number): OutlineItem[] {
  const list = Array.isArray((raw as { sections?: unknown })?.sections) ? ((raw as { sections: unknown[] }).sections as Record<string, unknown>[]) : [];
  const items = list
    .map((s) => ({ title: str(s?.title, 80), brief: str(s?.brief, 400), words: Math.max(80, Math.round(Number(s?.words) || 0)) }))
    .filter((s) => s.title.length >= 3)
    .slice(0, 30);
  const sum = items.reduce((n, s) => n + s.words, 0);
  if (!items.length || !sum) return [];
  return items.map((s) => ({ ...s, words: Math.max(80, Math.round((s.words * target) / sum)) }));
}

export async function buildKonspektDoc(meta: DocMeta, values: FormValues, opts: KonspektBuildOpts): Promise<KonspektBuildResult | null> {
  const complete = opts.complete ?? completeRole;
  if (!opts.complete && !llmEnabled()) return null;
  const input = konspektInputFromValues({ ...values, sourceText: meta.sourceText || values.sourceText || "" });
  if (!input.sourceText && opts.source) input.sourceText = await sourceTextOf(opts.source);
  if (!input.topic) input.topic = str(meta.topic, WORK_LIMITS.topicChars);
  if (!input.topic && !input.sourceText) return null;
  if (!input.topic) input.topic = "Konspekt";

  const meter = new CostMeter();
  const plan = konspektWordPlan(input);
  const sectionCount = Math.max(4, Math.min(24, Math.round(plan.target / 230)));
  const stage = (progress: number, step: string) => opts.onStage?.({ progress, step });
  const ask = async (user: string, maxTokens: number, timeoutMs: number) => {
    if (timeoutMs < MIN_CALL_MS) {
      assertJobTime(opts.deadline, "konspekt", MIN_CALL_MS);
      return null;
    }
    const r = await complete("writer", systemPrompt(input), user, { json: true, maxTokens, timeoutMs, deadline: opts.deadline });
    if (r?.usage) {
      meter.add(r.usage);
      opts.onUsage?.(r.usage);
    }
    return r?.text ?? null;
  };
  const left = () => Math.max(0, opts.deadline - Date.now());

  stage(10, "Konspekt rejasi tuzilmoqda");
  const outlineText = await ask(outlinePrompt(input, plan.target, sectionCount), 3000, Math.min(OUTLINE_TIMEOUT_MS, left()));
  const outline = outlineText ? normaliseOutline(parseLlmObject(outlineText), plan.target) : [];
  if (!outline.length) return null;

  stage(25, "Bo‘limlar yozilmoqda");
  let done = 0;
  const written = await mapPool(outline, 3, async (item, i): Promise<Block[]> => {
    const t = await ask(sectionPrompt(input, item, i, outline), Math.round(item.words * 3) + 600, Math.min(SECTION_TIMEOUT_MS, left()));
    let blocks = t ? blocksFromLlm((parseLlmObject(t) as { blocks?: unknown } | null)?.blocks, "") : [];
    if (blocks.length && wordCount(blocks) < item.words * EXPAND_BELOW && left() > SECTION_TIMEOUT_MS) {
      const more = await ask(expandPrompt(input, item, blocks), Math.round(item.words * 3) + 600, Math.min(SECTION_TIMEOUT_MS, left()));
      if (more) blocks = [...blocks, ...blocksFromLlm((parseLlmObject(more) as { blocks?: unknown } | null)?.blocks, "")];
    }
    done++;
    stage(25 + Math.round((done / outline.length) * 60), `Bo‘lim ${done}/${outline.length} yozildi`);
    return blocks;
  });

  /* Assemble, drop empty sections, never exceed the paid upper bound of the tier. */
  const sections: DocSection[] = [];
  let words = 0;
  outline.forEach((item, i) => {
    const blocks = written[i] ?? [];
    if (!blocks.length) return;
    const kept: Block[] = [];
    for (const b of blocks) {
      const w = wordCount([b]);
      if (words + w > plan.max) break;
      kept.push(b);
      words += w;
    }
    if (kept.length) sections.push({ id: `ch${sections.length + 1}`, title: item.title, blocks: kept });
  });
  /* Less than half of the promised volume is a failed job (the credits are refunded), not a thin konspekt. */
  if (!sections.length || words < plan.target * 0.5) return null;

  stage(92, "Konspekt yig‘ilmoqda");
  const kind = workKindOf("konspekt", "notes");
  const model: WorkModel = {
    v: 1,
    genre: "konspekt",
    kind: kind.id,
    subject: "humanities",
    language: input.language,
    title: input.topic,
    university: "",
    faculty: "",
    department: "",
    subjectName: "",
    group: "",
    course: "",
    author: "",
    teacher: "",
    city: "",
    ministry: "oliy",
    chapters: sections.map((s) => ({ id: s.id, title: s.title, paragraphs: [] })),
    intro: { parts: { relevance: false, aim: false, tasks: false, object: false, subject: false, methods: false, structure: false, novelty: false, significance: false } },
    references: [],
    figures: [],
    refsMin: 0,
    hand: input.hand,
  };
  const doc: AcademicDoc = {
    meta: { ...meta, topic: input.topic, language: input.language, workLabel: "Konspekt", pagesLabel: input.pages, targetPages: pagesMid(input.pages) },
    titlePage: false,
    toc: false,
    sections,
    work: model,
  };
  return { doc, cost: meter.toJson(), words, target: plan.target };
}


export { KONSPEKT_HAND_DEFAULTS, konspektInputFromValues, konspektWordPlan, konspektWordsPerPage, type KonspektInput } from "./input";
