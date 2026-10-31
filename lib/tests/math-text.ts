/**
 * «Test ishlash» -- question text with math: `$…$` marks a LaTeX formula, everything else is plain text (the transcription of
 * the BMB bank writes simple math as Unicode -- m³, × -- and only complex formulas as LaTeX). Pure (no DOM, no KaTeX): the
 * client component `components/tests/MathText.tsx` renders the `math` parts with the KaTeX the article viewer already uses.
 *
 * The delimiter rule is the usual one (Pandoc): the opening `$` is followed by a non-space and the closing `$` is preceded by
 * a non-space and not followed by a digit, so a price such as «$5 va $10» stays plain text. An unpaired `$` is plain text too;
 * a formula never spans a second `$`. There is no escaping: the bank has no literal dollar sign.
 */
export type MathPart = { math: false; text: string } | { math: true; latex: string; source: string };

const MATH_RE = /\$(?=[^\s$])([^$]*[^\s$])\$(?!\d)/g;

/** Splits a text into plain and formula parts, in order; the parts joined back (`source` for a formula) give the text again. */
export function splitMath(text: string): MathPart[] {
  const parts: MathPart[] = [];
  let at = 0;
  for (const m of text.matchAll(MATH_RE)) {
    const start = m.index ?? 0;
    if (start > at) parts.push({ math: false, text: text.slice(at, start) });
    parts.push({ math: true, latex: m[1]!, source: m[0] });
    at = start + m[0].length;
  }
  if (at < text.length) parts.push({ math: false, text: text.slice(at) });
  return parts;
}

/** `true` when the text holds at least one formula (the only case that needs KaTeX at all). */
export const hasMath = (text: string): boolean => splitMath(text).some((p) => p.math);
