"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";

const FEATURES = [
  "Barcha hujjat vositalari",
  "15 000 tanga kvota / 30 kun",
  "Slayd, kurs ishi, insho, tezis",
  "Tarjimon va metodik hujjatlar",
  "Navbatda ustuvorlik",
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

  // To'lovdan qaytganda holat darhol ko'rinmasligi mumkin (webhook biroz
  // kechikadi), shuning uchun bir necha marta tekshiramiz.
  useEffect(() => {
    if (!orderId || !loggedIn) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      void refreshSession();
      void api.listOrders().then((r) => setOrders(r.orders)).catch(() => {});
      if (tries >= 5) clearInterval(t);
    }, 3000);
    return () => clearInterval(t);
  }, [orderId, loggedIn, refreshSession]);

  const justPaid = orderId && orders?.find((o) => o.id === orderId)?.state === "paid";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 lg:px-8">
      <div className="mb-8 text-center sm:mb-10">
        <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">Rejani tanlang</h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-[15.5px] sm:text-base">
          O‘zingizga mos rejani tanlang va barcha imkoniyatlardan to‘liq foydalaning
        </p>
      </div>

      {justPaid ? (
        <div className="mx-auto mb-6 max-w-3xl rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          To&apos;lov qabul qilindi — hisobingiz yangilandi.
        </div>
      ) : orderId && orders ? (
        <div className="mx-auto mb-6 max-w-3xl rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          To&apos;lov tasdiqlanmoqda... Bu bir necha soniya olishi mumkin.
        </div>
      ) : null}

      <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
        <article className="bg-card rounded-2xl border p-6">
          <h2 className="text-lg font-semibold">Bepul</h2>
          <p className="mt-2 text-3xl font-bold">0 so&apos;m</p>
          <p className="text-muted-foreground mt-1 text-sm">Yangi akkauntda 3 000 ball</p>
          <ul className="mt-5 space-y-2 text-sm">
            <li className="flex gap-2">
              <Check className="text-primary mt-0.5 size-4" /> Asosiy vositalarni sinash
            </li>
            <li className="flex gap-2">
              <Check className="text-primary mt-0.5 size-4" /> Fayllarni saqlash
            </li>
          </ul>
          <button
            type="button"
            disabled
            className="border-input mt-6 h-11 w-full rounded-full border text-sm font-medium opacity-60"
          >
            {user?.plan === "pro" ? "Bepul reja" : "Joriy reja"}
          </button>
        </article>

        <article className="bg-card ring-primary rounded-2xl border p-6 ring-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Pro</h2>
            {user?.plan === "pro" && loggedIn ? (
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                Faol
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-3xl font-bold">15 000 so&apos;m</p>
          <p className="text-muted-foreground mt-1 text-sm">
            30 kun · 15 000 kvota
            {user?.planExpiresAt
              ? ` · ${new Date(user.planExpiresAt).toLocaleDateString("uz-UZ")} gacha`
              : ""}
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
              open("pay", { payPlan: "pro" });
            }}
            className="bg-primary text-primary-foreground mt-6 h-11 w-full rounded-full text-sm font-medium disabled:opacity-60"
          >
            {user?.plan === "pro" ? "Muddatni uzaytirish" : "Pro'ga o'tish"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!loggedIn) {
                open("login", { returnTo: "/uz/purchase" });
                return;
              }
              open("pay", { payPlan: "topup" });
            }}
            className="text-muted-foreground hover:text-foreground mt-3 h-9 w-full text-sm"
          >
            Yoki balansni to&apos;ldirish
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
