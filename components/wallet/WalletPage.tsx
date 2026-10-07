"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Gift, LogIn, Plus } from "lucide-react";
import * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatPoints } from "@/lib/referral";
import { creditTotal, useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { ReferralCard } from "../profile/ReferralCard";
import { PaymentBanner } from "./PaymentBanner";
import { usePaymentReturn } from "./usePaymentReturn";
import { TOPUP_FEATURES, formatWhen, ledgerRow, orderStateLabel, providerLabel } from "./wallet-model";

/** Where the login returns to (the lead routes `/uz/wallet`; `/uz/purchase` redirects here keeping `?order=`). */
export const WALLET_PATH = "/uz/wallet";
/** Ledger rows shown before «Hammasini ko'rsatish» (the API returns the last 30). */
const LEDGER_FIRST = 8;
const ORDERS_SHOWN = 6;

/** Variant A hero: F0's `--hero` gradient when present, the same amber gradient before F0 merges. */
const HERO_STYLE = {
  background: "var(--hero, linear-gradient(135deg, #f59e0b, #ea7a0a))",
  color: "var(--hero-foreground, #1c1406)",
  boxShadow: "0 16px 32px -20px rgba(234, 122, 10, 0.75)",
} as const;

const sectionLabel = "text-muted-foreground mx-0.5 mt-7 mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase";
const card = "bg-card rounded-[20px] border";
const focusRing = "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";
const heroFocus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c1406]";

/**
 * «Hamyon» tab content (redesign W3, variant A): balance hero, the payment
 * return banner (`?order=`), the ledger («Harakatlar»), recent payments and the
 * referral card. No page header — the shell's `PageHeader` «Hamyon» wraps it.
 *
 * «To'ldirish» opens the existing `PayDialog` (amount presets + Click/Payme live
 * there, unchanged), exactly like `PurchasePage`.
 */
export function WalletPage() {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);
  const pay = usePaymentReturn();

  const toReferral = useCallback(() => {
    const el = document.getElementById("wallet-referral");
    if (!el) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView?.({ behavior: still ? "auto" : "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, []);

  const ready = sessionChecked && loggedIn && !!user;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 text-[15.5px]" data-wallet>
      <PaymentBanner pay={pay} className="mb-4" />

      {!sessionChecked || (loggedIn && !user) ? (
        <section
          data-wallet-hero="loading"
          aria-busy="true"
          aria-label="Balans yuklanmoqda"
          className="rounded-[24px] p-[18px]"
          style={HERO_STYLE}
        >
          <div className="h-4 w-16 rounded bg-black/10 motion-safe:animate-pulse" />
          <div className="mt-3 h-10 w-48 rounded-lg bg-black/10 motion-safe:animate-pulse" />
          <div className="mt-3 h-4 w-40 rounded bg-black/10 motion-safe:animate-pulse" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="h-12 rounded-[14px] bg-black/10" />
            <div className="h-12 rounded-[14px] bg-black/10" />
          </div>
        </section>
      ) : !loggedIn ? (
        <section data-wallet-hero="signed-out" aria-labelledby="wallet-hero-title" className="rounded-[24px] p-[18px]" style={HERO_STYLE}>
          <h2 id="wallet-hero-title" className="text-[19px] font-bold tracking-[-0.01em]">
            Hamyoningiz shu yerda
          </h2>
          <p className="mt-1.5 text-[15.5px] leading-snug opacity-85">
            Balansni ko&apos;rish, to&apos;ldirish va do&apos;stlarni taklif qilish uchun tizimga kiring.
          </p>
          <button
            type="button"
            onClick={() => open("login", { returnTo: WALLET_PATH })}
            className={cn(
              "bg-background text-foreground mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-[15.5px] font-semibold active:scale-[0.98] motion-reduce:transform-none sm:w-auto sm:px-8",
              heroFocus,
            )}
          >
            <LogIn className="size-[18px]" aria-hidden="true" />
            Kirish
          </button>
        </section>
      ) : (
        <section data-wallet-hero="ready" aria-labelledby="wallet-hero-title" className="rounded-[24px] p-[18px]" style={HERO_STYLE}>
          <h2 id="wallet-hero-title" className="text-[14px] font-medium opacity-85">
            Balans
          </h2>
          <p className="mt-1 text-[40px] leading-[1.1] font-bold tracking-[-0.03em] tabular-nums" data-wallet-total>
            {formatPoints(creditTotal(user))} <span className="text-[18px] font-semibold tracking-normal">tanga</span>
          </p>
          <p className="mt-1 text-[14px] opacity-85 tabular-nums" data-wallet-split>
            {user!.points > 0
              ? `Shundan ${formatPoints(user!.points)} ball — bonus`
              : "Bonus ball yo'q — do'st taklif qiling"}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => open("pay")}
              data-wallet-topup
              className={cn(
                "bg-background text-foreground inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-[14px] px-2 text-[15.5px] font-semibold shadow-sm transition-transform active:scale-[0.98] motion-reduce:transform-none",
                heroFocus,
              )}
            >
              <Plus className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="truncate">To&apos;ldirish</span>
            </button>
            <button
              type="button"
              onClick={toReferral}
              data-wallet-invite
              className={cn(
                "inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-[14px] bg-[rgba(28,20,6,0.12)] px-2 text-[15px] font-semibold transition-[background-color,transform] hover:bg-[rgba(28,20,6,0.18)] active:scale-[0.98] motion-reduce:transform-none",
                heroFocus,
              )}
            >
              <Gift className="size-[18px] shrink-0" aria-hidden="true" />
              <span className="truncate">Do&apos;st taklif qilish</span>
            </button>
          </div>
        </section>
      )}

      {ready ? (
        <>
          <Ledger paidOrder={pay.orderState === "paid" ? pay.orderId : null} />
          <Orders orders={pay.orders} />
          <h2 className={sectionLabel}>Do&apos;stlar</h2>
          <div id="wallet-referral" tabIndex={-1} className="scroll-mt-4 rounded-[20px] focus:outline-none">
            <ReferralCard className="" />
          </div>
        </>
      ) : null}

      <h2 className={sectionLabel}>To&apos;lov haqida</h2>
      <ul className={cn(card, "space-y-2.5 px-4 py-4 text-[15px]")} data-wallet-features>
        {TOPUP_FEATURES.map((f) => (
          <li key={f} className="flex gap-2.5">
            <Check className="text-primary mt-0.5 size-[18px] shrink-0" aria-hidden="true" />
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «Harakatlar»: the last 30 ledger entries from `GET /api/users/me` (also refreshes the store user). */
function Ledger({ paidOrder }: { paidOrder: string | null }) {
  const setUser = useAppStore((s) => s.setUser);
  const [entries, setEntries] = useState<api.LedgerEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    api
      .fetchMe()
      .then((r) => {
        setUser(r.user);
        setEntries(r.transactions);
      })
      .catch(() => setFailed(true));
  }, [setUser]);

  // Again after a payment lands: the top-up row appears without a reload.
  useEffect(() => {
    load();
  }, [load, paidOrder]);

  const rows = useMemo(() => {
    const now = Date.now();
    return (entries ?? []).map((e) => ledgerRow(e, now));
  }, [entries]);
  const shown = all ? rows : rows.slice(0, LEDGER_FIRST);

  return (
    <section aria-labelledby="wallet-ledger-title">
      <h2 id="wallet-ledger-title" className={sectionLabel}>
        Harakatlar
      </h2>
      {failed && !entries ? (
        <div className={cn(card, "px-4 py-4")} data-wallet-ledger="error">
          <p className="text-muted-foreground text-[15px]">Harakatlar yuklanmadi.</p>
          <button type="button" onClick={load} className={cn("hover:bg-muted mt-3 h-11 rounded-xl border px-4 text-[15px] font-medium", focusRing)}>
            Qayta urinish
          </button>
        </div>
      ) : !entries ? (
        <div className={cn(card, "space-y-4 px-4 py-4")} aria-busy="true" aria-label="Yuklanmoqda" data-wallet-ledger="loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="bg-muted h-4 w-3/5 rounded motion-safe:animate-pulse" />
                <div className="bg-muted h-3 w-1/3 rounded motion-safe:animate-pulse" />
              </div>
              <div className="bg-muted h-4 w-16 rounded motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
      ) : !rows.length ? (
        <p className={cn(card, "text-muted-foreground px-4 py-5 text-[15px]")} data-wallet-ledger="empty">
          Hali harakat yo&apos;q. Hujjat yaratganingizda yoki balansni to&apos;ldirganingizda shu yerda ko&apos;rinadi.
        </p>
      ) : (
        <div className={card} data-wallet-ledger="ready">
          <ul className="divide-y px-4">
            {shown.map((r) => (
              <li key={r.id} className="flex min-h-[60px] items-center gap-3 py-2.5" data-ledger-row={r.kind}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15.5px] font-medium" title={r.title} data-ledger-title>
                    {r.title}
                  </p>
                  <p className="text-muted-foreground mt-0.5 truncate text-[13px]">{r.meta}</p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-right text-[15.5px] tabular-nums",
                    r.tone === "in" ? "font-semibold text-[var(--success-text)]" : "text-foreground",
                  )}
                  data-ledger-amount={r.tone}
                >
                  {r.amount}
                  <span className={cn("ml-1 text-[13px] font-medium", r.tone === "in" ? "" : "text-muted-foreground")} data-ledger-unit>
                    {r.unit}
                  </span>
                </p>
              </li>
            ))}
          </ul>
          {rows.length > LEDGER_FIRST ? (
            <div className="border-t px-2 py-1.5">
              <button
                type="button"
                onClick={() => setAll((v) => !v)}
                aria-expanded={all}
                className={cn("hover:bg-muted text-amber-800 dark:text-amber-300 h-11 w-full rounded-xl text-[15px] font-medium", focusRing)}
              >
                {all ? "Kamroq ko'rsatish" : `Hammasini ko'rsatish (${rows.length})`}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Recent payment orders (as `PurchasePage` «Oxirgi to'lovlar» shows them). */
function Orders({ orders }: { orders: api.PaymentOrder[] | null }) {
  if (!orders?.length) return null;
  const now = Date.now();
  return (
    <section aria-labelledby="wallet-orders-title">
      <h2 id="wallet-orders-title" className={sectionLabel}>
        To&apos;lovlar
      </h2>
      <ul className={cn(card, "divide-y px-4")} data-wallet-orders>
        {orders.slice(0, ORDERS_SHOWN).map((o) => (
          <li key={o.id} className="flex min-h-[60px] items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15.5px] font-medium tabular-nums">
                {providerLabel(o.provider)} · {formatPoints(o.amountSoum)} so&apos;m
              </p>
              <p className="text-muted-foreground mt-0.5 text-[13px]">{formatWhen(o.createdAt, now)}</p>
            </div>
            <span
              data-order-state={o.state}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[13px] font-semibold",
                o.state === "paid"
                  ? "bg-emerald-500/12 text-[var(--success-text)]"
                  : o.state === "cancelled"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {orderStateLabel(o.state)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
