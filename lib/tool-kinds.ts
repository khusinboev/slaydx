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
  "image-slide": { group: "umumiy", output: "pptx" },
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
  konspekt: { group: "talaba", output: "docx" },
  "title-page": { group: "talaba", output: "docx" },
  "lesson-plan": { group: "oqituvchi", output: "docx" },
  test: { group: "oqituvchi", output: "docx" },
  crossword: { group: "oyinlar", output: "docx" },
  flashcards: { group: "oyinlar", output: "docx" },
  infographic: { group: "oqituvchi", output: "png" },
  sorting: { group: "oyinlar", output: "docx" },
  listening: { group: "oyinlar", output: "docx" },
  "studio-image": { group: "media", output: "png" },
  "studio-video": { group: "media", output: "mp4" },
  "studio-speech": { group: "media", output: "mp3" },
  "studio-voice": { group: "media", output: "mp3" },
  "studio-audio": { group: "media", output: "mp3" },
  // P8c «Montaj»: MP3 (speech + music) or MP4 (audio onto a video) — the stored format follows the real file.
  "studio-mix": { group: "media", output: "mp3" },
  // P10: TXT / MP4 (transcript, or the subtitled clip) and MP4 / MP3 (the dub) — the stored format follows the real file.
  "studio-transcribe": { group: "media", output: "mp4" },
  "studio-dub": { group: "media", output: "mp4" },
  podcast: { group: "media", output: "mp3" },
  greeting: { group: "media", output: "mp3" },
  portrait: { group: "media", output: "png" },
  video: { group: "media", output: "mp4" },
};

/**
 * Video tools (program-17 item 5, Studio P3): paid balance only (bonus so'm never pays for video, D5), one shared
 * `video.max_concurrent` cap, and a wait that holds no worker slot (`video-ops.ts`).
 */
export const VIDEO_TOOL_IDS: readonly ToolId[] = ["video", "studio-video"];
export const isPaidOnlyTool = (id: string): boolean => (VIDEO_TOOL_IDS as readonly string[]).includes(id);
/** `'video', 'studio-video'` for SQL: constant ids, never user input. */
export const VIDEO_TOOLS_SQL = VIDEO_TOOL_IDS.map((id) => `'${id}'`).join(", ");

/** Every tool id, in `TOOLS` order. */
export const TOOL_IDS = Object.keys(TOOL_KINDS) as readonly ToolId[];

/** Kind of a stored generation type; `undefined` for an unknown/legacy type. */
export function toolKindOf(type: string): ToolKind | undefined {
  return Object.prototype.hasOwnProperty.call(TOOL_KINDS, type) ? TOOL_KINDS[type as ToolId] : undefined;
}
