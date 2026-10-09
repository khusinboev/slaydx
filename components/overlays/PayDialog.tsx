"use client";

import { useEffect, useState, type ComponentType } from "react";
import { ChevronRight, CreditCard, Phone, Smartphone, Wallet } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useNav } from "@/components/nav/NavProvider";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { openClickApp } from "@/lib/open-click-app";
import type { ClickMethod } from "@/lib/click-input";
import { topupAmountError } from "@/lib/topup-limits";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { PAY_RETURN_PATH, usePayAmount } from "./pay-amount";
import { useDialog } from "./useDialog";
import { AmountField } from "./pay/AmountField";
import { CardStep } from "./pay/CardStep";
import { PhoneStep } from "./pay/PhoneStep";
import { WaitStep, type WaitSource } from "./pay/WaitStep";
import { sectionLabel, textBtn } from "./pay/ui";

const methodBtn =
  "focus-visible:ring-ring h-12 rounded-[16px] text-[15.5px] font-semibold outline-none transition-[background-color,transform] focus-visible:ring-2 active:scale-[0.98] disabled:opacity-40 motion-reduce:transform-none";

export { TOPUP_PRESETS, DEFAULT_TOPUP, PAY_RETURN_PATH, openPay } from "./pay-amount";

type View = "home" | "card" | "phone" | "wait";

type ClickOrder = { id: string; amount: number; method: ClickMethod; checkoutUrl: string };

const TITLES: Record<View, string> = {
  home: "Balansni to'ldirish",
  card: "Karta orqali to'lash",
  phone: "Telefon raqam orqali",
  wait: "To'lov",
};

/**
 * To'lov usulini tanlash.
 *
 * Muhim: bu dialog **kredit qo'shmaydi**. U buyurtma yaratadi va to'lovni boshlaydi;
 * hisob FAQAT Click/Payme webhook'i tasdiqlagandan keyin to'ladi (dialog buyurtmani
 * kuzatib turadi).
 *
 * Click (owner 2026-10-09): erkin summa (1 000 – 10 000 000) va uchta TO'G'RIDAN-TO'G'RI usul —
 * «Karta» (o'z formamiz: bir martalik karta tokeni + SMS), «Telefon raqam» (Click ilovasiga hisob),
 * «Click ilovasi» (deeplink). «Click sahifasi orqali» — zaxira havola (eski oqim). Merchant API
 * sozlanmagan bo'lsa (`features.payments.clickDirect`) faqat oddiy «Click» tugmasi chiqadi.
 *
 * Redesign W5 (variant A): telefonda pastki varaq, kompyuterda markazdagi dialog.
 */
export function PayDialog() {
  const open = useUi((s) => s.overlay === "pay");
  const close = useUi((s) => s.close);
  const openUi = useUi((s) => s.open);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);

  const amount = usePayAmount((s) => s.amount);
  const setAmount = usePayAmount((s) => s.setAmount);
  const [view, setView] = useState<View>("home");
  const [order, setOrder] = useState<ClickOrder | null>(null);
  const [source, setSource] = useState<WaitSource>("card");
  const [waitInitial, setWaitInitial] = useState<"polling" | "paid">("polling");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useDialog(open, close);
  const nav = useNav();
  /** Telefon (docs/mobile/PLAN.md O5): 44 px tugmalar, ekranga sig'adi va ichida aylanadi. */
  const phone = useCoarsePointer();

  // Har ochilganda oldingi xato/kutish holati tozalansin (karta ma'lumotlari ham: qadam komponentlari yo'qoladi).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
    setView("home");
    setOrder(null);
    setWaitInitial("polling");
  }, [open]);

  if (!open) return null;

  // Sozlanmagan provayderning tugmalari CHIZILMAYDI (kalitsiz «o'chiq» tugma o'rniga).
  const clickOn = features?.payments.click ?? false;
  const directOn = clickOn && features?.payments.clickDirect === true;
  const paymeOn = features?.payments.payme ?? false;
  const anyEnabled = clickOn || paymeOn;
  const amountErr = topupAmountError(amount);

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
      // Provayder sahifasi — qaytganda `/uz/purchase?order=...` ochiladi va u
      // `/uz/wallet?order=...` ga yo'naltiradi (so'rov saqlanadi).
      // Dialog tarix yozuvi avval olib tashlanadi: aks holda provayderdan
      // «orqaga» o'lik (dialogsiz) yozuvga tushardi.
      // `replace`: provayder sahifa yozuvini egallaydi — `?order=` dan «orqaga» provayderga qaytmaydi.
      nav.navigateFromOverlay(checkoutUrl, { external: "replace" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "To'lov boshlanmadi");
      setBusy(null);
    }
  }

  /** Click'ning uch to'g'ridan-to'g'ri usuli: buyurtma (summa/usul o'zgarmasa qayta ishlatiladi) + keyingi qadam. */
  async function startDirect(method: Exclude<ClickMethod, "page">) {
    if (needLogin() || amountErr) return;
    setError(null);
    setBusy(method);
    try {
      let o = order;
      if (!o || o.amount !== amount || o.method !== method) {
        const r = await api.createOrder({ provider: "click", amount, method });
        o = { id: r.order.id, amount, method, checkoutUrl: r.checkoutUrl };
        setOrder(o);
      }
      if (method === "card") setView("card");
      else if (method === "phone") setView("phone");
      else {
        // Deeplink: Telegram'da tashqi (openLink), boshqa joyda oddiy o'tish. Dialog kuzatishda qoladi.
        openClickApp(o.checkoutUrl);
        setSource("app");
        setWaitInitial("polling");
        setView("wait");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "To'lov boshlanmadi");
    } finally {
      setBusy(null);
    }
  }

  const back = () => {
    setError(null);
    setView("home");
  };

  return (
    <OverlayFrame
      label="Balansni to'ldirish"
      phone={phone}
      sheet
      className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}
    >
      <OverlayScrim onClose={close} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? undefined : "max-w-md"}>
        <OverlayHeader title={TITLES[view]} phone={phone} onClose={close} className="mb-1" />

        {view === "card" && order ? (
          <CardStep
            orderId={order.id}
            amount={order.amount}
            onBack={back}
            onSubmitted={(status) => {
              setSource("card");
              setWaitInitial(status === "paid" ? "paid" : "polling");
              setView("wait");
            }}
          />
        ) : null}

        {view === "phone" && order ? (
          <PhoneStep
            orderId={order.id}
            amount={order.amount}
            onBack={back}
            onSent={() => {
              setSource("phone");
              setWaitInitial("polling");
              setView("wait");
            }}
          />
        ) : null}

        {view === "wait" && order ? (
          <WaitStep
            orderId={order.id}
            amount={order.amount}
            source={source}
            initial={waitInitial}
            onBack={back}
            onDone={close}
            onReopen={source === "app" ? () => openClickApp(order.checkoutUrl) : undefined}
          />
        ) : null}

        {view === "home" ? (
          <>
            <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug">
              Summani tanlang yoki kiriting va to&apos;lov usulini bosing — balans to&apos;lov tasdiqlangach to&apos;ldiriladi.
            </p>

            <AmountField amount={amount} onChange={setAmount} />

            {!anyEnabled ? (
              <p className="mb-4 rounded-[14px] bg-amber-500/10 px-3.5 py-2.5 text-[13.5px] leading-snug text-amber-800 dark:text-amber-300">
                To&apos;lov provayderi hali ulanmagan. Administrator Click yoki Payme kalitlarini
                sozlashi kerak.
              </p>
            ) : null}

            <p className={sectionLabel}>To&apos;lov usuli</p>
            {directOn ? (
              <div className="flex flex-col gap-2" data-pay-methods>
                <MethodRow method="card" icon={CreditCard} title="Karta" hint="Bank kartasi — SMS kod bilan" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void startDirect("card")} />
                <MethodRow method="phone" icon={Phone} title="Telefon raqam" hint="Click ilovasiga hisob yuboriladi" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void startDirect("phone")} />
                <MethodRow method="app" icon={Smartphone} title="Click ilovasi" hint="Ilovani ochib, to'lovni tasdiqlaysiz" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void startDirect("app")} />
                {paymeOn ? (
                  <MethodRow method="payme" icon={Wallet} title="Payme" hint="Payme to'lov sahifasiga o'tasiz" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void payViaPage("payme", "payme")} />
                ) : null}
              </div>
            ) : (
              // Merchant API not configured: the plain Click page button (the pre-2026-10-09 flow).
              <div className="grid grid-cols-2 gap-2" data-pay-methods>
                {clickOn ? (
                  <button
                    type="button"
                    data-pay-method="click"
                    disabled={busy !== null || !!amountErr}
                    onClick={() => void payViaPage("click", "click")}
                    className={cn(methodBtn, "bg-primary text-primary-foreground hover:brightness-95", !paymeOn && "col-span-2")}
                  >
                    {busy === "click" ? "Ochilmoqda..." : "Click"}
                  </button>
                ) : null}
                {paymeOn ? (
                  <button
                    type="button"
                    data-pay-method="payme"
                    disabled={busy !== null || !!amountErr}
                    onClick={() => void payViaPage("payme", "payme")}
                    className={cn(methodBtn, "bg-primary text-primary-foreground hover:brightness-95", !clickOn && "col-span-2")}
                  >
                    {busy === "payme" ? "Ochilmoqda..." : "Payme"}
                  </button>
                ) : null}
              </div>
            )}

            {directOn ? (
              <div className="mt-1 flex justify-center">
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
            ) : null}

            <p className="text-muted-foreground mt-3 text-center text-[13px] tabular-nums" data-pay-total>
              To&apos;lanadi:{" "}
              <span className="text-foreground font-semibold">{amountErr ? "—" : `${groupDigits(amount)} so'm`}</span>
            </p>

            {error ? (
              <p role="alert" className="text-destructive mt-3 text-[13.5px]">
                {error}
              </p>
            ) : null}
          </>
        ) : null}
      </OverlayPanel>
    </OverlayFrame>
  );
}

/** One payment method: a ≥ 56 px row with an icon, the name and a one-line hint (the button's accessible name is both). */
function MethodRow({
  method,
  icon: Icon,
  title,
  hint,
  busy,
  disabled,
  onClick,
}: {
  method: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  hint: string;
  busy: string | null;
  disabled: boolean;
  onClick: () => void;
}) {
  const loading = busy === method;
  return (
    <button
      type="button"
      data-pay-method={method}
      disabled={disabled}
      onClick={onClick}
      className="focus-visible:ring-ring bg-card hover:bg-accent flex min-h-14 w-full items-center gap-3 rounded-[16px] border px-3.5 py-2 text-left outline-none transition-[background-color,transform] focus-visible:ring-2 active:scale-[0.99] disabled:opacity-40 motion-reduce:transform-none"
    >
      <Icon aria-hidden className="text-primary size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] leading-tight font-semibold">{loading ? "Ochilmoqda..." : title}</span>
        <span className="text-muted-foreground block text-[12.5px] leading-snug">{hint}</span>
      </span>
      <ChevronRight aria-hidden className="text-muted-foreground size-4 shrink-0" />
    </button>
  );
}
