"use client";

import { useMemo, useRef, useState } from "react";
import { sectionLabels } from "@/lib/generation/i18n";
import type { AcademicDoc, Block } from "@/lib/generation/types";
import { A4, resumeMainHeightPx } from "@/lib/viewers/metrics";
import { type TextSplitter } from "@/lib/viewers/split";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";

/** O'ng ustun oqimidagi band — DOCX `resumeBody` bilan bir xil tuzilma. */
type MainItem = { k: "h2" | "h3" | "li" | "p"; text: string };

/* Uzun blok ham Word kabi qator orasidan bo'linadi. */
const RESUME_SPLITTER: TextSplitter<MainItem> = {
  takeText: (it) => (it.k === "p" || it.k === "li" ? it.text : null),
  makePart: (it, part) => ({ ...it, text: part }),
};

/**
 * `main` ustuni py-8 (32px*2) chiqarilgach, HAQIQIY balandligi bo'yicha
 * o'lchanadi — sahifa raqami uchun ozgina joy qoldirilgan (`resumeMainHeightPx`).
 * Ilgari (AUDIT-6 B3) butun rezyume `overflow-hidden` bilan BITTA
 * varaqqa qat'iy qirqilardi: uzun tajriba pastdan jim yo'qolardi.
 * DOCX da esa `resumeBody` bitta jadval qatorini ATLEAST balandlikda
 * chizadi — Word uni kerak bo'lsa keyingi sahifaga o'tkazadi. Bu yerda
 * xuddi shunga o'xshab, yon panel HAR bir varaqda to'liq balandlikda
 * takrorlanadi, o'ng ustun esa kerakcha ko'p varaqqa bo'linadi.
 */

export function ResumeViewer({ doc }: { doc: AcademicDoc }) {
  const L = sectionLabels(doc.meta.language);
  const [zoom, setZoom] = useState(100);
  const name = doc.meta.author || "F.I.Sh";
  const role = doc.meta.topic;
  const byId = useMemo(() => Object.fromEntries(doc.sections.map((s) => [s.id, s])), [doc.sections]);
  const blocks = (id: string): Block[] => byId[id]?.blocks ?? [];
  const summaryBlocks = blocks("summary");
  const contact = summaryBlocks[1]?.text || doc.meta.city;
  const summary = summaryBlocks[0]?.text || "";
  const skills = blocks("skills").map((b) => b.text).join("\n");

  const mainItems = useMemo<MainItem[]>(() => {
    const out: MainItem[] = [];
    if (summary) {
      out.push({ k: "h2", text: byId.summary?.title || L.summary });
      out.push({ k: "p", text: summary });
    }
    for (const id of ["exp", "edu"] as const) {
      const bs = (byId[id]?.blocks ?? []).filter((b) => b.text.trim());
      if (!bs.length) continue;
      out.push({ k: "h2", text: byId[id]?.title || (id === "exp" ? L.experience : L.education) });
      for (const b of bs) out.push({ k: b.kind === "h3" ? "h3" : b.kind === "li" ? "li" : "p", text: b.text });
    }
    return out;
  }, [byId, summary, L.summary, L.experience, L.education]);

  const { pages: measured, measureNode } = useMeasuredPages(mainItems, (it) => <MainBlock item={it} />, {
    limit: resumeMainHeightPx(),
    className: "w-[calc(210mm-72mm-4rem)]",
    key: mainItems.map((it) => `${it.k}:${it.text.length}`).join("|"),
    split: RESUME_SPLITTER,
  });
  const pages = measured?.length ? measured : [mainItems];
  const total = pages.length;
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useVisiblePage(scrollRef, () => refs.current, [total, zoom]);

  function go(n: number) {
    const next = Math.max(1, Math.min(total, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={total} onPage={go} onFit={() => setZoom(100)} />
      <Workspace ref={scrollRef}>
        <div className="flex flex-col items-center gap-8">
          {pages.map((chunk, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="word-sheet overflow-hidden"
              >
                <div className="flex h-full">
                  <aside className="flex w-[72mm] flex-col bg-[#1c1917] px-6 py-8 text-[#f5f5f4]">
                    <div className="text-[11px] tracking-[0.22em] text-orange-300 uppercase">{L.viewerResume}</div>
                    <h1 className="mt-3 text-[22px] leading-tight font-semibold">{name}</h1>
                    <p className="mt-2 text-[13px] text-orange-200">{role}</p>
                    <div className="mt-8 text-[11px] tracking-wider text-stone-400 uppercase">{L.fieldContact}</div>
                    <p className="mt-2 text-[12px] leading-relaxed text-stone-200">{contact}</p>
                    {skills ? (
                      <>
                        <div className="mt-8 text-[11px] tracking-wider text-stone-400 uppercase">{L.skills}</div>
                        <p className="mt-2 text-[12px] leading-relaxed whitespace-pre-line text-stone-200">{skills}</p>
                      </>
                    ) : null}
                  </aside>
                  <main className="flex-1 bg-white px-8 py-8 text-[#1c1917]">
                    {chunk.map((it, j) => (
                      <MainBlock key={j} item={it} />
                    ))}
                  </main>
                </div>
                {total > 1 ? <div className="word-footer-num">{i + 1}</div> : null}
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
      {measureNode}
    </div>
  );
}

function MainBlock({ item }: { item: MainItem }) {
  if (item.k === "h2") {
    return (
      <h2 className="mt-6 border-b-2 border-orange-500 pb-1 text-[13px] font-semibold tracking-wider uppercase first:mt-0">
        {item.text}
      </h2>
    );
  }
  if (item.k === "h3") {
    // Ish joyi: yil — lavozim — tashkilot.
    return <p className="mt-3 text-[13px] leading-relaxed font-semibold text-stone-900 first:mt-0">{item.text}</p>;
  }
  if (item.k === "li") {
    return (
      <p className="mt-1 pl-4 -indent-3 text-[13px] leading-relaxed text-stone-800 before:mr-2 before:content-['•']">
        {item.text}
      </p>
    );
  }
  return <p className="mt-2 text-[13px] leading-relaxed text-stone-800 first:mt-0">{item.text}</p>;
}
