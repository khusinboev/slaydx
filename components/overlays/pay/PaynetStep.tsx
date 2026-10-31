"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { copyToClipboard } from "@/lib/share";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM } from "@/lib/topup-limits";
import { primaryBtn, textBtn } from "./ui";

type Notice = { text: string; tone: "ok" | "error" };

/** The steps at a Paynet agent (app, terminal or kiosk); the payer identifier is the SlaydX ID. */
export const PAYNET_STEPS: readonly string[] = [
  "Paynet ilovasi yoki terminalini oching",
  "«SlaydX» xizmatini tanlang",
  "ID maydoniga ID raqamingizni kiriting",
  "Paynet ko'rsatgan ism sizniki ekanini tekshirib, istalgan summani to'lang — u balansga darhol tushadi",
];

/**
 * Prod incident 2026-10-31: a payer typed the AMOUNT («3000») into Paynet's client-id field, GetInformation showed
 * user #3000's masked name and the money went to that account. The step therefore warns before paying.
 */
export const PAYNET_ID_WARNING =
  "ID maydoniga summani emas, shu raqamni kiriting; to'lashdan oldin Paynet ko'rsatgan ism sizniki ekanini tekshiring.";

/**
 * The amount rule at Paynet (owner 2026-10-31): whatever the payer pays there within the top-up limits is credited
 * (`PerformTransaction` credits Paynet's own `amount`), so the dialog's amount is never a requirement here.
 */
export const paynetAmountNote = (): string =>
  `Paynet'da istalgan summani to'lashingiz mumkin: eng kami ${groupDigits(MIN_TOPUP_SOUM)}, eng ko'pi ${groupDigits(MAX_TOPUP_SOUM)} so'm. Balansga aynan to'lagan summangiz tushadi.`;

/**
 * «Paynet» in the top-up dialog (docs/payments/PAYNET.md «UI»). Paynet is paid at an agent, not in a
 * checkout: no order is created here — Paynet's own call credits the wallet with the amount actually paid
 * there, so this step carries no amount: the SlaydX ID (the `client_id` the agent types) with a copy
 * button, the any-amount rule with the limits, and — while `PAYNET_APP_URL` is set — a button into the Paynet app.
 */
export function PaynetStep({ userId, appUrl, onBack }: { userId: string; appUrl: string | null; onBack: () => void }) {
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
        Paynet to&apos;lovni o&apos;zida qabul qiladi: ID raqamingizni nusxalab, Paynet&apos;da kiriting.
      </p>

      <div className="bg-muted/60 flex items-center justify-between gap-3 rounded-[14px] px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[13px] font-medium">Sizning ID raqamingiz</p>
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

      <p role="note" className="mb-3 rounded-[14px] bg-amber-500/10 px-3.5 py-2.5 text-[14px] leading-snug font-medium text-amber-800 dark:text-amber-300" data-paynet-warning>
        {PAYNET_ID_WARNING}
      </p>

      <p className="mb-4 rounded-[14px] bg-emerald-500/10 px-3.5 py-2.5 text-[14px] leading-snug text-emerald-800 dark:text-emerald-300" data-paynet-any-amount>
        {paynetAmountNote()}
      </p>

      {appUrl ? (
        <a href={appUrl} target="_blank" rel="noopener noreferrer" data-paynet-open className={cn(primaryBtn, "mb-4 gap-2 no-underline")}>
          <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          Paynet ilovasida to&apos;lash
        </a>
      ) : null}

      <ol className="grid gap-2.5" data-paynet-steps>
        {PAYNET_STEPS.map((step, i) => (
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
