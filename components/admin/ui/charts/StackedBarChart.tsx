"use client";

import { cn } from "@/lib/cn";
import { niceTicks } from "./ticks";
import { CHART_BG, CHART_TEXT, ChartDataTable, defaultFormat, labelIndices, useChartWidth, type ChartColor } from "./shared";

export type BarSeries = {
  key: string;
  label: string;
  /** Palette slot; defaults to the series position (1-based). */
  color?: ChartColor;
};

export type BarDatum = {
  label: string;
  /** Value per series key; missing keys count as 0. */
  values: Readonly<Record<string, number>>;
};

const T = 12;
const B = 26;
const R = 10;

const slot = (s: BarSeries, i: number): ChartColor => s.color ?? (((i % 5) + 1) as ChartColor);

/** Stacked columns per day (e.g. completed / failed jobs) with a legend. */
export function StackedBarChart({
  data,
  series,
  title,
  formatValue = defaultFormat,
  height = 200,
}: {
  data: ReadonlyArray<BarDatum>;
  series: ReadonlyArray<BarSeries>;
  title: string;
  formatValue?: (n: number) => string;
  height?: number;
}) {
  const [ref, W] = useChartWidth();
  const n = data.length;
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const { ticks, hi } = niceTicks(0, Math.max(1, ...totals), 3);
  const tickTexts = ticks.map(formatValue);
  const L = Math.max(...tickTexts.map((t) => t.length), 1) * 6.2 + 14;

  const slotW = n > 0 ? (W - L - R) / n : 0;
  const bw = Math.max(1, Math.min(slotW - 3, 40));
  const y = (v: number) => T + (height - T - B) * (1 - v / hi);
  const labelIdx = labelIndices(n, Math.max(2, Math.floor((W - L - R) / 72)));

  return (
    <figure ref={ref} className="m-0 flex w-full flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} className="block h-auto w-full">
        <title>{title}</title>
        {ticks.map((t, i) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10.5px]">
              {tickTexts[i]}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          let acc = 0;
          const x0 = L + i * slotW + (slotW - bw) / 2;
          return (
            <g key={i}>
              {series.map((s, si) => {
                const v = d.values[s.key] ?? 0;
                if (v <= 0) return null;
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return (
                  <rect key={s.key} x={x0} y={top} width={bw} height={Math.max(h, 0)} rx={2} fill="currentColor" className={CHART_TEXT[slot(s, si)]} />
                );
              })}
            </g>
          );
        })}
        {labelIdx.map((i) => (
          <text key={i} x={L + i * slotW + slotW / 2} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">
            {data[i].label}
          </text>
        ))}
        {n === 0 ? (
          <text x={W / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground text-xs">
            Ma&apos;lumot yo&apos;q
          </text>
        ) : null}
      </svg>
      <ul className="text-muted-foreground m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", CHART_BG[slot(s, i)])} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption={title}
        head={["Sana", ...series.map((s) => s.label)]}
        rows={data.map((d) => [d.label, ...series.map((s) => formatValue(d.values[s.key] ?? 0))])}
      />
    </figure>
  );
}
