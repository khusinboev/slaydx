import { fmtNumber } from "@/lib/admin-format";
import type { SettingItem, SettingSource, SettingValue } from "@/lib/admin-api/settings";

/** Shown wherever a change is announced: other processes read settings through a 15 s cache. */
export const PROPAGATION_NOTE = "O'zgarish boshqa jarayonlarga 15 soniyagacha yetib boradi.";

export const SOURCE_LABEL: Record<SettingSource, string> = {
  db: "Admin qiymati",
  env: "Env qiymati",
  default: "Standart qiymat",
};

/** `{ value, label }` of the tool registry, passed down by the server page. */
export type ToolOption = { value: string; label: string };

/** Display text of a value. Tool ids not in the registry are shown by their id. */
export function formatValue(item: Pick<SettingItem, "type">, value: SettingValue, tools: ReadonlyArray<ToolOption>): string {
  if (item.type === "bool") return value ? "Yoqilgan" : "O'chiq";
  if (item.type === "tool_ids") {
    const ids = Array.isArray(value) ? value : [];
    if (ids.length === 0) return "Hech biri";
    const label = new Map(tools.map((t) => [t.value, t.label]));
    return ids.map((id) => label.get(id) ?? id).join(", ");
  }
  return typeof value === "number" ? fmtNumber(value, { digits: item.type === "number" ? 2 : 0 }) : "—";
}

export type NumberCheck = { ok: true; value: number } | { ok: false; error: string };

/**
 * Parses and bounds-checks the text of an `int` / `number` input. Spaces
 * (also NBSP) group digits; a number accepts a decimal comma or point. The
 * server validates again — this only gives instant feedback.
 */
export function checkNumberText(item: Pick<SettingItem, "type" | "min" | "max">, text: string): NumberCheck {
  const s = text.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (s === "") return { ok: false, error: "Qiymatni kiriting" };
  const pattern = item.type === "int" ? /^\d{1,15}$/ : /^\d{1,15}(\.\d{1,6})?$/;
  if (!pattern.test(s)) {
    return { ok: false, error: item.type === "int" ? "Qiymat butun son bo'lishi kerak" : "Qiymat son bo'lishi kerak" };
  }
  const value = Number(s);
  if ((item.min !== null && value < item.min) || (item.max !== null && value > item.max)) {
    const lo = item.min === null ? "" : fmtNumber(item.min, { digits: 2 });
    const hi = item.max === null ? "" : fmtNumber(item.max, { digits: 2 });
    return { ok: false, error: `Qiymat ${lo} dan ${hi} gacha bo'lishi kerak` };
  }
  return { ok: true, value };
}

/** Initial text of a numeric input: no grouping, so it is easy to edit. */
export function numberText(value: number): string {
  return String(value);
}

/** Groups in order of first appearance (the catalog order decides the card order). */
export function groupItems(items: ReadonlyArray<SettingItem>): Array<{ group: string; items: SettingItem[] }> {
  const out: Array<{ group: string; items: SettingItem[] }> = [];
  for (const item of items) {
    const found = out.find((g) => g.group === item.group);
    if (found) found.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}
