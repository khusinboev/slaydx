import { normalizeText } from "./normalize";

/**
 * 64-bit SimHash of a text (docs/market/PLAN.md §1.2, near-duplicate gate): near-identical bodies land within a Hamming
 * distance of 6, unrelated ones around 32. Word 3-shingles, hashed with FNV-1a 64. Pure and isomorphic.
 *
 * The value is a SIGNED 64-bit integer as a decimal string: that is what a Postgres BIGINT stores and a JS number cannot.
 * `BigInt(...)` calls instead of literals: the project's compile target predates them.
 */

const big = BigInt;
const ZERO = big(0);
const ONE = big(1);
const SHIFT_63 = big(63);
const SHIFT_64 = big(64);
const MASK = (ONE << SHIFT_64) - ONE;
const SIGN = ONE << SHIFT_63;
const WRAP = ONE << SHIFT_64;
const FNV_OFFSET = big("0xcbf29ce484222325");
const FNV_PRIME = big("0x100000001b3");

function fnv1a64(text: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= big(text.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK;
  }
  return h;
}

const toSigned = (u: bigint): bigint => (u >= SIGN ? u - WRAP : u);
const toUnsigned = (s: bigint): bigint => (s < ZERO ? s + WRAP : s);

/** The SimHash as a signed decimal string, ready for a BIGINT column. An empty text hashes to "0". */
export function simhash64(text: string): string {
  const words = normalizeText(text).split(" ").filter(Boolean);
  if (!words.length) return "0";
  const weights = new Int32Array(64);
  const span = Math.min(3, words.length);
  for (let i = 0; i + span <= words.length; i++) {
    const h = fnv1a64(words.slice(i, i + span).join(" "));
    for (let b = 0; b < 64; b++) weights[b] += ((h >> big(b)) & ONE) === ONE ? 1 : -1;
  }
  let out = ZERO;
  for (let b = 0; b < 64; b++) if (weights[b] > 0) out |= ONE << big(b);
  return toSigned(out).toString();
}

/** Number of differing bits between two `simhash64` values. */
export function hammingDistance(a: string, b: string): number {
  let x = toUnsigned(big(a)) ^ toUnsigned(big(b));
  let n = 0;
  while (x > ZERO) {
    n += Number(x & ONE);
    x >>= ONE;
  }
  return n;
}
