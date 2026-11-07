"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Download, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import type { GenImage } from "@/lib/generation/types";
import { ApiImg, useApiSrc } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { imageExt } from "@/lib/viewers/kind";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import { REFUND_PHRASE } from "@/lib/refund-phrase";
import { downloadStudioFile } from "../studio-download";
import { SentPrompt, retryLabel } from "../JobResult";
import type { StudioJob } from "../StudioResults";
import type { CompareKind } from "./compare-model";

/** One compare request the page follows: its prompt and its jobs' ids in tick order. */
export type CompareBatch = { group: string; prompt: string; ids: string[] };

const ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/**
 * Columns of a batch of `n`, by the width of the results COLUMN, not of the screen (beside the form on a tablet it is
 * 360 px): one until 32 rem, then two; three models from 56 rem, a fourth wraps. A cell stays wide enough for its progress panel.
 */
export function gridCols(n: number): string {
  return cn("grid grid-cols-1 gap-3 @lg:grid-cols-2", n >= 3 && "@4xl:grid-cols-3");
}

/**
 * «Solishtirish» results (docs/studio/P7-SPEC.md P7a): newest batch first, each a side-by-side grid — one cell per
 * model in tick order with its label and price, the progress while it runs, the picture(s) / clip when ready with
 * «Yuklab olish», and «Shu modelni tanlash» (compare off, that model chosen, the same prompt). A failed model says
 * so (its own refund); the others go on.
 */
export function CompareResults({
  kind,
  batches,
  jobs,
  onPick,
  onRetry,
  retryPrice,
  busy = false,
}: {
  kind: CompareKind;
  batches: readonly CompareBatch[];
  jobs: readonly StudioJob[];
  onPick: (modelId: string, prompt: string) => void;
  /** P11 §D: a failed cell is retried alone (absent = no retry button). */
  onRetry?: (job: StudioJob) => void;
  /** What that retry costs now; default = what the job cost. */
  retryPrice?: (job: StudioJob) => number;
  /** A submit is in flight: the retry waits. */
  busy?: boolean;
}) {
  if (batches.length === 0) return null;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return (
    <div className="@container flex flex-col gap-5" data-compare-results aria-label="Solishtirish natijalari">
      {batches.map((b) => (
        <section key={b.group} data-compare-batch={b.group} aria-label={`Solishtirish: ${b.prompt}`}>
          <p className="text-muted-foreground mb-2 line-clamp-2 text-[13.5px] break-words" data-compare-prompt>
            {b.prompt}
          </p>
          <ul className={gridCols(b.ids.length)}>
            {b.ids.map((id) => {
              const job = byId.get(id);
              return job ? (
                <li key={id} className="min-w-0" data-compare-cell={job.modelId} data-job-status={job.gen?.status ?? "QUEUED"}>
                  <Cell kind={kind} job={job} onPick={onPick} onRetry={onRetry} retryPrice={retryPrice} busy={busy} />
                </li>
              ) : null;
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Cell({ kind, job, onPick, onRetry, retryPrice, busy }: { kind: CompareKind; job: StudioJob; onPick: (modelId: string, prompt: string) => void; onRetry?: (job: StudioJob) => void; retryPrice?: (job: StudioJob) => number; busy: boolean }) {
  const gen = job.gen;
  const failed = (job.error && !gen) || (gen && gen.status !== "QUEUED" && gen.status !== "IN_PROGRESS" && gen.status !== "COMPLETED");
  const retryButton =
    failed && onRetry ? (
      <button type="button" data-compare-action="retry" disabled={busy} onClick={() => onRetry(job)} className={ACTION}>
        <RefreshCw className="size-4" aria-hidden />
        {retryLabel(retryPrice?.(job) ?? job.price)}
      </button>
    ) : null;
  const head = (
    <div className="flex items-baseline justify-between gap-2 px-3.5 pt-3">
      <p className="min-w-0 truncate text-[15px] font-bold" data-compare-model>
        {job.modelLabel}
      </p>
      <p className="text-muted-foreground shrink-0 text-[13px] tabular-nums" data-compare-price>
        {formatSom(job.price)}
      </p>
    </div>
  );
  const pick = (
    <button type="button" data-compare-action="pick" onClick={() => onPick(job.modelId, job.prompt)} className={ACTION}>
      <Check className="size-4" aria-hidden />
      Shu modelni tanlash
    </button>
  );
  let body: ReactNode;
  if (job.error && !gen) {
    body = <p role="alert" className="text-destructive px-3.5 text-[14px] leading-snug">{`${job.error} Ish baribir tugashi mumkin — Galereyani tekshiring.`}</p>;
  } else if (!gen || gen.status === "QUEUED" || gen.status === "IN_PROGRESS") {
    body = gen ? (
      <div className="px-1.5">
        <GenerationProgress gen={gen} />
      </div>
    ) : (
      <p className="text-muted-foreground px-3.5 text-[14px]" role="status" data-compare-pending>
        Navbatga qo‘yildi
      </p>
    );
  } else if (gen.status === "COMPLETED") {
    body = kind === "video" ? <Clip job={job} gen={gen} /> : <Pictures job={job} gen={gen} />;
  } else {
    body = (
      <p role="alert" className="text-destructive px-3.5 text-[14px] leading-snug" data-compare-failed>
        {gen.status === "FAILED" ? gen.error || `Bu model natija bermadi. ${REFUND_PHRASE}.` : "Ish bekor qilindi."}
      </p>
    );
  }
  return (
    <article className="bg-card flex h-full flex-col gap-3 overflow-hidden rounded-[20px] border pb-3.5 shadow-[var(--shadow-card)]">
      {head}
      <div className="flex-1">{body}</div>
      {gen?.status === "COMPLETED" && gen.doc?.sentPrompt ? (
        <div className="px-3.5">
          <SentPrompt text={gen.doc.sentPrompt} />
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5 px-3.5">
        {retryButton}
        {pick}
      </div>
    </article>
  );
}

function Pictures({ job, gen }: { job: StudioJob; gen: api.GenerationDetail }) {
  const router = useRouter();
  const images: GenImage[] = gen.doc?.images ?? [];
  const page = `/uz/files/${job.id}`;
  if (images.length === 0) {
    return (
      <p className="text-muted-foreground px-3.5 text-[14px]" data-compare-no-images>
        Rasm yaratilmadi. {REFUND_PHRASE}.
      </p>
    );
  }
  return (
    <div className={cn("grid gap-0.5", images.length > 1 && "grid-cols-2")} data-compare-pictures>
      {images.map((im, i) => (
        <figure key={im.id} className="bg-muted relative m-0">
          <ApiImg src={im.url} alt={im.alt || job.prompt} className="h-auto w-full object-cover" style={{ aspectRatio: im.w > 0 && im.h > 0 ? `${im.w} / ${im.h}` : "1 / 1" }} />
          <button
            type="button"
            data-compare-action="download"
            aria-label={images.length > 1 ? `${job.modelLabel}: ${i + 1}-rasmni yuklab olish` : `${job.modelLabel}: yuklab olish`}
            onClick={() => void downloadStudioFile({ url: im.url, fileName: `studio-${i + 1}.${imageExt(im.mime)}`, mime: im.mime ?? "image/png" }, () => router.push(page))}
            className="focus-visible:ring-ring absolute right-2 bottom-2 inline-flex size-11 items-center justify-center rounded-lg bg-black/70 text-white outline-none hover:bg-black/85 focus-visible:ring-2"
          >
            <Download className="size-[18px]" aria-hidden />
          </button>
        </figure>
      ))}
      <Link href={page} className="text-accent-soft-foreground col-span-full inline-flex min-h-11 items-center px-3.5 text-[13.5px] font-semibold underline underline-offset-2">
        To‘liq ko‘rish →
      </Link>
    </div>
  );
}

function Clip({ job, gen }: { job: StudioJob; gen: api.GenerationDetail }) {
  const router = useRouter();
  const page = `/uz/files/${job.id}`;
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  const video = gen.doc?.video;
  return (
    <div className="flex flex-col gap-2" data-compare-clip>
      <video className="w-full bg-black" controls playsInline preload="metadata" src={src}>
        Brauzeringiz videoni qo‘llab-quvvatlamaydi.
      </video>
      <div className="flex flex-col gap-1.5 px-3.5">
        {video ? <p className="text-muted-foreground text-[12.5px]">{Math.round(video.seconds)} soniya</p> : null}
        <button
          type="button"
          data-compare-action="download"
          onClick={() => void downloadStudioFile({ url: `/api/generations/${job.id}/file`, fileName: "studio-video.mp4", mime: "video/mp4" }, () => router.push(page))}
          className={ACTION}
        >
          <Download className="size-4" aria-hidden />
          Yuklab olish
        </button>
      </div>
    </div>
  );
}
