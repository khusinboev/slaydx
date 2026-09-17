/**
 * TINGLASH O'YINI KIRISHI (AUDIT-22 WP-D) — formadan dvigatelgacha.
 *
 * ── Nega bu yerda IKKI til bor va «hujjat tili» YO'Q
 *
 * Boshqa vositalarda bitta `language` maydoni bor, tinglashda esa
 * ikkita: `targetLanguage` — EShITILADIGAN matn tili (TTS ovozi shu
 * kod bo'yicha tanlanadi), `nativeLanguage` — VARIANTLAR tili
 * (o'quvchining ona tili). Uchinchi «hujjat tili» tanlovi hech qayerga
 * chiqmasdi — aynan «bezak maydon» bo'lardi (egasi qarori 14,
 * `lib/tools.ts` izohi), shuning uchun `GameModel.language` =
 * `nativeLanguage`: varaqdagi ko'rsatma, sarlavha va variantlar shu
 * tilda yoziladi.
 *
 * Ikkala til BIR XIL bo'lsa mashq ma'nosini yo'qotadi («library» →
 * «library»), shuning uchun teng kelganda o'rganiladigan til
 * `LISTENING_FALLBACK_TARGET` ga tushadi — `languagePair` qoidasi esa
 * buni hisobotda ham ko'rsatadi.
 *
 * Server importi YO'Q (izomorf: forma zondidan ham chaqiriladi).
 */
import type { FormValues } from "../../../types";
import type { DocMeta } from "../../types";
import { gameTypeOf } from "../registry";
import { GAME_LIMITS, normalizeListeningCount } from "../types";

export type ListeningLang = "uz" | "ru" | "en";

/** Ona tili bilan teng kelganda — ingliz tili (mahsulotning eng ko'p so'raladigan jufti). */
export const LISTENING_FALLBACK_TARGET = "en";
/** Ona tili berilmagan bo'lsa — o'zbek tili (mahsulotning asosiy tili). */
export const LISTENING_FALLBACK_NATIVE = "uz";

export type ListeningInput = {
  /** Reyestr tur id (`sozlar` | `iboralar`). */
  type: string;
  topic: string;
  subject: string;
  /** Variantlar va varaq matni tili — `GameModel.language` ham SHU. */
  nativeLanguage: string;
  /** Eshitiladigan matn tili — TTS ovozi shu kod bo'yicha tanlanadi. */
  targetLanguage: string;
  /** Prompt yozilishi uchun uch guruhga siqilgan ONA tili. */
  lang: ListeningLang;
  /** 1–11; 0 — sinf ko'rsatilmagan. */
  grade: number;
  itemCount: number;
  /** Variantlar soni (3–4). */
  optionCount: number;
  extra: string;
};

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "";

export function listeningLangOf(language: string): ListeningLang {
  const l = String(language ?? "").toLowerCase();
  return l === "ru" ? "ru" : l === "en" ? "en" : "uz";
}

export function listeningInputFromValues(meta: DocMeta, values: FormValues): ListeningInput {
  const spec = gameTypeOf("listening", values.listeningType);
  const nativeLanguage = str(values.nativeLanguage, 12) || meta.language || LISTENING_FALLBACK_NATIVE;
  const asked = str(values.targetLanguage, 12) || LISTENING_FALLBACK_TARGET;
  const targetLanguage = asked === nativeLanguage ? (nativeLanguage === LISTENING_FALLBACK_TARGET ? LISTENING_FALLBACK_NATIVE : LISTENING_FALLBACK_TARGET) : asked;
  const grade = Math.max(0, Math.min(11, Math.round(Number(values.grade ?? meta.grade ?? 0)) || 0));
  return {
    type: spec.id,
    topic: str(values.topic, GAME_LIMITS.topicChars) || str(meta.topic, GAME_LIMITS.topicChars),
    subject: str(values.subject, 120) || str(meta.subject, 120),
    nativeLanguage,
    targetLanguage,
    lang: listeningLangOf(nativeLanguage),
    grade,
    itemCount: normalizeListeningCount(values.itemCount),
    /*
     * Variantlar soni formada SO'RALMAYDI (`lib/tools.ts` da maydon
     * yo'q) — reyestr standarti 4. Maydon baribir kirishda turadi:
     * prompt, hisobot (`optionCount`) va o'yinchi ekrani uni bitta
     * manbadan o'qishi kerak, aks holda 3 variantli topshiriq 4
     * tugmali ekranda bo'sh joy qoldirardi.
     */
    optionCount: Math.min(spec.limits.options[1], Math.max(spec.limits.options[0], Math.round(Number(values.optionCount)) || spec.limits.optionsDefault)),
    extra: typeof values.extra === "string" ? values.extra.trim().slice(0, GAME_LIMITS.extraChars) : str(meta.extra, GAME_LIMITS.extraChars),
  };
}
