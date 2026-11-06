"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Clapperboard, Download, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { useApiSrc } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { JobList, JobResult, RESULT_ACTION as ACTION } from "../JobResult";
import { downloadStudioFile } from "../studio-download";
import type { StudioJob } from "../StudioResults";
import { useMixHandoff } from "../audio/mix-handoff";

/**
 * The «Ovoz» tab's results, newest first: a waiting job shows the app's progress panel, a finished one plays here (the
 * result file itself, `?inline=1`) with «Yuklab olish (MP3)» and «Qayta»; a failed one says why (refunded in full).
 */
export function VoiceResults({
  jobs,
  busy,
  onAgain,
  retryPrice,
  failed = "Ovoz yaratilmadi",
}: {
  jobs: readonly StudioJob[];
  busy: boolean;
  onAgain?: (job: StudioJob) => void;
  retryPrice?: (job: StudioJob) => number;
  /** The failure's first sentence when the server left no text: the «Audio» tab's jobs are not all speech. */
  failed?: string;
}) {
  return (
    <JobList jobs={jobs} label="Audiolar">
      {(job) => (
        <JobResult job={job} busy={busy} onAgain={onAgain} retryPrice={retryPrice} failed={failed} lost="Natija baribir tayyor bo‘lishi mumkin — «Ishlarim»ni tekshiring.">
          {(gen) => <Audio job={job} gen={gen} busy={busy} onAgain={onAgain} />}
        </JobResult>
      )}
    </JobList>
  );
}

function Audio({ job, gen, busy, onAgain }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain?: (j: StudioJob) => void }) {
  const router = useRouter();
  const page = `/uz/files/${job.id}`;
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  // P6: an «Audio» result carries `doc.studioAudio` (same player, same download).
  // P8b: a podcast / greeting template result carries `doc.audio` (its measured length).
  const seconds = gen.doc?.speech?.seconds ?? gen.doc?.studioAudio?.seconds ?? gen.doc?.mix?.seconds ?? gen.doc?.audio?.seconds;
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
        <button type="button" data-result-action="download" onClick={() => void downloadStudioFile({ url: `/api/generations/${job.id}/file`, fileName: "studio-audio.mp3", mime: "audio/mpeg" }, () => router.push(page))} className={ACTION}>
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
