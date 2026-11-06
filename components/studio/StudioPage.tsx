"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onNavigate } from "@/lib/nav/history";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, Wand2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { creditTotal, usePricingVersion, useAppStore } from "@/lib/store";
import { useChannelGate } from "@/lib/channel-gate";
import { useUi } from "@/lib/ui";
import type { ClientEntry } from "@/lib/studio-core";
import { PageHeader } from "@/components/shell/PageHeader";
import { ChannelGate } from "@/components/forms/ChannelGate";
import { useKeyboardInset } from "@/components/forms/useKeyboardInset";
import { useOverlayHistory } from "@/components/nav/useOverlayHistory";
import { PAY_RETURN_PATH } from "@/components/overlays/pay-amount";
import { CatalogState } from "./CatalogState";
import { Gallery } from "./Gallery";
import { MediaModelPicker } from "./MediaModelPicker";
import { ParamRows } from "./ParamRows";
import { PriceButton } from "./PriceButton";
import { PromptBox } from "./PromptBox";
import { usePromptEnhance } from "./usePromptEnhance";
import { StudioResults, type StudioJob } from "./StudioResults";
import { SubmitError } from "./SubmitError";
import { STUDIO_AUDIO_LISTING, STUDIO_SPEECH_PURPOSE, STUDIO_VIDEO_PURPOSE, fetchActiveJobs, inputFromResult, loadMediaCatalog, resultAssetOf, uploadStudioInput, useMediaCatalog, type ActiveJob } from "./studio-api";
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
import { INITIAL_RASM, INPUT_PARAM, MODE_LABEL, MODE_PURPOSE, applyTemplate, enterRasmMode, patchRasmForm, rasmForm, type RasmState, type StudioMode } from "./studio-modes";
import { fillSkeleton, type StudioTemplate } from "@/lib/media/library";
import { STUDIO_TOOL_SLUG } from "./studio-entry";
import { STUDIO_TOOL_ID, outputCount, studioPrice } from "./studio-price";
import type { GalleryItem, MediaCatalog, StudioPricing } from "./studio-types";
import { PROMPT_PARAM, carryOver, effective, normalizedPrompt, promptLimit, promptMin, promptParam, requestValues, type RawValues } from "./studio-values";
import { draftKey, useDraft } from "./useDraft";
import { parseAudioDraft, parseRasmDraft, parseVideoDraft, parseVoiceDraft } from "./studio-drafts";
import { STUDIO_TABS, modeFromSearch, studioSearch, tabFromSearch, type StudioTab } from "./studio-url";
import { useStudioJobs } from "./useStudioJobs";
import { useStudioSend } from "./useStudioSend";
import { ComparePanel, CompareSwitch } from "./compare/ComparePanel";
import { compareAvailability, enableCompare, useCompare } from "./compare/useCompare";

const WIDTH = "max-w-[1320px]";
const LOADING = <div className="text-muted-foreground p-8 text-[15px]">Yuklanmoqda...</div>;

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
  const userKey = useAppStore((s) => s.user?.id ?? "anon");
  // The session is checked on the server first: never open the login for a signed-in user (as `ToolWorkspace`).
  useEffect(() => {
    // The link's tab and mode survive the login.
    if (sessionChecked && !loggedIn) open("login", { returnTo: `/uz/studio${window.location.search}` });
  }, [sessionChecked, loggedIn, open]);
  if (!sessionChecked) return LOADING;
  // Keyed by the user: an account switched in place keeps no form, job or poller of the one before it.
  return <StudioApp key={userKey} />;
}

type View = "create" | "gallery";
export { STUDIO_TABS, tabFromSearch, type StudioTab };

const TAB_LABEL: Readonly<Record<StudioTab, string>> = { rasm: "Rasm", video: "Video", ovoz: "Ovoz", audio: "Audio" };
const SUBTITLE: Readonly<Record<StudioTab, string>> = {
  rasm: "Eng kuchli modellar bilan rasm yarating",
  video: "AI video va tayyor effektlar — narx yaratishdan oldin ko‘rinadi",
  ovoz: "Matnni o‘zbekcha AI ovoz bilan o‘qiting — o‘z ovozingiz bilan ham",
  audio: "AI musiqa, ovoz effektlari, ovozni almashtirish va shovqindan tozalash",
};

/** The mode the page's link asks for on `tab`; `null` when the link is about another tab or names none. Client only. */
function linkMode(tab: StudioTab): string | null {
  const { search } = window.location;
  return tabFromSearch(search) === tab ? modeFromSearch(tab, search) : null;
}

function StudioApp() {
  usePricingVersion(); // an admin price adjustment re-renders every price on the page
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const gated = useChannelGate((s) => s.gate !== null);
  // P2b (docs/studio/P2B-SPEC.md): drawing, or an edit / upscale / background removal of the user's own picture.
  // One form per mode (`studio-modes.ts`). Every tab starts on the mode its link asks for, so the first URL write keeps it.
  const [rasm, setRasm] = useState<RasmState>(() => {
    const m = linkMode("rasm");
    return m ? enterRasmMode(INITIAL_RASM, m as StudioMode) : INITIAL_RASM;
  });
  const { mode } = rasm;
  const { chosen, raw } = rasmForm(rasm);
  const purpose = MODE_PURPOSE[mode];
  const { state, reload } = useMediaCatalog(purpose);
  // A catalog of the previous mode is never used for this one (the hook keeps the last answer until the next arrives).
  const catalog = state.status === "ready" && state.catalog.purpose === purpose ? state.catalog : null;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [template, setTemplate] = useState<{ t: StudioTemplate; slots: Record<string, string> } | null>(null);
  const [uploading, setUploading] = useState(false);

  const setChosen = useCallback((id: string) => setRasm((s) => patchRasmForm(s, (f) => ({ ...f, chosen: id }))), []);
  const setRaw = useCallback((fn: (prev: RawValues) => RawValues) => setRasm((s) => patchRasmForm(s, (f) => ({ ...f, raw: fn(f.raw) }))), []);
  const [view, setView] = useState<View>("create");
  const [pickerOpen, setPickerOpen] = useState(false);
  // Client only: `StudioPage` renders this after the session check, never on the server.
  const [tab, setTab] = useState<StudioTab>(() => tabFromSearch(window.location.search));
  const onScreen = (t: StudioTab) => view === "create" && tab === t;
  // The catalogs of other modes' jobs: a retry there is priced by the purpose it was bought under.
  const [jobCatalogs, setJobCatalogs] = useState<Readonly<Record<string, MediaCatalog>>>({});
  const [jobCatalogsRead, setJobCatalogsRead] = useState(0);
  // 400 before charging: the model or a value is no longer accepted; 409 price_changed: the markup / override / live
  // cost moved. Either way the catalogs (and with them the prices on the buttons) are read again.
  const { submitting, error, setError, send: queue } = useStudioSend(() => {
    reload(true);
    setJobCatalogsRead((n) => n + 1);
  });
  const { jobs, track, restore: restoreRasm } = useStudioJobs(onScreen("rasm"));
  const otherPurposes = [...new Set(jobs.flatMap((j) => (j.purpose && j.purpose !== purpose ? [j.purpose] : [])))].sort().join(" ");
  useEffect(() => {
    let live = true;
    for (const p of otherPurposes.split(" ").filter(Boolean)) {
      loadMediaCatalog(p, { fresh: jobCatalogsRead > 0 }).then(
        (c) => live && setJobCatalogs((m) => ({ ...m, [p]: c })),
        // Not known: the card keeps what the job cost, and the server's price guard refuses anything else.
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [otherPurposes, jobCatalogsRead]);
  // The Video tab (P3): its own catalog (loaded once the tab is opened), form state and jobs — kept while on «Rasm».
  const [videoSeen, setVideoSeen] = useState(false);
  const [videoState, setVideoState] = useState<VideoTabState>(() => ({ ...INITIAL_VIDEO_STATE, mode: linkMode("video") as VideoTabState["mode"] }));
  const video = useMediaCatalog(STUDIO_VIDEO_PURPOSE, videoSeen);
  const videoJobs = useStudioJobs(onScreen("video"));
  // The «Ovoz» tab (P5): its own catalog (loaded once the tab is opened), form state and jobs — kept across tabs.
  const [voiceSeen, setVoiceSeen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceTabState>(() => ({ ...INITIAL_VOICE_STATE, mode: linkMode("ovoz") as VoiceTabState["mode"] }));
  const voiceCatalog = useMediaCatalog(STUDIO_SPEECH_PURPOSE, voiceSeen);
  const voiceJobs = useStudioJobs(onScreen("ovoz"));
  // P8b (docs/studio/P8-SPEC.md): with `studio.legacy_fold` on, «Podkast» / «Tabriknoma» open inside the «Ovoz» tab.
  const legacyFold = useLegacyFold();
  const [voiceTemplate, setVoiceTemplate] = useState<VoiceTemplateId | null>(null);
  const templateJobs = useStudioJobs();
  // The «Audio» tab (P6): its own catalog listing (loaded once the tab is opened), form state and jobs.
  const [audioSeen, setAudioSeen] = useState(false);
  const [audioState, setAudioState] = useState<AudioTabState>(() => ({ ...INITIAL_AUDIO_STATE, mode: linkMode("audio") as AudioTabState["mode"] }));
  const audioCatalog = useMediaCatalog(STUDIO_AUDIO_LISTING, audioSeen);
  const audioJobs = useStudioJobs(onScreen("audio"));
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
  // A refresh keeps the work: one draft per tab, per user (`useDraft.ts`); gone once the form's job is queued.
  const userId = loggedIn && user ? String(user.id) : null;
  const rasmDraft = useDraft(userId && draftKey(userId, "rasm"), rasm, parseRasmDraft, setRasm);
  const videoDraft = useDraft(userId && draftKey(userId, "video"), videoState, parseVideoDraft, setVideoState);
  const voiceDraft = useDraft(userId && draftKey(userId, "ovoz"), voiceState, parseVoiceDraft, setVoiceState);
  const audioDraft = useDraft(userId && draftKey(userId, "audio"), audioState, parseAudioDraft, setAudioState);

  // The URL says where the user is: a link, a back press or a refresh lands on the same tab and mode.
  const urlSearch = useSearchParams()?.toString() ?? null;
  const home = useRef(window.location.pathname);
  const applyUrl = useCallback(() => {
    // A navigation away reaches this listener too: another page's query says nothing about the Studio.
    if (window.location.pathname !== home.current) return;
    const search = window.location.search;
    const asked = tabFromSearch(search);
    const askedMode = modeFromSearch(asked, search);
    setTab(asked);
    if (askedMode === null) return;
    if (asked === "rasm") setRasm((s) => (s.mode === askedMode ? s : enterRasmMode(s, askedMode as StudioMode)));
    if (asked === "video") setVideoState((s) => (s.mode === askedMode ? s : { ...s, mode: askedMode as VideoTabState["mode"] }));
    if (asked === "ovoz") setVoiceState((s) => (s.mode === askedMode ? s : { ...s, mode: askedMode as VoiceTabState["mode"] }));
    if (asked === "audio") setAudioState((s) => (s.mode === askedMode ? s : { ...s, mode: askedMode as AudioTabState["mode"] }));
  }, []);
  // After the drafts' restore (the effects above run first): a link's mode wins over the draft's.
  useEffect(applyUrl, [applyUrl, urlSearch, userId]);
  useEffect(() => {
    // A soft navigation to this same page (a link to `/uz/studio`) changes no state of its own.
    const off = onNavigate(applyUrl);
    window.addEventListener("popstate", applyUrl);
    return () => {
      off();
      window.removeEventListener("popstate", applyUrl);
    };
  }, [applyUrl]);
  useEffect(() => setVoiceTemplate(voiceTemplateFromSearch(window.location.search)), []);
  const activeMode = tab === "rasm" ? mode : tab === "video" ? videoState.mode : tab === "ovoz" ? voiceState.mode : audioState.mode;
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (pathname !== home.current) return;
    const next = studioSearch(search, tab, activeMode);
    // `history.state` stays: it carries the router's tree and the overlay layers of `lib/nav`.
    if (next !== search) window.history.replaceState(window.history.state, "", `${pathname}${next}${hash}`);
  }, [tab, activeMode]);

  // A refresh keeps the running jobs too: the server knows them, each goes back to its tab.
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restoreVideo = videoJobs.restore;
  const restoreVoice = voiceJobs.restore;
  const restoreAudio = audioJobs.restore;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    const follow = (j: ActiveJob) => {
      const job = { id: j.id, modelId: j.modelId, modelLabel: j.modelLabel, prompt: j.prompt, price: j.price, sent: j.sent };
      if (j.tool === "studio-image") restoreRasm({ ...job, prompt: j.prompt || (j.purpose && j.purpose !== MODE_PURPOSE.image ? jobLabel(j.purpose) : ""), ...(j.purpose ? { purpose: j.purpose } : {}) });
      else if (j.tool === "studio-video") restoreVideo(job);
      else if (j.tool === "studio-speech") restoreVoice(job);
      else restoreAudio(job);
    };
    fetchActiveJobs().then(
      // Oldest first: each goes on top, so the newest ends up first.
      (list) => live && [...list].reverse().forEach(follow),
      (e: unknown) => live && setRestoreError(e instanceof Error ? e.message : "Xatolik"),
    );
    return () => {
      live = false;
    };
  }, [userId, restoreAttempt, restoreRasm, restoreVideo, restoreVoice, restoreAudio]);

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
  const { enhance, enhancing } = usePromptEnhance(
    "image",
    () => (entry ? normalizedPrompt(entry, raw) : ""),
    (v) => (entry ? setPrompt(v.slice(0, promptLimit(entry))) : undefined),
    setError,
  );
  const setPrompt = (v: string) => {
    setTemplate(null);
    setParam(PROMPT_PARAM, v);
  };

  /** Switch the tab's mode: P2b modes start with the given picture; the form being left stays (`enterRasmMode`). */
  function enterMode(next: StudioMode, assetId?: string, keepPrompt = false) {
    setError(null);
    setTemplate(null);
    setRasm((s) => enterRasmMode(s, next, assetId, keepPrompt));
    setView("create");
    setTab("rasm");
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
    setRaw(() => applyTemplate(target, t, {}));
  }

  function setSlot(name: string, value: string) {
    if (!template || !entry) return;
    const slots = { ...template.slots, [name]: value };
    setTemplate({ t: template.t, slots });
    setParam(PROMPT_PARAM, fillSkeleton(template.t.skeleton, template.t.slots, slots).slice(0, promptLimit(entry)));
  }

  function scrollToResults() {
    // The three-column layout shows the results beside the form; below it they are under the form.
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches) return;
    resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  /** `shown`: the number the pressed button says; the server's price guard refuses a job at any other price. */
  async function send(target: ClientEntry, sent: Record<string, unknown>, pricing: StudioPricing | undefined = catalog?.pricing, jobPurpose: string = purpose, shown?: number) {
    if (!pricing) return false;
    const prompt = String(sent[PROMPT_PARAM] ?? "");
    return queue({ slug: STUDIO_TOOL_SLUG, id: STUDIO_TOOL_ID, title: prompt.slice(0, 72), output: "png" }, sent, shown ?? studioPrice(target, sent, pricing), ({ id, price: charged }) => {
      track({ id, modelId: target.id, modelLabel: target.label, prompt: prompt || (jobPurpose !== MODE_PURPOSE.image ? jobLabel(jobPurpose) : ""), price: charged, sent, purpose: jobPurpose });
      scrollToResults();
    });
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
    void send(entry, requestValues(entry, raw)).then((ok) => ok && rasmDraft.clear());
  }

  function again(job: StudioJob) {
    const shown = retryPrice(job);
    // A job of another mode (an upscale while drawing) is repeated with ITS purpose's catalog and pricing.
    if (job.purpose && job.purpose !== purpose) {
      void loadMediaCatalog(job.purpose).then(
        (c) => {
          const m = c.models.find((x) => x.id === job.modelId);
          if (m) void send(m, job.sent, c.pricing, c.purpose, shown);
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
    void send(model, job.sent, undefined, undefined, shown);
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

  // An error belongs to the view it happened in.
  const showView = (v: View) => {
    setError(null);
    setView(v);
  };
  const toGallery = () => showView("gallery");
  const toCreate = () => showView("create");

  /**
   * What «Qayta urinish» costs now, from the catalog of the job's own purpose; `again` sends this very number. Until that
   * catalog is read the card says what the job cost, and a price that has moved is refused, never charged.
   */
  function retryPrice(job: StudioJob): number {
    const own = job.purpose && job.purpose !== purpose ? jobCatalogs[job.purpose] : catalog;
    const model = own?.models.find((m) => m.id === job.modelId);
    return model && own ? studioPrice(model, job.sent, own.pricing) : job.price;
  }

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
        <StudioNav view={view} onView={showView} balance={balance} />

        {view === "gallery" ? (
          <section aria-label="Galereya" data-studio-gallery className="md:col-span-2">
            <h2 className="mb-3 text-[20px] font-extrabold">Galereya</h2>
            <HandoffAlert error={handoff.error} />
            <SubmitError error={error} gated={gated} />
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
              {restoreError ? (
                <p role="alert" data-studio-restore-error className="text-destructive mb-3 text-[14.5px] leading-snug">
                  Davom etayotgan ishlar yuklanmadi: {restoreError}{" "}
                  <button
                    type="button"
                    data-studio-restore-retry
                    onClick={() => {
                      setRestoreError(null);
                      setRestoreAttempt((n) => n + 1);
                    }}
                    className="pointer-coarse:min-h-11 font-semibold underline underline-offset-2"
                  >
                    Qayta urinish
                  </button>
                </p>
              ) : null}
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
                  onSubmitted={audioDraft.clear}
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
                      onSubmitted={voiceDraft.clear}
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
                  onSubmitted={videoDraft.clear}
                />
              ) : !catalog ? (
                <CatalogState state={state} onRetry={() => reload()} label="Studio yuklanmoqda" blocks={["h-36 rounded-[20px]", "h-[5.25rem] rounded-[18px]", "h-40 rounded-[20px]"]} />
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
                      onEnhance={() => void enhance()}
                      enhancing={enhancing}
                      {...(mode === "image" ? { onSamples: () => setLibraryOpen(true), onUpload: (f: File) => void uploadForEdit(f), uploading } : {})}
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
                  <SubmitError error={error} gated={gated} />
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
                  retryPrice={retryPrice}
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
