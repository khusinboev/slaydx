/**
 * LLM adapter umumiy tili (Maqola 2 / AUDIT-17, WP8).
 *
 * Har provayder (`gemini.ts`, `anthropic.ts`) shu tipga qarab yoziladi —
 * `chain.ts` va `llm-roles.ts` provayderga xos hech narsani BILMAYDI: JSON
 * rejimi, thinking, xatolar hammasi `Attempt` shakliga normallashtirilgan
 * bo'lib keladi.
 */

import { log } from "../../server/log";
import type { FailureKind } from "./failure";

/** `LLM_<ROL>` env qiymatidagi bitta yozuv: `"anthropic:claude-sonnet-5"`. */
export type ProviderId = "gemini" | "anthropic";

const PROVIDER_IDS: readonly ProviderId[] = ["gemini", "anthropic"];

export type AdapterOpts = {
  json?: boolean;
  maxTokens: number;
  timeoutMs: number;
  /** Faqat Gemini o'qiydi (fixed byudjet, token). Boshqa adapterlar e'tiborsiz qoldiradi. */
  thinking?: number;
};

export type Usage = { inputTokens: number; outputTokens: number };

/**
 * Bitta urinish natijasi.
 *
 * `retryable` — `chain.ts` shu maydonga qarab qaror qiladi: true bo'lsa
 * eksponensial orqada eksponensial kutib qayta uradi (429/5xx/tarmoq),
 * false bo'lsa DARHOL keyingi zanjir a'zosiga o'tadi (400, refusal,
 * Anthropic oylik sarf chegarasi). `retryAfterMs` — provayder `Retry-After`
 * sarlavhasini yuborsa, eksponensial kutish o'rniga shu qiymat ishlatiladi
 * (fixed maydonlar ro'yxatidan tashqari, lekin ixtiyoriy — yo'q bo'lsa
 * chain o'zi eksponensial hisoblaydi).
 */
export type Attempt =
  // `finishReason` — provider's raw stop reason (Gemini `finishReason`, Anthropic `stop_reason`).
  | { ok: true; text: string; usage: Usage; finishReason?: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      status?: number;
      retryAfterMs?: number;
      /** Adapter's own classification (empty/safety/...); the chain classifies from status/text when absent. */
      kind?: FailureKind;
      finishReason?: string;
      /** Tokens of a failed but PAID attempt (e.g. Gemini spent them on thinking and returned no text). */
      usage?: Usage;
    };

export type ProviderAdapter = {
  id: ProviderId;
  complete(model: string, system: string, user: string, opts: AdapterOpts): Promise<Attempt>;
};

export type RoleSpec = { provider: ProviderId; model: string };

/** Unknown provider ids already reported by `parseRoleSpec` (one warn line per id per process, not per LLM call). */
const warnedUnknown = new Set<string>();

/** Tests: forget which unknown provider ids were already warned about. */
export function resetRoleSpecWarnings(): void {
  warnedUnknown.clear();
}

/**
 * `"anthropic:claude-sonnet-5,gemini:gemini-3.7-flash"` → zaxira zanjiri
 * tartibda.
 *
 *  - Bo'sh (`undefined`/`""`) yoki SHAKLI buzuq yozuv (`provider:model`
 *    ko'rinishi yo'q: `:` yo'q, provayder yoki model bo'sh) — BUTUN natija
 *    `[]`: chaqiruvchi (`llm-roles.ts`) buni "env berilmagan" bilan bir xil
 *    ko'radi va standart yo'lga (Gemini) tushadi — yarim buzuq zanjir bilan
 *    jimgina ishlashdan ko'ra shov-shuvsiz standart xatti-harakat xavfsizroq.
 *  - Shakli to'g'ri, lekin provayder ro'yxatda YO'Q (olib tashlangan
 *    provayder qoldiq env qiymatida: `anthropic:claude-sonnet-5,removed:x`)
 *    — faqat o'sha yozuv o'tkazib yuboriladi (har noma'lum id uchun BITTA
 *    ogohlantirish), qolgan to'g'ri yozuvlar saqlanadi. Aks holda bitta
 *    eski yozuv butun zanjirni, masalan Anthropic baholovchini, jimgina
 *    tashlab yuborardi.
 */
export function parseRoleSpec(spec: string | undefined | null): RoleSpec[] {
  if (!spec || !spec.trim()) return [];
  const out: RoleSpec[] = [];
  const unknown: string[] = [];
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const i = part.indexOf(":");
    if (i <= 0) return [];
    const provider = part.slice(0, i).trim();
    const model = part.slice(i + 1).trim();
    if (!provider || !model) return [];
    if (!PROVIDER_IDS.includes(provider as ProviderId)) {
      unknown.push(provider);
      continue;
    }
    out.push({ provider: provider as ProviderId, model });
  }
  for (const id of new Set(unknown)) {
    if (warnedUnknown.has(id)) continue;
    warnedUnknown.add(id);
    log("warn", `[llm] LLM_<ROL> env: noma'lum provayder "${id}" o'tkazib yuborildi (qo'llab-quvvatlanadi: ${PROVIDER_IDS.join(", ")})`);
  }
  return out;
}
