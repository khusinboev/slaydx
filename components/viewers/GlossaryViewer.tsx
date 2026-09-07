"use client";

import { useMemo, useRef, useState } from "react";
import { sectionLabels } from "@/lib/generation/i18n";
import type { AcademicDoc } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { type TextSplitter } from "@/lib/viewers/split";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { TitleSheet } from "./TitlePage";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";

type Term = { term: string; def: string };
type Item = { k: "cover"; topic: string; countLabel: string; label: string } | { k: "intro"; text: string } | { k: "term"; term: Term };

/* Uzun kirish/atama izohi qator orasidan bo'linadi (Word kabi). */
const GLOSSARY_SPLITTER: TextSplitter<Item> = {
  takeText: (it) =>
    it.k === "intro" ? it.text : it.k === "term" && it.term.def ? it.term.def : null,
  makePart: (it, part) => (it.k === "term" ? { ...it, term: { ...it.term, def: part } } : { ...it, text: part }),
};

/**
 * Kirish bo'limi — dvigatel `kirish` id bilan yaratadi. Html'dan qayta
 * qurilgan eski yozuvda id'lar `s0`… — birinchi bo'lim zaxira.
 */
function introBlocks(doc: AcademicDoc) {
  const s = doc.sections.find((x) => x.id === "kirish") ?? doc.sections[0];
  return s?.blocks ?? [];
}

export function GlossaryViewer({ doc }: { doc: AcademicDoc }) {
  const L = sectionLabels(doc.meta.language);
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
   * Ilgari "kirish" varag'i (badge + sarlavha + kirish matni) O'LCHANMAY
   * qattiq bitta `word-sheet`ga chizilardi (AUDIT-6 B2) — uzun kirish
   * matni `.word-sheet{overflow:hidden}` ostida jim kesilardi. Endi u
   * ATAMALAR bilan BIR XIL o'lchov oqimida: "kirish -> atamalar" o'tishi
   * majburiy yangi varaqdan boshlanadi (`breakBefore`), lekin kirishning
   * o'zi kerak bo'lsa bir necha varaqqa bo'linadi.
   */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      { k: "cover", topic: doc.meta.topic, countLabel: L.unitTerms(terms.length), label: L.viewerGlossary },
    ];
    for (const b of introBlocks(doc)) out.push({ k: "intro", text: b.text });
    for (const t of terms) out.push({ k: "term", term: t });
    return out;
  }, [doc, terms, L]);

  const { pages: measured, measureNode } = useMeasuredPages(items, (it) => <GlossaryBlock item={it} />, {
    breakBefore: (it, i) => it.k === "term" && items[i - 1]?.k !== "term",
    key: `${doc.meta.topic}:${terms.length}:${doc.sections[0]?.blocks.length ?? 0}`,
    split: GLOSSARY_SPLITTER,
  });
  const pages = measured?.length ? measured : [items];

  const [zoom, setZoom] = useState(90);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = 1 + pages.length;
  const [page, setPage] = useVisiblePage(scrollRef, () => refs.current, [total, zoom]);

  function go(n: number) {
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={total} onPage={go} onFit={() => setZoom(90)} />
      <Workspace ref={scrollRef}>
        <div className="flex flex-col items-center gap-8">
          {/*
            Titul — DOCX dagi bilan AYNAN bir xil modeldan (P1-5).
            Ilgari bu ko'ruvchi o'z muqovasini chizar, titul esa faqat
            faylda bo'lardi: foydalanuvchi saytda ko'rgan hujjatning
            BIRINCHI SAHIFASI yuklab olinganida boshqa edi.
          */}
          <TitleSheet
            doc={doc}
            zoom={zoom}
            innerRef={(el) => {
              refs.current[0] = el;
            }}
          />

          {pages.map((chunk, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i + 1] = el;
                }}
                className="word-sheet"
              >
                <div className="word-inner">
                  {chunk.map((it, j) => (
                    <GlossaryBlock key={`${i}-${j}`} item={it} />
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

function GlossaryBlock({ item }: { item: Item }) {
  if (item.k === "cover") {
    return (
      <div className="mb-6 border-b-4 border-pink-600 pb-3 text-center">
        <div className="text-[11pt] tracking-[0.2em] text-pink-700 uppercase">{item.label}</div>
        <h1 className="mt-2 text-[20pt] font-bold">{item.topic}</h1>
        <p className="mt-2 text-[12pt]">{item.countLabel}</p>
      </div>
    );
  }
  if (item.k === "intro") return <p className="word-p">{item.text}</p>;
  return <TermCard term={item.term} />;
}

function TermCard({ term }: { term: Term }) {
  return (
    <article className="mb-3 rounded-lg border border-pink-200 bg-pink-50/40 px-4 py-3">
      <h3 className="text-[13pt] font-bold text-pink-900">{term.term}</h3>
      <p className="mt-1 text-[12pt] leading-snug text-stone-800">{term.def}</p>
    </article>
  );
}
