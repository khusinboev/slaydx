/**
 * AUDIO (AUDIT-22 R0) — podkast va tabriknomaning YAGONA modeli.
 * Izomorf: server/DOM/TTS importi YO'Q (`games/types.ts` naqshi).
 *
 * Ikki vosita bitta qobiqda (`audio/engine.ts` — WP-A), lekin ular BIR
 * XIL shaklga tushadi: chiqish MP3, ya'ni hujjatning butun mazmuni —
 * AYTILADIGAN MATN. Shuning uchun krossvord/kartadagi kabi ikkita
 * alohida model kerak emas: farq `kind` + reyestr TURI (janr) bilan
 * beriladi.
 *
 * MATN ikki marta saqlanmaydi: `script` — aytiladigan replikalar (TTS
 * kirishi VA ko'ruvchidagi transkript), `AcademicDoc.sections` esa
 * odatdagidek shu transkriptning o'qiladigan ko'rinishi bo'ladi (WP-A).
 * Ikkalasining manbasi shu model — `AudioViewer` ham, `tts/` ham
 * `doc.audio.script` ni o'qiydi («ko'rdim = oldim» ning audio varianti:
 * eshitgan matnim — ekranda turgan matn).
 *
 * Reyestr (kind → tur/guidance/JudgeSpec/qoidalar) — `registry.ts`.
 * Manba: `docs/research/{podcast,greeting}.md` §3–§4, `tts.md` §3.
 */
import type { DocReview, PolishLog, UserNeed } from "../report/types";

/* ────────────────────────── kind va vosita ────────────────────────── */

export const AUDIO_KINDS = ["podcast", "greeting"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];

export const isAudioKind = (v: unknown): v is AudioKind => (AUDIO_KINDS as readonly string[]).includes(String(v));

/**
 * Vosita id ↔ kind xaritasi — YAGONA manba (`GAME_TOOL_IDS` naqshi).
 *
 * `write-llm.ts` dispatchi, `viewerKind`, `budgetFor` va forma shu
 * jadvaldan o'qiydi; ilgari har biri o'z `if` zanjirini yozardi va yangi
 * vosita qo'shilganda ular jimgina ajralib ketardi.
 */
export const AUDIO_TOOL_IDS = {
  podcast: "podcast",
  greeting: "greeting",
} as const satisfies Record<string, AudioKind>;

export type AudioToolId = keyof typeof AUDIO_TOOL_IDS;

/** Vosita id lari — kind tartibida (podkast → tabriknoma). */
export const AUDIO_TOOL_LIST = Object.keys(AUDIO_TOOL_IDS) as AudioToolId[];

/** Teskari yo'nalish: kind → vosita id (havola, `hrefBase`, jonli sinov). */
export const AUDIO_TOOL_BY_KIND = Object.fromEntries(
  (Object.entries(AUDIO_TOOL_IDS) as [AudioToolId, AudioKind][]).map(([tool, kind]) => [kind, tool]),
) as Record<AudioKind, AudioToolId>;

export const isAudioToolId = (v: unknown): v is AudioToolId => Object.prototype.hasOwnProperty.call(AUDIO_TOOL_IDS, String(v));

/* ────────────────────────── ssenariy ────────────────────────── */

/**
 * Bitta replika.
 *
 * `speaker` — «A»/«B» kabi ROL BELGISI, ism emas: ovoz tanlash til
 * jadvalidan boradi (`TTS_LANG_VOICES`), ya'ni modelda konkret ovoz nomi
 * turmasligi kerak — aks holda kalit/provayder almashganda eski
 * hujjatlar mavjud bo'lmagan ovozga ishora qilardi. Bir ovozli janrda
 * (tabriknoma, monolog podkast) hamma replika — «A».
 */
export type AudioLine = {
  speaker: string;
  text: string;
};

export type AudioModel = {
  v: 1;
  kind: AudioKind;
  /** Reyestr TUR id (`registry.ts audioTypeOf`) — `tushuntirish`, `ustoz-kuni`, … */
  type: string;
  /** Matn/ovoz tili (18 til) — `TTS_LANG_VOICES` shu kod bo'yicha ovoz beradi. */
  language: string;
  script: AudioLine[];
  /**
   * TAYYOR audioning uzunligi (soniya) — provayder O'LCHAGAN qiymat.
   *
   * Reja (`daqiqa × 150 so'z`) emas: `delivered` aynan shu maydondan
   * hisoblanadi (WP-A), ya'ni «5 daqiqa» deb to'lagan foydalanuvchi
   * 3 daqiqalik fayl olsa farq qaytariladi. Sintez qilinmaguncha
   * (R0 da doim) — `undefined`.
   */
  seconds?: number;
  /** Ishlatilgan ovoz: `provider:voice` (`TtsVoiceSpec` formati). */
  voice?: string;
  /** Ikki ovozli podkastda ikkinchi rol ovozi. */
  voiceB?: string;
  review?: DocReview;
  polish?: PolishLog;
  /** «Sizdan kutiladi» — AI o'ylab topmaydigan ma'lumot (hisobot paneli). */
  userNeeds?: UserNeed[];
};

/* ────────────────────────── chegaralar ────────────────────────── */

/**
 * Butun oila uchun QATTIQ chegaralar (kirish kesish, so'z byudjeti,
 * hisobot qoidalari). Tur bo'yicha nozik chegaralar — REYESTRDA.
 *
 * Raqamlar `docs/research/{podcast,greeting}.md` §3 va `tts.md` §3 dan;
 * ular bu yerda QULFLANADI (`tests/audio-registry.test.mts`).
 */
export const AUDIO_LIMITS = {
  /* ── davomiylik (daqiqa) ── */
  /** Podkast: 1–5 daqiqa (`podcast.md` §3 `duration` chiplari). */
  podcastMinutes: [1, 2, 3, 4, 5] as readonly number[],
  podcastMinutesDefault: 2,
  /** Tabriknoma: 1–4 daqiqa (`greeting.md` §3). */
  greetingMinutes: [1, 2, 3, 4] as readonly number[],
  greetingMinutesDefault: 1,

  /* ── so'z byudjeti ── */
  /**
   * 150 so'z/daqiqa — ishchi qiymat (`podcast.md` §3: ingliz konvensiyasi
   * 120–160, o'zbekcha o'lchov manbasi yo'q). Ssenariy uzunligi SHU bilan
   * o'lchanadi, TTS ning haqiqiy tezligi esa `AudioModel.seconds` ga
   * yoziladi — ikkalasi ATAYLAB ajratilgan.
   */
  wordsPerMinute: 150,
  /** Hisobot qoidasi (`durationWords`) toleransi — ±15 %. */
  wordsTolerance: 0.15,

  /* ── replikalar ── */
  /**
   * Bitta replika ≤900 belgi — TTS bo'lagi bilan BIR XIL chegara
   * (`tts.md` §3: eng qattiq provayder Aisha 1 000 belgi). Shunda replika
   * hech qachon o'rtasidan ikki so'rovga bo'linmaydi va pauza tabiiy
   * joyda qoladi.
   */
  lineCharsMax: 900,
  lineCharsMin: 10,
  /** Replikalar soni: 1 daqiqalik monologda ham kamida shuncha. */
  linesMin: 3,
  linesMax: 80,
  /** Ovoz soni: monolog yoki dialog (`podcast.md` §3 `speakerCount`). */
  speakers: [1, 2] as readonly number[],
  speakersDefault: 2,

  /* ── kirish ── */
  topicChars: 300,
  extraChars: 1500,
  sourceTextChars: 24_000,
  /** Tabriknoma: kimga (majburiy), munosabat, sabab (`greeting.md` §3). */
  recipientChars: 80,
  relationChars: 60,
  occasionChars: 60,
} as const;

/** Kindning daqiqa chiplari — forma ham, byudjet ham shu ro'yxatdan. */
export function audioMinuteOptions(kind: AudioKind): readonly number[] {
  return kind === "podcast" ? AUDIO_LIMITS.podcastMinutes : AUDIO_LIMITS.greetingMinutes;
}

/** Ruxsat etilgan daqiqa; noma'lum qiymat → kindning standarti. */
export function normalizeAudioMinutes(kind: AudioKind, v: unknown): number {
  const list = audioMinuteOptions(kind);
  const n = Number(v);
  if (list.includes(n)) return n;
  return kind === "podcast" ? AUDIO_LIMITS.podcastMinutesDefault : AUDIO_LIMITS.greetingMinutesDefault;
}

/** Ssenariy uchun so'z byudjeti (`daqiqa × 150`) — prompt va hisobot bitta qoidadan. */
export function audioWordBudget(minutes: number): number {
  const m = Math.max(1, Math.round(Number.isFinite(minutes) ? minutes : 1));
  return m * AUDIO_LIMITS.wordsPerMinute;
}

/** Ssenariydagi so'zlar soni (hisobot qoidasi `durationWords` shu yerdan). */
export function scriptWords(script: readonly AudioLine[]): number {
  let n = 0;
  for (const line of script) {
    n += String(line?.text ?? "").trim().split(/\s+/).filter(Boolean).length;
  }
  return n;
}

/** Ssenariyning TAXMINIY uzunligi (soniya) — sintezdan oldingi baho. */
export function scriptSeconds(script: readonly AudioLine[]): number {
  return Math.round((scriptWords(script) / AUDIO_LIMITS.wordsPerMinute) * 60);
}

/** Ovoz soni: 1 (monolog) yoki 2 (dialog); noma'lum qiymat → standart. */
export function normalizeSpeakerCount(v: unknown): number {
  const n = Number(v);
  return AUDIO_LIMITS.speakers.includes(n) ? n : AUDIO_LIMITS.speakersDefault;
}
