"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import type { FormValues } from "@/lib/types";
import type { ClientEntry } from "@/lib/studio-core";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card, Segmented } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { queueGeneration } from "@/components/forms/runGeneration";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { speechTextParam } from "@/lib/media/studio-speech";
import { takesClones, voiceParamsOf } from "@/lib/media/catalog-speech";
import { MediaModelPicker } from "../MediaModelPicker";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { STUDIO_SPEECH_PURPOSE, type CatalogState } from "../studio-api";
import type { MediaCatalog } from "../studio-types";
import { carryOver, effective, type RawValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import { useStudioJobs } from "../useStudioJobs";
import { ClonePanel, type CloneRequest } from "./ClonePanel";
import { VoiceList, voiceRows, type VoiceFilter, type VoiceRow } from "./VoiceList";
import { VoiceResults } from "./VoiceResults";
import { deleteVoice, fetchVoices, uploadSample, type VoicesData } from "./voice-api";
import { STUDIO_SPEECH_SLUG, STUDIO_SPEECH_TOOL_ID, STUDIO_VOICE_SLUG, STUDIO_VOICE_TOOL_ID, charLine, cloneClientPrice, speechCardPrice, speechClientPrice, spokenText } from "./voice-price";

/** «Matn» (one voice reads the text) or «Suhbat» (two speakers, one line per turn). */
export type VoiceMode = "text" | "dialogue";

/** The tab's form state; the page keeps it across tab switches. */
export type VoiceTabState = { mode: VoiceMode | null; chosen: string | null; raw: RawValues; filter: VoiceFilter; speaker: number };
export const INITIAL_VOICE_STATE: VoiceTabState = { mode: null, chosen: null, raw: {}, filter: "all", speaker: 0 };

const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;
export const isDialogue = (e: Pick<ClientEntry, "capabilities">): boolean => e.capabilities.includes("dialogue");

/** The catalog split by what a model does (clones are never in this catalog: purpose `studio.speech`). */
export function splitSpeechCatalog(catalog: MediaCatalog | null): { text: ClientEntry[]; dialogue: ClientEntry[] } {
  const all = catalog?.models ?? [];
  return { text: all.filter((m) => !isDialogue(m)), dialogue: all.filter(isDialogue) };
}

export function shownVoiceMode(state: VoiceTabState, split: ReturnType<typeof splitSpeechCatalog>): VoiceMode | null {
  const can = { text: split.text.length > 0, dialogue: split.dialogue.length > 0 };
  if (state.mode && can[state.mode]) return state.mode;
  return can.text ? "text" : can.dialogue ? "dialogue" : null;
}

/** «Ovozlash · ElevenLabs v3 · ~280 so'm» (canvas). */
export function voiceSubmitLabel(model: string, price: number): string {
  return `Ovozlash · ${model} · ~${formatSom(price)}`;
}

/**
 * What goes out: `{ modelId }` + the model's ParamSchema values, with the spoken text AS TYPED (trimmed, line breaks
 * kept — a dialogue's turns are its lines; the server normalizes for the price exactly like the preview does).
 */
export function speechRequest(entry: ClientEntry, raw: RawValues): Record<string, unknown> {
  const values = effective(entry, raw);
  const field = speechTextParam(entry);
  const max = entry.params.find((p) => p.name === field);
  const typed = String(raw[field] ?? "").trim();
  return { modelId: entry.id, ...values, [field]: max && max.type === "text" ? typed.slice(0, max.max) : typed };
}

/**
 * Studio «Ovoz» tab (docs/studio/P5-SPEC.md; canvas TabletVoice): the text box with its character count and «~N s»
 * estimate (+ «Fayldan»: a .txt into the box), «Matn» | «Suhbat», the model picker, the voice list (filter chips
 * Hammasi / Erkak / Ayol / Mening ovozlarim, ▶ preview per voice, «+ O'z ovozimni klonlash»), the model's own settings
 * (Tezlik / Kayfiyat / Til — only those the chosen model really has), the sticky «Ovozlash · <model> · ~X so'm», and the
 * results with an MP3 player + download. «Fon musiqa» belongs to P6 and is not drawn.
 */
export function VoiceTab({
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
  state: VoiceTabState;
  setState: (fn: (s: VoiceTabState) => VoiceTabState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  balance: number | null;
  typing: boolean;
  gated: boolean;
}) {
  const textId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [voices, setVoices] = useState<VoicesData | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const cloneJobs = useStudioJobs();
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const split = splitSpeechCatalog(catalog);
  const mode = shownVoiceMode(state, split);
  const models = mode === "dialogue" ? split.dialogue : split.text;
  const entry = models.find((m) => m.id === state.chosen) ?? models.find((m) => m.id === catalog?.defaultModelId) ?? models[0] ?? null;

  const loadVoices = useCallback(() => {
    fetchVoices().then(setVoices, (e: unknown) => setError(e instanceof Error ? e.message : "Ovozlar yuklanmadi"));
  }, []);
  useEffect(() => loadVoices(), [loadVoices]);

  // A finished clone job: the list shows the new voice (and the server's state of it).
  const doneClones = cloneJobs.jobs.filter((j) => j.gen && j.gen.status !== "QUEUED" && j.gen.status !== "IN_PROGRESS").length;
  useEffect(() => {
    if (doneClones > 0) loadVoices();
  }, [doneClones, loadVoices]);

  const patch = (change: Partial<VoiceTabState>) => setState((s) => ({ ...s, ...change }));
  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [name]: value } }));

  function selectModel(id: string) {
    const next = models.find((m) => m.id === id);
    if (!next) return;
    setState((s) => {
      const kept = carryOver(next, s.raw);
      // The spoken text stays as typed (carryOver clips text params; line breaks matter for a dialogue).
      const field = speechTextParam(next);
      return { ...s, chosen: id, raw: { ...kept, [field]: String(s.raw[field] ?? "").slice(0, (next.params.find((p) => p.name === field) as { max?: number } | undefined)?.max ?? 4000) } };
    });
  }

  if (!catalog) {
    return catalogState.status === "error" ? (
      <p role="alert" className="text-destructive text-[14.5px]" data-studio-catalog-error>
        {catalogState.message}{" "}
        <button type="button" onClick={() => reload()} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    ) : (
      <div className="flex flex-col gap-3" role="status" aria-label="Ovoz yuklanmoqda" data-studio-loading>
        <div className="bg-muted/60 h-36 animate-pulse rounded-[20px]" />
        <div className="bg-muted/60 h-64 animate-pulse rounded-[20px]" />
      </div>
    );
  }
  if (!mode || !entry) {
    return (
      <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-voice-none>
        Ovoz bo‘limi hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.
      </p>
    );
  }

  const field = speechTextParam(entry);
  const textMax = (entry.params.find((p) => p.name === field) as { max?: number } | undefined)?.max ?? 4000;
  const text = String(state.raw[field] ?? "");
  const sent = speechRequest(entry, state.raw);
  const typedChars = String(effective(entry, { [field]: text })[field] ?? "").length;
  const price = typedChars > 0 ? speechClientPrice(entry, sent, catalog.pricing) : null;
  const vparams = voiceParamsOf(entry);
  const speakerParam = vparams[Math.min(state.speaker, vparams.length - 1)] ?? "voice";
  const values = effective(entry, state.raw);
  const provider = entry.id.startsWith("elevenlabs/") ? "elevenlabs" : "gemini";
  const clones = takesClones(entry);
  const library = voices ? (provider === "elevenlabs" ? voices.library.elevenlabs : voices.library.gemini) : [];
  const rows = voiceRows(library, provider, voices?.mine ?? [], clones, state.filter);
  const filters: VoiceFilter[] = clones ? ["all", "male", "female", "mine"] : ["all", "male", "female"];
  const hasClone = (voices?.mine.length ?? 0) > 0;
  const cloneOffer = voices?.clone ?? null;
  // The ParamRows show only the model's own settings; the text box and the voice list draw the rest.
  const formEntry = { ...entry, params: entry.params.filter((p) => p.type !== "voice" && p.name !== field && !/^voice\d?$/.test(p.name)) };

  async function send(target: ClientEntry, values: Record<string, unknown>) {
    if (!catalog) return;
    setError(null);
    setSubmitting(true);
    const label = spokenText(target, values).replace(/\s+/g, " ").slice(0, 72);
    try {
      const { id, price: charged } = await queueGeneration(
        { slug: STUDIO_SPEECH_SLUG, id: STUDIO_SPEECH_TOOL_ID, title: label, output: "mp3" },
        values as unknown as FormValues,
        speechClientPrice(target, values, catalog.pricing),
        { repeat: true },
      );
      track({ id, modelId: target.id, modelLabel: target.label, prompt: label, price: charged, sent: values });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      if ((e instanceof ApiError && e.status === 400) || e instanceof PriceChangedError) reload(true);
      if (e instanceof ApiError && e.status === 400) loadVoices();
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (!entry) return;
    if (!typedChars) {
      setError(mode === "dialogue" ? "Suhbat matnini yozing («Ism: gap» qatorlari)" : "Ovozlanadigan matnni yozing");
      return;
    }
    void send(entry, sent);
  }

  function again(job: StudioJob) {
    const target = catalog?.models.find((m) => m.id === job.modelId);
    if (!target) {
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      return;
    }
    void send(target, job.sent);
  }

  async function clone(r: CloneRequest) {
    if (!cloneOffer) return;
    setCloneBusy(true);
    setCloneError(null);
    try {
      const { sampleId } = await uploadSample(r.sample.blob, r.sample.fileName, r.consent);
      const values = { name: r.name, sampleId };
      const shown = cloneClientPrice(cloneOffer.price);
      const { id, price: charged } = await queueGeneration({ slug: STUDIO_VOICE_SLUG, id: STUDIO_VOICE_TOOL_ID, title: `Ovoz klonlash: ${r.name}`, output: "mp3" }, values as unknown as FormValues, shown);
      cloneJobs.track({ id, modelId: "elevenlabs/voice-clone", modelLabel: "Ovoz klonlash", prompt: `«${r.name}» ovozi`, price: charged, sent: values });
      setCloneOpen(false);
      patch({ filter: "mine" });
      // The 'creating' row appears once the worker takes the job; ask again shortly.
      setTimeout(loadVoices, 4000);
    } catch (e) {
      setCloneError(e instanceof Error ? e.message : "Klonlash boshlanmadi");
      if (e instanceof PriceChangedError) loadVoices();
    } finally {
      setCloneBusy(false);
    }
  }

  async function remove(row: VoiceRow) {
    const id = row.value.replace(/^clone:/, "");
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(`«${row.name}» ovozini o‘chirasizmi? Yangi klon uchun qayta to‘lanadi.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteVoice(id);
      // A deleted voice can no longer be picked: back to the model's default.
      setState((s) => {
        const raw = { ...s.raw };
        for (const n of vparams) if (raw[n] === row.value) delete raw[n];
        return { ...s, raw };
      });
      loadVoices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "O‘chirilmadi");
    } finally {
      setDeleting(false);
    }
  }

  async function fromFile(f: File) {
    if (f.size > 64 * 1024 || !/^text\/plain$|\.txt$/i.test(f.type || f.name)) {
      setError("Faqat .txt fayl (64 KB gacha).");
      return;
    }
    const t = await f.text();
    setParam(field, t.slice(0, textMax));
  }

  const busyClone = cloneJobs.jobs.some((j) => !j.gen || j.gen.status === "QUEUED" || j.gen.status === "IN_PROGRESS");

  return (
    <div data-voice-tab>
      {split.text.length > 0 && split.dialogue.length > 0 ? (
        <div className="mb-3" data-voice-mode>
          <Segmented
            ariaLabel="Ovoz turi"
            options={[
              { value: "text", label: "Matn" },
              { value: "dialogue", label: "Suhbat" },
            ]}
            value={mode}
            onChange={(v) => patch({ mode: v === "dialogue" ? "dialogue" : "text", speaker: 0 })}
          />
        </div>
      ) : null}

      <section aria-label="Matn" data-voice-text className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
        <label htmlFor={textId} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
          {mode === "dialogue" ? "Suhbat matni — har qator «Ism: gap»" : "Ovozlanadigan matn"}
        </label>
        <Field id={field}>
          <AutoTextarea
            id={textId}
            value={text}
            onChange={(e) => setParam(field, e.target.value.slice(0, textMax))}
            minRows={mode === "dialogue" ? 5 : 4}
            maxRows={14}
            maxLength={textMax}
            placeholder={mode === "dialogue" ? "Ali: Assalomu alaykum! Bugun nima haqida gaplashamiz?\nMalika: Salom! Keling, yangi kitob haqida." : "Masalan: Hurmatli mijozlar! Do‘konimizda yangi mavsum chegirmalari boshlandi."}
            className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] leading-relaxed outline-none"
          />
        </Field>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-[12.5px] tabular-nums" data-voice-chars>
            {charLine(typedChars, textMax)}
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="hover:bg-muted focus-visible:ring-ring pointer-coarse:min-h-11 inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-[13px] font-semibold outline-none focus-visible:ring-2"
            data-voice-from-file
          >
            <FileText className="size-4" aria-hidden />
            Fayldan
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void fromFile(f);
            }}
          />
        </div>
      </section>

      <MediaModelPicker
        purpose={STUDIO_SPEECH_PURPOSE}
        catalog={{ ...catalog, models }}
        value={entry.id}
        values={values}
        onChange={selectModel}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        priceOf={(m) => speechCardPrice(m, catalog.pricing)}
      />

      <Card title="Ovoz">
        {vparams.length > 1 ? (
          <div className="mb-2.5" data-voice-speakers>
            <Segmented
              ariaLabel="So‘zlovchi"
              options={vparams.map((n, i) => ({ value: String(i), label: `${i + 1}-ovoz` }))}
              value={String(Math.min(state.speaker, vparams.length - 1))}
              onChange={(v) => patch({ speaker: Number(v) })}
            />
          </div>
        ) : null}
        <Field id={speakerParam}>
          <VoiceList
            rows={rows}
            value={String(values[speakerParam] ?? "")}
            onPick={(v) => setParam(speakerParam, v)}
            filter={state.filter}
            onFilter={(f) => patch({ filter: f })}
            filters={filters}
            onDelete={(r) => void remove(r)}
            deleting={deleting}
          />
        </Field>
        {vparams.length > 1
          ? vparams
              .filter((n) => n !== speakerParam)
              .map((n) => (
                <Field key={n} id={n}>
                  <p className="text-muted-foreground mt-2 text-[13px]" data-voice-other={n}>
                    {voiceParamsLabel(n)}: {rows.find((r) => r.value === values[n])?.name ?? library.find((v) => v.id === values[n])?.name ?? (voices?.mine.find((v) => v.voice === values[n])?.name ?? String(values[n] ?? ""))}
                  </p>
                </Field>
              ))
          : null}
        {clones && cloneOffer?.available ? (
          hasClone ? (
            <p className="text-muted-foreground mt-2.5 text-[13px]" data-clone-has>
              Sizda bitta klon ovoz bor. Yangisini yaratish uchun avval eskisini o‘chiring.
            </p>
          ) : busyClone ? (
            <p className="text-muted-foreground mt-2.5 text-[13px]" data-clone-busy role="status">
              Ovozingiz klonlanmoqda…
            </p>
          ) : !cloneOpen ? (
            <button
              type="button"
              onClick={() => setCloneOpen(true)}
              className="hover:bg-muted focus-visible:ring-ring mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-[14px] border border-dashed text-[14px] font-semibold outline-none focus-visible:ring-2"
              data-clone-open
            >
              <Plus className="size-4" aria-hidden />
              O‘z ovozimni klonlash ({cloneOffer.minSeconds} s yozuv) · {formatSom(cloneClientPrice(cloneOffer.price))}
            </button>
          ) : null
        ) : null}
      </Card>

      {cloneOpen && cloneOffer && !hasClone ? (
        <ClonePanel offer={cloneOffer} price={cloneClientPrice(cloneOffer.price)} busy={cloneBusy} error={cloneError} onSubmit={(r) => void clone(r)} onClose={() => setCloneOpen(false)} />
      ) : null}
      {cloneJobs.jobs.length ? (
        <section aria-label="Klon" className="mb-3" data-clone-results>
          <VoiceResults jobs={cloneJobs.jobs} busy={cloneBusy} />
        </section>
      ) : null}

      <ParamRows entry={formEntry} raw={state.raw} onChange={setParam} />

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
        disabled={false}
        typing={typing}
        onSubmit={submit}
        label={price === null ? "Ovozlash" : voiceSubmitLabel(entry.label, price)}
      />
      <section aria-label="Audiolar" data-voice-results className={cn(jobs.length > 0 && "mt-5")}>
        <VoiceResults jobs={jobs} busy={submitting} onAgain={again} />
      </section>
    </div>
  );
}

function voiceParamsLabel(name: string): string {
  const n = /^voice(\d)$/.exec(name);
  return n ? `${n[1]}-ovoz` : "Ovoz";
}
