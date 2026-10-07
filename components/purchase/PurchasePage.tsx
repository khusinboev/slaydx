"use client";

import { Check } from "lucide-react";
import { creditTotal, useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { PageBack } from "../shell/PageBack";
import { PaymentBanner } from "../wallet/PaymentBanner";
import { TOPUP_FEATURES as FEATURES } from "../wallet/wallet-model";
import { usePaymentReturn } from "../wallet/usePaymentReturn";

export function PurchasePage() {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const user = useAppStore((s) => s.user);
  const open = useUi((s) => s.open);

  const pay = usePaymentReturn();
  const { orders } = pay;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:px-8">
      <div className="mb-4">
        <PageBack />
      </div>
      <div className="mb-8 text-center sm:mb-10">
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Balansni to&apos;ldirish</h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-[15.5px] sm:text-base">
          Hisobingizga mablag&apos; qo&apos;shing — har bir hujjat uchun alohida to&apos;lanadi
        </p>
      </div>

      <PaymentBanner pay={pay} className="mx-auto mb-6 max-w-3xl" />

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
