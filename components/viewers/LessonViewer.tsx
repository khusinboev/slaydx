"use client";

import { useMemo, useRef, useState } from "react";
import type { AcademicDoc, DocTable } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

/** Dars xaritasi oqimidagi band. */
type Item = { k: "h1" | "h3" | "p"; text: string } | { k: "table"; table: DocTable };

export function LessonViewer({ doc }: { doc: AcademicDoc }) {
  const [zoom, setZoom] = useState(90);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const passport = doc.sections.find((s) => s.id === "passport") ?? doc.sections[0];
  const map = doc.sections.find((s) => s.id === "map") ?? doc.sections[1];
  const table = doc.tables?.[0];

  /*
   * Ilgari ko'ruvchi QAT'IY 2 varaqdan iborat edi: ikkinchisiga oltita
   * bosqich (har biri sarlavha + 700 belgigacha matn) VA vaqt jadvali
   * birga tiqilardi. Natijada oxirgi bosqichlar varaqdan chiqib, qo'shni
   * varaq ustiga tushardi. Endi dars xaritasi o'lchanadi va kerak
   * bo'lgancha varaqqa bo'linadi.
   */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [{ k: "h1", text: map?.title ?? "Dars xaritasi" }];
    for (const b of map?.blocks ?? []) out.push({ k: b.kind === "h3" ? "h3" : "p", text: b.text });
    if (table) out.push({ k: "table", table });
    return out;
  }, [map, table]);

  const { pages: measured, measureNode } = useMeasuredPages(items, (it) => <LessonBlock item={it} />, {
    key: `${items.length}:${map?.blocks.length ?? 0}:${table?.rows.length ?? 0}`,
  });
  const mapPages = measured ?? [items];
  const total = 1 + mapPages.length;

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
                <div className="mb-4 border-b-4 border-emerald-600 pb-3">
                  <div className="text-[11pt] tracking-widest text-emerald-700 uppercase">Dars rejasi</div>
                  <h1 className="mt-1 text-[18pt] font-bold">{doc.meta.topic}</h1>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12pt]">
                    <div>Fan: {doc.meta.subject || "—"}</div>
                    <div>Sinf: {doc.meta.grade || "—"}</div>
                    <div>Davomiyligi: {doc.meta.duration || 45} daq</div>
                    <div>Til: {doc.meta.language}</div>
                  </div>
                </div>
                {(passport?.blocks ?? []).map((b, i) => (
                  <p key={i} className="word-p">
                    {b.text}
                  </p>
                ))}
              </div>
              <div className="word-footer-num">1</div>
            </div>
          </ZoomFrame>

          {mapPages.map((chunk, i) => (
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
  if (item.k === "table") {
    return (
      <div>
        {item.table.caption ? (
          <div className="mt-4 mb-1 text-center text-[12pt] italic">{item.table.caption}</div>
        ) : null}
        <table className="word-table">
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
