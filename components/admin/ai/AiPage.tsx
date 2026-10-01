"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { AiGroupBy } from "@/lib/admin-api/ai";
import { isIsoDate } from "@/lib/admin-format";
import { TabPanel, Tabs, presetRange, validateRange, type DateRange } from "@/components/admin/ui";
import { CostTab } from "./CostTab";
import { ProvidersTab } from "./ProvidersTab";
import { DEFAULT_COST_SORT, DEFAULT_GROUP_BY, GROUP_BY_VALUES } from "./shared";

const TABS = [
  { id: "cost", label: "Xarajat" },
  { id: "providers", label: "Provayderlar" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const ID_PREFIX = "ai";

/**
 * S11 `/admin/ai`: tab "Xarajat" (period, group-by, sortable table, daily
 * chart, coverage banner) and tab "Provayderlar" (keys, breakers, limiters,
 * 24 h usage). Everything that selects data lives in the URL query
 * (`tab`, `from`, `to`, `groupBy`, `sort`), so a view can be shared and the
 * back button works.
 */
export function AiPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab: TabId = params.get("tab") === "providers" ? "providers" : "cost";
  const defaultRange = presetRange("30d");
  const rawFrom = params.get("from") ?? "";
  const rawTo = params.get("to") ?? "";
  // An invalid or over-long range in the URL falls back to the default instead of a 400.
  const urlRange: DateRange = { from: rawFrom, to: rawTo };
  const range: DateRange = isIsoDate(rawFrom) && isIsoDate(rawTo) && validateRange(urlRange) === null ? urlRange : defaultRange;
  const rawGroup = params.get("groupBy");
  const groupBy: AiGroupBy = GROUP_BY_VALUES.includes(rawGroup as AiGroupBy) ? (rawGroup as AiGroupBy) : DEFAULT_GROUP_BY;
  const sort = params.get("sort");

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[22px] font-semibold tracking-tight">AI xarajat va provayderlar</h1>
        <p className="text-muted-foreground text-[13px]">Xarajat manbasi: tugagan, xato bilan tugagan va bepul AI chaqiruvlari yozuvlari (admin hisoboti).</p>
      </header>

      <div>
        <Tabs tabs={TABS} value={tab} onChange={(id) => update({ tab: id === "cost" ? null : id })} ariaLabel="AI bo'limlari" idPrefix={ID_PREFIX} />
        <TabPanel idPrefix={ID_PREFIX} id={tab}>
          {tab === "cost" ? (
            <CostTab
              range={range}
              defaultRange={defaultRange}
              groupBy={groupBy}
              sort={sort}
              onRange={(r) => update({ from: r.from, to: r.to })}
              onGroupBy={(g) => update({ groupBy: g === DEFAULT_GROUP_BY ? null : g })}
              onSort={(s) => update({ sort: s === DEFAULT_COST_SORT ? null : s })}
              onClear={() => update({ from: null, to: null, groupBy: null, sort: null })}
            />
          ) : (
            <ProvidersTab />
          )}
        </TabPanel>
      </div>
    </div>
  );
}
