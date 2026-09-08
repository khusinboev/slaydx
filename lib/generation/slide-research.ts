import type { DocMeta } from "./types";

/**
 * Internet TADQIQOTI — Gemini grounding (`google_search`).
 *
 * Jonli tasdiqlangan (2026-09-08): `generateContent` da
 * `tools:[{google_search:{}}]` ishlaydi, javob `groundingMetadata`
 * (`webSearchQueries`, `groundingChunks[].web{uri,title}`,
 * `groundingSupports`, `searchEntryPoint`). `uri` — Google redirect,
 * `title` — domen. JSON rejimi bilan birga ISHLAMAYDI → ikki chaqiruv:
 * shu yerda matnli tadqiqot, keyin deck JSON.
 *
 * WP-0a: shartnoma. `runSlideResearch` WP-D da amalga oshiriladi;
 * hozir `null` — deck yozuvchisi buni «tadqiqot yo'q» deb o'qiydi.
 */
export type SlideSource = { title: string; uri: string };

export type SlideResearch = {
  /** Tekshirilgan faktlar matni — promptga `sourceBlock` naqshida kiradi. */
  facts: string;
  sources: SlideSource[];
  queries: string[];
  /** Google ToS: qidiruv takliflari HTML — sayt ko'ruvchisida ko'rsatiladi. */
  entryPoint?: string;
};

export async function runSlideResearch(meta: DocMeta, deadline?: number): Promise<SlideResearch | null> {
  void deadline;
  if (meta.internetSearch !== true) return null;
  return null;
}
