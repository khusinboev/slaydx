"use client";

import { useCallback } from "react";
import { getAiCost, type AiCostResponse, type AiCostRow, type AiGroupBy } from "@/lib/admin-api/ai";
import { fmtNumber, fmtPercent } from "@/lib/admin-format";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  KpiTile,
  LineChart,
  Segmented,
  Skeleton,
  type Column,
  type DateRange,
} from "@/components/admin/ui";
import {
  DEFAULT_GROUP_BY,
  GROUP_BY_OPTIONS,
  KEY_HEADER,
  keyText,
  numText,
  parseCostSort,
  shortDay,
  soumText,
  sortCostRows,
  usdText,
  useLoad,
  useReportForbidden,
} from "./shared";

type CostData = { table: AiCostResponse; daily: AiCostResponse };

/** Coverage at or above this share of completed jobs is reported as healthy. */
const COVERAGE_OK_PCT = 95;

/** Tab "Xarajat": group-by selector, sortable table, daily chart, coverage banner with the caveats. */
export function CostTab({
  range,
  defaultRange,
  groupBy,
  sort,
  onRange,
  onGroupBy,
  onSort,
  onClear,
  onForbidden,
}: {
  range: DateRange;
  defaultRange: DateRange;
  groupBy: AiGroupBy;
  sort: string | null;
  onRange: (r: DateRange) => void;
  onGroupBy: (g: AiGroupBy) => void;
  onSort: (sort: string) => void;
  onClear: () => void;
  /** 403: the page drops its tabs. */
  onForbidden?: () => void;
}) {
  const { from, to } = range;
  const load = useCallback(
    async (signal: AbortSignal): Promise<CostData> => {
      // The daily chart always needs the `day` grouping; one request serves both when the table is by day.
      const table = await getAiCost({ from, to, groupBy }, { signal });
      const daily = groupBy === "day" ? table : await getAiCost({ from, to, groupBy: "day" }, { signal });
      return { table, daily };
    },
    [from, to, groupBy],
  );
  const [state, retry] = useLoad(load);
  useReportForbidden(state.status === "forbidden", onForbidden);

  const activeFilters = Number(from !== defaultRange.from || to !== defaultRange.to) + Number(groupBy !== DEFAULT_GROUP_BY);

  return (
    <div className="flex flex-col gap-4 pt-4">
      {state.status === "forbidden" ? null : (
      <FilterBar activeCount={activeFilters} onClear={onClear}>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-semibold">Davr</span>
          <DateRangePicker value={range} onChange={onRange} ariaLabel="Xarajat davri" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground text-[11px] font-semibold">Guruhlash</span>
          <Segmented ariaLabel="Guruhlash turi" options={GROUP_BY_OPTIONS} value={groupBy} onChange={(v) => onGroupBy(v as AiGroupBy)} />
        </div>
      </FilterBar>
      )}

      {state.status === "loading" ? (
        <CostSkeleton />
      ) : state.status === "forbidden" ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </Card>
      ) : (
        <CostReady data={state.data} groupBy={groupBy} sort={sort} onSort={onSort} filtered={activeFilters > 0} onClear={onClear} />
      )}
    </div>
  );
}

function CostSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <KpiTile key={i} label="" value="" loading />
        ))}
      </div>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-52 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function CostReady({
  data,
  groupBy,
  sort,
  onSort,
  filtered,
  onClear,
}: {
  data: CostData;
  groupBy: AiGroupBy;
  sort: string | null;
  onSort: (sort: string) => void;
  filtered: boolean;
  onClear: () => void;
}) {
  const { table, daily } = data;
  const { totals, soumPerUsd } = table;
  const parsedSort = parseCostSort(sort);
  const rows = sortCostRows(table.rows, parsedSort);
  const showUnits = groupBy === "provider" || groupBy === "model" || groupBy === "kind";
  const empty = totals.records === 0;

  const columns: Column<AiCostRow>[] = [
    {
      id: "key",
      header: KEY_HEADER[groupBy],
      sortKey: "key_asc",
      sortKeyReverse: "key_desc",
      cell: (r) =>
        r.title ? (
          // Tool grouping: the server-resolved Uzbek title; the raw key stays in the tooltip.
          <span className="break-words" title={r.key}>
            {r.title}
          </span>
        ) : (
          <span className="font-mono text-[12.5px] break-all">{keyText(groupBy, r.key)}</span>
        ),
    },
    { id: "calls", header: "Chaqiruvlar", align: "right", sortKey: "calls_desc", sortKeyReverse: "calls_asc", className: "tabular-nums", cell: (r) => numText(r.calls) },
    { id: "input", header: "Kirish tokenlari", align: "right", sortKey: "input_desc", sortKeyReverse: "input_asc", className: "tabular-nums", cell: (r) => numText(r.inputTokens) },
    { id: "output", header: "Chiqish tokenlari", align: "right", sortKey: "output_desc", sortKeyReverse: "output_asc", className: "tabular-nums", cell: (r) => numText(r.outputTokens) },
    ...(showUnits
      ? [
          {
            id: "units",
            header: "Birlik",
            align: "right" as const,
            sortKey: "units_desc",
            sortKeyReverse: "units_asc",
            className: "tabular-nums",
            cell: (r: AiCostRow) => (r.units === null ? "—" : numText(r.units)),
          },
        ]
      : []),
    {
      id: "usd",
      header: "Xarajat",
      align: "right",
      sortKey: "usd_desc",
      sortKeyReverse: "usd_asc",
      className: "tabular-nums",
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{usdText(r.usd)}</span>
          <span className="text-muted-foreground text-xs">{soumText(r.usd, soumPerUsd)}</span>
          {r.unpricedCalls > 0 ? (
            <Badge tone="warning" title="Narxi noma'lum chaqiruvlar 0 dollar deb yozilgan">
              narx noma&apos;lum: {numText(r.unpricedCalls)}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: "share",
      header: "Ulush",
      hideOnCard: true,
      className: "min-w-[8rem]",
      cell: (r) => {
        const share = totals.usd > 0 ? (r.usd / totals.usd) * 100 : 0;
        return (
          <span className="flex items-center gap-2">
            <span className="bg-muted h-1.5 w-20 overflow-hidden rounded-full" aria-hidden="true">
              <span className="bg-chart-1 block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
            </span>
            <span className="text-muted-foreground w-12 text-xs tabular-nums">{fmtPercent(share)}</span>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="AI xarajat" value={usdText(totals.usd)} hint={`${soumText(totals.usd, soumPerUsd)} · kurs ${fmtNumber(soumPerUsd)} so'm`} />
        <KpiTile label="Chaqiruvlar" value={numText(totals.calls)} hint={`${numText(totals.records)} ta xarajat yozuvi`} />
        <KpiTile label="Kirish tokenlari" value={numText(totals.inputTokens)} />
        <KpiTile label="Chiqish tokenlari" value={numText(totals.outputTokens)} />
      </div>

      <CoverageBanner data={table} />

      {empty ? (
        <Card>
          <EmptyState
            title="Bu oraliqda AI xarajati yo'q"
            description="Tanlangan kunlarda xarajat yozuvi topilmadi."
            action={
              filtered ? (
                <Button size="sm" onClick={onClear}>
                  Filtrlarni tozalash
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Kunlik AI xarajat" aside={<span className="text-sm font-semibold tabular-nums">{usdText(daily.totals.usd)}</span>} />
            <CardBody>
              <LineChart
                title="Kunlik AI xarajat (dollar)"
                color={4}
                valueLabel="Xarajat"
                formatValue={usdText}
                points={daily.rows.map((r) => ({ label: shortDay(r.key), value: r.usd }))}
              />
            </CardBody>
          </Card>
          <DataTable
            caption={`AI xarajat: ${KEY_HEADER[groupBy].toLowerCase()} bo'yicha`}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            sort={parsedSort.value}
            onSortChange={onSort}
            maxHeightClass="max-h-[60vh]"
          />
        </>
      )}
    </>
  );
}

/** Tashkent calendar day (`YYYY-MM-DD`) of an ISO instant. */
const rolloutDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Tashkent" });

/** Coverage of the telemetry plus the known gaps of the data (the server computes them: only what applies). */
function CoverageBanner({ data }: { data: AiCostResponse }) {
  const { coverage, totals, caveats } = data;
  const healthy = coverage.jobsCompleted > 0 && coverage.pct >= COVERAGE_OK_PCT;
  return (
    <section
      aria-label="Qamrov va cheklovlar"
      className={`rounded-xl border px-4 py-3 text-[13px] ${healthy ? "border-success/40 bg-success/10" : "border-warning/50 bg-warning/10"}`}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <strong className="font-semibold">Qamrov: {coverage.jobsCompleted > 0 ? fmtPercent(coverage.pct) : "—"}</strong>
        <span className="text-muted-foreground">
          {coverage.jobsCompleted > 0
            ? `${numText(coverage.jobsCompleted)} ta tugallangan ishning ${numText(coverage.jobsWithCost)} tasida xarajat ma'lumoti bor.`
            : "Bu oraliqda tugallangan ish yo'q."}
        </span>
      </p>
      {coverage.historicalCompleted > 0 && coverage.rolloutAt ? (
        <p className="text-muted-foreground mt-1">
          Qamrov xarajat hisobi ishga tushgan {rolloutDay(coverage.rolloutAt)} dan boshlab hisoblanadi; undan oldin tugagan {numText(coverage.historicalCompleted)} ta ish tarixiy hisoblanadi
          va qamrovga kirmaydi.
        </p>
      ) : null}
      {totals.unpricedCalls > 0 ? (
        <p className="mt-1">
          {numText(totals.unpricedCalls)} ta chaqiruvning narxi noma&apos;lum, ular 0 dollar deb hisoblangan: haqiqiy xarajat ko&apos;rsatilganidan yuqori bo&apos;lishi mumkin.
        </p>
      ) : null}
      {caveats.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold">Hisobga olinmaydigan va taxminiy qismlar ({numText(caveats.length)})</summary>
          <ul className="text-muted-foreground mt-2 ml-4 list-disc space-y-1.5 text-xs">
            {caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
