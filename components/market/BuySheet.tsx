"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { Coins, TriangleAlert } from "lucide-react";
import { ChannelGate } from "@/components/forms/ChannelGate";
import { AuthorRows, type AuthorFieldId } from "@/components/forms/shared";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "@/components/overlays/OverlayFrame";
import { useDialog } from "@/components/overlays/useDialog";
import * as api from "@/lib/api-client";
import { useChannelGate } from "@/lib/channel-gate";
import { cn } from "@/lib/cn";
import { formatSom } from "@/lib/format";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { MarketItemView, PurchaseFields } from "@/lib/market/types";
import { creditTotal, useAppStore } from "@/lib/store";
import type { FormValues } from "@/lib/types";
import {
  BUYER_LABELS,
  MARKET_HOME,
  buyReturnPath,
  buyerFieldIds,
  buyerLabelOverrides,
  missingBuyerFields,
  purchaseFields,
  purchaseProblem,
  toolTitle,
  walletReturnHref,
  type PurchaseProblem,
} from "./market-model";
import { forgetMarketReturn, rememberMarketReturn } from "./market-return";

/** The profile fills the form; a name that is only a phone number is not a name for a title page. */
function profileFields(user: api.ServerUser | null): PurchaseFields {
  const name = user?.author || (user?.name && !/\d/.test(user.name) ? user.name : "");
  return {
    author: name ?? "",
    university: user?.university ?? "",
    faculty: user?.faculty ?? "",
    department: user?.department ?? "",
    group: user?.group ?? "",
    course: user?.course ?? "",
    teacher: user?.teacher ?? "",
    city: user?.city || "Toshkent",
  };
}

const TOP_UP =
  "bg-primary text-primary-foreground focus-visible:ring-ring mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[14px] px-4 text-[15.5px] font-semibold outline-none hover:brightness-105 focus-visible:ring-2";

function Note({ tone, children }: { tone: "warn" | "error"; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      data-buy-note={tone}
      className={cn(
        "mt-3 flex gap-2.5 rounded-[14px] border px-3.5 py-2.5 text-[14.5px] leading-snug",
        tone === "warn" ? "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200" : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * «Titul sahifasi» (§5.3): the buyer's own title-page fields, prefilled from the profile, and the confirmation at the price
 * the server last said. The Idempotency-Key is per confirmed click: a lost answer retries with the same key (never a second
 * charge), a definite refusal gets a new one. Every refusal keeps the sheet open with what to do next.
 */
export function BuySheet({
  view,
  onClose,
  onDone,
  onPrice,
  onOwned,
  onGone,
  onClosed,
}: {
  view: MarketItemView;
  onClose: () => void;
  onDone: (generationId: string) => void;
  /** 409 `price_changed`: the page shows the new price too. */
  onPrice: (price: number) => void;
  onOwned: (generationId: string | null) => void;
  onGone: (message: string) => void;
  onClosed: () => void;
}) {
  const panelRef = useDialog(true, onClose);
  const phone = useCoarsePointer();
  const user = useAppStore((s) => s.user);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const gated = useChannelGate((s) => s.gate !== null);
  const [values, setValues] = useState<PurchaseFields>(() => profileFields(user));
  const [problem, setProblem] = useState<PurchaseProblem | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useRef<string | null>(null);

  const ids = useMemo(() => buyerFieldIds(view.toolId, view.requiredFields), [view.toolId, view.requiredFields]);
  const labels = buyerLabelOverrides(view.toolId);
  const missing = missingBuyerFields(values, view.requiredFields);
  const price = view.price;
  const total = creditTotal(user);
  const short = user !== null && price > total;
  const insufficient = problem?.kind === "insufficient" ? problem : null;
  const needTopUp = short || insufficient !== null;

  // The balance may have changed in the wallet: the check above reads the fresh one.
  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  async function confirm() {
    if (inFlight.current) return;
    if (missing.length) {
      setShowMissing(true);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    const idem = (key.current ??= api.marketPurchaseKey());
    try {
      const res = await api.purchaseMarketItem(view.id, { expectedPrice: price, fields: purchaseFields(values, ids) }, idem);
      forgetMarketReturn();
      void refreshSession();
      void refreshGenerations();
      onDone(res.generationId);
    } catch (e) {
      const p = purchaseProblem(e);
      if (!(p.kind === "error" && p.retrySameKey)) key.current = null;
      if (p.kind === "price_changed") onPrice(p.price);
      if (p.kind === "already_owned") onOwned(p.generationId);
      else if (p.kind === "gone") onGone(p.message);
      else if (p.kind === "closed") onClosed();
      else setProblem(p);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const required = view.requiredFields.filter((k) => ids.includes(k as keyof PurchaseFields)) as AuthorFieldId[];

  return createPortal(
    <OverlayFrame label="Titul sahifasi" phone={phone} sheet className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}>
      <OverlayScrim onClose={onClose} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? undefined : "max-w-md"}>
        <div data-market-buy-sheet>
          <OverlayHeader title="Titul sahifasi" phone={phone} onClose={onClose} />
          <p className="text-muted-foreground mt-1 text-[14.5px] leading-snug">
            {toolTitle(view.toolId)}ga o‘z ma’lumotlaringiz yoziladi. Ular faqat sizning nusxangizda turadi.
          </p>
          <div className="mt-2 grid grid-cols-1">
            <AuthorRows ids={ids} values={values as FormValues} set={(id, v) => setValues((s) => ({ ...s, [id]: v }))} required={required} labels={labels} />
          </div>

          {showMissing && missing.length ? (
            <Note tone="error">
              <span data-buy-missing>To‘ldiring: {missing.map((k) => labels[k] ?? BUYER_LABELS[k]).join(", ")}</span>
            </Note>
          ) : null}
          {problem?.kind === "price_changed" ? (
            <Note tone="warn">
              <span data-buy-price-changed>Narx o‘zgardi: endi {formatSom(problem.price)}. Yangi narxni tasdiqlang.</span>
            </Note>
          ) : null}
          {problem?.kind === "university_cap" ? (
            <Note tone="warn">
              <span data-buy-cap>{problem.message}</span>{" "}
              <Link href={`${MARKET_HOME}?q=${encodeURIComponent(view.title.slice(0, 100))}`} className="font-semibold underline underline-offset-2">
                O‘xshash ishlar
              </Link>
            </Note>
          ) : null}
          {problem?.kind === "paused" || problem?.kind === "error" ? (
            <Note tone="error">
              <span data-buy-error>{problem.message}</span>
            </Note>
          ) : null}
          {problem?.kind === "channel" && !gated ? (
            <Note tone="warn">
              <span>{problem.message}</span>
            </Note>
          ) : null}
          <div className="mt-3 empty:hidden">
            <ChannelGate />
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 text-[14.5px]" data-buy-balance>
              <Coins className="text-primary size-4 shrink-0" aria-hidden />
              <span className="truncate">Balans: {formatSom(total)}</span>
            </span>
            <span className="text-[15px] font-semibold tabular-nums">{formatSom(price)}</span>
          </div>

          {needTopUp ? (
            <div data-buy-topup className="mt-2 rounded-[14px] border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-[14.5px] leading-snug text-amber-900 dark:text-amber-200">
                Balans yetarli emas{insufficient?.required != null ? `: kerak ${formatSom(insufficient.required)}` : ""}
                {insufficient?.available != null ? `, mavjud ${formatSom(insufficient.available)}` : ""}. To‘ldirgach, shu yerga qaytasiz.
              </p>
              <Link href={walletReturnHref(view.id)} data-buy-topup-link onClick={() => rememberMarketReturn(buyReturnPath(view.id))} className={TOP_UP}>
                Balansni to‘ldirish
              </Link>
            </div>
          ) : (
            <button
              type="button"
              data-buy-confirm
              disabled={busy || gated}
              onClick={() => void confirm()}
              className="bg-primary text-primary-foreground focus-visible:ring-ring mt-2 inline-flex min-h-[50px] w-full items-center justify-center rounded-[14px] px-4 text-[16px] font-semibold outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:opacity-60"
            >
              {busy ? "Rasmiylashtirilmoqda…" : `Tasdiqlash — ${formatSom(price)}`}
            </button>
          )}
        </div>
      </OverlayPanel>
    </OverlayFrame>,
    document.body,
  );
}
