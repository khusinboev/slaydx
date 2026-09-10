import { languageDirective, langInfo } from "../i18n";
import type { GlossaryEntry, TranslationStyle } from "./report";

/**
 * Tarjima promptlari (Tarjimon 2).
 *
 * Ko'rsatmalar INGLIZCHA: tuzilma qoidalarini (tokenlar, JSON, id
 * mosligi) model inglizcha ko'rsatmada ishonchliroq bajaradi; chiqish
 * tilini esa birinchi qator — `languageDirective` — qat'iy belgilaydi
 * (u ko'rsatma tili ≠ chiqish tili ekanini o'zi aytadi). Mazmun yozuvchi
 * promptlar o'zbekcha qolgan: u yerda o'zbek registrining o'zi muhim.
 */

export const STYLE_LINE: Record<TranslationStyle, string> = {
  formal: "formal academic/official register; precise established terminology; no colloquialisms",
  business: "clear business register; concise; active voice; consistent product and company terminology",
  plain: "plain everyday language; short sentences; explain jargon only where the source does",
  literary: "literary register; preserve imagery, rhythm and tone; render idioms with equivalent idioms",
};

const LANG_CODES = ["uz", "kaa", "kk", "ky", "tg", "tk", "ru", "en", "tr", "ar", "de", "fr", "es", "zh", "ko", "ja", "it", "pt"];

function sourceLine(sourceLang: string, detected: string | undefined): string {
  if (sourceLang && sourceLang !== "avto") return langInfo(sourceLang).name;
  if (detected && detected !== "avto") return `${langInfo(detected).name} (auto-detected)`;
  return "detect it from the text";
}

export function translationSystem(
  target: string,
  sourceLang: string,
  detected: string | undefined,
  style: TranslationStyle,
  glossary: GlossaryEntry[],
  domain?: string,
): string {
  const gl = glossary.length
    ? `4. Terminology — use exactly these translations, consistently, every time the term occurs: ${glossary
        .map((g) => `«${g.src}» → «${g.dst}»`)
        .join("; ")}.`
    : `4. Terminology — keep every recurring term translated the same way throughout.`;
  return [
    languageDirective(target),
    `You are a professional document translator (${STYLE_LINE[style]}).`,
    `Source language: ${sourceLine(sourceLang, detected)}. Target language: ${langInfo(target).name}.`,
    domain ? `Domain: ${domain}.` : "",
    `You receive a JSON array of text items with ids. Return ONLY JSON: {"items":[{"id":"…","text":"…"}]} with EVERY id, in the same order.`,
    `Rules:`,
    `1. Translate the meaning naturally; do not calque word by word. Keep sentence count and paragraph boundaries; each item is one paragraph, cell, heading or line — never merge, split, reorder or drop items.`,
    `2. Keep VERBATIM: numbers, dates, units, currency, product and brand names, personal names (transliterate only when the target script differs), formulas, code, URLs, e-mails, file names, {{placeholders}}, %s-style format specifiers and ALL-CAPS acronyms.`,
    `3. Markers like ⟦tab⟧ ⟦br⟧ ⟦1⟧ ⟦r1⟧…⟦/r1⟧ ⟦l1⟧…⟦/l1⟧ are layout tokens. Copy every token unchanged and in the same count; keep paired tokens around the corresponding words. Never invent tokens.`,
    gl,
    `5. No notes, no explanations, no brackets with the original, no "translator's note". Do not shorten or summarise. Do not add headings.`,
    `6. Headings stay headings (short, no trailing period unless the source has one); table cells stay short; list items keep their form.`,
    `7. If an item is already in the target language or contains nothing to translate, return it unchanged.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type BatchItem = { id: string; kind: string; ctx?: string; text: string };

export function translationBatchUser(items: BatchItem[], index: number, total: number, prevTail?: string): string {
  return [
    `Batch ${index + 1} of ${total}.`,
    prevTail ? `Preceding context (already handled elsewhere — do NOT translate it, for continuity only):\n«${prevTail}»` : "",
    `Items (JSON): ${JSON.stringify(items)}`,
    `Return {"items":[{"id":"…","text":"…"}]} — one entry per id.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Qayta urinish: faqat muvaffaqiyatsiz idlar, qat'iyroq ko'rsatma. */
export function strictSuffix(reasons: string): string {
  return `\nPrevious attempt failed validation for these ids: ${reasons}. Return ONLY these ids. Every number, URL, e-mail and ⟦token⟧ from the source must appear unchanged in the translation; the text must be translated, not copied.`;
}

export function glossarySystem(target: string): string {
  return [
    `You analyse a document before it is translated into ${langInfo(target).name}.`,
    `Return ONLY JSON: {"detected":"<ISO 639-1 code of the source language, one of: ${LANG_CODES.join(", ")}>","domain":"<3-6 words in English>","glossary":[{"src":"<term exactly as written in the sample>","dst":"<translation in ${langInfo(target).name}>"}]}`,
    `Glossary: 10-40 domain terms, proper names, recurring phrases and abbreviations that must be translated consistently. "src" must occur verbatim in the sample. Prefer established official, academic or industry terminology. No generic everyday words.`,
  ].join("\n");
}

export function glossaryUser(sample: string, sampleChars: number, totalChars: number): string {
  return `Sample (${sampleChars} of ${totalChars} characters):\n${sample}`;
}
