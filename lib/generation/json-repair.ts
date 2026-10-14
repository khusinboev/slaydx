/**
 * Lenient, SYNTAX-ONLY JSON rewriter for LLM answers (slide bad_json incident,
 * docs/llm/SLIDE-BAD-JSON.md).
 *
 * `rewriteLenient` walks the text once with a recursive descent and re-emits it
 * as strict JSON text. It only fixes how a value is WRITTEN, never what it says:
 * it never adds a key, a value or a word, never guesses a missing field and never
 * evals anything. Anything it cannot place (a mismatched bracket, a bare word,
 * garbage between pairs) makes the whole attempt fail (`null`), so the caller
 * falls back to the old behaviour (`null` = "the model did not answer").
 *
 * Repairs (each one is reported by name so production can count them):
 *   trailing_comma / extra_comma - `[1,2,]`, `{"a":1,,"b":2}`
 *   missing_comma                - `"a":1 "b":2` or `{...} {...}` inside an array
 *   control_chars                - raw newline / tab / other control char inside a string
 *   bad_escape                   - `\_`, `\(`, `\alpha`, `\'`, a `\u` without four hex digits
 *   inner_quotes                 - an unescaped `"` inside a string (`O"zbekiston`)
 *   smart_quote_delimiters       - `{“title”: “x”}` (typographic quotes used as delimiters)
 *   duplicate_object             - the same top-level value written twice
 *   multi_object                 - NDJSON / several top-level objects (returned as an array)
 *   extra_fragment               - a complete value followed by a cut-off second one (the fragment is dropped)
 *   stray_chars                  - NBSP, zero-width space, control characters between tokens
 *
 * The caller (`json.ts`) adds `fence`, `prose`, `bom` and `truncated`.
 *
 * Text cut by the output limit is NOT closed here: the rewriter stops at the end
 * of input, flags `incomplete`, and `json.ts repairTruncated` does the closing.
 */

export type RepairKind =
  | "bom"
  | "fence"
  | "prose"
  | "trailing_comma"
  | "extra_comma"
  | "missing_comma"
  | "control_chars"
  | "bad_escape"
  | "inner_quotes"
  | "smart_quote_delimiters"
  | "duplicate_object"
  | "multi_object"
  | "extra_fragment"
  | "stray_chars"
  | "truncated";

export type Rewrite = {
  /** Strict JSON text (unterminated when `incomplete`). */
  text: string;
  /** Input ended inside the value (output-limit cut) - `repairTruncated` must close it. */
  incomplete: boolean;
  repairs: RepairKind[];
};

/** Upper bounds: the rewriter is linear, but an answer this large is never a real deck. */
const MAX_INPUT = 2_000_000;
const MAX_DEPTH = 64;
const MAX_TOP_VALUES = 32;

class Fail extends Error {}

type Role = "top" | "key" | "value" | "elem";

const QUOTES = new Set(['"', "“", "”", "„", "‟"]);
const isQuote = (c: string | undefined): boolean => c !== undefined && QUOTES.has(c);
const isWs = (c: string): boolean => c === " " || c === "\n" || c === "\t" || c === "\r";

/** `"name"  :` - what a key looks like on a fresh line (missing-comma detector). */
const KEY_AHEAD = /^["“”„‟][^"“”„‟\\\n]{1,120}["“”„‟]\s*:/;
/** A scalar that may follow a comma in an array and is followed by `,` or `]`. */
const ELEM_AHEAD = /^(?:true|false|null|-?\d[\d.eE+-]*)\s*[,\]]/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const LITERALS = ["true", "false", "null"];

class Rewriter {
  i: number;
  incomplete = false;

  constructor(
    private readonly s: string,
    start: number,
    readonly repairs: Set<RepairKind>,
  ) {
    this.i = start;
  }

  skipWs(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        this.i += 1;
        continue;
      }
      // NBSP, BOM, zero-width space, line/paragraph separators and control characters are not JSON whitespace.
      if (c < 32 || c === 0xa0 || c === 0xfeff || c === 0x200b || c === 0x2028 || c === 0x2029) {
        this.repairs.add("stray_chars");
        this.i += 1;
        continue;
      }
      break;
    }
  }

  value(depth: number, role: Role): string {
    if (depth > MAX_DEPTH) throw new Fail();
    this.skipWs();
    const s = this.s;
    if (this.i >= s.length) {
      this.incomplete = true;
      return "";
    }
    const c = s[this.i];
    if (c === "{") return this.object(depth);
    if (c === "[") return this.array(depth);
    if (isQuote(c)) return this.string(role === "top" ? "value" : role);
    return this.scalar();
  }

  private scalar(): string {
    const s = this.s;
    const from = this.i;
    let j = from;
    while (j < s.length && /[-+.\dA-Za-z]/.test(s[j])) j += 1;
    const tok = s.slice(from, j);
    if (!tok) throw new Fail();
    const atEnd = j >= s.length;
    this.i = j;
    if (LITERALS.includes(tok) || NUMBER.test(tok)) return tok;
    // A literal or number cut by the end of input (`tru`, `-`, `12.`): the closer drops it.
    if (atEnd && (LITERALS.some((l) => l.startsWith(tok)) || /^-?\d*\.?\d*(?:[eE][+-]?\d*)?$/.test(tok))) {
      this.incomplete = true;
      return tok;
    }
    throw new Fail();
  }

  /** Does the quote at `at` end the string, judging by what follows it? */
  private closes(at: number, role: Role): boolean {
    const s = this.s;
    let j = at + 1;
    let newline = false;
    while (j < s.length && isWs(s[j])) {
      if (s[j] === "\n") newline = true;
      j += 1;
    }
    if (j >= s.length) return true;
    const n = s[j];
    if (role === "key") return n === ":";
    if (role === "value") {
      if (n === "}") return true;
      if (n === ",") return this.commaThen(j + 1, "obj");
      // Newline and then a new `"key":` - the comma between two pairs is missing.
      return newline && KEY_AHEAD.test(s.slice(j, j + 140));
    }
    // elem
    if (n === "]") return true;
    if (n === ",") return this.commaThen(j + 1, "arr");
    return newline && isQuote(n);
  }

  /** After a comma: is what follows a plausible next key / element / closer? */
  private commaThen(from: number, ctx: "obj" | "arr"): boolean {
    const s = this.s;
    let j = from;
    while (j < s.length && isWs(s[j])) j += 1;
    if (j >= s.length) return true;
    const n = s[j];
    if (ctx === "obj") return isQuote(n) || n === "}";
    return isQuote(n) || n === "{" || n === "[" || n === "]" || ELEM_AHEAD.test(s.slice(j, j + 40));
  }

  private string(role: Role): string {
    const s = this.s;
    const open = s[this.i];
    const smartOpen = open !== '"';
    if (smartOpen) this.repairs.add("smart_quote_delimiters");
    let out = '"';
    this.i += 1;
    let run = this.i;
    const flush = (to: number) => {
      if (to > run) out += s.slice(run, to);
    };
    for (; this.i < s.length; this.i += 1) {
      const ch = s[this.i];
      const code = s.charCodeAt(this.i);
      if (ch === "\\") {
        flush(this.i);
        const next = s[this.i + 1];
        if (next === undefined) {
          // Cut right after a backslash: nothing to keep.
          this.i = s.length;
          run = this.i;
          break;
        }
        if (next === '"' || next === "\\" || next === "/" || next === "b" || next === "f" || next === "n" || next === "r" || next === "t") {
          out += ch + next;
          this.i += 1;
          run = this.i + 1;
          continue;
        }
        if (next === "u") {
          const hex = s.slice(this.i + 2, this.i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += `\\u${hex}`;
            this.i += 5;
            run = this.i + 1;
            continue;
          }
          if (this.i + 6 > s.length && /^[0-9a-fA-F]*$/.test(hex)) {
            // `\u00` and then the end of input: a cut escape, not a bad one.
            this.i = s.length;
            run = this.i;
            break;
          }
        }
        // Not a JSON escape (`\_`, `\(`, `\alpha`, `\'`): the backslash stays as TEXT; `\'` is just `'`.
        this.repairs.add("bad_escape");
        if (next === "'") {
          out += "'";
          this.i += 1;
        } else {
          out += "\\\\";
        }
        run = this.i + 1;
        continue;
      }
      if (code < 32) {
        flush(this.i);
        this.repairs.add("control_chars");
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
        run = this.i + 1;
        continue;
      }
      if (isQuote(ch) && (smartOpen || ch === '"')) {
        if (this.closes(this.i, role)) {
          flush(this.i);
          this.i += 1;
          return out + '"';
        }
        if (ch === '"') {
          flush(this.i);
          this.repairs.add("inner_quotes");
          out += '\\"';
          run = this.i + 1;
        }
      }
    }
    flush(s.length);
    this.incomplete = true;
    return out;
  }

  private object(depth: number): string {
    const s = this.s;
    this.i += 1;
    const parts: string[] = [];
    let pendingComma = false;
    for (;;) {
      this.skipWs();
      if (this.i >= s.length) {
        this.incomplete = true;
        return "{" + parts.join(",");
      }
      const c = s[this.i];
      if (c === "}") {
        this.i += 1;
        if (pendingComma) this.repairs.add("trailing_comma");
        return "{" + parts.join(",") + "}";
      }
      if (c === ",") {
        if (pendingComma || parts.length === 0) this.repairs.add("extra_comma");
        pendingComma = true;
        this.i += 1;
        continue;
      }
      if (!isQuote(c)) throw new Fail();
      pendingComma = false;
      let pair = this.string("key");
      if (this.incomplete) return "{" + [...parts, pair].join(",");
      this.skipWs();
      if (this.i >= s.length) {
        this.incomplete = true;
        return "{" + [...parts, pair].join(",");
      }
      if (s[this.i] !== ":") throw new Fail();
      this.i += 1;
      pair += ":" + this.value(depth + 1, "value");
      parts.push(pair);
      if (this.incomplete) return "{" + parts.join(",");
      this.skipWs();
      if (this.i >= s.length) {
        this.incomplete = true;
        return "{" + parts.join(",");
      }
      const n = s[this.i];
      if (n === ",") {
        pendingComma = true;
        this.i += 1;
      } else if (isQuote(n)) {
        this.repairs.add("missing_comma");
      } else if (n !== "}") {
        throw new Fail();
      }
    }
  }

  private array(depth: number): string {
    const s = this.s;
    this.i += 1;
    const parts: string[] = [];
    let pendingComma = false;
    for (;;) {
      this.skipWs();
      if (this.i >= s.length) {
        this.incomplete = true;
        return "[" + parts.join(",");
      }
      const c = s[this.i];
      if (c === "]") {
        this.i += 1;
        if (pendingComma) this.repairs.add("trailing_comma");
        return "[" + parts.join(",") + "]";
      }
      if (c === ",") {
        if (pendingComma || parts.length === 0) this.repairs.add("extra_comma");
        pendingComma = true;
        this.i += 1;
        continue;
      }
      if (c === "}") throw new Fail();
      pendingComma = false;
      parts.push(this.value(depth + 1, "elem"));
      if (this.incomplete) return "[" + parts.join(",");
      this.skipWs();
      if (this.i >= s.length) {
        this.incomplete = true;
        return "[" + parts.join(",");
      }
      const n = s[this.i];
      if (n === ",") {
        pendingComma = true;
        this.i += 1;
      } else if (n === "]") {
        // closed on the next turn
      } else if (n === "{" || n === "[" || isQuote(n) || /[-\dtfn]/.test(n)) {
        this.repairs.add("missing_comma");
      } else {
        throw new Fail();
      }
    }
  }
}

/**
 * Rewrites the JSON value (or several adjacent top-level values) starting at
 * `start` as strict JSON text. `null` - the text is not repairable by syntax alone.
 */
export function rewriteLenient(src: string, start: number): Rewrite | null {
  if (start < 0 || start >= src.length || src.length > MAX_INPUT) return null;
  const repairs = new Set<RepairKind>();
  const rw = new Rewriter(src, start, repairs);
  const texts: string[] = [];
  let sawMore = false;
  try {
    texts.push(rw.value(0, "top"));
    while (!rw.incomplete && texts.length < MAX_TOP_VALUES) {
      // A further value counts only when nothing but whitespace/commas separates it (NDJSON, a duplicated answer).
      let j = rw.i;
      while (j < src.length && (isWs(src[j]) || src[j] === ",")) j += 1;
      if (j >= src.length || (src[j] !== "{" && src[j] !== "[")) break;
      rw.i = j;
      sawMore = true;
      const text = rw.value(0, "top");
      if (rw.incomplete) {
        // The extra value was cut off - keep the complete ones, drop the fragment.
        rw.incomplete = false;
        break;
      }
      texts.push(text);
    }
  } catch (e) {
    if (e instanceof Fail) return null;
    throw e;
  }
  let text = texts[0];
  if (sawMore) {
    if (texts.length === 1) repairs.add("extra_fragment");
    else if (texts.every((t) => t === texts[0])) repairs.add("duplicate_object");
    else {
      repairs.add("multi_object");
      text = "[" + texts.join(",") + "]";
    }
  }
  return { text, incomplete: rw.incomplete, repairs: [...repairs] };
}
