"use client";

import type { ReactNode } from "react";
import type { ToolRow } from "@/lib/admin-api/metrics";
import { fmtDuration, fmtNumber, fmtPercent, fmtTanga, fmtUsd } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { DataTable, type Column } from "@/components/admin/ui";

/** Failure rate above this is highlighted (as in the prototype). */
const HIGH_FAIL_RATE = 5;

function ShareBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bg-muted h-1.5 w-full min-w-[80px] overflow-hidden rounded-full" aria-hidden="true">
      <div className="bg-chart-1 h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * "Vositalar bo'yicha": rows come sorted by job count from the server (§7.1
 * S3); no other sort is offered. Free-AI rows (no jobs) carry only AI cost.
 */
export function ToolsTable({ items, loading, empty }: { items: ReadonlyArray<ToolRow>; loading: boolean; empty: ReactNode }) {
  const max = Math.max(0, ...items.map((i) => i.count));
  const columns: Column<ToolRow>[] = [
    { id: "title", header: "Vosita", cell: (r) => <span className="font-medium">{r.title}</span> },
    { id: "count", header: "Soni", align: "right", className: "tabular-nums", cell: (r) => fmtNumber(r.count) },
    { id: "share", header: "Ulush", className: "min-w-[110px]", hideOnCard: true, cell: (r) => <ShareBar value={r.count} max={max} /> },
    {
      id: "failRate",
      header: "Xato %",
      align: "right",
      className: "tabular-nums",
      cell: (r) => (
        <span className={cn(r.failRate !== null && r.failRate > HIGH_FAIL_RATE && "text-destructive font-semibold")}>
          {r.failRate === null ? "—" : fmtPercent(r.failRate)}
        </span>
      ),
    },
    { id: "cash", header: "Naqd sarf", align: "right", className: "tabular-nums whitespace-nowrap", cell: (r) => fmtTanga(r.cashSpend) },
    { id: "ai", header: "AI xarajat", align: "right", className: "tabular-nums", cell: (r) => fmtUsd(r.aiCostUsd) },
    {
      id: "aiPerJob",
      header: "AI $ / tayyor ish",
      align: "right",
      className: "tabular-nums",
      cell: (r) => (r.completed > 0 ? fmtUsd(r.aiCostUsd / r.completed) : "—"),
    },
    {
      id: "duration",
      header: "O'rtacha vaqt",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => (r.avgDurationSec === null ? "—" : fmtDuration(r.avgDurationSec)),
    },
  ];
  return (
    <DataTable
      caption="Vositalar bo'yicha ko'rsatkichlar"
      columns={columns}
      rows={items}
      rowKey={(r) => r.toolId}
      loading={loading}
      skeletonRows={6}
      empty={empty}
      maxHeightClass="max-h-none"
    />
  );
}
