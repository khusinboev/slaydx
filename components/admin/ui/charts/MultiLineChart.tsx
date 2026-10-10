"use client";

import { cn } from "@/lib/cn";
import { niceTicks } from "./ticks";
import { CHART_BG, CHART_TEXT, ChartDataTable, defaultFormat, labelIndices, useChartWidth, type ChartColor } from "./shared";

export type MultiLineSeries = { key: string; label: string; color?: ChartColor };
export type MultiLinePoint = { label: string; values: Readonly<Record<string, number | null>> };

const T = 12;
const B = 26;
const R = 14;

/**
 * Several lines on one value axis over the same time points (memory and swap in %, one line per
 * container). A `null` value is a gap: the line breaks instead of dropping to zero. The axis starts
 * at 0; `yMax` fixes the top (e.g. 100 for percentages) so a quiet server does not look full.
 */
export function MultiLineChart({
  points,
  series,
  title,
  formatValue = defaultFormat,
  yMax,
  height = 200,
}: {
  points: ReadonlyArray<MultiLinePoint>;
  series: ReadonlyArray<MultiLineSeries>;
  /** Accessible name, also used as the SVG `<title>`. */
  title: string;
  formatValue?: (n: number) => string;
  yMax?: number;
  height?: number;
}) {
  const [ref, W] = useChartWidth();
  const n = points.length;
  const all = points.flatMap((p) => series.map((s) => p.values[s.key]).filter((v): v is number => typeof v === "number"));
  const dataMax = Math.max(0, ...all);
  const top = yMax ?? (dataMax > 0 ? dataMax : 1);
  const nice = niceTicks(0, top, 4);
  const { lo } = nice;
  const hi = yMax ?? nice.hi;
  const ticks = nice.ticks.map((t) => Number(t.toPrecision(12))).filter((t) => t <= hi + 1e-9);
  const tickTexts = ticks.map(formatValue);
  const L = Math.max(...tickTexts.map((t) => t.length), 1) * 6.2 + 14;

  const x = (i: number) => (n <= 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + (height - T - B) * (1 - (Math.min(v, hi) - lo) / (hi - lo));
  const labelIdx = labelIndices(n, Math.max(2, Math.floor((W - L - R) / 72)));
  const color = (s: MultiLineSeries, i: number): ChartColor => s.color ?? (((i % 5) + 1) as ChartColor);

  /** Runs of consecutive non-null points, each drawn as its own polyline. */
  const runs = (key: string): Array<Array<[number, number]>> => {
    const out: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];
    points.forEach((p, i) => {
      const v = p.values[key];
      if (typeof v === "number") cur.push([i, v]);
      else if (cur.length) {
        out.push(cur);
        cur = [];
      }
    });
    if (cur.length) out.push(cur);
    return out;
  };

  return (
    <figure ref={ref} className="m-0 w-full">
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
            {series.map((s, si) => (
              <g key={s.key} className={CHART_TEXT[color(s, si)]} data-series={s.key}>
                {runs(s.key).map((run, ri) =>
                  run.length === 1 ? (
                    <circle key={ri} cx={x(run[0][0])} cy={y(run[0][1])} r={2.5} fill="currentColor" />
                  ) : (
                    <polyline
                      key={ri}
                      points={run.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ),
                )}
              </g>
            ))}
          </>
        ) : (
          <text x={W / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground text-xs">
            Ma&apos;lumot yo&apos;q
          </text>
        )}
      </svg>
      <ul className="text-muted-foreground m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
        {series.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", CHART_BG[color(s, i)])} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <ChartDataTable
        caption={title}
        head={["Sana", ...series.map((s) => s.label)]}
        rows={points.map((p) => [p.label, ...series.map((s) => (typeof p.values[s.key] === "number" ? formatValue(p.values[s.key] as number) : "—"))])}
      />
    </figure>
  );
}
