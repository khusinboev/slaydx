"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { fmtNumber } from "@/lib/admin-format";

/** Index into the `--chart-1`...`--chart-5` palette. */
export type ChartColor = 1 | 2 | 3 | 4 | 5;

// Full literal class names so Tailwind's scanner emits them.
export const CHART_TEXT: Record<ChartColor, string> = {
  1: "text-chart-1",
  2: "text-chart-2",
  3: "text-chart-3",
  4: "text-chart-4",
  5: "text-chart-5",
};

export const CHART_BG: Record<ChartColor, string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
};

export const defaultFormat = (n: number): string => fmtNumber(n, { digits: 2 });

/**
 * Tracks the container width so the SVG `viewBox` matches the rendered size:
 * axis text then stays at its real pixel size instead of shrinking with the
 * chart on a phone. Falls back to `fallback` until measured (SSR, jsdom).
 */
export function useChartWidth(fallback = 640): [RefObject<HTMLElement | null>, number] {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0) setWidth(Math.min(Math.max(w, 240), 1400));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Screen-reader copy of the plotted data. */
export function ChartDataTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: ReadonlyArray<string>;
  rows: ReadonlyArray<ReadonlyArray<string>>;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (j === 0 ? (
              <th key={j} scope="row">
                {c}
              </th>
            ) : (
              <td key={j}>{c}</td>
            )))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Evenly spread label indices (always including the first and last point), at most `max` of them. */
export function labelIndices(n: number, max: number): number[] {
  if (n <= 0) return [];
  const m = Math.max(1, Math.min(n, max));
  if (m === 1) return [0];
  const out = new Set<number>();
  for (let k = 0; k < m; k++) out.add(Math.round((k * (n - 1)) / (m - 1)));
  return [...out];
}
