import type { DocMeta } from "./types";

/**
 * Kolontitul matni — YAGONA manba.
 *
 * Ilgari `[meta.author, meta.university].join(" · ")` uch joyda alohida
 * yozilgan edi (`fallbackSlides`, `writeSlidesWithLlm`, `slides.ts`). Endi
 * lavozim va tashkilot ham kiradi va hammasi shu yerdan o'qiydi —
 * bittasini o'zgartirib boshqasini unutish mumkin emas.
 *
 * Tartib: muallif · lavozim · tashkilot (tashkilot yo'q bo'lsa
 * universitet). Bo'shlari tashlanadi.
 */
export function deckFooter(meta: Pick<DocMeta, "author" | "position" | "organization" | "university">): string {
  return [meta.author, meta.position, meta.organization || meta.university]
    .map((v) => (v || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}
