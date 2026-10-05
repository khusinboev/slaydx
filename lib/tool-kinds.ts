import type { ToolConfig, ToolId } from "./types";

/**
 * The few tool facts every route needs, without the tool registry.
 *
 * `lib/tools.ts` imports the game, audio, infographic, article, work, essay
 * and teacher registries (~40 kB gz). `lib/store.ts` and `lib/ui.ts` sit in
 * the shared client layer of EVERY route (admin, public game `/o/[token]`,
 * login) and only need the list of tool ids (price adjustments) and each
 * tool's group/output (file filter) — so they read this table instead
 * (ops sprint WP-B phase 1, docs/ops/O4-frontend-speed.md §1.1).
 *
 * `TOOLS` (`lib/tools.ts`) stays the source of truth for every other field;
 * `tests/tool-kinds.test.mts` locks this table to it (same ids, same group
 * and output for each), so the two cannot drift. `Record<ToolId, …>` makes a
 * new `ToolId` without a row a type error.
 */
export type ToolKind = Pick<ToolConfig, "group" | "output">;

export const TOOL_KINDS: Readonly<Record<ToolId, ToolKind>> = {
  slide: { group: "umumiy", output: "pptx" },
  "pro-slide": { group: "umumiy", output: "pptx" },
  image: { group: "umumiy", output: "png" },
  coursework: { group: "talaba", output: "docx" },
  referat: { group: "talaba", output: "docx" },
  essay: { group: "talaba", output: "docx" },
  article: { group: "umumiy", output: "docx" },
  resume: { group: "umumiy", output: "docx" },
  thesis: { group: "talaba", output: "docx" },
  translation: { group: "umumiy", output: "docx" },
  "texnologik-xarita": { group: "oqituvchi", output: "docx" },
  glossary: { group: "oqituvchi", output: "docx" },
  keys: { group: "oqituvchi", output: "docx" },
  "mustaqil-ish": { group: "talaba", output: "docx" },
  "lesson-plan": { group: "oqituvchi", output: "docx" },
  test: { group: "oqituvchi", output: "docx" },
  crossword: { group: "oyinlar", output: "docx" },
  flashcards: { group: "oyinlar", output: "docx" },
  infographic: { group: "oqituvchi", output: "png" },
  sorting: { group: "oyinlar", output: "docx" },
  listening: { group: "oyinlar", output: "docx" },
  podcast: { group: "media", output: "mp3" },
  greeting: { group: "media", output: "mp3" },
};

/** Every tool id, in `TOOLS` order. */
export const TOOL_IDS = Object.keys(TOOL_KINDS) as readonly ToolId[];

/** Kind of a stored generation type; `undefined` for an unknown/legacy type. */
export function toolKindOf(type: string): ToolKind | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_KINDS, type) ? TOOL_KINDS[type as ToolId] : undefined;
}
