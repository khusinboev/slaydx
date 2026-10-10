/**
 * THE PRICE BOOK: every price the cost telemetry (`job-cost.ts`, `ai_usage`) uses
 * lives in this one file — LLM tokens (`PRICING`), images (`IMAGE_PRICES`,
 * `FAL_USD_PER_MEGAPIXEL`), Google Search grounding (`GROUNDING_USD`) and TTS
 * (`TTS_PRICING`). A paid kind with no row here is never priced at a silent 0: the
 * recorder marks the part `priced: false` (or `estimated` for a documented default)
 * and `admin-cost.ts costCaveats` lists it. Verify new numbers against
 * `scripts/cost-reconcile.mts` (Google AI Studio billing export).
 *
 * LLM narx jadvali (Maqola 2 / AUDIT-17, WP8).
 *
 * Sanaga bog'liq: ba'zi model narxlari vaqt o'tishi bilan o'zgaradi
 * (masalan Gemini 3.7 Flash 2027-01-01 dan qimmatlashadi — provayder
 * e'lon qilgan reja). Shuning uchun bitta model uchun bir nechta qator
 * bo'lishi mumkin, har biri `from` bilan — `costUsd` CHAQIRUV SANASIGA
 * mos qatorni tanlaydi (`generations.cost_json` haqiqiy marjani
 * ko'rsatishi uchun, `scripts/cost-report.mts`).
 *
 * `model` — PREFIX bo'yicha mos keladi (`"gemini-3.7-flash-001"` ham
 * `"gemini-3.7-flash"` qatoriga tushadi): provayder ba'zan versiya
 * qo'shimchasi bilan model nomini qaytarishi mumkin.
 */

import type { ProviderId } from "./llm/types";

export type PricingRow = {
  provider: ProviderId;
  /** Model nomi PREFIKSI (eng uzuni ustunlik qiladi). */
  model: string;
  inUsdPerM: number;
  outUsdPerM: number;
  /** `"YYYY-MM-DD"` — shu sanadan boshlab amal qiladi. Yo'q bo'lsa — boshidan. */
  from?: string;
};

/** OpenRouter — asosiy model narxiga ustama (OpenRouter komissiyasi). */
export const OPENROUTER_SURCHARGE = 1.055;

export const PRICING: PricingRow[] = [
  // ── Gemini (yozuvchi/tadqiqot/tez) ──────────────────────────────
  { provider: "gemini", model: "gemini-3.7-flash", inUsdPerM: 0.75, outUsdPerM: 3.75 },
  { provider: "gemini", model: "gemini-3.7-flash", inUsdPerM: 1.5, outUsdPerM: 7.5, from: "2027-01-01" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", inUsdPerM: 0.3, outUsdPerM: 2.5 },
  { provider: "gemini", model: "gemini-3.1-pro", inUsdPerM: 2, outUsdPerM: 12 },

  // ── Anthropic (baholovchi + zaxira yozuvchi) ────────────────────
  { provider: "anthropic", model: "claude-sonnet-5", inUsdPerM: 2, outUsdPerM: 10 },
  { provider: "anthropic", model: "claude-opus-5", inUsdPerM: 5, outUsdPerM: 25 },
  { provider: "anthropic", model: "claude-haiku-4-5", inUsdPerM: 1, outUsdPerM: 5 },

  // ── OpenAI (OpenRouter orqali; to'g'ridan-to'g'ri sotib olinmaydi) ─
  { provider: "openai", model: "gpt-5.6-terra", inUsdPerM: 2, outUsdPerM: 12 },
  { provider: "openai", model: "gpt-5.6-luna", inUsdPerM: 0.2, outUsdPerM: 1.2 },

  // ── xAI (faqat zaxira yozuvchi) ──────────────────────────────────
  { provider: "xai", model: "grok-4.3", inUsdPerM: 1.25, outUsdPerM: 2.5 },
];

/** Bitta chaqiruv sarfi — `CostMeter`/`generations.cost_json` shakli. */
export type UsageLike = { provider: string; model: string; inputTokens: number; outputTokens: number };

/**
 * Model nomiga mos qatorlar — eng UZUN prefiks ustunlik qiladi (masalan
 * `"gemini-3.7-flash-lite"` so'ralsa `"gemini-3.5-flash-lite"` bilan
 * ADASHTIRILMASIN — bu yerda hech qachon bo'lmaydi, lekin printsip
 * umumiy: eng aniq mos keladigan qator tanlanadi).
 */
function rowsForModel(model: string): PricingRow[] {
  const matches = PRICING.filter((r) => model.startsWith(r.model));
  if (!matches.length) return [];
  const maxLen = Math.max(...matches.map((r) => r.model.length));
  return matches.filter((r) => r.model.length === maxLen);
}

/**
 * Bir nechta sanaviy qatordan CHAQIRUV VAQTIGA mosini tanlaydi: eng
 * yangi `from <= at` qator; hech biri hali kelmagan bo'lsa (hammasi
 * kelajakda) — `from`siz asosiy narxga tushadi.
 */
function pickRow<T extends { from?: string }>(rows: T[], at: Date): T | undefined {
  if (!rows.length) return undefined;
  const applicable = rows
    .filter((r) => !r.from || new Date(r.from).getTime() <= at.getTime())
    .sort((a, b) => (b.from ?? "").localeCompare(a.from ?? ""));
  return applicable[0] ?? rows.find((r) => !r.from);
}

/**
 * Bitta chaqiruv narxi (USD). Noma'lum model — 0 va jurnal
 * ogohlantirish (uydirma narx bilan marjani noto'g'ri ko'rsatishdan
 * ko'ra, "hisoblanmadi" deb 0 ko'rsatish xavfsizroq).
 *
 * `provider === "openrouter"` — asosiy model narxiga `OPENROUTER_SURCHARGE`
 * qo'llanadi (OpenRouter narxi = manba model narxi × 1.055 ustama).
 */
export function costUsd(usage: UsageLike, at: Date = new Date()): number {
  const rows = rowsForModel(usage.model);
  const row = pickRow(rows, at);
  if (!row) {
    console.warn(`[llm-pricing] noma'lum model: ${usage.provider}:${usage.model} — narx 0 deb hisoblanadi`);
    return 0;
  }
  const raw = (usage.inputTokens / 1_000_000) * row.inUsdPerM + (usage.outputTokens / 1_000_000) * row.outUsdPerM;
  return usage.provider === "openrouter" ? raw * OPENROUTER_SURCHARGE : raw;
}

/** `SOUM_PER_USD` env (standart 12 700 — `scripts/cost-report.mts` bilan bir xil). */
export function soumPerUsd(): number {
  const v = Number(process.env.SOUM_PER_USD);
  return Number.isFinite(v) && v > 0 ? v : 12_700;
}

/** `costUsd` so'mda. */
export function costSoum(usage: UsageLike, at: Date = new Date()): number {
  return costUsd(usage, at) * soumPerUsd();
}

/* ══════════════════ Images, grounding (moved here from job-cost.ts) ══════════════════ */

/**
 * Grounding (Google qidiruvi) — bitta QIDIRUV narxi, USD (Gemini 3 qidiruv bo'yicha to'laydi).
 * Oyiga 5 000 tasi bepul, keyin $14/1 000 (`slide-research.ts`); bepul
 * kvota butun hisob bo'yicha, ish bo'yicha emas — telemetriya ehtiyotkor
 * (yuqori) chegarani yozadi.
 */
export const GROUNDING_USD = 0.014;

/**
 * Gemini rasm modeli → bitta rasm narxi (USD, 1K). Model nomi PREFIKS
 * bo'yicha (eng uzuni); jadvalda yo'q model — standart lite narxi va
 * jurnal ogohlantirishi (`.env.example`: lite $0.034, flash $0.067).
 */
export const IMAGE_PRICES: Record<string, number> = {
  "gemini-3.1-flash-lite-image": 0.034,
  "gemini-3.1-flash-image": 0.067,
};
export const IMAGE_DEFAULT_USD = 0.034;

/** The documented price of a Gemini image model, or `null` for a model missing from `IMAGE_PRICES`. */
export function imagePriceOf(model: string): number | null {
  const hit = Object.keys(IMAGE_PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? IMAGE_PRICES[hit] : null;
}

/** Price of one image; a model missing from the table gets the lite default (callers flag it `estimated`). */
export function imageUnitUsd(model: string): number {
  const known = imagePriceOf(model);
  if (known !== null) return known;
  console.warn(`[job-cost] noma'lum rasm modeli: ${model} — ${IMAGE_DEFAULT_USD} USD deb hisoblanadi`);
  return IMAGE_DEFAULT_USD;
}

/**
 * fal.ai price per started megapixel, by exact model id. Only models with a
 * documented price are listed: docs/research/provider-pricing.md §3 records
 * `fal-ai/flux/schnell` at $0.003 per megapixel (checked 2026-09-20) and no
 * price for the other FLUX variants. Unlisted models are recorded with their
 * image count, usd 0 and `priced: false`, so reports can show the gap.
 */
export const FAL_USD_PER_MEGAPIXEL: Record<string, number> = {
  "fal-ai/flux/schnell": 0.003,
};

/**
 * USD for one fal image of `width`×`height`, or `null` when the model has no
 * documented price. The megapixel count is rounded UP (an upper bound, like
 * `GROUNDING_USD`): fal bills whole megapixels.
 */
export function falImageUnitUsd(model: string, width: number, height: number): number | null {
  const perMp = FAL_USD_PER_MEGAPIXEL[model];
  if (perMp === undefined) return null;
  const mp = Math.max(1, Math.ceil((Math.max(0, width) * Math.max(0, height)) / 1_000_000));
  return mp * perMp;
}

/* ══════════════════════════════ TTS ══════════════════════════════ */

/**
 * One TTS price row. Two billing shapes:
 *   - `tokens`: Gemini TTS bills text-input tokens and audio-output tokens; rows are
 *     keyed by model-name PREFIX (longest wins, like the LLM table);
 *   - `chars`: Azure / Google / ElevenLabs / Aisha bill by character, so the row is
 *     keyed by provider alone. Aisha quotes so'm, converted by `soumPerUsd()`.
 * `from` works as in `PricingRow` (`"YYYY-MM-DD"`, newest applicable row wins).
 */
export type TtsPriceRow =
  | { billing: "tokens"; provider: string; model: string; inUsdPerM: number; outUsdPerM: number; from?: string; note: string }
  | { billing: "chars"; provider: string; usdPerMChars: number; from?: string; note: string }
  | { billing: "chars"; provider: string; soumPerChar: number; from?: string; note: string };

/**
 * Sources: Google AI pricing page for the Gemini TTS previews (flash $0.50/M text-in,
 * $10/M audio-out; pro $1/$20), `docs/research/tts.md` §2 for the per-character
 * providers, and a production probe on 2026-10-10 (15 s of Uzbek speech = 370 audio
 * tokens + 70 text tokens on flash ≈ $0.0037; a 2-minute podcast ≈ $0.03).
 * `gemini-3.1-flash-tts-preview` has no published price yet: it is deliberately
 * absent, so using it is flagged «unpriced» instead of guessed.
 */
export const TTS_PRICING: readonly TtsPriceRow[] = [
  { billing: "tokens", provider: "gemini", model: "gemini-2.5-flash-preview-tts", inUsdPerM: 0.5, outUsdPerM: 10, note: "Gemini 2.5 Flash TTS preview — $0.50/M text-in + $10/M audio-out" },
  { billing: "tokens", provider: "gemini", model: "gemini-2.5-pro-preview-tts", inUsdPerM: 1, outUsdPerM: 20, note: "Gemini 2.5 Pro TTS preview — $1/M text-in + $20/M audio-out" },
  { billing: "chars", provider: "azure", usdPerMChars: 16, note: "Azure Neural TTS — $16/1M chars" },
  { billing: "chars", provider: "google", usdPerMChars: 16, note: "Google Cloud TTS Neural2 — $16/1M chars" },
  { billing: "chars", provider: "elevenlabs", usdPerMChars: 165, note: "ElevenLabs Creator — ≈$165/1M chars" },
  { billing: "chars", provider: "aisha", soumPerChar: 1, note: "Aisha AI — 1 so'm/char (converted with SOUM_PER_USD)" },
];

/** Gemini TTS audio output: 370 tokens per 15 s in the 2026-10-10 probe ≈ 25 tokens/s (Google documents 25). */
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 25;
/** Rough Uzbek text tokens per character, only used when the API reports no `promptTokenCount` (text-in is ~1% of the cost). */
const TEXT_CHARS_PER_TOKEN = 3;

/** What one TTS synthesis consumed. `inputTokens` = text tokens, `outputTokens` = audio tokens (Gemini `usageMetadata`). */
export type TtsUsageLike = {
  provider: string;
  /** Provider model id; only token-billed providers (Gemini) are priced by it. */
  model?: string;
  chars: number;
  /** Length of the audio produced — only used to estimate audio tokens when the API reported none. */
  seconds?: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type TtsCost = {
  usd: number;
  /** `false`: no price row (unknown provider/model) or nothing to bill on — usd is 0 and must be flagged, never trusted. */
  priced: boolean;
  /** Token counts were estimated from the audio length / text size because the API reported none. */
  estimated: boolean;
  /** Token counts that were billed on (reported or estimated); `0` for per-character providers. */
  textTokens: number;
  audioTokens: number;
};

const positive = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function ttsRowsFor(provider: string, model: string | undefined): TtsPriceRow[] {
  const rows = TTS_PRICING.filter((r) => r.provider === provider);
  const perChar = rows.filter((r) => r.billing === "chars");
  if (perChar.length) return perChar;
  // Token-billed: longest model-name prefix wins; a `models/` prefix is tolerated.
  const name = String(model ?? "").trim().replace(/^models\//, "");
  const hits = rows.filter((r) => r.billing === "tokens" && name.startsWith(r.model));
  if (!hits.length) return [];
  const longest = Math.max(...hits.map((r) => (r.billing === "tokens" ? r.model.length : 0)));
  return hits.filter((r) => r.billing === "tokens" && r.model.length === longest);
}

/**
 * USD of one TTS synthesis at the price valid on `at`. An unknown provider or model —
 * or a token-billed call with nothing to bill on (no usage and no audio length) — is
 * `{ usd: 0, priced: false }`: the recorder keeps the part but flags it, so it can
 * never pass as a real $0 (docs/admin/02-plan.md §17.3).
 */
export function ttsCost(u: TtsUsageLike, at: Date = new Date()): TtsCost {
  const row = pickRow(ttsRowsFor(u.provider, u.model), at);
  const unpriced: TtsCost = { usd: 0, priced: false, estimated: false, textTokens: 0, audioTokens: 0 };
  if (!row) {
    console.warn(`[llm-pricing] noma'lum TTS: ${u.provider}:${u.model ?? "-"} — narxlanmagan deb belgilanadi`);
    return unpriced;
  }
  const chars = Math.max(0, u.chars || 0);
  if (row.billing === "chars") {
    const perM = "usdPerMChars" in row ? row.usdPerMChars : (row.soumPerChar * 1_000_000) / soumPerUsd();
    return { usd: Number(((perM * chars) / 1_000_000).toFixed(6)), priced: true, estimated: false, textTokens: 0, audioTokens: 0 };
  }
  let audioTokens = positive(u.outputTokens);
  let textTokens = positive(u.inputTokens);
  let estimated = false;
  if (!audioTokens) {
    const seconds = positive(u.seconds);
    if (!seconds) return unpriced;
    audioTokens = Math.round(seconds * GEMINI_AUDIO_TOKENS_PER_SECOND);
    estimated = true;
  }
  if (!textTokens) {
    textTokens = Math.ceil(chars / TEXT_CHARS_PER_TOKEN);
    estimated = true;
  }
  const usd = (textTokens / 1_000_000) * row.inUsdPerM + (audioTokens / 1_000_000) * row.outUsdPerM;
  return { usd: Number(usd.toFixed(6)), priced: true, estimated, textTokens, audioTokens };
}
