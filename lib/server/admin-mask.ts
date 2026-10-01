import "server-only";

/**
 * PII masking for admin responses (plan §6.0 "Masking").
 *
 * Without `users.pii` an admin sees a masked phone and job inputs reduced to their
 * shape. Masking happens on the SERVER before serialisation; hiding a value in the UI
 * would still leak it in the JSON.
 */

const MASK = "•••";

/**
 * `+998901234567` -> `+998 ** *** ** 67`. Only the last two digits survive.
 * Accepts any separators. A non-Uzbek or malformed number keeps just its last two
 * digits (`+*****34`); fewer than 4 digits reveal nothing (`***`). `null`, blank
 * or non-string input -> `null`, so callers can tell "no phone" from "masked phone".
 */
export function maskPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.length === 12 && digits.startsWith("998")) return `+998 ** *** ** ${digits.slice(-2)}`;
  if (digits.length < 4) return "***";
  // Cap the star run so an absurdly long string cannot echo its length back at us.
  return `+${"*".repeat(Math.min(digits.length - 2, 15))}${digits.slice(-2)}`;
}

const MAX_DEPTH = 8;

/** Defines an own property even for the key `__proto__` (plain assignment would set the prototype). */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Keeps the shape (objects, arrays, keys, array length) but replaces every leaf. */
function maskDeep(v: unknown, depth: number): unknown {
  if (v === null) return null;
  if (typeof v !== "object") return MASK;
  if (depth >= MAX_DEPTH) return MASK;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) put(out, k, maskDeep(x, depth + 1));
  return out;
}

/**
 * `values_json` (the user's form inputs) for admin views.
 *
 * `reveal: true` (caller holds `users.pii`) returns the value untouched. Otherwise the
 * keys are kept so support can see WHICH fields were filled, plus the top-level `topic`
 * string (needed to recognise a job). Every other string, number or boolean becomes
 * `•••`; objects and arrays keep their shape. `null` stays `null` (still "empty").
 */
export function maskValues(values: unknown, opts: { reveal: boolean }): unknown {
  if (opts.reveal) return values;
  if (values === null || typeof values !== "object" || Array.isArray(values)) return maskDeep(values, 0);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(values as Record<string, unknown>)) {
    put(out, k, k === "topic" && typeof x === "string" ? x : maskDeep(x, 1));
  }
  return out;
}
