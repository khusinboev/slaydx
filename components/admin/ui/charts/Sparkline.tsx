"use client";

import { cn } from "@/lib/cn";
import { CHART_TEXT, defaultFormat, type ChartColor } from "./shared";

const PAD = 3;

/** Tiny trend line for table cells and KPI tiles; no axes. */
export function Sparkline({
  values,
  title,
  color = 1,
  width = 96,
  height = 28,
  formatValue = defaultFormat,
}: {
  values: ReadonlyArray<number>;
  title: string;
  color?: ChartColor;
  width?: number;
  height?: number;
  formatValue?: (n: number) => string;
}) {
  const n = values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (n <= 1 ? width / 2 : PAD + (i * (width - 2 * PAD)) / (n - 1));
  const y = (v: number) => (max === min ? height / 2 : PAD + (height - 2 * PAD) * (1 - (v - min) / span));
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    // `relative` anchors the absolutely positioned sr-only wrapper to the figure.
    <figure className={cn("relative m-0 inline-block align-middle", CHART_TEXT[color])}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={title} className="block max-w-full">
        <title>{title}</title>
        {n > 1 ? <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {n > 0 ? <circle cx={x(n - 1)} cy={y(values[n - 1])} r={2.2} fill="currentColor" /> : null}
      </svg>
      {/*
        The data table is wrapped, not marked `sr-only` itself: a table ignores the
        1px width and `overflow: hidden`, so a long row still widened the page
        (773 px of horizontal overflow on /admin/pricing). The wrapping block
        clips it, so it no longer adds to the page's scrollable area.
      */}
      <div className="sr-only">
        <table>
          <caption>{title}</caption>
          <tbody>
            <tr>
              {values.map((v, i) => (
                <td key={i}>{formatValue(v)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </figure>
  );
}
