"use client";

import Link from "next/link";
import { FileX, FolderOpen, Plus, RotateCw } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";
import { TOOL_BY_ID } from "@/lib/tools";
import { cn } from "@/lib/cn";
import { FilePreview } from "../FilePreview";
import { formatFileDate } from "../file-meta";
import { fileStatus, type FileTone } from "./hub-model";
import type { RecentState } from "./useRecentFiles";

const PILL: Record<FileTone, string> = {
  ok: "bg-[color-mix(in_oklab,var(--success)_16%,transparent)] text-badge-success-text",
  run: "bg-accent-soft text-accent-soft-foreground",
  error: "bg-[color-mix(in_oklab,var(--destructive)_14%,transparent)] text-badge-danger-text",
  muted: "bg-muted text-muted-foreground",
};

const ROW =
  "bg-card hover:border-primary/40 focus-visible:ring-ring flex min-h-[4.25rem] items-center gap-3 rounded-[18px] border p-2.5 shadow-[var(--shadow-card)] outline-none transition-colors focus-visible:ring-2";

/**
 * «Davom ettirish» body: up to three latest files (thumbnail, title, status
 * pill, kind · date) → the result page; a skeleton while the list loads; an
 * honest error with «Qayta urinish»; an empty state whose CTA opens the «+»
 * sheet. Signed out, the section is not drawn (the hub shows its login card).
 */
export function RecentFiles({ state, onCreate }: { state: RecentState; onCreate: () => void }) {
  if (state.phase === "signed-out") return null;
  if (state.phase === "loading") {
    return (
      <ul data-hub-recent="loading" aria-busy="true" aria-label="Fayllar yuklanmoqda" className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <li key={i} className={cn(ROW, "pointer-events-none")}>
            <span className="bg-muted slx-shimmer h-[45px] w-20 shrink-0 rounded-[10px]" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="bg-muted slx-shimmer h-4 w-4/5 rounded-md" />
              <span className="bg-muted slx-shimmer h-3.5 w-1/2 rounded-md" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (state.phase === "error") {
    return (
      <div data-hub-recent="error" role="alert" className="bg-card rounded-[var(--radius-card)] border px-5 py-6 text-center">
        <p className="text-[15.5px] font-semibold">Fayllar yuklanmadi</p>
        <p className="text-muted-foreground mt-1 text-[13.5px]">Internet yoki server bilan aloqa yo‘q. Birozdan so‘ng qayta urining.</p>
        <button
          type="button"
          data-hub-retry
          onClick={state.retry}
          className="bg-accent-soft text-foreground hover:bg-accent focus-visible:ring-ring mt-4 inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[15px] font-semibold outline-none focus-visible:ring-2"
        >
          <RotateCw className="text-accent-soft-foreground size-4" aria-hidden />
          Qayta urinish
        </button>
      </div>
    );
  }
  if (!state.files.length) {
    return (
      <div data-hub-recent="empty" className="bg-card rounded-[var(--radius-card)] border px-5 py-6 text-center">
        <span className="bg-accent-soft text-accent-soft-foreground mx-auto flex size-12 items-center justify-center rounded-2xl">
          <FolderOpen className="size-6" aria-hidden />
        </span>
        <p className="mt-3 text-[15.5px] font-semibold">Hozircha fayl yo‘q</p>
        <p className="text-muted-foreground mt-1 text-[13.5px]">Yaratgan ishlaringiz shu yerda chiqadi — davom ettirish bir bosishda.</p>
        <button
          type="button"
          data-hub-empty-create
          onClick={onCreate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mt-4 inline-flex h-11 items-center gap-2 rounded-2xl px-5 text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        >
          <Plus className="size-[18px]" aria-hidden />
          Birinchi ishni yaratish
        </button>
      </div>
    );
  }
  return (
    <ul data-hub-recent="ready" className="flex flex-col gap-2.5">
      {state.files.map((g) => (
        <li key={g.id}>
          <RecentRow gen={g} />
        </li>
      ))}
    </ul>
  );
}

function RecentRow({ gen }: { gen: ServerGeneration }) {
  const tool = TOOL_BY_ID[gen.type];
  const status = fileStatus(gen);
  const when = formatFileDate(gen.finishedAt ?? gen.createdAt);
  const kind = [tool?.title, when].filter(Boolean).join(" · ");
  return (
    <Link href={`/uz/files/${gen.id}`} data-hub-file={gen.id} className={ROW}>
      <span aria-hidden className="bg-muted relative h-[45px] w-20 shrink-0 overflow-hidden rounded-[10px] border border-black/5">
        {gen.filesPurgedAt ? (
          <span className="text-muted-foreground flex h-full items-center justify-center" data-files-purged>
            <FileX className="size-5 opacity-60" />
          </span>
        ) : (
          <FilePreview gen={gen} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span data-hub-file-title className="block truncate text-[15.5px] leading-snug font-semibold">
          {gen.topic}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-2">
          <span
            data-hub-file-status={status.tone}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[12.5px] leading-tight font-semibold tabular-nums", PILL[status.tone])}
          >
            {status.label}
          </span>
          <span className="text-muted-foreground min-w-0 truncate text-[13px]">{kind}</span>
        </span>
      </span>
    </Link>
  );
}
