import type { Tone } from "@/components/admin/ui";
import { fmtNumber, fmtSoum, fmtUsd } from "@/lib/admin-format";
import type { ProviderBilling, ProviderItem, ProviderKind, ProviderNeed, ProviderUsage, RouteEntry, RouteItem, UsageTotals, Verdict } from "@/lib/admin-api/providers";

/** Uzbek names of the provider kinds. */
export const KIND_LABEL: Readonly<Record<ProviderKind, string>> = {
  llm: "Matn (LLM)",
  image: "Rasm",
  tts: "Ovoz",
  video: "Video",
  research: "Manbalar",
};

/** What a change needs to reach the other process (web <-> worker). */
export function propagationNote(sec: number): string {
  return `O'zgarish boshqa jarayonlarga (veb va worker) ${sec} soniyagacha yetib boradi.`;
}

export type KeyState = { tone: "success" | "info" | "warning" | "neutral"; label: string };

/**
 * The key line: «Bazada …a1B2» (stored, masked), «Env» (only the environment variable), «Yo'q».
 * A stored key that cannot be decrypted is called out: the environment applies until it is entered again.
 */
export function keyState(item: ProviderItem): KeyState {
  if (item.hasDbKey && item.unreadable) {
    return { tone: "warning", label: item.envPresent ? "Bazadagi kalit o'qilmaydi · Env ishlatiladi" : "Bazadagi kalit o'qilmaydi" };
  }
  if (item.hasDbKey) return { tone: "success", label: item.keyHint ? `Bazada ${item.keyHint}` : "Bazada" };
  if (item.envPresent) return { tone: "info", label: "Serverda (env)" };
  return { tone: "neutral", label: "Yo'q" };
}

/* ───────────────────────────── labels ───────────────────────────── */

export const BILLING: Readonly<Record<ProviderBilling, { label: string; tone: Tone; hint: string }>> = {
  paid: { label: "To'lovli", tone: "warning", hint: "Har so'rov uchun pul to'lanadi" },
  free: { label: "Bepul", tone: "success", hint: "Pul to'lanmaydi (so'rovlar soni cheklangan bo'lishi mumkin)" },
  "free-tier": { label: "Bepul limit bilan", tone: "info", hint: "Oylik bepul limit bor, undan keyin to'lanadi" },
};

export const NEED: Readonly<Record<ProviderNeed, { label: string; tone: Tone }>> = {
  required: { label: "Majburiy", tone: "danger" },
  recommended: { label: "Tavsiya etiladi", tone: "primary" },
  optional: { label: "Ixtiyoriy", tone: "neutral" },
};

export const VERDICT_TONE: Readonly<Record<Verdict, Tone>> = { ok: "success", single: "warning", missing: "danger", off: "neutral" };

/** Usage kinds as the spend rows name them, plus `requests` for the free providers' call counters. */
export const USAGE_KIND_LABEL: Readonly<Record<string, string>> = {
  llm: "Matn",
  image: "Rasm",
  tts: "Ovoz",
  grounding: "Internet qidiruvi",
  video: "Video",
  requests: "So'rovlar",
  unknown: "Boshqa",
};

export function usageKindLabel(kind: string): string {
  return USAGE_KIND_LABEL[kind] ?? kind;
}

const UNIT_LABEL: Readonly<Record<string, string>> = { image: "ta rasm", tts: "ta belgi", video: "soniya", grounding: "ta qidiruv" };

export const PERIODS = [
  { value: "today", label: "Bugun" },
  { value: "d7", label: "7 kun" },
  { value: "d30", label: "30 kun" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];

/* ───────────────────────────── numbers ───────────────────────────── */

/** `1 234 567` -> `1,2 mln`; below 10 000 the full number. */
export function compact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${fmtNumber(n / 1_000_000, { digits: 1 })} mln`;
  if (abs >= 10_000) return `${fmtNumber(n / 1_000, { digits: 1 })} ming`;
  return fmtNumber(n);
}

/** `$12,34 · 157 000 so'm`. */
export function moneyText(usd: number, soumPerUsd: number): string {
  return `${fmtUsd(usd)} · ${fmtSoum(Math.round(usd * soumPerUsd))}`;
}

export type UsageLine = { primary: string; secondary: string[] };

/** The headline figure and the details of one period: money for paid providers, request counts for free ones. */
export function usageLine(item: ProviderItem, t: UsageTotals, soumPerUsd: number): UsageLine {
  const free = item.billing === "free";
  const secondary: string[] = [];
  if (!free) secondary.push(`${fmtNumber(t.calls)} ta so'rov`);
  if (t.inputTokens + t.outputTokens > 0) secondary.push(`${compact(t.inputTokens)} kirish / ${compact(t.outputTokens)} chiqish token`);
  const kind = item.usage.kinds.find((k) => k.units > 0)?.kind;
  if (t.units > 0 && kind && UNIT_LABEL[kind]) secondary.push(`${compact(t.units)} ${UNIT_LABEL[kind]}`);
  if (t.errors !== null && t.errors > 0) secondary.push(`${fmtNumber(t.errors)} ta xato`);
  return { primary: free ? `${fmtNumber(t.calls)} ta so'rov` : moneyText(t.usd, soumPerUsd), secondary };
}

export function totalsOf(usage: ProviderUsage, period: Period): UsageTotals {
  return period === "today" ? usage.today : period === "d7" ? usage.d7 : usage.d30;
}

/* ───────────────────────────── status ───────────────────────────── */

export type ProviderStatus = { tone: Tone; label: string; hint?: string };

/** One honest status per provider: what it can do right now and, when it cannot, why. */
export function providerStatus(item: ProviderItem): ProviderStatus {
  if (!item.enabled) return { tone: "warning", label: "O'chirilgan", hint: "Kalit bo'lsa ham ishlatilmaydi" };
  if (item.hasDbKey && item.unreadable && !item.envPresent) return { tone: "danger", label: "Kalit o'qilmaydi", hint: "Kalitni qayta kiriting" };
  if (item.breaker?.state === "open") return { tone: "danger", label: "Vaqtincha to'xtagan", hint: "Kvota yoki xato tufayli so'rovlar vaqtincha o'tkazib yuborilmoqda" };
  if (item.usable) return { tone: "success", label: "Ishlayapti" };
  if (item.keySource !== "none") return { tone: "warning", label: "To'liq sozlanmagan", hint: "Kalit bor, lekin serverda yana bir sozlama (masalan, region) yo'q" };
  return { tone: "neutral", label: "Kalit yo'q", hint: "Kalit kiritilmaguncha ishlamaydi" };
}

/** Does the provider need the owner's attention? (a required/recommended one that is down, a stuck breaker, an unreadable key). */
export function providerNeedsAttention(item: ProviderItem): boolean {
  if (item.hasDbKey && item.unreadable) return true;
  if (item.breaker?.state === "open") return true;
  return false;
}

/* ───────────────────────────── routes ───────────────────────────── */

/** `Gemini · gemini-3.7-flash → Claude · claude-sonnet-5` (for confirmations). */
export function routeText(entries: ReadonlyArray<RouteEntry & { label?: string }>): string {
  return entries.map((e) => (e.model ? `${e.label ?? e.provider} · ${e.model}` : (e.label ?? e.provider))).join(" → ");
}

export function sameEntries(a: ReadonlyArray<RouteEntry>, b: ReadonlyArray<RouteEntry>): boolean {
  return a.length === b.length && a.every((e, i) => e.provider === b[i].provider && (e.model ?? null) === (b[i].model ?? null));
}

/** Price text of a model option: tokens for text models, a picture for image models. */
export function modelPrice(o: RouteItem["models"][number]): string {
  if (o.perImageUsd !== null) return `${fmtUsd(o.perImageUsd)} / rasm`;
  if (o.inUsdPerM !== null && o.outUsdPerM !== null) return `${fmtUsd(o.inUsdPerM)} / ${fmtUsd(o.outUsdPerM)} (1M token)`;
  return "";
}

export const SOURCE_LABEL = { db: "Admin tanlovi", env: "Server sozlamasi (env)", default: "Standart" } as const;
