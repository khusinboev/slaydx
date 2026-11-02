"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Wand2 } from "lucide-react";
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
import { STUDIO_IMAGE_PURPOSE, STUDIO_VIDEO_PURPOSE, useMediaCatalog } from "./studio-api";
import { INITIAL_VIDEO_STATE, VideoTab, type VideoTabState } from "./video/VideoTab";
import { STUDIO_TOOL_SLUG } from "./studio-entry";
import { STUDIO_TOOL_ID, outputCount, studioPrice } from "./studio-price";
import type { GalleryItem, MediaCatalog } from "./studio-types";
import { PROMPT_PARAM, carryOver, effective, normalizedPrompt, promptLimit, promptMin, requestValues, type RawValues } from "./studio-values";
import { useStudioJobs } from "./useStudioJobs";

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
/** The Studio's media tabs (P1 «Rasm», P3 «Video»). */
export type StudioTab = "rasm" | "video";

/** The tab a link asks for (`/uz/studio?tab=video`, where `/uz/studio-video` redirects); anything else = «Rasm». */
export function tabFromSearch(search: string): StudioTab {
  return new URLSearchParams(search).get("tab") === "video" ? "video" : "rasm";
}

const TAB_LABEL: Readonly<Record<StudioTab, string>> = { rasm: "Rasm", video: "Video" };
const SUBTITLE: Readonly<Record<StudioTab, string>> = {
  rasm: "Eng kuchli modellar bilan rasm yarating",
  video: "AI video va tayyor effektlar — narx yaratishdan oldin ko‘rinadi",
};

function StudioApp() {
  usePricingVersion(); // an admin price adjustment re-renders every price on the page
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const gated = useChannelGate((s) => s.gate !== null);
  const { state, reload } = useMediaCatalog(STUDIO_IMAGE_PURPOSE);
  const catalog = state.status === "ready" ? state.catalog : null;

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
  useEffect(() => {
    if (typeof window !== "undefined" && tabFromSearch(window.location.search) === "video") setTab("video");
  }, []);
  useEffect(() => {
    if (tab === "video") setVideoSeen(true);
  }, [tab]);

  const rootRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const { typing } = useKeyboardInset(rootRef);
  // The gallery is a view of this page with its own history entry: back returns to the form.
  useOverlayHistory(view === "gallery", () => setView("create"));

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

  function scrollToResults() {
    // The three-column layout shows the results beside the form; below it they are under the form.
    if (typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1280px)").matches) return;
    resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function send(target: ClientEntry, sent: Record<string, unknown>) {
    if (!catalog) return;
    setError(null);
    setSubmitting(true);
    const prompt = String(sent[PROMPT_PARAM] ?? "");
    try {
      const { id, price: charged } = await queueGeneration(
        { slug: STUDIO_TOOL_SLUG, id: STUDIO_TOOL_ID, title: prompt.slice(0, 72), output: "png" },
        sent as unknown as FormValues,
        studioPrice(target, sent, catalog.pricing),
        // A second press with the same prompt is a new picture, not a double click.
        { repeat: true },
      );
      track({ id, modelId: target.id, modelLabel: target.label, prompt, price: charged, sent });
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
    if (normalizedPrompt(entry, raw).length < promptMin(entry)) {
      setError("Nima chizish kerakligini yozing");
      return;
    }
    void send(entry, requestValues(entry, raw));
  }

  function again(job: StudioJob) {
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
    setView("create");
    setTab("rasm");
    setRaw((prev) => ({ ...prev, [PROMPT_PARAM]: entry ? prompt.slice(0, promptLimit(entry)) : prompt }));
    setPickerOpen(true);
  }

  /** «Yana yaratish» on a gallery clip: back to the Video tab — the effect grid for an effect, else its prompt in the form. */
  function videoAgain(item: GalleryItem) {
    setView("create");
    setTab("video");
    if (item.video?.effectLabel) setVideoState((s) => ({ ...s, mode: "effects" }));
    else setVideoState((s) => ({ ...s, mode: "text", raw: { ...s.raw, [PROMPT_PARAM]: item.prompt } }));
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
            <Gallery onCreate={toCreate} onOtherModel={(item: GalleryItem) => (item.kind === "video" ? videoAgain(item) : otherModel(item.prompt))} />
          </section>
        ) : (
          <>
            <div data-studio-form className={cn("min-w-0", tab === "video" && "md:col-span-2 md:max-w-[44rem]")}>
              <div role="tablist" aria-label="Studio bo‘limlari" data-studio-tabs className="bg-muted/70 mb-3 inline-flex rounded-[14px] p-1">
                {(["rasm", "video"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    data-studio-tab={t}
                    onClick={() => {
                      setTab(t);
                      setError(null);
                    }}
                    className={cn(
                      "focus-visible:ring-ring min-h-11 rounded-[10px] px-5 text-[15px] font-semibold outline-none focus-visible:ring-2",
                      tab === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {TAB_LABEL[t]}
                  </button>
                ))}
              </div>
              <ChannelGate />
              {tab === "video" ? (
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
                />
              ) : !catalog ? (
                <CatalogStatus status={state.status} message={state.status === "error" ? state.message : ""} onRetry={() => reload()} />
              ) : entry === null ? (
                <MediaModelPicker purpose={STUDIO_IMAGE_PURPOSE} catalog={catalog} value="" values={{}} onChange={selectModel} />
              ) : (
                <>
                  <PromptBox value={String(raw[PROMPT_PARAM] ?? "")} onChange={(v) => setParam(PROMPT_PARAM, v)} limit={promptLimit(entry)} />
                  <MediaModelPicker
                    purpose={STUDIO_IMAGE_PURPOSE}
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
            {tab === "rasm" ? (
              <section ref={resultsRef} aria-label="Natijalar" data-studio-results className={cn("min-w-0 md:mt-0", jobs.length > 0 && "mt-5")}>
                <StudioResults jobs={jobs} busy={submitting} onAgain={again} onOtherModel={(job) => otherModel(job.prompt)} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
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
