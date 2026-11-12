"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useNav } from "@/components/nav/NavProvider";
import { useOverlayHistory } from "@/components/nav/useOverlayHistory";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { openClickApp } from "@/lib/open-click-app";
import { paynetPayLink } from "@/lib/paynet-link";
import type { ClickMethod } from "@/lib/click-input";
import { topupAmountError } from "@/lib/topup-limits";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayClose, OverlayFrame, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { PAY_RETURN_PATH, usePayAmount } from "./pay-amount";
import { useDialog } from "./useDialog";
import { AmountStep } from "./pay/AmountStep";
import { CardStep } from "./pay/CardStep";
import { PhoneStep } from "./pay/PhoneStep";
import { PaynetStep } from "./pay/PaynetStep";
import { MethodList, enabledPayMethods, payMethod, type PayMethodId } from "./pay/methods";
import { WaitStep, type WaitSource } from "./pay/WaitStep";
import { textBtn } from "./pay/ui";

export { TOPUP_PRESETS, PAY_RETURN_PATH, openPay } from "./pay-amount";

type View = "choose" | "amount" | "card" | "phone" | "wait" | "paynet";

type ClickOrder = { id: string; amount: number; method: ClickMethod; checkoutUrl: string };

const TITLES: Record<View, string> = {
  choose: "Balansni to'ldirish",
  amount: "Balansni to'ldirish",
  card: "Karta orqali to'lash",
  phone: "Telefon raqam orqali",
  wait: "To'lov",
  paynet: "Paynet orqali to'lash",
};

/** The deepest wizard: chooser → Summa → card → (wait replaces card). One history entry per step above the first. */
const MAX_DEPTH = 4;

/**
 * The top-up sheet (owner 2026-11-12: «to'ldirish usullari», then a short wizard).
 *
 * Muhim: bu dialog **kredit qo'shmaydi**. U buyurtma yaratadi va to'lovni boshlaydi; hisob FAQAT
 * Click/Payme webhook'i (Paynet: o'z chaqiruvi) tasdiqlagandan keyin to'ladi.
 *
 *  - Opened from a wallet method row (`openPay({ method })`) it starts at «Summa»; opened any other way
 *    (`open("pay")`, the hero «To'ldirish») it starts at the method chooser — the same list
 *    (`pay/methods.tsx`), only the methods the server switched on.
 *  - «Summa» (`AmountStep`): EMPTY unless a context opener suggested an amount (`openPay({ amount })`).
 *  - Then per method, with the existing API calls unchanged: Click app → order (`method: "app"`) + the
 *    deeplink (`openClickApp`) → waiting; card → `CardStep` → waiting; phone → `PhoneStep` → waiting;
 *    plain Click / Payme → the provider page (`navigateFromOverlay`, replace); «Click sahifasi orqali»
 *    stays as the fallback under the Click methods' «Davom etish». Paynet → `PaynetStep` (ID first; the
 *    app opens only on its button; no order).
 *  - Each step above the first owns a history entry (`useOverlayHistory`), so the phone's Back / Telegram
 *    BackButton steps back one step, then closes; the header arrow does the same. Focus goes to the first
 *    field of each step and back to the chosen row on return.
 *
 * Redesign W5 (variant A): telefonda pastki varaq, kompyuterda markazdagi dialog.
 */
export function PayDialog() {
  const open = useUi((s) => s.overlay === "pay");
  const close = useUi((s) => s.close);
  const openUi = useUi((s) => s.open);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);
  const user = useAppStore((s) => s.user);

  const amount = usePayAmount((s) => s.amount);
  const setAmount = usePayAmount((s) => s.setAmount);
  const method = usePayAmount((s) => s.method);
  const setMethod = usePayAmount((s) => s.setMethod);
  const bonusPercent = usePayAmount((s) => s.bonusPercent);

  /** The wizard's steps; empty = not started (the first step follows from `method` at open). */
  const [stack, setStack] = useState<View[]>([]);
  const [order, setOrder] = useState<ClickOrder | null>(null);
  const [source, setSource] = useState<WaitSource>("card");
  const [waitInitial, setWaitInitial] = useState<"polling" | "paid">("polling");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useDialog(open, close);
  const nav = useNav();
  /** Telefon (docs/mobile/PLAN.md O5): 44 px tugmalar, ekranga sig'adi va ichida aylanadi. */
  const phone = useCoarsePointer();

  const methods = enabledPayMethods(features?.payments);
  /** Only a method the server has switched on (a stale `openPay({ method })` falls back to the chooser). */
  const chosen = method && methods.some((m) => m.id === method) ? payMethod(method) : null;
  const views: View[] = stack.length ? stack : [chosen ? "amount" : "choose"];
  const view = views[views.length - 1]!;
  const depth = views.length;

  const popTo = (n: number) => {
    setError(null);
    setBusy(null);
    setStack((s) => (s.length > n ? s.slice(0, n) : s));
  };
  // Phone Back / Telegram BackButton: one step back per press; the dialog's own entry (useDialog) closes it.
  useOverlayHistory(open && depth >= 2, () => popTo(1));
  useOverlayHistory(open && depth >= 3, () => popTo(2));
  useOverlayHistory(open && depth >= MAX_DEPTH, () => popTo(3));

  // Closed: forget the step, the order and the amount — the next open starts fresh (empty amount, chooser).
  useEffect(() => {
    if (open) return;
    setStack([]);
    setOrder(null);
    setError(null);
    setBusy(null);
    setWaitInitial("polling");
    usePayAmount.setState({ amount: 0, method: null });
  }, [open]);

  // Focus per step: the row the user came back to, else the step's first field (after useDialog's own focus).
  const prevDepth = useRef(0);
  useEffect(() => {
    if (!open) {
      prevDepth.current = 0;
      return;
    }
    const back = depth < prevDepth.current;
    prevDepth.current = depth;
    const t = setTimeout(() => {
      const panel = panelRef.current;
      const step = panel?.querySelector<HTMLElement>("[data-pay-step]");
      if (!panel || !step) return;
      const target =
        (back && method ? step.querySelector<HTMLElement>(`[data-pay-method="${method}"]`) : null) ??
        step.querySelector<HTMLElement>("[data-autofocus]") ??
        step.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), a[href]");
      target?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [open, view, depth, method, panelRef]);

  if (!open) return null;

  const push = (v: View) => setStack([...views, v]);
  const replaceTop = (v: View) => setStack([...views.slice(0, -1), v]);
  const stepBack = () => popTo(depth - 1);

  const amountErr = topupAmountError(amount);

  const paynetBase = features?.payments.paynetUrl ?? null;
  /** Prefill (`PAYNET_APP_PREFILL`) is switched on only after the `c`/`a` link params were checked in the real app. */
  const paynetPrefill = features?.payments.paynetPrefill === true;
  /** The app link: with the payer id and the amount when prefill is on and the amount is valid, else the bare merchant link. */
  const paynetLink = paynetBase && user && paynetPrefill && !amountErr ? paynetPayLink(paynetBase, user.id, amount) : paynetBase;

  function needLogin(): boolean {
    if (loggedIn) return false;
    openUi("login", { returnTo: PAY_RETURN_PATH });
    return true;
  }

  /** Provayder sahifasiga o'tish: Payme, Click sahifasi (zaxira) va Merchant API'siz oddiy «Click». */
  async function payViaPage(provider: "click" | "payme", key: string) {
    if (needLogin() || amountErr) return;
    setError(null);
    setBusy(key);
    try {
      const { checkoutUrl } = await api.createOrder({ provider, amount, ...(provider === "click" ? { method: "page" as const } : {}) });
      // Provayder sahifasi — qaytganda `/uz/purchase?order=...` ochiladi va u `/uz/wallet?order=...` ga
      // yo'naltiradi. Dialog tarix yozuvi avval olib tashlanadi: aks holda provayderdan «orqaga» o'lik
      // (dialogsiz) yozuvga tushardi. `replace`: `?order=` dan «orqaga» provayderga qaytmaydi.
      nav.navigateFromOverlay(checkoutUrl, { external: "replace" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "To'lov boshlanmadi");
      setBusy(null);
    }
  }

  /** Click'ning uch to'g'ridan-to'g'ri usuli: buyurtma (summa/usul o'zgarmasa qayta ishlatiladi) + keyingi qadam. */
  async function startDirect(m: Exclude<ClickMethod, "page">) {
    if (needLogin() || amountErr) return;
    setError(null);
    setBusy(m);
    try {
      let o = order;
      if (!o || o.amount !== amount || o.method !== m) {
        const r = await api.createOrder({ provider: "click", amount, method: m });
        o = { id: r.order.id, amount, method: m, checkoutUrl: r.checkoutUrl };
        setOrder(o);
      }
      if (m === "card") push("card");
      else if (m === "phone") push("phone");
      else {
        // Deeplink: Telegram'da tashqi (openLink), boshqa joyda oddiy o'tish. Dialog kuzatishda qoladi.
        openClickApp(o.checkoutUrl);
        setSource("app");
        setWaitInitial("polling");
        push("wait");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "To'lov boshlanmadi");
    } finally {
      setBusy(null);
    }
  }

  function continueFromAmount() {
    if (!chosen) return;
    switch (chosen.id) {
      case "app":
      case "card":
      case "phone":
        void startDirect(chosen.id);
        return;
      case "click":
        void payViaPage("click", "click");
        return;
      case "payme":
        void payViaPage("payme", "payme");
        return;
      case "paynet":
        // `user` (the ID shown) can still be loading right after sign-in: stay rather than open an empty step.
        if (needLogin() || amountErr || !user) return;
        setError(null);
        push("paynet");
        return;
    }
  }

  const pick = (id: PayMethodId) => {
    setError(null);
    setMethod(id);
    push("amount");
  };

  // The step indicator: «Summa» + the method's own steps; the chooser is not a numbered step.
  const stepNames = chosen ? ["Summa", ...chosen.steps] : [];
  const stepIndex = view === "amount" ? 0 : view === "wait" ? stepNames.length - 1 : 1;
  const clickDirect = chosen?.id === "app" || chosen?.id === "card" || chosen?.id === "phone";

  return (
    <OverlayFrame
      label="Balansni to'ldirish"
      phone={phone}
      sheet
      className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}
    >
      <OverlayScrim onClose={close} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? undefined : "max-w-md"}>
        <div className="flex items-center gap-1" data-overlay-header>
          {depth > 1 ? (
            <button
              type="button"
              onClick={stepBack}
              data-pay-back
              aria-label="Oldingi qadamga qaytish"
              className={cn(
                "text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring -ml-2 flex shrink-0 items-center justify-center rounded-[14px] outline-none transition-colors focus-visible:ring-2",
                phone ? "size-11" : "size-10",
              )}
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-[19px] leading-tight font-bold tracking-[-0.01em]">{TITLES[view]}</h2>
          <OverlayClose onClose={close} phone={phone} className="-mr-2" />
        </div>

        <div className="mt-1 mb-4 min-h-8" data-pay-progress>
          {view !== "choose" && stepNames.length ? (
            <ol className="flex gap-1.5" aria-label={`${stepIndex + 1}-qadam, jami ${stepNames.length}`}>
              {stepNames.map((name, i) => (
                <li key={`${name}-${i}`} className="min-w-0 flex-1" aria-current={i === stepIndex ? "step" : undefined}>
                  <span className={cn("block h-1 rounded-full", i <= stepIndex ? "bg-primary" : "bg-muted")} aria-hidden="true" />
                  <span
                    className={cn(
                      "mt-1 block truncate text-[12px] leading-tight",
                      i === stepIndex ? "text-foreground font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {name}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-[14.5px] leading-snug">To&apos;lov usulini tanlang — balans to&apos;lov tasdiqlangach to&apos;ldiriladi.</p>
          )}
        </div>

        {view === "choose" ? (
          <div data-pay-step="choose">
            {methods.length ? (
              <div data-pay-methods>
                <MethodList methods={methods} hook="pay" onPick={pick} />
              </div>
            ) : (
              <p className="rounded-[14px] bg-amber-500/10 px-3.5 py-2.5 text-[13.5px] leading-snug text-amber-800 dark:text-amber-300" data-pay-none>
                To&apos;lov provayderi hali ulanmagan. Administrator Click, Payme yoki Paynet kalitlarini sozlashi kerak.
              </p>
            )}
          </div>
        ) : null}

        {view === "amount" && chosen ? (
          <AmountStep
            method={chosen}
            amount={amount}
            onChange={setAmount}
            bonusPercent={bonusPercent}
            busy={busy !== null}
            canContinue={chosen.id !== "paynet" || !loggedIn || !!user}
            onContinue={continueFromAmount}
            error={error}
            extra={
              clickDirect ? (
                <div className="mt-2 flex justify-center">
                  <button
                    type="button"
                    data-pay-fallback
                    disabled={busy !== null || !!amountErr}
                    className={cn(textBtn, "text-[13px] underline disabled:opacity-40")}
                    onClick={() => void payViaPage("click", "page")}
                  >
                    {busy === "page" ? "Ochilmoqda..." : "Click sahifasi orqali to'lash"}
                  </button>
                </div>
              ) : null
            }
          />
        ) : null}

        {view === "card" && order ? (
          <CardStep
            orderId={order.id}
            amount={order.amount}
            onBack={stepBack}
            onSubmitted={(status) => {
              setSource("card");
              setWaitInitial(status === "paid" ? "paid" : "polling");
              replaceTop("wait");
            }}
          />
        ) : null}

        {view === "phone" && order ? (
          <PhoneStep
            orderId={order.id}
            amount={order.amount}
            onBack={stepBack}
            onSent={() => {
              setSource("phone");
              setWaitInitial("polling");
              replaceTop("wait");
            }}
          />
        ) : null}

        {view === "wait" && order ? (
          <WaitStep
            orderId={order.id}
            amount={order.amount}
            source={source}
            initial={waitInitial}
            onBack={stepBack}
            onDone={close}
            onReopen={source === "app" ? () => openClickApp(order.checkoutUrl) : undefined}
          />
        ) : null}

        {view === "paynet" && user ? <PaynetStep userId={user.id} amount={amount} appUrl={paynetLink} prefilled={paynetPrefill && paynetLink !== paynetBase} /> : null}
      </OverlayPanel>
    </OverlayFrame>
  );
}
