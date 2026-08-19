"use client";

import { useMemo, useRef, useState } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { LANDSCAPE, landscapeContentHeightPx } from "@/lib/viewers/metrics";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

export function TableViewer({ doc }: { doc: AcademicDoc }) {
  const table = doc.tables?.[0];
  /*
   * Ilgari varaqqa QAT'IY 8 qator joylanardi. To'lib ketmasdi, lekin
   * yotiq varaqning yarmidan ko'pi bo'sh qolardi: 34 haftalik xarita
   * keraksiz ravishda 5 varaqqa cho'zilardi. Endi qator balandligi
   * o'lchanadi. Chegaradan sarlavha qatori va izoh uchun joy ayiriladi.
   */
  const rows = useMemo(() => table?.rows ?? [], [table]);
  const { pages: measured, measureNode } = useMeasuredPages(
    rows,
    (r) => (
      <table className="word-table w-full text-[10pt]">
        <tbody>
          <tr>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        </tbody>
      </table>
    ),
    {
      limit: landscapeContentHeightPx() - 72,
      className: "!w-[269mm] !text-[10pt] !leading-snug",
      key: `${rows.length}:${table?.headers.length ?? 0}`,
    },
  );
  const chunks = measured?.length ? measured : [rows];
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
      {measureNode}
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
