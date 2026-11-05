"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getMarketOverview } from "@/lib/admin-api/market";
import { Badge, ErrorState, Forbidden, TabPanel, Tabs, useLoad, type TabItem } from "@/components/admin/ui";
import { CatalogTab } from "./CatalogTab";
import { QueueTab } from "./QueueTab";
import { SalesTab } from "./SalesTab";
import { SettingsTab } from "./SettingsTab";

const TABS = ["queue", "catalog", "sales", "settings"] as const;
type TabId = (typeof TABS)[number];
const ID_PREFIX = "market";

/** Hoisted: `useLoad` re-runs when the loader changes, an inline arrow would refetch on every render. */
const loadOverview = (signal: AbortSignal) => getMarketOverview({ signal });

/**
 * `/admin/market` «Ishlar bozori» (docs/market/PLAN.md §6): Navbat, Katalog, Sotuvlar, Sozlamalar. The tab lives in the
 * URL (`?tab=`), like Sozlamalar. Everything shown here is enforced again by the API.
 */
export function MarketPage() {
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params?.get("tab") ?? "";
  const tab: TabId = (TABS as readonly string[]).includes(raw) ? (raw as TabId) : "queue";
  const [overview, retryOverview] = useLoad(loadOverview);
  const [changes, setChanges] = useState(0);

  const select = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params?.toString() ?? "");
      if (id === "queue") next.delete("tab");
      else next.set("tab", id);
      const qs = next.toString();
      window.history.replaceState(null, "", `${pathname ?? ""}${qs ? `?${qs}` : ""}`);
    },
    [params, pathname],
  );

  // A queue action moves numbers in the tab badges; the overview is cheap, so it just reloads.
  const onChanged = useCallback(() => {
    setChanges((n) => n + 1);
    retryOverview();
  }, [retryOverview]);

  const tabs: TabItem[] = useMemo(() => {
    const o = overview.status === "ready" ? overview.data : null;
    return [
      { id: "queue", label: "Navbat", badge: o && o.candidates > 0 ? <Badge tone="info">{o.candidates}</Badge> : undefined },
      { id: "catalog", label: "Katalog", badge: o && o.reported > 0 ? <Badge tone="warning">{o.reported}</Badge> : undefined },
      { id: "sales", label: "Sotuvlar" },
      { id: "settings", label: "Sozlamalar" },
    ];
  }, [overview]);

  if (overview.status === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">Ishlar bozori</h1>
          {overview.status === "ready" ? <Badge tone={overview.data.enabled ? "success" : "neutral"}>{overview.data.enabled ? "Yoqilgan" : "O'chiq"}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-[13px]">Tayyor ishlarni tasdiqlash, katalog, sotuvlar va narx sozlamalari</p>
      </header>
      {overview.status === "error" ? <ErrorState message={overview.message} requestId={overview.requestId} onRetry={retryOverview} /> : null}
      <Tabs tabs={tabs} value={tab} onChange={select} ariaLabel="Bozor bo'limlari" idPrefix={ID_PREFIX} />
      <TabPanel idPrefix={ID_PREFIX} id={tab}>
        {tab === "queue" ? <QueueTab overview={overview.status === "ready" ? overview.data : null} changes={changes} onChanged={onChanged} /> : null}
        {tab === "catalog" ? <CatalogTab changes={changes} onChanged={onChanged} /> : null}
        {tab === "sales" ? <SalesTab /> : null}
        {tab === "settings" ? <SettingsTab overview={overview.status === "ready" ? overview.data : null} /> : null}
      </TabPanel>
    </div>
  );
}
