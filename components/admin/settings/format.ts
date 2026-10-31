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

const SOUM_KEYS = new Set([
  "finance.soum_per_usd",
  "admin.wallet_confirm_threshold",
  "bonus.rating_points",
  "daily_quiz.reward",
  "daily_quiz.monthly_cap",
  "daily_quiz.daily_budget",
  "domla.price",
  "chat.price_per_message",
  "tests.price_subject",
  "tests.price_all",
]);
const PERCENT_KEYS = new Set(["payment_bonus_percent", "ambassador.percent", "pricing.payment_fee_percent"]);
const MINUTE_KEYS = new Set(["tests.minutes_per_subject", "tests.minutes_all"]);
const COUNT_KEYS = new Set(["queue.user_max_inflight", "queue.total_slots", "video.max_concurrent", "tests.questions_per_subject", "convert.daily_limit"]);

/** Seconds as «15 daqiqa» / «3 daqiqa 20 soniya» / «45 soniya». */
export function fmtDuration(sec: number): string {
  if (sec < 60) return `${fmtNumber(sec)} soniya`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s ? `${fmtNumber(m)} daqiqa ${s} soniya` : `${fmtNumber(m)} daqiqa`;
}

/** The number of a setting with its unit (so'm, %, daqiqa, ...) chosen by key. */
function formatNumber(item: Pick<SettingItem, "type"> & { key?: string }, value: number): string {
  const key = item.key ?? "";
  const n = fmtNumber(value, { digits: item.type === "number" ? 2 : 0 });
  if (SOUM_KEYS.has(key)) return `${n}\u00a0so'm`;
  if (PERCENT_KEYS.has(key)) return `${n}%`;
  if (MINUTE_KEYS.has(key)) return `${n} daqiqa`;
  if (COUNT_KEYS.has(key)) return `${n} ta`;
  if (key === "queue.max_wait_sec") return fmtDuration(value);
  if (key === "queue.mean_service_sec") return value === 0 ? "Avtomatik" : fmtDuration(value);
  if (key === "daily_quiz.hour") return `${String(value).padStart(2, "0")}:00`;
  if (key === "pricing.target_markup") return `×${n}`;
  if (key === "tests.points_per_correct") return `${n} ball`;
  if (key === "free_llm.daily.chat") return `${n} xabar`;
  if (key.startsWith("free_llm.daily.")) return `${n} birlik`;
  return n;
}

/** Display text of a value. Tool ids not in the registry are shown by their id. */
export function formatValue(item: Pick<SettingItem, "type"> & { key?: string }, value: SettingValue, tools: ReadonlyArray<ToolOption>): string {
  if (item.type === "bool") return value ? "Yoqilgan" : "O'chiq";
  if (item.type === "text") return typeof value === "string" && value.trim() ? value : "Kiritilmagan";
  if (item.type === "tool_ids") {
    const ids = Array.isArray(value) ? value : [];
    if (ids.length === 0) return "Hech biri";
    const label = new Map(tools.map((t) => [t.value, t.label]));
    return ids.map((id) => label.get(id) ?? id).join(", ");
  }
  return typeof value === "number" ? formatNumber(item, value) : "—";
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

/** The oferta flag is on but the requisites are empty: the server treats the gate as off (it cannot be enabled that way, but it can be left over). */
export const OFERTA_INACTIVE_NOTE = "amalda o'chiq (rekvizitlar bo'sh)";

/** A remark for `item` given all items, or `undefined`. */
export function noteFor(item: SettingItem, all: ReadonlyArray<SettingItem>): string | undefined {
  if (item.key !== "oferta.gate_enabled" || item.value !== true) return undefined;
  const req = all.find((i) => i.key === "oferta.requisites");
  return req && req.type === "text" && !req.value.trim() ? OFERTA_INACTIVE_NOTE : undefined;
}

/** A warning on the overview tab; `tab` is where to fix it. */
export type SettingsWarning = { id: string; text: string; tab: string };

/** Things the owner should know about, computed from the loaded items. */
export function warningsFor(items: ReadonlyArray<SettingItem>): SettingsWarning[] {
  const get = (key: string) => items.find((i) => i.key === key);
  const out: SettingsWarning[] = [];
  const oferta = get("oferta.gate_enabled");
  if (oferta && noteFor(oferta, items)) {
    out.push({ id: "oferta", text: "Oferta tekshiruvi yoqilgan, lekin rekvizitlar bo'sh — amalda ishlamayapti. Rekvizitlarni kiriting.", tab: "oferta" });
  }
  const fee = get("pricing.payment_fee_percent");
  if (fee && fee.type === "number" && fee.value === 0) {
    out.push({ id: "fee", text: "To'lov komissiyasi 0% — hisobotlardagi marja haqiqatdagidan yuqori ko'rinadi.", tab: "pricing" });
  }
  const paused = get("generation.paused");
  if (paused && paused.value === true) out.push({ id: "paused", text: "Barcha generatsiyalar to'xtatilgan — yangi ish qabul qilinmayapti.", tab: "queue" });
  const tools = get("generation.paused_tools");
  if (tools && tools.type === "tool_ids" && tools.value.length > 0) {
    out.push({ id: "paused_tools", text: `${tools.value.length} ta vosita uchun generatsiya to'xtatilgan.`, tab: "queue" });
  }
  const free = get("free_llm.disabled");
  if (free && free.value === true) out.push({ id: "free", text: "Bepul AI o'chirilgan — reja, UDK va «Tuzatish» ishlamayapti.", tab: "free" });
  const convert = get("convert.disabled");
  if (convert && convert.value === true) out.push({ id: "convert", text: "Fayl konvertatsiyasi o'chirilgan.", tab: "queue" });
  return out;
}
