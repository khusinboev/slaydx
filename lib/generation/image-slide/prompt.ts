/**
 * AI slide, step 2 (docs/ai-slide/SPEC.md «Engine» 2): the picture prompt of one slide, built in code.
 *
 * Google's advice for text in pictures is to generate the text first and then ask for a picture with it, stating
 * the text exactly (https://ai.google.dev/gemini-api/docs/image-generation). So every text item is listed verbatim
 * under its role, the model is told to add none of its own, and one design block (the chosen style) is repeated in
 * every slide so the deck reads as one. Slides after the first also get the first slide as a style reference.
 */
import { langInfo } from "../i18n";
import type { DocMeta } from "../types";
import type { ImageSlideStyle } from "./models";
import type { PictureSlide } from "./write";

const LAYOUT_HINT: Record<PictureSlide["kind"], string> = {
  title: "Title slide: the title very large and centred or left-aligned with strong presence, the subtitle and author lines smaller below it, a bold hero illustration of the topic.",
  agenda: "Agenda slide: the points as a numbered list or numbered cards, with a small icon for each.",
  content: "Content slide: the title at the top, the points as a clean bulleted list on one side, the illustration on the other side.",
  table: "Table slide: the title at the top, a clean table with a coloured header row filling most of the slide; a small illustration may sit beside it.",
  formula: "Formula slide: the formulas large and centred, typeset like a textbook (true subscripts and superscripts), the explaining points below them.",
  diagram: "Diagram slide: a labelled diagram (process, structure or cycle) built from the points as its labels, arrows between steps, the title at the top.",
  timeline: "Timeline slide: a horizontal timeline with the points as dated milestones.",
  compare: "Comparison slide: two columns side by side with a heading each, the points split between them, matching icons.",
  stats: "Statistics slide: each point as a big number card (the number large, its meaning small below), a simple chart if it helps.",
  quote: "Quote slide: the quote large in quotation marks, its author smaller below, an elegant background illustration.",
  summary: "Summary slide: the key takeaways as check-marked cards or a numbered list.",
  closing: "Closing slide: the thank-you title large, the one line below it, a calm illustration.",
};

export type SlidePromptCtx = {
  meta: DocMeta;
  style: ImageSlideStyle;
  index: number;
  total: number;
  /** The first slide is attached as a style reference (all slides but the first). */
  withReference: boolean;
};

function textBlock(s: PictureSlide, ctx: SlidePromptCtx): string[] {
  const out: string[] = [`TITLE: ${s.title}`];
  if (s.subtitle) out.push(`SUBTITLE: ${s.subtitle}`);
  if (s.kind === "title") {
    // Only the parts the subtitle does not already say (the writer is told not to, but a repeat would be drawn twice).
    const said = (s.subtitle ?? "").toLowerCase();
    const by = [ctx.meta.author, ctx.meta.organization].filter((x) => x && !said.includes(x.toLowerCase())).join(" · ");
    if (by) out.push(`AUTHOR LINE (small): ${by}`);
  }
  if (s.points.length) {
    out.push(s.kind === "agenda" ? "NUMBERED ITEMS:" : "POINTS:");
    s.points.forEach((p, i) => out.push(s.kind === "agenda" ? `${i + 1}. ${p}` : `• ${p}`));
  }
  if (s.formulas.length) {
    out.push("FORMULAS:");
    for (const f of s.formulas) out.push(`  ${f}`);
  }
  if (s.table) {
    out.push(`TABLE (${s.table.headers.length} columns; cells separated by « | »):`);
    out.push(`  header: ${s.table.headers.join(" | ")}`);
    for (const r of s.table.rows) out.push(`  row: ${r.join(" | ")}`);
  }
  if (s.kind !== "title") out.push(`PAGE NUMBER (small, bottom right corner): ${ctx.index + 1} / ${ctx.total}`);
  return out;
}

export function slidePrompt(s: PictureSlide, ctx: SlidePromptCtx): string {
  const lang = langInfo(ctx.meta.language);
  return [
    // No slide number, format name or quality word up here: the model drew «Slide 1 of 12», «16:9» and «Print-ready»
    // badges on every slide of the second live deck (2026-11-12). The page number lives only in the text block.
    "Design one landscape presentation slide as a single finished picture.",
    `Deck style: ${ctx.style.prompt}`,
    ctx.withReference
      ? "The attached image is slide 1 of the same deck: match its background, colour palette, typography, margins and decorative motifs exactly, but draw this slide's own content and layout. Do not copy its text or illustration."
      : "",
    LAYOUT_HINT[s.kind],
    "",
    `TEXT IS THE TOP PRIORITY. Render every text item below exactly as written, character for character, in ${lang.name} (keep every diacritic, the ʻ and ʼ marks, subscripts and superscripts such as H₂O and x²).`,
    "Do not add, translate, shorten, paraphrase or invent any other text: no extra captions, labels, lorem ipsum, watermarks, logos or signatures. Labels inside the illustration may only reuse words from the text below.",
    "Draw no badges, tags, chips, slide counters, format or size marks, toolbars or other interface elements: the only number in a corner is the page number given below.",
    "Use large, clean, highly legible type with strong contrast; nothing may touch or be cut off at the edges (keep a 5% margin); no spelling mistakes.",
    "",
    ...textBlock(s, ctx),
    "",
    s.visual
      ? `ILLUSTRATION (no words of its own, in any language — no book titles, signs or captions): ${s.visual}`
      : "ILLUSTRATION: a fitting, clean illustration of the slide's idea, with no words of its own in any language.",
  ]
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n");
}
