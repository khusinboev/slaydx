/**
 * AI slide, step 1 (docs/ai-slide/SPEC.md «Engine» 1): one writer call plans and words the whole deck.
 *
 * The text budget per slide is deliberately small: image models draw short exact text well and fail on paragraphs
 * (the Nano Banana 2.1 model card: «poor text rendering in small text, long paragraphs»). Everything the model returns
 * is clipped here, so a long answer can never reach the picture prompt.
 */
import { prettyFormula, prettyFormulasDeep } from "../formula-text";
import { languageDirective } from "../i18n";
import { parseLlmJson } from "../json";
import { llmComplete } from "../llm";
import type { DocMeta } from "../types";
import { imageSlideAudienceOf } from "./models";
import type { FormValues } from "../../types";

export const PICTURE_KINDS = ["title", "agenda", "content", "table", "formula", "diagram", "timeline", "compare", "stats", "quote", "summary", "closing"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

export type PictureSlide = {
  kind: PictureKind;
  title: string;
  subtitle?: string;
  points: string[];
  table?: { headers: string[]; rows: string[][] };
  formulas: string[];
  /** English description of the illustration / diagram; never text to draw beyond labels from `points`. */
  visual: string;
  /** Speaker notes in the deck language (PPTX notes, search). */
  notes: string;
};

/** Text limits per slide: what a 16:9 picture shows legibly. */
export const PICTURE_LIMITS = {
  title: 80,
  subtitle: 140,
  points: 5,
  point: 110,
  tableCols: 4,
  tableRows: 6,
  cell: 40,
  formulas: 3,
  formula: 80,
  visual: 400,
  notes: 700,
} as const;

/** Cut at a word end, never mid-word; adds no ellipsis (a picture shows the text as it is). */
export function clip(text: unknown, max: number): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  // The cut already ends a word when the next character is a space.
  if (s[max] === " ") return cut.replace(/[\s,;:–-]+$/, "");
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, "");
}

const strList = (v: unknown, n: number, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => clip(x, max))
    .filter(Boolean)
    .slice(0, n);

function asKind(v: unknown): PictureKind {
  const k = String(v ?? "").trim().toLowerCase();
  return (PICTURE_KINDS as readonly string[]).includes(k) ? (k as PictureKind) : "content";
}

/** One LLM slide object → a `PictureSlide`, or `null` when it has no title. */
export function normalizePictureSlide(raw: unknown): PictureSlide | null {
  if (!raw || typeof raw !== "object") return null;
  const o = prettyFormulasDeep(raw) as Record<string, unknown>;
  const title = clip(o.title, PICTURE_LIMITS.title);
  if (!title) return null;
  const kind = asKind(o.kind);
  const t = o.table && typeof o.table === "object" ? (o.table as Record<string, unknown>) : null;
  const headers = t ? strList(t.headers, PICTURE_LIMITS.tableCols, PICTURE_LIMITS.cell) : [];
  const rows = t && Array.isArray(t.rows)
    ? (t.rows as unknown[])
        .map((r) => strList(r, headers.length || PICTURE_LIMITS.tableCols, PICTURE_LIMITS.cell))
        .filter((r) => r.length > 0)
        .slice(0, PICTURE_LIMITS.tableRows)
    : [];
  const subtitle = clip(o.subtitle, PICTURE_LIMITS.subtitle);
  return {
    kind,
    title,
    ...(subtitle ? { subtitle } : {}),
    points: strList(o.points, PICTURE_LIMITS.points, PICTURE_LIMITS.point),
    ...(headers.length >= 2 && rows.length ? { table: { headers, rows } } : {}),
    formulas: strList(o.formulas, PICTURE_LIMITS.formulas, PICTURE_LIMITS.formula),
    visual: clip(o.visual, PICTURE_LIMITS.visual),
    notes: clip(o.notes, PICTURE_LIMITS.notes),
  };
}

export function pictureSystemPrompt(meta: DocMeta): string {
  return [
    languageDirective(meta.language),
    "You are an expert presentation author and information designer. You write the content of a slide deck in which EVERY slide will be drawn as one picture by an image model, so each slide carries little, exact, high-value text and a clear visual idea.",
    "Return JSON only.",
  ].join("\n");
}

export function pictureUserPrompt(meta: DocMeta, values: FormValues, count: number): string {
  const audience = imageSlideAudienceOf(values);
  const lines = [
    `Topic: «${meta.topic}».`,
    meta.subject ? `Subject: ${meta.subject}.` : "",
    `Audience: ${audience.prompt}.`,
    meta.author ? `Author: ${meta.author}${meta.organization ? `, ${meta.organization}` : ""}.` : meta.organization ? `Organization: ${meta.organization}.` : "",
    meta.extra ? `The author's wishes (follow them): ${meta.extra}` : "",
    meta.sourceText ? `Base the deck on this source text:\n"""\n${meta.sourceText.slice(0, 20_000)}\n"""` : "",
    "",
    `Write EXACTLY ${count} slides in a logical teaching order: each slide builds on the previous one, nothing repeats.`,
    "Structure:",
    "- slide 1: kind \"title\" — title = the topic, subtitle = one short line (subject or purpose). Never put the author or organization in the subtitle: they are drawn on their own line.",
    count >= 6 ? "- slide 2: kind \"agenda\" — points = the main sections of the deck (3–5)." : "",
    "- middle slides: the substance. Choose the kind that shows the idea best:",
    "  content (3–5 points), table (comparison or classification), formula (1–3 formulas + 2–3 explaining points),",
    "  diagram (a process, structure or cycle: points = 3–6 short labelled steps), timeline (dated events as points),",
    "  compare (two sides: points alternate side A / side B, prefix each with its side), stats (3–4 key numbers as points «number — meaning»), quote.",
    "  Use formulas, tables and diagrams wherever the subject has them (chemistry, physics, mathematics, biology, economics…).",
    count >= 8 ? "- the slide before last: kind \"summary\" — 3–5 key takeaways." : "",
    count >= 5 ? "- last slide: kind \"closing\" — a thank-you title and one line with a question or call to action." : "",
    "",
    "Text rules (the picture must stay legible):",
    `- title ≤ ${PICTURE_LIMITS.title} characters, a full thought; each point ≤ ${PICTURE_LIMITS.point} characters, at most ${PICTURE_LIMITS.points} points.`,
    `- table: 2–${PICTURE_LIMITS.tableCols} columns, ≤ ${PICTURE_LIMITS.tableRows} rows, every cell ≤ ${PICTURE_LIMITS.cell} characters.`,
    "- formulas in Unicode, never LaTeX: H₂O, CₙH₂ₙ₊₁COOH, Ca²⁺, x² + y² = r², E = mc², v = v₀ + at, √2, π, ∠ABC, 30°, →.",
    "- facts must be correct; give a number only when you are sure of it; no invented sources.",
    "- visual: in ENGLISH, one concrete illustration, labelled diagram, chart or infographic that explains this slide (what to draw and how it is arranged). Labels inside it may only reuse words from the slide's points. No people's faces of real persons, no logos.",
    "- notes: 2–4 sentences the speaker says on this slide.",
    "",
    'JSON: {"slides":[{"kind":"title|agenda|content|table|formula|diagram|timeline|compare|stats|quote|summary|closing","title":"","subtitle":"","points":[""],"table":{"headers":[""],"rows":[[""]]},"formulas":[""],"visual":"","notes":""}]}',
    "Omit table and formulas when the slide has none.",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/** Slides from the writer's answer, clipped and normalized; at most `count`. */
export function parsePictureDeck(raw: string | null, count: number): PictureSlide[] {
  const data = raw ? parseLlmJson(raw) : null;
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).slides)
      ? ((data as Record<string, unknown>).slides as unknown[])
      : [];
  return list
    .map(normalizePictureSlide)
    .filter((s): s is PictureSlide => Boolean(s))
    .slice(0, count);
}

/** The first slide always carries the user's topic as its title, as every other deck tool does. */
export function pinTitleSlide(slides: PictureSlide[], meta: DocMeta): PictureSlide[] {
  if (!slides.length) return slides;
  const first = slides[0];
  const title = clip(prettyFormula(meta.topic), PICTURE_LIMITS.title) || first.title;
  return [{ ...first, kind: "title", title }, ...slides.slice(1)];
}

export async function writePictureDeck(meta: DocMeta, values: FormValues, count: number, deadline?: number): Promise<PictureSlide[]> {
  const maxTokens = Math.min(16_000, 1_500 + count * 450);
  const raw = await llmComplete(pictureSystemPrompt(meta), pictureUserPrompt(meta, values, count), maxTokens, {
    json: true,
    timeoutMs: 150_000,
    ...(deadline ? { deadline } : {}),
  });
  return pinTitleSlide(parsePictureDeck(raw, count), meta);
}
