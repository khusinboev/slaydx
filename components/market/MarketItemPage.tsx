"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Flag, FolderOpen, Sparkles, TrendingUp } from "lucide-react";
import { SelectField } from "@/components/forms/compact";
import { PageHeader } from "@/components/shell/PageHeader";
import * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { subjectLabel } from "@/lib/market/subjects";
import type { MarketItemView } from "@/lib/market/types";
import { useAppStore } from "@/lib/store";
import { replaceSearch, useUi } from "@/lib/ui";
import { BuySheet } from "./BuySheet";
import { LockNote, PriceTag, RatingBadge } from "./MarketCard";
import { MarketClosed, MarketNote, NOTE_ACTION, useMarketOn } from "./MarketClosed";
import { PreviewGallery } from "./PreviewGallery";
import { MARKET_HOME, benefitsOf, buyReturnPath, languageLabel, levelLabel, sizeLabel, toolTitle } from "./market-model";

/** Section titles shown before «Yana N ta». */
const OUTLINE_SHOWN = 8;
const WIDTH = "max-w-[1120px]";

const PRIMARY =
  "bg-primary text-primary-foreground focus-visible:ring-ring inline-flex min-h-[50px] items-center justify-center gap-2 rounded-[14px] px-5 text-[16px] font-semibold outline-none transition-[filter,transform] duration-150 hover:brightness-105 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:opacity-60 motion-reduce:active:scale-100";
const SECONDARY =
  "bg-card hover:bg-muted focus-visible:ring-ring inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[14px] border px-4 text-[15px] font-semibold outline-none focus-visible:ring-2";

const REPORT_REASONS = [
  { value: "copyright", label: "Mualliflik huquqi" },
  { value: "harmful", label: "Noqonuniy yoki zararli" },
  { value: "quality", label: "Sifati past" },
  { value: "other", label: "Boshqa sabab" },
];

function Facts({ view }: { view: MarketItemView }) {
  const rows: [string, React.ReactNode][] = [
    ["Vosita", toolTitle(view.toolId)],
    ["Hajm", sizeLabel(view) || "—"],
    ["Til", languageLabel(view.language)],
    ["Fan", subjectLabel(view.subject)],
    ["Daraja", levelLabel(view.level)],
  ];
  if (view.soldCount > 0) rows.push(["Olingan", `${groupDigits(view.soldCount)} marta`]);
  if (view.rating) rows.push(["Baho", <RatingBadge key="r" rating={view.rating} />]);
  return (
    <dl data-market-facts className="divide-border divide-y text-[14.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-h-10 items-center justify-between gap-3 py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Benefits({ toolId }: { toolId: string }) {
  return (
    <ul data-market-benefits className="flex flex-col gap-2 text-[14.5px] leading-snug">
      {benefitsOf(toolId).map((b) => (
        <li key={b} className="flex gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {b}
        </li>
      ))}
    </ul>
  );
}

function Outline({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, OUTLINE_SHOWN);
  const rest = items.length - shown.length;
  return (
    <section aria-labelledby="market-outline" className="bg-card rounded-[20px] border p-4 shadow-[var(--shadow-card)]">
      <h3 id="market-outline" className="text-muted-foreground mb-2 text-[13px] font-semibold tracking-[0.06em] uppercase">
        Mundarija
      </h3>
      <ol data-market-outline className="flex flex-col gap-1.5 text-[15px] leading-snug">
        {shown.map((t, i) => (
          <li key={t} className="flex gap-2.5">
            <span aria-hidden className="text-muted-foreground w-5 shrink-0 text-right tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 break-words">{t}</span>
          </li>
        ))}
      </ol>
      {rest > 0 ? (
        <button type="button" data-market-outline-more onClick={() => setAll(true)} className="text-accent-soft-foreground hover:bg-accent-soft focus-visible:ring-ring mt-1.5 -ml-2 min-h-11 rounded-xl px-2.5 text-[14.5px] font-semibold outline-none focus-visible:ring-2">
          Yana {rest} ta bo‘lim
        </button>
      ) : null}
    </section>
  );
}

/** «Shikoyat» (§9): one per user per item, the server counts them; a small quiet control at the end of the page. */
function ReportRow({ id, onNeedLogin }: { id: string; onNeedLogin: () => boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REPORT_REASONS[0]!.value);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") {
    return (
      <p role="status" data-market-report-done className="text-muted-foreground text-[14px]">
        Shikoyatingiz qabul qilindi. Rahmat!
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" data-market-report onClick={() => !onNeedLogin() && setOpen(true)} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-1 text-[14px] outline-none focus-visible:ring-2">
        <Flag className="size-3.5" aria-hidden />
        Shikoyat qilish
      </button>
    );
  }
  const send = async () => {
    setState("busy");
    setError(null);
    try {
      await api.reportMarketItem(id, reason);
      setState("done");
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "Yuborilmadi. Qayta urinib ko‘ring.");
    }
  };
  return (
    <div className="flex flex-col gap-2" data-market-report-form>
      <SelectField ariaLabel="Shikoyat sababi" value={reason} options={REPORT_REASONS} onChange={setReason} />
      {error ? (
        <p role="alert" className="text-destructive text-[14px]">
          {error}
        </p>
      ) : null}
      <button type="button" data-market-report-send disabled={state === "busy"} onClick={() => void send()} className={SECONDARY}>
        Yuborish
      </button>
    </div>
  );
}

/**
 * Item page (§5.3). The server draws it from `initial` (title, summary, outline, facts, previews, nothing of the body:
 * `tests/viewer/market-ssr-leak.test.mts`), then the client asks for the fresh view: `owned` and the live price depend on the
 * viewer. `?buy=1` (the way back from the wallet, §2.4) reopens the confirm sheet once with the fresh price.
 */
export function MarketItemPage({ id, enabled, initial }: { id: string; enabled: boolean; initial: MarketItemView | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const marketOn = useMarketOn();
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const open = useUi((s) => s.open);
  const [view, setView] = useState<MarketItemView | null>(initial);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "closed" | "error">(initial ? "ready" : "loading");
  const [fresh, setFresh] = useState(false);
  const [buy, setBuy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [creating, setCreating] = useState(false);
  const buyAsked = useRef(params?.get("buy") === "1");
  const live = enabled || marketOn;

  const load = useCallback(async () => {
    try {
      const v = await api.marketItem(id);
      setView(v);
      setPhase("ready");
      setFresh(true);
    } catch (e) {
      if (e instanceof api.ApiError && e.status === 503 && e.data.code === "market_disabled") setPhase("closed");
      else if (e instanceof api.ApiError && e.status === 404) setPhase("missing");
      else setPhase((p) => (p === "ready" ? p : "error"));
    }
  }, [id]);

  useEffect(() => {
    if (live && sessionChecked) void load();
  }, [live, sessionChecked, loggedIn, load]);

  /** Signed out: the login, and back here with the sheet open. `true` = handled. */
  const needLogin = useCallback(() => {
    if (loggedIn) return false;
    open("login", { returnTo: buyReturnPath(id) });
    return true;
  }, [id, loggedIn, open]);

  useEffect(() => {
    if (!buyAsked.current || !fresh || !view) return;
    buyAsked.current = false;
    const next = new URLSearchParams(window.location.search);
    next.delete("buy");
    replaceSearch(next);
    if (view.status === "active" && !view.owned && !needLogin()) setBuy(true);
  }, [fresh, needLogin, view]);

  const openFile = useCallback((generationId: string) => router.push(`/uz/files/${generationId}`), [router]);

  const restore = async (purchaseId: string) => {
    setRestoring(true);
    setNote(null);
    try {
      const r = await api.restoreMarketPurchase(purchaseId);
      openFile(r.generationId);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Tiklab bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      setRestoring(false);
    }
  };

  /** M10: the original tool at full price, its form opened on this topic (through the tool's own draft). */
  const createNew = async (e: React.MouseEvent, tool: MarketItemView["toolId"], { slug, topic }: MarketItemView["createTool"]) => {
    e.preventDefault();
    if (!loggedIn) {
      open("login", { returnTo: `/uz/${slug}` });
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const cur = await api.getDraft(tool);
      await api.putDraft(tool, { ...(cur.draft?.data ?? {}), topic });
    } catch {
      // No draft: the form opens empty, the link still does its job.
    }
    router.push(`/uz/${slug}`);
  };

  if (phase === "closed" || !live) return <MarketClosed />;

  if (!view) {
    return (
      <div className="flex w-full flex-col" data-market-item="empty">
        <PageHeader back backFallback={MARKET_HOME} title="Ishlar bozori" contentClassName={WIDTH} />
        {phase === "loading" ? (
          <div className={cn("mx-auto grid w-full gap-5 px-4 lg:grid-cols-[minmax(0,1fr)_22.5rem]", WIDTH)} data-market-item-skeleton aria-hidden>
            <div className="bg-muted slx-shimmer aspect-[5/6] rounded-[22px] sm:aspect-[6/5]" />
            <div className="flex flex-col gap-3">
              <div className="bg-muted slx-shimmer h-7 w-4/5 rounded-lg" />
              <div className="bg-muted slx-shimmer h-10 w-1/2 rounded-lg" />
              <div className="bg-muted slx-shimmer h-[50px] rounded-[14px]" />
            </div>
          </div>
        ) : phase === "error" ? (
          <MarketNote
            title="Ish yuklanmadi"
            text="Aloqani tekshirib, qayta urinib ko‘ring."
            action={
              <button type="button" onClick={() => void load()} className={NOTE_ACTION}>
                Qayta urinish
              </button>
            }
          />
        ) : (
          <MarketNote
            title="Bu ish topilmadi"
            text="Ish sotuvdan olingan bo‘lishi mumkin. Bozorda o‘xshash ishlarni qidirib ko‘ring."
            action={
              <Link href={MARKET_HOME} className={NOTE_ACTION}>
                Bozorga qaytish
              </Link>
            }
          />
        )}
      </div>
    );
  }

  const owned = view.owned;
  const soldOut = view.status === "sold_out" || phase === "missing";
  const onBuy = () => {
    if (!sessionChecked || needLogin()) return;
    setNote(null);
    setBuy(true);
  };

  /** One decision for the buy card and the phone bar. */
  const action = (className: string) =>
    owned ? (
      owned.generationId ? (
        <Link href={`/uz/files/${owned.generationId}`} data-market-open-owned className={cn(PRIMARY, className)}>
          <FolderOpen className="size-5" aria-hidden />
          Ishlarimda ochish
        </Link>
      ) : (
        <button type="button" data-market-restore disabled={restoring} onClick={() => void restore(owned.purchaseId)} className={cn(PRIMARY, className)}>
          {restoring ? "Tiklanmoqda…" : "Qayta tiklash"}
        </button>
      )
    ) : soldOut ? (
      <span data-market-unavailable className={cn("bg-muted text-muted-foreground inline-flex min-h-[50px] items-center justify-center rounded-[14px] px-5 text-[16px] font-semibold", className)}>
        Sotuvda yo‘q
      </span>
    ) : (
      <button type="button" data-market-buy onClick={onBuy} className={cn(PRIMARY, className)}>
        Sotib olish
      </button>
    );

  const createLink = (
    <Link href={`/uz/${view.createTool.slug}`} data-market-create onClick={(e) => void createNew(e, view.toolId, view.createTool)} aria-busy={creating} className={SECONDARY}>
      <Sparkles className="text-primary size-4" aria-hidden />
      Shu mavzuda yangi yaratish
    </Link>
  );

  return (
    <div className="flex w-full flex-col" data-market-item={view.id}>
      <PageHeader back backFallback={MARKET_HOME} title={toolTitle(view.toolId)} subtitle={subjectLabel(view.subject)} contentClassName={WIDTH} />
      <div className={cn("mx-auto grid w-full grid-cols-1 gap-5 px-4 pt-1 pb-5 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:gap-6", WIDTH)}>
        <div className="flex min-w-0 flex-col gap-4">
          <PreviewGallery view={view} />
          <div className="lg:hidden">
            <TitleBlock view={view} />
          </div>
          {view.summary ? (
            <section aria-label="Ish haqida" className="text-foreground/90 px-0.5 text-[15.5px] leading-relaxed break-words" data-market-summary>
              {view.summary}
            </section>
          ) : null}
          <Outline items={view.outline} />
        </div>

        <aside aria-label="Xarid" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[5.25rem] lg:self-start">
          <div className="bg-card flex flex-col gap-3 rounded-[20px] border p-4 shadow-[var(--shadow-card)]">
            <div className="hidden flex-col gap-3 lg:flex">
              <TitleBlock view={view} />
            </div>
            <div className="hidden lg:contents">{action("w-full")}</div>
            {note ? (
              <p role="alert" data-market-note-line className="text-destructive text-[14.5px] leading-snug">
                {note}
              </p>
            ) : null}
            {owned ? null : <LockNote className="text-muted-foreground text-[13.5px]">Sotib olingach, to‘liq matn ochiladi</LockNote>}
            <Benefits toolId={view.toolId} />
          </div>
          <div className="bg-card rounded-[20px] border px-4 py-2 shadow-[var(--shadow-card)]">
            <Facts view={view} />
          </div>
          {createLink}
          <ReportRow id={view.id} onNeedLogin={needLogin} />
        </aside>
      </div>

      <div
        data-market-buybar
        className="bg-card sticky bottom-[calc(var(--tabbar-h,0px)+var(--tg-safe-bottom,env(safe-area-inset-bottom,0px))+0.5rem)] z-10 mx-3 mb-2 flex items-center gap-3 rounded-[18px] border p-2.5 pl-3.5 shadow-[var(--shadow-bar)] lg:hidden"
      >
        {owned ? null : <PriceTag card={view} className="flex-1" />}
        {action(owned ? "w-full" : "shrink-0")}
      </div>

      {buy ? (
        <BuySheet
          view={view}
          onClose={() => setBuy(false)}
          onDone={openFile}
          onPrice={(price) => setView((v) => (v ? { ...v, price } : v))}
          onOwned={(generationId) => {
            setBuy(false);
            if (generationId) openFile(generationId);
            else void load();
          }}
          onGone={(message) => {
            setBuy(false);
            setNote(message);
            setView((v) => (v ? { ...v, status: "sold_out" } : v));
          }}
          onClosed={() => {
            setBuy(false);
            setPhase("closed");
          }}
        />
      ) : null}
    </div>
  );
}

function TitleBlock({ view }: { view: MarketItemView }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 data-market-item-title className="text-foreground text-[22px] leading-[1.25] font-bold tracking-[-0.01em] break-words">
        {view.title}
      </h2>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px]">
        <RatingBadge rating={view.rating} className="text-foreground font-medium" />
        {view.soldCount > 0 ? (
          <span className="inline-flex items-center gap-1">
            <TrendingUp className="size-3.5" aria-hidden />
            {groupDigits(view.soldCount)} marta olingan
          </span>
        ) : null}
      </div>
      <PriceTag card={view} size="hero" />
    </div>
  );
}

