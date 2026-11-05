import type { Metadata } from "next";
import { MarketPage } from "@/components/admin/market/MarketPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ishlar bozori" };

/** docs/market/PLAN.md §6: queue, catalog, sales, settings (permission `market.view`, enforced by the API). */
export default function AdminMarketRoute() {
  return <MarketPage />;
}
