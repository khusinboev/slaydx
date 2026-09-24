/**
 * AISHA AI (Navoiy TTS) adapteri (AUDIT-22 WP-A) — zanjirning IKKINCHI
 * bo'g'ini.
 *
 * Nega zanjirda bor (`tts.md` §1/§3): Aisha — o'zbek tili uchun MAXSUS
 * o'qitilgan mahalliy provayder (ochiq manba bazasi `Navoiy TTS` =
 * CosyVoice2-0.5B), ya'ni talaffuz sifati Azure'nikidan yaxshiroq
 * bo'lishi MUMKIN. Nega birinchi emas: (1) chiqish WAV — MP3 ga
 * o'girish kerak (`mp3.ts wavToMp3`), (2) so'rovga 1 000 belgi qattiq
 * chegara, (3) tijorat litsenziyasi/SLA aniq emas (`tts.md` X-2).
 *
 * ⚠ SO'ROV SHAKLI TASDIQLANMAGAN. Kalit yo'q (`tts.md` §6), shuning
 * uchun tana/javob shakli hisobotdagi hujjat sahifasi bo'yicha
 * yozilgan va BITTA joyda — `aishaBody`/`readAishaAudio` — jamlangan:
 * `tts-lab` birinchi haqiqiy javobni ko'rsatganda tuzatiladigan yer
 * shu ikki funksiya, adapterning qolgan mantiqi (chegara, xato
 * tasnifi, WAV o'lchash) o'zgarmaydi.
 *
 * Javob IKKI SHAKLDA bo'lishi mumkin va ikkalasi ham qo'llab-quvvatlanadi:
 *   • to'g'ridan-to'g'ri WAV baytlar (`Content-Type: audio/*`);
 *   • JSON, ichida audio HAVOLASI (`audio_path`/`url`) yoki base64.
 * Ikkinchisida fayl IKKINCHI so'rov bilan yuklab olinadi.
 */
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "./types";
import { wavSeconds } from "./mp3";
import { safeFetchUrl, UnsafeUrlError } from "../safe-fetch";

/** Havola orqali yuklanadigan audio fayl chegarasi (EXT-15). */
const AISHA_MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/**
 * Aisha'ning O'Z xostidagi `http://` media havolasi `https://` ga ko'tariladi
 * (review N5): TLS proksi ortidagi Django ko'pincha `http://` media URL
 * beradi, `safeFetchUrl` esa faqat https — aks holda kalit ulangach Aisha
 * har doim jimgina keyingi provayderga tushardi. Begona xost o'zgarmaydi
 * (http bo'lsa rad etiladi).
 */
export function httpsForAisha(url: string): string {
  // URL emas — o'zgarishsiz (`safeFetchUrl` rad etadi).
  if (!URL.canParse(url)) return url;
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname !== new URL(AISHA_URL).hostname) return url;
  u.protocol = "https:";
  return u.toString();
}

/* ══════════════════════════ sozlama ══════════════════════════ */

export const aishaKey = (): string => process.env.AISHA_API_KEY?.trim() || "";

export const AISHA_URL = "https://back.aisha.group/api/v1/tts/post/";

/**
 * 1 000 belgi/so'rov — API kalit bilan (kalitsiz 500), `tts.md` §1.
 *
 * `TTS_LIMITS.chunkChars` (900) aynan SHU raqamga moslangan; bu yerda
 * chegara QAYTA tekshiriladi, chunki bo'lakni chaqiruvchi yasaydi va
 * xato bo'lakni tarmoqqa chiqarish bekorga pul/vaqt sarflardi.
 */
export const AISHA_MAX_CHARS = 1_000;

/** Standart ovoz (`tts.md` §1: «Gulnoza» modeli). */
export const AISHA_DEFAULT_VOICE = "gulnoza";

/* ══════════════════════════ so'rov/javob shakli ══════════════════════════ */

/**
 * So'rov tanasi — TASDIQLANMAGAN shakl (fayl boshidagi izoh).
 *
 * `speed` 0.5–2.0 (`tts.md` §1); `mood` — Neutral/Cheerful/Happy/Sad,
 * biz DOIM `Neutral` beramiz: ohangni matn va janr belgilaydi
 * (`greeting.md` §3), forma esa ovoz/ohang tanlovini ko'rsatmaydi.
 */
export function aishaBody(text: string, opts: TtsSynthOpts): Record<string, unknown> {
  return {
    transcript: text,
    model: opts.voice?.trim() || AISHA_DEFAULT_VOICE,
    mood: "Neutral",
    speed: Math.max(0.5, Math.min(2, Number(opts.speed) || 1)),
    language: String(opts.lang ?? "uz").toLowerCase().slice(0, 2),
  };
}

/** JSON javobdan audio havolasi yoki base64 — birinchi topilgani. */
export function aishaAudioRef(json: unknown): { url?: string; base64?: string } | null {
  const o = json as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const flat: Record<string, unknown> = { ...o, ...((o.data ?? o.result ?? {}) as Record<string, unknown>) };
  for (const k of ["audio_path", "audio_url", "url", "path", "file", "audio"]) {
    const v = flat[k];
    if (typeof v !== "string" || !v.trim()) continue;
    // `data:` yoki uzun base64 — havola emas, baytlarning o'zi.
    if (/^data:/i.test(v)) return { base64: v.slice(v.indexOf(",") + 1) };
    if (/^https?:\/\//i.test(v)) return { url: v };
    if (v.length > 256 && /^[A-Za-z0-9+/=\s]+$/.test(v)) return { base64: v };
    // Nisbiy yo'l (`/media/tts/abc.wav`) — xostga bog'lanadi.
    if (v.startsWith("/")) return { url: new URL(v, AISHA_URL).toString() };
  }
  return null;
}

/* ══════════════════════════ adapter ══════════════════════════ */

export type AishaTtsDeps = {
  /** Test seam — mock `fetch`. */
  fetchImpl?: typeof fetch;
  key?: () => string;
  url?: string;
};

/** 401/403 — kalit/hisob: zanjir keyingi provayderga. 429/5xx — qayta urinish. */
export function aishaRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function makeAishaTts(deps: AishaTtsDeps = {}): TtsProvider {
  const key = deps.key ?? aishaKey;
  const url = deps.url ?? AISHA_URL;

  return {
    id: "aisha",
    configured: () => Boolean(key()),

    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      const k = key();
      if (!k) throw new TtsError("aisha", "AISHA_API_KEY yo'q");
      const body = String(text ?? "").trim();
      if (!body) throw new TtsError("aisha", "bo'sh matn");
      if (body.length > AISHA_MAX_CHARS) {
        /*
         * QAYTA URINISH BEFOYDA: bo'lak chaqiruvchi tomonida yasaladi.
         * Bu xato ko'rinsa, `TTS_LIMITS.chunkChars` bilan bu chegara
         * ajralib ketgan degani — jurnalda ikkala son ham ko'rinsin.
         */
        throw new TtsError("aisha", `bo'lak ${body.length} belgi, chegara ${AISHA_MAX_CHARS}`);
      }

      const doFetch = deps.fetchImpl ?? fetch;
      const timeoutMs = Math.max(1_000, opts.timeoutMs ?? TTS_LIMITS.callTimeoutMs);

      let res: Response;
      try {
        res = await doFetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "X-Api-Key": k, "Content-Type": "application/json", Accept: "audio/wav, application/json" },
          body: JSON.stringify(aishaBody(body, opts)),
        });
      } catch (e) {
        throw new TtsError("aisha", e instanceof Error ? e.message : "tarmoq xatosi", { retryable: true });
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TtsError("aisha", `${res.status} ${res.statusText || "xato"}${detail ? `: ${detail.slice(0, 200)}` : ""}`, {
          retryable: aishaRetryable(res.status),
          status: res.status,
        });
      }

      const wav = await readAishaAudio(res, doFetch, timeoutMs);
      const seconds = wavSeconds(wav);
      /*
       * WAV sarlavhasi o'qilmasa — javob audio emas (xato sahifasi 200
       * bilan, yoki format o'zgargan). `wavToMp3` shundoq ham `null`
       * berardi, lekin o'shanda sabab «enkoder yo'q» bilan chalkashardi.
       */
      if (seconds <= 0) throw new TtsError("aisha", "javobdan WAV o'qilmadi", { retryable: false });
      return { wav, seconds, chars: body.length };
    },
  };
}

/** Javobdan WAV baytlar — to'g'ridan-to'g'ri, base64 yoki ikkinchi so'rov bilan. */
export async function readAishaAudio(res: Response, doFetch: typeof fetch, timeoutMs: number): Promise<Uint8Array> {
  const type = res.headers.get("content-type") ?? "";
  if (/^audio\//i.test(type) || /octet-stream/i.test(type)) {
    return new Uint8Array(await res.arrayBuffer());
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TtsError("aisha", `kutilmagan javob turi: ${type || "noma'lum"}`, { retryable: false });
  }
  const ref = aishaAudioRef(json);
  if (!ref) throw new TtsError("aisha", "javobda audio havolasi yo'q", { retryable: false });
  if (ref.base64) return new Uint8Array(Buffer.from(ref.base64.replace(/\s+/g, ""), "base64"));

  let file: Response;
  try {
    /*
     * Havola PROVAYDER javobidan keladi (audit EXT-15): faqat https,
     * ommaviy xost, har redirect qayta tekshiriladi, tana ≤ 20 MB
     * (1 000 belgilik WAV ~1–2 MB). Qoida buzilsa qayta urinish befoyda.
     */
    file = await safeFetchUrl(httpsForAisha(ref.url!), { fetchImpl: doFetch, timeoutMs, maxBytes: AISHA_MAX_AUDIO_BYTES });
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new TtsError("aisha", `audio havolasi rad etildi: ${e.message}`, { retryable: false });
    throw new TtsError("aisha", `audio yuklanmadi: ${e instanceof Error ? e.message : "tarmoq"}`, { retryable: true });
  }
  if (!file.ok) throw new TtsError("aisha", `audio yuklanmadi: ${file.status}`, { retryable: aishaRetryable(file.status), status: file.status });
  return new Uint8Array(await file.arrayBuffer());
}

export const aishaTts = makeAishaTts();
