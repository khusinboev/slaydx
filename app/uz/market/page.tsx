import { Suspense } from "react";
import type { Metadata } from "next";
import { MarketCatalog } from "@/components/market/MarketCatalog";
import { filtersToSearch, parseFilters, PAGE_SIZE } from "@/components/market/market-model";
import type { MarketListResponse } from "@/lib/market/types";
import { marketEnabled } from "@/lib/server/market/items";
import { listMarketItems } from "@/lib/server/market/search";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out.set(k, v);
  return out;
}

/** Closed market and result pages stay out of the index (§3.1); the plain catalog and tool / subject filters are the shop window. */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const filters = parseFilters(toParams(await searchParams));
  const open = await marketEnabled().catch(() => false);
  return {
    title: "Ishlar bozori",
    description: "Tayyor slayd, referat, insho, konspekt va boshqa ishlar: asl narxdan 2 barobar arzon, titul sahifasi o‘z ismingiz bilan.",
    alternates: { canonical: "/uz/market" },
    robots: open && !filters.q ? undefined : { index: false, follow: true },
  };
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(toParams(await searchParams));
  const enabled = await marketEnabled().catch(() => false);
  let initial: MarketListResponse | null = null;
  if (enabled) {
    try {
      const { tool, subject, level, sort } = filters;
      initial = await listMarketItems({ tool, subject, level, sort, q: filtersToSearch(filters).get("q"), limit: PAGE_SIZE });
    } catch {
      // The browser asks again and shows its own state: a failed read must not take the page down.
    }
  }
  return (
    <Suspense>
      <MarketCatalog enabled={enabled} initial={initial} />
    </Suspense>
  );
}
