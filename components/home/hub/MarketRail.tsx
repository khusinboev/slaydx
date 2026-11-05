"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketCardSkeleton, MarketCardView } from "@/components/market/MarketCard";
import { useMarketOn } from "@/components/market/MarketClosed";
import { MARKET_HOME } from "@/components/market/market-model";
import * as api from "@/lib/api-client";
import type { MarketCard } from "@/lib/market/types";
import { HubSection, SECTION_LINK_CLASS } from "./HubSection";

const RAIL_SIZE = 6;
const RAIL_ITEM = "w-[10.5rem] flex-none snap-start sm:w-[12rem]";

/**
 * «Ishlar bozori» on the hub (§5.1): a horizontal rail of the 6 most popular works + «Hammasi». Nothing at all with the
 * market off, on a failed load or while the shop is empty: the hub never shows an empty shelf.
 */
export function MarketRail({ index }: { index: number }) {
  const on = useMarketOn();
  const [items, setItems] = useState<MarketCard[] | null>(null);

  useEffect(() => {
    if (!on) return;
    const ctrl = new AbortController();
    api
      .marketList({ sort: "popular", limit: RAIL_SIZE }, { signal: ctrl.signal })
      .then((r) => setItems(r.items))
      .catch(() => {
        if (!ctrl.signal.aborted) setItems([]);
      });
    return () => ctrl.abort();
  }, [on]);

  if (!on || items?.length === 0) return null;
  return (
    <HubSection
      id="market"
      title="Ishlar bozori"
      index={index}
      action={
        <Link href={MARKET_HOME} data-hub-market-all className={SECTION_LINK_CLASS}>
          Hammasi
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      }
    >
      <ul data-hub-market className="-mx-4 flex snap-x gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items
          ? items.map((card) => (
              <li key={card.id} className={RAIL_ITEM}>
                <MarketCardView card={card} />
              </li>
            ))
          : Array.from({ length: 3 }, (_, i) => (
              <li key={i} className={RAIL_ITEM}>
                <MarketCardSkeleton />
              </li>
            ))}
      </ul>
    </HubSection>
  );
}
