/**
 * MODEL JAVOBI → BLOKLAR (AUDIT-19 WP-D).
 *
 * Insho — oqadigan nasr: faqat `p` bloklari kerak (jadval/sxema/iqtibos
 * reyestri yo'q). Shuning uchun maqolaning boy `blocksFromLlm` i o'rniga
 * shu kichik, insho qoidalarini biladigan parser:
 *   • JSON `{"blocks":[{"kind":"p","text":"…"}]}` — asosiy yo'l;
 *   • JSON `{"paragraphs":["…"]}` yoki sof massiv — modelning tez-tez
 *     uchraydigan chetlanishi;
 *   • umuman JSON emas — xom matn paragraflarga bo'linadi (`quality.ts`
 *     `blocksFromText`, u markdown va sarlavhalarni tozalaydi).
 *
 * Sarlavha bloklari (`h1`/`h2`) ATAYLAB tashlanadi: inshoda ichki
 * sarlavha bo'lmaydi (IELTS da esa u to'g'ridan-to'g'ri band yo'qotadi).
 */
import { parseLlmObject } from "../json";
import { blocksFromText, cleanText } from "../quality";
import type { Block } from "../types";

/** Bitta paragrafning eng kam uzunligi (belgi) — bo'sh «…» tashlanadi. */
const MIN_PARA_CHARS = 30;

function textsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === "string") return x;
      const o = x as { kind?: unknown; text?: unknown } | null;
      if (!o || typeof o !== "object") return "";
      const kind = String(o.kind ?? "p");
      if (kind !== "p" && kind !== "li" && kind !== "quote") return "";
      return typeof o.text === "string" ? o.text : "";
    })
    .map((t) => cleanText(t))
    .filter((t) => t.length >= MIN_PARA_CHARS);
}

/** Model javobi → insho bandlari (`p`). Bo'sh massiv — javob yaroqsiz. */
export function essayBlocksFromLlm(raw: string | null | undefined): Block[] {
  const j = parseLlmObject<{ blocks?: unknown; paragraphs?: unknown }>(raw ?? "");
  const fromBlocks = textsOf(j?.blocks);
  const texts = fromBlocks.length ? fromBlocks : textsOf(j?.paragraphs);
  if (texts.length) return texts.map((text) => ({ kind: "p" as const, text }));
  if (!raw) return [];
  // JSON emas (yoki blok kalitlari boshqacha) — xom matnni paragraflarga bo'lamiz.
  return blocksFromText(raw).filter((b) => b.kind === "p" && b.text.length >= MIN_PARA_CHARS);
}
