"use client";

import { useEffect, useState } from "react";
import * as api from "@/lib/api-client";
import { isMarketTool } from "@/lib/market/registry";
import type { MarketCard } from "@/lib/market/types";
import { MarketCardView } from "./MarketCard";
import { useMarketOn } from "./MarketClosed";

const SHOWN = 3;

/** «Shunga o'xshash tayyor ishlar» under a finished work (§5.1): registry tools only, nothing while dark or when none exist. */
export function SimilarWorks({ toolId, topic }: { toolId: string; topic: string }) {
  const on = useMarketOn();
  const sold = isMarketTool(toolId);
  const [items, setItems] = useState<MarketCard[]>([]);

  useEffect(() => {
    if (!on || !sold) return;
    const ctrl = new AbortController();
    api
      .marketSuggest(toolId, topic, { signal: ctrl.signal })
      .then((r) => setItems(r.items.slice(0, SHOWN)))
      .catch(() => {
        // A suggestion is a bonus: a failure shows nothing.
      });
    return () => ctrl.abort();
  }, [on, sold, toolId, topic]);

  if (!on || !sold || !items.length) return null;
  return (
    <section aria-labelledby="market-similar" data-market-similar className="no-print mx-auto w-full max-w-3xl px-4 pt-2 pb-6">
      <h2 id="market-similar" className="text-muted-foreground mb-2.5 text-[13px] font-semibold tracking-[0.06em] uppercase">
        Shunga o‘xshash tayyor ishlar
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((card) => (
          <li key={card.id} className="min-w-0">
            <MarketCardView card={card} />
          </li>
        ))}
      </ul>
    </section>
  );
}
