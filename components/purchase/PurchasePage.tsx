"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import * as api from "@/lib/api-client";
import { creditTotal, useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";

const FEATURES = [
  "Har bir hujjat narxi yaratishdan oldin ko'rsatiladi",
  "Faqat tayyor bo'lgan hujjat uchun yechiladi",
  "Click yoki Payme orqali xavfsiz to'lov",
  "Balans muddatsiz saqlanadi",
];

export function PurchasePage() {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const user = useAppStore((s) => s.user);
  const refreshSession = useAppStore((s) => s.refreshSession);
  const open = useUi((s) => s.open);
  const params = useSearchParams();

  const [orders, setOrders] = useState<api.PaymentOrder[] | null>(null);
  const orderId = params.get("order");

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

  /*
   * To'lovdan qaytganda holat darhol ko'rinmasligi mumkin (webhook
   * kechikadi). UX-04/FE-19: ilgari 5 marta × 3 s (15 s) so'rab JIM
   * to'xtardi — «tasdiqlanmoqda» banneri abadiy qolar, bekor qilingan
   * buyurtmada ham shu yozuv chiqardi. Endi: oraliq o'sib boradi (3 s →
   * 20 s), jami ~2 daqiqa; buyurtma to'langan/bekor bo'lsa darhol
   * to'xtaydi. Undan keyin — tushuntirish va qo'lda «Tekshirish».
   */
  const [check, setCheck] = useState<"idle" | "polling" | "stalled">("idle");
  const [pollKey, setPollKey] = useState(0);
  useEffect(() => {
    if (!orderId || !loggedIn) return;
    const ctrl = new AbortController();
    setCheck("polling");
    void (async () => {
      // «Tekshirish» bosilganda birinchi so'rov darhol ketadi.
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
          // Vaqtinchalik xato (tarmoq, 5xx) — keyingi navbatda yana so'raladi.
          console.warn("[purchase] buyurtmalar olinmadi:", e instanceof Error ? e.message : e);
          continue;
        }
        if (ctrl.signal.aborted) return;
        setOrders(list);
        const state = list.find((o) => o.id === orderId)?.state;
        if (state === "paid" || state === "cancelled") {
          // Balans (sarlavhadagi raqam) ham yangilansin.
          if (state === "paid") void refreshSession();
          setCheck("idle");
          return;
        }
      }
      setCheck("stalled");
    })().catch((e: unknown) => {
      // Effekt tozalandi (`ctrl.abort`) — kutilgan to'xtash.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setCheck("stalled");
    });
    return () => ctrl.abort();
  }, [orderId, loggedIn, refreshSession, pollKey]);

  const orderState = orderId ? orders?.find((o) => o.id === orderId)?.state : undefined;
  const justPaid = orderState === "paid";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:px-8">
      <div className="mb-8 text-center sm:mb-10">
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Balansni to‘ldirish</h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-[15.5px] sm:text-base">
          Hisobingizga mablag‘ qo‘shing — har bir hujjat uchun alohida to‘lanadi
        </p>
      </div>

      {justPaid ? (
        <div className="mx-auto mb-6 max-w-3xl rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          To&apos;lov qabul qilindi — hisobingiz yangilandi.
        </div>
      ) : orderState === "cancelled" ? (
        <div
          data-pay-banner="cancelled"
          className="border-destructive/30 bg-destructive/10 text-destructive mx-auto mb-6 max-w-3xl rounded-xl border px-4 py-3 text-sm"
        >
          To&apos;lov bekor qilindi — hisob o&apos;zgarmadi. Xohlasangiz, qaytadan to&apos;lashingiz mumkin.
        </div>
      ) : orderId && orders && check === "stalled" ? (
        <div
          data-pay-banner="stalled"
          role="status"
          className="mx-auto mb-6 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          <p>
            To&apos;lov tasdig&apos;i hali kelmadi. To&apos;lov tizimi xabarni kechiktirishi mumkin: pul yechilgan
            bo&apos;lsa, u hisobingizga o&apos;zi tushadi — qayta to&apos;lamang. 10 daqiqadan keyin ham tushmasa, to&apos;lov
            chekini saqlab, administratorga murojaat qiling.
          </p>
          <button
            type="button"
            onClick={() => setPollKey((k) => k + 1)}
            className="mt-2 h-8 rounded-full border border-amber-500/40 px-4 text-xs font-medium hover:bg-amber-500/10"
          >
            Tekshirish
          </button>
        </div>
      ) : orderId && orders ? (
        <div
          data-pay-banner="pending"
          className="mx-auto mb-6 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
        >
          To&apos;lov tasdiqlanmoqda... Odatda bir necha soniya, ba&apos;zan 1–2 daqiqa oladi.
        </div>
      ) : null}

      <div className="mx-auto max-w-md">
        <article className="bg-card ring-primary rounded-2xl border p-6 ring-2">
          <h2 className="text-lg font-semibold">Balansni to&apos;ldirish</h2>
          {loggedIn && user ? (
            <p data-testid="purchase-total" className="mt-2 text-3xl font-bold tabular-nums">
              {creditTotal(user).toLocaleString("uz-UZ")} tanga
            </p>
          ) : (
            <p className="mt-2 text-3xl font-bold">10 000 so&apos;mdan</p>
          )}
          <p className="text-muted-foreground mt-1 text-sm">
            {loggedIn && user ? "Hozirgi hisobingiz" : "Summani to'lov oynasida tanlaysiz"}
          </p>
          <ul className="mt-5 space-y-2 text-sm">
            {FEATURES.map((f) => (
              <li key={f} className="flex gap-2">
                <Check className="text-primary mt-0.5 size-4 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!sessionChecked}
            onClick={() => {
              if (!loggedIn) {
                open("login", { returnTo: "/uz/purchase" });
                return;
              }
              open("pay");
            }}
            className="bg-primary text-primary-foreground mt-6 h-11 w-full rounded-full text-sm font-medium disabled:opacity-60"
          >
            Balansni to&apos;ldirish
          </button>
        </article>
      </div>

      {orders?.length ? (
        <section className="mx-auto mt-10 max-w-3xl">
          <h2 className="mb-3 text-sm font-semibold">Oxirgi to&apos;lovlar</h2>
          <div className="bg-card divide-y rounded-xl border text-sm">
            {orders.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-muted-foreground">
                  {new Date(o.createdAt).toLocaleString("uz-UZ")} · {o.provider}
                </span>
                <span className="flex items-center gap-3">
                  <span>{o.amountSoum.toLocaleString("uz-UZ")} so&apos;m</span>
                  <span
                    className={
                      o.state === "paid"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : o.state === "cancelled"
                          ? "text-destructive"
                          : "text-muted-foreground"
                    }
                  >
                    {o.state === "paid" ? "To'landi" : o.state === "cancelled" ? "Bekor" : "Kutilmoqda"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** To'lovdan qaytgandan keyingi tekshiruv: birinchi oraliq, yuqori chegara va jami muddat (UX-04). */
const PAY_POLL_START_MS = 3000;
const PAY_POLL_MAX_MS = 20_000;
const PAY_POLL_BUDGET_MS = 120_000;
