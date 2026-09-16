/**
 * FLESH KARTALAR KIRISHI (AUDIT-21 WP-B) — formadan dvigatelgacha.
 *
 * `teacher/input.ts` naqshi: `FormValues` bilan `FlashcardsInput`
 * orasidagi YAGONA ko'prik. Nega `DocMeta` yetarli emas: `extractMeta`
 * umumiy va u `cardCount`, `cardType`, `includeExample` maydonlarini
 * BILMAYDI; shu bilan birga `meta` dan voz kechib ham bo'lmaydi —
 * mavzu, til, fan va sinf o'sha yerdan keladi.
 *
 * DIAPAZON QAYTA TEKSHIRILADI: forma nima yuborishidan qat'i nazar
 * `cardCount` reyestr chiplariga (`GAME_LIMITS.counts`) siqiladi va
 * `cardType` noma'lum bo'lsa kindning standart turiga tushadi —
 * mijoz tomonida tekshirilgan qiymat server uchun DALIL emas.
 *
 * Server importi YO'Q (izomorf: forma zondidan ham chaqiriladi).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import { gameTypeOf } from "../registry";
import { GAME_LIMITS, normalizeGameCount, type FlashcardType } from "../types";

export type CardsLang = "uz" | "ru" | "en";

export type FlashcardsInput = {
  /** Reyestr tur id (`term-def` | `qa`) — `FlashcardsModel.type` bilan AYNI. */
  type: string;
  /** Model turi — reyestrdan olinadi (id bilan bir xil, lekin shartnoma reyestrda). */
  cardType: FlashcardType;
  topic: string;
  subject: string;
  /** Hujjat tili (18 til, to'liq kod) — promptga ham, modelga ham shu ketadi. */
  language: string;
  /** Prompt yozilishi uchun uch guruhga siqilgan til. */
  lang: CardsLang;
  /** 1–11; 0 — sinf ko'rsatilmagan. */
  grade: number;
  cardCount: number;
  includeExample: boolean;
  extra: string;
};

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";

const bool = (v: unknown, fallback: boolean): boolean =>
  v === undefined || v === null || v === "" ? fallback : v !== false && v !== "no" && v !== "false" && v !== "yoq" && v !== 0 && v !== "0";

export function cardsLangOf(language: string): CardsLang {
  const l = String(language ?? "").toLowerCase();
  return l === "ru" ? "ru" : l === "en" ? "en" : "uz";
}

export function flashcardsInputFromValues(meta: DocMeta, values: FormValues): FlashcardsInput {
  const spec = gameTypeOf("flashcards", values.cardType);
  const language = str(values.language, 12) || meta.language || "uz";
  const grade = Math.max(0, Math.min(11, Math.round(Number(values.grade ?? meta.grade ?? 0)) || 0));
  return {
    type: spec.id,
    cardType: spec.cardType,
    topic: str(values.topic, GAME_LIMITS.topicChars) || str(meta.topic, GAME_LIMITS.topicChars),
    subject: str(values.subject, 120) || str(meta.subject, 120),
    language,
    lang: cardsLangOf(language),
    grade,
    cardCount: normalizeGameCount(values.cardCount),
    /*
     * Standart REYESTRDAN (`includeExampleDefault`), formadagi qattiq
     * `false` dan emas: tur «misol bilan foydali» deb belgilangan bo'lsa,
     * maydonga tegilmagan forma ham shu standartni olishi kerak.
     */
    includeExample: bool(values.includeExample, spec.limits.includeExampleDefault),
    extra: typeof values.extra === "string" ? values.extra.trim().slice(0, GAME_LIMITS.extraChars) : str(meta.extra, GAME_LIMITS.extraChars),
  };
}
