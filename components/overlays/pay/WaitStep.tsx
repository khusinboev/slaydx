"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import * as api from "@/lib/api-client";
import { groupDigits } from "@/lib/format";
import { useAppStore } from "@/lib/store";
import { primaryBtn, textBtn } from "./ui";

/** Waiting for Click's Shop API Complete: first check, its ceiling and the whole budget (ms). */
export const WAIT_POLL_START_MS = 2000;
export const WAIT_POLL_MAX_MS = 10_000;
export const WAIT_POLL_BUDGET_MS = 300_000;

export type WaitSource = "card" | "phone" | "app";
export type WaitPhase = "polling" | "paid" | "cancelled" | "stalled";

/**
 * Polls the user's orders (the same read the purchase page uses) until `orderId` is paid or
 * cancelled; the interval grows 2 s -> 10 s for 5 minutes, then `stalled` + a manual `recheck`.
 * Paid refreshes the session so the balance shown everywhere updates.
 */
export function useOrderWatch(orderId: string, initial: WaitPhase = "polling"): { phase: WaitPhase; recheck: () => void } {
  const refreshSession = useAppStore((s) => s.refreshSession);
  const [phase, setPhase] = useState<WaitPhase>(initial);
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    if (initial === "paid") void refreshSession();
  }, [initial, refreshSession]);

  useEffect(() => {
    if (initial === "paid") return;
    const ctrl = new AbortController();
    setPhase("polling");
    void (async () => {
      // After «Tekshirish» the first request goes at once.
      let wait = pollKey > 0 ? 0 : WAIT_POLL_START_MS;
      let delay = WAIT_POLL_START_MS;
      let spent = 0;
      while (spent + wait <= WAIT_POLL_BUDGET_MS) {
        await api.waitTurn(wait, ctrl.signal);
        spent += wait;
        wait = delay;
        delay = Math.min(WAIT_POLL_MAX_MS, Math.round(delay * 1.5));
        let state: api.PaymentOrder["state"] | undefined;
        try {
          state = (await api.listOrders()).orders.find((o) => o.id === orderId)?.state;
        } catch {
          // A transient error (network, 5xx): asked again on the next turn.
          if (ctrl.signal.aborted) return;
          continue;
        }
        if (ctrl.signal.aborted) return;
        if (state === "paid") {
          void refreshSession();
          setPhase("paid");
          return;
        }
        if (state === "cancelled") {
          setPhase("cancelled");
          return;
        }
      }
      setPhase("stalled");
    })().catch((e: unknown) => {
      // The step went away (`ctrl.abort`): an expected stop.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPhase("stalled");
    });
    return () => ctrl.abort();
  }, [orderId, initial, refreshSession, pollKey]);

  const recheck = useCallback(() => setPollKey((k) => k + 1), []);
  return { phase, recheck };
}

const WAIT_TEXT: Record<WaitSource, { title: string; body: string }> = {
  card: { title: "To'lov tekshirilmoqda", body: "Click to'lovni tasdiqlashi kutilmoqda. Bu bir necha soniya oladi." },
  phone: {
    title: "Hisob Click ilovasiga yuborildi",
    body: "Click ilovasini oching va to'lovni tasdiqlang. Tasdiqlangach balans avtomatik to'ldiriladi.",
  },
  app: {
    title: "Click ilovasida tasdiqlang",
    body: "Click ilovasida to'lovni tasdiqlang. Tasdiqlangach balans avtomatik to'ldiriladi.",
  },
};

/** After the payment was started: waits for the order to settle, then shows the result. */
export function WaitStep({
  orderId,
  amount,
  source,
  initial = "polling",
  onBack,
  onDone,
  onReopen,
}: {
  orderId: string;
  amount: number;
  source: WaitSource;
  /** `paid` when the card route already saw the order settled. */
  initial?: "polling" | "paid";
  onBack: () => void;
  onDone: () => void;
  /** «app»: opens the Click app link again. */
  onReopen?: () => void;
}) {
  const { phase, recheck } = useOrderWatch(orderId, initial);

  if (phase === "paid") {
    return (
      <div role="status" data-pay-result="paid" className="py-4 text-center">
        <CheckCircle2 aria-hidden className="mx-auto mb-3 size-12 text-emerald-600 dark:text-emerald-400" />
        <h3 className="mb-1 text-[19px] font-bold">To&apos;lov qabul qilindi</h3>
        <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug tabular-nums">
          {groupDigits(amount)} so&apos;m balansingizga qo&apos;shildi.
        </p>
        <button type="button" className={primaryBtn} onClick={onDone} data-pay-done>
          Yopish
        </button>
      </div>
    );
  }

  if (phase === "cancelled") {
    return (
      <div role="alert" data-pay-result="cancelled" className="py-4 text-center">
        <h3 className="text-destructive mb-1 text-[19px] font-bold">To&apos;lov bekor qilindi</h3>
        <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug">Pul yechilmadi. Qayta urinib ko&apos;ring yoki boshqa usulni tanlang.</p>
        <button type="button" className={primaryBtn} onClick={onBack}>
          Orqaga
        </button>
      </div>
    );
  }

  const text = WAIT_TEXT[source];
  return (
    <div role="status" aria-live="polite" data-pay-result={phase} className="py-4 text-center">
      {phase === "polling" ? <Loader2 aria-hidden className="text-primary mx-auto mb-3 size-10 animate-spin motion-reduce:animate-none" /> : null}
      <h3 className="mb-1 text-[19px] font-bold">{phase === "stalled" ? "To'lov hali tasdiqlanmadi" : text.title}</h3>
      <p className="text-muted-foreground mb-5 text-[14.5px] leading-snug">
        {phase === "stalled"
          ? "To'lov o'tgan bo'lsa, balans avtomatik to'ldiriladi. Birozdan keyin «Tekshirish» ni bosing."
          : text.body}
      </p>
      {phase === "stalled" ? (
        <button type="button" className={primaryBtn} onClick={recheck} data-pay-recheck>
          Tekshirish
        </button>
      ) : null}
      {source === "app" && onReopen ? (
        <button type="button" className={`${textBtn} mt-2`} onClick={onReopen} data-pay-reopen>
          Click ilovasini qayta ochish
        </button>
      ) : null}
      <div className="mt-1">
        <button type="button" className={textBtn} onClick={onBack}>
          Orqaga
        </button>
      </div>
    </div>
  );
}
