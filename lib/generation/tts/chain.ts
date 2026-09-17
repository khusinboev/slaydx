/**
 * TTS ZAXIRA ZANJIRI (AUDIT-22 WP-A) — `llm/chain.ts` naqshi, lekin
 * ROL o'rniga TIL bilan parametrlangan (`tts.md` §3).
 *
 * Sxema:
 *   TTS_VOICE_UZ=azure:uz-UZ-MadinaNeural,azure:uz-UZ-SardorNeural,aisha:gulnoza
 *   TTS_VOICE_RU=azure:ru-RU-SvetlanaNeural
 * O'zgaruvchi bo'lmasa — `TTS_LANG_VOICES` jadvalining shu tildagi
 * qatori. O'zgaruvchi jadvalni ALMASHTIRADI, kengaytirmaydi: operator
 * ovozni bitta joydan boshqara olsin (`types.ts` izohi).
 *
 * ⚠ ENG MUHIM FARQ `llm/chain.ts` dan: provayder BUTUN ISH uchun
 * bog'lanadi, har bo'lak uchun alohida emas.
 *
 * Nega: bitta podkast 5–8 ta so'rovga bo'linadi va natijalar BITTA MP3
 * ga ulanadi. Azure 24 kHz MP3, Aisha 16 kHz WAV beradi — ular bir
 * faylda aralashsa, `concatMp3` profil tekshiruvida `null` qaytarardi
 * (yoki tekshiruvsiz — o'ynamaydigan fayl chiqardi). Shuning uchun
 * `synthesizeAll` provayderni tanlaydi, HAMMA bo'lakni o'shanda
 * so'raydi, va yiqilsa keyingi provayderda BOSHIDAN boshlaydi.
 * Bo'laklar arzon (900 belgi ≈ $0.014), qayta boshlash esa o'ynamaydigan
 * fayldan ko'ra afzal.
 *
 * Jurnal (`llm/chain.ts` formati):
 *   [tts:uz] azure → ok 1 284 ms (6 bo'lak, 4 120 belgi)
 *   [tts:uz] azure → xato (429) 210 ms: Too many requests
 *   [tts:uz] aisha → kalit yo'q, o'tkazib yuborildi
 */
import {
  TTS_LIMITS,
  TtsError,
  type TtsAudio,
  type TtsProvider,
  type TtsProviderId,
  type TtsSynthOpts,
  type TtsUsage,
  type TtsVoiceSpec,
  ttsVoicesFor,
} from "./types";
import { makeAzureTts } from "./azure";
import { makeAishaTts } from "./aisha";
import { makeGeminiTts } from "./gemini";

/* ══════════════════════════ ovoz zanjiri ══════════════════════════ */

const isProviderId = (v: string): v is TtsProviderId => ["azure", "aisha", "gemini", "google", "elevenlabs"].includes(v);

/** `TTS_VOICE_<LANG>` nomi: `uz` → `TTS_VOICE_UZ`, `kaa` → `TTS_VOICE_KAA`. */
export const ttsVoiceEnvName = (lang: string): string => `TTS_VOICE_${String(lang ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

/**
 * Til uchun ovoz ro'yxati: muhit o'zgaruvchisi yoki jadval.
 *
 * O'zgaruvchidagi yaroqsiz yozuv (noma'lum provayder, `:` siz nom)
 * JIMGINA tashlanmaydi — u butunlay e'tiborsiz qoldiriladi va ro'yxat
 * bo'sh chiqsa JADVALGA qaytiladi: yarim tushunilgan sozlama
 * foydalanuvchini kutilmagan ovoz bilan qoldirardi.
 */
export function ttsVoiceChain(lang: string, env: NodeJS.ProcessEnv = process.env): TtsVoiceSpec[] {
  const raw = env[ttsVoiceEnvName(lang)]?.trim();
  if (raw) {
    const parsed: TtsVoiceSpec[] = [];
    for (const item of raw.split(",")) {
      const s = item.trim();
      const at = s.indexOf(":");
      if (at <= 0 || at === s.length - 1) continue;
      const provider = s.slice(0, at).toLowerCase();
      const voice = s.slice(at + 1).trim();
      if (!isProviderId(provider) || !voice) continue;
      // `gender`/`verified` — jadvalnikidan, topilmasa ehtiyotkor standart.
      const known = ttsVoicesFor(lang).find((v) => v.provider === provider && v.voice === voice);
      parsed.push(known ?? { provider, voice, gender: "female", verified: false });
    }
    if (parsed.length) return parsed;
  }
  return [...ttsVoicesFor(lang)];
}

export type TtsProviderGroup = { provider: TtsProviderId; voices: string[] };

/**
 * Ovoz ro'yxatini PROVAYDER bo'yicha guruhlaydi (tartib saqlanadi).
 *
 * Guruh — bu «bitta ishni oxirigacha olib boradigan» birlik: uning
 * ichidagi birinchi ovoz rol A, ikkinchisi rol B (podkast dialogi).
 * Bitta ovozli guruhda ikkala rol ham SHU ovozni oladi (`ttsVoiceFor`
 * bilan ayni qoida — dialog bir ovozda o'qiladi, lekin fayl chiqadi).
 */
export function ttsGroups(lang: string, env: NodeJS.ProcessEnv = process.env): TtsProviderGroup[] {
  const out: TtsProviderGroup[] = [];
  for (const spec of ttsVoiceChain(lang, env)) {
    const cur = out.find((g) => g.provider === spec.provider);
    if (cur) {
      if (!cur.voices.includes(spec.voice)) cur.voices.push(spec.voice);
    } else out.push({ provider: spec.provider, voices: [spec.voice] });
  }
  return out;
}

/* ══════════════════════════ shartnoma ══════════════════════════ */

/** Bitta aytiladigan bo'lak: matn + ROL (0 — A ovozi, 1 — B) + keyingi pauza. */
export type TtsPart = { text: string; voice?: number; pauseMs?: number };

export type TtsRun = {
  provider: TtsProviderId;
  /** `provider:voice` — model `AudioModel.voice` ga shu satrni yozadi. */
  voiceA: string;
  voiceB: string;
  audios: TtsAudio[];
  usages: TtsUsage[];
  seconds: number;
  chars: number;
};

export type TtsChain = {
  /** Kamida bitta provayder sozlanganmi (kredit yechishdan OLDIN so'raladi). */
  configured(): boolean;
  /** Shu til uchun haqiqatan ishlaydigan provayderlar (sozlangan + jadvalda bor). */
  providersFor(lang: string): TtsProviderId[];
  synthesizeAll(parts: readonly TtsPart[], opts: { lang: string; speed?: number; timeoutMs?: number }): Promise<TtsRun>;
};

/* ══════════════════════════ zanjir ══════════════════════════ */

export type TtsChainDeps = {
  /** Provayder adapterlari (test: mock). Standart — azure → aisha → gemini. */
  providers?: readonly TtsProvider[];
  env?: NodeJS.ProcessEnv;
  /** `[tts:<lang>] …` — standart `console.log`. */
  log?: (line: string) => void;
};

const MAX_ATTEMPTS = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function makeTtsChain(deps: TtsChainDeps = {}): TtsChain {
  const providers = deps.providers ?? [makeAzureTts(), makeAishaTts(), makeGeminiTts()];
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  const byId = (id: TtsProviderId) => providers.find((p) => p.id === id);

  const usable = (lang: string): { group: TtsProviderGroup; provider: TtsProvider }[] => {
    const out: { group: TtsProviderGroup; provider: TtsProvider }[] = [];
    for (const group of ttsGroups(lang, env)) {
      const provider = byId(group.provider);
      if (!provider) continue;
      if (!provider.configured()) continue;
      out.push({ group, provider });
    }
    return out;
  };

  return {
    configured: () => providers.some((p) => p.configured()),
    providersFor: (lang) => usable(lang).map((u) => u.group.provider),

    async synthesizeAll(parts, opts) {
      const lang = String(opts.lang ?? "uz").toLowerCase();
      const live = parts.filter((p) => String(p.text ?? "").trim());
      if (!live.length) throw new TtsError("azure", "aytiladigan matn yo'q");

      // Sozlanmagan provayderlar jurnalga YOZILADI (xato emas, konfiguratsiya
      // holati — `llm/chain.ts` dagi «kalit yo'q» qatori bilan ayni).
      for (const group of ttsGroups(lang, env)) {
        const p = byId(group.provider);
        if (!p) log(`[tts:${lang}] ${group.provider} → adapter ro'yxatda yo'q, o'tkazib yuborildi`);
        else if (!p.configured()) log(`[tts:${lang}] ${group.provider} → kalit yo'q, o'tkazib yuborildi`);
      }

      const chain = usable(lang);
      if (!chain.length) throw new TtsError("azure", "Ovoz provayderi sozlanmagan", { retryable: false });

      let last: unknown = null;
      for (const { group, provider } of chain) {
        const started = Date.now();
        try {
          const run = await runGroup(provider, group, live, { lang, ...(opts.speed !== undefined ? { speed: opts.speed } : {}), ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}) });
          log(`[tts:${lang}] ${provider.id} → ok ${Date.now() - started} ms (${run.audios.length} bo'lak, ${run.chars} belgi)`);
          return run;
        } catch (e) {
          last = e;
          const err = e instanceof TtsError ? e : null;
          log(`[tts:${lang}] ${provider.id} → xato (${err?.status ?? "-"}) ${Date.now() - started} ms: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      throw last instanceof Error ? last : new TtsError(chain[0].group.provider, "sintez yiqildi", { retryable: false });
    },
  };
}

/**
 * Bitta provayder BUTUN ishni bajaradi.
 *
 * Bo'lak darajasidagi qayta urinish SHU YERDA (2 urinish): 429/5xx va
 * tarmoq uzilishi odatda bir necha yuz millisekundda tiklanadi, va
 * butun ishni boshqa provayderda qayta boshlashdan arzonroq.
 * `retryable:false` (kalit, 400, chegara) — darhol tashqariga, ya'ni
 * keyingi provayderga.
 */
async function runGroup(provider: TtsProvider, group: TtsProviderGroup, parts: readonly TtsPart[], opts: { lang: string; speed?: number; timeoutMs?: number }): Promise<TtsRun> {
  const voiceA = group.voices[0];
  const voiceB = group.voices[1] ?? group.voices[0];
  const audios: TtsAudio[] = [];
  const usages: TtsUsage[] = [];
  let seconds = 0;
  let chars = 0;

  for (const part of parts) {
    const text = String(part.text ?? "").trim();
    if (!text) continue;
    if (text.length > TTS_LIMITS.chunkChars) {
      // Bo'laklash chaqiruvchida (`chunkText`) — bu yerga uzun matn kelsa
      // shartnoma buzilgan, va uni jimgina kesish matnni YO'QOTARDI.
      throw new TtsError(provider.id, `bo'lak ${text.length} belgi, chegara ${TTS_LIMITS.chunkChars}`, { retryable: false });
    }
    const voice = part.voice === 1 ? voiceB : voiceA;
    const synth: TtsSynthOpts = {
      lang: opts.lang,
      voice,
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
      ...(part.pauseMs !== undefined ? { pauseMs: part.pauseMs } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };

    let audio: TtsAudio | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && !audio; attempt++) {
      try {
        audio = await provider.synthesize(text, synth);
      } catch (e) {
        const err = e instanceof TtsError ? e : null;
        const retryable = err ? err.retryable : true;
        if (!retryable || attempt === MAX_ATTEMPTS - 1) throw e;
        await sleep(err?.retryAfterMs ?? 500 * 2 ** attempt);
      }
    }
    if (!audio) throw new TtsError(provider.id, "sintez natijasi bo'sh", { retryable: false });

    audios.push(audio);
    usages.push({ provider: provider.id, voice, chars: audio.chars || text.length, seconds: audio.seconds });
    seconds += audio.seconds;
    chars += audio.chars || text.length;
  }

  if (!audios.length) throw new TtsError(provider.id, "sintez natijasi bo'sh", { retryable: false });
  return { provider: provider.id, voiceA: `${provider.id}:${voiceA}`, voiceB: `${provider.id}:${voiceB}`, audios, usages, seconds: Number(seconds.toFixed(3)), chars };
}

/**
 * Bitta adapterni zanjir shaklida o'raydi — testlar va `tts-lab` uchun.
 *
 * Nega kerak: dvigatel `TtsChain` ni oladi, mock esa odatda bitta
 * `TtsProvider`. Bu o'ram jadval/muhitga UMUMAN qaramaydi, ovoz nomini
 * chaqiruvchidan oladi — shunda test provayder tanlovini emas, o'z
 * mantiqini sinaydi.
 */
export function chainOfProvider(provider: TtsProvider, voices: string[] = ["A", "B"], log?: (line: string) => void): TtsChain {
  return {
    configured: () => provider.configured(),
    providersFor: () => (provider.configured() ? [provider.id] : []),
    async synthesizeAll(parts, opts) {
      const lang = String(opts.lang ?? "uz").toLowerCase();
      if (!provider.configured()) throw new TtsError(provider.id, "Ovoz provayderi sozlanmagan", { retryable: false });
      const started = Date.now();
      const run = await runGroup(provider, { provider: provider.id, voices }, parts.filter((p) => String(p.text ?? "").trim()), {
        lang,
        ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
      log?.(`[tts:${lang}] ${provider.id} → ok ${Date.now() - started} ms (${run.audios.length} bo'lak, ${run.chars} belgi)`);
      return run;
    },
  };
}

export const ttsChain = makeTtsChain();
