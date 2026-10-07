import type { JobStatus } from "@/lib/types";

/** Short Uzbek month names for the one-line card meta («5 okt»). */
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"] as const;

/**
 * Users are in Uzbekistan: dates on the file list are Tashkent wall time
 * (UTC+5 all year — no daylight saving since 1992), whatever the device or
 * test machine's zone is. A fixed offset keeps this pure and deterministic.
 */
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `Date` whose UTC fields read as Tashkent wall time; `null` for invalid input. */
function tashkent(iso: string | Date): Date | null {
  const ms = (typeof iso === "string" ? new Date(iso) : iso).getTime();
  return Number.isNaN(ms) ? null : new Date(ms + TASHKENT_OFFSET_MS);
}

/** Days since the epoch in Tashkent (a calendar-day counter). */
function tashkentDay(d: Date): number {
  return Math.floor(d.getTime() / DAY_MS);
}

/**
 * «5 okt» (same year as `now`) or «5 okt 2025», in Tashkent time — the date
 * line of a file card. Invalid input gives an empty string, never «NaN».
 */
export function formatFileDate(iso: string, now: Date = new Date()): string {
  const d = tashkent(iso);
  const n = tashkent(now);
  if (!d || !n) return "";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

export type FileDateGroupId = "today" | "yesterday" | "week" | "earlier";

export const FILE_DATE_GROUP_LABELS: Record<FileDateGroupId, string> = {
  today: "Bugun",
  yesterday: "Kecha",
  week: "Shu hafta",
  earlier: "Avvalroq",
};

/**
 * Which «Ishlarim» section a file falls in, by Tashkent calendar day:
 * «Bugun» (today; a date in the future — clock skew — counts as today),
 * «Kecha», «Shu hafta» (earlier this Monday-based week) and «Avvalroq».
 * Invalid input is «Avvalroq» (never dropped).
 */
export function fileDateGroup(iso: string, now: Date = new Date()): FileDateGroupId {
  const d = tashkent(iso);
  const n = tashkent(now);
  if (!d || !n) return "earlier";
  const today = tashkentDay(n);
  const day = tashkentDay(d);
  if (day >= today) return "today";
  if (day === today - 1) return "yesterday";
  // getUTCDay: 0 = Sunday … 6 = Saturday → days since this week's Monday.
  const sinceMonday = (n.getUTCDay() + 6) % 7;
  return day >= today - sinceMonday ? "week" : "earlier";
}

export type FileGroup<T> = { id: FileDateGroupId; label: string; rows: T[] };

/**
 * Splits an already SORTED list into consecutive date sections (the order of
 * `rows` is kept exactly; with an oldest-first sort the sections simply come
 * out «Avvalroq» … «Bugun»). Every row lands in exactly one section.
 */
export function groupFilesByDate<T>(rows: readonly T[], dateOf: (row: T) => string, now: Date = new Date()): FileGroup<T>[] {
  const out: FileGroup<T>[] = [];
  for (const row of rows) {
    const id = fileDateGroup(dateOf(row), now);
    const last = out[out.length - 1];
    if (last && last.id === id) last.rows.push(row);
    else out.push({ id, label: FILE_DATE_GROUP_LABELS[id], rows: [row] });
  }
  return out;
}

/**
 * When a file was made, short: «14:05» for today and yesterday (the section
 * heading already says which day), otherwise «5 okt» / «5 okt 2025».
 */
export function formatFileWhen(iso: string, now: Date = new Date()): string {
  const group = fileDateGroup(iso, now);
  const d = tashkent(iso);
  if (!d) return "";
  if (group === "today" || group === "yesterday") {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return formatFileDate(iso, now);
}

export type FileStatusTone = "ok" | "run" | "error" | "muted";

/**
 * The status pill of a file card: «Tayyor», «Navbatda», «Yozilmoqda N%»,
 * «Xato», «Bekor qilindi». Progress is clamped to 0–99 while running (100 %
 * on a job that is not COMPLETED yet would read as finished).
 */
export function fileStatusPill(status: JobStatus, progress: number): { label: string; tone: FileStatusTone } {
  switch (status) {
    case "COMPLETED":
      return { label: "Tayyor", tone: "ok" };
    case "QUEUED":
      return { label: "Navbatda", tone: "run" };
    case "IN_PROGRESS": {
      const pct = Math.max(0, Math.min(99, Math.round(Number.isFinite(progress) ? progress : 0)));
      return { label: `Yozilmoqda ${pct}%`, tone: "run" };
    }
    case "FAILED":
      return { label: "Xato", tone: "error" };
    case "REVOKED":
      return { label: "Bekor qilindi", tone: "muted" };
    default:
      return { label: String(status), tone: "muted" };
  }
}
