"use client";

import Link from "next/link";
import { FileX, MoreHorizontal } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";
import type { ToolConfig } from "@/lib/types";
import { FilePreview } from "./FilePreview";
import { formatFileDate } from "./file-meta";
import { cn } from "@/lib/cn";

/**
 * File card for phones (docs/mobile/PLAN.md O7): two to a row, preview on
 * top, the title clamped to TWO lines (full text in `aria-label`), one meta
 * line «type · date» and a 44 px «⋯» button — delete moved out of the
 * thumb-reach of the title link into `FileMenu`.
 */
export function PhoneFileCard({
  gen,
  tool,
  onMenu,
}: {
  gen: ServerGeneration;
  tool: ToolConfig | undefined;
  onMenu: (id: string) => void;
}) {
  const done = gen.status === "COMPLETED";
  const when = formatFileDate(gen.finishedAt ?? gen.createdAt);
  // A failed or revoked card must say so (UX review m8) — otherwise it looks like a finished file.
  const ended = gen.status === "FAILED" ? "Xato" : gen.status === "REVOKED" ? "Bekor qilindi" : null;
  const meta = [tool?.title, done ? when : (ended ?? gen.step)].filter(Boolean).join(" · ");
  return (
    <div
      data-file-card
      data-card-layout="phone"
      className="border-border/60 bg-card relative overflow-hidden rounded-xl border"
    >
      {tool ? <div className="h-1" style={{ background: `rgb(${tool.tc})` }} /> : null}
      <Link href={`/uz/files/${gen.id}`} tabIndex={-1} aria-hidden className="bg-muted block h-28 overflow-hidden [&_[data-preview-title]]:pr-9">
        {gen.filesPurgedAt ? (
          <div
            className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1.5 text-xs"
            data-files-purged
          >
            <FileX className="size-7 opacity-60" />
            Fayl o‘chirilgan
          </div>
        ) : (
          <FilePreview gen={gen} />
        )}
      </Link>
      <div className="px-3 pt-2.5 pb-3">
        <Link
          href={`/uz/files/${gen.id}`}
          aria-label={gen.topic}
          data-file-title
          data-clamp="2"
          className="line-clamp-2 min-h-11 text-sm leading-5 font-medium break-words"
        >
          {gen.topic}
        </Link>
        <div
          data-file-meta
          data-file-status={ended ? gen.status.toLowerCase() : undefined}
          className={cn("mt-1 truncate text-xs", gen.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}
        >
          {meta}
        </div>
      </div>
      <button
        type="button"
        data-file-more
        aria-label={`${gen.topic} — amallar`}
        aria-haspopup="dialog"
        onClick={() => onMenu(gen.id)}
        className="absolute top-2 right-0 flex size-11 items-center justify-center"
      >
        <span className="bg-background/90 text-foreground flex size-8 items-center justify-center rounded-full shadow ring-1 ring-black/5">
          <MoreHorizontal className="size-5" />
        </span>
      </button>
    </div>
  );
}
