"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Wand2, X } from "lucide-react";
import { ApiError, PriceChangedError } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { creditTotal, usePricingVersion, useAppStore } from "@/lib/store";
import { useChannelGate } from "@/lib/channel-gate";
import { useUi } from "@/lib/ui";
import type { FormValues } from "@/lib/types";
import type { ClientEntry } from "@/lib/studio-core";
import { PageHeader } from "@/components/shell/PageHeader";
import { ChannelGate } from "@/components/forms/ChannelGate";
import { queueGeneration } from "@/components/forms/runGeneration";
import { useKeyboardInset } from "@/components/forms/useKeyboardInset";
import { useOverlayHistory } from "@/components/nav/useOverlayHistory";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { Gallery } from "./Gallery";
import { MediaModelPicker } from "./MediaModelPicker";
import { ParamRows } from "./ParamRows";
import { PriceButton } from "./PriceButton";
import { PromptBox } from "./PromptBox";
import { StudioResults, type StudioJob } from "./StudioResults";
import { STUDIO_AUDIO_LISTING, STUDIO_SPEECH_PURPOSE, STUDIO_VIDEO_PURPOSE, enhancePrompt, inputFromResult, loadMediaCatalog, resultAssetOf, uploadStudioInput, useMediaCatalog } from "./studio-api";
import { INITIAL_VIDEO_STATE, VideoTab, type VideoTabState } from "./video/VideoTab";
import { INITIAL_VOICE_STATE, VoiceTab, type VoiceTabState } from "./voice/VoiceTab";
import { VoiceTemplatePanel, VoiceTemplatesRow, useLegacyFold } from "./voice/VoiceTemplates";
import { voiceTemplateFromSearch, type VoiceTemplateId } from "@/lib/media/voice-templates";
import { AudioTab, INITIAL_AUDIO_STATE, type AudioTabState } from "./audio/AudioTab";
import { HandoffAlert, useHandoffs } from "./handoff";
import { MixHandoffContext } from "./audio/mix-handoff";
import { INITIAL_MIX_STATE, mixFromResult, type MixHandoff } from "./audio/mix-api";
import { LibrarySheet } from "./LibrarySheet";
import { TemplateSlots, TemplatesRow } from "./TemplatesRow";
import { INPUT_PARAM, MODE_LABEL, MODE_PURPOSE, applyTemplate, type StudioMode } from "./studio-modes";
import { fillSkeleton, type StudioTemplate } from "@/lib/media/library";
import { STUDIO_TOOL_SLUG } from "./studio-entry";
import { STUDIO_TOOL_ID, outputCount, studioPrice } from "./studio-price";
import type { GalleryItem, MediaCatalog, StudioPricing } from "./studio-types";
import { PROMPT_PARAM, carryOver, effective, normalizedPrompt, promptLimit, promptMin, promptParam, requestValues, type RawValues } from "./studio-values";
import { useStudioJobs } from "./useStudioJobs";
import { ComparePanel, CompareSwitch } from "./compare/ComparePanel";
import { compareAvailability, enableCompare, useCompare } from "./compare/useCompare";

const WIDTH = "max-w-[1320px]";
const LOADING = <div className="text-muted-foreground p-8 text-[15px]">Yuklanmoqda...</div>;
/** The server's 402 wording (`app/api/generations/route.ts`), as the tool forms recognise it. */
const INSUFFICIENT_RE = /balans yetarli emas|to.langan balans bilan/i;

/** The chosen model if the catalog still offers it, else the server's default, else the first one. */
export function resolveEntry(catalog: MediaCatalog | null, id: string | null): ClientEntry | null {
  if (!catalog) return null;
  return catalog.models.find((m) => m.id === id) ?? catalog.models.find((m) => m.id === catalog.defaultModelId) ?? catalog.models[0] ?? null;
}

/**
 * Studio (`/uz/studio`, docs/studio/P1-SPEC.md): the «Rasm» tab. Phone: one column — prompt, model cards (+ «Barcha
 * modellar» sheet), the settings generated from the model's ParamSchema, results below, the sticky «Yaratish · N ta
 * rasm · X so'm» bar. Tablet: form and results side by side. Desktop (≥ 1280 px): navigation, form and results as
 * three columns, as in the design canvas.
 */
export function StudioPage() {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const open = useUi((s) => s.open);
  // The session is checked on the server first: never open the login for a signed-in user (as `ToolWorkspace`).
  useEffect(() => {
    if (sessionChecked && !loggedIn) open("login", { returnTo: "/uz/studio" });
  }, [sessionChecked, loggedIn, open]);
  if (!sessionChecked) return LOADING;
  return <StudioApp />;
}

type View = "create" | "gallery";
/** The Studio's media tabs (P1 «Rasm», P3 «Video», P5 «Ovoz», P6 «Audio»). */
export type StudioTab = "rasm" | "video" | "ovoz" | "audio";
export const STUDIO_TABS: readonly StudioTab[] = ["rasm", "video", "ovoz", "audio"];

/** The tab a link asks for (`/uz/studio?tab=video`, where `/uz/studio-video` redirects; `?tab=ovoz`); anything else = «Rasm». */
export function tabFromSearch(search: string): StudioTab {
  const t = new URLSearchParams(search).get("tab");
  return t === "video" ? "video" : t === "ovoz" ? "ovoz" : t === "audio" ? "audio" : "rasm";
}

const TAB_LABEL: Readonly<Record<StudioTab, string>> = { rasm: "Rasm", video: "Video", ovoz: "Ovoz", audio: "Audio" };
const SUBTITLE: Readonly<Record<StudioTab, string>> = {
  rasm: "Eng kuchli modellar bilan rasm yarating",
  video: "AI video va tayyor effektlar — narx yaratishdan oldin ko‘rinadi",
  ovoz: "Matnni o‘zbekcha AI ovoz bilan o‘qiting — o‘z ovozingiz bilan ham",
  audio: "AI musiqa, ovoz effektlari, ovozni almashtirish va shovqindan tozalash",
};

function StudioApp() {
  usePricingVersion(); // an admin price adjustment re-renders every price on the page
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const gated = useChannelGate((s) => s.gate !== null);
  // P2b (docs/studio/P2B-SPEC.md): drawing, or an edit / upscale / background removal of the user's own picture.
  const [mode, setMode] = useState<StudioMode>("image");
  const purpose = MODE_PURPOSE[mode];
  const { state, reload } = useMediaCatalog(purpose);
  // A catalog of the previous mode is never used for this one (the hook keeps the last answer until the next arrives).
  const catalog = state.status === "ready" && state.catalog.purpose === purpose ? state.catalog : null;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [template, setTemplate] = useState<{ t: StudioTemplate; slots: Record<string, string> } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);

  const [chosen, setChosen] = useState<string | null>(null);
  const [raw, setRaw] = useState<RawValues>({});
  const [view, setView] = useState<View>("create");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { jobs, track } = useStudioJobs();
  // The Video tab (P3): its own catalog (loaded once the tab is opened), form state and jobs — kept while on «Rasm».
  const [tab, setTab] = useState<StudioTab>("rasm");
  const [videoSeen, setVideoSeen] = useState(false);
  const [videoState, setVideoState] = useState<VideoTabState>(INITIAL_VIDEO_STATE);
  const video = useMediaCatalog(STUDIO_VIDEO_PURPOSE, videoSeen);
  const videoJobs = useStudioJobs();
  // The «Ovoz» tab (P5): its own catalog (loaded once the tab is opened), form state and jobs — kept across tabs.
  const [voiceSeen, setVoiceSeen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceTabState>(INITIAL_VOICE_STATE);
  const voiceCatalog = useMediaCatalog(STUDIO_SPEECH_PURPOSE, voiceSeen);
  const voiceJobs = useStudioJobs();
  // P8b (docs/studio/P8-SPEC.md): with `studio.legacy_fold` on, «Podkast» / «Tabriknoma» open inside the «Ovoz» tab.
  const legacyFold = useLegacyFold();
  const [voiceTemplate, setVoiceTemplate] = useState<VoiceTemplateId | null>(null);
  const templateJobs = useStudioJobs();
  // The «Audio» tab (P6): its own catalog listing (loaded once the tab is opened), form state and jobs.
  const [audioSeen, setAudioSeen] = useState(false);
  const [audioState, setAudioState] = useState<AudioTabState>(INITIAL_AUDIO_STATE);
  const audioCatalog = useMediaCatalog(STUDIO_AUDIO_LISTING, audioSeen);
  const audioJobs = useStudioJobs();
  // P7a «Solishtirish» (docs/studio/P7-SPEC.md, compare/): the Rasm tab's drawing mode and the Video tab, ≥ 2 models.
  const compare = useCompare();
  const compareKind = tab === "rasm" && mode === "image" ? "image" : tab === "video" ? "video" : null;
  const compareCatalog = compareKind === "image" ? catalog : compareKind === "video" && video.state.status === "ready" ? video.state.catalog : null;
  const comparing = compareAvailability(compareKind, compareCatalog) && compare[compareKind].state.on;
  function toggleCompare(on: boolean) {
    if (!compareAvailability(compareKind, compareCatalog) || !compareCatalog) return;
    setError(null);
    const seed = compareKind === "image" ? { chosen, raw } : { chosen: videoState.chosen, raw: videoState.raw };
    compare[compareKind].setState((s) => (on ? enableCompare(s, compareCatalog.models, seed.chosen, seed.raw) : { ...s, on: false }));
  }
  /** «Shu modelni tanlash»: compare off, that model chosen in the tab's own form with the compared prompt. */
  function pickCompared(kind: "image" | "video", modelId: string, prompt: string) {
    compare[kind].setState((s) => ({ ...s, on: false }));
    if (kind === "video") {
      setVideoState((s) => ({ ...s, mode: "text", chosen: modelId, raw: { ...s.raw, [PROMPT_PARAM]: prompt } }));
      return;
    }
    const next = catalog?.models.find((m) => m.id === modelId);
    setChosen(modelId);
    setRaw((prev) => (next ? carryOver(next, { ...prev, [PROMPT_PARAM]: prompt }) : { ...prev, [PROMPT_PARAM]: prompt }));
  }
  useEffect(() => {
    const asked = typeof window !== "undefined" ? tabFromSearch(window.location.search) : "rasm";
    if (asked !== "rasm") setTab(asked);
    if (typeof window !== "undefined") setVoiceTemplate(voiceTemplateFromSearch(window.location.search));
  }, []);
  useEffect(() => {
    if (tab === "video") setVideoSeen(true);
    if (tab === "ovoz") setVoiceSeen(true);
    if (tab === "audio") setAudioSeen(true);
  }, [tab]);

  const rootRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const { typing } = useKeyboardInset(rootRef);
  // The gallery is a view of this page with its own history entry: back returns to the form.
  useOverlayHistory(view === "gallery", () => setView("create"));
  // P7b «Keyingi qadam» (docs/studio/P7-SPEC.md): a result handed to the next tab, prefilled — each step is that tab's own priced job.
  const openTab = useCallback((t: StudioTab) => {
    setView("create");
    setTab(t);
    if (typeof window !== "undefined") rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);
  // A text handed to «Ovoz» lands in the speech form: an open template closes.
  const handVoice = useCallback((fn: (s: VoiceTabState) => VoiceTabState) => {
    setVoiceTemplate(null);
    setVoiceState(fn);
  }, []);
  const handoff = useHandoffs({ open: openTab, setVideoState, setVoiceState: handVoice, setAudioState });
  // P8c «Keyingi qadam» → «Montaj» (docs/studio/P8-SPEC.md): the result pre-picked in the «Audio» tab's «Montaj» mode.
  const toMix = useCallback(
    (kind: MixHandoff, id: string) => {
      setAudioState((s) => ({ ...s, mode: "mix", mix: mixFromResult(s.mix ?? INITIAL_MIX_STATE, kind, id) }));
      openTab("audio");
    },
    [openTab],
  );

  const entry = resolveEntry(catalog, chosen);
  const values = entry ? effective(entry, raw) : {};
  const price = entry && catalog ? studioPrice(entry, values, catalog.pricing) : null;
  const count = entry ? outputCount(entry, values) : 1;
  const balance = loggedIn && user ? creditTotal(user) : null;
  // Bonus so'm never pays for video (D5): the Video tab compares with the paid balance.
  const paidBalance = loggedIn && user ? (user.quota ?? 0) + (user.balance ?? 0) : null;

  function selectModel(id: string) {
    const next = catalog?.models.find((m) => m.id === id);
    if (!next) return;
    setChosen(id);
    setRaw((prev) => carryOver(next, prev));
  }

  const setParam = (name: string, value: unknown) => setRaw((prev) => ({ ...prev, [name]: value }));

  /** Typing the prompt by hand leaves the template (its slots would overwrite the text). */
  const setPrompt = (v: string) => {
    setTemplate(null);
    setParam(PROMPT_PARAM, v);
  };

  /**
   * Switch the tab's mode: P2b modes start with the given picture. `keepPrompt` («Rasm yuklash» only): the text typed so
   * far becomes the edit instruction; from a result card the instruction starts empty (the old prompt described the
   * picture, it is not an edit — review NIT-9).
   */
  function enterMode(next: StudioMode, assetId?: string, keepPrompt = false) {
    setError(null);
    setTemplate(null);
    setChosen(null);
    setMode(next);
    setView("create");
    setTab("rasm");
    setRaw((prev) => {
      const prompt = typeof prev[PROMPT_PARAM] === "string" ? { [PROMPT_PARAM]: prev[PROMPT_PARAM] } : {};
      return next === "image" ? prompt : { ...(next === "edit" && keepPrompt ? prompt : {}), [INPUT_PARAM]: assetId ? [assetId] : [] };
    });
    if (typeof window !== "undefined") rootRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  /** «Rasm yuklash»: the picture is uploaded, the tab switches to editing it. */
  async function uploadForEdit(file: File) {
    setUploading(true);
    setError(null);
    try {
      const got = await uploadStudioInput(file, file.name || "rasm");
      enterMode("edit", got.assetId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rasm yuklanmadi");
    } finally {
      setUploading(false);
    }
  }

  /** «Tahrirlash» / «Sifatini oshirish» / «Fonni olib tashlash» on a finished picture of the user's own job. */
  async function pictureTool(next: Exclude<StudioMode, "image">, picture: { url: string }) {
    const ref = resultAssetOf(picture.url);
    if (!ref) {
      setError("Bu rasmni ochib bo‘lmadi — natija sahifasidan yuklab, «Rasm yuklash» orqali qo‘shing.");
      return;
    }
    setError(null);
    try {
      const got = await inputFromResult(ref.generationId, ref.assetId);
      enterMode(next, got.assetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rasm tayyorlanmadi");
    }
  }

  /** «Shablonlar»: the template's model, preset values and the prompt built from its (empty) slots. */
  function pickTemplate(t: StudioTemplate) {
    const target = catalog?.models.find((m) => m.id === t.modelId);
    if (!target) return;
    setError(null);
    setChosen(target.id);
    setTemplate({ t, slots: {} });
    setRaw(applyTemplate(target, t, {}));
  }

  function setSlot(name: string, value: string) {
    if (!template || !entry) return;
    const slots = { ...template.slots, [name]: value };
    setTemplate({ t: template.t, slots });
    setParam(PROMPT_PARAM, fillSkeleton(template.t.skeleton, template.t.slots, slots).slice(0, promptLimit(entry)));
  }

  /** «Yaxshilash (AI)»: a free rewrite shown in the box (editable); the template is left. */
  async function enhance() {
    if (!entry) return;
    setEnhancing(true);
    setError(null);
    try {
      const better = await enhancePrompt(normalizedPrompt(entry, raw));
      setPrompt(better.slice(0, promptLimit(entry)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tavsif yaxshilanmadi");
    } finally {
      setEnhancing(false);
    }
  }

  function scrollToResults() {
    // The three-column layout shows the results beside the form; below it they are under the form.
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches) return;
    resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function send(target: ClientEntry, sent: Record<string, unknown>, pricing: StudioPricing | undefined = catalog?.pricing, jobPurpose: string = purpose) {
    if (!pricing) return;
    setError(null);
    setSubmitting(true);
    const prompt = String(sent[PROMPT_PARAM] ?? "");
    try {
      const { id, price: charged } = await queueGeneration(
        { slug: STUDIO_TOOL_SLUG, id: STUDIO_TOOL_ID, title: prompt.slice(0, 72), output: "png" },
        sent as unknown as FormValues,
        studioPrice(target, sent, pricing),
        // A second press with the same prompt is a new picture, not a double click.
        { repeat: true },
      );
      track({ id, modelId: target.id, modelLabel: target.label, prompt: prompt || (jobPurpose !== MODE_PURPOSE.image ? jobLabel(jobPurpose) : ""), price: charged, sent, purpose: jobPurpose });
      scrollToResults();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Xatolik");
      // 400 before charging: the model or a value is no longer accepted — the offered list may have changed.
      if (e instanceof ApiError && e.status === 400) reload(true);
      // 409 price_changed: the markup / override / live cost moved — re-read the pricing block so the button shows the new price.
      if (e instanceof PriceChangedError) reload(true);
    } finally {
      setSubmitting(false);
    }
  }

  function submit() {
    if (!entry) return;
    if (mode !== "image" && !(Array.isArray(values[INPUT_PARAM]) && (values[INPUT_PARAM] as unknown[]).length > 0)) {
      setError("Avval rasm yuklang");
      return;
    }
    if (promptParam(entry) && normalizedPrompt(entry, raw).length < promptMin(entry)) {
      setError(mode === "edit" ? "Nimani o‘zgartirish kerakligini yozing" : "Nima chizish kerakligini yozing");
      return;
    }
    void send(entry, requestValues(entry, raw));
  }

  function again(job: StudioJob) {
    // A job of another mode (an upscale while drawing) is repeated with ITS purpose's catalog and pricing.
    if (job.purpose && job.purpose !== purpose) {
      void loadMediaCatalog(job.purpose).then(
        (c) => {
          const m = c.models.find((x) => x.id === job.modelId);
          if (m) void send(m, job.sent, c.pricing, c.purpose);
          else setError("Bu model hozir mavjud emas.");
        },
        (e: unknown) => setError(e instanceof Error ? e.message : "Xatolik"),
      );
      return;
    }
    const model = catalog?.models.find((m) => m.id === job.modelId);
    if (!model) {
      // The model is not offered any more: say so and let the user pick another for the same prompt.
      setError("Bu model hozir mavjud emas — boshqa modelni tanlang.");
      otherModel(job.prompt);
      return;
    }
    void send(model, job.sent);
  }

  /** «Boshqa modelda»: the same prompt back in the form, the model picker open. */
  function otherModel(prompt: string) {
    if (mode !== "image") enterMode("image");
    setView("create");
    setTab("rasm");
    setRaw((prev) => ({ ...prev, [PROMPT_PARAM]: entry ? prompt.slice(0, promptLimit(entry)) : prompt }));
    setPickerOpen(true);
  }

  /**
   * «Yana yaratish» on a gallery clip: back to the Video tab at what was bought — the effect scene for an effect; else
   * the clip's model, prompt, length, aspect and sound (so the button shows the same price). A model the tab no longer
   * offers falls back to the default as any stale choice does; the photo is never re-used (it may be purged).
   */
  function videoAgain(item: GalleryItem) {
    setView("create");
    setTab("video");
    const v = item.video;
    if (v?.effect) {
      setVideoState((s) => ({ ...s, mode: "effects", effect: v.effect }));
      return;
    }
    const next: RawValues = { [PROMPT_PARAM]: item.prompt };
    if (v?.requestedSeconds) next.seconds = v.requestedSeconds;
    if (v?.aspect) next.aspect = v.aspect;
    if (v?.sound !== null && v?.sound !== undefined) next.sound = v.sound;
    setVideoState((s) => ({ ...s, mode: "text", chosen: item.modelId ?? s.chosen, raw: next }));
  }

  const toGallery = () => setView("gallery");
  const toCreate = () => setView("create");

  const galleryButton =
    view === "gallery" ? (
      <button type="button" data-studio-create-link onClick={toCreate} className={cn(HEADER_BTN, "xl:hidden")}>
        <Wand2 className="size-[18px]" aria-hidden />
        Yaratish
      </button>
    ) : (
      <button type="button" data-studio-gallery-link onClick={toGallery} className={cn(HEADER_BTN, "xl:hidden")}>
        <LayoutGrid className="size-[18px]" aria-hidden />
        Galereya
      </button>
    );

  return (
    <MixHandoffContext.Provider value={toMix}>
    <div className="flex w-full flex-col" data-studio>
      <PageHeader back title="Studio" subtitle={SUBTITLE[tab]} contentClassName={WIDTH} actions={galleryButton} />
      <div
        ref={rootRef}
        data-studio-body
        className={cn(
          "mx-auto w-full px-4 pt-2 pb-6",
          WIDTH,
          "md:grid md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:items-start md:gap-6",
          "xl:grid-cols-[14.5rem_minmax(0,27.5rem)_minmax(0,1fr)]",
        )}
      >
        <StudioNav view={view} onView={setView} balance={balance} />

        {view === "gallery" ? (
          <section aria-label="Galereya" data-studio-gallery className="md:col-span-2">
            <h2 className="mb-3 text-[20px] font-extrabold">Galereya</h2>
            <HandoffAlert error={handoff.error} />
            <Gallery
              onCreate={toCreate}
              onOtherModel={(item: GalleryItem) => (item.kind === "video" ? videoAgain(item) : otherModel(item.prompt))}
              onTool={(m, p) => void pictureTool(m, p)}
              onVideo={(url, prompt) => void handoff.toVideo(url, prompt)}
              onVoice={(text) => void handoff.toVoice(text)}
              onMusic={(prompt) => void handoff.toMusic(prompt)}
            />
          </section>
        ) : (
          <>
            <div data-studio-form className={cn("min-w-0", (tab !== "rasm" || comparing) && "md:col-span-2", tab !== "rasm" && !comparing && "md:max-w-[44rem]")}>
              <div role="tablist" aria-label="Studio bo‘limlari" data-studio-tabs className="bg-muted/70 mb-3 inline-flex max-w-full rounded-[14px] p-1">
                {STUDIO_TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    data-studio-tab={t}
                    onClick={() => {
                      setTab(t);
                      setError(null);
                      handoff.clearError();
                    }}
                    className={cn(
                      "focus-visible:ring-ring min-h-11 rounded-[10px] px-3.5 text-[15px] font-semibold sm:px-5 outline-none focus-visible:ring-2",
                      tab === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
              <ChannelGate />
              <HandoffAlert error={handoff.error} />
              {tab === "rasm" && mode !== "image" ? (
                <div className="bg-accent-soft text-accent-soft-foreground mb-3 flex items-center justify-between gap-2 rounded-[14px] px-3.5 py-2" data-studio-mode={mode}>
                  <p className="text-[14.5px] font-bold">{MODE_LABEL[mode]}</p>
                  <button
                    type="button"
                    data-studio-mode-exit
                    onClick={() => enterMode("image")}
                    className="focus-visible:ring-ring inline-flex min-h-11 items-center gap-1 rounded-[10px] px-2 text-[13.5px] font-semibold outline-none focus-visible:ring-2"
                  >
                    <X className="size-4" aria-hidden />
                    Yangi rasm
                  </button>
                </div>
              ) : null}
              {compareAvailability(compareKind, compareCatalog) ? <CompareSwitch checked={comparing} onChange={toggleCompare} /> : null}
              {comparing && compareKind && compareCatalog ? (
                <ComparePanel
                  kind={compareKind}
                  catalog={compareCatalog}
                  tab={compare[compareKind]}
                  balance={compareKind === "video" ? paidBalance : balance}
                  typing={typing}
                  gated={gated}
                  reload={compareKind === "video" ? video.reload : reload}
                  onPick={(id, prompt) => pickCompared(compareKind, id, prompt)}
                />
              ) : tab === "audio" ? (
                <AudioTab
                  catalogState={audioCatalog.state}
                  reload={audioCatalog.reload}
                  state={audioState}
                  setState={setAudioState}
                  jobs={audioJobs.jobs}
                  track={audioJobs.track}
                  balance={balance}
                  typing={typing}
                  gated={gated}
                />
              ) : tab === "ovoz" ? (
                <>
                  {legacyFold ? <VoiceTemplatesRow active={voiceTemplate} onPick={setVoiceTemplate} /> : null}
                  {legacyFold && voiceTemplate ? (
                    <VoiceTemplatePanel id={voiceTemplate} onClose={() => setVoiceTemplate(null)} jobs={templateJobs.jobs} track={templateJobs.track} />
                  ) : (
                    <VoiceTab
                      catalogState={voiceCatalog.state}
                      reload={voiceCatalog.reload}
                      state={voiceState}
                      setState={setVoiceState}
                      jobs={voiceJobs.jobs}
                      track={voiceJobs.track}
                      balance={balance}
                      typing={typing}
                      gated={gated}
                      quietWhenNone={legacyFold}
                    />
                  )}
                </>
              ) : tab === "video" ? (
                <VideoTab
                  catalogState={video.state}
                  reload={video.reload}
                  state={videoState}
                  setState={setVideoState}
                  jobs={videoJobs.jobs}
                  track={videoJobs.track}
                  balance={paidBalance}
                  typing={typing}
                  gated={gated}
                  onMusic={(prompt) => void handoff.toMusic(prompt)}
                  onVoice={(text) => void handoff.toVoice(text)}
                />
              ) : !catalog ? (
                <CatalogStatus status={state.status} message={state.status === "error" ? state.message : ""} onRetry={() => reload()} />
              ) : entry === null ? (
                <MediaModelPicker purpose={purpose} catalog={catalog} value="" values={{}} onChange={selectModel} />
              ) : (
                <>
                  {promptParam(entry) ? (
                    <PromptBox
                      value={String(raw[PROMPT_PARAM] ?? "")}
                      onChange={setPrompt}
                      limit={promptLimit(entry)}
                      min={promptMin(entry)}
                      label={mode === "edit" ? "Nimani o‘zgartiramiz?" : "Nimani chizamiz?"}
                      {...(mode === "image"
                        ? { onSamples: () => setLibraryOpen(true), onUpload: (f: File) => void uploadForEdit(f), uploading, onEnhance: () => void enhance(), enhancing }
                        : {})}
                    />
                  ) : null}
                  {mode === "image" ? <TemplatesRow modelIds={catalog.models.map((m) => m.id)} activeId={template?.t.id ?? null} onPick={pickTemplate} /> : null}
                  {template ? <TemplateSlots template={template.t} values={template.slots} onChange={setSlot} onClose={() => setTemplate(null)} /> : null}
                  {libraryOpen ? <LibrarySheet onPick={setPrompt} onClose={() => setLibraryOpen(false)} /> : null}
                  <MediaModelPicker
                    purpose={purpose}
                    catalog={catalog}
                    value={entry.id}
                    values={values}
                    onChange={selectModel}
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                  />
                  <ParamRows entry={entry} raw={raw} onChange={setParam} />
                  {error && !gated ? (
                    <p role="alert" data-studio-error className="text-destructive mb-3 text-[14.5px] leading-snug">
                      {error}
                      {INSUFFICIENT_RE.test(error) ? (
                        <>
                          {" "}
                          <Link href={PAY_RETURN_PATH} data-topup className="text-accent-soft-foreground pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center font-semibold whitespace-nowrap underline underline-offset-2">
                            Balansni to‘ldirish →
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  <PriceButton count={count} price={price} balance={balance} loading={submitting} disabled={false} typing={typing} onSubmit={submit} />
                </>
              )}
            </div>
            {tab === "rasm" && !comparing ? (
              <section ref={resultsRef} aria-label="Natijalar" data-studio-results className={cn("min-w-0 md:mt-0", jobs.length > 0 && "mt-5")}>
                <StudioResults
                  jobs={jobs}
                  busy={submitting}
                  onAgain={again}
                  onOtherModel={(job) => otherModel(job.prompt)}
                  onTool={(m, p) => void pictureTool(m, p)}
                  onVideo={(url, prompt) => void handoff.toVideo(url, prompt)}
                  onVoice={(text) => void handoff.toVoice(text)}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
    </MixHandoffContext.Provider>
  );
}

/** The card line of a utility job (no prompt): what was done. */
function jobLabel(jobPurpose: string): string {
  if (jobPurpose === MODE_PURPOSE.upscale) return MODE_LABEL.upscale;
  if (jobPurpose === MODE_PURPOSE.bgremove) return MODE_LABEL.bgremove;
  return MODE_LABEL.edit;
}

const HEADER_BTN =
  "bg-card hover:bg-muted focus-visible:ring-ring pointer-coarse:min-h-11 inline-flex h-11 items-center gap-1.5 rounded-[14px] border px-3 text-[14px] font-semibold outline-none focus-visible:ring-2";

/** Loading / failed catalog in place of the form (the picker shows its own states when embedded alone). */
function CatalogStatus({ status, message, onRetry }: { status: "loading" | "error" | "ready"; message: string; onRetry: () => void }) {
  if (status === "error") {
    return (
      <p role="alert" className="text-destructive text-[14.5px]" data-studio-catalog-error>
        {message}{" "}
        <button type="button" onClick={onRetry} className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2">
          Qayta urinish
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Studio yuklanmoqda" data-studio-loading>
      <div className="bg-muted/60 h-36 animate-pulse rounded-[20px]" />
      <div className="bg-muted/60 h-[5.25rem] animate-pulse rounded-[18px]" />
      <div className="bg-muted/60 h-40 animate-pulse rounded-[20px]" />
    </div>
  );
}

/** Desktop navigation column: where you are (Yaratish / Galereya) and the balance with its top-up link. */
function StudioNav({ view, onView, balance }: { view: View; onView: (v: View) => void; balance: number | null }) {
  const item = (v: View, label: string) => (
    <button
      type="button"
      data-studio-nav={v}
      aria-current={view === v ? "page" : undefined}
      onClick={() => onView(v)}
      className={cn(
        "focus-visible:ring-ring h-11 rounded-[12px] px-3 text-left text-[15px] outline-none focus-visible:ring-2",
        view === v ? "bg-muted font-bold" : "hover:bg-muted/60 font-medium",
      )}
    >
      {label}
    </button>
  );
  return (
    <nav aria-label="Studio menyusi" data-studio-menu className="hidden flex-col gap-1 xl:sticky xl:top-20 xl:flex">
      <p className="mb-3 px-3 text-[20px] font-extrabold">Studio</p>
      {item("create", "Yaratish")}
      {item("gallery", "Galereya")}
      {balance === null ? null : (
        <div className="bg-card mt-6 rounded-[14px] border p-3">
          <p className="text-muted-foreground text-[12.5px]">Balans</p>
          <p className="mt-0.5 mb-2 text-[20px] font-extrabold tabular-nums" data-studio-nav-balance>
            {formatSom(balance)}
          </p>
          <Link href={PAY_RETURN_PATH} className="text-accent-soft-foreground text-[13.5px] font-semibold underline underline-offset-2">
            To‘ldirish
          </Link>
        </div>
      )}
    </nav>
  );
}
