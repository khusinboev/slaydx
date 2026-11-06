"use client";

import { ENHANCE_MIN } from "@/lib/media/enhance";
import { EnhanceTool } from "../PromptBox";
import { usePromptEnhance } from "../usePromptEnhance";
import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatSom, groupDigits } from "@/lib/format";
import type { ClientEntry } from "@/lib/studio-core";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card, Segmented } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { takesAudioInput, type AudioMode } from "@/lib/media/catalog-audio";
import { audioJobLabels, audioModelLabel, offeredModes } from "./audio-modes";
import { audioOutputCount } from "@/lib/media/studio-audio";
import { CatalogState } from "../CatalogState";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import type { CatalogLoad } from "../studio-api";
import { SubmitError } from "../SubmitError";
import { useStudioSend } from "../useStudioSend";
import { carryOver, effective, requestValues, type RawValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import { VoiceList, VoicesState, voiceRows, type VoiceFilter } from "../voice/VoiceList";
import { VoiceResults } from "../voice/VoiceResults";
import { useVoices } from "../voice/voice-api";
import type { PreparedSample } from "../voice/wav";
import { AudioInputRow } from "./AudioInputRow";
import { STUDIO_AUDIO_SLUG, STUDIO_AUDIO_TOOL_ID, audioClientPrice, uploadAudioInput } from "./audio-api";
import { INITIAL_MIX_STATE, type MixTabState } from "./mix-api";
import { MixPanel } from "./MixPanel";
import { MIX_MODES } from "@/lib/media/catalog-mix";
import { SPEECH_TOOL_MODEL_IDS, type SpeechToolMode } from "@/lib/media/catalog-transcribe";
import { SpeechToolPanel } from "./SpeechToolPanel";
import { INITIAL_SPEECH_TOOL, offeredSpeechTools, type SpeechToolsState } from "./speech-tool-api";

/** The «Montaj» chip's mode id (P8c). */
export const MIX_CHIP = "mix" as const;
/**
 * The tab's form state; the page keeps it across tab switches. Raw values are per mode. `models` = the model picked in a
 * mode that offers more than one (P9 «Musiqa»: ElevenLabs | Lyria); absent = the mode's first offered model.
 * `mode: "mix"` = the P8c «Montaj» mode (ffmpeg, no provider — offered even while no catalog mode is), its own state in
 * `mix`.
 */
export type AudioTabState = {
  mode: AudioMode | typeof MIX_CHIP | SpeechToolMode | null;
  raw: Partial<Record<AudioMode, RawValues>>;
  filter: VoiceFilter;
  models?: Partial<Record<AudioMode, string>>;
  mix?: MixTabState;
  /** P10 «Transkripsiya» / «Dublyaj»: each tool's own form state. */
  tools?: SpeechToolsState;
};
export const INITIAL_AUDIO_STATE: AudioTabState = { mode: null, raw: {}, filter: "all" };
const MIX_MODEL_IDS = new Set(MIX_MODES.map((m) => m.model));
/** A job of the «Montaj» mode (its results render in the «Montaj» panel, not in the provider modes' list). */
export const isMixJob = (job: { modelId: string }): boolean => MIX_MODEL_IDS.has(job.modelId);
/** A job of the P10 «Transkripsiya» / «Dublyaj» chips (their results render in their own panel). */
export const isSpeechToolJob = (job: { modelId: string }): boolean => SPEECH_TOOL_MODEL_IDS.includes(job.modelId);

/** Params drawn by the tab itself (prompt box, upload row, voice list), not by `ParamRows`. */
const OWN_ROWS = new Set(["prompt", "inputId", "inputSeconds", "voice"]);

export { audioJobLabels, audioModelLabel, offeredModes } from "./audio-modes";

/** «Yaratish · Musiqa · ~2 100 so'm». */
export function audioSubmitLabel(mode: string, price: number): string {
  return `Yaratish · ${mode} · ~${formatSom(price)}`;
}

/** Why «Yaratish» cannot send yet (Uzbek), `null` when it can: the prompt minimum, or no uploaded input. */
export function audioBlocker(entry: ClientEntry, raw: RawValues): string | null {
  const prompt = entry.params.find((p) => p.name === "prompt");
  if (prompt && prompt.type === "text") {
    const len = String(raw.prompt ?? "").replace(/\s+/g, " ").trim().length;
    if (len < prompt.min) return `Tavsif kamida ${prompt.min} ta belgi bo‘lsin.`;
  }
  if (takesAudioInput(entry) && !raw.inputId) return "Avval audio faylni yuklang yoki yozib oling.";
  return null;
}

/**
 * Studio «Audio» tab (docs/studio/P6-SPEC.md): mode chips Musiqa / Effekt / Ovozni almashtirish / Shovqindan tozalash
 * (only the offered ones), per mode only its controls — the description box (music / effect), the upload row with the
 * recorder (voice changer / isolator), the voice list (voice changer: the ElevenLabs library + «Mening ovozlarim»), the
 * rest generated from the catalog (`ParamRows`) — the sticky «Yaratish · <mode> · ~X so'm», and the results with an MP3
 * player, «Yuklab olish (MP3)» and «Qayta».
 */
export function AudioTab({
  catalogState,
  reload,
  state,
  setState,
  jobs,
  track,
  balance,
  typing,
  gated,
}: {
  catalogState: CatalogLoad;
  reload: (silent?: boolean) => void;
  state: AudioTabState;
  setState: (fn: (s: AudioTabState) => AudioTabState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  balance: number | null;
  typing: boolean;
  gated: boolean;
}) {
  const promptId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { submitting, error, setError, send: queue } = useStudioSend((refused) => {
    reload(true);
    if (refused && needsVoices) loadVoices();
  });
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const modes = offeredModes(catalog?.models ?? []);
  const speechTools = offeredSpeechTools(catalog?.models ?? []);
  const mixOn = state.mode === MIX_CHIP;
  // P10: a picked tool chip; with no provider mode offered, the first tool opens by default.
  const tool = mixOn ? undefined : (speechTools.find((t) => t.mode === state.mode) ?? (state.mode === null && modes.length === 0 ? speechTools[0] : undefined));
  const current = mixOn || tool ? null : (modes.find((m) => m.mode === state.mode) ?? modes[0] ?? null);
  const { enhance, enhancing } = usePromptEnhance(
    current?.mode === "sfx" ? "sfx" : "music",
    () => String((current && state.raw[current.mode]?.prompt) ?? "").replace(/\s+/g, " ").trim(),
    (v) => setParam("prompt", v.slice(0, promptMax)),
    setError,
  );
  const needsVoices = current?.mode === "voice-changer";
  const providerJobs = jobs.filter((j) => !isMixJob(j) && !isSpeechToolJob(j));
  const mixJobs = jobs.filter(isMixJob);

  const { voices, error: voicesError, load: loadVoices } = useVoices(needsVoices);

  /** Mode chips: the catalog's offered modes, the P10 tools that are on, then «Montaj» (always offered: it needs no provider). */
  const chips = (active: string | null) => (
    <div role="radiogroup" aria-label="Audio turi" className="mb-3 flex flex-wrap gap-1.5" data-audio-modes>
      {[
        ...modes.map((m) => ({ mode: m.mode as AudioMode | typeof MIX_CHIP | SpeechToolMode, label: m.label })),
        ...speechTools.map((t) => ({ mode: t.mode as AudioMode | typeof MIX_CHIP | SpeechToolMode, label: t.label })),
        { mode: MIX_CHIP, label: "Montaj" },
      ].map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={m.mode === active}
          data-audio-mode-chip={m.mode}
          onClick={() => pickMode(m.mode)}
          className={cn(
            "focus-visible:ring-ring min-h-11 rounded-full border px-3.5 text-[14px] font-semibold outline-none focus-visible:ring-2",
            m.mode === active ? "bg-primary text-primary-foreground border-transparent" : "bg-card hover:bg-muted",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
  function pickMode(m: AudioMode | typeof MIX_CHIP | SpeechToolMode) {
    setError(null);
    setUploadError(null);
    setState((s) => ({ ...s, mode: m }));
  }

  if (mixOn) {
    return (
      <div data-audio-tab data-audio-mode={MIX_CHIP}>
        {chips(MIX_CHIP)}
        <MixPanel
          state={state.mix ?? INITIAL_MIX_STATE}
          setState={(fn) => setState((s) => ({ ...s, mix: fn(s.mix ?? INITIAL_MIX_STATE) }))}
          jobs={mixJobs}
          track={track}
          balance={balance}
          typing={typing}
          gated={gated}
        />
      </div>
    );
  }

  if (!catalog) return <CatalogState state={catalogState} onRetry={() => reload()} label="Audio yuklanmoqda" blocks={["h-36 rounded-[20px]", "h-64 rounded-[20px]"]} />;
  if (tool) {
    return (
      <div data-audio-tab data-audio-mode={tool.mode}>
        {chips(tool.mode)}
        <SpeechToolPanel
          key={tool.mode}
          mode={tool.mode}
          entry={tool.entry}
          pricing={catalog.pricing}
          state={state.tools?.[tool.mode]}
          setState={(fn) => setState((s) => ({ ...s, tools: { ...s.tools, [tool.mode]: fn(s.tools?.[tool.mode] ?? INITIAL_SPEECH_TOOL) } }))}
          jobs={jobs.filter((j) => j.modelId === tool.entry.id)}
          track={track}
          balance={balance}
          typing={typing}
          gated={gated}
          reload={reload}
        />
      </div>
    );
  }
  if (!current) {
    return (
      <div data-audio-tab>
        {chips(null)}
        <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-audio-none>
          AI audio hozircha mavjud emas. «Montaj» bilan tayyor natijalaringizni birlashtirishingiz mumkin.
        </p>
      </div>
    );
  }

  const { mode, label: modeLabel, entries } = current;
  const entry = entries.find((e) => e.id === state.models?.[mode]) ?? current.entry;
  // The results list names the model in full («Musiqa · Lyria 3»); the button keeps it short so the price fits a phone.
  const { job: label, button: buttonLabel } = audioJobLabels(entry, modeLabel, entries.length);
  const raw = state.raw[mode] ?? {};
  const values = effective(entry, raw);
  const blocker = audioBlocker(entry, raw);
  const sent = requestValues(entry, raw);
  const price = blocker ? null : audioClientPrice(entry, sent, catalog.pricing);
  const count = audioOutputCount(entry, values);
  const prompt = entry.params.find((p) => p.name === "prompt");
  const promptMax = prompt && prompt.type === "text" ? prompt.max : 0;
  const formEntry = { ...entry, params: entry.params.filter((p) => !OWN_ROWS.has(p.name)) };

  /** Another model of the mode: the values it also accepts carry over (the prompt, «Faqat kuy»), the rest reset. */
  const pickModel = (id: string) => {
    const next = entries.find((e) => e.id === id);
    if (!next || next.id === entry.id) return;
    setError(null);
    setState((s) => ({ ...s, models: { ...s.models, [mode]: next.id }, raw: { ...s.raw, [mode]: carryOver(next, s.raw[mode] ?? {}) } }));
  };

  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [mode]: { ...(s.raw[mode] ?? {}), [name]: value } } }));

  async function onPrepared(s: PreparedSample) {
    setUploading(true);
    setUploadError(null);
    try {
      const r = await uploadAudioInput(s.blob, s.fileName);
      setState((st) => ({ ...st, raw: { ...st.raw, [mode]: { ...(st.raw[mode] ?? {}), inputId: r.id, inputSeconds: r.seconds } } }));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Audio yuklanmadi");
    } finally {
      setUploading(false);
    }
  }

  function send(target: ClientEntry, targetLabel: string, out: Record<string, unknown>) {
    if (!catalog) return Promise.resolve(false);
    const title = (String(out.prompt ?? "").trim() || targetLabel).slice(0, 72);
    return queue({ slug: STUDIO_AUDIO_SLUG, id: STUDIO_AUDIO_TOOL_ID, title, output: "mp3" }, out, audioClientPrice(target, out, catalog.pricing), ({ id, price: charged }) =>
      track({ id, modelId: target.id, modelLabel: targetLabel, prompt: title, price: charged, sent: out }),
    );
  }

  function submit() {
    if (blocker) {
      setError(blocker);
      return;
    }
    void send(entry, label, sent);
  }

  const jobTarget = (job: StudioJob) => modes.flatMap((m) => m.entries.map((e) => ({ e, label: audioJobLabels(e, m.label, m.entries.length).job }))).find((x) => x.e.id === job.modelId);

  function again(job: StudioJob) {
    const target = jobTarget(job);
    if (!target) {
      setError("Bu rejim hozir mavjud emas.");
      return;
    }
    void send(target.e, target.label, job.sent);
  }

  function retryPrice(job: StudioJob): number {
    const target = jobTarget(job);
    return target && catalog ? audioClientPrice(target.e, job.sent, catalog.pricing) : job.price;
  }

  const provider = "elevenlabs" as const;
  const rows = voices ? voiceRows(voices.library.elevenlabs, provider, voices.mine.filter((v) => v.status === "ready"), true, state.filter) : [];
  const typed = String(raw.prompt ?? "");

  return (
    <div data-audio-tab data-audio-mode={mode} data-audio-model={entry.id}>
      {chips(mode)}

      {entries.length > 1 ? (
        <div data-audio-model-picker>
          <Card title="Model">
            <Segmented ariaLabel="Model" value={entry.id} onChange={pickModel} options={entries.map((e) => ({ value: e.id, label: audioModelLabel(e, modeLabel) }))} />
          </Card>
        </div>
      ) : null}

      {prompt ? (
        <section aria-label="Tavsif" data-audio-prompt className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
          <label htmlFor={promptId} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
            {prompt.label}
          </label>
          <Field id="prompt">
            <AutoTextarea
              id={promptId}
              value={typed}
              onChange={(e) => setParam("prompt", e.target.value.slice(0, promptMax))}
              minRows={3}
              maxRows={10}
              maxLength={promptMax}
              placeholder={mode === "music" ? "Masalan: calm lo-fi hip hop, soft piano, rainy evening mood" : "Masalan: eshik g‘ichirlab ochiladi, uzoqda momaqaldiroq"}
              className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] leading-relaxed outline-none"
            />
          </Field>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
            {prompt.hint ? <span className="text-muted-foreground text-[12.5px] leading-snug">{prompt.hint}</span> : <span />}
            <span className="text-muted-foreground text-[12.5px] tabular-nums" data-audio-chars>
              {groupDigits(typed.length)} / {groupDigits(promptMax)}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" data-prompt-tools>
            <EnhanceTool disabled={typed.trim().length < ENHANCE_MIN} enhancing={enhancing} onClick={() => void enhance()} />
          </div>
        </section>
      ) : null}

      {takesAudioInput(entry) ? (
        <AudioInputRow seconds={typeof raw.inputSeconds === "number" && raw.inputId ? raw.inputSeconds : null} uploading={uploading} error={uploadError} onPrepared={(s) => void onPrepared(s)} />
      ) : null}

      {mode === "voice-changer" ? (
        <Card title="Yangi ovoz">
          <Field id="voice">
            {voicesError || !voices ? (
              <VoicesState error={voicesError} onRetry={loadVoices} />
            ) : (
              <VoiceList
                rows={rows}
                value={String(values.voice ?? "")}
                onPick={(v) => setParam("voice", v)}
                filter={state.filter}
                onFilter={(f) => setState((s) => ({ ...s, filter: f }))}
                filters={["all", "male", "female", "mine"]}
              />
            )}
          </Field>
        </Card>
      ) : null}

      <ParamRows entry={formEntry} raw={raw} onChange={setParam} />

      <SubmitError error={error} gated={gated} />
      <PriceButton
        count={count}
        price={price}
        balance={balance}
        loading={submitting}
        disabled={uploading}
        typing={typing}
        onSubmit={submit}
        label={price === null ? undefined : audioSubmitLabel(count > 1 ? `${buttonLabel} ×${count}` : buttonLabel, price)}
      />
      <section aria-label="Audiolar" data-audio-results className={cn(providerJobs.length > 0 && "mt-5")}>
        <VoiceResults jobs={providerJobs} busy={submitting} onAgain={again} retryPrice={retryPrice} failed="Audio yaratilmadi" />
      </section>
    </div>
  );
}
