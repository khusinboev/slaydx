"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { useDialog } from "./useDialog";

const TOPUP_PRESETS = [10_000, 25_000, 50_000, 100_000];

/**
 * To'lov usulini tanlash.
 *
 * Muhim: bu dialog endi **kredit qo'shmaydi**. Ilgari tugma bosilishi
 * bilanoq 15 000 kvota yoki 50 000 balans berardi — ya'ni bepul pul
 * tugmasi edi. Endi u faqat buyurtma yaratadi va provayder sahifasiga
 * yuboradi; hisob webhook tasdiqlagandan keyin to'ladi.
 */
export function PayDialog() {
  const open = useUi((s) => s.overlay === "pay");
  const plan = useUi((s) => s.payPlan);
  const close = useUi((s) => s.close);
  const openUi = useUi((s) => s.open);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const features = useAppStore((s) => s.features);

  const [amount, setAmount] = useState(TOPUP_PRESETS[1]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useDialog(open, close);

  // Har ochilganda oldingi xato/kutish holati tozalansin.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(null);
  }, [open]);

  if (!open) return null;

  const isPro = plan === "pro";
  const methods = [
    { id: "click" as const, label: "Click", enabled: features?.payments.click ?? false },
    { id: "payme" as const, label: "Payme", enabled: features?.payments.payme ?? false },
  ];
  const anyEnabled = methods.some((m) => m.enabled);

  async function pay(provider: "click" | "payme") {
    if (!loggedIn) {
      openUi("login", { returnTo: "/uz/purchase" });
      return;
    }
    setError(null);
    setBusy(provider);
    try {
      const { checkoutUrl } = await api.createOrder({
        provider,
        purpose: isPro ? "pro" : "topup",
        amount: isPro ? undefined : amount,
      });
      // Provayder sahifasi — qaytganda `/uz/purchase?order=...` ochiladi.
      window.location.href = checkoutUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "To'lov boshlanmadi");
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="To'lov usuli"
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" onClick={close} />
      <div ref={panelRef} className="bg-card relative z-10 w-full max-w-md rounded-2xl border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">To&apos;lov usuli</h2>
          <button type="button" onClick={close} className="hover:bg-muted rounded-full p-1.5" aria-label="Yopish">
            <X className="size-4" />
          </button>
        </div>

        <p className="text-muted-foreground mb-4 text-sm">
          {isPro ? "Pro · 15 000 so'm / 30 kun" : "Balansni to'ldirish"}
        </p>

        {!isPro ? (
          <fieldset className="mb-4">
            <legend className="text-muted-foreground mb-2 text-sm">Summani tanlang</legend>
            <div className="grid grid-cols-4 gap-2">
              {TOPUP_PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={amount === v}
                  onClick={() => setAmount(v)}
                  className={`h-10 rounded-lg border text-xs font-medium ${
                    amount === v ? "border-primary bg-primary text-primary-foreground" : "bg-background"
                  }`}
                >
                  {(v / 1000).toLocaleString("uz-UZ")}k
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {!anyEnabled ? (
          <p className="mb-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            To&apos;lov provayderi hali ulanmagan. Administrator Click yoki Payme kalitlarini
            sozlashi kerak.
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {methods.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={!m.enabled || busy !== null}
              onClick={() => void pay(m.id)}
              className="bg-background hover:bg-muted h-12 rounded-xl border text-sm font-medium disabled:opacity-40"
            >
              {busy === m.id ? "Ochilmoqda..." : m.label}
              {!m.enabled ? " · o'chiq" : ""}
            </button>
          ))}
        </div>

        {error ? (
          <p role="alert" className="text-destructive mt-3 text-xs">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
