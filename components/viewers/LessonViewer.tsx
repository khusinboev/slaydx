"use client";

import { useRef, useState } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

export function LessonViewer({ doc }: { doc: AcademicDoc }) {
  const [zoom, setZoom] = useState(90);
  const [page, setPage] = useState(1);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const passport = doc.sections.find((s) => s.id === "passport") ?? doc.sections[0];
  const map = doc.sections.find((s) => s.id === "map") ?? doc.sections[1];
  const table = doc.tables?.[0];

  function go(n: number) {
    const next = Math.max(1, Math.min(2, n));
    setPage(next);
    refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={page} pages={2} onPage={go} />
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
          <ZoomFrame zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
            <div
              ref={(el) => {
                refs.current[1] = el;
              }}
              className="word-sheet"
            >
              <div className="word-inner">
                <div className="word-h1">{map?.title ?? "Dars xaritasi"}</div>
                {(map?.blocks ?? []).map((b, i) =>
                  b.kind === "h3" ? (
                    <div key={i} className="word-h3 text-emerald-800">
                      {b.text}
                    </div>
                  ) : (
                    <p key={i} className="word-p">
                      {b.text}
                    </p>
                  ),
                )}
                {table ? (
                  <>
                    <div className="mt-4 mb-1 text-center text-[12pt] italic">{table.caption}</div>
                    <table className="word-table">
                      <thead>
                        <tr>
                          {table.headers.map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (
                              <td key={j}>{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </div>
              <div className="word-footer-num">2</div>
            </div>
          </ZoomFrame>
        </div>
      </Workspace>
    </div>
  );
}
