/**
 * SSENARIY → AYTILADIGAN BO'LAKLAR (AUDIT-22 WP-A).
 *
 * «Ko'rdim = oldim» ning audio varianti shu faylda amalga oshadi:
 * ekranda ko'rinadigan transkript (`AudioViewer` → `doc.audio.script`)
 * va TTS ga ketadigan matn BITTA manbadan chiqadi. Ikkinchi «aytish
 * matni» yozilsa, eshitilgan gap ekrandagidan farq qilardi.
 *
 * Uchta ish:
 *   1. ROL → OVOZ. Model «A»/«B» rol belgisini yozadi (`input.ts`
 *      `normalizeSpeaker`), ovoz esa til jadvalidan keladi — shu yerda
 *      rol INDEKSGA (0/1) aylanadi va zanjir shu indeks bo'yicha
 *      guruhning birinchi yoki ikkinchi ovozini oladi.
 *   2. BO'LAKLASH. Replika ≤900 belgi (`AUDIO_LIMITS.lineCharsMax` =
 *      `TTS_LIMITS.chunkChars`), ya'ni odatda bitta replika = bitta
 *      so'rov. `chunkText` baribir chaqiriladi: eski hujjat yoki
 *      qo'lda tahrir qilingan transkript uzunroq bo'lishi mumkin.
 *   3. PAUZALAR. Replikadan keyin qisqa, BLOK chegarasida uzunroq
 *      (`podcast.md` §3). Pauza faqat Azure da eshitiladi (`<break>`),
 *      qolgan provayderlar uni e'tiborsiz qoldiradi — shuning uchun u
 *      MATNGA emas, opsiyaga yoziladi.
 *
 * Izomorf: server/DOM importi yo'q.
 */
import { chunkText, TTS_LIMITS } from "../tts/types";
import type { TtsPart } from "../tts/chain";
import { AUDIO_LIMITS, scriptWords, type AudioLine } from "./types";

/* ══════════════════════════ pauzalar ══════════════════════════ */

export const AUDIO_PAUSES = {
  /** Replikalar orasida (`podcast.md` §3: «qisqa pauza»). */
  lineMs: 350,
  /**
   * ROL ALMASHGANDA — biroz uzunroq: dialogda javob berayotgan odam
   * darhol gapirmaydi, va bu farq suhbatni «ikki monolog» bo'lishdan
   * saqlaydi (`podcast.md` §4 `conversationalFlow`).
   */
  turnMs: 500,
  /** Bitta replika ichidagi bo'laklar orasida — pauza QO'SHILMAYDI. */
  innerMs: 0,
  /** Ssenariyning OXIRGI bo'lagi: pauza keraksiz (fayl shundoq tugaydi). */
  endMs: 0,
} as const;

/* ══════════════════════════ rollar ══════════════════════════ */

/** Ssenariydagi rollar — KO'RINISH tartibida (birinchisi rol A). */
export function speakerOrder(script: readonly AudioLine[]): string[] {
  const out: string[] = [];
  for (const line of script) {
    const s = String(line?.speaker ?? "A");
    if (!out.includes(s)) out.push(s);
  }
  return out.length ? out : ["A"];
}

/** Rol → ovoz indeksi (0 yoki 1). Uchinchi rol bo'lsa u ham 1 ga tushadi. */
export function voiceIndexOf(speaker: string, order: readonly string[]): number {
  const at = order.indexOf(String(speaker ?? "A"));
  return at <= 0 ? 0 : 1;
}

/**
 * Har rolning SO'Z ulushi — hisobotdagi `speakerBalance` va prompt
 * qayta so'rovi shu hisobdan o'qiydi.
 *
 * Nega so'z, replika emas: ikki ovozli suhbatda A ko'p marta qisqa
 * savol berib, B uzun javob berishi MUMKIN va bu NORMAL. Nomutanosiblik
 * aslida «bittasi deyarli gapirmaydi» degani, uni esa faqat so'z
 * o'lchaydi.
 */
export function speakerShares(script: readonly AudioLine[]): Record<string, number> {
  const words = new Map<string, number>();
  let total = 0;
  for (const line of script) {
    const n = String(line?.text ?? "").trim().split(/\s+/).filter(Boolean).length;
    const s = String(line?.speaker ?? "A");
    words.set(s, (words.get(s) ?? 0) + n);
    total += n;
  }
  const out: Record<string, number> = {};
  for (const [s, n] of words) out[s] = total ? n / total : 0;
  return out;
}

/* ══════════════════════════ so'z byudjeti ══════════════════════════ */

/** Byudjet oralig'i (±15 %) — prompt ham, hisobot ham AYNI sondan. */
export function wordRange(budget: number): { min: number; max: number } {
  const t = AUDIO_LIMITS.wordsTolerance;
  return { min: Math.round(budget * (1 - t)), max: Math.round(budget * (1 + t)) };
}

/** Ssenariy byudjetga tushdimi (`durationWords` qoidasi). */
export function withinBudget(script: readonly AudioLine[], budget: number): boolean {
  const { min, max } = wordRange(budget);
  const n = scriptWords(script);
  return n >= min && n <= max;
}

/* ══════════════════════════ aytiladigan bo'laklar ══════════════════════════ */

export type SpeechPart = TtsPart & {
  /** Qaysi replikadan (`script` indeksi) — jurnal va hisobot uchun. */
  line: number;
  speaker: string;
};

/**
 * Ssenariy → TTS bo'laklari.
 *
 * Replika ≤`chunkChars` bo'lsa bitta bo'lak bo'ladi (odatdagi holat).
 * Uzunroq bo'lsa `chunkText` jumla chegarasida bo'ladi va bo'laklar
 * ORASIDA pauza QO'YILMAYDI: bitta gapning o'rtasidagi pauza tinglovchi
 * uchun nuqson bo'lib eshitiladi.
 */
export function speechParts(script: readonly AudioLine[], opts: { max?: number } = {}): SpeechPart[] {
  const max = opts.max ?? TTS_LIMITS.chunkChars;
  const order = speakerOrder(script);
  const out: SpeechPart[] = [];

  script.forEach((line, i) => {
    const text = String(line?.text ?? "").trim();
    if (!text) return;
    const voice = voiceIndexOf(line.speaker, order);
    const next = script[i + 1];
    const last = i === script.length - 1;
    // Rol almashsa uzunroq pauza; oxirida pauza umuman yo'q.
    const after = last ? AUDIO_PAUSES.endMs : next && next.speaker !== line.speaker ? AUDIO_PAUSES.turnMs : AUDIO_PAUSES.lineMs;
    const pieces = chunkText(text, max);
    pieces.forEach((piece, k) => {
      out.push({ text: piece, voice, line: i, speaker: String(line.speaker ?? "A"), pauseMs: k === pieces.length - 1 ? after : AUDIO_PAUSES.innerMs });
    });
  });

  return out;
}

/** Transkript matni — hisobot, baholovchi va hujjat bo'limi uchun. */
export function scriptText(script: readonly AudioLine[]): string {
  return script.map((l) => `${l.speaker}: ${l.text}`).join("\n");
}

/** Faqat aytiladigan matn (rol belgilarisiz) — `noWrittenOnly` va takror tekshiruvi. */
export function spokenText(script: readonly AudioLine[]): string {
  return script.map((l) => String(l?.text ?? "")).join(" ");
}

/** Jami belgilar — TTS narxi va `TTS_LIMITS.maxChars` darvozasi. */
export function scriptChars(script: readonly AudioLine[]): number {
  return script.reduce((n, l) => n + String(l?.text ?? "").trim().length, 0);
}
