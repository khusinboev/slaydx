"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";
import { copyToClipboard } from "@/lib/share";
import { openExternalLink } from "@/lib/telegram-webapp";
import { MAX_TOPUP_SOUM, MIN_TOPUP_SOUM } from "@/lib/topup-limits";
import { PaynetLogo } from "./brand";
import { primaryBtn } from "./ui";

type Notice = { text: string; tone: "ok" | "error" };

/** The steps at a Paynet agent (app, terminal or kiosk); the payer identifier is the SlaydX ID. */
export const PAYNET_STEPS: readonly string[] = [
  "Paynet ilovasi yoki terminalini oching",
  "«SlaydX» xizmatini tanlang",
  "ID maydoniga ID raqamingizni kiriting",
  "Paynet ko'rsatgan ism sizniki ekanini tekshirib, to'lang — summa balansga darhol tushadi",
];

/**
 * Prod incident 2026-10-31: a payer typed the AMOUNT («3000») into Paynet's client-id field, GetInformation showed
 * user #3000's masked name and the money went to that account. The step therefore warns before paying.
 */
export const PAYNET_ID_WARNING = "ID maydoniga summani yozmang. To'lashdan oldin Paynet ko'rsatgan ism sizniki ekanini tekshiring.";

/**
 * Whatever the payer pays at Paynet within the top-up limits is credited (`PerformTransaction` credits Paynet's own
 * `amount`, owner 2026-10-31) — said under «Qanday to'lanadi?», since the app may open without the amount filled in.
 */
export const paynetAmountNote = (): string =>
  `Balansga Paynet'da aynan to'lagan summangiz tushadi (eng kami ${groupDigits(MIN_TOPUP_SOUM)}, eng ko'pi ${groupDigits(MAX_TOPUP_SOUM)} so'm).`;

/** Font size of the ID by its length: very large for the usual short ids, still on one 360 px line for long ones. */
function idSize(id: string): string {
  if (id.length <= 8) return "text-[48px] sm:text-[56px]";
  if (id.length <= 12) return "text-[36px] sm:text-[44px]";
  return "text-[28px]";
}

/**
 * «Paynet» after the «Summa» step (docs/payments/PAYNET.md «UI», owner 2026-11-12). At Paynet the payer types the ID
 * HIMSELF, so it comes first and biggest: «Sizning SlaydX ID raqamingiz» in very large digits on a Paynet-green
 * card with a big «Nusxalash». Then the amount typed in step 1, a short wrong-ID warning, and «Paynet ilovasini
 * ochish», which opens `appUrl` (with the ID and the amount when `PAYNET_APP_PREFILL` is on) ONLY on this tap —
 * Telegram: `openLink` (external); elsewhere a new tab (Paynet has no return URL, this tab is never replaced).
 * No order is created: Paynet's own call credits the wallet. The four agent steps sit under «Qanday to'lanadi?».
 */
export function PaynetStep({ userId, amount, appUrl, prefilled }: { userId: string; amount: number; appUrl: string | null; prefilled: boolean }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [launched, setLaunched] = useState(false);
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

  const openApp = () => {
    if (!appUrl) return;
    if (!openExternalLink(appUrl)) window.open(appUrl, "_blank", "noopener,noreferrer");
    setLaunched(true);
  };

  const copied = notice?.tone === "ok";

  return (
    <div data-pay-step="paynet">
      <section
        aria-labelledby="paynet-id-label"
        data-paynet-id-card
        className="rounded-[20px] border border-emerald-600/25 bg-emerald-500/10 px-4 pt-3.5 pb-4 dark:border-emerald-400/25 dark:bg-emerald-400/10"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="paynet-id-label" className="text-[13.5px] font-semibold text-emerald-900 dark:text-emerald-200">
            Sizning SlaydX ID raqamingiz
          </h3>
          <PaynetLogo className="text-[15px] text-emerald-900 dark:text-emerald-100" />
        </div>
        <p
          className={cn("text-foreground mt-1 font-mono leading-[1.05] font-bold tracking-[0.04em] tabular-nums break-all select-all", idSize(userId))}
          data-paynet-id
        >
          {userId}
        </p>
        <button
          type="button"
          onClick={() => void copy()}
          data-paynet-copy
          data-autofocus
          aria-label="SlaydX ID ni nusxalash"
          className="bg-background hover:bg-muted focus-visible:ring-ring mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border text-[15.5px] font-semibold outline-none transition-colors focus-visible:ring-2"
        >
          {copied ? <Check className="size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="size-[18px] shrink-0" aria-hidden="true" />}
          <span>{copied ? "Nusxalandi" : "Nusxalash"}</span>
        </button>
        <p className="mt-2.5 text-[14px] leading-snug text-emerald-950 dark:text-emerald-100" data-paynet-id-hint>
          Paynet ilovasida «ID» maydoniga aynan shu raqamni kiriting
        </p>
      </section>
      <p
        aria-live="polite"
        data-paynet-notice={notice?.tone ?? ""}
        className={cn("mt-1.5 min-h-5 px-1 text-[13px]", notice?.tone === "error" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
      >
        {notice?.text ?? ""}
      </p>

      <div className="flex items-center justify-between gap-3 border-y px-1 py-3 text-[15px]" data-paynet-summary>
        <span className="text-muted-foreground">To&apos;lov summasi</span>
        <span className="font-semibold tabular-nums" data-paynet-amount>
          {groupDigits(amount)} so&apos;m
        </span>
      </div>

      <p role="note" className="text-muted-foreground mt-3 flex gap-2 px-1 text-[13.5px] leading-snug" data-paynet-warning>
        <Info className="mt-px size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <span>{PAYNET_ID_WARNING}</span>
      </p>

      {launched ? (
        <p className="bg-primary/10 mt-3 rounded-[14px] px-3.5 py-2.5 text-[14px] leading-snug font-medium" data-paynet-launched role="status">
          {prefilled
            ? "Paynet ilovasi ochildi: ID va summa tayyor — faqat to'lovni tasdiqlang. Maydonlar bo'sh bo'lsa, ID ni yuqoridan kiriting."
            : "Paynet ilovasi ochildi: «SlaydX» xizmatida yuqoridagi ID ni kiriting va to'lang."}
        </p>
      ) : null}

      {appUrl ? (
        <button type="button" onClick={openApp} data-paynet-open className={cn(primaryBtn, "mt-4 gap-2")}>
          <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
          Paynet ilovasini ochish
        </button>
      ) : null}

      <details className="group mt-3 rounded-[16px] border" data-paynet-howto>
        <summary className="focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-[16px] px-3.5 text-[14.5px] font-semibold outline-none focus-visible:ring-2 [&::-webkit-details-marker]:hidden">
          Qanday to&apos;lanadi?
          <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="px-3.5 pb-3.5">
          <ol className="grid gap-2.5" data-paynet-steps>
            {PAYNET_STEPS.map((step, i) => (
              <li key={step} className="flex items-start gap-3 text-[14.5px] leading-snug">
                <span className="bg-primary text-primary-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-3 text-[13px] leading-snug" data-paynet-any-amount>
            {paynetAmountNote()}
          </p>
        </div>
      </details>
    </div>
  );
}
