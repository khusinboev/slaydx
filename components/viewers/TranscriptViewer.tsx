"use client";

import { FileText } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import { languageLabel } from "@/lib/media/catalog-transcribe";
import { srtTime } from "@/lib/generation/studio/subtitles";
import { VideoViewer } from "./VideoViewer";

/**
 * Studio P10 «Transkripsiya» result (docs/studio/P10-SPEC.md): the subtitled clip when it was burned (`VideoViewer`
 * plays the result file), then the transcript and its cues — the SAME `doc.transcribe` the TXT / SRT / VTT downloads
 * and the burn are built from («ko'rdim = oldim»). Read-only: editing the text would drift from the subtitles.
 */
export function TranscriptViewer({ doc, gen }: { doc: AcademicDoc; gen: { id: string } }) {
  const t = doc.transcribe;
  if (!t) return null;
  return (
    <div className="flex flex-1 flex-col bg-[var(--bg,#fafafa)]" data-transcript-viewer>
      {t.burned && doc.video ? <VideoViewer doc={doc} gen={gen} /> : null}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-black/70">
          <FileText className="size-4 shrink-0" />
          <span className="font-medium">Transkripsiya</span>
          <span className="text-black/45">
            {languageLabel(t.language ?? t.requestedLanguage)} · {t.sourceSeconds} s{t.speakers ? " · gapiruvchilar ajratilgan" : ""}
          </span>
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-line text-black/85" data-transcript-text>
          {t.text || "Nutq topilmadi."}
        </p>
        {t.cues.length ? (
          <details className="rounded-[12px] border border-black/10 bg-white p-3" data-transcript-cues>
            <summary className="cursor-pointer text-[13.5px] font-semibold text-black/70">Subtitr qatorlari ({t.cues.length})</summary>
            <ol className="mt-2 flex flex-col gap-2">
              {t.cues.map((c, i) => (
                <li key={i} className="text-[13.5px] leading-snug">
                  <span className="font-mono text-[12px] text-black/45">
                    {srtTime(c.start)} → {srtTime(c.end)}
                  </span>
                  <br />
                  {c.lines.join(" / ")}
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </div>
  );
}
