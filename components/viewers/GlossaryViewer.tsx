"use client";

import { useMemo, useRef, useState } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

type Term = { term: string; def: string };

export function GlossaryViewer({ doc }: { doc: AcademicDoc }) {
  const terms: Term[] = useMemo(() => {
    if (doc.tables?.[0]) {
      return doc.tables[0].rows.map(([term, def]) => ({ term: term || "", def: def || "" }));
    }
    const out: Term[] = [];
    let cur: Term | null = null;
    for (const b of doc.sections.flatMap((s) => s.blocks)) {
      if (b.kind === "h3") {
        if (cur) out.push(cur);
        cur = { term: b.text, def: "" };
      } else if (cur && b.kind === "p") {
        cur.def = cur.def ? `${cur.def} ${b.text}` : b.text;
      }
    }
    if (cur) out.push(cur);
    return out;
  }, [doc]);

  /*
   * Ilgari varaqqa QAT'IY 8 ta atama joylanardi. Izoh 280 belgigacha
   * bo'lishi mumkin: 8 ta uzun atama ~1 180 px joy egallaydi, varaqda esa
   * ~970 px bor — oxirgi kartochka varaqdan chiqib ketardi. Endi
   * balandlik haqiqiy o'lchanadi.
   */
  const { pages: measured, measureNode } = useMeasuredPages(terms, (t) => <TermCard term={t} />, {
    key: terms.map((t) => t.term).join("|"),
  });
  const pages = measured ?? [terms];

  const [zoom, setZoom] = useState(90);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const total = 1 + pages.length;

  function go(n: number) {
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={total} onPage={go} />
      <Workspace>
        <div className="flex flex-col items-center gap-8">
          <ZoomFrame zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
            <div
              ref={(el) => {
                refs.current[0] = el;
              }}
              className="word-sheet"
            >
              <div className="word-inner">
                <div className="mb-6 border-b-4 border-pink-600 pb-3 text-center">
                  <div className="text-[11pt] tracking-[0.2em] text-pink-700 uppercase">Glossariy</div>
                  <h1 className="mt-2 text-[20pt] font-bold">{doc.meta.topic}</h1>
                  <p className="mt-2 text-[12pt]">{terms.length} ta atama</p>
                </div>
                {(doc.sections[0]?.blocks ?? []).map((b, i) => (
                  <p key={i} className="word-p">
                    {b.text}
                  </p>
                ))}
              </div>
              <div className="word-footer-num">1</div>
            </div>
          </ZoomFrame>

          {pages.map((chunk, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i + 1] = el;
                }}
                className="word-sheet"
              >
                <div className="word-inner">
                  {chunk.map((t) => (
                    <TermCard key={t.term} term={t} />
                  ))}
                </div>
                <div className="word-footer-num">{i + 2}</div>
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
      {measureNode}
    </div>
  );
}

function TermCard({ term }: { term: Term }) {
  return (
    <article className="mb-3 rounded-lg border border-pink-200 bg-pink-50/40 px-4 py-3">
      <h3 className="text-[13pt] font-bold text-pink-900">{term.term}</h3>
      <p className="mt-1 text-[12pt] leading-snug text-stone-800">{term.def}</p>
    </article>
  );
}
