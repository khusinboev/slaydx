"use client";

import { useMemo, useRef, useState } from "react";
import { sectionLabels } from "@/lib/generation/i18n";
import { columnPercents, evenPercents } from "@/lib/generation/table-columns";
import type { AcademicDoc } from "@/lib/generation/types";
import { LANDSCAPE, landscapeContentHeightPx } from "@/lib/viewers/metrics";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { TitleSheet } from "./TitlePage";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";

export function TableViewer({ doc }: { doc: AcademicDoc }) {
  const L = sectionLabels(doc.meta.language);
  const table = doc.tables?.[0];
  /*
   * Ilgari varaqqa QAT'IY 8 qator joylanardi. To'lib ketmasdi, lekin
   * yotiq varaqning yarmidan ko'pi bo'sh qolardi: 34 haftalik xarita
   * keraksiz ravishda 5 varaqqa cho'zilardi. Endi qator balandligi
   * o'lchanadi. Chegaradan sarlavha qatori va izoh uchun joy ayiriladi.
   */
  const rows = useMemo(() => table?.rows ?? [], [table]);
  // Ustun kengliklari — DOCX bilan bir xil (`table-columns.ts`). O'lchov
  // ham, ko'rinish ham SHU kengliklarda chiziladi, aks holda o'lchangan
  // qator balandligi haqiqiysidan farq qilardi (matn boshqacha o'raladi).
  const cols = useMemo(
    () =>
      table?.widths ??
      columnPercents(table?.headers ?? []) ??
      evenPercents(table?.headers.length ?? 1),
    [table?.widths, table?.headers],
  );
  const colGroup = (
    <colgroup>
      {cols.map((w, i) => (
        <col key={i} style={{ width: `${w}%` }} />
      ))}
    </colgroup>
  );
  const { pages: measured, measureNode } = useMeasuredPages(
    rows,
    (r) => (
      <table className="word-table w-full text-[10pt]" style={{ tableLayout: "fixed" }}>
        {colGroup}
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
  // `ZOOM_STEPS` ichidan (`toolbar.tsx` `+`/`−` shu ro'yxatda yuradi).
  // Ilgari 80 edi — ro'yxatda yo'q, `indexOf` = -1, `+` darhol 150 ga,
  // `−` 50 ga sakrardi.
  const [zoom, setZoom] = useState(75);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = 2 + chunks.length;
  const [page, setPage] = useVisiblePage(scrollRef, () => refs.current, [total, zoom]);

  function go(n: number) {
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={total} onPage={go} onFit={() => setZoom(75)} />
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
            zoom={zoom} landscape
            innerRef={(el) => {
              refs.current[0] = el;
            }}
          />
          <ZoomFrame zoom={zoom / 100} width={LANDSCAPE.wPx} height={LANDSCAPE.hPx}>
            <div
              ref={(el) => {
                refs.current[1] = el;
              }}
              className="word-sheet word-sheet-ls"
            >
              <div className="word-inner word-inner-ls">
                <div className="mb-3 border-b-4 border-violet-600 pb-2">
                  <div className="text-[10pt] tracking-widest text-violet-700 uppercase">{L.viewerMap}</div>
                  <h1 className="text-[18pt] font-bold">{doc.meta.subject || doc.meta.topic}</h1>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3 text-[11pt]">
                  <Info k={L.fieldWeeklyHours} v={String(doc.meta.weeklyHours || "—")} />
                  <Info k={L.fieldTotalHours} v={String(doc.meta.totalHours || "—")} />
                  <Info k={L.fieldWeeks} v={String(table?.rows.length || "—")} />
                </div>
                {(doc.sections[0]?.blocks ?? []).map((b, i) => (
                  <p key={i} className="word-p text-[12pt]">
                    {b.text}
                  </p>
                ))}
              </div>
              <div className="word-footer-num">2</div>
            </div>
          </ZoomFrame>

          {chunks.map((rows, ci) => (
            <ZoomFrame key={ci} zoom={zoom / 100} width={LANDSCAPE.wPx} height={LANDSCAPE.hPx}>
              <div
                ref={(el) => {
                  refs.current[ci + 2] = el;
                }}
                className="word-sheet word-sheet-ls"
              >
                <div className="word-inner word-inner-ls">
                  <div className="mb-2 text-[11pt] font-bold text-violet-800">
                    {table?.caption}
                    {ci > 0 ? ` ${L.continued}` : ""}
                  </div>
                  <table className="word-table text-[10pt]" style={{ tableLayout: "fixed" }}>
                    {colGroup}
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
                <div className="word-footer-num">{ci + 3}</div>
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
