/**
 * Input rules for the direct Click methods (card form, phone invoice). Pure and
 * client-safe: the wallet dialog uses them for inline hints, the API routes use
 * the SAME functions to validate (the server never trusts the client's check).
 *
 * Nothing here logs or stores a value; callers must not either.
 */

/** How a Click order is paid (`payment_orders.click_method`): the Click page (fallback), our card form, an invoice by phone, the Click app deeplink. */
export const CLICK_METHODS = ["page", "card", "phone", "app"] as const;
export type ClickMethod = (typeof CLICK_METHODS)[number];

export function isClickMethod(v: unknown): v is ClickMethod {
  return typeof v === "string" && (CLICK_METHODS as readonly string[]).includes(v);
}

export const digitsOf = (s: string): string => String(s ?? "").replace(/\D/g, "");

/**
 * Card numbers are 16–19 digits. NO prefix allow-list (owner 2026-10-09: Uzbek banks issue
 * many card ranges — 6262…, Visa, UnionPay …): Click's `card_token/request` is the check —
 * an unsupported or unknown card comes back as a mapped Click error, a valid one gets the SMS.
 */
export const CARD_MIN_DIGITS = 16;
export const CARD_MAX_DIGITS = 19;

/** `8600 1234 5678 9012` while typing: at most 19 digits, groups of 4. */
export function formatCardNumber(input: string): string {
  return digitsOf(input).slice(0, CARD_MAX_DIGITS).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Digits of a plausible card number (16–19 digits), else `null`. */
export function normalizeCardNumber(input: string): string | null {
  const d = digitsOf(input);
  return d.length >= CARD_MIN_DIGITS && d.length <= CARD_MAX_DIGITS ? d : null;
}

/** The Uzbek reason a card number is not acceptable, or `null`. `""` input is an error too. */
export function cardNumberError(input: string): string | null {
  const d = digitsOf(input);
  if (d.length === 0) return "Karta raqamini kiriting";
  if (d.length < CARD_MIN_DIGITS) return "Karta raqami kamida 16 ta raqamdan iborat";
  if (d.length > CARD_MAX_DIGITS) return "Karta raqami 19 ta raqamdan oshmasin";
  return null;
}

/** `12/27` while typing (the slash appears after the month). */
export function formatExpiry(input: string): string {
  const d = digitsOf(input).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export type ExpiryResult = { ok: true; mmyy: string } | { ok: false; error: string };

/**
 * `MM/YY`, `MM / YY` or `MMYY` -> `MMYY` (Click's `expire_date`). A card is valid
 * through the LAST day of its month, so `now`'s own month is still accepted.
 */
export function parseExpiry(input: string, now: Date = new Date()): ExpiryResult {
  const d = digitsOf(input);
  if (d.length === 0) return { ok: false, error: "Amal qilish muddatini kiriting" };
  if (d.length !== 4) return { ok: false, error: "Muddat OO/YY ko'rinishida bo'lsin" };
  const month = Number(d.slice(0, 2));
  const year = 2000 + Number(d.slice(2));
  if (month < 1 || month > 12) return { ok: false, error: "Oy 01 dan 12 gacha bo'lsin" };
  const nowIdx = now.getFullYear() * 12 + now.getMonth();
  if (year * 12 + (month - 1) < nowIdx) return { ok: false, error: "Kartaning amal qilish muddati tugagan" };
  return { ok: true, mmyy: d };
}

/** Subscriber part (9 digits) typed after the fixed `+998`: `90 123 45 67`. */
export function formatPhoneLocal(input: string): string {
  let d = digitsOf(input);
  if (d.startsWith("998") && d.length > 9) d = d.slice(3);
  d = d.slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(" ");
}

/**
 * Click's `phone_number`: `998` + 9 digits, no plus. Accepts `+998 90 123 45 67`,
 * `998901234567` and the bare 9 digits `90 123 45 67`; anything else is `null`.
 */
export function normalizePhone(input: string): string | null {
  const d = digitsOf(input);
  if (d.length === 9) return `998${d}`;
  return /^998\d{9}$/.test(d) ? d : null;
}

export function phoneError(input: string): string | null {
  const d = digitsOf(input);
  if (d.length === 0) return "Telefon raqamini kiriting";
  return normalizePhone(input) ? null : "Telefon raqami 9 ta raqamdan iborat (90 123 45 67)";
}

/** Click's SMS confirmation code: 4-8 digits (it sends 6). */
export function normalizeSmsCode(input: string): string | null {
  const d = digitsOf(input);
  return d.length >= 4 && d.length <= 8 ? d : null;
}

export function smsCodeError(input: string): string | null {
  const d = digitsOf(input);
  if (d.length === 0) return "SMS kodni kiriting";
  return normalizeSmsCode(input) ? null : "SMS kod 4-8 ta raqamdan iborat";
}
