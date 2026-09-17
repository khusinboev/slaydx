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
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "./types";
import { pcmToWav, wavSeconds } from "./mp3";

/* ══════════════════════════ sozlama ══════════════════════════ */

export const geminiKey = (): string => process.env.GEMINI_API_KEY?.trim() || "";

/** Bo'sh — provayder O'CHIQ (fayl boshidagi izoh). Masalan `gemini-2.5-flash-preview-tts`. */
export const geminiTtsModel = (): string => process.env.TTS_GEMINI_MODEL?.trim() || "";

export const GEMINI_TTS_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini prebuilt ovozi — jadval `TTS_LANG_VOICES` da `gemini:kore` shaklida. */
export const GEMINI_DEFAULT_VOICE = "Kore";

/** `audio/L16;codec=pcm;rate=24000` → 24000; topilmasa Gemini standarti. */
export function pcmRateOf(mimeType: string | undefined): number {
  const m = /rate=(\d{4,6})/i.exec(String(mimeType ?? ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 24_000;
}

type GeminiPart = { inlineData?: { data?: string; mimeType?: string } };
type GeminiResponse = { candidates?: { content?: { parts?: GeminiPart[] } }[]; error?: { message?: string } };

/** Javobdagi birinchi audio bo'lak. */
export function geminiAudioPart(json: unknown): { data: string; mimeType?: string } | null {
  const parts = (json as GeminiResponse)?.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const data = p?.inlineData?.data;
    if (typeof data === "string" && data.length) return { data, ...(p.inlineData?.mimeType ? { mimeType: p.inlineData.mimeType } : {}) };
  }
  return null;
}

/* ══════════════════════════ adapter ══════════════════════════ */

export type GeminiTtsDeps = {
  fetchImpl?: typeof fetch;
  key?: () => string;
  model?: () => string;
};

export function makeGeminiTts(deps: GeminiTtsDeps = {}): TtsProvider {
  const key = deps.key ?? geminiKey;
  const model = deps.model ?? geminiTtsModel;

  return {
    id: "gemini",
    configured: () => Boolean(key() && model()),

    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      const k = key();
      const m = model();
      if (!k) throw new TtsError("gemini", "GEMINI_API_KEY yo'q");
      if (!m) throw new TtsError("gemini", "TTS_GEMINI_MODEL yoqilmagan (preview model ataylab o'chirilgan)");
      const body = String(text ?? "").trim();
      if (!body) throw new TtsError("gemini", "bo'sh matn");

      const voice = opts.voice?.trim() || GEMINI_DEFAULT_VOICE;
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
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        });
      } catch (e) {
        throw new TtsError("gemini", e instanceof Error ? e.message : "tarmoq xatosi", { retryable: true });
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TtsError("gemini", `${res.status} ${res.statusText || "xato"}${detail ? `: ${detail.slice(0, 200)}` : ""}`, {
          retryable: res.status === 429 || res.status >= 500,
          status: res.status,
        });
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
      return { wav, seconds, chars: body.length };
    },
  };
}

export const geminiTts = makeGeminiTts();
