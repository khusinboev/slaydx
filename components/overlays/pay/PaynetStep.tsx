"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { copyToClipboard } from "@/lib/share";
import { primaryBtn, textBtn } from "./ui";

type Notice = { text: string; tone: "ok" | "error" };

/** The steps at a Paynet agent (app, terminal or kiosk); the payer identifier is the SlaydX ID. */
export const paynetSteps = (amount: number): string[] => [
  "Paynet ilovasi yoki terminalini oching",
  "«SlaydX» xizmatini tanlang",
  `SlaydX ID ni kiriting va ${groupDigits(amount)} so'm to'lang — summa balansga darhol tushadi`,
];

/**
 * «Paynet» in the top-up dialog (docs/payments/PAYNET.md «UI»). Paynet is paid at an agent, not in a
 * checkout: no order is created here — Paynet's own call credits the wallet, so this step only carries
 * what the user needs there: the amount chosen in the dialog, the SlaydX ID (the `client_id` the agent
 * types) with a copy button, and — while `PAYNET_APP_URL` is set — a button into the Paynet app.
 */
export function PaynetStep({ userId, amount, appUrl, onBack }: { userId: string; amount: number; appUrl: string | null; onBack: () => void }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const ok = await copyToClipboard(userId);
    setNotice(ok ? { text: "SlaydX ID nusxalandi", tone: "ok" } : { text: "Nusxalab bo'lmadi — ID ni qo'lda yozing", tone: "error" });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  };

  return (
    <div data-pay-step="paynet">
      <p className="text-muted-foreground mb-4 text-[14.5px] leading-snug">
        Paynet to&apos;lovni o&apos;zida qabul qiladi: ID ni nusxalab, <span className="text-foreground font-semibold" data-paynet-amount>{groupDigits(amount)} so&apos;m</span> to&apos;lang.
      </p>

      <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[13px] font-medium">SlaydX ID</p>
          <p className="mt-0.5 font-mono text-[28px] leading-tight font-bold tracking-[0.02em] tabular-nums break-all select-all" data-paynet-id>
            {userId}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          data-paynet-copy
          aria-label="SlaydX ID ni nusxalash"
          className="hover:bg-muted bg-background focus-visible:ring-ring inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[14px] border px-3.5 text-[15px] font-medium outline-none focus-visible:ring-2"
        >
          <Copy className="size-4 shrink-0" aria-hidden="true" />
          <span>Nusxalash</span>
        </button>
      </div>
      <p
        aria-live="polite"
        data-paynet-notice={notice?.tone ?? ""}
        className={cn("mt-2 min-h-5 text-[13px]", notice?.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
      >
        {notice?.text ?? ""}
      </p>

      {appUrl ? (
        <a href={appUrl} target="_blank" rel="noopener noreferrer" data-paynet-open className={cn(primaryBtn, "mb-4 gap-2 no-underline")}>
          <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          Paynet ilovasida to&apos;lash
        </a>
      ) : null}

      <ol className="grid gap-2.5" data-paynet-steps>
        {paynetSteps(amount).map((step, i) => (
          <li key={step} className="flex items-start gap-3 text-[15px] leading-snug">
            <span className="bg-primary text-primary-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums" aria-hidden="true">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        <button type="button" className={textBtn} onClick={onBack}>
          Orqaga
        </button>
      </div>
    </div>
  );
}
