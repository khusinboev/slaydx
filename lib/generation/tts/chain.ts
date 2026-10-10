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
  TTS_GEMINI_SPECS,
  TTS_LIMITS,
  TTS_PROVIDERS,
  TtsError,
  ttsChunkLimit,
  type TtsAudio,
  type TtsPaceCtx,
  type TtsProvider,
  type TtsProviderId,
  type TtsSynthOpts,
  type TtsUsage,
  type TtsVoiceChoice,
  type TtsVoiceSpec,
  ttsChoiceVoices,
  ttsUsageCost,
  ttsVoicesFor,
} from "./types";
import { recordTts } from "../job-cost";
import { currentSoumPerUsd } from "../llm-pricing";
import { makeAzureTts } from "./azure";
import { makeAishaTts } from "./aisha";
import { GEMINI_DAILY_QUOTA_MESSAGE, makeGeminiTts } from "./gemini";
import { geminiPacer } from "./pace";
import { packParts } from "./pack";
import { DeadlineError } from "../llm/chain";
import { backoffMs } from "../llm/retry";
import { UserFacingError } from "../../server/user-error";

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
      const known = [...ttsVoicesFor(lang), ...TTS_GEMINI_SPECS].find((v) => v.provider === provider && v.voice === voice);
      parsed.push(known ?? { provider, voice, gender: "female", verified: false });
    }
    if (parsed.length) return parsed;
  }
  // Table path: the language rows, then Gemini (off unless TTS_GEMINI_MODEL is set).
  return [...ttsVoicesFor(lang), ...TTS_GEMINI_SPECS];
}

export type TtsProviderGroup = { provider: TtsProviderId; voices: string[] };

/**
 * Applies the user's voice choice (female / male) to one provider group.
 *
 * The group's voices become [role A = chosen gender, role B = the other gender] from
 * the voice tables (`ttsChoiceVoices`), so the choice decides the voice of a
 * single-speaker job and who leads a two-speaker dialog. `TTS_VOICE_<LANG>` therefore
 * only decides WHICH providers run and in which order; a provider without a table row
 * for the language keeps the operator's list. No choice → the group is returned as is
 * (listening game, tts-lab).
 */
export function groupForChoice(group: TtsProviderGroup, lang: string, choice?: TtsVoiceChoice): TtsProviderGroup {
  if (!choice) return group;
  const voices = ttsChoiceVoices(group.provider, lang, choice);
  return voices ? { provider: group.provider, voices } : group;
}

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
  synthesizeAll(parts: readonly TtsPart[], opts: TtsRunOpts): Promise<TtsRun>;
};

/* ══════════════════════════ zanjir ══════════════════════════ */

export type TtsChainDeps = {
  /** Provayder adapterlari (test: mock). Standart — azure → aisha → gemini. */
  providers?: readonly TtsProvider[];
  env?: NodeJS.ProcessEnv;
  /** `[tts:<lang>] …` — standart `console.log`. */
  log?: (line: string) => void;
  /** Clock seam (tests fake time); default = real `Date.now` / `setTimeout`. */
  clock?: TtsClock;
};

/** Time source of the chain: waits (429 backoff, pacing) and deadline checks go through it. */
export type TtsClock = { now(): number; sleep(ms: number): Promise<void> };

/**
 * `synthesizeAll` sozlamalari. `deadline` (epoch ms, ish muddati — audit
 * EXT-10): berilsa har urinish timeout'i qolgan vaqt bilan cheklanadi,
 * vaqt yetmasa `DeadlineError` otiladi va keyingi provayderda skript
 * BOSHIDAN qayta boshlanmaydi. Berilmasa — eski xatti-harakat.
 *
 * `voice` — the user's female / male choice (`groupForChoice`): role A speaks in it,
 * role B in the other gender's voice. Absent → the group's own voice list.
 */
export type TtsRunOpts = { lang: string; speed?: number; timeoutMs?: number; deadline?: number; voice?: TtsVoiceChoice };

const MAX_ATTEMPTS = 2;
/** Muddatdan oldin qoldiriladigan zaxira (MP3 yig'ish, yozish). */
const TTS_SAFETY_MS = 1_000;
/** Bundan kam vaqtda yangi urinish boshlanmaydi. */
export const TTS_MIN_ATTEMPT_MS = 3_000;
/** `Retry-After` shundan uzun bo'lsa shu provayder qayta urinilmaydi. */
export const TTS_RETRY_AFTER_CAP_MS = 5_000;
/** 429 RESOURCE_EXHAUSTED (per-minute quota): waits per chunk before giving up. */
export const TTS_RATE_RETRIES = 3;
/** Added to the server's `retryDelay` — it is the earliest moment, not a promise. */
export const TTS_RATE_RETRY_PAD_MS = 1_000;

const REAL_CLOCK: TtsClock = { now: () => Date.now(), sleep: (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()) };

const leftMs = (deadline: number | undefined, clock: TtsClock): number => (deadline === undefined ? Number.POSITIVE_INFINITY : deadline - TTS_SAFETY_MS - clock.now());

/** The user sees the daily-quota text, not the generic voice error. */
function finalError(e: unknown): unknown {
  return e instanceof TtsError && e.dailyQuota ? new UserFacingError(GEMINI_DAILY_QUOTA_MESSAGE) : e;
}

export function makeTtsChain(deps: TtsChainDeps = {}): TtsChain {
  const providers = deps.providers ?? [makeAzureTts(), makeAishaTts(), makeGeminiTts({ pace: geminiPacer })];
  const env = deps.env ?? process.env;
  const log = deps.log ?? ((line: string) => console.log(line));
  const clock = deps.clock ?? REAL_CLOCK;
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
        const started = clock.now();
        try {
          const run = await runGroup(provider, groupForChoice(group, lang, opts.voice), live, {
            lang,
            clock,
            log,
            ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
            ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
            ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
          });
          log(`[tts:${lang}] ${provider.id} → ok ${clock.now() - started} ms (${run.audios.length} bo'lak, ${run.chars} belgi)`);
          return run;
        } catch (e) {
          last = e;
          const err = e instanceof TtsError ? e : null;
          log(`[tts:${lang}] ${provider.id} → xato (${err?.status ?? "-"}) ${clock.now() - started} ms: ${e instanceof Error ? e.message : String(e)}`);
          // Vaqt tugadi — keyingi provayderda skriptni BOSHIDAN boshlash ma'nosiz.
          if (e instanceof DeadlineError) throw e;
        }
      }
      throw last instanceof Error ? finalError(last) : new TtsError(chain[0].group.provider, "sintez yiqildi", { retryable: false });
    },
  };
}

type GroupOpts = TtsRunOpts & { clock?: TtsClock; log?: (line: string) => void };

/**
 * Bitta provayder BUTUN ishni bajaradi.
 *
 * Bo'lak darajasidagi qayta urinish SHU YERDA (2 urinish): 429/5xx va
 * tarmoq uzilishi odatda bir necha yuz millisekundda tiklanadi, va
 * butun ishni boshqa provayderda qayta boshlashdan arzonroq.
 * `retryable:false` (kalit, 400, chegara) — darhol tashqariga, ya'ni
 * keyingi provayderga.
 */
async function runGroup(provider: TtsProvider, group: TtsProviderGroup, parts: readonly TtsPart[], opts: GroupOpts): Promise<TtsRun> {
  const voiceA = group.voices[0];
  const voiceB = group.voices[1] ?? group.voices[0];
  const clock = opts.clock ?? REAL_CLOCK;
  const log = opts.log ?? (() => undefined);
  const audios: TtsAudio[] = [];
  const usages: TtsUsage[] = [];
  let seconds = 0;
  let chars = 0;

  const limit = ttsChunkLimit(provider.id);
  for (const part of parts) {
    const text = String(part.text ?? "").trim();
    if (text.length > limit) {
      // Chunking belongs to the caller (`chunkText`); a longer part breaks the contract, and
      // silently cutting it would LOSE text.
      throw new TtsError(provider.id, `bo'lak ${text.length} belgi, chegara ${limit}`, { retryable: false });
    }
  }

  /*
   * Provider-aware packing (`pack.ts`): Azure/Aisha get one request per part as before; Gemini
   * (per-minute REQUEST quota) gets consecutive parts merged up to 2 400 chars, a two-voice
   * dialog as two-speaker requests.
   */
  const calls = packParts(parts, { provider: provider.id, multiSpeaker: provider.multiSpeaker === true, twoVoices: voiceA !== voiceB });
  const paceCtx = (): TtsPaceCtx => ({ left: () => leftMs(opts.deadline, clock), reserveMs: TTS_MIN_ATTEMPT_MS, sleep: (ms) => clock.sleep(ms), now: () => clock.now() });

  for (const part of calls) {
    const text = part.text;
    if (!text) continue;
    const voice = part.voice === 1 ? voiceB : voiceA;
    const synth: TtsSynthOpts = {
      lang: opts.lang,
      voice,
      ...(part.turns ? { turns: part.turns.map((t) => ({ voice: t.voice === 1 ? voiceB : voiceA, text: t.text })) } : {}),
      ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
      ...(part.pauseMs !== undefined ? { pauseMs: part.pauseMs } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    };

    let audio: TtsAudio | null = null;
    let attempt = 0;
    let rateRetries = 0;
    while (!audio) {
      // Deadline (audit EXT-10): the clock is checked before EVERY attempt.
      const left = leftMs(opts.deadline, clock);
      if (left < TTS_MIN_ATTEMPT_MS) throw new DeadlineError(`tts:${opts.lang}`, left);
      // Cross-process pacing (Gemini): a slot per request attempt; throws DeadlineError if none opens in time.
      if (provider.pace) await provider.pace(paceCtx());
      const afterPace = leftMs(opts.deadline, clock);
      if (afterPace < TTS_MIN_ATTEMPT_MS) throw new DeadlineError(`tts:${opts.lang}`, afterPace);
      const call: TtsSynthOpts = opts.deadline === undefined ? synth : { ...synth, timeoutMs: Math.min(opts.timeoutMs ?? TTS_LIMITS.callTimeoutMs, afterPace) };
      try {
        audio = await provider.synthesize(text, call);
      } catch (e) {
        const err = e instanceof TtsError ? e : null;

        // 429 RESOURCE_EXHAUSTED (Gemini): per-minute quota -> wait the server's retryDelay and retry,
        // bounded by TTS_RATE_RETRIES and the deadline; a per-DAY quota fails fast.
        if (err?.rateLimited) {
          if (err.dailyQuota) {
            log(`[tts:${opts.lang}] ${provider.id} → kunlik kvota tugadi (quotaId=${err.quotaId ?? "?"}), qayta urinilmaydi`);
            throw e;
          }
          if (rateRetries >= TTS_RATE_RETRIES) {
            log(`[tts:${opts.lang}] ${provider.id} → 429 (quotaId=${err.quotaId ?? "?"}), ${TTS_RATE_RETRIES} marta kutildi, taslim`);
            throw e;
          }
          const want = (err.retryAfterMs ?? 0) + TTS_RATE_RETRY_PAD_MS;
          const wait = Math.min(want, leftMs(opts.deadline, clock) - TTS_MIN_ATTEMPT_MS);
          if (wait <= 0) throw new DeadlineError(`tts:${opts.lang}`, leftMs(opts.deadline, clock));
          rateRetries++;
          log(`[tts:${opts.lang}] ${provider.id} → 429 (quotaId=${err.quotaId ?? "?"}), ${wait} ms kutiladi (${rateRetries}/${TTS_RATE_RETRIES})`);
          await clock.sleep(wait);
          continue;
        }

        const retryable = err ? err.retryable : true;
        if (!retryable || attempt >= MAX_ATTEMPTS - 1) throw e;
        // A long `Retry-After` (quota) is not waited for; the next provider takes over.
        if (err?.retryAfterMs !== undefined && err.retryAfterMs > TTS_RETRY_AFTER_CAP_MS) throw e;
        const wait = err?.retryAfterMs ?? backoffMs(attempt, 500);
        if (leftMs(opts.deadline, clock) - wait < TTS_MIN_ATTEMPT_MS) throw new DeadlineError(`tts:${opts.lang}`, leftMs(opts.deadline, clock));
        attempt++;
        await clock.sleep(wait);
      }
    }
    if (!audio) throw new TtsError(provider.id, "sintez natijasi bo'sh", { retryable: false });

    audios.push(audio);
    const usage: TtsUsage = {
      provider: provider.id,
      voice,
      chars: audio.chars || text.length,
      seconds: audio.seconds,
      ...(audio.model !== undefined ? { model: audio.model } : {}),
      ...(audio.inputTokens !== undefined ? { inputTokens: audio.inputTokens } : {}),
      ...(audio.outputTokens !== undefined ? { outputTokens: audio.outputTokens } : {}),
      // Priced with the rate the admin cost pages use (finance.soum_per_usd), carried so `TtsMeter` prices it the same.
      soumPerUsd: await currentSoumPerUsd(),
    };
    usages.push(usage);
    // Ish sarfi (EXT-11) MANBADA: keyingi provayderda boshidan boshlansa ham bu bo'lak to'langan.
    // Priced once from the price book (`ttsUsageCost`); an unpriced synthesis is recorded flagged, not as a real $0.
    const cost = ttsUsageCost(usage);
    recordTts(provider.id, usage.model ?? `${provider.id}:${voice}`, usage.chars, cost.usd, {
      priced: cost.priced,
      estimated: cost.estimated,
      textTokens: cost.textTokens,
      audioTokens: cost.audioTokens,
    });
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
 * `TtsProvider`. `voices` berilmasa ovozlar SHU provayder uchun til
 * jadvalidan olinadi (`tts-lab` aynan shunday ishlaydi); berilsa esa
 * jadvalga umuman qaralmaydi — shunda test provayder tanlovini emas,
 * o'z mantiqini sinaydi.
 */
export function chainOfProvider(provider: TtsProvider, voices?: string[], log?: (line: string) => void, clock: TtsClock = REAL_CLOCK): TtsChain {
  // Explicit `voices` win over everything (the test seam ignores the table AND the
  // user's choice); otherwise the table group, with the choice applied.
  const voicesFor = (lang: string, choice?: TtsVoiceChoice): string[] => {
    if (voices?.length) return voices;
    const group = ttsGroups(lang).find((g) => g.provider === provider.id);
    if (!group?.voices.length) return ["default"];
    return groupForChoice(group, lang, choice).voices;
  };
  return {
    configured: () => provider.configured(),
    providersFor: () => (provider.configured() ? [provider.id] : []),
    async synthesizeAll(parts, opts) {
      const lang = String(opts.lang ?? "uz").toLowerCase();
      if (!provider.configured()) throw new TtsError(provider.id, "Ovoz provayderi sozlanmagan", { retryable: false });
      const started = clock.now();
      let run: TtsRun;
      try {
        run = await runGroup(provider, { provider: provider.id, voices: voicesFor(lang, opts.voice) }, parts.filter((p) => String(p.text ?? "").trim()), {
          lang,
          clock,
          ...(log ? { log } : {}),
          ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
          ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
          ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
        });
      } catch (e) {
        throw finalError(e);
      }
      log?.(`[tts:${lang}] ${provider.id} → ok ${clock.now() - started} ms (${run.audios.length} bo'lak, ${run.chars} belgi)`);
      return run;
    },
  };
}

/** `TtsProvider` bo'lsa o'raydi, `TtsChain` bo'lsa o'zini qaytaradi. */
export function asTtsChain(x: TtsChain | TtsProvider): TtsChain {
  return "synthesizeAll" in x ? x : chainOfProvider(x);
}

export const ttsChain = makeTtsChain();

/**
 * Zanjirni BITTA-PARCHA provayder shaklida beradi — tinglash o'yini uchun.
 *
 * Nega kerak: `games/engine.ts` seam'i `TtsProvider` (`synthesize(text)`)
 * kutadi — u har so'z uchun alohida parcha sintez qiladi va har birini
 * o'z aktiviga yozadi (`putAsset`). Zanjir esa `synthesizeAll(parts)`
 * bilan ishlaydi. Bu adapter ikkalasini birlashtiradi: bitta matn →
 * bitta `TtsAudio`; provayder tanlovi, qayta urinish va yiqilganda
 * keyingisiga o'tish zanjirning o'zida qoladi.
 *
 * `voice` e'tiborsiz: ovoz til jadvalidan (`ttsGroups`) olinadi — shunda
 * tinglash va podkast bir xil ovozda chiqadi va `TTS_VOICE_*` bitta
 * joydan boshqariladi.
 */
export function providerOfChain(chain: TtsChain): TtsProvider {
  return {
    get id(): TtsProviderId {
      return chain.providersFor("uz")[0] ?? TTS_PROVIDERS[0];
    },
    configured: () => chain.configured(),
    async synthesize(text, opts) {
      const run = await chain.synthesizeAll([{ text }], {
        lang: opts.lang,
        ...(opts.speed !== undefined ? { speed: opts.speed } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      });
      const audio = run.audios[0];
      if (!audio) throw new TtsError(run.provider, "sintez natijasi bo'sh", { retryable: false });
      return audio;
    },
  };
}
