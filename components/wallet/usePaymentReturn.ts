"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { replaceSearch } from "@/lib/ui";

/** After the return from Click/Payme: first interval, its ceiling and the whole budget (UX-04). */
export const PAY_POLL_START_MS = 3000;
export const PAY_POLL_MAX_MS = 20_000;
export const PAY_POLL_BUDGET_MS = 120_000;

export type PayCheck = "idle" | "polling" | "stalled";

export type PaymentReturn = {
  /** The user's orders (`null` until the first answer; `[]` when signed out or on an error). */
  orders: api.PaymentOrder[] | null;
  /** The order the provider sent the user back for (`?order=`), kept after the URL is cleaned. */
  orderId: string | null;
  /** State of that order once the list knows it. */
  orderState: api.PaymentOrder["state"] | undefined;
  check: PayCheck;
  /** «Tekshirish»: restart the polling with an immediate first request. */
  recheck: () => void;
};

/**
 * Orders + the `?order=` payment return (moved from `PurchasePage`, behaviour unchanged).
 *
 * `?order=` marks the return from the provider. Once the order settles (paid /
 * cancelled) it is removed from the URL with `replace`: a reload or a history
 * step does not reopen an old banner. The banner state lives here, so it stays
 * after the URL is cleaned.
 *
 * The webhook may be late. UX-04/FE-19: the interval grows (3 s → 20 s) for
 * about 2 minutes and stops at once when the order is paid or cancelled; then
 * the page explains and offers a manual «Tekshirish».
 */
export function usePaymentReturn(): PaymentReturn {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const params = useSearchParams();

  const [orders, setOrders] = useState<api.PaymentOrder[] | null>(null);
  const urlOrder = params.get("order");
  const [seenOrder, setSeenOrder] = useState<string | null>(urlOrder);
  useEffect(() => {
    if (urlOrder) setSeenOrder(urlOrder);
  }, [urlOrder]);
  const orderId = urlOrder ?? seenOrder;

  useEffect(() => {
    if (!loggedIn) {
      setOrders([]);
      return;
    }
    void api
      .listOrders()
      .then((r) => setOrders(r.orders))
      .catch(() => setOrders([]));
  }, [loggedIn]);

  const [check, setCheck] = useState<PayCheck>("idle");
  const [pollKey, setPollKey] = useState(0);
  useEffect(() => {
    if (!orderId || !loggedIn) return;
    const ctrl = new AbortController();
    setCheck("polling");
    void (async () => {
      // After «Tekshirish» the first request goes at once.
      let wait = pollKey > 0 ? 0 : PAY_POLL_START_MS;
      let delay = PAY_POLL_START_MS;
      let spent = 0;
      while (spent + wait <= PAY_POLL_BUDGET_MS) {
        await api.waitTurn(wait, ctrl.signal);
        spent += wait;
        wait = delay;
        delay = Math.min(PAY_POLL_MAX_MS, Math.round(delay * 1.5));
        let list: api.PaymentOrder[];
        try {
          ({ orders: list } = await api.listOrders());
        } catch (e) {
          if (ctrl.signal.aborted) return;
          // A transient error (network, 5xx): asked again on the next turn.
          console.warn("[purchase] buyurtmalar olinmadi:", e instanceof Error ? e.message : e);
          continue;
        }
        if (ctrl.signal.aborted) return;
        setOrders(list);
        const state = list.find((o) => o.id === orderId)?.state;
        if (state === "paid" || state === "cancelled") {
          // The balance shown everywhere refreshes too.
          if (state === "paid") void refreshSession();
          const rest = new URLSearchParams(window.location.search);
          if (rest.has("order")) {
            rest.delete("order");
            replaceSearch(rest);
          }
          setCheck("idle");
          return;
        }
      }
      setCheck("stalled");
    })().catch((e: unknown) => {
      // The effect was cleaned up (`ctrl.abort`): an expected stop.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setCheck("stalled");
    });
    return () => ctrl.abort();
  }, [orderId, loggedIn, refreshSession, pollKey]);

  const recheck = useCallback(() => setPollKey((k) => k + 1), []);
  const orderState = orderId ? orders?.find((o) => o.id === orderId)?.state : undefined;
  return { orders, orderId, orderState, check, recheck };
}
