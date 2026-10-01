/**
 * Formatting helpers for the admin panel.
 *
 * Pure and isomorphic (server and browser): imports nothing. It deliberately
 * does NOT rely on `toLocaleString` / the browser locale, because ICU data
 * differs between Node and WebViews and the same number would render two ways.
 * Dates are computed by hand in Asia/Tashkent (UTC+5, no DST).
 */

const NBSP = "\u00a0"; // group separator that never wraps mid-number
const DASH = "—";
const TASHKENT_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

export type NumberInput = number | null | undefined;

function isNum(n: NumberInput): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Groups the integer part by three: `1234567` -> `1 234 567` (NBSP). */
function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export type FmtNumberOptions = {
  /** Fraction digits (default 0). */
  digits?: number;
  /** Keep trailing zeros (`1,20`); otherwise they are trimmed. */
  fixed?: boolean;
  /** Prefix positive numbers with `+` (for deltas). */
  sign?: boolean;
};

/** `1234567.8` -> `1 234 568`; decimal comma; `null` / `NaN` -> an em dash. */
export function fmtNumber(n: NumberInput, opts: FmtNumberOptions = {}): string {
  if (!isNum(n)) return DASH;
  const digits = Math.min(Math.max(Math.trunc(opts.digits ?? 0), 0), 10);
  const neg = n < 0;
  // `toFixed` switches to exponent form above 1e21; the admin never shows such numbers.
  const [int, frac = ""] = Math.abs(n).toFixed(digits).split(".");
  const fracText = opts.fixed ? frac : frac.replace(/0+$/, "");
  const body = fracText ? `${group(int)},${fracText}` : group(int);
  // Never render "-0" / "+0".
  const isZero = !/[1-9]/.test(`${int}${frac}`);
  if (neg && !isZero) return `-${body}`;
  if (opts.sign && !isZero) return `+${body}`;
  return body;
}

/** So'm (whole number). */
export function fmtSoum(n: NumberInput): string {
  return isNum(n) ? `${fmtNumber(n)}${NBSP}so'm` : DASH;
}

/** Tanga: the app's internal accounting unit (whole number). */
export function fmtTanga(n: NumberInput): string {
  return isNum(n) ? `${fmtNumber(n)}${NBSP}tanga` : DASH;
}

/** US dollars. Tiny amounts (AI cost) get 4 fraction digits. */
export function fmtUsd(n: NumberInput, digits?: number): string {
  if (!isNum(n)) return DASH;
  const d = digits ?? (n !== 0 && Math.abs(n) < 0.01 ? 4 : 2);
  const body = fmtNumber(Math.abs(n), { digits: d, fixed: true });
  return `${n < 0 && /[1-9]/.test(body) ? "-" : ""}$${body}`;
}

/** Percent: the input is already in percent (`12.5` -> `12,5%`); `sign` adds `+` for deltas. */
export function fmtPercent(value: NumberInput, opts: { digits?: number; sign?: boolean } = {}): string {
  if (!isNum(value)) return DASH;
  return `${fmtNumber(value, { digits: opts.digits ?? 1, sign: opts.sign })}%`;
}

/* ───────────────────────────── dates and times ───────────────────────────── */

export type DateInput = Date | string | number | null | undefined;

/** ISO string, epoch ms or `Date` -> `Date`; `null` when invalid. */
function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Tashkent wall-clock parts (UTC+5 added by hand, read through the UTC getters). */
export function tashkentParts(input: DateInput): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const date = toDate(input);
  if (!date) return null;
  const t = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

/** `DD.MM.YYYY HH:mm` (Asia/Tashkent). */
export function fmtDateTime(input: DateInput): string {
  const t = tashkentParts(input);
  return t ? `${p2(t.d)}.${p2(t.mo)}.${t.y} ${p2(t.h)}:${p2(t.mi)}` : DASH;
}

/** `DD.MM.YYYY` (Asia/Tashkent). */
export function fmtDate(input: DateInput): string {
  const t = tashkentParts(input);
  return t ? `${p2(t.d)}.${p2(t.mo)}.${t.y}` : DASH;
}

/** `YYYY-MM-DD` -> `DD.MM.YYYY` (a calendar day, no time zone involved). */
export function fmtIsoDate(iso: string | null | undefined): string {
  return iso && isIsoDate(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : DASH;
}

const MIN = 60_000;
const HOUR = 3_600_000;

function plural(n: number, unit: string, suffix: string): string {
  return `${fmtNumber(n)} ${unit} ${suffix}`;
}

/**
 * "5 daqiqa oldin" / "2 soatdan keyin". Dates older than 30 days fall back to
 * the full date (a relative phrase is meaningless there).
 */
export function fmtRelative(input: DateInput, now: number | Date = Date.now()): string {
  const date = toDate(input);
  if (!date) return DASH;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const diff = nowMs - date.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "oldin" : "keyin";
  // Uzbek needs the ablative suffix before "keyin": "5 daqiqadan keyin".
  const unit = (n: number, base: string) => (diff >= 0 ? plural(n, base, suffix) : plural(n, `${base}dan`, suffix));
  if (abs < 10_000) return "hozirgina";
  if (abs < MIN) return unit(Math.floor(abs / 1000), "soniya");
  if (abs < HOUR) return unit(Math.floor(abs / MIN), "daqiqa");
  if (abs < DAY_MS) return unit(Math.floor(abs / HOUR), "soat");
  if (abs < 30 * DAY_MS) return unit(Math.floor(abs / DAY_MS), "kun");
  return fmtDate(date);
}

/* ───────────────────────────── size and duration ───────────────────────────── */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `1536` -> `1,5 KB`. */
export function fmtBytes(n: NumberInput): string {
  if (!isNum(n) || n < 0) return DASH;
  let v = n;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${fmtNumber(v, { digits: i === 0 ? 0 : 1 })}${NBSP}${BYTE_UNITS[i]}`;
}

/** Duration in seconds: `3725` -> `1 soat 02 daq`, `42` -> `42 s`. */
export function fmtDuration(seconds: NumberInput): string {
  if (!isNum(seconds) || seconds < 0) return DASH;
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days} kun ${hours} soat`;
  if (hours > 0) return `${hours} soat ${p2(mins)} daq`;
  return `${mins} daq ${p2(secs)} s`;
}

/* ───────────────────── Tashkent calendar days (YYYY-MM-DD) ───────────────────── */

/** Is this a real calendar day in `YYYY-MM-DD` form (no 30 February). */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function isoToUtcMs(iso: string): number {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

function utcMsToIso(ms: number): string {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`;
}

/** The Tashkent calendar day of now (or of the given instant), `YYYY-MM-DD`. */
export function todayTashkent(now: number | Date = Date.now()): string {
  const t = tashkentParts(now instanceof Date ? now : new Date(now));
  return t ? `${t.y}-${p2(t.mo)}-${p2(t.d)}` : "";
}

/** Shifts a calendar day by `n` days (negative goes back). */
export function addDaysIso(iso: string, n: number): string {
  return utcMsToIso(isoToUtcMs(iso) + n * DAY_MS);
}

/** `to - from` in days (add 1 for an inclusive span). */
export function diffDaysIso(from: string, to: string): number {
  return Math.round((isoToUtcMs(to) - isoToUtcMs(from)) / DAY_MS);
}

/** Number of days in a month (`month` is 1..12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
