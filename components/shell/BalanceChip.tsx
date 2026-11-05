"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { creditTotal, useAppStore } from "@/lib/store";
import { cn } from "@/lib/cn";
import { groupDigits } from "@/lib/format";

/**
 * Balance pill → Hamyon (UX-03: the balance is one tap away; it used to live
 * in the removed TopBar). For page headers (Bosh). Signed out: nothing.
 * 44 px tall and tight: it shares the Bosh header row with the greeting and three icons at 360 px.
 */
export function BalanceChip({ className }: { className?: string }) {
  const loggedIn = useAppStore((s) => s.loggedIn);
  const user = useAppStore((s) => s.user);
  if (!loggedIn || !user) return null;
  const total = groupDigits(creditTotal(user));
  return (
    <Link
      href="/uz/wallet"
      data-balance
      title="Hamyon — balansni to'ldirish"
      aria-label={`Balans: ${total} so'm. Hamyon`}
      className={cn(
        "bg-accent-soft text-foreground hover:bg-accent focus-visible:ring-ring inline-flex h-11 min-w-11 shrink items-center justify-center gap-1 rounded-[14px] px-2 text-[14.5px] font-semibold tabular-nums outline-none focus-visible:ring-2",
        className,
      )}
    >
      <Coins className="text-primary size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{total}</span>
    </Link>
  );
}
