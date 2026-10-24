import "server-only";
import { chainOfProvider } from "../generation/tts/chain";
import { geminiTts } from "../generation/tts/gemini";
import { wavToMp3 } from "../generation/tts/mp3";
import { TTS_GEMINI_VOICES } from "../generation/tts/types";
import { parseLlmJson } from "../generation/json";
import { llmModel } from "../generation/llm";
import { complete } from "../generation/llm-roles";
import { recordLlmUsage } from "../generation/job-cost";
import { QUESTIONS_SYSTEM, SCORE_SCHEMA, SCORE_SYSTEM, questionsUser, scoreUser } from "../domla/prompts";
import { DOMLA_VOICE_MAX_BYTES, parseQuestions, parseScore, type DomlaQuestion, type ScoreResult } from "../domla/rules";
import { env } from "./env";
import { getProviderKey } from "./providers/resolve";
import { callBot, isTransientBotFailure, sendMessage, TelegramTransientError } from "./telegram";

/**
 * The network edges of «Qattiqqo'l domla» (owner request 15) behind one interface, so `domla-engine.ts` is tested
 * with stubs: the question-writing LLM, Gemini TTS (voice Charon -> MP3), the ONE Gemini call that transcribes AND
 * scores an answer, and the Telegram calls (send text / audio, download a voice message).
 */

export class DomlaFileError extends Error {
  constructor(readonly reason: "too_big" | "unsupported" | "download", message: string) {
    super(message);
    this.name = "DomlaFileError";
  }
}

export type DomlaAudio = { bytes: Uint8Array; mime: string };
export type SpokenAudio = { bytes: Uint8Array; seconds: number };

export type ScoreInput = { question: DomlaQuestion; topic: string; deck: string; audio?: DomlaAudio; text?: string };

export type DomlaDeps = {
  now(): Date;
  generateQuestions(input: { topic: string; deck: string }): Promise<DomlaQuestion[]>;
  /** Spoken question as MP3, or `null` when no voice is available (the caption then carries the question). */
  synthesize(text: string): Promise<SpokenAudio | null>;
  score(input: ScoreInput): Promise<ScoreResult>;
  telegram: {
    sendText(chatId: string, text: string, markup?: unknown): Promise<boolean>;
    sendAudio(chatId: string, audio: SpokenAudio, caption: string): Promise<boolean>;
    sendAction(chatId: string, action: "typing" | "record_voice"): Promise<void>;
    /** getFile + download, at most `DOMLA_VOICE_MAX_BYTES`. Throws `DomlaFileError`. */
    downloadFile(fileId: string): Promise<Uint8Array>;
  };
};

/* ───────────────────────── LLM ───────────────────────── */

async function generateQuestions(input: { topic: string; deck: string }): Promise<DomlaQuestion[]> {
  const res = await complete("writer", QUESTIONS_SYSTEM, questionsUser(input.topic, input.deck), { json: true, maxTokens: 3000, timeoutMs: 60_000 });
  if (!res) throw new Error("AI savollar tuzmadi");
  const qs = parseQuestions(parseLlmJson(res.text));
  if (!qs) throw new Error("AI savollari yaroqsiz (5 ta to‘liq savol emas)");
  return qs;
}

/* ───────────────────────── TTS ───────────────────────── */

/** Gemini voice for the examiner: the male voice (Charon). Output WAV -> MP3 (no ffmpeg in the image; lamejs does it). */
async function synthesize(text: string): Promise<SpokenAudio | null> {
  const chain = chainOfProvider(geminiTts, [TTS_GEMINI_VOICES.male]);
  if (!chain.configured()) return null;
  const run = await chain.synthesizeAll([{ text }], { lang: "uz", timeoutMs: 60_000, deadline: Date.now() + 90_000 });
  const audio = run.audios[0];
  if (!audio) return null;
  const mp3 = audio.mp3 ?? (audio.wav ? await wavToMp3(audio.wav) : null);
  return mp3 && mp3.byteLength ? { bytes: mp3, seconds: audio.seconds } : null;
}

/* ───────────────────────── scoring (one Gemini call: audio in, JSON out) ───────────────────────── */

const SCORE_TIMEOUT_MS = 60_000;

/** Telegram voice = OGG/Opus; the other audio types Gemini takes are passed through, anything else is refused. */
export function geminiAudioMime(mime: string | undefined): string | null {
  const m = String(mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (m === "audio/ogg" || m === "audio/opus") return "audio/ogg";
  if (m === "audio/mpeg" || m === "audio/mp3") return "audio/mp3";
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave") return "audio/wav";
  if (m === "audio/flac") return "audio/flac";
  if (m === "audio/aac" || m === "audio/mp4" || m === "audio/x-m4a" || m === "audio/m4a") return "audio/aac";
  return null;
}

type GeminiScoreResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

/** Transcribe + score in ONE call. The audio is sent inline and dropped with this function's scope. */
export async function scoreWithGemini(input: ScoreInput, fetchImpl: typeof fetch = fetch): Promise<ScoreResult> {
  const key = getProviderKey("gemini");
  if (!key) throw new Error("GEMINI_API_KEY yo‘q");
  const model = llmModel();
  const parts: Record<string, unknown>[] = [{ text: scoreUser(input.question, input.topic, input.deck, input.audio ? undefined : (input.text ?? "")) }];
  if (input.audio) parts.push({ inlineData: { mimeType: input.audio.mime, data: Buffer.from(input.audio.bytes).toString("base64") } });
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(SCORE_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SCORE_SYSTEM }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
        responseMimeType: "application/json",
        responseSchema: SCORE_SCHEMA,
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as GeminiScoreResponse;
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message ?? "xato"}`.slice(0, 300));
  const u = data.usageMetadata;
  if (u) recordLlmUsage({ provider: "gemini", model, inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 });
  const text = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => p.thought !== true).map((p) => p.text ?? "").join("");
  const score = parseScore(parseLlmJson(text));
  if (!score) throw new Error("Gemini bahosi o‘qilmadi");
  return score;
}

/* ───────────────────────── Telegram ───────────────────────── */

async function sendText(chatId: string, text: string, markup?: unknown): Promise<boolean> {
  return sendMessage(chatId, text, markup ? { reply_markup: markup } : {});
}

async function sendAudio(chatId: string, audio: SpokenAudio, caption: string): Promise<boolean> {
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  form.set("title", "Qattiqqo‘l domla");
  form.set("performer", "Domla");
  form.set("duration", String(Math.max(1, Math.round(audio.seconds))));
  form.set("audio", new Blob([new Uint8Array(audio.bytes)], { type: "audio/mpeg" }), "domla.mp3");
  const r = await callBot("sendAudio", form, { multipart: true });
  if (r.ok) return true;
  if (isTransientBotFailure(r)) throw new TelegramTransientError(`sendAudio: ${r.code ? `${r.code} ` : ""}${r.description}`.trim());
  return false;
}

async function sendAction(chatId: string, action: "typing" | "record_voice"): Promise<void> {
  await callBot("sendChatAction", { chat_id: chatId, action }).catch(() => undefined);
}

/** Reads a response body, aborting as soon as it is over `max` bytes. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new DomlaFileError("too_big", "fayl juda katta");
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > max) throw new DomlaFileError("too_big", "fayl juda katta");
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new DomlaFileError("too_big", "fayl juda katta");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

async function downloadFile(fileId: string): Promise<Uint8Array> {
  const info = await callBot<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!info.ok) {
    if (isTransientBotFailure(info)) throw new TelegramTransientError(`getFile: ${info.description}`);
    throw new DomlaFileError("download", info.description || "getFile");
  }
  const path = info.result?.file_path;
  if (!path) throw new DomlaFileError("download", "file_path yo‘q");
  if ((info.result?.file_size ?? 0) > DOMLA_VOICE_MAX_BYTES) throw new DomlaFileError("too_big", "fayl juda katta");
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/file/bot${env.telegramBotToken}/${path}`, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new TelegramTransientError(`file download: ${e instanceof Error ? e.message : "tarmoq xatosi"}`);
  }
  if (!res.ok) throw new DomlaFileError("download", `HTTP ${res.status}`);
  return readCapped(res, DOMLA_VOICE_MAX_BYTES);
}

export function defaultDeps(): DomlaDeps {
  return {
    now: () => new Date(),
    generateQuestions,
    synthesize,
    score: (input) => scoreWithGemini(input),
    telegram: { sendText, sendAudio, sendAction, downloadFile },
  };
}
