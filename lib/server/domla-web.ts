import "server-only";
import { ApiError, readJson } from "./api";
import { DOMLA_TEXT_MAX_CHARS, DOMLA_VOICE_MAX_BYTES, DOMLA_VOICE_MAX_SECONDS } from "../domla/rules";
import { RemuxError, sniffAnswerAudio, webmToOgg } from "../domla/webm-ogg";
import { readUploadForm } from "./upload-body";
import { minSeconds, mp3Seconds, mp4Seconds, oggSeconds, wavSeconds } from "../domla/audio-length";
import { submitAnswer, type AnswerInput, type ChannelResult, type SubmitResult } from "./domla";
import { BUSY_TEXT, NOT_WAITING_TEXT, TOO_BIG_TEXT, TOO_LONG_TEXT } from "../domla/persona";

/**
 * The web side of «Qattiqqo'l domla» answers (owner decision 2026-11-13): reads a chat answer -- `multipart/form-data`
 * with `audio` (the MediaRecorder blob) and `seconds`, or JSON `{ text }` -- and hands it to the SAME `submitAnswer`
 * the bot uses, marked as coming from the web. The container is sniffed from the bytes (the browser's mime type is
 * not trusted): WebM/Opus (Chrome, Android, Telegram's WebView) is remuxed to Ogg/Opus (`webm-ogg.ts`), which is what
 * the scorer is already sent for a Telegram voice; Ogg, MP4/AAC (Safari), MP3 and WAV pass as they are. The measured
 * length of a remuxed WebM wins over the client's number.
 */

const MIME: Record<"ogg" | "mp4" | "mp3" | "wav", string> = { ogg: "audio/ogg", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav" };

/** Multipart overhead allowed over the audio limit (field names, boundaries, the `seconds` field). */
const FORM_SLACK = 16 * 1024;

export async function readWebAnswer(req: Request): Promise<AnswerInput> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("multipart/form-data")) {
    const form = await readUploadForm(req, DOMLA_VOICE_MAX_BYTES + FORM_SLACK, TOO_BIG_TEXT);
    const file = form?.get("audio");
    if (!(file instanceof Blob) || file.size === 0) throw new ApiError("Ovozli javob yuborilmadi", 400, { code: "empty" });
    if (file.size > DOMLA_VOICE_MAX_BYTES) throw new ApiError(TOO_BIG_TEXT, 413, { code: "too_big" });
    const claimed = Number(form?.get("seconds") ?? 0);
    let seconds = Number.isFinite(claimed) && claimed > 0 ? claimed : 0;
    let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
    const kind = sniffAnswerAudio(bytes);
    if (!kind) throw new ApiError("Bu turdagi audio qabul qilinmaydi", 400, { code: "bad_audio" });
    let mime: string;
    if (kind === "webm") {
      try {
        const ogg = webmToOgg(bytes);
        bytes = ogg.bytes;
        seconds = Math.max(seconds, ogg.seconds);
      } catch (e) {
        if (e instanceof RemuxError) throw new ApiError("Ovozli javobni o‘qib bo‘lmadi — qayta yozib ko‘ring", 400, { code: "bad_audio" });
        throw e;
      }
      mime = "audio/ogg";
    } else {
      mime = MIME[kind];
      // Measured from the bytes; a container that does not say is bounded by its size at the highest voice bitrate.
      const measured = (kind === "ogg" ? oggSeconds : kind === "wav" ? wavSeconds : kind === "mp3" ? mp3Seconds : mp4Seconds)(bytes);
      seconds = Math.max(seconds, measured ?? minSeconds(bytes.byteLength));
    }
    if (seconds > DOMLA_VOICE_MAX_SECONDS) throw new ApiError(TOO_LONG_TEXT, 413, { code: "too_long" });
    return { via: "voice", bytes, mime, seconds };
  }
  const body = await readJson<{ text?: unknown }>(req, DOMLA_TEXT_MAX_CHARS * 4 + 1_000);
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) throw new ApiError("Javob bo‘sh", 400, { code: "empty" });
  if (text.length > DOMLA_TEXT_MAX_CHARS) throw new ApiError(`Javob ${DOMLA_TEXT_MAX_CHARS} belgidan oshmasin`, 413, { code: "too_long" });
  return { via: "text", text };
}

/** The refusal of a web answer, as an HTTP error the chat shows. */
const REFUSED: Record<Exclude<SubmitResult, { ok: true }>["reason"], [number, string]> = {
  no_session: [404, "Bu himoya topilmadi yoki tugagan"],
  preparing: [409, "Domla savollarni hali tayyorlayapti"],
  expired: [410, "Himoya muddati tugagan"],
  not_waiting: [409, NOT_WAITING_TEXT],
  busy: [409, BUSY_TEXT],
  too_big: [413, TOO_BIG_TEXT],
  too_long: [413, TOO_LONG_TEXT],
  empty: [400, "Javob bo‘sh"],
};

/** A web chat answer to the open session `sessionId` of `userId` (the session moves to the web). */
export async function submitWebAnswer(userId: string, sessionId: string, input: AnswerInput): Promise<{ idx: number }> {
  const r = await submitAnswer(userId, input, new Date(), { from: "web", sessionId });
  if (r.ok) return { idx: r.idx };
  const [status, message] = REFUSED[r.reason];
  throw new ApiError(message, status, { code: r.reason });
}

const CHANNEL_REFUSED: Record<Exclude<ChannelResult, { ok: true }>["reason"], [number, string]> = {
  not_found: [404, "Bu himoya topilmadi"],
  expired: [410, "Himoya muddati tugagan"],
  finished: [409, "Bu himoya tugagan"],
  no_telegram: [409, "Botda davom etish uchun avval Telegram akkauntini bog‘lang"],
};

export function channelError(r: Exclude<ChannelResult, { ok: true }>): ApiError {
  const [status, message] = CHANNEL_REFUSED[r.reason];
  return new ApiError(message, status, { code: r.reason });
}
