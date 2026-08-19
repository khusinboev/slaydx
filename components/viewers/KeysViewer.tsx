"use client";

import { useRef, useState } from "react";
import type { AcademicDoc, DocSection } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

export function KeysViewer({ doc }: { doc: AcademicDoc }) {
  const intro = doc.sections.find((s) => s.id === "kirish");
  const cases = doc.sections.filter((s) => s.id !== "kirish");
  const sheets = [null, ...cases] as Array<DocSection | null>;
  const [zoom, setZoom] = useState(90);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  function go(n: number) {
    const next = Math.max(1, Math.min(sheets.length, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={sheets.length} onPage={go} />
      <Workspace>
        <div className="flex flex-col items-center gap-8">
          {sheets.map((section, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className="word-sheet"
              >
                <div className="word-inner">
                  {i === 0 ? (
                    <>
                      <div className="mb-6 border-b-4 border-amber-500 pb-3">
                        <div className="text-[11pt] tracking-[0.2em] text-amber-700 uppercase">Kalitlar (keys)</div>
                        <h1 className="mt-2 text-[18pt] font-bold">{doc.meta.topic}</h1>
                        <p className="mt-1 text-[12pt]">{cases.length} ta vaziyatli topshiriq</p>
                      </div>
                      {(intro?.blocks ?? []).map((b, k) => (
                        <p key={k} className="word-p">
                          {b.text}
                        </p>
                      ))}
                    </>
                  ) : (
                    <CaseCard section={section!} index={i} />
                  )}
                </div>
                {i === 0 ? null : <div className="word-footer-num">{i + 1}</div>}
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
    </div>
  );
}

function CaseCard({ section, index }: { section: DocSection; index: number }) {
  return (
    <div>
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-full bg-amber-500 text-[14pt] font-bold text-white">
          {index}
        </div>
        <h2 className="pt-1 text-[16pt] font-bold">{section.title}</h2>
      </div>
      {section.blocks.map((b, i) => {
        if (b.kind === "h3") return <div key={i} className="word-h3 text-amber-800">{b.text}</div>;
        if (b.kind === "li") {
          return (
            <div key={i} className="word-li">
              <span>•</span>
              <span>{b.text}</span>
            </div>
          );
        }
        return (
          <p key={i} className="word-p">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}
