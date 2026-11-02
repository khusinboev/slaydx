"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import type { FormValues } from "@/lib/types";
import type { ClientEntry } from "@/lib/studio-core";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card, Row, Segmented } from "@/components/forms/compact";
import { Counter, Field } from "@/components/forms/shared";
import { PhotoField } from "@/components/forms/PhotoField";
import { photoHint } from "@/lib/photo-accept";
import { queueGeneration } from "@/components/forms/runGeneration";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { MediaModelPicker } from "../MediaModelPicker";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { STUDIO_VIDEO_PURPOSE, type CatalogState } from "../studio-api";
import type { MediaCatalog } from "../studio-types";
import { PROMPT_PARAM, carryOver, effective, normalizedPrompt, promptLimit, promptMin, requestValues, type RawValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import { VideoResults } from "./VideoResults";
import { STUDIO_VIDEO_SLUG, STUDIO_VIDEO_TOOL_ID, clipSeconds, isEffect, studioVideoClientPrice, videoCardPrice } from "./video-price";

/** «Shablon effektlar» (one photo → a ready clip) or «Matndan / rasmdan» (a model + a prompt, optional start image). */
export type VideoMode = "effects" | "text";

/** The tab's form state; the page keeps it, so switching to «Rasm» and back loses nothing. */
export type VideoTabState = {
  mode: VideoMode | null;
  /** Chosen text/image → video model (`null` = the server default). */
  chosen: string | null;
  /** Raw values of the text form (the chosen model's ParamSchema names). */
  raw: RawValues;
  /** Chosen effect scene id (`null` = the first one). */
  effect: string | null;
  /** The effect's photo (`photo_uploads.asset_id`). */
  effectImage: string;
};

export const INITIAL_VIDEO_STATE: VideoTabState = { mode: null, chosen: null, raw: {}, effect: null, effectImage: "" };

const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;
const IMAGE_PARAM = "imageAssetId";

/** The catalog split: the effect templates and the text/image → video models (each in catalog order). */
export function splitVideoCatalog(catalog: MediaCatalog | null): { effects: ClientEntry | null; models: ClientEntry[] } {
  const all = catalog?.models ?? [];
  return { effects: all.find(isEffect) ?? null, models: all.filter((m) => !isEffect(m)) };
}

/** The effect scenes of the effects entry (its `effect` enum), in grid order. */
export function effectOptions(entry: ClientEntry | null): { value: string; label: string }[] {
  const p = entry?.params.find((x) => x.name === "effect");
  return p && p.type === "enum" ? p.options.map((o) => ({ value: o.value, label: o.label })) : [];
}

/** The mode on screen: the user's pick when that side has something to sell, else the side that has. */
export function shownMode(state: VideoTabState, split: ReturnType<typeof splitVideoCatalog>): VideoMode | null {
  const can = { effects: split.effects !== null, text: split.models.length > 0 };
  if (state.mode && can[state.mode]) return state.mode;
  return can.effects ? "effects" : can.text ? "text" : null;
}

/** The submit button's text once priced: «Yaratish · «Tug‘ilgan kun» · 21 400 so'm» / «Yaratish · 5 soniya · …». */
export function videoSubmitLabel(what: string, price: number): string {
  return `Yaratish · ${what} · ${formatSom(price)}`;
}

/** The request carries the start image as one asset id string (the form value shape), never the normalized list. */
function flatImage(values: Record<string, unknown>): Record<string, unknown> {
  const v = values[IMAGE_PARAM];
  return Array.isArray(v) ? { ...values, [IMAGE_PARAM]: String(v[0] ?? "") } : values;
}

/** The tab's model: the text model chosen if still offered, else the server default when it is one, else the first. */
function textEntry(models: ClientEntry[], catalog: MediaCatalog | null, chosen: string | null): ClientEntry | null {
  return models.find((m) => m.id === chosen) ?? models.find((m) => m.id === catalog?.defaultModelId) ?? models[0] ?? null;
}

/**
 * Studio «Video» tab (docs/studio/P3-SPEC.md; canvas «Shablon effektlar» | «Matndan / rasmdan»). Effects: the 3×3 grid
 * of the effect scenes the catalog sells (each a fixed 5 s clip) + the photo it animates. Text/image: the prompt, the
 * model picker, the model's settings generated from its ParamSchema and the optional start image. The sticky button
 * shows the live price (`studioVideoClientPrice`, the server's formula); the job is followed below with the app's
 * progress panel and, when ready, plays here with «Yuklab olish».
 */
export function VideoTab({
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
  state: VideoTabState;
  setState: (fn: (s: VideoTabState) => VideoTabState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  /** The PAID balance (bonus so'm never pays for video); `null` while unknown. */
  balance: number | null;
  typing: boolean;
  gated: boolean;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const split = splitVideoCatalog(catalog);
  const mode = shownMode(state, split);

  const options = effectOptions(split.effects);
  const effect = options.find((o) => o.value === state.effect) ?? options[0] ?? null;
  const model = textEntry(split.models, catalog, state.chosen);

  // What goes out and what it costs, for the side on screen.
  let entry: ClientEntry | null = null;
  let sent: Record<string, unknown> = {};
  let what = "";
  if (mode === "effects" && split.effects && effect) {
    entry = split.effects;
    sent = { modelId: entry.id, effect: effect.value, [IMAGE_PARAM]: state.effectImage };
    what = `«${effect.label}»`;
  } else if (mode === "text" && model) {
    entry = model;
    sent = flatImage(requestValues(model, state.raw));
    const secs = clipSeconds(model, sent);
    what = secs ? `${secs} soniya` : model.label;
  }
  const price = entry && catalog ? studioVideoClientPrice(entry, sent, catalog.pricing) : null;

  const patch = (change: Partial<VideoTabState>) => setState((s) => ({ ...s, ...change }));
  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [name]: value } }));

  function selectModel(id: string) {
    const next = split.models.find((m) => m.id === id);
    if (!next) return;
    setState((s) => ({ ...s, chosen: id, raw: { ...carryOver(next, s.raw), ...(s.raw[IMAGE_PARAM] ? { [IMAGE_PARAM]: s.raw[IMAGE_PARAM] } : {}) } }));
  }

  async function send(target: ClientEntry, values: Record<string, unknown>, label: string) {
    if (!catalog) return;
    setError(null);
    setSubmitting(true);
    try {
      const { id, price: charged } = await queueGeneration(
        { slug: STUDIO_VIDEO_SLUG, id: STUDIO_VIDEO_TOOL_ID, title: label.slice(0, 72), output: "mp4" },
        values as unknown as FormValues,
        studioVideoClientPrice(target, values, catalog.pricing),
        // A second press is a new clip, not a double click.
        { repeat: true },
      );
      track({ id, modelId: target.id, modelLabel: target.label, prompt: label, price: charged, sent: values });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      // 400 before charging: the model / a value / the switch changed — re-read what is offered; 409: the price moved.
      if ((e instanceof ApiError && e.status === 400) || e instanceof PriceChangedError) reload(true);
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (!entry) return;
    if (mode === "effects") {
      if (!state.effectImage) {
        setError("Effekt uchun surat yuklang");
        return;
      }
      void send(entry, sent, `Effekt: ${effect?.label ?? ""}`);
      return;
    }
    if (normalizedPrompt(entry, state.raw).length < promptMin(entry)) {
      setError("Videoda nima bo‘lishini yozing (kamida 5 ta belgi)");
      return;
    }
    void send(entry, sent, normalizedPrompt(entry, state.raw));
  }

  function again(job: StudioJob) {
    const target = catalog?.models.find((m) => m.id === job.modelId);
    if (!target) {
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      return;
    }
    void send(target, job.sent, job.prompt);
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
      <div className="flex flex-col gap-3" role="status" aria-label="Video yuklanmoqda" data-studio-loading>
        <div className="bg-muted/60 h-11 animate-pulse rounded-[14px]" />
        <div className="bg-muted/60 h-64 animate-pulse rounded-[20px]" />
      </div>
    );
  }
  if (mode === null) {
    return (
      <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-video-none>
        Video yaratish hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.
      </p>
    );
  }

  const textModel = model;
  const formEntry = textModel ? { ...textModel, params: textModel.params.filter((p) => p.type !== "image") } : null;
  const hasStart = textModel?.params.some((p) => p.name === IMAGE_PARAM) ?? false;
  const startImage = String(state.raw[IMAGE_PARAM] ?? "");

  return (
    <div data-video-tab>
      {split.effects && split.models.length > 0 ? (
        <div className="mb-3" data-video-mode>
          <Segmented
            ariaLabel="Video turi"
            options={[
              { value: "effects", label: "Shablon effektlar" },
              { value: "text", label: "Matndan / rasmdan" },
            ]}
            value={mode}
            onChange={(v) => patch({ mode: v === "text" ? "text" : "effects" })}
          />
        </div>
      ) : null}

      {mode === "effects" ? (
        <>
          <Card title="Effekt">
            <Field id="effect">
              <div role="group" aria-label="Effekt" className="grid grid-cols-3 gap-2" data-effects-grid>
                {options.map((o) => {
                  const on = effect?.value === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      data-effect={o.value}
                      onClick={() => patch({ effect: o.value })}
                      className={cn(
                        "bg-muted/60 focus-visible:ring-ring relative flex min-h-[4.75rem] flex-col justify-end rounded-[14px] border-2 p-2 text-left outline-none focus-visible:ring-2",
                        on ? "border-primary" : "border-transparent",
                      )}
                    >
                      <span className="bg-card absolute top-1.5 right-1.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums">5 s</span>
                      <span className="text-[13.5px] leading-tight font-semibold">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            </Field>
          </Card>
          <Card title="Surat">
            <Row label="Surat" hint="Yuz yoki odam aniq ko‘rinsin" wide>
              <Field id={IMAGE_PARAM}>
                <PhotoField
                  assetId={state.effectImage}
                  originalAssetId=""
                  shape="square"
                  keepOriginal={false}
                  alt="Effekt surati"
                  hint={photoHint()}
                  onChange={(v) => patch({ effectImage: v.assetId })}
                />
              </Field>
            </Row>
          </Card>
        </>
      ) : textModel && formEntry ? (
        <>
          <VideoPromptBox value={String(state.raw[PROMPT_PARAM] ?? "")} onChange={(v) => setParam(PROMPT_PARAM, v)} limit={promptLimit(textModel)} />
          <MediaModelPicker
            purpose={STUDIO_VIDEO_PURPOSE}
            catalog={{ ...catalog, models: split.models }}
            value={textModel.id}
            values={effective(textModel, state.raw)}
            onChange={selectModel}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            priceOf={(m) => videoCardPrice(m, effective(m, state.raw), catalog.pricing)}
          />
          <ParamRows entry={formEntry} raw={state.raw} onChange={setParam} />
          {hasStart ? (
            <Card title="Boshlang‘ich surat (ixtiyoriy)">
              <Row label="Surat" wide>
                <Field id={IMAGE_PARAM}>
                  <PhotoField
                    assetId={startImage}
                    originalAssetId=""
                    shape="square"
                    keepOriginal={false}
                    alt="Boshlang‘ich surat"
                    hint={photoHint()}
                    onChange={(v) => setParam(IMAGE_PARAM, v.assetId)}
                  />
                </Field>
                <p className="text-muted-foreground mt-1 text-[13px]">Surat berilsa video shu suratdan boshlanadi; nisbat suratdan olinadi.</p>
              </Row>
            </Card>
          ) : null}
        </>
      ) : null}

      <p className="text-muted-foreground mb-3 text-[13px] leading-snug" data-video-note>
        Video bir necha daqiqada tayyor bo‘ladi — sahifani yopsangiz ham davom etadi, natija «Ishlarim» va Galereyada. Faqat to‘langan balans bilan (bonus so‘m
        ishlamaydi); provayder rad etsa yoki tayyorlay olmasa, pul to‘liq qaytariladi.
      </p>
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
        label={price === null ? undefined : videoSubmitLabel(what, price)}
        paidOnly
      />
      <section aria-label="Videolar" data-video-results className={cn(jobs.length > 0 && "mt-5")}>
        <VideoResults jobs={jobs} busy={submitting} onAgain={again} />
      </section>
    </div>
  );
}

/** The prompt card of the text form («Videoda nima bo'lsin?»): growing textarea + counter, `data-field="prompt"`. */
function VideoPromptBox({ value, onChange, limit }: { value: string; onChange: (v: string) => void; limit: number }) {
  const id = useId();
  return (
    <section aria-label="So‘rov" data-video-prompt className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
      <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
        Videoda nima bo‘lsin?
      </label>
      <Field id={PROMPT_PARAM}>
        <AutoTextarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, limit))}
          minRows={3}
          maxRows={10}
          maxLength={limit}
          placeholder="Masalan: Tong chog‘ida Registon maydoni, kamera sekin yaqinlashadi"
          className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] leading-relaxed outline-none"
        />
        <Counter len={value.length} limit={limit} />
      </Field>
    </section>
  );
}
