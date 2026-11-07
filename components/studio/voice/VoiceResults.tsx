"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Clapperboard, Download, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { useApiSrc } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { FavoriteButton } from "../Favorite";
import { AGAIN_LABEL, JobList, JobMeta, JobResult, RESULT_ACTION as ACTION, SentPrompt } from "../JobResult";
import { downloadStudioFile } from "../studio-download";
import type { StudioJob } from "../StudioResults";
import { useMixHandoff } from "../audio/mix-handoff";

/**
 * The «Ovoz» and «Audio» tabs' results, newest first: a waiting job shows the model, the price and the app's progress
 * panel; a finished one plays here (the result file itself, `?inline=1`) with «Yuklab olish (MP3)», «Qayta yaratish» and
 * the star; a sound effect bought in several variants plays every one of them (P11 §D — each was paid for); a failed one
 * says why (refunded in full).
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

/** One more clip of a sound effect bought in variants: its own asset, its own player and download. */
function Variant({ jobId, index, assetId, seconds }: { jobId: string; index: number; assetId: string; seconds: number }) {
  const router = useRouter();
  const src = useApiSrc(`/api/generations/${jobId}/assets/${assetId}`);
  return (
    <li className="flex items-center gap-2" data-result-variant={index}>
      <span className="text-muted-foreground w-16 shrink-0 text-[12.5px] tabular-nums">
        {index + 1}-variant · {Math.round(seconds)} s
      </span>
      <audio className="min-w-0 flex-1" controls preload="none" src={src} data-result-variant-audio>
        Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
      </audio>
      <button
        type="button"
        data-result-action="download-variant"
        aria-label={`${index + 1}-variantni yuklab olish`}
        onClick={() => void downloadStudioFile({ url: `/api/generations/${jobId}/assets/${assetId}`, fileName: `studio-sfx-${index + 1}.mp3`, mime: "audio/mpeg" }, () => router.push(`/uz/files/${jobId}`))}
        className={cn(ACTION, "size-11 shrink-0 px-0")}
      >
        <Download className="size-4" aria-hidden />
      </button>
    </li>
  );
}

function Audio({ job, gen, busy, onAgain }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain?: (j: StudioJob) => void }) {
  const router = useRouter();
  const [favError, setFavError] = useState<string | null>(null);
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
  // Sound-effect variants (2–4): the first one is the result file itself, every one is an asset of the job.
  const variants = gen.doc?.studioAudio?.variants ?? [];
  return (
    <article className="bg-card flex flex-col gap-2.5 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]" data-studio-audio>
      <audio className="w-full" controls preload="metadata" src={src} data-audio-result>
        Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
      </audio>
      {variants.length > 1 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Variantlar" data-result-variants>
          {variants.map((v, i) => (
            <Variant key={v.assetId} jobId={job.id} index={i} assetId={v.assetId} seconds={v.seconds} />
          ))}
        </ul>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[14.5px] leading-snug break-words" data-studio-job-prompt>
            {job.prompt}
          </p>
          <div className="mt-0.5">
            <JobMeta job={job} extra={seconds ? `${Math.round(seconds)} s` : undefined} />
          </div>
          <SentPrompt text={gen.doc?.sentPrompt} />
        </div>
        <FavoriteButton id={job.id} onError={setFavError} />
      </div>
      {favError ? (
        <p role="alert" className="text-destructive text-[13px]" data-favorite-error>
          {favError}
        </p>
      ) : null}
      <div className={cn("grid gap-1.5", onAgain ? "grid-cols-2" : "grid-cols-1")}>
        <button type="button" data-result-action="download" onClick={() => void downloadStudioFile({ url: `/api/generations/${job.id}/file`, fileName: "studio-audio.mp3", mime: "audio/mpeg" }, () => router.push(page))} className={ACTION}>
          <Download className="size-4" aria-hidden />
          Yuklab olish (MP3)
        </button>
        {onAgain ? (
          <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={ACTION}>
            <RefreshCw className="size-4" aria-hidden />
            {AGAIN_LABEL}
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
