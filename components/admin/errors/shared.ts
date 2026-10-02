import { isIsoDate } from "@/lib/admin-format";
import { validateRange } from "@/components/admin/ui/date-range";
import type { ErrorLevel, ErrorListParams } from "@/lib/admin-api/system";

/** The "resolved" segmented switch: absent in the URL means "open" (the default view). */
export type ResolvedView = "open" | "done" | "all";

export type ErrorFilters = {
  resolved: ResolvedView;
  level: ErrorLevel | "";
  scope: string;
  q: string;
  from: string;
  to: string;
};

/** Server limits (admin-errors.ts): longer values would be a 400, so the URL is clamped instead. */
export const MAX_SCOPE = 64;
export const MAX_QUERY = 120;
/** Rows per page; well under the bulk limit of 100, so a whole page can always be selected. */
export const PAGE_LIMIT = 50;

export const RESOLVED_OPTIONS: ReadonlyArray<{ value: ResolvedView; label: string }> = [
  { value: "open", label: "Ochiq" },
  { value: "done", label: "Hal qilingan" },
  { value: "all", label: "Hammasi" },
];

export const LEVEL_OPTIONS: ReadonlyArray<{ value: ErrorLevel; label: string }> = [
  { value: "error", label: "error" },
  { value: "warn", label: "warn" },
];

const ID_RE = /^[1-9]\d{0,18}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the filters from the URL; anything invalid falls back to "no filter" instead of a 400. */
export function parseFilters(params: URLSearchParams): ErrorFilters {
  const r = params.get("resolved");
  const level = params.get("level");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const rangeOk = isIsoDate(from) && isIsoDate(to) && validateRange({ from, to }) === null;
  return {
    resolved: r === "1" ? "done" : r === "all" ? "all" : "open",
    level: level === "error" || level === "warn" ? level : "",
    scope: (params.get("scope") ?? "").trim().slice(0, MAX_SCOPE),
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY),
    from: rangeOk ? from : "",
    to: rangeOk ? to : "",
  };
}

/** The error id open in the drawer (`?id=`), validated so a hand-edited URL cannot reach the API as garbage. */
export function parseOpenId(params: URLSearchParams): string | null {
  const id = params.get("id");
  return id !== null && ID_RE.test(id) ? id : null;
}

/** URL value of a filter patch: the defaults are dropped so the URL stays short. */
export function urlValueOfResolved(v: ResolvedView): string | null {
  return v === "open" ? null : v === "done" ? "1" : "all";
}

export function toApiParams(f: ErrorFilters): Omit<ErrorListParams, "cursor" | "limit"> {
  return {
    level: f.level,
    scope: f.scope,
    q: f.q,
    from: f.from,
    to: f.to,
    resolved: f.resolved === "all" ? undefined : f.resolved === "done",
  };
}

/** How many filters differ from the default view (open errors, nothing else). */
export function activeFilterCount(f: ErrorFilters): number {
  return (f.resolved !== "open" ? 1 : 0) + (f.level ? 1 : 0) + (f.scope ? 1 : 0) + (f.q ? 1 : 0) + (f.from ? 1 : 0);
}
