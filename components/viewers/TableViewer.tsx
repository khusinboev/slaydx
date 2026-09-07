"use client";

import { useMemo, useRef, useState } from "react";
import { sectionLabels } from "@/lib/generation/i18n";
import { columnPercents, evenPercents } from "@/lib/generation/table-columns";
import type { AcademicDoc } from "@/lib/generation/types";
import { LANDSCAPE, landscapeContentHeightPx } from "@/lib/viewers/metrics";
import { type TextSplitter } from "@/lib/viewers/split";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { TitleSheet } from "./TitlePage";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";

type Item = { k: "cover"; label: string; topic: string; meta: [string, string][] } | { k: "intro"; text: string } | { k: "row"; row: string[] };

/* Uzun kirish matni qator orasidan bo'linadi (Word kabi). */
const TABLE_SPLITTER: TextSplitter<Item> = {
  takeText: (it) => (it.k === "intro" ? it.text : null),
  makePart: (it, part) => ({ ...it, text: part }),
};

/**
 * Kirish (fan pasporti) bo'limi — dvigatel `passport` id bilan yaratadi;
 * eski yozuvlarda `kirish` ham bo'lishi mumkin. Id topilmasa birinchi
 * bo'lim zaxira (html'dan qayta qurilgan doc'da id'lar `s0`…).
 */
function introBlocks(doc: AcademicDoc) {
  const s = doc.sections.find((x) => x.id === "passport" || x.id === "kirish") ?? doc.sections[0];
  return s?.blocks ?? [];
}

export function TableViewer({ doc }: { doc: AcademicDoc }) {
  const L = sectionLabels(doc.meta.language);
  const table = doc.tables?.[0];
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

  /*
   * Ilgari "kirish" varag'i (badge + sarlavha + meta-kartochkalar +
   * kirish matni) O'LCHANMAY qattiq bitta `word-sheet`ga chizilardi
   * (AUDIT-6 B2) — uzun kirish matni jim kesilardi. Endi u jadval
   * qatorlari bilan BIR XIL o'lchov oqimida: birinchi qator majburiy
   * yangi varaqdan boshlanadi (`breakBefore`), kirish esa kerak bo'lsa
   * bir necha varaqqa bo'linadi.
   */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      {
        k: "cover",
        label: L.viewerMap,
        topic: doc.meta.subject || doc.meta.topic,
        meta: [
          [L.fieldWeeklyHours, String(doc.meta.weeklyHours || "—")],
          [L.fieldTotalHours, String(doc.meta.totalHours || "—")],
          [L.fieldWeeks, String(rows.length || "—")],
        ],
      },
    ];
    for (const b of introBlocks(doc)) out.push({ k: "intro", text: b.text });
    for (const r of rows) out.push({ k: "row", row: r });
    return out;
  }, [doc, rows, L]);

  const { pages: measured, measureNode } = useMeasuredPages(
    items,
    (it) =>
      it.k === "row" ? (
        <table className="word-table w-full text-[10pt]" style={{ tableLayout: "fixed" }}>
          {colGroup}
          <tbody>
            <tr>
              {it.row.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          </tbody>
        </table>
      ) : (
        <TableCoverBlock item={it} />
      ),
    {
      limit: landscapeContentHeightPx() - 72,
      className: "!w-[269mm] !text-[10pt] !leading-snug",
      breakBefore: (it, i) => it.k === "row" && items[i - 1]?.k !== "row",
      key: `${rows.length}:${table?.headers.length ?? 0}:${doc.sections[0]?.blocks.length ?? 0}`,
      split: TABLE_SPLITTER,
    },
  );
  const pages = measured?.length ? measured : [items];
  // `ZOOM_STEPS` ichidan (`toolbar.tsx` `+`/`−` shu ro'yxatda yuradi).
  // Ilgari 80 edi — ro'yxatda yo'q, `indexOf` = -1, `+` darhol 150 ga,
  // `−` 50 ga sakrardi.
  const [zoom, setZoom] = useState(75);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const total = 1 + pages.length;
  const [page, setPage] = useVisiblePage(scrollRef, () => refs.current, [total, zoom]);

  function go(n: number) {
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Sahifadagi ilk qator jadval boshi bilan bir xil "davomi" belgisini
  // olishi uchun — har bo'lakning o'zidan oldin "row" bo'lgan-bo'lmaganini
  // bilish kerak: agar bo'lak "row" bilan boshlansa va bu ENG BIRINCHI
  // "row" guruhi bo'lmasa, sarlavha "davomi" bo'ladi.
  let sawFirstRow = false;

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
            zoom={zoom}
            landscape
            innerRef={(el) => {
              refs.current[0] = el;
            }}
          />

          {pages.map((chunk, i) => {
            const isTablePage = chunk[0]?.k === "row";
            const continued = isTablePage && sawFirstRow;
            if (isTablePage) sawFirstRow = true;
            return (
              <ZoomFrame key={i} zoom={zoom / 100} width={LANDSCAPE.wPx} height={LANDSCAPE.hPx}>
                <div
                  ref={(el) => {
                    refs.current[i + 1] = el;
                  }}
                  className="word-sheet word-sheet-ls"
                >
                  <div className="word-inner word-inner-ls">
                    {isTablePage ? (
                      <>
                        <div className="mb-2 text-[11pt] font-bold text-violet-800">
                          {table?.caption}
                          {continued ? ` ${L.continued}` : ""}
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
                            {chunk.map((it, j) =>
                              it.k === "row" ? (
                                <tr key={j}>
                                  {it.row.map((c, k) => (
                                    <td key={k}>{c}</td>
                                  ))}
                                </tr>
                              ) : null,
                            )}
                          </tbody>
                        </table>
                      </>
                    ) : (
                      chunk.map((it, j) => <TableCoverBlock key={j} item={it} />)
                    )}
                  </div>
                  <div className="word-footer-num">{i + 2}</div>
                </div>
              </ZoomFrame>
            );
          })}
        </div>
      </Workspace>
      {measureNode}
    </div>
  );
}

function TableCoverBlock({ item }: { item: Item }) {
  if (item.k === "cover") {
    return (
      <div className="mb-3 border-b-4 border-violet-600 pb-2">
        <div className="text-[10pt] tracking-widest text-violet-700 uppercase">{item.label}</div>
        <h1 className="text-[18pt] font-bold">{item.topic}</h1>
        <div className="mt-3 grid grid-cols-3 gap-3 text-[11pt]">
          {item.meta.map(([k, v]) => (
            <Info key={k} k={k} v={v} />
          ))}
        </div>
      </div>
    );
  }
  if (item.k === "intro") return <p className="word-p text-[12pt]">{item.text}</p>;
  return null;
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-violet-200 bg-violet-50 px-3 py-2">
      <div className="text-[9pt] tracking-wide text-violet-700 uppercase">{k}</div>
      <div className="text-[14pt] font-semibold">{v}</div>
    </div>
  );
}
