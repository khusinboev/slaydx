import type { SlideResearch } from "../slide-research";

/** Prompt bo'limlariga meta'dan tashqari beriladigan kontekst. */
export type SlidePromptCtx = {
  research?: SlideResearch | null;
};
