"use client";

import { TabPanel, Tabs, presetRange, validateRange, type DateRange } from "@/components/admin/ui";
import { isIsoDate } from "@/lib/admin-format";
import { useUrlFilters } from "@/components/admin/payments/list-state";
import { FinanceSummaryView } from "./FinanceSummaryView";
import { LedgerTable } from "./LedgerTable";
import { ReconciliationView } from "./ReconciliationView";

const PAGE_KEYS = ["tab", "from", "to", "wfrom", "wto"] as const;
const TABS = [
  { id: "summary", label: "Xulosa" },
  { id: "ledger", label: "Hisob kitobi" },
  { id: "reconciliation", label: "Muvofiqlashtirish" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** A complete, well-formed range from the URL (≤ 366 days); anything else falls back to the default. */
function isValidRange(r: DateRange): boolean {
  return isIsoDate(r.from) && isIsoDate(r.to) && validateRange(r) === null;
}

/**
 * S10 `/admin/finance` (plan §7.1): "Xulosa" (revenue, spend, liabilities),
 * "Hisob kitobi" (global ledger, CSV) and "Muvofiqlashtirish" (checks).
 * The tab and every filter live in the URL.
 */
export function FinancePage() {
  const store = useUrlFilters(PAGE_KEYS);
  const v = store.values;
  const tab: TabId = TABS.some((t) => t.id === v.tab) ? (v.tab as TabId) : "summary";
  const urlRange = { from: v.from, to: v.to };
  const range: DateRange = isValidRange(urlRange) ? urlRange : presetRange("30d");

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Moliya</h1>
        <p className="text-muted-foreground text-[13px]">Tushum, majburiyatlar, hisob kitobi va muvofiqlashtirish</p>
      </header>
      <Tabs
        idPrefix="finance"
        ariaLabel="Moliya bo'limlari"
        tabs={TABS}
        value={tab}
        onChange={(id) => store.set({ tab: id === "summary" ? "" : id })}
      />
      <TabPanel idPrefix="finance" id={tab}>
        {tab === "summary" ? (
          <FinanceSummaryView range={range} onRangeChange={(r) => store.set({ from: r.from, to: r.to })} />
        ) : tab === "ledger" ? (
          <LedgerTable />
        ) : (
          <ReconciliationView walletRange={{ from: v.wfrom, to: v.wto }} onWalletRangeChange={(r) => store.set({ wfrom: r.from, wto: r.to })} />
        )}
      </TabPanel>
    </div>
  );
}
