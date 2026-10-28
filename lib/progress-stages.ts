/**
 * Generation progress stages per tool — ONE source for the worker's fallback ticker
 * (`progressTicker` step text) and the result page's stage checklist.
 *
 * Shared by server and client (no `server-only`, no DB). A stage is `{ from, label }`:
 * it is "current" while `progress >= from` and the next stage has not started. The `from`
 * marks mirror the real `stage(progress, …)` calls of each engine (`lib/generation/**`);
 * the engine's own step text ("Paragraflar · 6/14") is shown next to the label, so the
 * marks only need to be approximately right — they bound the visual creep
 * (`lib/progress-smooth.ts`) and decide which checklist row is highlighted.
 */
import type { ToolId } from "./types";

export type StageDef = { readonly from: number; readonly label: string };

/** Visual flavour of the running panel (`components/files/GenerationProgress.tsx`). */
export type ProgressKind = "doc" | "article" | "essay" | "teacher" | "game" | "listening" | "infographic" | "audio" | "image" | "translation" | "resume" | "slides" | "video";

const STAGES: Record<ProgressKind, readonly StageDef[]> = {
  // coursework / referat / mustaqil-ish — `work/engine.ts`
  doc: [
    { from: 0, label: "Manbalar qidirilmoqda" },
    { from: 10, label: "Reja tuzilmoqda" },
    { from: 18, label: "Matn yozilmoqda" },
    { from: 60, label: "Jadval va sxemalar" },
    { from: 76, label: "Adabiyotlar tekshirilmoqda" },
    { from: 80, label: "Tayyorlik hisoboti" },
    { from: 88, label: "Avto-sayqal" },
  ],
  // thesis / article — `article/engine.ts`
  article: [
    { from: 0, label: "Manbalar qidirilmoqda" },
    { from: 12, label: "Reja tuzilmoqda" },
    { from: 18, label: "Bo‘limlar yozilmoqda" },
    { from: 62, label: "Jadval va sxemalar" },
    { from: 74, label: "Annotatsiya yozilmoqda" },
    { from: 82, label: "Adabiyotlar tekshirilmoqda" },
    { from: 88, label: "Tayyorlik hisoboti" },
    { from: 92, label: "Avto-sayqal" },
  ],
  // `essay/engine.ts`
  essay: [
    { from: 0, label: "Reja tuzilmoqda" },
    { from: 15, label: "Insho yozilmoqda" },
    { from: 60, label: "Til darajasi tekshirilmoqda" },
    { from: 70, label: "Tayyorlik hisoboti" },
    { from: 90, label: "Avto-sayqal" },
  ],
  // lesson-plan / texnologik-xarita / glossary / keys / test — `teacher/engine.ts` (10/65/75/88), `teacher/test/engine.ts` (8/60/70/85)
  teacher: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 8, label: "Mazmun yozilmoqda" },
    { from: 60, label: "Hujjat yig‘ilmoqda" },
    { from: 70, label: "Tayyorlik hisoboti" },
    { from: 85, label: "Avto-sayqal" },
  ],
  // crossword / flashcards / sorting — `games/**`
  game: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 10, label: "Mazmun yozilmoqda" },
    { from: 55, label: "Varaq tayyorlanmoqda" },
    { from: 75, label: "Tayyorlik hisoboti" },
    { from: 90, label: "Avto-sayqal" },
  ],
  // `games/listening/engine.ts` (TTS audio 50, sheet 70)
  listening: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 10, label: "So‘zlar tanlanmoqda" },
    { from: 50, label: "Audio tayyorlanmoqda" },
    { from: 70, label: "Varaq tayyorlanmoqda" },
    { from: 75, label: "Tayyorlik hisoboti" },
    { from: 90, label: "Avto-sayqal" },
  ],
  // `infographic/engine.ts`
  infographic: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 10, label: "Plakat mazmuni yozilmoqda" },
    { from: 40, label: "Matn plakatga moslanmoqda" },
    { from: 55, label: "Plakat chizilmoqda" },
    { from: 80, label: "Tekshiruv va sayqal" },
  ],
  // podcast / greeting — `audio/engine.ts` (68 → 92 is the long TTS stage)
  audio: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 8, label: "Ssenariy yozilmoqda" },
    { from: 30, label: "Ssenariy tekshirilmoqda" },
    { from: 68, label: "Ovozga o‘girilmoqda" },
    { from: 92, label: "Audio yig‘ilmoqda" },
  ],
  // `image-studio.ts`
  image: [
    { from: 0, label: "So‘rov tayyorlanmoqda" },
    { from: 10, label: "Rasm chizilmoqda" },
    { from: 85, label: "Fayl saqlanmoqda" },
  ],
  // video — `video-ops.ts`: submit (0-10), the provider works (10-90, creeps with time), download + save (90-)
  video: [
    { from: 0, label: "So‘rov provayderga yuborilmoqda" },
    { from: 10, label: "Video tayyorlanmoqda" },
    { from: 90, label: "Fayl saqlanmoqda" },
  ],
  // `translate/engine.ts`
  translation: [
    { from: 0, label: "Manba o‘qilmoqda" },
    { from: 8, label: "Atamalar aniqlanmoqda" },
    { from: 10, label: "Tarjima qilinmoqda" },
    { from: 90, label: "Hujjat yig‘ilmoqda" },
  ],
  // `resume/write.ts`
  resume: [
    { from: 0, label: "Ma’lumotlar tayyorlanmoqda" },
    { from: 15, label: "Matn yozilmoqda" },
    { from: 80, label: "Hujjat yig‘ilmoqda" },
  ],
  // slide / pro-slide — the live deck owns the panel; this list is the fallback before the first live frame
  slides: [
    { from: 0, label: "Reja tuzilmoqda" },
    { from: 10, label: "Slaydlar yozilmoqda" },
    { from: 70, label: "Rasmlar tayyorlanmoqda" },
    { from: 90, label: "Fayl yig‘ilmoqda" },
  ],
};

const KIND_BY_TOOL: Record<ToolId, ProgressKind> = {
  slide: "slides",
  "pro-slide": "slides",
  coursework: "doc",
  referat: "doc",
  "mustaqil-ish": "doc",
  konspekt: "doc",
  thesis: "article",
  article: "article",
  essay: "essay",
  resume: "resume",
  translation: "translation",
  image: "image",
  portrait: "image",
  video: "video",
  infographic: "infographic",
  "lesson-plan": "teacher",
  "texnologik-xarita": "teacher",
  glossary: "teacher",
  keys: "teacher",
  test: "teacher",
  crossword: "game",
  flashcards: "game",
  sorting: "game",
  listening: "listening",
  podcast: "audio",
  greeting: "audio",
};

export function progressKindOf(toolId: string): ProgressKind {
  return (KIND_BY_TOOL as Record<string, ProgressKind | undefined>)[toolId] ?? "doc";
}

export function stagesFor(toolId: string): readonly StageDef[] {
  return STAGES[progressKindOf(toolId)];
}

/** Index of the stage that `progress` (0..99) falls into. */
export function stageIndexAt(stages: readonly StageDef[], progress: number): number {
  let idx = 0;
  for (let i = 0; i < stages.length; i++) if (progress >= stages[i].from) idx = i;
  return idx;
}

/** Progress at which the stage after `idx` begins (the visual creep never passes it); 99 after the last one. */
export function stageCeiling(stages: readonly StageDef[], idx: number): number {
  const next = stages[idx + 1];
  return next ? next.from - 1 : 98;
}

/** Test seam: every kind, for the "all tools covered / marks ascend" invariant. */
export const PROGRESS_KINDS = Object.keys(STAGES) as ProgressKind[];
export const PROGRESS_TOOL_IDS = Object.keys(KIND_BY_TOOL) as ToolId[];
