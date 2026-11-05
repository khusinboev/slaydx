import { convert } from "../translit";

/**
 * One text normalisation for the market (docs/market/PLAN.md §1.2, §5.2): topic dedupe, the search index and the
 * search query all pass through here, so «Ўзбекистон тарихи», «O'zbekiston tarixi», «Oʻzbekiston tarixi» and the very
 * common «ozbekiston tarixi» meet on one form. Isomorphic and pure.
 *
 * Apostrophes are REMOVED, not unified: users type «ozbekiston» at least as often as «o'zbekiston», and Postgres
 * `simple` would split «o'zbekiston» into two lexemes anyway.
 */

/** Every apostrophe-like character the codebase and its users write. */
const APOSTROPHES = /['ʻʼ’‘`´]/g;

/** Cyrillic → Latin, lowercase, no apostrophes, only letters and digits separated by single spaces. */
export function normalizeText(text: string): string {
  return convert(String(text ?? ""), "cyr", "lat")
    .normalize("NFC")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The dedupe key of a topic (`market_items.topic_norm`). */
export const normalizeTopic = (topic: string): string => normalizeText(topic).slice(0, 300);

/** `market_items.search_text`: title + summary + outline headings, never the body. */
export function buildSearchText(parts: { title: string; summary: string; outline: readonly string[] }): string {
  return normalizeText([parts.title, parts.summary, ...parts.outline].join(" ")).slice(0, 4000);
}

/** One university name however it was typed: compares the per-(item, university) copy cap. */
export function normalizeUniversity(name: string): string {
  return normalizeText(name)
    .replace(/\b(davlat|universiteti|universitet|instituti|institut|oliy|talim|muassasasi|filiali|university|state)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/** The search query as tsquery terms: only `[\p{L}\p{N}]` words, at most 8, the last one a prefix. `null` when too short. */
export function searchTerms(q: string): { terms: string[]; norm: string } | null {
  const norm = normalizeText(String(q ?? "").slice(0, 100));
  if (norm.length < 2) return null;
  return { terms: norm.split(" ").filter(Boolean).slice(0, 8), norm };
}

/** Share of Cyrillic letters among all letters of `text`, 0..1. */
export function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return 0;
  return (text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0) / letters;
}
