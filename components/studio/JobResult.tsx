"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { REFUND_PHRASE } from "@/lib/refund-phrase";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import type { StudioJob } from "./StudioResults";

/** The button of a result card. */
export const RESULT_ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** A retry is a new charge: the button says how much. */
export function retryLabel(price: number): string {
  return price > 0 ? `Qayta urinish · ${formatSom(price)}` : "Qayta urinish";
}

/** The tab's results, newest first. The `data-*` hooks are the shared contract of every Studio results list. */
export function JobList({ jobs, label, children }: { jobs: readonly StudioJob[]; label?: string; children: (job: StudioJob) => ReactNode }) {
  if (jobs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4" data-studio-jobs aria-label={label}>
      {jobs.map((job) => (
        <li key={job.id} data-studio-job={job.id} data-job-status={job.gen?.status ?? "QUEUED"}>
          {children(job)}
        </li>
      ))}
    </ul>
  );
}

/**
 * One job of a Studio tab through its life: queued, the app's progress panel, then `children` with the finished
 * generation; a failed or cancelled job says why and offers the priced retry.
 */
export function JobResult({
  job,
  busy,
  onAgain,
  retryPrice,
  failed,
  lost,
  children,
}: {
  job: StudioJob;
  /** A submit is in flight: the retry waits. */
  busy: boolean;
  /** Absent = no retry on this card. */
  onAgain?: (job: StudioJob) => void;
  /** What the retry costs now; default = what the job cost. */
  retryPrice?: (job: StudioJob) => number;
  /** The failure's first sentence when the server left no text («Rasm yaratilmadi»). */
  failed: string;
  /** Said after the polling gave up: the job may still finish on the server, before a retry charges again. */
  lost: string;
  children: (gen: api.GenerationDetail) => ReactNode;
}) {
  const gen = job.gen;
  const again = onAgain ? { onAgain, price: retryPrice?.(job) ?? job.price } : null;
  if (job.error && !gen) return <Failure job={job} message={`${job.error} ${lost}`} busy={busy} again={again} />;
  if (!gen) {
    return (
      <div className="bg-card rounded-[20px] border p-5" data-studio-pending role="status">
        <p className="font-medium">Navbatga qo‘yildi</p>
        <p className="text-muted-foreground mt-0.5 text-[14px]">
          {job.modelLabel} · {formatSom(job.price)}
        </p>
      </div>
    );
  }
  if (gen.status === "QUEUED" || gen.status === "IN_PROGRESS") return <GenerationProgress gen={gen} />;
  if (gen.status === "COMPLETED") return children(gen);
  const message = gen.status === "FAILED" ? gen.error || `${failed}. ${REFUND_PHRASE}.` : "Ish bekor qilindi.";
  return <Failure job={job} message={message} busy={busy} again={again} />;
}

function Failure({ job, message, busy, again }: { job: StudioJob; message: string; busy: boolean; again: { onAgain: (j: StudioJob) => void; price: number } | null }) {
  return (
    <div className="bg-card rounded-[20px] border p-5" data-studio-failed>
      <p role="alert" className="text-destructive text-[14.5px] leading-snug">
        {message}
      </p>
      {again ? (
        <button type="button" data-result-action="again" disabled={busy} onClick={() => again.onAgain(job)} className={cn(RESULT_ACTION, "mt-3")}>
          <RefreshCw className="size-4" aria-hidden />
          {retryLabel(again.price)}
        </button>
      ) : null}
    </div>
  );
}
