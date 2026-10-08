import { fmtNumber } from "@/lib/admin-format";
import type { BonusChannel, BotAdminStatus } from "@/lib/admin-api/bonus";

/**
 * Pure helpers of the «Bonus kanallar» page (docs/bonus/PLAN.md K2). The bounds mirror
 * `lib/server/admin-bonus-channels.ts`; the server validates again and is the authority.
 */

export const MAX_BONUS = 1_000_000;
export const MAX_STAY_DAYS = 365;
export const MAX_SORT = 1_000_000;
export const MAX_TITLE = 128;

/** Owner decisions B-Q2: the news channel pays 2 000 once; an extra channel 1 000 + 2 000 after 7 days. */
export const PRESETS = {
  news: { label: "Yangiliklar kanali", joinBonus: 2_000, stayBonus: 0, stayDays: 7, hint: "Yangiliklar kanali: 2 000, qo'shimcha yo'q" },
  extra: { label: "Qo'shimcha kanal", joinBonus: 1_000, stayBonus: 2_000, stayDays: 7, hint: "Qo'shimcha kanal: 1 000 + 2 000 / 7 kun" },
} as const;
export type PresetId = keyof typeof PRESETS;

/** The first channel is usually the news channel; every later one an extra channel. */
export function defaultPreset(existingCount: number): PresetId {
  return existingCount === 0 ? "news" : "extra";
}

/** «1 000 + 2 000 / 7 kun»; without a stay bonus just «2 000». */
export function bonusText(c: Pick<BonusChannel, "joinBonus" | "stayBonus" | "stayDays">): string {
  if (c.stayBonus <= 0) return fmtNumber(c.joinBonus);
  return `${fmtNumber(c.joinBonus)} + ${fmtNumber(c.stayBonus)} / ${c.stayDays} kun`;
}

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

/** Whole number typed by an admin: spaces allowed as thousands separators (JS `\s` covers NBSP and U+202F). */
export function checkIntText(text: string, min: number, max: number, label: string): Check<number> {
  const s = text.replace(/\s/g, "");
  const signed = min < 0 ? /^-?\d{1,9}$/ : /^\d{1,9}$/;
  if (!signed.test(s)) return { ok: false, error: `${label}: butun son kiriting` };
  const n = Number(s);
  if (n < min || n > max) return { ok: false, error: `${label}: ${fmtNumber(min)} dan ${fmtNumber(max)} gacha` };
  return { ok: true, value: n };
}

export function checkTitle(text: string): Check<string> {
  const s = text.replace(/\s+/g, " ").trim();
  if (!s) return { ok: false, error: "Sarlavha bo'sh bo'lmasin" };
  if ([...s].length > MAX_TITLE) return { ok: false, error: `Sarlavha ${MAX_TITLE} belgidan oshmasin` };
  return { ok: true, value: s };
}

export type AmountsDraft = { joinBonus: string; stayBonus: string; stayDays: string };
export type Amounts = { joinBonus: number; stayBonus: number; stayDays: number };

/** Validates the three amount fields together (at least one bonus must be above zero). */
export function checkAmounts(d: AmountsDraft): Check<Amounts> {
  const join = checkIntText(d.joinBonus, 0, MAX_BONUS, "Obuna bonusi");
  if (!join.ok) return join;
  const stay = checkIntText(d.stayBonus, 0, MAX_BONUS, "Qo'shimcha bonus");
  if (!stay.ok) return stay;
  const days = checkIntText(d.stayDays, 1, MAX_STAY_DAYS, "Kunlar");
  if (!days.ok) return days;
  if (join.value === 0 && stay.value === 0) return { ok: false, error: "Kamida bitta bonus 0 dan katta bo'lsin" };
  return { ok: true, value: { joinBonus: join.value, stayBonus: stay.value, stayDays: days.value } };
}

export function amountsDraft(a: Amounts): AmountsDraft {
  return { joinBonus: String(a.joinBonus), stayBonus: String(a.stayBonus), stayDays: String(a.stayDays) };
}

export function channelUrl(username: string | null): string | null {
  return username ? `https://t.me/${username}` : null;
}

export type BotCheck = { status: "checking" } | { status: BotAdminStatus; warning: string | null };

export const BOT_STATUS_TEXT: Record<BotCheck["status"], string> = {
  checking: "Tekshirilmoqda…",
  admin: "Bot admin",
  not_admin: "Bot admin emas",
  unknown: "Noma'lum",
};
