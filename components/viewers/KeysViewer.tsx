"use client";

import { useMemo, useRef, useState } from "react";
import type { AcademicDoc, Block } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

/** Keys oqimidagi band. `head` — yangi keysning boshi. */
type Item =
  | { k: "cover" }
  | { k: "head"; index: number; title: string }
  | { k: "block"; block: Block };

export function KeysViewer({ doc }: { doc: AcademicDoc }) {
  const intro = doc.sections.find((s) => s.id === "kirish");
  const cases = doc.sections.filter((s) => s.id !== "kirish");
  const [zoom, setZoom] = useState(90);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  /*
   * Ilgari har keys QAT'IY bitta varaqqa joylanardi va uzunligi hech
   * qachon tekshirilmasdi: vaziyat + 4 topshiriq + kalit varaqdan oshsa
   * matn chetdan chiqib ketardi. Endi keys yangi varaqdan boshlanadi
   * (tuzilma shuni talab qiladi), lekin sig'masa davom etadi.
   */
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [{ k: "cover" }];
    for (const b of intro?.blocks ?? []) out.push({ k: "block", block: b });
    cases.forEach((c, i) => {
      out.push({ k: "head", index: i + 1, title: c.title });
      for (const b of c.blocks) out.push({ k: "block", block: b });
    });
    return out;
  }, [intro, cases]);

  const { pages: measured, measureNode } = useMeasuredPages(
    items,
    (it) => <KeyBlock item={it} doc={doc} count={cases.length} />,
    {
      key: `${cases.length}:${items.length}`,
      breakBefore: (it) => it.k === "head",
    },
  );
  const pages = measured ?? [items];

  function go(n: number) {
    const next = Math.max(1, Math.min(pages.length, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={pages.length} onPage={go} />
      <Workspace>
        <div className="flex flex-col items-center gap-8">
          {pages.map((chunk, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="word-sheet"
              >
                <div className="word-inner">
                  {chunk.map((it, k) => (
                    <KeyBlock key={k} item={it} doc={doc} count={cases.length} />
                  ))}
                </div>
                {i === 0 ? null : <div className="word-footer-num">{i + 1}</div>}
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
      {measureNode}
    </div>
  );
}

function KeyBlock({ item, doc, count }: { item: Item; doc: AcademicDoc; count: number }) {
  if (item.k === "cover") {
    return (
      <div className="mb-6 border-b-4 border-amber-500 pb-3">
        <div className="text-[11pt] tracking-[0.2em] text-amber-700 uppercase">Kalitlar (keys)</div>
        <h1 className="mt-2 text-[18pt] font-bold">{doc.meta.topic}</h1>
        <p className="mt-1 text-[12pt]">{count} ta vaziyatli topshiriq</p>
      </div>
    );
  }
  if (item.k === "head") {
    return (
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[14pt] font-bold text-white">
          {item.index}
        </div>
        <h2 className="pt-1 text-[16pt] font-bold">{item.title}</h2>
      </div>
    );
  }
  const b = item.block;
  if (b.kind === "h3") return <div className="word-h3 text-amber-800">{b.text}</div>;
  if (b.kind === "li") {
    return (
      <div className="word-li">
        <span>•</span>
        <span>{b.text}</span>
      </div>
    );
  }
  return <p className="word-p">{b.text}</p>;
}
