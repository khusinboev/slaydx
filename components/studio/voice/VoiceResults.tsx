"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Clapperboard, Download, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { useApiSrc } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { currentDeliveryEnv, deliver, markGesture, type ReadyFile } from "@/lib/downloads/deliver";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import type { StudioJob } from "../StudioResults";
import { useMixHandoff } from "../audio/mix-handoff";

const ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** The MP3 through the delivery driver (session fetch → blob → download); inside Telegram the result page opens instead. */
async function downloadMp3(id: string, openPage: () => void): Promise<void> {
  markGesture();
  const env = currentDeliveryEnv();
  if (env.capability !== "browser") {
    openPage();
    return;
  }
  const file: ReadyFile = { format: "native", url: `/api/generations/${id}/file`, fileName: "studio-audio.mp3", size: 0, mime: "audio/mpeg", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() };
  try {
    await deliver(file, env);
  } catch {
    openPage();
  }
}

/**
 * The «Ovoz» tab's results, newest first: a waiting job shows the app's progress panel, a finished one plays here (the
 * result file itself, `?inline=1`) with «Yuklab olish (MP3)» and «Qayta»; a failed one says why (refunded in full).
 */
export function VoiceResults({ jobs, busy, onAgain }: { jobs: readonly StudioJob[]; busy: boolean; onAgain?: (job: StudioJob) => void }) {
  if (jobs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4" data-studio-jobs aria-label="Audiolar">
      {jobs.map((job) => (
        <li key={job.id} data-studio-job={job.id} data-job-status={job.gen?.status ?? "QUEUED"}>
          <JobCard job={job} busy={busy} onAgain={onAgain} />
        </li>
      ))}
    </ul>
  );
}

function JobCard({ job, busy, onAgain }: { job: StudioJob; busy: boolean; onAgain?: (j: StudioJob) => void }) {
  const gen = job.gen;
  if (job.error && !gen) return <Failure job={job} message={`${job.error} Natija baribir tayyor bo‘lishi mumkin — «Ishlarim»ni tekshiring.`} busy={busy} onAgain={onAgain} />;
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
  if (gen.status === "COMPLETED") return <Audio job={job} gen={gen} busy={busy} onAgain={onAgain} />;
  const message = gen.status === "FAILED" ? gen.error || "Ovoz yaratilmadi. Pul balansingizga qaytarildi." : "Ish bekor qilindi.";
  return <Failure job={job} message={message} busy={busy} onAgain={onAgain} />;
}

function Failure({ job, message, busy, onAgain }: { job: StudioJob; message: string; busy: boolean; onAgain?: (j: StudioJob) => void }) {
  return (
    <div className="bg-card rounded-[20px] border p-5" data-studio-failed>
      <p role="alert" className="text-destructive text-[14.5px] leading-snug">
        {message}
      </p>
      {onAgain ? (
        <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={cn(ACTION, "mt-3")}>
          <RefreshCw className="size-4" aria-hidden />
          Qayta urinish
        </button>
      ) : null}
    </div>
  );
}

function Audio({ job, gen, busy, onAgain }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain?: (j: StudioJob) => void }) {
  const router = useRouter();
  const page = `/uz/files/${job.id}`;
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  // P6: an «Audio» result carries `doc.studioAudio` (same player, same download).
  const seconds = gen.doc?.speech?.seconds ?? gen.doc?.studioAudio?.seconds ?? gen.doc?.mix?.seconds;
  // P8c «Keyingi qadam» → «Montaj»: any finished audio can go onto a video; a speech (not music / an effect / a mix) can
  // also take background music. The handoff pre-picks this result; the «Montaj» button is the priced job.
  const toMix = useMixHandoff();
  const mode = gen.doc?.studioAudio?.mode;
  const speechLike = !gen.doc?.mix && mode !== "music" && mode !== "sfx";
  return (
    <article className="bg-card flex flex-col gap-2.5 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]" data-studio-audio>
      <audio className="w-full" controls preload="metadata" src={src} data-audio-result>
        Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
      </audio>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[14.5px] leading-snug break-words" data-studio-job-prompt>
          {job.prompt}
        </p>
        <p className="text-muted-foreground mt-0.5 text-[12.5px]" data-studio-job-meta>
          {job.modelLabel}
          {seconds ? ` · ${Math.round(seconds)} s` : ""} · {formatSom(job.price)}
        </p>
      </div>
      <div className={cn("grid gap-1.5", onAgain ? "grid-cols-2" : "grid-cols-1")}>
        <button type="button" data-result-action="download" onClick={() => void downloadMp3(job.id, () => router.push(page))} className={ACTION}>
          <Download className="size-4" aria-hidden />
          Yuklab olish (MP3)
        </button>
        {onAgain ? (
          <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={ACTION}>
            <RefreshCw className="size-4" aria-hidden />
            Qayta
          </button>
        ) : null}
      </div>
      {toMix ? (
        <div className="flex flex-col gap-1.5" data-next-step aria-label="Keyingi qadam" role="group">
          <p className="text-muted-foreground text-[12.5px] font-semibold">Keyingi qadam</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <button type="button" data-result-action="to-mix-audio" onClick={() => toMix("audio", job.id)} className={ACTION}>
              <Clapperboard className="size-4" aria-hidden />
              Videoga qo‘shish
            </button>
            {speechLike ? (
              <button type="button" data-result-action="to-mix-music" onClick={() => toMix("speech", job.id)} className={ACTION}>
                <AudioLines className="size-4" aria-hidden />
                Fon musiqa qo‘shish
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <Link href={page} data-result-open className="text-accent-soft-foreground pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center w-fit text-[13.5px] font-semibold underline underline-offset-2">
        To‘liq ko‘rish va ulashish →
      </Link>
    </article>
  );
}
