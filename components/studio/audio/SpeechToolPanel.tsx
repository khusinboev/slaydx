"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Copy, Download, RefreshCw, Upload } from "lucide-react";
import type * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom, groupDigits } from "@/lib/format";
import { FavoriteButton } from "../Favorite";
import { useApiSrc } from "@/lib/use-api-src";
import type { ClientEntry } from "@/lib/studio-core";
import { DUB_VIDEO_MAX_BYTES, languageLabel, videoOnlySource, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { downloadToDevice, deliverErrorText } from "@/lib/downloads/deliver";
import type { DownloadFormatId } from "@/lib/downloads/formats";
import { Card, Segmented, SelectField } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { AGAIN_LABEL, JobList, JobMeta, JobResult, RESULT_ACTION as ACTION } from "../JobResult";
import { MediaModelPicker } from "../MediaModelPicker";
import { STUDIO_AUDIO_LISTING } from "../studio-api";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { SubmitError } from "../SubmitError";
import { noticeLine, requestValues, switchParts } from "../studio-values";
import { SwitchNotice } from "../SwitchNotice";
import { useStudioSend } from "../useStudioSend";
import { StudioWorkbench, useResultsScroll } from "../StudioWorkbench";
import type { StudioJob } from "../StudioResults";
import type { StudioPricing } from "../studio-types";
import { AudioInputRow, fmtSeconds } from "./AudioInputRow";
import { VIDEO_INPUT_MAX_BYTES, VIDEO_INPUT_MAX_SECONDS, uploadAudioInput, uploadVideoInput, videoBlocker } from "./audio-api";
import { audioModelLabel } from "./audio-modes";
import { fetchMixSources, type MixSources } from "./mix-api";
import { sourceLabel } from "./MixPanel";
import {
  INITIAL_SPEECH_TOOL,
  billedLine,
  pickResult,
  pickSpeechModel,
  pickUpload,
  pickVideoUpload,
  sourceOnTab,
  speechSources,
  speechToolBlocker,
  speechToolClientPrice,
  toolIdOf,
  type SourceTab,
  type SpeechToolState,
} from "./speech-tool-api";
import type { PreparedSample } from "../voice/wav";

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
  before,
  mode,
  modeLabel,
  entry,
  entries,
  pricing,
  state,
  setState,
  jobs,
  track,
  balance,
  typing,
  gated,
  reload,
  onSubmitted,
}: {
  /** The «Audio» tab's mode chips: drawn on top of the form column. */
  before?: ReactNode;
  mode: SpeechToolMode;
  modeLabel: string;
  entry: ClientEntry;
  /** The mode's offered models; a picker shows with two or more. */
  entries: readonly ClientEntry[];
  pricing: StudioPricing;
  state: SpeechToolState | undefined;
  setState: (fn: (s: SpeechToolState) => SpeechToolState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  balance: number | null;
  typing: boolean;
  gated: boolean;
  reload: (silent?: boolean) => void;
  /** The form's own job was queued (not a retry of an old one): the page drops the draft. */
  onSubmitted?: () => void;
}) {
  const st = state ?? INITIAL_SPEECH_TOOL;
  const [sources, setSources] = useState<MixSources | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchMixSources().then(setSources, (e: unknown) => setLoadError(e instanceof Error ? e.message : "Natijalar yuklanmadi"));
  }, []);
  const { submitting, error, setError, send: queue } = useStudioSend(() => {
    reload(true);
    load();
  });
  const { resultsRef, scrollToResults } = useResultsScroll();
  const finished = jobs.filter((j) => j.gen?.status === "COMPLETED").length;
  useEffect(() => {
    load();
  }, [load, finished]);

  const raw = st.raw;
  const videoOnly = videoOnlySource(entry.id);
  const videoLimit = mode === "dub" ? DUB_VIDEO_MAX_BYTES : VIDEO_INPUT_MAX_BYTES;
  const list = sources ? speechSources(mode, sources, videoOnly) : [];
  const picked = typeof raw.source === "string" && raw.source.startsWith("result:") ? raw.source.slice(7) : "";
  const isVideo = st.kind === "video";
  // «Subtitrni videoga yopishtirish» only where it can work: a video source.
  const formEntry = { ...entry, params: entry.params.filter((p) => !OWN_ROWS.has(p.name) && (p.name !== "burn" || isVideo)) };
  const shownTab: SourceTab = st.tab === "upload" && videoOnly ? "result" : st.tab;
  // A source left on another tab is neither named on screen nor bought: the tab on screen decides.
  const blocker = sourceOnTab({ raw, tab: shownTab, kind: st.kind }) ? speechToolBlocker(mode, raw) : "Avval shu bo‘limdan manbani tanlang.";
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

  /** P11 §D: the user's own MP4 (the same upload path, `kind=video`): the source is a video, so the burn stays offered. */
  async function onVideo(file: File) {
    setUploadError(null);
    const bad = videoBlocker(file, videoLimit);
    if (bad) {
      setUploadError(bad);
      return;
    }
    setUploading(true);
    try {
      const r = await uploadVideoInput(file, file.name || "video.mp4", mode);
      setState((x) => ({ ...x, kind: "video", raw: pickVideoUpload(x.raw, r) }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Video yuklanmadi");
    } finally {
      setUploading(false);
    }
  }

  function send(out: Record<string, unknown>, target: ClientEntry = entry) {
    const title = target.label;
    return queue({ slug: toolId, id: toolId, title, output: "mp4" }, out, speechToolClientPrice(mode, target, out, pricing), ({ id, price: charged }) => {
      track({ id, modelId: target.id, modelLabel: target.label, prompt: title, price: charged, sent: out });
      scrollToResults();
    });
  }

  function submit() {
    if (blocker) {
      setError(blocker);
      return;
    }
    void send(sent).then((ok) => ok && onSubmitted?.());
  }

  /** The price of a retry on the job's own model: the same number `send` charges. */
  function retryPrice(job: StudioJob): number {
    const target = entries.find((e) => e.id === job.modelId);
    return target ? speechToolClientPrice(mode, target, job.sent, pricing) : job.price;
  }

  function again(job: StudioJob) {
    const target = entries.find((e) => e.id === job.modelId);
    if (!target) {
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      return;
    }
    void send(job.sent, target);
  }

  const [switchText, setSwitchText] = useState<string | null>(null);
  function pickModel(id: string) {
    const next = entries.find((e) => e.id === id);
    if (!next || next.id === entry.id) return;
    setError(null);
    // P11 §D: what the switch drops is said — a setting, or the audio source a video-only model cannot take.
    const dropsSource = videoOnlySource(next.id) && Boolean(raw.source) && st.kind !== "video";
    setSwitchText(noticeLine(next, [...switchParts(entry, next, raw), ...(dropsSource ? ["manba olib tashlandi — bu model faqat videoni oladi"] : [])]));
    setState((s) => pickSpeechModel(s, next));
  }

  const uploaded = typeof raw.sourceSeconds === "number" && typeof raw.source === "string" && raw.source.startsWith("upload:") ? raw.sourceSeconds : null;
  // Each upload tab shows its own file's length (an audio upload is not the video tab's).
  const uploadSeconds = st.kind === "audio" ? uploaded : null;
  const videoSeconds = st.kind === "video" ? uploaded : null;

  const resultsLabel = mode === "dub" ? "Dublyajlar" : "Transkripsiyalar";
  return (
    <div data-speech-tool={mode} data-speech-model={entry.id}>
      <StudioWorkbench
        resultsRef={resultsRef}
        hasResults={jobs.length > 0}
        empty={mode === "dub" ? "Dublyaj natijalari shu yerda ko‘rinadi." : "Transkripsiyalar shu yerda ko‘rinadi."}
        label={resultsLabel}
        results={
          <section aria-label={resultsLabel} data-speech-results className="min-w-0">
            <SpeechToolResults jobs={jobs} busy={submitting} onAgain={again} retryPrice={retryPrice} />
          </section>
        }
        form={
          <>
      {before}
      {entries.length > 1 ? (
        // P11 §D: cards with the price of a minute of source and the specs, not a bare segmented control.
        <div data-audio-model-picker>
          <MediaModelPicker
            purpose={STUDIO_AUDIO_LISTING}
            catalog={{ purpose: STUDIO_AUDIO_LISTING, defaultModelId: entries[0]?.id ?? null, models: [...entries], pricing }}
            value={entry.id}
            values={raw}
            onChange={pickModel}
            priceOf={(m) => `~${groupDigits(speechToolClientPrice(mode, m, requestValues(m, { ...raw, sourceSeconds: 60 }), pricing))} so'm / 1 daq`}
            labelOf={(m) => audioModelLabel(m, modeLabel)}
          />
          <SwitchNotice text={switchText} onClose={() => setSwitchText(null)} />
        </div>
      ) : null}
      <Card title="Manba">
        <Field id="source">
          <div className="flex flex-col gap-3">
            <Segmented
              ariaLabel="Manba turi"
              value={shownTab}
              onChange={(v) => setTab(v as SourceTab)}
              options={[
                { value: "result", label: "Natijalarimdan" },
                // A video-only model (HeyGen) takes no audio: that tab is not offered there.
                ...(videoOnly ? [] : [{ value: "upload", label: "Audio yuklash" }]),
                { value: "video", label: "Video yuklash" },
              ]}
            />
            {st.tab === "video" ? (
              <VideoInputRow maxBytes={videoLimit} seconds={videoSeconds} uploading={uploading} error={uploadError} onFile={(f) => void onVideo(f)} />
            ) : st.tab === "result" || videoOnly ? (
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
                    Hali tayyor video yoki audio yo‘q — avval «Video», «Ovoz» yoki «Audio» bo‘limida yarating, yoki o‘z faylingizni yuklang.
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
                  {videoOnly ? "Faqat video, ≤ 3 daqiqa. Natija — MP4." : mode === "dub" ? "Video yoki audio ≤ 3 daqiqa. Natija — video uchun MP4, audio uchun MP3." : "Video ≤ 3 daqiqa, audio ≤ 10 daqiqa. Natija — matn, SRT va VTT subtitr."}
                </p>
              </div>
            ) : (
              <AudioInputRow fieldIds={null} title="Audio fayl" seconds={uploadSeconds} uploading={uploading} error={uploadError} onPrepared={(s) => void onPrepared(s)} />
            )}
          </div>
        </Field>
        <Field id="sourceSeconds">
          <p className="text-muted-foreground mt-2 text-[13px] tabular-nums" data-speech-seconds role="status">
            {typeof raw.sourceSeconds === "number" && raw.source ? billedLine(entry, raw.sourceSeconds) : "Narx manba uzunligiga qarab hisoblanadi."}
          </p>
        </Field>
      </Card>

      <ParamRows entry={formEntry} raw={raw} onChange={setParam} />

      <SubmitError error={error} gated={gated} />
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
          </>
        }
      />
    </div>
  );
}

/** The panel's results, newest first: progress → the transcript (+ subtitle downloads) / the dubbed file; a failure says why. */
export function SpeechToolResults({
  jobs,
  busy,
  onAgain,
  retryPrice,
}: {
  jobs: readonly StudioJob[];
  busy: boolean;
  onAgain: (job: StudioJob) => void;
  retryPrice?: (job: StudioJob) => number;
}) {
  return (
    <JobList jobs={jobs}>
      {(job) => (
        <JobResult job={job} busy={busy} onAgain={onAgain} retryPrice={retryPrice} failed="Bajarilmadi" lost="Natija baribir tayyor bo‘lishi mumkin — «Ishlarim»ni tekshiring.">
          {(gen) => <Done job={job} gen={gen} busy={busy} onAgain={onAgain} />}
        </JobResult>
      )}
    </JobList>
  );
}

/**
 * P11 §D: the user's own video for «Dublyaj» / «Transkripsiya» — one MP4 or MOV file (≤ 3 min, the tool's size limit), uploaded through the
 * audio-inputs path with `kind=video`; the server measures it and bills its whole seconds, shown here once uploaded.
 */
function VideoInputRow({ maxBytes, seconds, uploading, error, onFile }: { maxBytes: number; seconds: number | null; uploading: boolean; error: string | null; onFile: (f: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2" data-video-input>
      <p className="text-muted-foreground text-[13.5px] leading-snug">MP4 yoki MOV, {VIDEO_INPUT_MAX_SECONDS / 60} daqiqagacha, {maxBytes / 1024 / 1024} MB gacha. Narx video uzunligiga qarab hisoblanadi.</p>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={cn(ACTION, "w-fit")} data-video-upload>
        <Upload className="size-4" aria-hidden />
        {uploading ? "Yuklanmoqda…" : "Video tanlash"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.m4v,.mov"
        hidden
        data-video-file
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      <p className="text-[13.5px] font-semibold tabular-nums" data-video-input-seconds role="status">
        {uploading ? "Yuklanmoqda..." : seconds !== null ? `Yuklandi: ${fmtSeconds(seconds)} (${seconds} s)` : "Hali video tanlanmagan"}
      </p>
      <p className="text-muted-foreground text-[12.5px] leading-snug">Yuklangan fayl 1 kundan keyin o‘chiriladi.</p>
      {error ? (
        <p role="alert" className="text-destructive text-[14px]" data-video-input-error>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Copies the transcript; `false` when the browser offers no clipboard (the text stays selectable on the card). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Done({ job, gen, busy, onAgain }: { job: StudioJob; gen: api.GenerationDetail; busy: boolean; onAgain: (j: StudioJob) => void }) {
  const src = useApiSrc(`/api/generations/${job.id}/file?inline=1`);
  const [dlError, setDlError] = useState<string | null>(null);
  // P11 §D: the transcript opens in full on the card and copies with one press.
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const t = gen.doc?.transcribe;
  const dub = gen.doc?.dub;
  const video = t?.burned || dub?.output === "mp4";
  const download = (format: DownloadFormatId) => {
    setDlError(null);
    downloadToDevice(job.id, format).catch((e: unknown) => setDlError(deliverErrorText(e)));
  };
  const [favError, setFavError] = useState<string | null>(null);
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
        <>
          <p className={cn("text-[14.5px] leading-relaxed whitespace-pre-line break-words", !full && "line-clamp-6")} data-speech-text data-speech-text-full={full ? "true" : "false"}>
            {t.text || "Nutq topilmadi."}
          </p>
          {t.text ? (
            <div className="flex flex-wrap gap-1.5" data-speech-text-tools>
              <button type="button" data-result-action="full-text" aria-expanded={full} onClick={() => setFull((v) => !v)} className={ACTION}>
                {full ? "Qisqartirish" : "To‘liq matn"}
              </button>
              <button
                type="button"
                data-result-action="copy"
                onClick={() => void copyText(t.text).then((ok) => setCopied(ok ? "yes" : "no"))}
                className={ACTION}
              >
                <Copy className="size-4" aria-hidden />
                {copied === "yes" ? "Nusxalandi" : "Nusxalash"}
              </button>
              {copied === "no" ? (
                <span role="alert" className="text-destructive self-center text-[13px]" data-copy-failed>
                  Nusxalab bo‘lmadi — matnni belgilab oling.
                </span>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <JobMeta job={job} extra={t ? languageLabel(t.language ?? t.requestedLanguage) : dub ? languageLabel(dub.target) : undefined} />
        </div>
        <FavoriteButton id={job.id} onError={setFavError} />
      </div>
      {favError ? (
        <p role="alert" className="text-destructive text-[13px]" data-favorite-error>
          {favError}
        </p>
      ) : null}
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
          {AGAIN_LABEL}
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
