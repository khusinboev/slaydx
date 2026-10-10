/**
 * GEMINI TTS adapteri (AUDIT-22 WP-A) — zanjirning UCHINCHI, IXTIYORIY
 * bo'g'ini.
 *
 * Nega zanjirda (`tts.md` §3): `GEMINI_API_KEY` allaqachon bor, ya'ni
 * qo'shimcha kalit sotib olmasdan sinash mumkin. Nega ODATDA
 * O'CHIRILGAN: model PREVIEW bosqichida (SLA yo'q, narx/chegara
 * o'zgarishi mumkin — `tts.md` X-4) va o'zbek tili rasmiy til
 * ro'yxatida YO'Q, ya'ni sifat noma'lum.
 *
 * Shuning uchun `configured()` `GEMINI_API_KEY` ga EMAS, aniq
 * `TTS_GEMINI_MODEL` o'zgaruvchisiga bog'langan: operator preview
 * modelni ATAYLAB yoqishi kerak. Aks holda har o'zbek podkasti
 * Azure/Aisha yiqilganda jimgina sinovdan o'tmagan preview modelga
 * tushib qolardi.
 *
 * Javob: `inlineData.data` — base64 XOM PCM (`audio/L16;codec=pcm;
 * rate=24000`), ya'ni sarlavhasiz. `mp3.ts pcmToWav` uni WAV ga
 * o'raydi (chastota AYNAN `mimeType` dan olinadi), keyin umumiy
 * WAV → MP3 yo'li ishlaydi.
 */
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsPaceCtx, type TtsProvider, type TtsSynthOpts } from "./types";
import { pcmToWav, wavSeconds } from "./mp3";
import { DIALOG_LABELS, renderDialog } from "./pack";
import { geminiPacer } from "./pace";

/* ══════════════════════════ sozlama ══════════════════════════ */

export const geminiKey = (): string => process.env.GEMINI_API_KEY?.trim() || "";

/** Bo'sh — provayder O'CHIQ (fayl boshidagi izoh). Masalan `gemini-2.5-flash-preview-tts`. */
export const geminiTtsModel = (): string => process.env.TTS_GEMINI_MODEL?.trim() || "";

export const GEMINI_TTS_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Voice used when no voice is passed. The per-gender voices live in `TTS_GEMINI_VOICES` (`types.ts`). */
export const GEMINI_DEFAULT_VOICE = "Kore";

/** `audio/L16;codec=pcm;rate=24000` → 24000; topilmasa Gemini standarti. */
export function pcmRateOf(mimeType: string | undefined): number {
  const m = /rate=(\d{4,6})/i.exec(String(mimeType ?? ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24_000;
}

type GeminiPart = { inlineData?: { data?: string; mimeType?: string } };
type GeminiTokenDetail = { modality?: string; tokenCount?: number };
type GeminiUsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  candidatesTokensDetails?: GeminiTokenDetail[];
};
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: GeminiUsageMetadata;
  error?: { message?: string };
};

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * Billing facts of one response: `promptTokenCount` = text-input tokens,
 * audio-output tokens = the AUDIO entries of `candidatesTokensDetails` when the API
 * itemises them, else `candidatesTokenCount` (a TTS response only produces audio).
 * A field the API did not report is left out, so the price book can tell
 * «reported» from «estimate it from the audio length».
 */
export function geminiTtsUsage(json: unknown): { inputTokens?: number; outputTokens?: number } {
  const u = (json as GeminiResponse)?.usageMetadata;
  if (!u || typeof u !== "object") return {};
  const details = Array.isArray(u.candidatesTokensDetails) ? u.candidatesTokensDetails : [];
  const audio = details.filter((d) => String(d?.modality ?? "").toUpperCase() === "AUDIO").reduce((a, d) => a + count(d.tokenCount), 0);
  const input = count(u.promptTokenCount);
  const output = audio || count(u.candidatesTokenCount);
  return { ...(input ? { inputTokens: input } : {}), ...(output ? { outputTokens: output } : {}) };
}

/** Javobdagi birinchi audio bo'lak. */
export function geminiAudioPart(json: unknown): { data: string; mimeType?: string } | null {
  const parts = (json as GeminiResponse)?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p?.inlineData?.data;
    if (typeof data === "string" && data.length) return { data, ...(p.inlineData?.mimeType ? { mimeType: p.inlineData.mimeType } : {}) };
  }
  return null;
}

/* ══════════════════════════ 429 / quota ══════════════════════════ */

/** Wait used when a 429 carries no parsable `retryDelay`. */
export const GEMINI_DEFAULT_RETRY_MS = 20_000;

export type GeminiQuotaInfo = {
  /** `retryDelay` of the error details ("39s" → 39 000), absent when not reported. */
  retryDelayMs?: number;
  /** Every quota id named by the error (`GenerateRequestsPerMinutePerProjectPerModel`, …). */
  quotaIds: string[];
  /** Any of the exceeded quotas resets per DAY — waiting a minute cannot help. */
  daily: boolean;
};

/** "39s" / "39.5s" / "1.5" → ms (protobuf Duration text); anything else → undefined. */
export function parseRetryDelay(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v * 1000);
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(String(v ?? ""));
  if (!m) return undefined;
  const n = Number(m[1]);
  return Math.round(m[2]?.toLowerCase() === "ms" ? n : n * 1000);
}

/**
 * Reads a Gemini 429 body: `error.details[]` holds `RetryInfo.retryDelay` ("39s") and the
 * exceeded quota (`QuotaFailure.violations[].quotaId`, or `ErrorInfo.metadata.quota_limit`).
 * Never throws; a body that is not JSON (truncated, HTML) is scanned for `…PerDay…` text so
 * a daily quota is still recognised.
 */
export function parseGeminiQuota(body: string): GeminiQuotaInfo {
  const quotaIds = new Set<string>();
  let retryDelayMs: number | undefined;
  try {
    const details = (JSON.parse(body) as { error?: { details?: unknown } })?.error?.details;
    for (const d of Array.isArray(details) ? (details as Record<string, unknown>[]) : []) {
      const type = String(d?.["@type"] ?? "");
      if (/RetryInfo$/.test(type)) retryDelayMs ??= parseRetryDelay(d.retryDelay);
      for (const v of Array.isArray(d?.violations) ? (d.violations as Record<string, unknown>[]) : []) {
        if (typeof v?.quotaId === "string" && v.quotaId) quotaIds.add(v.quotaId);
      }
      const meta = d?.metadata as Record<string, unknown> | undefined;
      for (const k of ["quota_limit", "quota_id", "quotaId"]) {
        const x = meta?.[k];
        if (typeof x === "string" && x) quotaIds.add(x);
      }
    }
  } catch {
    // not JSON — the text scan below still finds a per-day quota
  }
  for (const m of body.matchAll(/[A-Za-z]*PerDay[A-Za-z]*/g)) quotaIds.add(m[0]);
  const ids = [...quotaIds];
  return { ...(retryDelayMs !== undefined ? { retryDelayMs } : {}), quotaIds: ids, daily: ids.some((id) => /PerDay/i.test(id)) };
}

/** What the user reads when the daily quota is gone (the chain turns the `dailyQuota` TtsError into this). */
export const GEMINI_DAILY_QUOTA_MESSAGE = "Ovoz xizmati bugungi limitga yetdi, birozdan keyin urinib ko‘ring. Kredit qaytariladi.";

/** TtsError for a failed HTTP response: 429 RESOURCE_EXHAUSTED carries wait time + quota id. */
export function geminiHttpError(status: number, statusText: string, detail: string): TtsError {
  const short = `${status} ${statusText || "xato"}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
  if (status !== 429) return new TtsError("gemini", short, { retryable: status >= 500, status });
  const q = parseGeminiQuota(detail);
  const quotaId = q.quotaIds.join(",") || undefined;
  if (q.daily) return new TtsError("gemini", short, { retryable: false, status, dailyQuota: true, rateLimited: true, ...(quotaId ? { quotaId } : {}) });
  return new TtsError("gemini", short, {
    retryable: true,
    status,
    rateLimited: true,
    retryAfterMs: q.retryDelayMs ?? GEMINI_DEFAULT_RETRY_MS,
    ...(quotaId ? { quotaId } : {}),
  });
}

/* ══════════════════════════ adapter ══════════════════════════ */

export type GeminiTtsDeps = {
  fetchImpl?: typeof fetch;
  key?: () => string;
  model?: () => string;
  /** Cross-process request pacing (`pace.ts`); absent = unpaced (unit tests with a mock fetch). */
  pace?: (ctx: TtsPaceCtx) => Promise<void>;
};

export function makeGeminiTts(deps: GeminiTtsDeps = {}): TtsProvider {
  const key = deps.key ?? geminiKey;
  const model = deps.model ?? geminiTtsModel;

  return {
    id: "gemini",
    configured: () => Boolean(key() && model()),
    multiSpeaker: true,
    ...(deps.pace ? { pace: deps.pace } : {}),

    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      const k = key();
      const m = model();
      if (!k) throw new TtsError("gemini", "GEMINI_API_KEY yo'q");
      if (!m) throw new TtsError("gemini", "TTS_GEMINI_MODEL yoqilmagan (preview model ataylab o'chirilgan)");
      let body = String(text ?? "").trim();
      if (!body) throw new TtsError("gemini", "bo'sh matn");

      const voice = opts.voice?.trim() || GEMINI_DEFAULT_VOICE;
      /*
       * Two-speaker request: exactly two distinct voices → `multiSpeakerVoiceConfig`, the text
       * becomes `Speaker1: …\nSpeaker2: …`. Anything else (one voice, >2) → plain single voice.
       */
      const names = [...new Set((opts.turns ?? []).map((t) => t.voice.trim() || GEMINI_DEFAULT_VOICE))];
      const dialog = names.length === 2 && opts.turns ? opts.turns : null;
      const speechConfig = dialog
        ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: names.map((name, i) => ({ speaker: DIALOG_LABELS[i], voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } })),
            },
          }
        : { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
      const spoken = dialog ? dialog.reduce((n, t) => n + t.text.length, 0) : body.length;
      if (dialog) body = renderDialog(dialog.map((t) => ({ voice: names.indexOf(t.voice.trim() || GEMINI_DEFAULT_VOICE), text: t.text.trim() })));
      const doFetch = deps.fetchImpl ?? fetch;
      const timeoutMs = Math.max(1_000, opts.timeoutMs ?? TTS_LIMITS.callTimeoutMs);

      let res: Response;
      try {
        res = await doFetch(`${GEMINI_TTS_BASE}/${encodeURIComponent(m)}:generateContent`, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          // Kalit sarlavhada — URL da bo'lsa jurnalga/proxy loglariga tushardi.
          headers: { "Content-Type": "application/json", "x-goog-api-key": k },
          body: JSON.stringify({
            contents: [{ parts: [{ text: body }] }],
            generationConfig: { responseModalities: ["AUDIO"], speechConfig },
          }),
        });
      } catch (e) {
        throw new TtsError("gemini", e instanceof Error ? e.message : "tarmoq xatosi", { retryable: true });
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw geminiHttpError(res.status, res.statusText, detail);
      }

      const json = (await res.json().catch(() => null)) as unknown;
      const part = geminiAudioPart(json);
      if (!part) {
        const msg = (json as GeminiResponse)?.error?.message ?? "javobda audio yo'q";
        throw new TtsError("gemini", msg, { retryable: false });
      }

      const pcm = new Uint8Array(Buffer.from(part.data, "base64"));
      // 16-bit signed PCM, mono (`audio/L16`) — Gemini shu shaklda beradi.
      const wav = pcmToWav(pcm, { sampleRate: pcmRateOf(part.mimeType), channels: 1, bits: 16 });
      const seconds = wavSeconds(wav);
      if (seconds <= 0) throw new TtsError("gemini", "PCM bo'sh", { retryable: false });
      return { wav, seconds, chars: spoken, model: m, ...geminiTtsUsage(json) };
    },
  };
}

export const geminiTts = makeGeminiTts({ pace: geminiPacer });
