import type { LedgerEntry, PaymentOrder } from "@/lib/api-client";
import { formatPoints } from "@/lib/referral";
import { TOOL_BY_ID } from "@/lib/tools";
import { groupDigits } from "@/lib/format";
import { FIRST_TOPUP_MAX_POINTS, FIRST_TOPUP_MIN_SOUM, FIRST_TOPUP_NOTE_PREFIX, FIRST_TOPUP_PERCENT } from "@/lib/topup-bonus";

/** What a top-up buys (the copy `PurchasePage` has shown since AUDIT-12). */
export const TOPUP_FEATURES = [
  "Har bir hujjat narxi yaratishdan oldin ko'rsatiladi",
  "Hujjat yaratilmasa, pul to'liq qaytariladi",
  "Click yoki Payme orqali xavfsiz to'lov",
  "Balans muddatsiz saqlanadi",
] as const;

/**
 * The first top-up bonus hint on the top-up area while `GET /api/users/me` says
 * `firstTopupEligible` (docs/bonus/PLAN.md «Bonus 2»; numbers from `lib/topup-bonus.ts`).
 */
export function firstTopupHint(): string {
  return `Birinchi to‘ldirishga +${FIRST_TOPUP_PERCENT}% bonus (${groupDigits(FIRST_TOPUP_MIN_SOUM)} so‘mdan, ko‘pi ${groupDigits(FIRST_TOPUP_MAX_POINTS)} so‘m)`;
}

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
/** Tashkent is UTC+5 all year (no DST) — by hand, like `formatJoinDate`: ICU data differs between Node and browsers. */
const TASHKENT_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

/**
 * A ledger / order time as people say it: «Bugun, 10:24», «Kecha, 21:05»,
 * «5-oktabr, 14:02», another year «5-oktabr 2025».
 */
export function formatWhen(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t + TASHKENT_MS);
  const today = Math.floor((now + TASHKENT_MS) / DAY_MS);
  const day = Math.floor((t + TASHKENT_MS) / DAY_MS);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  if (day === today) return `Bugun, ${hm}`;
  if (day === today - 1) return `Kecha, ${hm}`;
  const date = `${d.getUTCDate()}-${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === new Date(now + TASHKENT_MS).getUTCFullYear() ? `${date}, ${hm}` : `${date} ${d.getUTCFullYear()}`;
}

export type LedgerRow = {
  id: string;
  kind: string;
  /** Main line: what happened. */
  title: string;
  /** Second line: detail (may be empty) and the time. */
  meta: string;
  /** «+20 000», «−3 000», «0» (NBSP groups, a real minus sign). */
  amount: string;
  /** Bonus points are «ball»; everything else moves tanga. */
  unit: "tanga" | "ball";
  tone: "in" | "out" | "zero";
};

const PROVIDERS: Record<string, string> = { click: "Click", payme: "Payme" };

/** `<toolId>: <topic>` — the note `jobs.ts` writes on a charge. */
function chargeTitle(note: string): string | null {
  const m = /^([a-z0-9-]+):\s*([\s\S]*)$/.exec(note);
  if (!m) return null;
  const tool = (TOOL_BY_ID as Record<string, { title: string } | undefined>)[m[1]!];
  if (!tool) return null;
  const topic = m[2]!.trim();
  return topic ? `${tool.title}: ${topic}` : tool.title;
}

/**
 * Title + detail of one ledger entry, per `transactions.kind`
 * (`lib/server/admin-payments.ts TRANSACTION_KINDS`): the server note when it
 * reads well, a plain Uzbek label when it is technical or missing.
 */
export function describeEntry(e: Pick<LedgerEntry, "kind" | "note">): { title: string; detail: string } {
  const note = (e.note ?? "").trim();
  switch (e.kind) {
    case "charge":
      return { title: chargeTitle(note) ?? (note || "Hujjat uchun to'lov"), detail: "" };
    case "refund":
      return { title: "Pul qaytarildi", detail: note };
    case "topup": {
      const provider = PROVIDERS[/^(\w+) orqali/i.exec(note)?.[1]?.toLowerCase() ?? ""];
      return provider ? { title: `To'ldirish · ${provider}`, detail: "" } : { title: "Balans to'ldirildi", detail: note };
    }
    case "bonus": {
      const friend = /^Do'st taklifi:\s*(.+)$/.exec(note)?.[1];
      if (friend) return { title: `Taklif bonusi · ${friend}`, detail: "" };
      // First top-up bonus (`lib/topup-bonus.ts FIRST_TOPUP_NOTE`, written by `settleOrder`).
      if (note.startsWith(FIRST_TOPUP_NOTE_PREFIX)) return { title: FIRST_TOPUP_NOTE_PREFIX, detail: "" };
      // Channel bonus notes (lib/server/bonus-channels.ts JOIN_NOTE_PREFIX / STAY_NOTE_PREFIX).
      const join = /^Kanal obunasi:\s*(.+)$/.exec(note)?.[1];
      if (join) return { title: `Kanal obunasi bonusi · ${join}`, detail: "" };
      const stay = /^Kanalda qolish bonusi:\s*(.+)$/.exec(note)?.[1];
      if (stay) return { title: `Kanalda qolish bonusi · ${stay}`, detail: "" };
      return { title: note || "Bonus ball", detail: "" };
    }
    case "subscription":
      return { title: "To'lov balansga tushdi", detail: "Eski buyurtma" };
    case "admin_credit":
    case "admin_debit":
      return { title: "Ma'muriy tuzatish", detail: note && note !== "Ma'muriy tuzatish" ? note : "" };
    case "quota_merge":
      return { title: "Eski hisob qoldig'i balansga o'tkazildi", detail: "" };
    default:
      return { title: note || "Hisob harakati", detail: "" };
  }
}

export function ledgerRow(e: LedgerEntry, now: number = Date.now()): LedgerRow {
  const { title, detail } = describeEntry(e);
  const n = Math.round(Number.isFinite(e.amount) ? e.amount : 0);
  const body = formatPoints(Math.abs(n));
  return {
    id: e.id,
    kind: e.kind,
    title,
    meta: [formatWhen(e.createdAt, now), detail].filter(Boolean).join(" · "),
    amount: n > 0 ? `+${body}` : n < 0 ? `−${body}` : body,
    unit: e.kind === "bonus" ? "ball" : "tanga",
    tone: n > 0 ? "in" : n < 0 ? "out" : "zero",
  };
}

export function orderStateLabel(state: PaymentOrder["state"]): string {
  return state === "paid" ? "To'landi" : state === "cancelled" ? "Bekor" : "Kutilmoqda";
}

export function providerLabel(provider: string): string {
  return PROVIDERS[provider] ?? provider;
}
