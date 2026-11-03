"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, Download, Mic, Music, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { useApiSrc } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { currentDeliveryEnv, deliver, markGesture, type ReadyFile } from "@/lib/downloads/deliver";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import { FavoriteButton } from "../Favorite";
import { useMixHandoff } from "../audio/mix-handoff";
import { isMixModelId } from "@/lib/media/catalog-mix";
import type { StudioJob } from "../StudioResults";

const ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/** The MP4 through the delivery driver (session fetch → blob → download); inside Telegram the result page opens instead. */
async function downloadClip(id: string, openPage: () => void): Promise<void> {
  markGesture();
  const env = currentDeliveryEnv();
  if (env.capability !== "browser") {
    openPage();
    return;
  }
  const file: ReadyFile = {
    format: "native",
    url: `/api/generations/${id}/file`,
    fileName: "studio-video.mp4",
    size: 0,
    mime: "video/mp4",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  try {
    await deliver(file, env);
  } catch {
    openPage();
  }
}

/** P7b «Keyingi qadam» on a finished clip (absent = no button). */
type Next = { onMusic?: (prompt: string) => void; onVoice?: (text: string) => void };

/**
 * The Video tab's results, newest first: a waiting clip shows the app's progress panel (`GenerationProgress`, the
 * video stage list with its minutes ETA), a finished one plays here (the result file itself, `?inline=1`, as the
 * result page's `VideoViewer`) with «Yuklab olish» and «Qayta», the P7b star and — for a clip made from a prompt —
 * «Keyingi qadam»: «Musiqa yaratish» / «Ovoz qo'shish»; a failed one says why (the refund is automatic).
 */
export function VideoResults({ jobs, busy, onAgain, onMusic, onVoice }: { jobs: readonly StudioJob[]; busy: boolean; onAgain: (job: StudioJob) => void } & Next) {
  if (jobs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4" data-studio-jobs aria-label="Videolar">
      {jobs.map((job) => (
        <li key={job.id} data-studio-job={job.id} data-job-status={job.gen?.status ?? "QUEUED"}>
          <JobCard job={job} busy={busy} onAgain={onAgain} onMusic={onMusic} onVoice={onVoice} />
        </li>
      ))}
    </ul>
  );
}

function JobCard({ job, busy, onAgain, onMusic, onVoice }: { job: StudioJob; busy: boolean; onAgain: (j: StudioJob) => void } & Next) {
  const gen = job.gen;
  if (job.error && !gen) return <Failure job={job} message={`${job.error} Video baribir tayyor bo‘lishi mumkin — «Ishlarim» yoki Galereyani tekshiring.`} busy={busy} onAgain={onAgain} />;
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
  if (gen.status === "COMPLETED") return <Clip job={job} gen={gen} busy={busy} onAgain={onAgain} onMusic={onMusic} onVoice={onVoice} />;
  const message = gen.status === "FAILED" ? gen.error || "Video yaratilmadi. Pul balansingizga qaytarildi." : "Ish bekor qilindi.";
  return <Failure job={job} message={message} busy={busy} onAgain={onAgain} />;
}

function Failure({ job, message, busy, onAgain }: { job: StudioJob; message: string; busy: boolean; onAgain: (j: StudioJob) => void }) {
  return (
    <div className="bg-card rounded-[20px] border p-5" data-studio-failed>
      <p role="alert" className="text-destructive text-[14.5px] leading-snug">
        {message}
      </p>
      <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={cn(ACTION, "mt-3")}>
        <RefreshCw className="size-4" aria-hidden />
        Qayta urinish
      </button>
    </div>
  );
}

function Clip({ job, gen, busy, onAgain, onMusic, onVoice }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain: (j: StudioJob) => void } & Next) {
  const router = useRouter();
  const [favError, setFavError] = useState<string | null>(null);
  // An effect clip has no prompt of its own («Effekt: …» names the scene): nothing to hand over.
  const prompt = job.sent.effect ? "" : job.prompt.trim();
  const page = `/uz/files/${job.id}`;
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  const video = gen.doc?.video;
  const short = gen.delivered && gen.delivered.got < gen.delivered.want ? gen.delivered : null;
  // P8c «Keyingi qadam» → «Montaj»: any finished clip can take a voice / music (the handoff pre-picks this clip).
  const toMix = useMixHandoff();
  // A «Montaj» result is not a Studio gallery item (no star; P8c).
  const mixed = isMixModelId(job.modelId);
  return (
    <article className="bg-card overflow-hidden rounded-[20px] border shadow-[var(--shadow-card)]" data-studio-clip>
      <video className={cn("w-full bg-black", video?.aspect === "9:16" && "mx-auto max-h-[70vh] max-w-sm")} controls playsInline preload="metadata" src={src} data-video-player>
        Brauzeringiz videoni qo‘llab-quvvatlamaydi.
      </video>
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14.5px] leading-snug break-words" data-studio-job-prompt>
              {job.prompt}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[12.5px]" data-studio-job-meta>
              {job.modelLabel}
              {video ? ` · ${Math.round(video.seconds)} soniya` : ""} · {formatSom(job.price)}
            </p>
          </div>
          {mixed ? null : <FavoriteButton id={job.id} onError={setFavError} />}
        </div>
        {favError ? (
          <p role="alert" className="text-destructive text-[13px]" data-favorite-error>
            {favError}
          </p>
        ) : null}
        {short ? (
          <p className="text-muted-foreground text-[13px]" data-studio-delivered>
            {short.want} soniyadan {short.got} soniya tayyor bo‘ldi — farq balansingizga qaytarildi.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" data-result-action="download" onClick={() => void downloadClip(job.id, () => router.push(page))} className={ACTION}>
            <Download className="size-4" aria-hidden />
            Yuklab olish
          </button>
          <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={ACTION}>
            <RefreshCw className="size-4" aria-hidden />
            Qayta
          </button>
        </div>
        {(prompt && (onMusic || onVoice)) || toMix ? (
          <div className="flex flex-col gap-1.5" data-next-step aria-label="Keyingi qadam" role="group">
            <p className="text-muted-foreground text-[12.5px] font-semibold">Keyingi qadam</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {toMix ? (
                <button type="button" data-result-action="to-mix-video" onClick={() => toMix("video", job.id)} className={ACTION}>
                  <AudioLines className="size-4" aria-hidden />
                  Videoga ovoz qo‘shish
                </button>
              ) : null}
              {prompt && onMusic ? (
                <button type="button" data-result-action="to-music" onClick={() => onMusic(prompt)} className={ACTION}>
                  <Music className="size-4" aria-hidden />
                  Musiqa yaratish
                </button>
              ) : null}
              {prompt && onVoice ? (
                <button type="button" data-result-action="to-voice" onClick={() => onVoice(prompt)} className={ACTION}>
                  <Mic className="size-4" aria-hidden />
                  Ovoz qo‘shish
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <Link href={page} data-result-open className="text-accent-soft-foreground pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center w-fit text-[13.5px] font-semibold underline underline-offset-2">
          To‘liq ko‘rish va ulashish →
        </Link>
      </div>
    </article>
  );
}
