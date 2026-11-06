"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { MIX_INPUTS, MIX_MODES, type MixMode } from "@/lib/media/catalog-mix";
import { Card, SelectField } from "@/components/forms/compact";
import { Field } from "@/components/forms/shared";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { SubmitError } from "../SubmitError";
import { requestValues, type RawValues } from "../studio-values";
import { useStudioSend } from "../useStudioSend";
import type { StudioJob } from "../StudioResults";
import { VideoResults } from "../video/VideoResults";
import { VoiceResults } from "../voice/VoiceResults";
import { MIX_PICKERS, STUDIO_MIX_SLUG, STUDIO_MIX_TOOL_ID, fetchMixSources, mixClientPrice, mixEntryOf, type MixSource, type MixSources, type MixTabState } from "./mix-api";

/** «Kuy · Musiqa · 30 s». */
export function sourceLabel(s: MixSource): string {
  return `${s.title} · ${s.kind}${s.seconds ? ` · ${Math.round(s.seconds)} s` : ""}`;
}

/** Why «Montaj qilish» cannot send yet (Uzbek), `null` when it can: both pickers need a result. */
export function mixBlocker(mode: MixMode, raw: RawValues): string | null {
  const [a, b] = MIX_INPUTS[mode];
  const [pa, pb] = MIX_PICKERS[mode];
  if (!raw[a]) return `${pa.label}ni tanlang.`;
  if (!raw[b]) return `${pb.label}ni tanlang.`;
  return null;
}

/** «Montaj qilish · Videoga ovoz qo'shish · ~500 so'm». */
export function mixSubmitLabel(label: string, price: number): string {
  return `Montaj qilish · ${label} · ~${formatSom(price)}`;
}

/**
 * The «Audio» tab's «Montaj» mode (docs/studio/P8-SPEC.md «P8c»): two sub-modes «Videoga ovoz qo'shish» / «Ovoz + fon
 * musiqa», two pickers from the user's OWN finished results (ids only — the server checks ownership and kind again),
 * the options generated from the mode's schema (`ParamRows`), the sticky «Montaj qilish · <mode> · ~X so'm» and the
 * results (an MP4 plays as a clip, an MP3 as audio).
 */
export function MixPanel({
  state,
  setState,
  jobs,
  track,
  balance,
  typing,
  gated,
}: {
  state: MixTabState;
  setState: (fn: (s: MixTabState) => MixTabState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  balance: number | null;
  typing: boolean;
  gated: boolean;
}) {
  const [sources, setSources] = useState<MixSources | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null);
    fetchMixSources().then(setSources, (e: unknown) => setLoadError(e instanceof Error ? e.message : "Natijalar yuklanmadi"));
  }, []);
  const { submitting, error, setError, send: queue } = useStudioSend(load);
  // Every finished «Montaj» job is a possible source too: reload on mount and when that count changes.
  const finished = jobs.filter((j) => j.gen?.status === "COMPLETED").length;
  useEffect(() => {
    load();
  }, [load, finished]);

  const { mode } = state;
  const m = mixEntryOf(mode);
  const raw = state.raw[mode] ?? {};
  const pickers = MIX_PICKERS[mode];
  const ids = MIX_INPUTS[mode];
  const formEntry = { ...m.entry, params: m.entry.params.filter((p) => !ids.includes(p.name)) };
  const blocker = mixBlocker(mode, raw);
  const price = sources ? mixClientPrice() : null;

  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [mode]: { ...(s.raw[mode] ?? {}), [name]: value } } }));
  const pickMode = (next: MixMode) => {
    setError(null);
    setState((s) => ({ ...s, mode: next }));
  };

  function send(target: (typeof MIX_MODES)[number], out: Record<string, unknown>) {
    return queue({ slug: STUDIO_MIX_SLUG, id: STUDIO_MIX_TOOL_ID, title: target.label, output: target.mode === "video-voice" ? "mp4" : "mp3" }, out, mixClientPrice(), ({ id, price: charged }) =>
      track({ id, modelId: target.model, modelLabel: "Montaj", prompt: target.label, price: charged, sent: out }),
    );
  }

  function submit() {
    if (blocker) {
      setError(blocker);
      return;
    }
    void send(m, requestValues(m.entry, raw));
  }

  function again(job: StudioJob) {
    const target = MIX_MODES.find((x) => x.model === job.modelId);
    if (target) void send(target, job.sent);
  }

  const videoJobs = jobs.filter((j) => j.modelId === MIX_MODES[0]!.model);
  const audioJobs = jobs.filter((j) => j.modelId === MIX_MODES[1]!.model);

  return (
    <div data-mix-panel data-mix-mode={mode}>
      <div role="radiogroup" aria-label="Montaj turi" className="mb-3 flex flex-wrap gap-1.5" data-mix-modes>
        {MIX_MODES.map((x) => (
          <button
            key={x.mode}
            type="button"
            role="radio"
            aria-checked={x.mode === mode}
            data-mix-mode-chip={x.mode}
            onClick={() => pickMode(x.mode)}
            className={cn(
              "focus-visible:ring-ring min-h-11 rounded-full border px-3.5 text-[14px] font-semibold outline-none focus-visible:ring-2",
              x.mode === mode ? "bg-accent-soft text-accent-soft-foreground border-transparent" : "bg-card hover:bg-muted",
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      <Card
        title="Natijalaringizdan tanlang"
        aside={
          <button
            type="button"
            onClick={load}
            data-mix-reload
            aria-label="Ro‘yxatni yangilash"
            className="focus-visible:ring-ring hover:bg-muted inline-flex size-11 items-center justify-center rounded-[10px] outline-none focus-visible:ring-2"
          >
            <RefreshCw className="size-4" aria-hidden />
          </button>
        }
      >
        {loadError ? (
          <p role="alert" className="text-destructive text-[14px]" data-mix-sources-error>
            {loadError}
          </p>
        ) : !sources ? (
          <p className="text-muted-foreground text-[13.5px]" role="status" data-mix-sources-loading>
            Natijalar yuklanmoqda...
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {pickers.map((pk, i) => {
              const name = ids[i]!;
              const list = sources[pk.role];
              const value = String(raw[name] ?? "");
              // A pre-picked result (a «Keyingi qadam» handoff) the list does not hold yet still shows as picked.
              const options = [
                { value: "", label: "— tanlang —" },
                ...(value && !list.some((s) => s.id === value) ? [{ value, label: "Tanlangan natija" }] : []),
                ...list.map((s) => ({ value: s.id, label: sourceLabel(s) })),
              ];
              return (
                <div key={name} className="flex flex-col gap-1.5" data-mix-picker={pk.role}>
                  <span className="text-[14px] font-semibold">{pk.label}</span>
                  <Field id={name}>
                    {list.length === 0 && !value ? (
                      <span className="text-muted-foreground block text-[13.5px]" data-mix-empty={pk.role}>
                        {pk.empty}
                      </span>
                    ) : (
                      <SelectField ariaLabel={pk.label} options={options} value={value} onChange={(v) => setParam(name, v)} />
                    )}
                  </Field>
                </div>
              );
            })}
            <p className="text-muted-foreground text-[12.5px] leading-snug">
              {mode === "video-voice"
                ? "Video ≤ 3 daqiqa, audio ≤ 10 daqiqa. Natija — video uzunligida MP4."
                : "Ovoz va musiqa ≤ 10 daqiqa. Natija — ovoz uzunligida MP3; qisqa musiqa takrorlanadi."}
            </p>
          </div>
        )}
      </Card>

      <ParamRows entry={formEntry} raw={raw} onChange={setParam} />

      <SubmitError error={error} gated={gated} />
      <PriceButton
        count={1}
        price={blocker ? null : price}
        balance={balance}
        loading={submitting}
        disabled={!sources}
        typing={typing}
        onSubmit={submit}
        label={price === null || blocker ? undefined : mixSubmitLabel(m.label, price)}
      />
      <section aria-label="Montaj natijalari" data-mix-results className={cn(jobs.length > 0 && "mt-5 flex flex-col gap-4")}>
        <VideoResults jobs={videoJobs} busy={submitting} onAgain={again} />
        <VoiceResults jobs={audioJobs} busy={submitting} onAgain={again} />
      </section>
    </div>
  );
}
