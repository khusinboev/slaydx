/**
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
function pickRow(rows: PricingRow[], at: Date): PricingRow | undefined {
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
