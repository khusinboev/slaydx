"use client";

import { useEffect, useMemo, useState } from "react";
import { splitMath } from "@/lib/tests/math-text";

/**
 * Question text with `$…$` formulas (`lib/tests/math-text.ts`). Plain text -- most of the bank -- is returned as it is and never
 * loads KaTeX; a text with a formula loads it ONCE (a separate chunk, the page itself stays light) and renders each formula with
 * `renderToString`, the same call as the article viewer's `Formula` (`WordViewer.tsx`; CSS and fonts come from `globals.css`).
 * Until the chunk arrives (or when it cannot load) the formula shows as its LaTeX source, so the question is always readable.
 * `\displaystyle`: fractions keep their full size on a phone, an inline fraction is too small to read there.
 */
type Katex = typeof import("katex").default;
let katexLoad: Promise<Katex> | null = null;
const loadKatex = (): Promise<Katex> => (katexLoad ??= import("katex").then((m) => m.default));

export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  const needsMath = parts.some((p) => p.math);
  const [katex, setKatex] = useState<Katex | null>(null);
  useEffect(() => {
    if (!needsMath || katex) return;
    let alive = true;
    loadKatex().then(
      (k) => alive && setKatex(k),
      () => {
        katexLoad = null; // a later question may try again
      },
    );
    return () => {
      alive = false;
    };
  }, [needsMath, katex]);

  // One render per formula per text, not per re-render of the page (a tap on an option re-renders the question).
  const html = useMemo(
    () => parts.map((p) => (p.math && katex ? katex.renderToString(`\\displaystyle ${p.latex}`, { throwOnError: false, strict: "ignore" }) : null)),
    [parts, katex],
  );
  if (!needsMath) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) => {
        if (!p.math) return <span key={i}>{p.text}</span>;
        const h = html[i];
        return h ? <span key={i} data-tests-math dangerouslySetInnerHTML={{ __html: h }} /> : <span key={i}>{p.source}</span>;
      })}
    </>
  );
}
