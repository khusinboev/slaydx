"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { CreditCard, Smartphone, Wallet } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useNav } from "@/components/nav/NavProvider";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { openClickApp } from "@/lib/open-click-app";
import { openExternalLink } from "@/lib/telegram-webapp";
import { paynetPayLink } from "@/lib/paynet-link";
import type { ClickMethod } from "@/lib/click-input";
import { topupAmountError } from "@/lib/topup-limits";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { PAY_RETURN_PATH, usePayAmount } from "./pay-amount";
import { useDialog } from "./useDialog";
import { AmountField } from "./pay/AmountField";
import { CardStep } from "./pay/CardStep";
import { PhoneStep } from "./pay/PhoneStep";
import { PaynetStep } from "./pay/PaynetStep";
import { ClickLogo, PaynetLogo } from "./pay/brand";
import { WaitStep, type WaitSource } from "./pay/WaitStep";
import { sectionLabel, textBtn } from "./pay/ui";

export { TOPUP_PRESETS, DEFAULT_TOPUP, PAY_RETURN_PATH, openPay } from "./pay-amount";

type View = "home" | "card" | "phone" | "wait" | "paynet";

type ClickOrder = { id: string; amount: number; method: ClickMethod; checkoutUrl: string };

const TITLES: Record<View, string> = {
  home: "Balansni to'ldirish",
  card: "Karta orqali to'lash",
  phone: "Telefon raqam orqali",
  wait: "To'lov",
  paynet: "Paynet orqali to'lash",
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
 *
 * Paynet (owner 2026-10-31): summa tanlangach Click bilan bir qatorda «Paynet» usuli — buyurtma
 * yaratilmaydi (Paynet agentda to'lanadi, hisobni Paynet chaqiruvi to'ldiradi), `PaynetStep` SlaydX ID,
 * «istalgan summa» qoidasi (min/max) va ilova tugmasini ko'rsatadi. Paynet o'zi to'langan summani
 * yuboradi va AYNAN shu summa hisobga tushadi (egasi 2026-10-31) — dialogdagi summa Paynet uchun shart
 * emas. Faqat server Paynet'ni sozlagan bo'lsa (`features.payments.paynet`).
 *
 * Plitkalar (owner 2026-11-01): summa tepada; ostida yonma-yon **Click** va **Paynet** (logotiplar bilan) —
 * bosilganda ilova shu summa bilan ochiladi va faqat tasdiqlash qoladi (Click: buyurtma deeplink'i, Paynet:
 * `paynetPayLink` — ID va summa havolada); ularning ostida yonma-yon «Telefon raqam» va «Karta» (Click).
 * Paynet plitkasi endi summani yuborgani uchun noto'g'ri summada boshqalari kabi yopiq; `PaynetStep` esa
 * ilova ochilmasa qo'lda to'lash uchun zaxira bo'lib qoladi.
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
  const [view, setView] = useState<View>("home");
  const [order, setOrder] = useState<ClickOrder | null>(null);
  const [source, setSource] = useState<WaitSource>("card");
  const [waitInitial, setWaitInitial] = useState<"polling" | "paid">("polling");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paynetLaunched, setPaynetLaunched] = useState<"prefilled" | "plain" | null>(null);
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
    setPaynetLaunched(null);
  }, [open]);

  if (!open) return null;

  // Sozlanmagan provayderning tugmalari CHIZILMAYDI (kalitsiz «o'chiq» tugma o'rniga).
  const clickOn = features?.payments.click ?? false;
  const directOn = clickOn && features?.payments.clickDirect === true;
  const paymeOn = features?.payments.payme ?? false;
  const paynetOn = features?.payments.paynet === true;
  const anyEnabled = clickOn || paymeOn || paynetOn;
  const amountErr = topupAmountError(amount);

  const paynetBase = features?.payments.paynetUrl ?? null;
  /** Prefill (`PAYNET_APP_PREFILL`) is switched on only after the `c`/`a` link params were checked in the real app. */
  const paynetPrefill = features?.payments.paynetPrefill === true;
  /** The app link: with the payer id and the amount when prefill is on and the amount is valid, else the bare merchant link. */
  const paynetLink = paynetBase && user && paynetPrefill && !amountErr ? paynetPayLink(paynetBase, user.id, amount) : paynetBase;

  function openPaynet() {
    // `user` (the ID sent) can still be loading right after sign-in: stay on the list rather than open an empty step.
    if (needLogin() || amountErr || !user) return;
    setError(null);
    // Paynet has no return URL: never replace this tab. Telegram → `openLink` (external); elsewhere a new tab,
    // which the OS hands to the Paynet app; the step below stays here as the manual fallback.
    if (paynetLink && !openExternalLink(paynetLink)) window.open(paynetLink, "_blank", "noopener,noreferrer");
    setPaynetLaunched(paynetLink ? (paynetPrefill && paynetLink !== paynetBase ? "prefilled" : "plain") : null);
    setView("paynet");
  }

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

        {view === "paynet" && user ? <PaynetStep userId={user.id} appUrl={paynetLink} launched={paynetLaunched} onBack={back} /> : null}

        {view === "home" ? (
          <>
            <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug">
              Summani tanlang yoki kiriting va to&apos;lov usulini bosing — balans to&apos;lov tasdiqlangach to&apos;ldiriladi.
            </p>

            <AmountField amount={amount} onChange={setAmount} />

            {!anyEnabled ? (
              <p className="mb-4 rounded-[14px] bg-amber-500/10 px-3.5 py-2.5 text-[13.5px] leading-snug text-amber-800 dark:text-amber-300">
                To&apos;lov provayderi hali ulanmagan. Administrator Click, Payme yoki Paynet kalitlarini
                sozlashi kerak.
              </p>
            ) : null}

            <p className={sectionLabel}>To&apos;lov usuli</p>
            <div className="flex flex-col gap-2" data-pay-methods>
              {clickOn || paynetOn ? (
                <div className="grid grid-cols-2 gap-2" data-pay-apps>
                  {clickOn ? (
                    <BrandTile
                      method={directOn ? "app" : "click"}
                      label={directOn ? "Click ilovasi" : "Click"}
                      hint={directOn ? "Ilovada tasdiqlaysiz" : "Click sahifasida to'laysiz"}
                      busy={busy}
                      disabled={busy !== null || !!amountErr}
                      onClick={() => void (directOn ? startDirect("app") : payViaPage("click", "click"))}
                      className={cn(!paynetOn && "col-span-2")}
                    >
                      <ClickLogo className="text-foreground h-[26px] w-auto" />
                    </BrandTile>
                  ) : null}
                  {paynetOn ? (
                    <BrandTile
                      method="paynet"
                      label="Paynet"
                      hint="Ilovada tasdiqlaysiz"
                      busy={busy}
                      disabled={busy !== null || !!amountErr || (loggedIn && !user)}
                      onClick={openPaynet}
                      className={cn(!clickOn && "col-span-2")}
                    >
                      <PaynetLogo className="text-foreground text-[24px]" />
                    </BrandTile>
                  ) : null}
                </div>
              ) : null}
              {directOn ? (
                <div className="grid grid-cols-2 gap-2" data-pay-direct>
                  <IconTile method="phone" icon={Smartphone} title="Telefon raqam" hint="Click'ga hisob" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void startDirect("phone")} />
                  <IconTile method="card" icon={CreditCard} title="Karta" hint="SMS kod bilan" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void startDirect("card")} />
                </div>
              ) : null}
              {paymeOn ? (
                <IconTile method="payme" icon={Wallet} title="Payme" hint="Payme sahifasiga o'tasiz" busy={busy} disabled={busy !== null || !!amountErr} onClick={() => void payViaPage("payme", "payme")} />
              ) : null}
            </div>

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

const tileCls =
  "focus-visible:ring-ring bg-card enabled:hover:bg-accent flex w-full flex-col items-center justify-center gap-1.5 rounded-[18px] border px-2 text-center outline-none transition-[background-color,transform] focus-visible:ring-2 active:scale-[0.98] disabled:opacity-40 motion-reduce:transform-none";

/** A provider app tile (Click / Paynet): the logo large, one hint line; the accessible name is the label. */
function BrandTile({
  method,
  label,
  hint,
  busy,
  disabled,
  onClick,
  className,
  children,
}: {
  method: string;
  label: string;
  hint: string;
  busy: string | null;
  disabled: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" data-pay-method={method} aria-label={label} disabled={disabled} onClick={onClick} className={cn(tileCls, "min-h-[84px] py-3", className)}>
      <span className="flex h-7 items-center">{children}</span>
      <span className="text-muted-foreground text-[12.5px] leading-snug">{busy === method ? "Ochilmoqda..." : hint}</span>
    </button>
  );
}

/** A secondary method tile (phone / card / Payme): an icon in a soft disc, the name and a short hint. */
function IconTile({
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
  return (
    <button type="button" data-pay-method={method} disabled={disabled} onClick={onClick} className={cn(tileCls, "min-h-[76px] flex-row justify-start gap-2.5 px-2.5 py-2.5 text-left")}>
      <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full max-[389px]:hidden">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-tight font-semibold whitespace-nowrap">{busy === method ? "Ochilmoqda..." : title}</span>
        <span className="text-muted-foreground block text-[12.5px] leading-snug">{hint}</span>
      </span>
    </button>
  );
}
