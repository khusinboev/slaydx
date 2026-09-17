/**
 * AUDIO KIRISHI (AUDIT-22 WP-A) — formadan dvigatelgacha.
 *
 * `infographic/input.ts` naqshi: `FormValues` bilan `AudioInput`
 * orasidagi YAGONA ko'prik, ikki tomonga ishlaydi —
 *   • `audioInputFromValues(kind, meta, values)` — server (dvigatel, zond);
 *   • `encodeAudioValues(input)`                 — klient (qoralama, forma).
 *
 * DIAPAZON QAYTA TEKSHIRILADI: forma nima yuborishidan qat'i nazar tur
 * (janr), daqiqa va rejim shu yerda reyestr/chegara qiymatlariga
 * siqiladi. Mijoz tomonida tekshirilgan qiymat server uchun DALIL emas.
 *
 * Ikki vosita bitta shaklga tushadi (`AudioModel` izohi): farq
 * MAYDONLARDA — podkastda `mode`/`sourceText`, tabriknomada
 * `recipient`/`relation`. Ular birgalikda `AudioInput` da turadi va
 * kerak bo'lmagani bo'sh qoladi; ikkita alohida tip qilish promptlar,
 * hisobot va zondni ham ikkiga bo'lardi.
 *
 * Server importi YO'Q (izomorf: forma ham chaqiradi).
 */
import type { FormValues } from "../../types";
import type { DocMeta } from "../types";
import { AUDIO_LIMITS, audioWordBudget, normalizeAudioMinutes, type AudioKind, type AudioLine } from "./types";
import { audioTypeOf, type AudioTypeSpec, type GreetingTypeSpec } from "./registry";

/* ══════════════════════════ rejim ══════════════════════════ */

export const AUDIO_MODES = ["topic", "text", "file"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];

/** Noma'lum rejim → `topic` (`lib/tools.ts` `modes` ro'yxatining birinchisi). */
export function normalizeAudioMode(v: unknown): AudioMode {
  const s = String(v ?? "").trim().toLowerCase();
  return (AUDIO_MODES as readonly string[]).includes(s) ? (s as AudioMode) : "topic";
}

/* ══════════════════════════ kirish ══════════════════════════ */

export type AudioInput = {
  kind: AudioKind;
  /** Reyestr TUR id (podkast turi yoki tabriknoma janri). */
  type: string;
  /** Chiqish tili (18 til kodi) — TTS ovozi ham shundan. */
  language: string;
  /** Davomiylik (daqiqa) — VA'DA; `delivered` shu bilan solishtiriladi. */
  minutes: number;
  /** Ssenariy so'z byudjeti (`daqiqa × 150`) — prompt va hisobot bitta qoidadan. */
  wordBudget: number;
  /** Ovoz soni: reyestr TURIDAN (formada tanlanmaydi). */
  speakers: number;

  /* ── podkast ── */
  mode: AudioMode;
  topic: string;
  /** «Matn asosida» rejimida forma matni, «fayl» rejimida ekstraksiya natijasi. */
  sourceText: string;

  /* ── tabriknoma ── */
  recipient: string;
  relation: string;
  /** Janrning TAYYOR iborasi (`umumiy` turda bo'sh — sabab foydalanuvchi so'zida). */
  occasion: string;

  /** Qo'shimcha ko'rsatma (ikkala vositada ham). */
  extra: string;
};

const str = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function audioInputFromValues(kind: AudioKind, meta: DocMeta, values: FormValues): AudioInput {
  const type = audioTypeOf(kind, kind === "greeting" ? values.occasion : values.podcastType);
  const minutes = normalizeAudioMinutes(kind, values.durationMin);
  /*
   * `mode` faqat podkastda ma'noli. Tabriknomada u DOIM `topic`:
   * u yerda manba matn/fayl umuman yo'q va forma ham uni ko'rsatmaydi.
   */
  const mode = kind === "podcast" ? normalizeAudioMode(values.mode) : "topic";

  return {
    kind,
    type: type.id,
    language: String(values.language ?? meta.language ?? "uz").toLowerCase(),
    minutes,
    wordBudget: audioWordBudget(minutes),
    speakers: type.speakers,
    mode,
    topic: str(values.topic ?? meta.topic, AUDIO_LIMITS.topicChars),
    /*
     * Manba matn faqat `text`/`file` rejimida o'qiladi. `topic`
     * rejimida uni olish — foydalanuvchi rejimni almashtirib, eski
     * matnni formada qoldirgan holatda uni JIMGINA ishlatish bo'lardi.
     */
    sourceText: mode === "topic" ? "" : str(values.sourceText ?? meta.sourceText, AUDIO_LIMITS.sourceTextChars),
    recipient: kind === "greeting" ? str(values.recipient, AUDIO_LIMITS.recipientChars) : "",
    relation: kind === "greeting" ? str(values.relation, AUDIO_LIMITS.relationChars) : "",
    occasion: kind === "greeting" ? (type as GreetingTypeSpec).occasion : "",
    extra: str(values.extra ?? meta.extra, AUDIO_LIMITS.extraChars),
  };
}

/** Qoralama/forma uchun teskari yo'nalish (`infographic/input.ts` naqshi). */
export function encodeAudioValues(input: AudioInput): FormValues {
  const common = { durationMin: input.minutes, language: input.language, extra: input.extra };
  return input.kind === "podcast"
    ? { ...common, mode: input.mode, topic: input.topic, sourceText: input.sourceText, podcastType: input.type }
    : { ...common, recipient: input.recipient, relation: input.relation, occasion: input.type };
}

/**
 * Foydalanuvchi BERGAN matn — halollik tekshiruvining yagona manbasi
 * (`noFakeStats` qoidasi va promptdagi taqiq shundan o'qiydi).
 *
 * Mavzu ham kiradi: «Orol dengizi 1960 yildan beri…» mavzuning O'ZIDA
 * yozilgan raqam ham foydalanuvchi bergan raqam.
 */
export function audioUserFacts(input: Pick<AudioInput, "topic" | "extra" | "sourceText" | "recipient" | "relation">): string {
  return [input.topic, input.recipient, input.relation, input.extra, input.sourceText].filter(Boolean).join("\n");
}

/** Ssenariyning nomi — fayl nomi va hujjat sarlavhasi (`<mavzu>.mp3`). */
export function audioTitleOf(input: AudioInput): string {
  if (input.kind === "greeting") {
    const who = input.recipient.trim();
    const why = input.occasion.trim();
    return [who, why].filter(Boolean).join(" — ") || "Tabriknoma";
  }
  return input.topic.trim() || "Podkast";
}

/* ══════════════════════════ model javobi → ssenariy ══════════════════════════ */

/** Rol belgilari — model nima yozishidan qat'i nazar «A»/«B» ga tushadi. */
export const SPEAKER_IDS = ["A", "B"] as const;

/**
 * Model qaytargan rolni «A»/«B» ga normallashtiradi.
 *
 * Model «Host»/«Boshlovchi»/«1»/«Speaker A» kabi har xil yozadi. Rol
 * MODELDA emas, jadvalda (`TTS_LANG_VOICES`) ovozga bog'lanadi, ya'ni
 * ikkitadan ortiq rol bo'lishi MUMKIN EMAS — uchinchi rol ovozsiz
 * qolardi. Noma'lum belgi — birinchi ko'ringan rolga.
 */
export function normalizeSpeaker(raw: unknown, seen: Map<string, string>, speakers: number): string {
  const key = String(raw ?? "").trim().toLowerCase() || "a";
  const known = seen.get(key);
  if (known) return known;
  if (speakers < 2 || seen.size >= 2) {
    const first = seen.values().next().value ?? "A";
    seen.set(key, first);
    return first;
  }
  const id = SPEAKER_IDS[seen.size];
  seen.set(key, id);
  return id;
}

/**
 * LLM javobi → `AudioLine[]`. Javob QISMAN/BUZUQ bo'lishi mumkin degan
 * qoidadan (CLAUDE.md) kelib chiqadi.
 *
 * Kafolatlar:
 *   • har replika ≤`lineCharsMax` (900) — TTS bo'lagi bilan AYNI
 *     chegara, ya'ni replika hech qachon ikki so'rovga bo'linmaydi;
 *     UZUN replika kesilmaydi, JUMLA chegarasida BO'LINADI (matn
 *     yo'qolmasin) va bo'laklar bir xil rolda qoladi;
 *   • rollar faqat «A»/«B»; monolog janrda hammasi «A»;
 *   • bo'sh/juda qisqa replika tashlanadi;
 *   • jami `linesMax` (80) dan oshmaydi.
 */
export function normalizeScript(raw: Record<string, unknown> | null, input: AudioInput): AudioLine[] | null {
  if (!raw) return null;
  const arr = Array.isArray(raw.script) ? raw.script : Array.isArray(raw.lines) ? (raw.lines as unknown[]) : [];
  const seen = new Map<string, string>();
  const out: AudioLine[] = [];

  for (const item of arr) {
    if (out.length >= AUDIO_LIMITS.linesMax) break;
    const o = (item ?? {}) as Record<string, unknown>;
    const text = typeof item === "string" ? item.trim() : String(o.text ?? o.line ?? "").replace(/\s+/g, " ").trim();
    if (text.length < AUDIO_LIMITS.lineCharsMin) continue;
    const speaker = normalizeSpeaker(typeof item === "string" ? "a" : (o.speaker ?? o.role), seen, input.speakers);
    for (const piece of splitLine(text, AUDIO_LIMITS.lineCharsMax)) {
      if (out.length >= AUDIO_LIMITS.linesMax) break;
      out.push({ speaker, text: piece });
    }
  }
  return out.length ? out : null;
}

/** Uzun replikani JUMLA chegarasida bo'ladi (kesmaydi). */
export function splitLine(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const piece = s.length <= max ? s : s.slice(0, max);
    if (!buf) buf = piece;
    else if (buf.length + 1 + piece.length <= max) buf = `${buf} ${piece}`;
    else {
      out.push(buf);
      buf = piece;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Tur spetsifikatsiyasi — chaqiruvchilar reyestrni qayta izlamasin. */
export function audioSpecOf(input: AudioInput): AudioTypeSpec {
  return audioTypeOf(input.kind, input.type);
}
