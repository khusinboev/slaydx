"use client";

import { Video } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import { useApiSrc } from "@/lib/use-api-src";

/**
 * VIDEO KO'RUVCHISI (program-17 item 5) -- the result page of the `video` tool.
 *
 * «Ko'rdim = oldim»: the player plays EXACTLY the file the download gives (`/api/generations/{id}/file?inline=1`,
 * the `AudioViewer` pattern; the route answers HTTP Range requests for video, which iOS Safari requires). The
 * header's «Yuklab olish» / «Saqlash» / «Ulashish» (download formats registry) are the only download paths -- no
 * second link in here. `playsInline` keeps iOS from forcing full screen; `preload="metadata"` fetches no body
 * until the user presses play.
 */
export function VideoViewer({ doc, gen }: { doc: AcademicDoc; gen: { id: string } }) {
  const video = doc.video;
  // Bearer-mode webviews get the bytes through a `blob:` URL (docs/auth/COOKIELESS.md); unchanged otherwise.
  const src = useApiSrc(`/api/generations/${gen.id}/file?inline=1`);
  const vertical = video?.aspect === "9:16";

  return (
    <div className="flex flex-1 flex-col bg-[var(--bg,#fafafa)]" data-video-viewer>
      <div className="flex flex-1 flex-col items-center gap-4 px-4 py-5 sm:px-6">
        <div className="flex w-full max-w-3xl items-center gap-2 text-[13px] text-black/70">
          <Video className="size-4 shrink-0" />
          <span className="truncate font-medium">{doc.meta.topic}</span>
          {video ? <span className="text-black/40">{Math.round(video.seconds)} soniya</span> : null}
        </div>
        {video ? (
          <video
            className={`w-full rounded-[14px] bg-black ${vertical ? "max-h-[70vh] max-w-sm" : "max-w-3xl"}`}
            controls
            playsInline
            preload="metadata"
            src={src}
            data-video-player
          >
            Brauzeringiz videoni qo‘llab-quvvatlamaydi.
          </video>
        ) : (
          <p className="text-sm text-black/55">Video topilmadi.</p>
        )}
        {video ? (
          <p className="w-full max-w-3xl text-[14px] leading-relaxed text-black/70" data-video-prompt>
            {video.prompt}
          </p>
        ) : null}
      </div>
    </div>
  );
}
