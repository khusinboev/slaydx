"use client";

import Link from "next/link";
import { Store } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { useAppStore } from "@/lib/store";

/** The market is on for this session: the switch, or an admin looking at the dark catalog (§10.5). */
export function useMarketOn(): boolean {
  const on = useAppStore((s) => s.features?.market === true);
  const admin = useAppStore((s) => s.user?.isAdmin === true);
  return on || admin;
}

/** A calm centred note with one way out: the closed market, an empty catalog, an unknown item. */
export function MarketNote({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div data-market-note className="mx-auto flex max-w-sm flex-col items-center gap-3 px-4 py-14 text-center motion-safe:animate-[slx-enter-fade_240ms_ease-out_backwards]">
      <span aria-hidden className="bg-accent-soft text-accent-soft-foreground flex size-16 items-center justify-center rounded-[22px]">
        <Store className="size-8" />
      </span>
      <p className="text-foreground text-[18px] leading-snug font-semibold">{title}</p>
      {text ? <p className="text-muted-foreground text-[15px] leading-relaxed">{text}</p> : null}
      {action}
    </div>
  );
}

export const NOTE_ACTION =
  "bg-primary text-primary-foreground focus-visible:ring-ring mt-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[14px] px-5 text-[15.5px] font-semibold outline-none transition-[filter] hover:brightness-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page-bg)]";

/** `market.enabled` is off: no catalog, no prices, one calm page for whoever kept a link (§9). */
export function MarketClosed() {
  return (
    <div className="flex w-full flex-col" data-market-closed>
      <PageHeader title="Ishlar bozori" back backFallback="/uz" />
      <MarketNote
        title="Bozor tez orada ochiladi"
        text="Tayyor slayd, referat va insholar shu yerda paydo bo‘ladi. Hozircha xohlagan ishingizni o‘zingiz yaratishingiz mumkin."
        action={
          <Link href="/uz" className={NOTE_ACTION}>
            Bosh sahifaga
          </Link>
        }
      />
    </div>
  );
}
