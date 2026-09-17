/**
 * AUDIO (AUDIT-22) FORMA PARAMETRLARI REYESTRI.
 *
 * Qoida (slayd/rezyume/maqola/talaba ishi/o'qituvchi/o'yinlar bilan bir
 * xil): formada ko'ringan HAR maydon shu yerda e'lon qilinadi, va
 * differensial zond (`tests/audio-params.test.mts`, WP-A) uni
 * qulflaydi — parametr chiqishga ta'sir qilmasa test qizaradi («bezak
 * maydon yo'q», mahsulot egasi qarori 14).
 *
 * R0 da bu fayl REYESTRNING O'ZI: har parametr qaysi vositalarda
 * ko'rinadi (`kinds`), nimaga ta'sir qiladi (`impacts`) va zond qaysi
 * ikki qiymatni solishtiradi (`probeA`/`probeB`). Zondning O'ZI (forma →
 * `buildAudioArtifact` → ssenariy farqi) WP-A da ulanadi, chunki
 * dvigatel va TTS kalitlari o'sha yerda. Bugun tekshiriladigan narsa —
 * reyestrning butunligi: id lar unikal, har parametrning egasi va
 * ta'siri bor, va `lib/tools.ts` dagi maydonlar ro'yxati bilan AYNAN mos.
 *
 * Manba: `docs/research/{podcast,greeting}.md` §3 jadvallari.
 *
 * NARX: HECH BIR parametr narxga ta'sir qilmaydi — ikkala vosita ham
 * tekis 4 000 (mahsulot egasi qarori 6). Shuning uchun `price` ta'siri
 * bu reyestrda umuman yo'q; `tests/pricing.test.mts` buni mutatsiya
 * bilan tekshiradi.
 */
import type { FormValues } from "../types";
import { AUDIO_KINDS, type AudioKind } from "./audio/types";

export type AudioParamImpact =
  /** Tizim/foydalanuvchi prompti matni. */
  | "prompt"
  /** Ssenariy SKELETI — bloklar, replikalar soni, so'z byudjeti. */
  | "structure"
  /** `doc.audio` modeli (`script`, `type`, `language`). */
  | "model"
  /** TTS: ovoz tanlovi yoki bo'laklar soni. */
  | "tts"
  /** Hisobot qoidalari (`AUDIO_RULE_IDS`) yoki baholovchi. */
  | "review"
  /** Manba: yuklangan fayl yoki qo'yilgan matn. */
  | "source"
  /** `meta.language` / hujjat tili. */
  | "language"
  /** Ish byudjeti (`audioBudgetMs`). */
  | "budget";

export type AudioParam = {
  id: string;
  /** Qaysi vositalarda ko'rinadi — bo'sh bo'lmasligi kerak. */
  kinds: readonly AudioKind[];
  encode: "string" | "boolean" | "number";
  probeA: FormValues[string];
  probeB: FormValues[string];
  impacts: readonly AudioParamImpact[];
  /** Zondni shu qiymatlar ustida o'tkazish (masalan `mode: "text"`). */
  probeWith?: FormValues;
};

const ALL = AUDIO_KINDS;

export const AUDIO_PARAMS: AudioParam[] = [
  /* ── umumiy ── */
  { id: "topic", kinds: ["podcast"], encode: "string", probeA: "Sun'iy intellekt va ta'lim", probeB: "Orol dengizi muammosi", impacts: ["prompt", "model"] },
  { id: "language", kinds: ALL, encode: "string", probeA: "uz", probeB: "ru", impacts: ["language", "prompt", "model", "tts"] },
  { id: "durationMin", kinds: ALL, encode: "number", probeA: 1, probeB: 4, impacts: ["prompt", "structure", "review", "budget", "tts"] },
  { id: "extra", kinds: ALL, encode: "string", probeA: "", probeB: "7-sinf o'quvchilariga mo'ljallang.", impacts: ["prompt"] },

  /* ── podkast (podcast.md §3) ── */
  /*
   * `mode` — uchta qiymat, lekin zond IKKITASINI solishtiradi (`topic` va
   * `text`): fayl rejimi worker orqali keladi (`sourceForJob`) va uni
   * zondda takrorlash server qatlamini talab qilardi.
   */
  { id: "mode", kinds: ["podcast"], encode: "string", probeA: "topic", probeB: "text", impacts: ["source", "prompt", "review"] },
  {
    id: "sourceText",
    kinds: ["podcast"],
    encode: "string",
    probeA: "",
    probeB: "Sun'iy intellekt maktab ta'limida: shaxsiylashtirilgan mashqlar, avtomatik baholash va o'qituvchining yangi roli.",
    probeWith: { mode: "text" },
    impacts: ["source", "prompt", "model"],
  },
  { id: "podcastType", kinds: ["podcast"], encode: "string", probeA: "tushuntirish", probeB: "intervyu", impacts: ["prompt", "structure", "review", "model"] },

  /* ── tabriknoma (greeting.md §3) ── */
  { id: "recipient", kinds: ["greeting"], encode: "string", probeA: "Dilnoza opa", probeB: "Akmal aka", impacts: ["prompt", "model", "review"] },
  { id: "relation", kinds: ["greeting"], encode: "string", probeA: "ustozim", probeB: "do'stim", impacts: ["prompt", "review"] },
  /*
   * `occasion` — reyestr JANRI (`audio/registry.ts`): chip qiymati tur
   * id si bo'lib, promptga tayyor ibora va o'z `guidance` ini olib
   * kiradi. Shuning uchun u `podcastType` bilan bir xil ta'sirga ega.
   */
  { id: "occasion", kinds: ["greeting"], encode: "string", probeA: "ustoz-kuni", probeB: "navroz", impacts: ["prompt", "structure", "review", "model"] },
];

/** Formadan yuboriladigan maydon nomlari (`lib/tools.ts` shu ro'yxatni to'ldiradi). */
export const AUDIO_FORM_FIELDS = AUDIO_PARAMS.map((p) => p.id);

/** Bitta vositaning maydonlari — forma shu tartibda chizadi. */
export function audioParamsOf(kind: AudioKind): AudioParam[] {
  return AUDIO_PARAMS.filter((p) => p.kinds.includes(kind));
}
