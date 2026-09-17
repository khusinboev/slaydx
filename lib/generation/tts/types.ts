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
  /** Hisoblangan belgilar (tannarx shu bilan o'lchanadi). */
  chars: number;
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

export type TtsPrice = {
  /** 1 million belgi uchun USD (`tts.md` §2 narx jadvali). */
  usdPerMillionChars: number;
  note: string;
};

/**
 * Provayder narxlari — `cost_json` shu jadvaldan hisoblanadi.
 *
 * Aisha so'mda hisoblaydi (1 so'm/belgi): 1 M belgi = 1 000 000 so'm ≈
 * $80 (12 500 so'm/$ ishchi kursi). Kurs o'zgarganda SHU yer
 * yangilanadi — narx hisobi bitta joydan boshqarilsin.
 */
export const TTS_PRICES: Record<TtsProviderId, TtsPrice> = {
  azure: { usdPerMillionChars: 16, note: "Azure Neural TTS — $16/1M belgi" },
  aisha: { usdPerMillionChars: 80, note: "Aisha AI — 1 so'm/belgi ≈ $80/1M (12 500 so'm/$)" },
  gemini: { usdPerMillionChars: 0, note: "Gemini TTS — bepul sinov kvotasi (sifat noma'lum)" },
  google: { usdPerMillionChars: 16, note: "Google Cloud TTS Neural2 — $16/1M belgi" },
  elevenlabs: { usdPerMillionChars: 165, note: "ElevenLabs Creator — ≈$165/1M belgi" },
};

export type TtsUsage = {
  provider: TtsProviderId;
  voice: string;
  chars: number;
  seconds: number;
};

export type TtsCostJson = {
  provider: string;
  voice: string;
  chars: number;
  seconds: number;
  calls: number;
  usd: number;
};

/**
 * Sintez sarfini yig'adi — `llm-roles.ts CostMeter` naqshi.
 *
 * Nega alohida hisoblagich: LLM sarfi TOKEN bilan, TTS sarfi BELGI
 * bilan o'lchanadi va ikkalasi bitta `cost_json` ga qo'shiladi
 * (`scripts/cost-report.mts` podkast/tabriknoma marjasini shu yig'indi
 * bo'yicha tekshiradi). Bitta hisoblagichga tiqilsa, «token» ustuni
 * belgilar bilan aralashib, marja hisobi yolg'on chiqardi.
 */
export class TtsMeter {
  private calls = 0;
  private chars = 0;
  private seconds = 0;
  private usd = 0;
  private providers = new Set<string>();
  private voices = new Set<string>();

  add(u: TtsUsage): void {
    const chars = Math.max(0, Math.round(u.chars));
    const seconds = Math.max(0, u.seconds);
    this.calls += 1;
    this.chars += chars;
    this.seconds += seconds;
    this.usd += (TTS_PRICES[u.provider]?.usdPerMillionChars ?? 0) * (chars / 1_000_000);
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
    };
  }
}

/** Bitta chaqiruv tannarxi (USD) — zond va byudjet hisobi uchun. */
export function ttsCostUsd(provider: TtsProviderId, chars: number): number {
  const price = TTS_PRICES[provider]?.usdPerMillionChars ?? 0;
  return Number((price * (Math.max(0, chars) / 1_000_000)).toFixed(6));
}
