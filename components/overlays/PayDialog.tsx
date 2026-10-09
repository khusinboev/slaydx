"use client";

import { useEffect, useState } from "react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useNav } from "@/components/nav/NavProvider";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "./OverlayFrame";
import { DEFAULT_TOPUP, PAY_RETURN_PATH, TOPUP_PRESETS, usePayAmount } from "./pay-amount";
import { groupDigits } from "@/lib/format";
import { useDialog } from "./useDialog";

export { TOPUP_PRESETS, DEFAULT_TOPUP, PAY_RETURN_PATH, openPay } from "./pay-amount";

const sectionLabel = "text-muted-foreground mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase";
const methodBtn =
  "focus-visible:ring-ring h-12 rounded-[16px] text-[15.5px] font-semibold outline-none transition-[background-color,transform] focus-visible:ring-2 active:scale-[0.98] disabled:opacity-40 motion-reduce:transform-none";

/** «Karta orqali» (Click `card_type`): karta tizimi — to'lov sahifasi shu forma bilan ochiladi. */
type CardType = "uzcard" | "humo";
const CARD_TYPES: { id: CardType; label: string }[] = [
  { id: "uzcard", label: "Uzcard" },
  { id: "humo", label: "Humo" },
];

/**
 * To'lov usulini tanlash.
 *
 * Muhim: bu dialog endi **kredit qo'shmaydi**. Ilgari tugma bosilishi
 * bilanoq balans berardi — ya'ni bepul pul tugmasi edi. Endi u faqat buyurtma yaratadi va provayder sahifasiga
 * yuboradi; hisob webhook tasdiqlagandan keyin to'ladi.
 *
 * Redesign W5 (variant A): telefonda pastki varaq, kompyuterda markazdagi
 * dialog; summa kartalari (`TOPUP_PRESETS`, standart — «eng qulay»), Hamyon
 * paketlari `openPay({ amount })` bilan summani oldindan tanlaydi.
 */
export function PayDialog() {
  const open = useUi((s) => s.overlay === "pay");
  const close = useUi((s) => s.close);
  const openUi = useUi((s) => s.open);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);

  const amount = usePayAmount((s) => s.amount);
  const setAmount = usePayAmount((s) => s.setAmount);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const panelRef = useDialog(open, close);
  const nav = useNav();
  /** Telefon (docs/mobile/PLAN.md O5): 44 px tugmalar, ekranga sig'adi va ichida aylanadi. */
  const phone = useCoarsePointer();

  // Har ochilganda oldingi xato/kutish holati tozalansin.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
    setCardOpen(false);
  }, [open]);

  if (!open) return null;

  // Sozlanmagan provayderning tugmalari CHIZILMAYDI (kalitsiz «o'chiq» tugma o'rniga).
  // «Karta orqali» — o'sha Click buyurtmasi: Click sahifasi karta formasini darhol ochadi.
  const clickOn = features?.payments.click ?? false;
  const paymeOn = features?.payments.payme ?? false;
  const anyEnabled = clickOn || paymeOn;

  async function pay(provider: "click" | "payme", card?: CardType) {
    if (!loggedIn) {
      openUi("login", { returnTo: PAY_RETURN_PATH });
      return;
    }
    setError(null);
    setBusy(card ?? provider);
    try {
      const { checkoutUrl } = await api.createOrder({
        provider,
        amount,
        ...(card ? { card } : {}),
      });
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

  return (
    <OverlayFrame
      label="Balansni to'ldirish"
      phone={phone}
      sheet
      className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}
    >
      <OverlayScrim onClose={close} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? undefined : "max-w-md"}>
        <OverlayHeader title="Balansni to'ldirish" phone={phone} onClose={close} className="mb-1" />
        <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug">
          Summani tanlang va to&apos;lov usulini bosing — balans to&apos;lov tasdiqlangach to&apos;ldiriladi.
        </p>

        <fieldset className="mb-5">
          <legend className={sectionLabel}>Summa</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-pay-presets>
            {TOPUP_PRESETS.map((v) => {
              const on = amount === v;
              const best = v === DEFAULT_TOPUP;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  data-pay-amount={v}
                  aria-label={`${groupDigits(v)} so'm${best ? ", eng qulay" : ""}`}
                  onClick={() => setAmount(v)}
                  className={cn(
                    "focus-visible:ring-ring flex min-h-16 flex-col items-center justify-center rounded-[16px] border px-2 py-2 text-center tabular-nums outline-none transition-colors focus-visible:ring-2",
                    on ? "border-primary bg-accent-soft shadow-[inset_0_0_0_1px_var(--primary)]" : "bg-card hover:bg-accent",
                  )}
                >
                  <span className="text-[17px] leading-tight font-bold">{groupDigits(v)}</span>
                  <span className={cn("text-[12.5px] leading-tight", best ? "text-accent-soft-foreground font-semibold" : "text-muted-foreground")}>
                    {best ? "eng qulay" : "so'm"}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {!anyEnabled ? (
          <p className="mb-4 rounded-[14px] bg-amber-500/10 px-3.5 py-2.5 text-[13.5px] leading-snug text-amber-800 dark:text-amber-300">
            To&apos;lov provayderi hali ulanmagan. Administrator Click yoki Payme kalitlarini
            sozlashi kerak.
          </p>
        ) : null}

        <p className={sectionLabel}>To&apos;lov usuli</p>
        <div className="grid grid-cols-2 gap-2" data-pay-methods>
          {clickOn ? (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void pay("click")}
                className={cn(methodBtn, "bg-primary text-primary-foreground hover:brightness-95")}
              >
                {busy === "click" ? "Ochilmoqda..." : "Click"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                aria-expanded={cardOpen}
                aria-controls="pay-card-types"
                onClick={() => setCardOpen((v) => !v)}
                className={cn(methodBtn, "bg-primary text-primary-foreground hover:brightness-95")}
              >
                Karta orqali
              </button>
            </>
          ) : null}
          {paymeOn ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void pay("payme")}
              className={cn(methodBtn, "bg-primary text-primary-foreground col-span-2 hover:brightness-95")}
            >
              {busy === "payme" ? "Ochilmoqda..." : "Payme"}
            </button>
          ) : null}
        </div>

        {clickOn && cardOpen ? (
          <div id="pay-card-types" role="group" aria-label="Karta turi" className="mt-2 grid grid-cols-2 gap-2" data-pay-card-types>
            {CARD_TYPES.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy !== null}
                data-pay-card={c.id}
                onClick={() => void pay("click", c.id)}
                className={cn(methodBtn, "bg-card hover:bg-accent border")}
              >
                {busy === c.id ? "Ochilmoqda..." : c.label}
              </button>
            ))}
          </div>
        ) : null}

        <p className="text-muted-foreground mt-3 text-center text-[13px] tabular-nums" data-pay-total>
          To&apos;lanadi: <span className="text-foreground font-semibold">{groupDigits(amount)} so&apos;m</span>
        </p>

        {error ? (
          <p role="alert" className="text-destructive mt-3 text-[13.5px]">
            {error}
          </p>
        ) : null}
      </OverlayPanel>
    </OverlayFrame>
  );
}
