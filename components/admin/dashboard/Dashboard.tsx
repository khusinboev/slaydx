"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getOverview, getTools } from "@/lib/admin-api/metrics";
import { fmtIsoDate, todayTashkent } from "@/lib/admin-format";
import { Button, Card, DateRangePicker, EmptyState, ErrorState, Forbidden, type DateRange } from "@/components/admin/ui";
import { Charts } from "./Charts";
import { isDefaultRange, rangeFromParams } from "./format";
import { KpiGrid, KpiGridSkeleton } from "./KpiGrid";
import { LiveStrip } from "./LiveStrip";
import { ToolsTable } from "./ToolsTable";
import { useLoad } from "./useLoad";

/**
 * S3 `/admin` (docs/admin/02-plan.md §7.1): the landing page after login.
 * The period lives in the URL (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, Tashkent
 * days); without it the last 30 days are shown. Every block loads on its own,
 * so one failing request never blanks the page; a 403 from the overview (the
 * role lost `dashboard.view`) renders "Ruxsat yo'q" instead.
 */
export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname() ?? "/admin";
  const params = useSearchParams();
  const today = todayTashkent();
  const { range } = rangeFromParams(params, today);
  const rangeParams = useMemo(() => ({ from: range.from, to: range.to }), [range.from, range.to]);
  const key = `${range.from}|${range.to}`;

  const setRange = useCallback(
    (next: DateRange) => {
      const sp = new URLSearchParams(params?.toString() ?? "");
      if (isDefaultRange(next, today)) {
        sp.delete("from");
        sp.delete("to");
      } else {
        sp.set("from", next.from);
        sp.set("to", next.to);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router, today],
  );
  const clearRange = useCallback(() => setRange(rangeFromParams(null, today).range), [setRange, today]);

  const [overview, retryOverview] = useLoad(`overview|${key}`, (signal) => getOverview(rangeParams, { signal }));
  const [tools, retryTools] = useLoad(`tools|${key}`, (signal) => getTools(rangeParams, { signal }));

  if (overview.status === "forbidden") return <Forbidden />;

  const prev = overview.status === "ready" ? overview.data.range.previous : null;
  const filtered = !isDefaultRange(range, today);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Bosh sahifa</h1>
          <p className="text-muted-foreground text-[13px]">
            Davr: {fmtIsoDate(range.from)} — {fmtIsoDate(range.to)}
            {prev ? ` · oldingi davr (${fmtIsoDate(prev.from)} — ${fmtIsoDate(prev.to)}) bilan solishtirilgan` : ""}
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </header>

      <LiveStrip />

      {overview.status === "ready" ? (
        <KpiGrid data={overview.data} />
      ) : overview.status === "error" ? (
        <Card>
          <ErrorState message={overview.message} requestId={overview.requestId} onRetry={retryOverview} />
        </Card>
      ) : (
        <KpiGridSkeleton />
      )}

      <Charts range={rangeParams} />

      <section aria-labelledby="dashboard-tools" className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="dashboard-tools" className="flex-1 text-sm font-semibold">
            Vositalar bo&apos;yicha
          </h2>
          <span className="text-muted-foreground text-xs">Soni bo&apos;yicha saralangan</span>
        </div>
        {tools.status === "error" ? (
          <Card>
            <ErrorState message={tools.message} requestId={tools.requestId} onRetry={retryTools} />
          </Card>
        ) : tools.status === "forbidden" ? (
          <Card>
            <Forbidden />
          </Card>
        ) : (
          <ToolsTable
            items={tools.status === "ready" ? tools.data.items : []}
            loading={tools.status === "loading"}
            empty={
              <EmptyState
                title="Bu davrda ish bo'lmagan"
                description="Tanlangan davrda generatsiya, sarf yoki AI xarajati yo'q."
                action={
                  filtered ? (
                    <Button size="sm" onClick={clearRange}>
                      Filtrlarni tozalash
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </section>
    </div>
  );
}
