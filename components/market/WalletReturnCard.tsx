"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Store } from "lucide-react";
import { safeMarketReturn } from "./market-model";
import { rememberMarketReturn, storedMarketReturn } from "./market-return";

/**
 * Hamyon, on the way to a purchase (§2.4): the link back to the item, whose confirm sheet reopens at the fresh price.
 * `?return=` is the direct path; the stored target covers the trip through Click or Payme, which comes back without it.
 */
export function WalletReturnCard() {
  const params = useSearchParams();
  const fromUrl = safeMarketReturn(params?.get("return"));
  const [target, setTarget] = useState<string | null>(fromUrl);

  useEffect(() => {
    if (fromUrl) rememberMarketReturn(fromUrl);
    setTarget(fromUrl ?? storedMarketReturn());
  }, [fromUrl]);

  if (!target) return null;
  return (
    <Link
      href={target}
      data-market-return
      className="bg-accent-soft focus-visible:ring-ring mb-4 flex min-h-[3.25rem] items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px] leading-snug outline-none focus-visible:ring-2"
    >
      <Store className="text-accent-soft-foreground size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Xaridni davom ettirish</span>
        <span className="text-muted-foreground block text-[13.5px]">Balans to‘ldirilgach, shu yerdan bozorga qayting</span>
      </span>
      <ArrowRight className="text-accent-soft-foreground size-5 shrink-0" aria-hidden />
    </Link>
  );
}
