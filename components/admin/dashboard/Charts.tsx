"use client";

import type { ReactNode } from "react";
import { getSeries, type RangeParams, type Series, type SeriesMetric } from "@/lib/admin-api/metrics";
import { fmtNumber, fmtSoum, fmtUsd } from "@/lib/admin-format";
import { Card, CardBody, CardHeader, ErrorState, Forbidden, LineChart, Skeleton, StackedBarChart } from "@/components/admin/ui";
import { compactNumber, dayLabel } from "./format";
import { useLoad, type LoadState } from "./useLoad";

function useSeries<M extends SeriesMetric>(metric: M, range: RangeParams): [LoadState<Series<M>>, () => void] {
  return useLoad(`${metric}|${range.from}|${range.to}`, (signal) => getSeries(metric, range, { signal }));
}

/** One chart card with its own loading / error / forbidden state. */
function ChartCard<M extends SeriesMetric>({
  title,
  state,
  retry,
  total,
  children,
}: {
  title: string;
  state: LoadState<Series<M>>;
  retry: () => void;
  total?: (s: Series<M>) => string;
  children: (s: Series<M>) => ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader
        title={title}
        aside={state.status === "ready" && total ? <span className="text-muted-foreground tabular-nums">{total(state.data)}</span> : undefined}
      />
      <CardBody>
        {state.status === "loading" ? (
          <div aria-busy="true">
            <Skeleton className="h-[200px] w-full" />
          </div>
        ) : state.status === "forbidden" ? (
          <Forbidden />
        ) : state.status === "error" ? (
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        ) : (
          children(state.data)
        )}
      </CardBody>
    </Card>
  );
}

const sum = <T,>(xs: ReadonlyArray<T>, f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);

/** The four S3 charts: revenue (line), generations (stacked completed/failed), signups, AI cost. */
export function Charts({ range }: { range: RangeParams }) {
  const [revenue, retryRevenue] = useSeries("revenue", range);
  const [gens, retryGens] = useSeries("generations", range);
  const [signups, retrySignups] = useSeries("signups", range);
  const [ai, retryAi] = useSeries("ai_cost", range);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ChartCard title="Kunlik tushum" state={revenue} retry={retryRevenue} total={(s) => fmtSoum(sum(s.points, (p) => p.values.total))}>
        {(s) => (
          <LineChart
            title="Kunlik tushum, so'm"
            valueLabel="Tushum, so'm"
            color={1}
            formatValue={compactNumber}
            points={s.points.map((p) => ({ label: dayLabel(p.day), value: p.values.total }))}
          />
        )}
      </ChartCard>
      <ChartCard
        title="Kunlik generatsiyalar"
        state={gens}
        retry={retryGens}
        total={(s) => `${fmtNumber(sum(s.points, (p) => p.values.total))} ta`}
      >
        {(s) => (
          <StackedBarChart
            title="Kunlik generatsiyalar: tayyor va xato"
            formatValue={(n) => fmtNumber(n)}
            series={[
              { key: "completed", label: "Tayyor", color: 2 },
              { key: "failed", label: "Xato", color: 3 },
            ]}
            data={s.points.map((p) => ({ label: dayLabel(p.day), values: { completed: p.values.completed, failed: p.values.failed } }))}
          />
        )}
      </ChartCard>
      <ChartCard
        title="Kunlik ro'yxatdan o'tish"
        state={signups}
        retry={retrySignups}
        total={(s) => `${fmtNumber(sum(s.points, (p) => p.values.users))} kishi`}
      >
        {(s) => (
          <LineChart
            title="Kunlik yangi foydalanuvchilar"
            valueLabel="Yangi foydalanuvchilar"
            color={4}
            formatValue={(n) => fmtNumber(n, { digits: 1 })}
            points={s.points.map((p) => ({ label: dayLabel(p.day), value: p.values.users }))}
          />
        )}
      </ChartCard>
      <ChartCard title="Kunlik AI xarajat" state={ai} retry={retryAi} total={(s) => fmtUsd(sum(s.points, (p) => p.values.usd))}>
        {(s) => (
          <LineChart
            title="Kunlik AI xarajat, dollar"
            valueLabel="AI xarajat, $"
            color={5}
            formatValue={(n) => fmtUsd(n)}
            points={s.points.map((p) => ({ label: dayLabel(p.day), value: p.values.usd }))}
          />
        )}
      </ChartCard>
    </div>
  );
}
