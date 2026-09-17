/**
 * AZURE AI SPEECH adapteri (AUDIT-22 WP-A) — zanjirning BIRINCHI bo'g'ini.
 *
 * Nega birinchi (`tts.md` §3): 2026-09-16 holatiga ko'ra Azure — YAGONA
 * xalqaro provayder bo'lib rasmiy `uz-UZ` Neural ovozlarga ega
 * (`uz-UZ-MadinaNeural`/`SardorNeural`), MP3 ni TO'G'RIDAN-TO'G'RI
 * beradi (konvertatsiya qatlami kerak emas) va narxi o'rtacha
 * ($16/1M belgi).
 *
 * SDK EMAS, REST: `microsoft-cognitiveservices-speech-sdk` ~10 MB va
 * ichida audio qurilma/WebRTC qatlamlari bor — worker uchun keraksiz.
 * REST esa bitta POST:
 *
 *   POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
 *   Ocp-Apim-Subscription-Key: <AZURE_SPEECH_KEY>
 *   Content-Type: application/ssml+xml
 *   X-Microsoft-OutputFormat: audio-24khz-96kbitrate-mono-mp3
 *   <speak …><voice name="…"><prosody rate="…">matn</prosody></voice></speak>
 *
 * `fetch` SEAM orqali (`deps.fetchImpl`, `llm/gemini.ts` naqshi):
 * KALITLAR HALI YO'Q (`tts.md` §6), shuning uchun adapter hujjatga ko'ra
 * yozilgan va mock `fetch` bilan sinalgan; haqiqiy so'rov — `tts-lab`
 * (`scripts/tts-lab.mts`) egasi kalit bergach.
 *
 * DAVOMIYLIK javob SARLAVHASIDA kelmaydi — u MP3 kadrlaridan
 * O'LCHANADI (`mp3.ts mp3Seconds`). `AudioModel.seconds` va `delivered`
 * aynan shu o'lchovga tayanadi: «5 daqiqa» deb to'lagan foydalanuvchi
 * 3 daqiqalik fayl olsa farq qaytadi, ya'ni bu son TAXMIN bo'lishi
 * mumkin emas.
 */
import { TTS_LIMITS, TtsError, type TtsAudio, type TtsProvider, type TtsSynthOpts } from "./types";
import { mp3Seconds } from "./mp3";

/* ══════════════════════════ sozlama ══════════════════════════ */

export const azureKey = (): string => process.env.AZURE_SPEECH_KEY?.trim() || "";
export const azureRegion = (): string => process.env.AZURE_SPEECH_REGION?.trim() || "";

/**
 * MP3 24 kHz / 96 kbps / mono (`tts.md` §1).
 *
 * Nega aynan shu: 24 kHz nutq uchun yetarli (16 kHz «telefon» bo'lib
 * eshitiladi, 48 kHz faylni ikki barobar qiladi), 96 kbps CBR esa
 * kadrlarni BIR XIL uzunlikda saqlaydi — `concatMp3` bo'laklarni
 * qayta kodlamasdan ulay oladi. VBR (`audio-24khz-48kbitrate-…`) ham
 * ishlardi, lekin har bo'lakning Xing sarlavhasi bilan kelardi.
 */
export const AZURE_OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";

export const azureEndpoint = (region: string): string => `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

/* ══════════════════════════ SSML ══════════════════════════ */

const XML_ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** SSML ichidagi matn — teg sifatida o'qilmasin (matnda «<» bo'lishi mumkin). */
export function xmlEscape(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => XML_ESC[c]);
}

/**
 * Ovoz nomidan BCP-47 tilini ajratadi: `uz-UZ-MadinaNeural` → `uz-UZ`.
 *
 * Nega ovozdan, forma tilidan emas: `xml:lang` ovoz tilidan FARQ QILSA
 * Azure 400 qaytaradi. Tasdiqlanmagan to'rtlik (`kaa`/`ky`/`tg`/`tk`,
 * `TTS_LANG_VOICES` `verified:false`) aynan shu holat — ularda ovoz
 * qo'shni tilniki, shuning uchun `xml:lang` ham o'shaniki bo'lishi shart.
 */
export function localeOfVoice(voice: string, lang: string): string {
  const m = /^([a-z]{2,3}-[A-Za-z]{2,4})-/.exec(String(voice ?? ""));
  if (m) return m[1];
  const code = String(lang ?? "uz").toLowerCase();
  return code.includes("-") ? code : `${code}-${code.toUpperCase()}`;
}

/** `1.1` → `+10%`, `0.9` → `-10%`; 1 (yoki yo'q) → `prosody` umuman yozilmaydi. */
export function prosodyRate(speed?: number): string | null {
  const s = Number(speed);
  if (!Number.isFinite(s) || s <= 0 || Math.abs(s - 1) < 0.01) return null;
  const pct = Math.round((Math.max(0.5, Math.min(2, s)) - 1) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * Bitta replikaning SSML i.
 *
 * `pauseMs` — replikadan KEYINGI pauza (`podcast.md` §3: replikalar
 * orasida qisqa pauza, bloklar orasida uzunroq). `<break>` teg AYNAN
 * shu yerda tug'iladi va shu yerda qoladi: xom matnga qo'shilsa,
 * SSML ni qo'llamaydigan Aisha uni ovoz chiqarib o'qib yuborardi.
 */
export function azureSsml(text: string, o: TtsSynthOpts & { voice: string }): string {
  const locale = localeOfVoice(o.voice, o.lang);
  const rate = prosodyRate(o.speed);
  const body = xmlEscape(String(text ?? "").trim());
  const spoken = rate ? `<prosody rate="${rate}">${body}</prosody>` : body;
  const pause = o.pauseMs && o.pauseMs > 0 ? `<break time="${Math.min(5000, Math.round(o.pauseMs))}ms"/>` : "";
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${xmlEscape(o.voice)}">${spoken}${pause}</voice></speak>`
  );
}

/* ══════════════════════════ xatolar ══════════════════════════ */

/**
 * HTTP kodi → `retryable` (`llm/chain.ts` naqshi bilan bir xil mantiq).
 *
 *   401/403 — kalit yaroqsiz yoki hisob bloklangan: qayta urinish
 *             ma'nosiz, zanjir KEYINGI provayderga o'tsin;
 *   400     — SSML/ovoz nomi xato: takrorlash ham xuddi shu javobni
 *             berardi (masalan ovoz shu regionda yo'q);
 *   429     — so'rov chegarasi, `Retry-After` bo'lsa o'sha kutiladi;
 *   ≥500    — Azure tomonidagi vaqtinchalik nosozlik.
 */
export function azureRetryable(status: number): boolean {
  if (status === 429) return true;
  return status >= 500;
}

function retryAfterMs(res: { headers?: { get?: (n: string) => string | null } }): number | undefined {
  const raw = res.headers?.get?.("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/* ══════════════════════════ adapter ══════════════════════════ */

export type AzureTtsDeps = {
  /** Test seam — mock `fetch` (`llm/gemini.ts` `fetchImpl` naqshi). */
  fetchImpl?: typeof fetch;
  key?: () => string;
  region?: () => string;
};

export function makeAzureTts(deps: AzureTtsDeps = {}): TtsProvider {
  const key = deps.key ?? azureKey;
  const region = deps.region ?? azureRegion;

  return {
    id: "azure",
    /*
     * IKKALASI ham kerak: kalit bo'lib region bo'lmasa URL qurilmaydi
     * va so'rov `https://.tts.speech…` ga ketardi — DNS xatosi bo'lib,
     * jurnalda «tarmoq nosozligi» deb ko'rinardi.
     */
    configured: () => Boolean(key() && region()),

    async synthesize(text: string, opts: TtsSynthOpts): Promise<TtsAudio> {
      const k = key();
      const r = region();
      if (!k || !r) throw new TtsError("azure", "AZURE_SPEECH_KEY/AZURE_SPEECH_REGION yo'q");

      const body = String(text ?? "").trim();
      if (!body) throw new TtsError("azure", "bo'sh matn");
      const voice = opts.voice?.trim() || "";
      if (!voice) throw new TtsError("azure", "ovoz nomi berilmagan");

      const ssml = azureSsml(body, { ...opts, voice });
      const doFetch = deps.fetchImpl ?? fetch;
      const timeoutMs = Math.max(1_000, opts.timeoutMs ?? TTS_LIMITS.callTimeoutMs);

      let res: Response;
      try {
        res = await doFetch(azureEndpoint(r), {
          method: "POST",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "Ocp-Apim-Subscription-Key": k,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": AZURE_OUTPUT_FORMAT,
            // Azure hujjati `User-Agent` ni MAJBURIY deb belgilaydi.
            "User-Agent": "SlaydX",
          },
          body: ssml,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tarmoq xatosi";
        // Timeout/abort ham QAYTA URINISHGA arziydi: `llm/chain.ts` dan
        // farqli o'laroq bu yerda bitta bo'lak 2–4 s oladi, ya'ni qayta
        // urinish butun ish byudjetini yemaydi.
        throw new TtsError("azure", msg, { retryable: true });
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new TtsError("azure", `${res.status} ${res.statusText || "xato"}${detail ? `: ${detail.slice(0, 200)}` : ""}`, {
          retryable: azureRetryable(res.status),
          status: res.status,
          ...(retryAfterMs(res) !== undefined ? { retryAfterMs: retryAfterMs(res)! } : {}),
        });
      }

      const mp3 = new Uint8Array(await res.arrayBuffer());
      if (!mp3.length) throw new TtsError("azure", "bo'sh javob", { retryable: true });
      const seconds = mp3Seconds(mp3);
      /*
       * Kadr topilmasa — bu MP3 emas (masalan chiqish formati
       * o'zgartirilgan yoki xato sahifasi 200 bilan kelgan). Uni
       * «audio» deb o'tkazib yuborish faylni oxirida buzardi, va nuqson
       * faqat tinglashda bilinardi.
       */
      if (seconds <= 0) throw new TtsError("azure", "javobda MP3 kadri topilmadi", { retryable: false });
      return { mp3, seconds, chars: body.length };
    },
  };
}

export const azureTts = makeAzureTts();
