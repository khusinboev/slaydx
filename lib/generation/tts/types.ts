/**
 * TTS ADAPTER SHARTNOMASI (AUDIT-22 R0) — `llm/chain.ts` naqshi.
 *
 * R0 da bu fayl FAQAT interfeys, til → ovoz jadvali, bo'laklash va
 * hisoblagich. PROVAYDER CHAQIRUVI YO'Q va ataylab yozilmaydi: egasida
 * `AZURE_SPEECH_KEY`/`AISHA_API_KEY` hali yo'q (`tts.md` §3, §6), ya'ni
 * `azure.ts`/`aisha.ts`/`chain.ts` ni bugun yozish — sinovsiz kod
 * yozish bo'lardi. Ular WP-A da, kalitlar kelgach qo'shiladi va AYNAN
 * shu shartnomaga tushadi.
 *
 * Nega shartnoma HOZIR kerak: `audio/engine.ts` (WP-A), byudjet, narx
 * va `cost_json` telemetriyasi undan o'qiydi; bo'laklash chegarasi esa
 * `AUDIO_LIMITS.lineCharsMax` bilan bog'langan (replika hech qachon
 * ikki so'rovga bo'linmasin).
 *
 * Izomorf: server/DOM importi YO'Q — `Uint8Array` dan boshqa hech narsa
 * kerak emas, shuning uchun testlar ham, forma ham uni o'qiy oladi.
 *
 * Manba: `docs/research/tts.md` §3.
 */
import { ttsCost, type TtsCost } from "../llm-pricing";

/* ────────────────────────── provayder ────────────────────────── */

export const TTS_PROVIDERS = ["azure", "aisha", "gemini", "google", "elevenlabs"] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];

export const isTtsProviderId = (v: unknown): v is TtsProviderId => (TTS_PROVIDERS as readonly string[]).includes(String(v));

export type TtsSynthOpts = {
  /** Til kodi (18 til) — ovoz jadvali kaliti. */
  lang: string;
  /** `provider:voice` yoki faqat ovoz nomi; berilmasa jadvaldagi birinchisi. */
  voice?: string;
  /** Tezlik ko'paytuvchisi (1 = normal). Provayder qo'llamasa e'tiborsiz. */
  speed?: number;
  /*
   * WP-A qo'shimchasi (shartnoma KENGAYDI, o'zgarmadi — ikkala maydon
   * ham IXTIYORIY va `speed` bilan ayni semantikada: provayder
   * qo'llamasa e'tiborsiz qoldiradi).
   */
  /**
   * Replikadan KEYINGI pauza (ms) — SSML `<break time="…"/>`.
   *
   * Faqat Azure qo'llaydi (`tts.md` §3: pauza mexanizmi provayderga
   * bog'liq); Aisha/Gemini uni e'tiborsiz qoldiradi. Nega opsiyada,
   * matn ichida emas: `<break>` teg XOM MATNGA qo'shilsa, SSML
   * qo'llamaydigan provayder uni OVOZ CHIQARIB o'qib yuborardi.
   */
  pauseMs?: number;
  /**
   * Bitta so'rovning vaqt chegarasi (ms) — worker muddatidan keladi.
   *
   * Berilmasa adapter o'z standartini oladi (`TTS_LIMITS.callTimeoutMs`).
   */
  timeoutMs?: number;
};

/**
 * Provayder xatosi (WP-A) — `TtsProvider.synthesize` ISTISNO tashlaydi
 * (yuqoridagi shartnoma izohi), zanjir esa `retryable` ni ko'rib
 * qaror qiladi: `false` — keyingi provayderga DARHOL o'tiladi
 * (`llm/chain.ts` naqshi), `true` — shu provayder qayta uriladi.
 */
export class TtsError extends Error {
  readonly provider: TtsProviderId;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(provider: TtsProviderId, message: string, o: { retryable?: boolean; status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "TtsError";
    this.provider = provider;
    this.retryable = o.retryable ?? false;
    if (o.status !== undefined) this.status = o.status;
    if (o.retryAfterMs !== undefined) this.retryAfterMs = o.retryAfterMs;
  }
}

/** Xato `retryable` mi — noma'lum istisno (tarmoq) QAYTA URINISHGA arziydi. */
export function isRetryableTtsError(e: unknown): boolean {
  return e instanceof TtsError ? e.retryable : true;
}

/**
 * Sintez natijasi.
 *
 * `mp3` va `wav` — IKKALASI ixtiyoriy va aynan bittasi to'ladi: Azure
 * to'g'ridan-to'g'ri MP3 beradi, Aisha esa WAV (`tts.md` §3). Yagona
 * «bytes» maydoni qilish formatni YO'QOTARDI, va MP3 birlashtiruvchi
 * (`tts/mp3.ts`, WP-A) WAV baytlarni MP3 kadri deb ulab yuborardi —
 * natija o'ynamaydigan fayl bo'lardi.
 */
export type TtsAudio = {
  mp3?: Uint8Array;
  wav?: Uint8Array;
  /** Tayyor audio uzunligi — provayder qaytargan yoki o'lchangan. */
  seconds: number;
  /** Hisoblangan belgilar (Azure/Aisha tannarxi shu bilan o'lchanadi). */
  chars: number;
  /*
   * Billing facts, set only by token-billed providers (Gemini TTS, from the
   * response's `usageMetadata`); per-character providers leave them out.
   */
  /** Provider model id that served the call — the key of `TTS_PRICING`. */
  model?: string;
  /** Text-input tokens (`promptTokenCount`). */
  inputTokens?: number;
  /** Audio-output tokens (`candidatesTokenCount`, AUDIO modality). */
  outputTokens?: number;
};

/** Sintez natijasidagi baytlar va formati — `mp3`/`wav` dan bittasi. */
export function audioBytes(a: TtsAudio): { bytes: Uint8Array; format: "mp3" | "wav" } | null {
  if (a.mp3 && a.mp3.byteLength) return { bytes: a.mp3, format: "mp3" };
  if (a.wav && a.wav.byteLength) return { bytes: a.wav, format: "wav" };
  return null;
}

/**
 * Bitta provayder adapteri (`azure.ts`, `aisha.ts`, … — WP-A).
 *
 * `synthesize` xato holatida ISTISNO tashlaydi, `null` qaytarmaydi:
 * zanjir (`chain.ts`) keyingi provayderga o'tish uchun sababni ko'rishi
 * kerak, `null` esa «kalit yo'q» bilan «xizmat yiqildi» ni farqlamasdi.
 */
export type TtsProvider = {
  id: TtsProviderId;
  /** Muhitda kalit bormi — zanjir kalitsiz provayderni O'TKAZIB yuboradi. */
  configured(): boolean;
  synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio>;
};

/* ────────────────────────── ovoz jadvali ────────────────────────── */

export type TtsVoiceSpec = {
  provider: TtsProviderId;
  /** Provayderdagi ovoz identifikatori (`uz-UZ-MadinaNeural`). */
  voice: string;
  gender: "female" | "male";
  /**
   * Ovoz RASMIY ro'yxatdan tasdiqlanganmi (`tts.md` §3 jadvali).
   *
   * `false` — bu til uchun provayderda ovoz TOPILMADI va jadvalda unga
   * eng yaqin til ovozi turibdi (qoraqalpoq → o'zbek). Nega jadvalda
   * bo'lsa ham bayroq bilan: forma tilni ko'rsatishi kerak, lekin
   * hisobot foydalanuvchini ogohlantirishi shart — aks holda u
   * qirg'izcha matnni qozoqcha talaffuzda eshitib, sababini bilmasdi.
   * `tts.md` §6 ochiq savoli aynan shu tillar haqida.
   */
  verified: boolean;
};

/**
 * 18 til → ovoz zanjiri (`tts.md` §3 jadvali).
 *
 * Har til uchun ro'yxat TARTIBLI: birinchisi — standart ovoz, keyingisi
 * — muqobil (ikkinchi rol uchun, podkast dialogida) yoki zaxira
 * provayder. `TTS_VOICE_<LANG>` muhit o'zgaruvchisi (WP-A) shu ro'yxatni
 * ALMASHTIRADI, kengaytirmaydi — operator bitta joydan boshqara olsin.
 *
 * O'zbekcha: Azure yagona xalqaro provayder bo'lib rasmiy `uz-UZ` Neural
 * ovozlarga ega; Aisha (mahalliy) — uchinchi zveno (`tts.md` §3).
 */
export const TTS_LANG_VOICES: Record<string, readonly TtsVoiceSpec[]> = {
  uz: [
    { provider: "azure", voice: "uz-UZ-MadinaNeural", gender: "female", verified: true },
    { provider: "azure", voice: "uz-UZ-SardorNeural", gender: "male", verified: true },
    { provider: "aisha", voice: "gulnoza", gender: "female", verified: true },
  ],
  ru: [
    { provider: "azure", voice: "ru-RU-SvetlanaNeural", gender: "female", verified: true },
    { provider: "azure", voice: "ru-RU-DmitryNeural", gender: "male", verified: true },
  ],
  en: [
    { provider: "azure", voice: "en-US-JennyNeural", gender: "female", verified: true },
    { provider: "azure", voice: "en-US-GuyNeural", gender: "male", verified: true },
  ],
  kk: [
    { provider: "azure", voice: "kk-KZ-AigulNeural", gender: "female", verified: true },
    { provider: "azure", voice: "kk-KZ-DauletNeural", gender: "male", verified: true },
  ],
  tr: [
    { provider: "azure", voice: "tr-TR-EmelNeural", gender: "female", verified: true },
    { provider: "azure", voice: "tr-TR-AhmetNeural", gender: "male", verified: true },
  ],
  ar: [
    { provider: "azure", voice: "ar-SA-ZariyahNeural", gender: "female", verified: true },
    { provider: "azure", voice: "ar-SA-HamedNeural", gender: "male", verified: true },
  ],
  de: [
    { provider: "azure", voice: "de-DE-KatjaNeural", gender: "female", verified: true },
    { provider: "azure", voice: "de-DE-ConradNeural", gender: "male", verified: true },
  ],
  fr: [
    { provider: "azure", voice: "fr-FR-DeniseNeural", gender: "female", verified: true },
    { provider: "azure", voice: "fr-FR-HenriNeural", gender: "male", verified: true },
  ],
  es: [
    { provider: "azure", voice: "es-ES-ElviraNeural", gender: "female", verified: true },
    { provider: "azure", voice: "es-ES-AlvaroNeural", gender: "male", verified: true },
  ],
  it: [
    { provider: "azure", voice: "it-IT-ElsaNeural", gender: "female", verified: true },
    { provider: "azure", voice: "it-IT-DiegoNeural", gender: "male", verified: true },
  ],
  pt: [
    { provider: "azure", voice: "pt-BR-FranciscaNeural", gender: "female", verified: true },
    { provider: "azure", voice: "pt-BR-AntonioNeural", gender: "male", verified: true },
  ],
  zh: [
    { provider: "azure", voice: "zh-CN-XiaoxiaoNeural", gender: "female", verified: true },
    { provider: "azure", voice: "zh-CN-YunxiNeural", gender: "male", verified: true },
  ],
  ja: [
    { provider: "azure", voice: "ja-JP-NanamiNeural", gender: "female", verified: true },
    { provider: "azure", voice: "ja-JP-KeitaNeural", gender: "male", verified: true },
  ],
  ko: [
    { provider: "azure", voice: "ko-KR-SunHiNeural", gender: "female", verified: true },
    { provider: "azure", voice: "ko-KR-InJoonNeural", gender: "male", verified: true },
  ],
  /*
   * TASDIQLANMAGAN TO'RTLIK (`tts.md` §3 oxiri, §6 ochiq savoli):
   * qoraqalpoq, qirg'iz, tojik va turkman tillari uchun Azure rasmiy
   * ro'yxatida Neural ovoz TOPILMADI. Jadvalda eng yaqin til ovozi
   * turibdi va `verified: false` — hisobot (WP-A) foydalanuvchini
   * ogohlantiradi, forma esa tilni ko'rsatishda davom etadi.
   */
  kaa: [{ provider: "azure", voice: "uz-UZ-MadinaNeural", gender: "female", verified: false }],
  ky: [{ provider: "azure", voice: "kk-KZ-AigulNeural", gender: "female", verified: false }],
  tg: [{ provider: "azure", voice: "ru-RU-SvetlanaNeural", gender: "female", verified: false }],
  tk: [{ provider: "azure", voice: "tr-TR-EmelNeural", gender: "female", verified: false }],
};

/** Jadvalda tili bo'lmasa — o'zbekcha ovozlar (mahsulotning asosiy tili). */
export const TTS_FALLBACK_LANG = "uz";

/* ────────────────────────── voice choice (female / male) ────────────────────────── */

/*
 * The user picks ONE of two voices in the podcast / greeting form (owner decision
 * 2026-10-10 — the earlier «the voice is not chosen» rule is reversed). The choice
 * names a GENDER, not a provider; the concrete voice name per provider comes from the
 * tables right here (single source):
 *
 *   gemini  TTS_GEMINI_VOICES   female `Kore`, male `Charon` (language-neutral)
 *   azure   TTS_LANG_VOICES     the language's female/male pair (Uzbek:
 *                               `uz-UZ-MadinaNeural` / `uz-UZ-SardorNeural`)
 *   aisha   TTS_LANG_VOICES     a single voice — the choice is ignored
 *
 * When a language has no row of the chosen gender for a provider (Karakalpak,
 * Kyrgyz, … have one voice) the provider's table default (first row) is used.
 */
export const TTS_VOICE_CHOICES = ["female", "male"] as const;
export type TtsVoiceChoice = (typeof TTS_VOICE_CHOICES)[number];

/** Old clients (no field) and unknown values fall back to this voice. */
export const TTS_VOICE_DEFAULT: TtsVoiceChoice = "female";

export const isTtsVoiceChoice = (v: unknown): v is TtsVoiceChoice => (TTS_VOICE_CHOICES as readonly string[]).includes(String(v));

/** Form/API value → `female` | `male`; anything else → `TTS_VOICE_DEFAULT`. */
export function normalizeVoiceChoice(v: unknown): TtsVoiceChoice {
  const s = String(v ?? "").trim().toLowerCase();
  return isTtsVoiceChoice(s) ? s : TTS_VOICE_DEFAULT;
}

/** The other gender — speaker B of a two-speaker podcast takes this voice. */
export const otherVoiceChoice = (c: TtsVoiceChoice): TtsVoiceChoice => (c === "female" ? "male" : "female");

/**
 * Gemini prebuilt voices. Language-neutral (Gemini TTS detects the text language), so
 * there are no per-language rows. Names are case-sensitive for the API. The form
 * samples (`public/audio/voices/{female,male}.mp3`) are these two voices reading an
 * Uzbek sentence; they were generated once and are never regenerated at runtime.
 */
export const TTS_GEMINI_VOICES: Readonly<Record<TtsVoiceChoice, string>> = { female: "Kore", male: "Charon" };

/**
 * Gemini rows appended to the TABLE path of `ttsVoiceChain`. The provider stays off
 * unless `TTS_GEMINI_MODEL` is set (`configured()` = false → skipped), so while it is
 * disabled these rows change nothing. Without them Gemini entered the chain only via
 * `TTS_VOICE_<LANG>`, and compose forwards just UZ/RU/EN of those — in every other
 * language a Gemini-only deployment had no usable provider at all.
 */
export const TTS_GEMINI_SPECS: readonly TtsVoiceSpec[] = TTS_VOICE_CHOICES.map((gender) => ({
  provider: "gemini" as const,
  voice: TTS_GEMINI_VOICES[gender],
  gender,
  verified: false,
}));

/**
 * Voice name of `provider` for the chosen gender, or `null` when the provider has no
 * table row for the language (the caller then leaves the operator's list untouched).
 */
export function ttsVoiceForChoice(provider: TtsProviderId, lang: string, choice: TtsVoiceChoice): string | null {
  if (provider === "gemini") return TTS_GEMINI_VOICES[choice];
  const rows = ttsVoicesFor(lang).filter((v) => v.provider === provider);
  if (!rows.length) return null;
  return (rows.find((v) => v.gender === choice) ?? rows[0]).voice;
}

/**
 * [role A, role B] voices of one provider group.
 *
 * A = the chosen gender, B = the other gender (in a two-speaker podcast the choice
 * decides who leads). Single-voice formats only ever use A. Where a provider does not
 * distinguish genders (Aisha, one-voice languages) both roles get the same voice.
 */
export function ttsChoiceVoices(provider: TtsProviderId, lang: string, choice: TtsVoiceChoice): [string, string] | null {
  const a = ttsVoiceForChoice(provider, lang, choice);
  if (!a) return null;
  return [a, ttsVoiceForChoice(provider, lang, otherVoiceChoice(choice)) ?? a];
}

/** Til ovozlari (tartibli). Noma'lum til → `TTS_FALLBACK_LANG` ovozlari. */
export function ttsVoicesFor(lang: string): readonly TtsVoiceSpec[] {
  const key = String(lang ?? "").trim().toLowerCase();
  return TTS_LANG_VOICES[key] ?? TTS_LANG_VOICES[TTS_FALLBACK_LANG];
}

/**
 * Rol uchun ovoz: `index` 0 — birinchi ovoz (A), 1 — ikkinchi (B).
 *
 * Til uchun bitta ovoz bo'lsa ikkala rol ham SHU ovozni oladi: dialog
 * bir ovozda o'qiladi, lekin fayl baribir chiqadi. Ilgari bunday holat
 * `undefined` bo'lib, WP-A da sintez o'rtasida yiqilardi.
 */
export function ttsVoiceFor(lang: string, index = 0): TtsVoiceSpec {
  const list = ttsVoicesFor(lang);
  return list[index] ?? list[0];
}

/** Til uchun ovoz TASDIQLANGANMI (hisobot ogohlantirishi shu yerdan). */
export function ttsVerified(lang: string): boolean {
  return ttsVoicesFor(lang).some((v) => v.verified);
}

/** `provider:voice` — model va `cost_json` shu formatda saqlaydi. */
export function formatVoiceId(spec: TtsVoiceSpec): string {
  return `${spec.provider}:${spec.voice}`;
}

/** `provider:voice` ni ajratadi; noto'g'ri shakl yoki noma'lum provayder → `null`. */
export function parseVoiceId(id: string): { provider: TtsProviderId; voice: string } | null {
  const raw = String(id ?? "").trim();
  const at = raw.indexOf(":");
  if (at <= 0 || at === raw.length - 1) return null;
  const provider = raw.slice(0, at).toLowerCase();
  const voice = raw.slice(at + 1).trim();
  if (!isTtsProviderId(provider) || !voice) return null;
  return { provider, voice };
}

/* ────────────────────────── bo'laklash ────────────────────────── */

export const TTS_LIMITS = {
  /**
   * Bo'lak ≤900 belgi — eng qattiq provayder (Aisha, 1 000 belgi/so'rov)
   * ga moslangan universal chegara (`tts.md` §3). `AUDIO_LIMITS.lineCharsMax`
   * bilan AYNI son: replika o'z-o'zidan bitta bo'lakka sig'sin.
   */
  chunkChars: 900,
  /** Bitta ishdagi umumiy belgi (5 daq × ~150 so'z/daq ≈ 4 500 belgi, zaxira bilan). */
  maxChars: 12_000,
  /**
   * WP-A: bitta sintez so'rovining standart vaqt chegarasi (ms).
   *
   * 900 belgi ≈ 1 daqiqalik audio; Azure real vaqt sintezida bu ~2–4 s
   * oladi, lekin sovuq ulanish va tarmoq kechikishi bilan 30 s xavfsiz
   * shift. `TtsSynthOpts.timeoutMs` uni har chaqiruvda pasaytira oladi
   * (worker muddati tugayotganda).
   */
  callTimeoutMs: 30_000,
} as const;

/**
 * Matnni ≤`max` belgili bo'laklarga ajratadi.
 *
 * Qoidalar (WP-A dagi sintez SHU funksiyaga tayanadi):
 *   1. Avval JUMLA chegarasida (`.`, `!`, `?`, `…`) bo'linadi — pauza
 *      tabiiy joyda qolsin;
 *   2. Jumla o'zi uzun bo'lsa — SO'Z chegarasida;
 *   3. So'zning o'zi `max` dan uzun bo'lsa (URL, uzun qo'shma so'z) —
 *      qattiq kesiladi, chunki aks holda provayder butun so'rovni rad
 *      etardi.
 *
 * Kafolatlar (test): hech bir bo'lak `max` dan uzun emas va bo'sh emas;
 * bo'laklarning so'zlari ketma-ket birlashganda ASL matn so'zlarini
 * to'liq beradi (hech narsa yo'qolmaydi va takrorlanmaydi).
 */
export function chunkText(text: string, max: number = TTS_LIMITS.chunkChars): string[] {
  const limit = Math.max(1, Math.floor(max));
  const src = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!src) return [];
  if (src.length <= limit) return [src];

  // Jumlalar: tinish belgisi bo'lakda QOLADI (u talaffuzga ta'sir qiladi).
  const sentences = src.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [src];

  const out: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };

  for (const sentence of sentences) {
    for (const piece of sentence.length <= limit ? [sentence] : splitLong(sentence, limit)) {
      if (!buf) buf = piece;
      else if (buf.length + 1 + piece.length <= limit) buf = `${buf} ${piece}`;
      else {
        push();
        buf = piece;
      }
    }
  }
  push();
  return out;
}

/** Uzun jumla: so'z chegarasida, so'z ham sig'masa — qattiq kesish. */
function splitLong(sentence: string, limit: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const word of sentence.split(" ")) {
    if (word.length > limit) {
      if (buf) {
        out.push(buf);
        buf = "";
      }
      for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit));
      continue;
    }
    if (!buf) buf = word;
    else if (buf.length + 1 + word.length <= limit) buf = `${buf} ${word}`;
    else {
      out.push(buf);
      buf = word;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/* ────────────────────────── tannarx ────────────────────────── */

export type TtsUsage = {
  provider: TtsProviderId;
  voice: string;
  chars: number;
  seconds: number;
  /** Provider model id (Gemini TTS); decides the price of token-billed providers. */
  model?: string;
  /** Billing facts reported by the provider (Gemini `usageMetadata`): text-input tokens / audio-output tokens. */
  inputTokens?: number;
  outputTokens?: number;
};

export type TtsCostJson = {
  provider: string;
  voice: string;
  chars: number;
  seconds: number;
  calls: number;
  usd: number;
  /** Gemini billed tokens (reported or estimated): text-input / audio-output. 0 for per-character providers. */
  textTokens: number;
  audioTokens: number;
  /** Syntheses the price book could not price (usd 0, must not be read as a real $0). */
  unpricedCalls: number;
};

/**
 * Money of one synthesis — the ONE place `TtsMeter` and the chain's `recordTts` both
 * price from, so `cost_json.parts` and the meter can never disagree. The price table
 * itself is `TTS_PRICING` in `llm-pricing.ts` (the price book).
 */
export function ttsUsageCost(u: TtsUsage, at: Date = new Date()): TtsCost {
  return ttsCost({ provider: u.provider, chars: u.chars, seconds: u.seconds, ...(u.model !== undefined ? { model: u.model } : {}), ...(u.inputTokens !== undefined ? { inputTokens: u.inputTokens } : {}), ...(u.outputTokens !== undefined ? { outputTokens: u.outputTokens } : {}) }, at);
}

/**
 * Sintez sarfini yig'adi — `llm-roles.ts CostMeter` naqshi.
 *
 * Nega alohida hisoblagich: LLM sarfi TOKEN bilan, TTS sarfi BELGI
 * (Azure/Aisha) yoki TOKEN (Gemini audio) bilan o'lchanadi va ikkalasi
 * bitta `cost_json` ga qo'shiladi (`scripts/cost-report.mts`
 * podkast/tabriknoma marjasini shu yig'indi bo'yicha tekshiradi).
 * `usd` — `ttsUsageCost` dan (narx jadvali `llm-pricing.ts`); belgilar
 * (`chars`) faqat ko'rsatish uchun, TTS tokenlari esa LLM tokenlariga
 * QO'SHILMAYDI.
 */
export class TtsMeter {
  private calls = 0;
  private chars = 0;
  private seconds = 0;
  private usd = 0;
  private textTokens = 0;
  private audioTokens = 0;
  private unpricedCalls = 0;
  private providers = new Set<string>();
  private voices = new Set<string>();

  add(u: TtsUsage): void {
    const chars = Math.max(0, Math.round(u.chars));
    const seconds = Math.max(0, u.seconds);
    const cost = ttsUsageCost({ ...u, chars, seconds });
    this.calls += 1;
    this.chars += chars;
    this.seconds += seconds;
    this.usd += cost.usd;
    this.textTokens += cost.textTokens;
    this.audioTokens += cost.audioTokens;
    if (!cost.priced) this.unpricedCalls += 1;
    this.providers.add(u.provider);
    this.voices.add(`${u.provider}:${u.voice}`);
  }

  toJson(): TtsCostJson {
    return {
      provider: [...this.providers].join("+"),
      voice: [...this.voices].join("+"),
      chars: this.chars,
      seconds: Math.round(this.seconds),
      calls: this.calls,
      // Tiyin-darajadagi aniqlik yetarli; `cost-report` yig'indini oladi.
      usd: Number(this.usd.toFixed(6)),
      textTokens: this.textTokens,
      audioTokens: this.audioTokens,
      unpricedCalls: this.unpricedCalls,
    };
  }
}
