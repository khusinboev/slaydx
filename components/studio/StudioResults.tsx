"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Eraser, Pencil, RefreshCw, Shuffle, ZoomIn } from "lucide-react";
import type * as api from "@/lib/api-client";
import type { GenImage } from "@/lib/generation/types";
import { ApiImg } from "@/lib/use-api-src";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { imageExt } from "@/lib/viewers/kind";
import { currentDeliveryEnv, deliver, markGesture, type ReadyFile } from "@/lib/downloads/deliver";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import { MODE_LABEL, TOOL_MODES, type StudioMode } from "./studio-modes";

/** A P2b action on one finished picture: «Tahrirlash», «Sifatini oshirish», «Fonni olib tashlash». */
export type PictureTool = (mode: Exclude<StudioMode, "image">, picture: { url: string }) => void;

const TOOL_ICON = { edit: Pencil, upscale: ZoomIn, bgremove: Eraser } as const;

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

const ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";

/**
 * Where a finished image goes in the browser: through the delivery driver (fetch with the session → blob →
 * `<a download>`), like the viewer's tiles. Inside Telegram a single asset has no signed, cookie-free URL, so the
 * result page (with its «Yuklab olish» sheet) opens instead.
 */
async function downloadPicture(im: GenImage, index: number, openPage: () => void): Promise<void> {
  markGesture();
  const env = currentDeliveryEnv();
  if (env.capability !== "browser") {
    openPage();
    return;
  }
  const file: ReadyFile = {
    format: "native",
    url: im.url,
    fileName: `studio-${index + 1}.${imageExt(im.mime)}`,
    size: 0,
    mime: im.mime ?? "image/png",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  try {
    await deliver(file, env);
  } catch {
    openPage();
  }
}

/**
 * The Studio's result column: newest job first. A queued / running job shows the app's progress panel
 * (`GenerationProgress`), a finished one its pictures with «Yuklab olish» on every picture and, per job, «Qayta» (the
 * same request again — a new charge) and «Boshqa modelda» (the same prompt, the model picker opened).
 */
export function StudioResults({
  jobs,
  busy,
  onAgain,
  onOtherModel,
  onTool,
}: {
  jobs: readonly StudioJob[];
  /** A submit is in flight: «Qayta» waits. */
  busy: boolean;
  onAgain: (job: StudioJob) => void;
  onOtherModel: (job: StudioJob) => void;
  /** P2b: edit / upscale / remove the background of one picture (absent = no tool buttons). */
  onTool?: PictureTool;
}) {
  if (jobs.length === 0) {
    return (
      <p className="text-muted-foreground bg-card hidden rounded-[20px] border p-6 text-center text-[14.5px] xl:block" data-studio-empty>
        Yaratilgan rasmlar shu yerda ko‘rinadi.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-4" data-studio-jobs aria-label="Natijalar">
      {jobs.map((job) => (
        <li key={job.id} data-studio-job={job.id} data-job-status={job.gen?.status ?? "QUEUED"}>
          <JobCard job={job} busy={busy} onAgain={onAgain} onOtherModel={onOtherModel} onTool={onTool} />
        </li>
      ))}
    </ul>
  );
}

function JobCard({ job, busy, onAgain, onOtherModel, onTool }: { job: StudioJob; busy: boolean; onAgain: (j: StudioJob) => void; onOtherModel: (j: StudioJob) => void; onTool?: PictureTool }) {
  const gen = job.gen;
  // No job state: the job may still finish on the server — say so before a retry charges again.
  if (job.error && !gen) return <Failure job={job} message={`${job.error} Oldingi ish baribir tugashi mumkin — «Ishlarim» yoki Galereyani tekshiring.`} busy={busy} onAgain={onAgain} />;
  if (!gen) {
    return (
      <div className="bg-card rounded-[20px] border p-5" data-studio-pending role="status">
        <p className="font-medium">Navbatga qo‘yildi</p>
        <p className="text-muted-foreground mt-0.5 text-[14px]">{job.modelLabel} · {formatSom(job.price)}</p>
      </div>
    );
  }
  if (gen.status === "QUEUED" || gen.status === "IN_PROGRESS") return <GenerationProgress gen={gen} />;
  if (gen.status === "COMPLETED") return <Pictures job={job} gen={gen} busy={busy} onAgain={onAgain} onOtherModel={onOtherModel} onTool={onTool} />;
  const message = gen.status === "FAILED" ? gen.error || "Rasm yaratilmadi. Pul balansingizga qaytarildi." : "Ish bekor qilindi.";
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

function Pictures({
  job,
  gen,
  busy,
  onAgain,
  onOtherModel,
  onTool,
}: {
  job: StudioJob;
  gen: api.GenerationDetail;
  busy: boolean;
  onAgain: (j: StudioJob) => void;
  onOtherModel: (j: StudioJob) => void;
  onTool?: PictureTool;
}) {
  const router = useRouter();
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
                onClick={() => void downloadPicture(im, i, () => router.push(page))}
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
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14.5px] leading-snug break-words" data-studio-job-prompt>
            {job.prompt}
          </p>
          <p className="text-muted-foreground mt-0.5 text-[12.5px]" data-studio-job-meta>
            {job.modelLabel} · {formatSom(job.price)}
          </p>
        </div>
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
        <Link href={page} data-result-open className="text-accent-soft-foreground pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center w-fit text-[13.5px] font-semibold underline underline-offset-2">
          To‘liq ko‘rish va ulashish →
        </Link>
      </div>
    </article>
  );
}
