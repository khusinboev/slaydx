"use client";

import { useMemo, useRef, useState } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { LANDSCAPE } from "@/lib/viewers/metrics";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

const ROWS = 8;

export function TableViewer({ doc }: { doc: AcademicDoc }) {
  const table = doc.tables?.[0];
  const chunks = useMemo(() => {
    const rows = table?.rows ?? [];
    const out: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += ROWS) out.push(rows.slice(i, i + ROWS));
    return out.length ? out : [[]];
  }, [table]);
  const [zoom, setZoom] = useState(80);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const total = 1 + chunks.length;

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
          <ZoomFrame zoom={zoom / 100} width={LANDSCAPE.wPx} height={LANDSCAPE.hPx}>
            <div
              ref={(el) => {
                refs.current[0] = el;
              }}
              className="word-sheet word-sheet-ls"
            >
              <div className="word-inner word-inner-ls">
                <div className="mb-3 border-b-4 border-violet-600 pb-2">
                  <div className="text-[10pt] tracking-widest text-violet-700 uppercase">Texnologik xarita</div>
                  <h1 className="text-[18pt] font-bold">{doc.meta.subject || doc.meta.topic}</h1>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3 text-[11pt]">
                  <Info k="Haftalik soat" v={String(doc.meta.weeklyHours || "—")} />
                  <Info k="Jami soat" v={String(doc.meta.totalHours || "—")} />
                  <Info k="Haftalar" v={String(table?.rows.length || "—")} />
                </div>
                {(doc.sections[0]?.blocks ?? []).map((b, i) => (
                  <p key={i} className="word-p text-[12pt]">
                    {b.text}
                  </p>
                ))}
              </div>
              <div className="word-footer-num">1</div>
            </div>
          </ZoomFrame>

          {chunks.map((rows, ci) => (
            <ZoomFrame key={ci} zoom={zoom / 100} width={LANDSCAPE.wPx} height={LANDSCAPE.hPx}>
              <div
                ref={(el) => {
                  refs.current[ci + 1] = el;
                }}
                className="word-sheet word-sheet-ls"
              >
                <div className="word-inner word-inner-ls">
                  <div className="mb-2 text-[11pt] font-bold text-violet-800">
                    {table?.caption}
                    {ci > 0 ? " (davomi)" : ""}
                  </div>
                  <table className="word-table text-[10pt]">
                    <thead>
                      <tr className="bg-violet-50">
                        {(table?.headers ?? []).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="word-footer-num">{ci + 2}</div>
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2">
      <div className="text-[9pt] tracking-wide text-violet-700 uppercase">{k}</div>
      <div className="text-[14pt] font-semibold">{v}</div>
    </div>
  );
}
