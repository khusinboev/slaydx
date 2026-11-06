"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import type { ClientEntry } from "@/lib/studio-core";
import { AutoTextarea } from "@/components/common/AutoTextarea";
import { Card, Row, Segmented, SelectField } from "@/components/forms/compact";
import { Counter, Field } from "@/components/forms/shared";
import { PhotoField } from "@/components/forms/PhotoField";
import { ENHANCE_MIN } from "@/lib/media/enhance";
import { EnhanceTool } from "../PromptBox";
import { usePromptEnhance } from "../usePromptEnhance";
import { photoHint } from "@/lib/photo-accept";
import { CatalogState } from "../CatalogState";
import { MediaModelPicker } from "../MediaModelPicker";
import { ParamRows } from "../ParamRows";
import { PriceButton } from "../PriceButton";
import { STUDIO_VIDEO_PURPOSE, type CatalogLoad } from "../studio-api";
import { SubmitError } from "../SubmitError";
import { useStudioSend } from "../useStudioSend";
import type { MediaCatalog } from "../studio-types";
import { PROMPT_PARAM, carryOver, effective, normalizedPrompt, promptLimit, promptMin, requestValues, type RawValues } from "../studio-values";
import type { StudioJob } from "../StudioResults";
import { VideoResults } from "./VideoResults";
import { STUDIO_VIDEO_SLUG, STUDIO_VIDEO_TOOL_ID, clipSeconds, isEffect, studioVideoClientPrice, videoCardPrice } from "./video-price";
import { ASPECT_FOLLOWS_IMAGE, END_IMAGE_PARAM, HEYGEN_SCRIPT_MIN, OWN_AUDIO_PARAM, SECOND_IMAGE_PARAM, avatarAudioSeconds, avatarScriptProblem, effectPhotos, isAvatarModel } from "@/lib/media/catalog-video";
import { fetchMixSources } from "../audio/mix-api";
import { avatarHiddenParams, avatarRequest, avatarSpeeches, type SpeechSource } from "./avatar";

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
  /** P4: the second photo of a two-photo effect («Quchoqlash»); sent only for such a scene. */
  effectImage2?: string;
  /**
   * P7b «Videoga aylantirish»: the start frame came from a Studio picture — the picker offers only the models that take
   * a start image while it is set (removing the frame lifts the filter).
   */
  fromPicture?: boolean;
};

export const INITIAL_VIDEO_STATE: VideoTabState = { mode: null, chosen: null, raw: {}, effect: null, effectImage: "", effectImage2: "" };

const IMAGE_PARAM = "imageAssetId";
/** The two photos a model / scene may take besides the start image (P4). */
const END_PARAM = END_IMAGE_PARAM;
const SECOND_PARAM = SECOND_IMAGE_PARAM;

/** The catalog split: the effect templates and the text/image → video models (each in catalog order). */
export function splitVideoCatalog(catalog: MediaCatalog | null): { effects: ClientEntry | null; models: ClientEntry[] } {
  const all = catalog?.models ?? [];
  return { effects: all.find(isEffect) ?? null, models: all.filter((m) => !isEffect(m)) };
}

/** P7b: the text/image models that take a start image (`imageAssetId`), in catalog order. */
export function startImageModels(models: readonly ClientEntry[]): ClientEntry[] {
  return models.filter((m) => m.params.some((p) => p.name === IMAGE_PARAM && p.type === "image"));
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

/** The request carries each photo as one asset id string (the form value shape), never the normalized list. */
function flatImage(values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const name of [IMAGE_PARAM, END_PARAM]) {
    const v = out[name];
    if (Array.isArray(v)) out[name] = String(v[0] ?? "");
  }
  return out;
}

/** The line under the start image: where the clip's proportions come from with this model. */
export function startImageHint(model: Pick<ClientEntry, "id" | "params">): string {
  const start = "Surat berilsa video shu suratdan boshlanadi";
  if (ASPECT_FOLLOWS_IMAGE.has(model.id)) return `${start}; nisbat suratdan olinadi.`;
  return model.params.some((p) => p.name === "aspect") ? `${start}; o‘lcham yuqoridagi «O‘lcham» qatoridan olinadi.` : `${start}.`;
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
  onMusic,
  onVoice,
  onSubmitted,
}: {
  catalogState: CatalogLoad;
  reload: (silent?: boolean) => void;
  state: VideoTabState;
  setState: (fn: (s: VideoTabState) => VideoTabState) => void;
  jobs: readonly StudioJob[];
  track: (job: Omit<StudioJob, "gen" | "error">) => void;
  /** The PAID balance (bonus so'm never pays for video); `null` while unknown. */
  balance: number | null;
  typing: boolean;
  gated: boolean;
  /** P7b «Keyingi qadam» on a finished clip: «Musiqa yaratish» / «Ovoz qo'shish» with its prompt (absent = no button). */
  onMusic?: (prompt: string) => void;
  onVoice?: (text: string) => void;
  /** The form's own job was queued (not a retry of an old one): the page drops the draft. */
  onSubmitted?: () => void;
}) {
  // 400 before charging: the model / a value / the switch changed — re-read what is offered; 409: the price moved.
  const { submitting, error, setError, send: queue } = useStudioSend(() => reload(true));
  const [pickerOpen, setPickerOpen] = useState(false);
  const catalog = catalogState.status === "ready" ? catalogState.catalog : null;
  const all = splitVideoCatalog(catalog);
  // P7b: a picture handed over as the start frame keeps the picker on the models that take one.
  const fromPicture = state.fromPicture === true && Boolean(state.raw[IMAGE_PARAM]);
  const split = fromPicture ? { ...all, models: startImageModels(all.models) } : all;
  const mode = shownMode(state, split);

  const options = effectOptions(split.effects);
  const effect = options.find((o) => o.value === state.effect) ?? options[0] ?? null;
  const model = textEntry(split.models, catalog, state.chosen);
  // P9 HeyGen: the user's finished speech results, loaded once the avatar model is on screen (`null` = not loaded yet).
  const avatar = mode === "text" && model !== null && isAvatarModel(model.id);
  const [speeches, setSpeeches] = useState<SpeechSource[] | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  useEffect(() => {
    if (!avatar || speeches !== null) return;
    let live = true;
    fetchMixSources().then(
      (s) => live && setSpeeches(avatarSpeeches(s.speech)),
      (e: unknown) => live && setSpeechError(e instanceof Error ? e.message : "Ovozlar yuklanmadi"),
    );
    return () => {
      live = false;
    };
  }, [avatar, speeches]);

  // What goes out and what it costs, for the side on screen.
  let entry: ClientEntry | null = null;
  let sent: Record<string, unknown> = {};
  let what = "";
  const twoPhotos = effect ? effectPhotos(effect.value) === 2 : false;
  if (mode === "effects" && split.effects && effect) {
    entry = split.effects;
    // The second photo goes out only for a two-photo scene (the server refuses it on a single-photo one).
    sent = { modelId: entry.id, effect: effect.value, [IMAGE_PARAM]: state.effectImage, ...(twoPhotos ? { [SECOND_PARAM]: state.effectImage2 ?? "" } : {}) };
    what = `«${effect.label}»`;
  } else if (mode === "text" && model) {
    entry = model;
    // P9 HeyGen: the length (and so the price) follows the script / the own speech, exactly as the server computes it.
    sent = avatarRequest(model, flatImage(requestValues(model, state.raw)), speeches ?? []);
    const secs = clipSeconds(model, sent);
    what = secs ? `${secs} soniya` : model.label;
  }
  const price = entry && catalog ? studioVideoClientPrice(entry, sent, catalog.pricing) : null;

  const patch = (change: Partial<VideoTabState>) => setState((s) => ({ ...s, ...change }));
  const setParam = (name: string, value: unknown) => setState((s) => ({ ...s, raw: { ...s.raw, [name]: value } }));
  const { enhance, enhancing } = usePromptEnhance(
    "video",
    () => String(state.raw[PROMPT_PARAM] ?? "").replace(/\s+/g, " ").trim(),
    (v) => setParam(PROMPT_PARAM, textModel ? v.slice(0, promptLimit(textModel)) : v),
    setError,
  );

  function selectModel(id: string) {
    const next = split.models.find((m) => m.id === id);
    if (!next) return;
    // The photos stay across a model switch (`carryOver` keeps the end frame when the new model takes one).
    setState((s) => ({ ...s, chosen: id, raw: { ...carryOver(next, s.raw), ...(s.raw[IMAGE_PARAM] ? { [IMAGE_PARAM]: s.raw[IMAGE_PARAM] } : {}) } }));
  }

  async function send(target: ClientEntry, values: Record<string, unknown>, label: string) {
    if (!catalog) return false;
    return queue({ slug: STUDIO_VIDEO_SLUG, id: STUDIO_VIDEO_TOOL_ID, title: label.slice(0, 72), output: "mp4" }, values, studioVideoClientPrice(target, values, catalog.pricing), ({ id, price: charged }) =>
      track({ id, modelId: target.id, modelLabel: target.label, prompt: label, price: charged, sent: values }),
    );
  }

  const sendForm = (target: ClientEntry, label: string) => void send(target, sent, label).then((ok) => ok && onSubmitted?.());

  function submit() {
    if (!entry) return;
    if (mode === "effects") {
      if (!state.effectImage) {
        setError("Effekt uchun surat yuklang");
        return;
      }
      if (twoPhotos && !state.effectImage2) {
        setError("Bu effekt uchun ikkinchi suratni ham yuklang");
        return;
      }
      sendForm(entry, `Effekt: ${effect?.label ?? ""}`);
      return;
    }
    if (isAvatarModel(entry.id)) {
      const own = String(sent[OWN_AUDIO_PARAM] ?? "");
      if (own && !(speeches ?? []).some((s) => s.id === own)) {
        setError("Tanlangan ovoz topilmadi — ro‘yxatdan qayta tanlang");
        return;
      }
      if (!own && String(sent[PROMPT_PARAM] ?? "").length < HEYGEN_SCRIPT_MIN) {
        setError(`Avatar aytadigan matnni yozing (kamida ${HEYGEN_SCRIPT_MIN} ta belgi) yoki o‘z ovozingizni tanlang`);
        return;
      }
      // The server's own refusal (a link, a script past a minute as spoken), the same function: shown before any request.
      const problem = own ? null : avatarScriptProblem(sent[PROMPT_PARAM]);
      if (problem) {
        setError(problem);
        return;
      }
      sendForm(entry, own ? `Avatar: ${(speeches ?? []).find((s) => s.id === own)?.title ?? "o‘z ovozi"}` : String(sent[PROMPT_PARAM]));
      return;
    }
    if (normalizedPrompt(entry, state.raw).length < promptMin(entry)) {
      setError("Videoda nima bo‘lishini yozing (kamida 5 ta belgi)");
      return;
    }
    // An end frame without a start cannot be built here (the upload waits for the start; removing the start clears it);
    // the server's preflight refuses one anyway.
    sendForm(entry, normalizedPrompt(entry, state.raw));
  }

  function again(job: StudioJob) {
    const target = catalog?.models.find((m) => m.id === job.modelId);
    if (!target) {
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      return;
    }
    void send(target, job.sent, job.prompt);
  }

  function retryPrice(job: StudioJob): number {
    const target = catalog?.models.find((m) => m.id === job.modelId);
    return target && catalog ? studioVideoClientPrice(target, job.sent, catalog.pricing) : job.price;
  }

  if (!catalog) return <CatalogState state={catalogState} onRetry={() => reload()} label="Video yuklanmoqda" blocks={["h-11 rounded-[14px]", "h-64 rounded-[20px]"]} />;
  if (mode === null) {
    return (
      <p className="text-muted-foreground bg-card rounded-[20px] border p-5 text-[14.5px]" data-video-none>
        Video yaratish hozircha mavjud emas. Birozdan keyin qayta urinib ko‘ring.
      </p>
    );
  }

  const textModel = model;
  const startImage = String(state.raw[IMAGE_PARAM] ?? "");
  // P4 review N3: with a start image, Kling 3.0 / the fal models take the frame's proportions — no «O'lcham» row then.
  const aspectHidden = Boolean(startImage) && Boolean(textModel && ASPECT_FOLLOWS_IMAGE.has(textModel.id));
  const ownAudio = avatar ? String(state.raw[OWN_AUDIO_PARAM] ?? "") : "";
  const avatarHidden = avatar ? avatarHiddenParams(Boolean(ownAudio)) : null;
  const formEntry = textModel
    ? { ...textModel, params: textModel.params.filter((p) => p.type !== "image" && !(aspectHidden && p.name === "aspect") && !avatarHidden?.has(p.name)) }
    : null;
  const hasStart = textModel?.params.some((p) => p.name === IMAGE_PARAM) ?? false;
  // P4: models that take a last frame (Kling 3.0, the fal models) show its upload next to the start image.
  const hasEnd = textModel?.params.some((p) => p.name === END_PARAM) ?? false;
  const endImage = String(state.raw[END_PARAM] ?? "");

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
            {twoPhotos ? (
              <Row label="Ikkinchi surat" hint="Effekt ikki kishini birga ko‘rsatadi: har biri o‘z suratida" wide>
                <Field id={SECOND_PARAM}>
                  <PhotoField
                    assetId={state.effectImage2 ?? ""}
                    originalAssetId=""
                    shape="square"
                    keepOriginal={false}
                    alt="Ikkinchi surat"
                    hint={photoHint()}
                    onChange={(v) => patch({ effectImage2: v.assetId })}
                  />
                </Field>
              </Row>
            ) : null}
          </Card>
        </>
      ) : textModel && formEntry ? (
        <>
          {fromPicture ? (
            <p className="bg-accent-soft text-accent-soft-foreground mb-3 rounded-[14px] px-3.5 py-2 text-[14px] leading-snug" data-video-from-picture>
              Rasmdan video: rasmingiz birinchi kadr bo‘ladi. Faqat suratdan video yarata oladigan modellar ko‘rsatilgan.
            </p>
          ) : null}
          {avatar && ownAudio ? null : (
            <VideoPromptBox
              value={String(state.raw[PROMPT_PARAM] ?? "")}
              onChange={(v) => setParam(PROMPT_PARAM, v)}
              limit={promptLimit(textModel)}
              {...(avatar ? {} : { onEnhance: () => void enhance(), enhancing })}
              {...(avatar ? { label: "Avatar nima desin?", placeholder: "Masalan: Assalomu alaykum! Bugun sizga yangi kursimiz haqida gapirib beraman." } : {})}
            />
          )}
          <MediaModelPicker
            purpose={STUDIO_VIDEO_PURPOSE}
            catalog={{ ...catalog, models: split.models }}
            value={textModel.id}
            values={effective(textModel, state.raw)}
            onChange={selectModel}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            // The avatar's card shows the length its inputs buy (`avatarRequest`), as its button does.
            priceOf={(m) => videoCardPrice(m, isAvatarModel(m.id) ? avatarRequest(m, flatImage(requestValues(m, state.raw)), speeches ?? []) : effective(m, state.raw), catalog.pricing)}
          />
          {avatar ? (
            <Card title="Avatar ovozi">
              <Row label="O‘z ovozingiz" hint="Ixtiyoriy: «Ovoz» bo‘limidagi tayyor ovoz (1 daqiqagacha) — avatar matn o‘rniga shuni gapiradi" wide>
                <Field id={OWN_AUDIO_PARAM}>
                  {speechError ? (
                    <p role="alert" className="text-destructive text-[13.5px]" data-avatar-speech-error>
                      {speechError}
                    </p>
                  ) : speeches === null ? (
                    <p className="text-muted-foreground text-[13.5px]" role="status" data-avatar-speech-loading>
                      Ovozlar yuklanmoqda…
                    </p>
                  ) : speeches.length === 0 ? (
                    <p className="text-muted-foreground text-[13.5px]" data-avatar-speech-empty>
                      Hali tayyor ovoz yo‘q — avatar matnni o‘zi o‘qiydi. O‘z ovozingiz uchun avval «Ovoz» bo‘limida yarating.
                    </p>
                  ) : (
                    <SelectField
                      ariaLabel="O‘z ovozingiz"
                      options={[
                        { value: "", label: "Yo‘q — matnni avatar o‘qiydi" },
                        // The seconds it is priced at (rounded up, as the button), not a rounded-to-nearest copy.
                        ...speeches.map((s) => ({ value: s.id, label: `${s.title} · ${avatarAudioSeconds(s.seconds ?? 0)} s` })),
                      ]}
                      value={ownAudio}
                      onChange={(v) => setParam(OWN_AUDIO_PARAM, v)}
                    />
                  )}
                  {speeches !== null || speechError ? (
                    // A speech made in «Ovoz» meanwhile (the list is also re-read whenever the Video tab is opened again).
                    <button
                      type="button"
                      data-avatar-speech-refresh
                      onClick={() => {
                        setSpeechError(null);
                        setSpeeches(null);
                      }}
                      className="text-accent-soft-foreground pointer-coarse:min-h-11 mt-1 min-h-9 text-[13.5px] font-semibold underline underline-offset-2"
                    >
                      Ro‘yxatni yangilash
                    </button>
                  ) : null}
                </Field>
              </Row>
            </Card>
          ) : null}
          <ParamRows entry={formEntry} raw={state.raw} onChange={setParam} />
          {hasStart ? (
            <Card title={hasEnd ? "Kadrlar (ixtiyoriy)" : "Boshlang‘ich surat (ixtiyoriy)"}>
              <Row label={hasEnd ? "Birinchi kadr" : "Surat"} wide>
                <Field id={IMAGE_PARAM}>
                  <PhotoField
                    assetId={startImage}
                    originalAssetId=""
                    shape="square"
                    keepOriginal={false}
                    alt="Boshlang‘ich surat"
                    hint={photoHint()}
                    onChange={(v) =>
                      // Removing the start frame removes the end frame too (an end frame alone is never sent), and lifts
                      // the P7b start-image filter of the picker.
                      setState((s) => ({ ...s, ...(v.assetId ? {} : { fromPicture: false }), raw: { ...s.raw, [IMAGE_PARAM]: v.assetId, ...(v.assetId ? {} : { [END_PARAM]: "" }) } }))
                    }
                  />
                </Field>
                <p className="text-muted-foreground mt-1 text-[13px]" data-start-image-hint>
                  {startImageHint(textModel)}
                </p>
              </Row>
              {hasEnd ? (
                <Row label="Oxirgi kadr" hint="Ixtiyoriy: video shu surat bilan tugaydi (boshlang‘ich surat bilan birga)" wide>
                  <Field id={END_PARAM}>
                    {startImage ? (
                      <PhotoField
                        assetId={endImage}
                        originalAssetId=""
                        shape="square"
                        keepOriginal={false}
                        alt="Oxirgi kadr"
                        hint={photoHint()}
                        onChange={(v) => setParam(END_PARAM, v.assetId)}
                      />
                    ) : (
                      // P4 review N4: no upload until a start frame exists.
                      <p className="text-muted-foreground text-[13px]" data-end-frame-locked aria-disabled="true">
                        Avval birinchi kadrni yuklang — oxirgi kadr shundan keyin qo‘shiladi.
                      </p>
                    )}
                  </Field>
                </Row>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      <p className="text-muted-foreground mb-3 text-[13px] leading-snug" data-video-note>
        Video bir necha daqiqada tayyor bo‘ladi — sahifani yopsangiz ham davom etadi, natija «Ishlarim» va Galereyada. Faqat to‘langan balans bilan (bonus so‘m
        ishlamaydi); provayder rad etsa yoki tayyorlay olmasa, pul to‘liq qaytariladi.
      </p>
      <SubmitError error={error} gated={gated} />
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
        <VideoResults jobs={jobs} busy={submitting} onAgain={again} retryPrice={retryPrice} onMusic={onMusic} onVoice={onVoice} />
      </section>
    </div>
  );
}

/** The prompt card of the text form («Videoda nima bo'lsin?»): growing textarea + counter, `data-field="prompt"`. */
function VideoPromptBox({
  value,
  onChange,
  limit,
  label = "Videoda nima bo‘lsin?",
  placeholder = "Masalan: Tong chog‘ida Registon maydoni, kamera sekin yaqinlashadi",
  onEnhance,
  enhancing = false,
}: {
  value: string;
  onChange: (v: string) => void;
  limit: number;
  /** P9 HeyGen: the avatar's script box says what it is. */
  label?: string;
  placeholder?: string;
  /** Absent for an avatar script: there the words are the product. */
  onEnhance?: () => void;
  enhancing?: boolean;
}) {
  const id = useId();
  return (
    <section aria-label="So‘rov" data-video-prompt className="bg-card mb-3 rounded-[20px] border p-3.5 shadow-[var(--shadow-card)]">
      <label htmlFor={id} className="text-muted-foreground mb-1.5 block text-[13px] font-semibold">
        {label}
      </label>
      <Field id={PROMPT_PARAM}>
        <AutoTextarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, limit))}
          minRows={3}
          maxRows={10}
          maxLength={limit}
          placeholder={placeholder}
          className="placeholder:text-muted-foreground/70 w-full bg-transparent text-[16px] leading-relaxed outline-none"
        />
        <Counter len={value.length} limit={limit} />
      </Field>
      {onEnhance ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-prompt-tools>
          <EnhanceTool disabled={value.trim().length < ENHANCE_MIN} enhancing={enhancing} onClick={onEnhance} />
        </div>
      ) : null}
    </section>
  );
}
