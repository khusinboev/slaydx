/**
 * Konspekt form values ↔ engine input, and the volume plan. Pure and isomorphic (no LLM, no Node): the form
 * (`KonspektComposer`) and the engine read the same functions, so what the screen promises is what is written.
 */
import type { FormValues } from "../../types";
import { str } from "../article/parse";
import { WORK_LIMITS } from "../work/types";
import { normalizeWorkPages, pagesMid, pagesRange, workKindOf } from "../work/registry";
import { handCapsOf, handGeometry, normalizeHand, restrictHand, twToMm, type WorkHand } from "../work/handwriting";

export type KonspektInput = {
  topic: string;
  language: string;
  /** Sheet range tier (`KONSPEKT_PAGES`), counted in pages of the chosen format. */
  pages: string;
  sourceText: string;
  /** Extra wishes from the student (what to stress / skip); optional. */
  extra: string;
  hand: WorkHand;
};

/** What a konspekt looks like when the student does not choose: a grid notebook, two A5 pages per A4 sheet. */
export const KONSPEKT_HAND_DEFAULTS = { ink: "blue", paper: "grid", font: "school", lively: "on", format: "a5x2", margin: "alternate", cells: "1" } as const;

const LANGS = new Set(["uz", "ru", "en"]);

export function konspektInputFromValues(values: FormValues): KonspektInput {
  const kind = workKindOf("konspekt", "notes");
  const pick = (v: unknown, fallback: string) => {
    const s = String(v ?? "").trim();
    return s || fallback;
  };
  const caps = handCapsOf("konspekt")!;
  /* Sub-headings of a notebook are written in plain case ("Xorazm"), not in capitals: fixed, not a choice. */
  const hand: WorkHand = { ...restrictHand(
    normalizeHand({
      ink: pick(values.handInk, KONSPEKT_HAND_DEFAULTS.ink),
      paper: pick(values.handPaper, KONSPEKT_HAND_DEFAULTS.paper),
      font: pick(values.handFont, KONSPEKT_HAND_DEFAULTS.font),
      lively: pick(values.handLively, KONSPEKT_HAND_DEFAULTS.lively),
      format: pick(values.handFormat, KONSPEKT_HAND_DEFAULTS.format),
      margin: pick(values.handMargin, KONSPEKT_HAND_DEFAULTS.margin),
      cells: pick(values.handCells, KONSPEKT_HAND_DEFAULTS.cells),
    }),
    caps,
  ), headings: "plain" };
  const language = String(values.language ?? "uz");
  return {
    topic: str(values.topic, WORK_LIMITS.topicChars),
    language: LANGS.has(language) ? language : "uz",
    pages: normalizeWorkPages(kind, values.pages),
    sourceText: str(values.sourceText, WORK_LIMITS.sourceTextChars),
    extra: str(values.extra, WORK_LIMITS.extraChars),
    hand,
  };
}

/** Average characters per word INCLUDING the following space, by language. */
const AVG_WORD_CHARS: Record<string, number> = { uz: 7.2, ru: 7.5, en: 6.5 };
/** Calibrated on rendered notebooks: characters per row ≈ 4.3 × text width (mm) / writing size (pt). */
const CHARS_PER_ROW_K = 4.3;
/**
 * Paragraph ends, indents, headings and short dash-list lines leave rows partly empty. Calibrated on a rendered
 * Russian konspekt (14 sections, many lists): 3 480 words filled 24 A5 pages ≈ 145 words/page, i.e. 0.61 of the
 * raw row capacity; a paragraph-only text reaches ~0.9. The engine also re-measures the rendered file (`fit`).
 */
const FILL = 0.65;

/** Words one notebook page of this layout holds (the single source of the volume plan). */
export function konspektWordsPerPage(hand: WorkHand, language: string): number {
  const g = handGeometry(hand.paper, hand.font, hand);
  const charsPerRow = (CHARS_PER_ROW_K * twToMm(g.contentTw)) / g.sizePt;
  return Math.round((g.lines * charsPerRow * FILL) / (AVG_WORD_CHARS[language] ?? 7.2));
}

export function konspektWordPlan(input: Pick<KonspektInput, "pages" | "hand" | "language">) {
  const perPage = konspektWordsPerPage(input.hand, input.language);
  const [, max] = pagesRange(input.pages);
  return { perPage, target: Math.round(perPage * pagesMid(input.pages)), max: perPage * max };
}

