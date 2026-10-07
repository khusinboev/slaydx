"use client";

import Link from "next/link";
import { memo } from "react";
import { FileX, MoreHorizontal } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";
import type { ToolConfig } from "@/lib/types";
import { FilePreview } from "./FilePreview";
import { fileStatusPill, formatFileWhen, type FileStatusTone } from "./file-meta";
import { cn } from "@/lib/cn";

/**
 * File card of «Ishlarim» (redesign W2, variant A). One DOM for every size,
 * laid out by CSS:
 *   - below `md`: a list row — 16:9 thumbnail on the left, title (two lines,
 *     full text in `aria-label`), then the status pill and «kind · when»;
 *   - `md` and up: a grid card — thumbnail on top, text under it.
 * The title link is stretched over the whole card (one big target); the
 * 44 px «⋯» button sits above it and opens `FileMenu` (delete lives there,
 * out of reach of an accidental tap on the title).
 *
 * `memo`: list polling keeps unchanged rows as the same objects
 * (`lib/store.ts keepUnchanged`), so a finished card is not redrawn.
 */
export const PhoneFileCard = memo(function PhoneFileCard({
  gen,
  tool,
  onMenu,
  now,
}: {
  gen: ServerGeneration;
  tool: ToolConfig | undefined;
  onMenu: (id: string) => void;
  /** «Now» for today/yesterday times (Tashkent); the list passes one value for all cards. */
  now?: Date;
}) {
  const pill = fileStatusPill(gen.status, gen.progress);
  const running = gen.status === "QUEUED" || gen.status === "IN_PROGRESS";
  const when = formatFileWhen(gen.finishedAt ?? gen.createdAt, now);
  // A running job tells what it is doing («Matn · 7/12 slayd»); everything else tells when.
  const detail = running && gen.step && gen.step !== pill.label ? gen.step : when;
  const meta = [tool?.title, detail].filter(Boolean).join(" · ");
  const ended = gen.status === "FAILED" || gen.status === "REVOKED";
  const href = `/uz/files/${gen.id}`;
  return (
    <article
      data-file-card
      data-file-id={gen.id}
      className={cn(
        "group bg-card border-border/80 relative flex items-center gap-3 rounded-[18px] border py-2.5 pr-1 pl-2.5 shadow-[var(--shadow-card)] transition-colors",
        "hover:border-border md:h-full md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-[var(--radius-card)] md:p-0",
      )}
    >
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden
        data-file-thumb
        className="bg-muted relative block aspect-video w-[104px] shrink-0 overflow-hidden rounded-xl ring-1 ring-black/5 md:w-full md:rounded-none md:ring-0 dark:ring-white/5"
      >
        {gen.filesPurgedAt ? (
          /*
           * Retention (W2-D2): bonus-only document files were removed — a
           * thumbnail / image link would point at a deleted asset (404).
           */
          <div
            className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1 text-[12.5px]"
            data-files-purged
          >
            <FileX className="size-6 opacity-60" aria-hidden />
            <span className="hidden md:inline">Fayl o‘chirilgan</span>
          </div>
        ) : (
          <FilePreview gen={gen} />
        )}
      </Link>
      <div className="min-w-0 flex-1 md:flex md:flex-col md:px-4 md:pt-3 md:pr-12 md:pb-3.5">
        <Link
          href={href}
          aria-label={gen.topic}
          data-file-title
          data-clamp="2"
          className={cn(
            "text-foreground line-clamp-2 text-[15.5px] leading-[1.3] font-semibold break-words outline-none",
            // Stretched link: the whole card opens the file; the ring is drawn on the card.
            "after:absolute after:inset-0 after:rounded-[18px] after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-[var(--ring)] focus-visible:after:ring-inset md:after:rounded-[var(--radius-card)]",
          )}
        >
          {gen.topic}
        </Link>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:mt-auto md:pt-1.5">
          <StatusPill label={pill.label} tone={pill.tone} running={running} />
          <span
            data-file-meta
            data-file-status={ended ? gen.status.toLowerCase() : undefined}
            className="text-muted-foreground max-w-full min-w-0 truncate text-[13px] leading-5"
          >
            {tool ? (
              <span
                aria-hidden
                className="mr-1.5 inline-block size-2 rounded-full align-[1px]"
                style={{ background: `rgb(${tool.tc})` }}
              />
            ) : null}
            {meta}
          </span>
        </div>
      </div>
      <button
        type="button"
        data-file-more
        aria-label={`${gen.topic} — amallar`}
        aria-haspopup="dialog"
        onClick={() => onMenu(gen.id)}
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring relative z-10 flex size-11 shrink-0 items-center justify-center rounded-xl outline-none focus-visible:ring-2 md:absolute md:right-1 md:bottom-1.5"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
    </article>
  );
});

const PILL_TONE: Record<FileStatusTone, string> = {
  ok: "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-[var(--badge-success-text)]",
  run: "bg-accent-soft text-accent-soft-foreground",
  error: "bg-destructive/12 text-[var(--badge-danger-text)]",
  muted: "bg-muted text-muted-foreground",
};

/** «Tayyor» / «Navbatda» / «Yozilmoqda 62%» / «Xato» / «Bekor qilindi». */
export function StatusPill({ label, tone, running }: { label: string; tone: FileStatusTone; running?: boolean }) {
  return (
    <span
      data-status-pill={tone}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12.5px] leading-none font-semibold whitespace-nowrap tabular-nums",
        PILL_TONE[tone],
      )}
    >
      {running ? <span aria-hidden className="slx-shimmer size-1.5 rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}
