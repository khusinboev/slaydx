"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Landmark } from "lucide-react";
import { cn } from "@/lib/cn";
import { copyToClipboard } from "@/lib/share";
import { paymentBonusHint } from "@/lib/payment-bonus";

/** The three steps at a Paynet agent (terminal, kiosk or app); the payer identifier is the SlaydX ID. */
export const PAYNET_STEPS = [
  "Paynet ilovasi yoki terminalini oching",
  "«SlaydX» xizmatini tanlang",
  "SlaydX ID ni kiriting va to'lang — summa balansga darhol tushadi",
] as const;

const FOCUS = "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

type Notice = { text: string; tone: "ok" | "error" };

/**
 * «Paynet orqali to'lash» (docs/payments/PAYNET.md «UI»): shown on the wallet only when the server has Paynet
 * configured (`features.payments.paynet`). Paynet is paid at an agent, not in a checkout, so this card — not the
 * PayDialog — carries it: the user's SlaydX ID (the `client_id` the agent types) with a copy button and three steps.
 * The payment bonus applies like any other top-up (the same hint as «Tez to'ldirish»).
 */
export function PaynetCard({ userId, bonusPercent, appUrl, className }: { userId: string; bonusPercent: number; appUrl?: string | null; className?: string }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const say = (n: Notice) => {
    setNotice(n);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  };

  const copy = async () => {
    const ok = await copyToClipboard(userId);
    say(ok ? { text: "SlaydX ID nusxalandi", tone: "ok" } : { text: "Nusxalab bo'lmadi — ID ni qo'lda yozing", tone: "error" });
  };

  return (
    <section aria-labelledby="wallet-paynet-title" data-wallet-paynet className={className}>
      <h2 id="wallet-paynet-title" className="text-muted-foreground mx-0.5 mt-7 mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase">
        Paynet orqali to&apos;lash
      </h2>
      <div className="bg-card rounded-[20px] border px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="bg-accent-soft text-accent-soft-foreground flex size-11 shrink-0 items-center justify-center rounded-[14px]" aria-hidden="true">
            <Landmark className="size-[22px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[17px] leading-snug font-semibold">Paynet agenti orqali to&apos;ldiring</p>
            <p className="text-muted-foreground mt-0.5 text-[14px] leading-snug">Terminal, kassa yoki Paynet ilovasida</p>
          </div>
        </div>

        <div className="bg-muted/60 mt-4 flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-[13px] font-medium">SlaydX ID</p>
            <p className="mt-0.5 font-mono text-[28px] leading-tight font-bold tracking-[0.02em] tabular-nums break-all select-all" data-wallet-paynet-id>
              {userId}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copy()}
            data-wallet-paynet-copy
            aria-label="SlaydX ID ni nusxalash"
            className={cn(
              "hover:bg-muted bg-background inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[14px] border px-3.5 text-[15px] font-medium",
              FOCUS,
            )}
          >
            <Copy className="size-4 shrink-0" aria-hidden="true" />
            <span>Nusxalash</span>
          </button>
        </div>
        <p
          aria-live="polite"
          data-wallet-paynet-notice={notice?.tone ?? ""}
          className={cn("mt-2 min-h-5 text-[13px]", notice?.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
        >
          {notice?.text ?? ""}
        </p>

        {appUrl ? (
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-wallet-paynet-open
            className={cn("bg-primary text-primary-foreground mb-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] px-4 text-[15px] font-semibold", FOCUS)}
          >
            <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
            Paynet ilovasida to&apos;lash
          </a>
        ) : null}

        <ol className="mt-1 grid gap-2.5" data-wallet-paynet-steps>
          {PAYNET_STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-[15px] leading-snug">
              <span
                className="bg-primary text-primary-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        {bonusPercent > 0 ? (
          <p className="text-accent-soft-foreground mt-3.5 flex items-start gap-2 text-[14px] leading-snug font-semibold" data-wallet-paynet-bonus>
            <Check className="mt-px size-4 shrink-0" aria-hidden="true" />
            {paymentBonusHint(bonusPercent)} — Paynet orqali ham
          </p>
        ) : null}
      </div>
    </section>
  );
}
