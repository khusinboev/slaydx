"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom, groupDigits } from "@/lib/format";
import type { FormValues } from "@/lib/types";
import type { ClientEntry } from "@/lib/studio-core";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { queueGeneration } from "@/components/forms/runGeneration";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { AUDIO_MODES, takesAudioInput, type AudioMode } from "@/lib/media/catalog-audio";
import { audioOutputCount } from "@/lib/media/studio-audio";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import type { CatalogState } from "../studio-api";
import { effective, requestValues, type RawValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import { VoiceList, voiceRows, type VoiceFilter } from "../voice/VoiceList";
import { VoiceResults } from "../voice/VoiceResults";
import { fetchVoices, type VoicesData } from "../voice/voice-api";
import type { PreparedSample } from "../voice/wav";
import { AudioInputRow } from "./AudioInputRow";
import { STUDIO_AUDIO_SLUG, STUDIO_AUDIO_TOOL_ID, audioClientPrice, uploadAudioInput } from "./audio-api";

/** The tab's form state; the page keeps it across tab switches. Raw values are per mode (each mode is its own model). */
export type AudioTabState = { mode: AudioMode | null; raw: Partial<Record<AudioMode, RawValues>>; filter: VoiceFilter };
export const INITIAL_AUDIO_STATE: AudioTabState = { mode: null, raw: {}, filter: "all" };

const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;
/** Params drawn by the tab itself (prompt box, upload row, voice list), not by `ParamRows`. */
const OWN_ROWS = new Set(["prompt", "inputId", "inputSeconds", "voice"]);

/** The modes the catalog offers now, in chip order (none while `studio.audio.enabled` is off). */
export function offeredModes(models: readonly ClientEntry[]): { mode: AudioMode; label: string; entry: ClientEntry }[] {
  return AUDIO_MODES.flatMap((m) => {
    const entry = models.find((e) => e.id === m.model);
    return entry ? [{ mode: m.mode, label: m.label, entry }] : [];
  });
}

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
  catalogState: CatalogState;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoicesData | null>(null);
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const modes = offeredModes(catalog?.models ?? []);
  const current = modes.find((m) => m.mode === state.mode) ?? modes[0] ?? null;
  const needsVoices = current?.mode === "voice-changer";

  const loadVoices = useCallback(() => {
    fetchVoices().then(setVoices, (e: unknown) => setError(e instanceof Error ? e.message : "Ovozlar yuklanmadi"));
  }, []);
  useEffect(() => {
    if (needsVoices && !voices) loadVoices();
  }, [needsVoices, voices, loadVoices]);

  if (!catalog) {
    return catalogState.status === "error" ? (
      <p role="alert" className="text-destructive text-[14.5px]" data-studio-catalog-error>
        {catalogState.message}{" "}
        <button type="button" onClick={() => reload()} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    ) : (
      <div className="flex flex-col gap-3" role="status" aria-label="Audio yuklanmoqda" data-studio-loading>
        <div className="bg-muted/60 h-36 animate-pulse rounded-[20px]" />
        <div className="bg-muted/60 h-64 animate-pulse rounded-[20px]" />
      </div>
    );
  }
  if (!current) {
    return (
      <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-audio-none>
        Audio bo‘limi hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.
      </p>
    );
  }

  const { entry, mode, label } = current;
  const raw = state.raw[mode] ?? {};
  const values = effective(entry, raw);
  const blocker = audioBlocker(entry, raw);
  const sent = requestValues(entry, raw);
  const price = blocker ? null : audioClientPrice(entry, sent, catalog.pricing);
  const count = audioOutputCount(entry, values);
  const prompt = entry.params.find((p) => p.name === "prompt");
  const promptMax = prompt && prompt.type === "text" ? prompt.max : 0;
  const formEntry = { ...entry, params: entry.params.filter((p) => !OWN_ROWS.has(p.name)) };

  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [mode]: { ...(s.raw[mode] ?? {}), [name]: value } } }));
  const pickMode = (m: AudioMode) => {
    setError(null);
    setUploadError(null);
    setState((s) => ({ ...s, mode: m }));
  };

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

  async function send(target: ClientEntry, targetLabel: string, out: Record<string, unknown>) {
    if (!catalog) return;
    setError(null);
    setSubmitting(true);
    const title = (String(out.prompt ?? "").trim() || targetLabel).slice(0, 72);
    try {
      const { id, price: charged } = await queueGeneration(
        { slug: STUDIO_AUDIO_SLUG, id: STUDIO_AUDIO_TOOL_ID, title, output: "mp3" },
        out as unknown as FormValues,
        audioClientPrice(target, out, catalog.pricing),
        { repeat: true },
      );
      track({ id, modelId: target.id, modelLabel: targetLabel, prompt: title, price: charged, sent: out });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      if ((e instanceof ApiError && e.status === 400) || e instanceof PriceChangedError) reload(true);
      if (e instanceof ApiError && e.status === 400 && needsVoices) loadVoices();
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (blocker) {
      setError(blocker);
      return;
    }
    void send(entry, label, sent);
  }

  function again(job: StudioJob) {
    const target = modes.find((m) => m.entry.id === job.modelId);
    if (!target) {
      setError("Bu rejim hozir mavjud emas.");
      return;
    }
    void send(target.entry, target.label, job.sent);
  }

  const provider = "elevenlabs" as const;
  const rows = voices ? voiceRows(voices.library.elevenlabs, provider, voices.mine.filter((v) => v.status === "ready"), true, state.filter) : [];
  const typed = String(raw.prompt ?? "");

  return (
    <div data-audio-tab data-audio-mode={mode}>
      <div role="radiogroup" aria-label="Audio turi" className="mb-3 flex flex-wrap gap-1.5" data-audio-modes>
        {modes.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={m.mode === mode}
            data-audio-mode-chip={m.mode}
            onClick={() => pickMode(m.mode)}
            className={cn(
              "focus-visible:ring-ring min-h-11 rounded-full border px-3.5 text-[14px] font-semibold outline-none focus-visible:ring-2",
              m.mode === mode ? "bg-primary text-primary-foreground border-transparent" : "bg-card hover:bg-muted",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

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
        </section>
      ) : null}

      {takesAudioInput(entry) ? (
        <AudioInputRow seconds={typeof raw.inputSeconds === "number" && raw.inputId ? raw.inputSeconds : null} uploading={uploading} error={uploadError} onPrepared={(s) => void onPrepared(s)} />
      ) : null}

      {mode === "voice-changer" ? (
        <Card title="Yangi ovoz">
          <Field id="voice">
            {voices ? (
              <VoiceList
                rows={rows}
                value={String(values.voice ?? "")}
                onPick={(v) => setParam("voice", v)}
                filter={state.filter}
                onFilter={(f) => setState((s) => ({ ...s, filter: f }))}
                filters={["all", "male", "female", "mine"]}
              />
            ) : (
              <p className="text-muted-foreground text-[13.5px]" role="status">
                Ovozlar yuklanmoqda...
              </p>
            )}
          </Field>
        </Card>
      ) : null}

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
        count={count}
        price={price}
        balance={balance}
        loading={submitting}
        disabled={uploading}
        typing={typing}
        onSubmit={submit}
        label={price === null ? undefined : audioSubmitLabel(count > 1 ? `${label} ×${count}` : label, price)}
      />
      <section aria-label="Audiolar" data-audio-results className={cn(jobs.length > 0 && "mt-5")}>
        <VoiceResults jobs={jobs} busy={submitting} onAgain={again} />
      </section>
    </div>
  );
}
