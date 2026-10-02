"use client";

import { cn } from "@/lib/cn";
import { niceTicks } from "./ticks";
import { CHART_TEXT, ChartDataTable, defaultFormat, labelIndices, useChartWidth, type ChartColor } from "./shared";

export type LinePoint = { label: string; value: number };

const T = 12;
const B = 26;
const R = 14;

/**
 * Area + line chart for one series over time: gridlines, labelled ticks,
 * an endpoint dot on the latest value. Responsive via `viewBox`; the colour
 * comes from the chart tokens (`currentColor`).
 */
export function LineChart({
  points,
  title,
  color = 1,
  formatValue = defaultFormat,
  valueLabel = "Qiymat",
  height = 200,
}: {
  points: ReadonlyArray<LinePoint>;
  /** Accessible name, also used as the SVG `<title>`. */
  title: string;
  color?: ChartColor;
  formatValue?: (n: number) => string;
  /** Column name in the screen-reader data table. */
  valueLabel?: string;
  height?: number;
}) {
  const [ref, W] = useChartWidth();
  const n = points.length;
  const values = points.map((p) => p.value);
  // The axis always includes 0. Small positive ranges (e.g. a few cents of USD) get
  // their own nice ticks; only an empty or all-zero series falls back to 0..1, so the
  // domain never collapses to a single value.
  const minV = Math.min(0, ...values);
  const dataMax = Math.max(0, ...values);
  const maxV = dataMax > minV ? dataMax : minV + 1;
  const nice = niceTicks(minV, maxV, 4);
  const { lo, hi } = nice;
  // Decimal steps accumulate float error (0.1 * 3 = 0.30000000000000004); keep the tick
  // values themselves clean for the labels and React keys.
  const ticks = nice.ticks.map((t) => Number(t.toPrecision(12)));
  const tickTexts = ticks.map(formatValue);
  const L = Math.max(...tickTexts.map((t) => t.length), 1) * 6.2 + 14;

  const x = (i: number) => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (height - T - B) * (1 - (v - lo) / (hi - lo));
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[n - 1];
  const labelIdx = labelIndices(n, Math.max(2, Math.floor((W - L - R) / 72)));

  return (
    <figure ref={ref} className={cn("m-0 w-full", CHART_TEXT[color])}>
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
        {n > 0 ? (
          <>
            {labelIdx.map((i) => (
              <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">
                {points[i].label}
              </text>
            ))}
            {n > 1 ? (
              <polygon points={`${x(0)},${y(Math.max(lo, 0))} ${line} ${x(n - 1)},${y(Math.max(lo, 0))}`} fill="currentColor" opacity={0.12} />
            ) : null}
            <polyline points={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(n - 1)} cy={y(last.value)} r={4} fill="currentColor" className="stroke-card" strokeWidth={2} />
          </>
        ) : (
          <text x={W / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground text-xs">
            Ma&apos;lumot yo&apos;q
          </text>
        )}
      </svg>
      <ChartDataTable
        caption={title}
        head={["Sana", valueLabel]}
        rows={points.map((p) => [p.label, formatValue(p.value)])}
      />
    </figure>
  );
}
