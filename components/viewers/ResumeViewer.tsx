"use client";

import { useMemo, useState } from "react";
import type { AcademicDoc } from "@/lib/generation/types";
import { A4 } from "@/lib/viewers/metrics";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";

export function ResumeViewer({ doc }: { doc: AcademicDoc }) {
  const [zoom, setZoom] = useState(100);
  const name = doc.meta.author || "F.I.Sh";
  const role = doc.meta.topic;
  const byId = useMemo(() => Object.fromEntries(doc.sections.map((s) => [s.id, s])), [doc.sections]);
  const text = (id: string) => (byId[id]?.blocks ?? []).map((b) => b.text).join("\n");
  const contact = text("summary").split("\n")[1] || doc.meta.city;
  const summary = text("summary").split("\n")[0];

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar zoom={zoom} onZoom={setZoom} page={1} pages={1} onPage={() => undefined} />
      <Workspace>
        <ZoomFrame zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
          <div className="word-sheet overflow-hidden">
            <div className="flex h-full">
              <aside className="flex w-[72mm] flex-col bg-[#1c1917] px-6 py-8 text-[#f5f5f4]">
                <div className="text-[11px] tracking-[0.22em] text-orange-300 uppercase">Rezyume</div>
                <h1 className="mt-3 text-[22px] leading-tight font-semibold">{name}</h1>
                <p className="mt-2 text-[13px] text-orange-200">{role}</p>
                <div className="mt-8 text-[11px] tracking-wider text-stone-400 uppercase">Aloqa</div>
                <p className="mt-2 text-[12px] leading-relaxed text-stone-200">{contact}</p>
                <div className="mt-8 text-[11px] tracking-wider text-stone-400 uppercase">Ko‘nikmalar</div>
                <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-stone-200">{text("skills")}</p>
              </aside>
              <main className="flex-1 bg-white px-8 py-8 text-[#1c1917]">
                <Section title="Qisqacha">{summary}</Section>
                <Section title="Ish tajribasi">{text("exp")}</Section>
                <Section title="Ta’lim">{text("edu")}</Section>
              </main>
            </div>
          </div>
        </ZoomFrame>
      </Workspace>
    </div>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <section className="mb-6">
      <h2 className="border-b-2 border-orange-500 pb-1 text-[13px] font-semibold tracking-wider uppercase">{title}</h2>
      <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-line text-stone-800">{children}</p>
    </section>
  );
}
