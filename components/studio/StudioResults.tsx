"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Download, Eraser, Mic, Pencil, RefreshCw, Shuffle, ZoomIn } from "lucide-react";
import type * as api from "@/lib/api-client";
import { ApiImg } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { imageExt } from "@/lib/viewers/kind";
import { FavoriteButton } from "./Favorite";
import { JobList, JobResult, RESULT_ACTION as ACTION } from "./JobResult";
import { downloadStudioFile } from "./studio-download";
import { MODE_LABEL, MODE_PURPOSE, TOOL_MODES, type StudioMode } from "./studio-modes";

/** A P2b action on one finished picture: «Tahrirlash», «Sifatini oshirish», «Fonni olib tashlash». */
export type PictureTool = (mode: Exclude<StudioMode, "image">, picture: { url: string }) => void;

const TOOL_ICON = { edit: Pencil, upscale: ZoomIn, bgremove: Eraser } as const;

/**
 * P7b «Keyingi qadam» on a finished picture (docs/studio/P7-SPEC.md): «Videoga aylantirish» hands one picture (its
 * stored result URL) and the prompt to the Video tab; «Ovoz qo'shish» hands the prompt to the «Ovoz» tab. Absent = no
 * button.
 */
export type PictureNext = { onVideo?: (url: string, prompt: string) => void; onVoice?: (text: string) => void };

/** The three P2b actions over a picture (icon buttons, 44 px, labelled). */
export function PictureTools({ url, onTool, index, many, inline = false }: { url: string; onTool: PictureTool; index: number; many: boolean; inline?: boolean }) {
  return (
    <div className={inline ? "grid grid-cols-3 gap-1" : "absolute bottom-2 left-2 flex gap-1"} data-picture-tools>
      {TOOL_MODES.map((m) => {
        const Icon = TOOL_ICON[m];
        return (
          <button
            key={m}
            type="button"
            data-result-action={m}
            aria-label={many ? `${index + 1}-rasm: ${MODE_LABEL[m]}` : MODE_LABEL[m]}
            title={MODE_LABEL[m]}
            onClick={() => onTool(m, { url })}
            className={
              inline
                ? "focus-visible:ring-ring hover:bg-muted inline-flex h-11 items-center justify-center rounded-[10px] border outline-none focus-visible:ring-2"
                : "focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-lg bg-black/70 text-white outline-none hover:bg-black/85 focus-visible:ring-2"
            }
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** One Studio generation the page is following (queued, running, done or failed). */
export type StudioJob = {
  id: string;
  modelId: string;
  modelLabel: string;
  prompt: string;
  /** Price charged for the job. */
  price: number;
  /** The request values: «Qayta» sends exactly these again. */
  sent: Record<string, unknown>;
  /** The catalog purpose the job was priced under (P2b: edit / upscale / background removal); absent = pictures. */
  purpose?: string;
  /** Latest state from the server; `null` until the first poll answers. */
  gen: api.GenerationDetail | null;
  /** The polling gave up (the job is gone, or the session ended). */
  error: string | null;
};

/**
 * The Studio's result column: newest job first. A queued / running job shows the app's progress panel
 * (`GenerationProgress`), a finished one its pictures with «Yuklab olish» on every picture and, per job, «Qayta» (the
 * same request again — a new charge) and «Boshqa modelda» (the same prompt, the model picker opened).
 */
export function StudioResults({
  jobs,
  busy,
  onAgain,
  retryPrice,
  onOtherModel,
  onTool,
  onVideo,
  onVoice,
}: {
  jobs: readonly StudioJob[];
  /** A submit is in flight: «Qayta» waits. */
  busy: boolean;
  onAgain: (job: StudioJob) => void;
  /** What a retry costs now; default = what the job cost. */
  retryPrice?: (job: StudioJob) => number;
  onOtherModel: (job: StudioJob) => void;
  /** P2b: edit / upscale / remove the background of one picture (absent = no tool buttons). */
  onTool?: PictureTool;
} & PictureNext) {
  if (jobs.length === 0) {
    return (
      <p className="text-muted-foreground bg-card hidden rounded-[20px] border p-6 text-center text-[14.5px] xl:block" data-studio-empty>
        Yaratilgan rasmlar shu yerda ko‘rinadi.
      </p>
    );
  }
  return (
    <JobList jobs={jobs} label="Natijalar">
      {(job) => (
        <JobResult job={job} busy={busy} onAgain={onAgain} retryPrice={retryPrice} failed="Rasm yaratilmadi" lost="Oldingi ish baribir tugashi mumkin — «Ishlarim» yoki Galereyani tekshiring.">
          {(gen) => <Pictures job={job} gen={gen} busy={busy} onAgain={onAgain} onOtherModel={onOtherModel} onTool={onTool} onVideo={onVideo} onVoice={onVoice} />}
        </JobResult>
      )}
    </JobList>
  );
}

function Pictures({
  job,
  gen,
  busy,
  onAgain,
  onOtherModel,
  onTool,
  onVideo,
  onVoice,
}: {
  job: StudioJob;
  gen: api.GenerationDetail;
  busy: boolean;
  onAgain: (j: StudioJob) => void;
  onOtherModel: (j: StudioJob) => void;
  onTool?: PictureTool;
} & PictureNext) {
  const router = useRouter();
  const [favError, setFavError] = useState<string | null>(null);
  // «Videoga aylantirish» on a job of several pictures first asks which one becomes the start frame.
  const [choosing, setChoosing] = useState(false);
  // A utility job (upscale / background removal / edit) carries a label or an instruction, not a description.
  const prompt = !job.purpose || job.purpose === MODE_PURPOSE.image ? job.prompt.trim() : "";
  const images = gen.doc?.images ?? [];
  const page = `/uz/files/${job.id}`;
  const short = gen.delivered && gen.delivered.got < gen.delivered.want ? gen.delivered : null;
  return (
    <article className="bg-card overflow-hidden rounded-[20px] border shadow-[var(--shadow-card)]">
      {images.length === 0 ? (
        <p className="text-muted-foreground p-5 text-center text-[14.5px]" data-studio-no-images>
          Rasmlar yaratilmadi — farq balansingizga qaytarildi. Qayta urinib ko‘ring.
        </p>
      ) : (
        <div className={cn("grid gap-0.5", images.length > 1 && "grid-cols-2")} data-studio-pictures>
          {images.map((im, i) => (
            <figure key={im.id} className="bg-muted relative m-0" data-studio-picture>
              <ApiImg src={im.url} alt={im.alt || job.prompt} className="h-auto w-full object-cover" style={{ aspectRatio: im.w > 0 && im.h > 0 ? `${im.w} / ${im.h}` : "1 / 1" }} />
              <button
                type="button"
                data-result-action="download"
                aria-label={images.length > 1 ? `${i + 1}-rasmni yuklab olish` : "Yuklab olish"}
                onClick={() => void downloadStudioFile({ url: im.url, fileName: `studio-${i + 1}.${imageExt(im.mime)}`, mime: im.mime ?? "image/png" }, () => router.push(page))}
                className="focus-visible:ring-ring absolute right-2 bottom-2 inline-flex size-11 items-center justify-center rounded-lg bg-black/70 text-white outline-none hover:bg-black/85 focus-visible:ring-2"
              >
                <Download className="size-[18px]" aria-hidden />
              </button>
              {onTool ? <PictureTools url={im.url} onTool={onTool} index={i} many={images.length > 1} /> : null}
            </figure>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[14.5px] leading-snug break-words" data-studio-job-prompt>
              {job.prompt}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[12.5px]" data-studio-job-meta>
              {job.modelLabel} · {formatSom(job.price)}
            </p>
          </div>
          <FavoriteButton id={job.id} onError={setFavError} />
        </div>
        {favError ? (
          <p role="alert" className="text-destructive text-[13px]" data-favorite-error>
            {favError}
          </p>
        ) : null}
        {short ? (
          <p className="text-muted-foreground text-[13px]" data-studio-delivered>
            {short.want} tadan {short.got} ta rasm tayyor bo‘ldi — farq balansingizga qaytarildi.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={ACTION}>
            <RefreshCw className="size-4" aria-hidden />
            Qayta
          </button>
          <button type="button" data-result-action="other-model" onClick={() => onOtherModel(job)} className={ACTION}>
            <Shuffle className="size-4" aria-hidden />
            Boshqa modelda
          </button>
        </div>
        {(onVideo && images.length > 0) || (onVoice && prompt) ? (
          <div className="flex flex-col gap-1.5" data-next-step role="group" aria-label="Keyingi qadam">
            <p className="text-muted-foreground text-[12.5px] font-semibold">Keyingi qadam</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {onVideo && images.length > 0 ? (
                <button
                  type="button"
                  data-result-action="to-video"
                  aria-expanded={images.length > 1 ? choosing : undefined}
                  onClick={() => (images.length > 1 ? setChoosing((v) => !v) : onVideo(images[0]!.url, prompt))}
                  className={ACTION}
                >
                  <Clapperboard className="size-4" aria-hidden />
                  Videoga aylantirish
                </button>
              ) : null}
              {onVoice && prompt ? (
                <button type="button" data-result-action="to-voice" onClick={() => onVoice(prompt)} className={ACTION}>
                  <Mic className="size-4" aria-hidden />
                  Ovoz qo‘shish
                </button>
              ) : null}
            </div>
            {onVideo && choosing && images.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5" data-video-choose role="group" aria-label="Qaysi rasmdan video?">
                <span className="text-muted-foreground text-[13px]">Qaysi rasmdan?</span>
                {images.map((im, i) => (
                  <button
                    key={im.id}
                    type="button"
                    data-video-pick={i}
                    aria-label={`${i + 1}-rasmdan video`}
                    onClick={() => {
                      setChoosing(false);
                      onVideo(im.url, prompt);
                    }}
                    className={cn(ACTION, "min-w-11 px-0")}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <Link href={page} data-result-open className="text-accent-soft-foreground pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center w-fit text-[13.5px] font-semibold underline underline-offset-2">
          To‘liq ko‘rish va ulashish →
        </Link>
      </div>
    </article>
  );
}
