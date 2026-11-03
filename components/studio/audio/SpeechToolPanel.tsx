"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, RefreshCw } from "lucide-react";
import type * as api from "@/lib/api-client";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { useApiSrc } from "@/lib/use-api-src";
import type { FormValues } from "@/lib/types";
import type { ClientEntry } from "@/lib/studio-core";
import { languageLabel, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { downloadToDevice, deliverErrorText } from "@/lib/downloads/deliver";
import type { DownloadFormatId } from "@/lib/downloads/formats";
import { Card, Segmented, SelectField } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { queueGeneration } from "@/components/forms/runGeneration";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { GenerationProgress } from "@/components/files/GenerationProgress";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { requestValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import type { StudioPricing } from "../studio-types";
import { AudioInputRow } from "./AudioInputRow";
import { uploadAudioInput } from "./audio-api";
import { fetchMixSources, type MixSources } from "./mix-api";
import { sourceLabel } from "./MixPanel";
import {
  INITIAL_SPEECH_TOOL,
  pickResult,
  pickUpload,
  speechSources,
  speechToolBlocker,
  speechToolClientPrice,
  toolIdOf,
  type SourceTab,
  type SpeechToolState,
} from "./speech-tool-api";
import type { PreparedSample } from "../voice/wav";

const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;
const ACTION =
  "focus-visible:ring-ring bg-card hover:bg-muted pointer-coarse:min-h-11 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-50";
/** Rows the panel draws itself (the source card), not `ParamRows`. */
const OWN_ROWS = new Set(["source", "sourceSeconds"]);

const SUBMIT: Record<SpeechToolMode, string> = { transcribe: "Matnga aylantirish", dub: "Dublyaj qilish" };

/** «Matnga aylantirish · ~1 600 so'm». */
export function speechToolSubmitLabel(mode: SpeechToolMode, price: number): string {
  return `${SUBMIT[mode]} · ~${formatSom(price)}`;
}

/**
 * Studio P10 «Transkripsiya» / «Dublyaj» (docs/studio/P10-SPEC.md), a mode of the «Audio» tab: the source (one of the
 * user's finished results, or an uploaded / recorded audio), the mode's options from its schema (`ParamRows`; «Subtitrni
 * videoga yopishtirish» only for a video source), the sticky button with the price, and the results.
 */
export function SpeechToolPanel({
  mode,
  entry,
  pricing,
  state,
  setState,
  jobs,
  track,
  balance,
  typing,
  gated,
  reload,
}: {
  mode: SpeechToolMode;
  entry: ClientEntry;
  pricing: StudioPricing;
  state: SpeechToolState | undefined;
  setState: (fn: (s: SpeechToolState) => SpeechToolState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  balance: number | null;
  typing: boolean;
  gated: boolean;
  reload: (silent?: boolean) => void;
}) {
  const st = state ?? INITIAL_SPEECH_TOOL;
  const [sources, setSources] = useState<MixSources | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchMixSources().then(setSources, (e: unknown) => setLoadError(e instanceof Error ? e.message : "Natijalar yuklanmadi"));
  }, []);
  const finished = jobs.filter((j) => j.gen?.status === "COMPLETED").length;
  useEffect(() => {
    load();
  }, [load, finished]);

  const raw = st.raw;
  const list = sources ? speechSources(mode, sources) : [];
  const picked = typeof raw.source === "string" && raw.source.startsWith("result:") ? raw.source.slice(7) : "";
  const isVideo = st.kind === "video";
  // «Subtitrni videoga yopishtirish» only where it can work: a video source.
  const formEntry = { ...entry, params: entry.params.filter((p) => !OWN_ROWS.has(p.name) && (p.name !== "burn" || isVideo)) };
  const blocker = speechToolBlocker(mode, raw);
  const sent = requestValues(entry, raw);
  const price = blocker ? null : speechToolClientPrice(mode, entry, sent, pricing);
  const toolId = toolIdOf(mode);

  const setRaw = (fn: (r: typeof raw) => typeof raw) => setState((s) => ({ ...s, raw: fn(s.raw) }));
  const setParam = (name: string, value: unknown) => setRaw((r) => ({ ...r, [name]: value }));
  const setTab = (tab: SourceTab) => setState((s) => ({ ...s, tab }));

  function pickSource(id: string) {
    const s = list.find((x) => x.id === id);
    setError(null);
    if (!s) {
      setState((x) => ({ ...x, kind: null, raw: { ...x.raw, source: undefined, sourceSeconds: undefined } }));
      return;
    }
    setState((x) => ({ ...x, kind: s.media, raw: pickResult(x.raw, s) }));
  }

  async function onPrepared(s: PreparedSample) {
    setUploading(true);
    setUploadError(null);
    try {
      const r = await uploadAudioInput(s.blob, s.fileName);
      setState((x) => ({ ...x, kind: "audio", raw: pickUpload(x.raw, r) }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Audio yuklanmadi");
    } finally {
      setUploading(false);
    }
  }

  async function send(out: Record<string, unknown>) {
    setError(null);
    setSubmitting(true);
    const title = entry.label;
    try {
      const { id, price: charged } = await queueGeneration({ slug: toolId, id: toolId, title, output: "mp4" }, out as unknown as FormValues, speechToolClientPrice(mode, entry, out, pricing), { repeat: true });
      track({ id, modelId: entry.id, modelLabel: entry.label, prompt: title, price: charged, sent: out });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      if ((e instanceof ApiError && e.status === 400) || e instanceof PriceChangedError) {
        reload(true);
        load();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (blocker) {
      setError(blocker);
      return;
    }
    void send(sent);
  }

  const uploadSeconds = typeof raw.sourceSeconds === "number" && typeof raw.source === "string" && raw.source.startsWith("upload:") ? raw.sourceSeconds : null;

  return (
    <div data-speech-tool={mode}>
      <Card title="Manba">
        <Field id="source">
          <div className="flex flex-col gap-3">
            <Segmented
              ariaLabel="Manba turi"
              value={st.tab}
              onChange={(v) => setTab(v as SourceTab)}
              options={[
                { value: "result", label: "Natijalarimdan" },
                { value: "upload", label: "Audio yuklash" },
              ]}
            />
            {st.tab === "result" ? (
              <div className="flex flex-col gap-1.5" data-speech-sources>
                {loadError ? (
                  <p role="alert" className="text-destructive text-[14px]">
                    {loadError}{" "}
                    <button type="button" onClick={load} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
                      Qayta urinish
                    </button>
                  </p>
                ) : !sources ? (
                  <p className="text-muted-foreground text-[13.5px]" role="status">
                    Natijalar yuklanmoqda...
                  </p>
                ) : list.length === 0 && !picked ? (
                  <p className="text-muted-foreground text-[13.5px]" data-speech-sources-empty>
                    Hali tayyor video yoki audio yo‘q — avval «Video», «Ovoz» yoki «Audio» bo‘limida yarating, yoki audio yuklang.
                  </p>
                ) : (
                  <SelectField
                    ariaLabel="Natija"
                    value={picked}
                    onChange={pickSource}
                    options={[
                      { value: "", label: "— tanlang —" },
                      ...(picked && !list.some((s) => s.id === picked) ? [{ value: picked, label: "Tanlangan natija" }] : []),
                      ...list.map((s) => ({ value: s.id, label: sourceLabel(s) })),
                    ]}
                  />
                )}
                <p className="text-muted-foreground text-[12.5px] leading-snug">
                  {mode === "dub" ? "Video yoki audio ≤ 3 daqiqa. Natija — video uchun MP4, audio uchun MP3." : "Video ≤ 3 daqiqa, audio ≤ 10 daqiqa. Natija — matn, SRT va VTT subtitr."}
                </p>
              </div>
            ) : (
              <AudioInputRow fieldIds={null} title="Audio fayl" seconds={uploadSeconds} uploading={uploading} error={uploadError} onPrepared={(s) => void onPrepared(s)} />
            )}
          </div>
        </Field>
        <Field id="sourceSeconds">
          <p className="text-muted-foreground mt-2 text-[13px] tabular-nums" data-speech-seconds role="status">
            {typeof raw.sourceSeconds === "number" && raw.source ? `Narx ${raw.sourceSeconds} soniya uchun hisoblanadi.` : "Narx manba uzunligiga qarab hisoblanadi."}
          </p>
        </Field>
      </Card>

      <ParamRows entry={formEntry} raw={raw} onChange={setParam} />

      {error && !gated ? (
        <p role="alert" data-studio-error className="text-destructive mb-3 text-[14.5px] leading-snug">
          {error}
          {INSUFFICIENT_RE.test(error) ? (
            <>
              {" "}
              <Link href={PAY_RETURN_PATH} data-topup className="text-accent-soft-foreground font-semibold whitespace-nowrap underline underline-offset-2">
                Balansni to‘ldirish →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      <PriceButton
        count={1}
        price={price}
        balance={balance}
        loading={submitting}
        disabled={uploading}
        typing={typing}
        onSubmit={submit}
        label={price === null ? undefined : speechToolSubmitLabel(mode, price)}
      />
      <section aria-label={mode === "dub" ? "Dublyajlar" : "Transkripsiyalar"} data-speech-results className={cn(jobs.length > 0 && "mt-5")}>
        <SpeechToolResults jobs={jobs} busy={submitting} onAgain={(j) => void send(j.sent)} />
      </section>
    </div>
  );
}

/** The panel's results, newest first: progress → the transcript (+ subtitle downloads) / the dubbed file; a failure says why. */
export function SpeechToolResults({ jobs, busy, onAgain }: { jobs: readonly StudioJob[]; busy: boolean; onAgain: (job: StudioJob) => void }) {
  if (jobs.length === 0) return null;
  return (
    <ul className="flex flex-col gap-4" data-studio-jobs>
      {jobs.map((job) => (
        <li key={job.id} data-studio-job={job.id} data-job-status={job.gen?.status ?? "QUEUED"}>
          <JobCard job={job} busy={busy} onAgain={onAgain} />
        </li>
      ))}
    </ul>
  );
}

function JobCard({ job, busy, onAgain }: { job: StudioJob; busy: boolean; onAgain: (j: StudioJob) => void }) {
  const gen = job.gen;
  if (!gen) {
    return (
      <div className="bg-card rounded-[20px] border p-5" role="status" data-studio-pending>
        <p className="font-medium">{job.error ? job.error : "Navbatga qo‘yildi"}</p>
        <p className="text-muted-foreground mt-0.5 text-[14px]">
          {job.modelLabel} · {formatSom(job.price)}
        </p>
      </div>
    );
  }
  if (gen.status === "QUEUED" || gen.status === "IN_PROGRESS") return <GenerationProgress gen={gen} />;
  if (gen.status === "COMPLETED") return <Done job={job} gen={gen} busy={busy} onAgain={onAgain} />;
  return (
    <div className="bg-card rounded-[20px] border p-5" data-studio-failed>
      <p role="alert" className="text-destructive text-[14.5px] leading-snug">
        {gen.status === "FAILED" ? gen.error || "Bajarilmadi. Pul balansingizga qaytarildi." : "Ish bekor qilindi."}
      </p>
      <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={cn(ACTION, "mt-3")}>
        <RefreshCw className="size-4" aria-hidden />
        Qayta urinish
      </button>
    </div>
  );
}

function Done({ job, gen, busy, onAgain }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain: (j: StudioJob) => void }) {
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  const [dlError, setDlError] = useState<string | null>(null);
  const t = gen.doc?.transcribe;
  const dub = gen.doc?.dub;
  const video = t?.burned || dub?.output === "mp4";
  const download = (format: DownloadFormatId) => {
    setDlError(null);
    downloadToDevice(job.id, format).catch((e: unknown) => setDlError(deliverErrorText(e)));
  };
  return (
    <article className="bg-card flex flex-col gap-2.5 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]" data-speech-result>
      {video ? (
        <video className="w-full rounded-[12px] bg-black" controls playsInline preload="metadata" src={src} data-speech-video>
          Brauzeringiz videoni qo‘llab-quvvatlamaydi.
        </video>
      ) : dub ? (
        <audio className="w-full" controls preload="metadata" src={src} data-speech-audio>
          Brauzeringiz audio pleerni qo‘llab-quvvatlamaydi.
        </audio>
      ) : null}
      {t ? (
        <p className="line-clamp-6 text-[14.5px] leading-relaxed whitespace-pre-line break-words" data-speech-text>
          {t.text || "Nutq topilmadi."}
        </p>
      ) : null}
      <p className="text-muted-foreground text-[12.5px]" data-studio-job-meta>
        {job.modelLabel}
        {t ? ` · ${languageLabel(t.language ?? t.requestedLanguage)}` : dub ? ` · ${languageLabel(dub.target)}` : ""} · {formatSom(job.price)}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {t ? (
          <>
            <button type="button" data-result-action="srt" disabled={!t.cues.length} onClick={() => download("subtitles-srt")} className={ACTION}>
              <Download className="size-4" aria-hidden />
              SRT
            </button>
            <button type="button" data-result-action="vtt" disabled={!t.cues.length} onClick={() => download("subtitles-vtt")} className={ACTION}>
              <Download className="size-4" aria-hidden />
              VTT
            </button>
          </>
        ) : null}
        <button type="button" data-result-action="download" onClick={() => download("native")} className={ACTION}>
          <Download className="size-4" aria-hidden />
          {video ? "MP4" : dub ? "MP3" : "Matn (TXT)"}
        </button>
        <button type="button" data-result-action="again" disabled={busy} onClick={() => onAgain(job)} className={ACTION}>
          <RefreshCw className="size-4" aria-hidden />
          Qayta
        </button>
      </div>
      {dlError ? (
        <p role="alert" className="text-destructive text-[13.5px]">
          {dlError}
        </p>
      ) : null}
      <Link href={`/uz/files/${job.id}`} data-result-open className="text-accent-soft-foreground pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center w-fit text-[13.5px] font-semibold underline underline-offset-2">
        To‘liq ko‘rish va ulashish →
      </Link>
    </article>
  );
}
