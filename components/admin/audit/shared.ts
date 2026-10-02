import { isIsoDate } from "@/lib/admin-format";
import { validateRange } from "@/components/admin/ui/date-range";
import type { FilterOption } from "@/components/admin/ui";
import { AUDIT_OUTCOMES, type AuditFilterQuery, type AuditOutcome } from "@/lib/admin-api/audit";

export type AuditFilters = {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome | "";
  from: string;
  to: string;
};

export const EMPTY_FILTERS: AuditFilters = { adminId: "", action: "", targetType: "", targetId: "", outcome: "", from: "", to: "" };

/** Rows per page. */
export const PAGE_LIMIT = 50;

/** Server limits (admin-audit-query.ts): longer values would be a 400, so the URL is clamped instead. */
export const MAX_ACTION = 100;
export const MAX_TARGET_TYPE = 64;
export const MAX_TARGET_ID = 200;

export const OUTCOME_OPTIONS: ReadonlyArray<{ value: AuditOutcome | ""; label: string }> = [
  { value: "", label: "Hammasi" },
  { value: "ok", label: "ok" },
  { value: "denied", label: "denied" },
  { value: "failed", label: "failed" },
];

/** Target types the panel writes today (plan §8); a type from a deep link outside this list is still honoured. */
export const TARGET_TYPES: ReadonlyArray<string> = [
  "user",
  "generation",
  "order",
  "admin",
  "admin_session",
  "setting",
  "game_session",
  "game_result",
  "error",
  "audit_log",
];

export const TARGET_TYPE_LABELS: Readonly<Record<string, string>> = {
  user: "Foydalanuvchi",
  generation: "Generatsiya",
  order: "To'lov",
  admin: "Admin",
  admin_session: "Admin sessiyasi",
  setting: "Sozlama",
  game_session: "O'yin havolasi",
  game_result: "O'yin natijasi",
  error: "Xato",
  audit_log: "Audit jurnali",
};

/** Dropdown options; an unknown type present in the URL is added so the select never shows a lie. */
export function targetTypeOptions(current: string): FilterOption[] {
  const types = current && !TARGET_TYPES.includes(current) ? [...TARGET_TYPES, current] : TARGET_TYPES;
  return types.map((t) => ({ value: t, label: TARGET_TYPE_LABELS[t] ? `${TARGET_TYPE_LABELS[t]} (${t})` : t }));
}

const ID_RE = /^[1-9]\d{0,18}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clip = (v: string | null, max: number): string => (v ?? "").trim().slice(0, max);

/** Reads the filters from the URL; anything invalid falls back to "no filter" instead of a 400. */
export function parseFilters(params: URLSearchParams): AuditFilters {
  const outcome = params.get("outcome");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const rangeOk = isIsoDate(from) && isIsoDate(to) && validateRange({ from, to }) === null;
  const adminId = params.get("adminId") ?? "";
  return {
    adminId: ID_RE.test(adminId) ? adminId : "",
    action: clip(params.get("action"), MAX_ACTION),
    targetType: clip(params.get("targetType"), MAX_TARGET_TYPE),
    targetId: clip(params.get("targetId"), MAX_TARGET_ID),
    outcome: (AUDIT_OUTCOMES as ReadonlyArray<string>).includes(outcome ?? "") ? (outcome as AuditOutcome) : "",
    from: rangeOk ? from : "",
    to: rangeOk ? to : "",
  };
}

/** The audit row open in the drawer (`?id=`), validated so a hand-edited URL cannot reach the API as garbage. */
export function parseOpenId(params: URLSearchParams): string | null {
  const id = params.get("id");
  return id !== null && ID_RE.test(id) ? id : null;
}

export function toApiFilters(f: AuditFilters): AuditFilterQuery {
  return { adminId: f.adminId, action: f.action, targetType: f.targetType, targetId: f.targetId, outcome: f.outcome, from: f.from, to: f.to };
}

export function activeFilterCount(f: AuditFilters): number {
  return (f.adminId ? 1 : 0) + (f.action ? 1 : 0) + (f.targetType ? 1 : 0) + (f.targetId ? 1 : 0) + (f.outcome ? 1 : 0) + (f.from ? 1 : 0);
}

/**
 * The admin screen a target belongs to, built from the id (never from raw data
 * URLs). `null` when the type has no screen or the id has an unexpected shape.
 */
export function targetHref(type: string | null, id: string | null): string | null {
  if (!type) return null;
  switch (type) {
    case "user":
      return id !== null && ID_RE.test(id) ? `/admin/users/${id}` : null;
    case "generation":
      return id !== null && UUID_RE.test(id) ? `/admin/generations/${id.toLowerCase()}` : null;
    case "order":
      return id !== null && UUID_RE.test(id) ? `/admin/payments/${id.toLowerCase()}` : null;
    case "error":
      return id !== null && ID_RE.test(id) ? `/admin/errors?id=${id}` : null;
    case "admin":
      return "/admin/admins";
    case "setting":
      return "/admin/settings";
    case "game_session":
      return "/admin/moderation";
    default:
      return null;
  }
}

/* ───────────────────────────── before / after diff ───────────────────────────── */

export type DiffRow = {
  key: string;
  before: string | null;
  after: string | null;
  /** `changed` = both sides differ, `added` / `removed` = the key exists on one side only. */
  kind: "changed" | "added" | "removed" | "same";
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Compact JSON text of one value (strings keep their quotes, so `"1"` and `1` stay distinguishable). */
export function jsonText(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "undefined";
  } catch {
    return String(v);
  }
}

/**
 * Key-by-key comparison of the `before` and `after` snapshots (plan §8 stores
 * only changed fields). Non-object snapshots compare as one value under the
 * key "(qiymat)". Values are returned as JSON text, so nothing is interpreted.
 */
export function diffSnapshots(before: unknown, after: unknown): DiffRow[] {
  if (!isPlainObject(before) && !isPlainObject(after)) {
    if (before === null && after === null) return [];
    const b = before === null ? null : jsonText(before);
    const a = after === null ? null : jsonText(after);
    return [{ key: "(qiymat)", before: b, after: a, kind: b === null ? "added" : a === null ? "removed" : b === a ? "same" : "changed" }];
  }
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys: string[] = [];
  for (const k of [...Object.keys(b), ...Object.keys(a)]) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => {
    const inB = Object.hasOwn(b, key);
    const inA = Object.hasOwn(a, key);
    const bt = inB ? jsonText(b[key]) : null;
    const at = inA ? jsonText(a[key]) : null;
    const kind: DiffRow["kind"] = !inB ? "added" : !inA ? "removed" : bt === at ? "same" : "changed";
    return { key, before: bt, after: at, kind };
  });
}
