"use client";

import { useMemo, useRef, useState } from "react";
import { sectionLabels } from "@/lib/generation/i18n";
import { columnPercents, evenPercents } from "@/lib/generation/table-columns";
import { languageName } from "@/lib/languages";
import type { AcademicDoc, DocTable } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { type TextSplitter } from "@/lib/viewers/split";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { TitleSheet } from "./TitlePage";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";

/** Dars xaritasi oqimidagi band. */
type Item =
  | { k: "cover"; label: string; topic: string; meta: [string, string][] }
  | { k: "intro"; text: string }
  | { k: "h1" | "h3" | "p"; text: string }
  | { k: "table"; table: DocTable };

/* Uzun kirish/dars matni qator orasidan bo'linadi (Word kabi). */
const LESSON_SPLITTER: TextSplitter<Item> = {
  takeText: (it) => (it.k === "intro" || it.k === "p" ? it.text : null),
  makePart: (it, part) => ({ ...it, text: part }),
};

export function LessonViewer({ doc }: { doc: AcademicDoc }) {
  const L = sectionLabels(doc.meta.language);
  const [zoom, setZoom] = useState(90);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const passport = doc.sections.find((s) => s.id === "passport") ?? doc.sections[0];
  const map = doc.sections.find((s) => s.id === "map") ?? doc.sections[1];
  const table = doc.tables?.[0];

  /*
   * Ilgari "pasport" varag'i (badge + sarlavha + meta-jadval + kirish
   * matni) O'LCHANMAY qattiq bitta `word-sheet`ga chizilardi
   * (AUDIT-6 B2) — uzun kirish matni jim kesilardi. Endi u dars
   * xaritasi bilan BIR XIL o'lchov oqimida: xarita (`h1`) majburiy
   * yangi varaqdan boshlanadi (`breakBefore`), pasport esa kerak
   * bo'lsa bir necha varaqqa bo'linadi.
   */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      {
        k: "cover",
        label: L.viewerLesson,
        topic: doc.meta.topic,
        meta: [
          [L.fieldSubject, doc.meta.subject || "—"],
          [L.fieldGrade, String(doc.meta.grade || "—")],
          [L.fieldDuration, `${doc.meta.duration || 45} ${L.minutesShort}`],
          [L.fieldLanguage, languageName(doc.meta.language)],
        ],
      },
    ];
    for (const b of passport?.blocks ?? []) out.push({ k: "intro", text: b.text });
    out.push({ k: "h1", text: map?.title ?? L.lessonMap });
    for (const b of map?.blocks ?? []) out.push({ k: b.kind === "h3" ? "h3" : "p", text: b.text });
    if (table) out.push({ k: "table", table });
    return out;
  }, [doc, passport, map, table, L]);

  const { pages: measured, measureNode } = useMeasuredPages(items, (it) => <LessonBlock item={it} />, {
    breakBefore: (it) => it.k === "h1",
    key: `${items.length}:${passport?.blocks.length ?? 0}:${map?.blocks.length ?? 0}:${table?.rows.length ?? 0}`,
    split: LESSON_SPLITTER,
  });
  const pages = measured?.length ? measured : [items];
  const total = pages.length;
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
                  {chunk.map((it, k) => (
                    <LessonBlock key={k} item={it} />
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

function LessonBlock({ item }: { item: Item }) {
  if (item.k === "cover") {
    return (
      <div className="mb-4 border-b-4 border-emerald-600 pb-3">
        <div className="text-[11pt] tracking-widest text-emerald-700 uppercase">{item.label}</div>
        <h1 className="mt-1 text-[18pt] font-bold">{item.topic}</h1>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12pt]">
          {item.meta.map(([k, v]) => (
            <div key={k}>
              {k}: {v}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (item.k === "intro") return <p className="word-p">{item.text}</p>;
  if (item.k === "table") {
    // Ustun kengliklari — DOCX bilan bir xil: jadval bergani ustun (B5),
    // bo'lmasa `table-columns.ts` (A9).
    const cols = item.table.widths ?? columnPercents(item.table.headers) ?? evenPercents(item.table.headers.length);
    return (
      <div>
        {item.table.caption ? (
          <div className="mt-4 mb-1 text-center text-[12pt] italic">{item.table.caption}</div>
        ) : null}
        <table className="word-table" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {cols.map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {item.table.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (item.k === "h1") return <div className="word-h1">{item.text}</div>;
  if (item.k === "h3") return <div className="word-h3 text-emerald-800">{item.text}</div>;
  return <p className="word-p">{item.text}</p>;
}
