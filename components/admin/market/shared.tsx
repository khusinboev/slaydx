"use client";

import { Badge, type Tone } from "@/components/admin/ui";
import { MARKET_LEVEL_OPTIONS, MARKET_REASON_OPTIONS, MARKET_SUBJECT_OPTIONS, type MarketStatus } from "@/lib/admin-api/market";

const STATUS: Record<MarketStatus, { label: string; tone: Tone }> = {
  candidate: { label: "Navbatda", tone: "info" },
  active: { label: "Sotuvda", tone: "success" },
  sold_out: { label: "Tugagan", tone: "warning" },
  retired: { label: "Olib tashlangan", tone: "neutral" },
  rejected: { label: "Rad etilgan", tone: "danger" },
};

export function MarketStatusPill({ status }: { status: MarketStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const subjectName = (id: string): string => MARKET_SUBJECT_OPTIONS.find((s) => s.value === id)?.label ?? id;
export const levelName = (id: string): string => MARKET_LEVEL_OPTIONS.find((s) => s.value === id)?.label ?? id;

const SCAN_REASONS: Readonly<Record<string, string>> = {
  quality: "Sifat chegarasidan past",
  duplicate: "Takror ish",
  per_topic: "Mavzu chegarasi to'lgan",
  legacy: "Eski hujjat shakli",
  too_large: "Fayl juda katta",
  user_material: "Foydalanuvchi materiali bor",
  sanitize_error: "Tozalashda xato",
};

/** `reject_reason`: an admin's code or the scan's; `sanitize_error` may carry `: Name`. */
export function rejectReasonText(raw: string | null): string {
  if (!raw) return "—";
  const [code, detail] = raw.split(": ");
  const label = MARKET_REASON_OPTIONS.find((o) => o.value === code)?.label ?? SCAN_REASONS[code ?? ""] ?? raw;
  return detail ? `${label}: ${detail}` : label;
}

const PII_KINDS: Readonly<Record<string, string>> = {
  name: "Ism",
  institution: "Muassasa",
  phone: "Telefon",
  email: "E-pochta",
  username: "Foydalanuvchi nomi",
  telegram: "Telegram havola",
};

export const piiKindName = (kind: string): string => PII_KINDS[kind] ?? kind;

/** `sections.2.blocks.0.text` → «3-bo'lim, 1-band»: the admin reads places, not JSON paths. */
export function piiPlace(path: string): string {
  const parts = path.split(".");
  const pair = (word: string): number | null => {
    const at = parts.indexOf(word);
    const n = at >= 0 ? Number(parts[at + 1]) : NaN;
    return Number.isInteger(n) ? n + 1 : null;
  };
  const slide = pair("slides");
  if (slide !== null) return `${slide}-slayd`;
  const section = pair("sections");
  if (section !== null) {
    const block = pair("blocks");
    return block !== null ? `${section}-bo'lim, ${block}-band` : `${section}-bo'lim`;
  }
  return path;
}
