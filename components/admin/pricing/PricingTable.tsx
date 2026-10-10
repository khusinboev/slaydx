"use client";

import type { ReactNode } from "react";
import type { PricingItem } from "@/lib/admin-api/pricing";
import { fmtNumber, fmtPercent } from "@/lib/admin-format";
import { Badge, DataTable, Sparkline, type Column } from "@/components/admin/ui";
import {
  isDefaultAdjust,
  ladderRange,
  listTrendDays,
  marginTone,
  markupText,
  pctText,
  percentLabel,
  recommendationOf,
  recommendationText,
  roundToText,
  soumText,
  trendChangePct,
  trendValues,
} from "./shared";

/** The recommendation chip (§17.6): "Mos", "+20 % tavsiya", "−10 % tavsiya", plus "kam ishonch" below 20 completed jobs. */
export function RecommendationChip({ item }: { item: PricingItem }) {
  const rec = recommendationOf(item);
  const tone = rec.kind === "ok" ? "success" : rec.kind === "up" ? (item.marginPct !== null && item.marginPct < 30 ? "danger" : "warning") : rec.kind === "down" ? "info" : "neutral";
  const tip =
    rec.kind === "none"
      ? "Tavsiya uchun ustama ma'lum emas (xarajat yoki narx yo'q)"
      : `Tavsiya: ${percentLabel(rec.percent)} (ustama ${markupText(item.markup)}) · tanlama: ${fmtNumber(item.sampleSize)} ta tayyor ish`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={tip}>
      <Badge tone={tone}>{recommendationText(rec)}</Badge>
      {item.confidence === "low" ? <Badge tone="neutral">kam ishonch</Badge> : null}
    </span>
  );
}

function Stacked({ main, sub }: { main: ReactNode; sub: ReactNode }) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>{main}</span>
      <span className="text-muted-foreground text-xs">{sub}</span>
    </span>
  );
}

/** One row per tool (§17.6); sortable by margin, cost and volume; row click opens the drawer. */
export function PricingTable({
  items,
  days,
  sort,
  onSortChange,
  onRowClick,
  empty,
}: {
  items: ReadonlyArray<PricingItem>;
  days: number;
  sort: string;
  onSortChange: (sort: string) => void;
  onRowClick: (item: PricingItem) => void;
  empty: ReactNode;
}) {
  const trendDays = listTrendDays(days);
  const columns: Column<PricingItem>[] = [
    {
      id: "tool",
      header: "Vosita",
      cell: (r) => (
        <span className="flex flex-col">
          <b>{r.title}</b>
          <span className="text-muted-foreground text-xs">birlik: {r.unitLabel}</span>
        </span>
      ),
    },
    {
      id: "adjust",
      header: "Tuzatish",
      cell: (r) =>
        isDefaultAdjust(r.adjust) ? (
          <Badge tone="neutral">100%</Badge>
        ) : (
          <Badge tone="primary" title={`Yaxlitlash ${roundToText(r.adjust.roundTo)}`}>
            {r.adjust.percent > 100 ? "▲" : "▼"} {percentLabel(r.adjust.percent)}
          </Badge>
        ),
    },
    {
      // Effective ladder on top, the code-formula base under it: one column instead of two,
      // so the whole table fits the 956 px card at 1280.
      id: "price",
      header: "Narx, tanga",
      align: "right",
      className: "tabular-nums whitespace-nowrap text-xs",
      cell: (r) => (
        <Stacked
          main={<span className={isDefaultAdjust(r.adjust) ? undefined : "font-semibold"}>{ladderRange(r.ladder, "effective")}</span>}
          sub={isDefaultAdjust(r.adjust) ? "asosiy narx" : `asosiy ${ladderRange(r.ladder, "base")}`}
        />
      ),
    },
    {
      id: "cost",
      header: "Tannarx",
      hint: "to'liq: xato ishlar bilan",
      align: "right",
      sortKey: "cost_desc",
      sortKeyReverse: "cost_asc",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => <Stacked main={`${soumText(r.fullCostSoum)} / ish`} sub={`${soumText(r.costPerUnitSoum)} / ${r.unitLabel}`} />,
    },
    { id: "markup", header: "Ustama ×", hint: "tushum ÷ tannarx", align: "right", className: "tabular-nums", cell: (r) => markupText(r.markup) },
    {
      id: "margin",
      header: "Marja % · tavsiya",
      // The primary margin: the listed price of the completed jobs (points included), less cost and the payment fee.
      hint: "narx (ball ham) − tannarx − komissiya",
      sortKey: "margin_asc",
      sortKeyReverse: "margin_desc",
      // The recommendation sits under the margin it is derived from (§17.6 chip).
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={marginTone(r.marginPct)}>{pctText(r.marginPct, 0)}</Badge>
          <RecommendationChip item={r} />
        </span>
      ),
    },
    {
      // The earlier formula, kept beside the primary one. Plain text, not a traffic-light badge: the cash margin is
      // low by construction wherever points pay for the jobs, which is not a pricing problem. The bonus cost (what
      // the jobs paid with points cost) is its second line: one column, so the table still fits the card at 1280.
      id: "cash-margin",
      header: "Naqd marja · bonus",
      hint: "naqd tushum bo'yicha · bonus = ball bilan to'langan ishlar tannarxi",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span>{pctText(r.cashMarginPct, 0)}</span>
          <span className="text-muted-foreground text-xs">bonus {soumText(r.bonusCostSoum)}</span>
          <span className="text-muted-foreground text-xs">ball ulushi {pctText(r.pointsSharePct, 0)}</span>
        </span>
      ),
    },
    {
      id: "jobs",
      header: `Ishlar (${fmtNumber(days)} kun)`,
      align: "right",
      sortKey: "volume_desc",
      sortKeyReverse: "volume_asc",
      className: "tabular-nums",
      cell: (r) => <Stacked main={fmtNumber(r.jobs)} sub={`xato ${pctText(r.failRate)}`} />,
    },
    {
      id: "trend",
      header: "Trend",
      hint: `tannarx, ${fmtNumber(trendDays)} kun`,
      hideOnCard: true,
      className: "whitespace-nowrap",
      cell: (r) => {
        const change = trendChangePct(r.trend);
        return (
          <span className="inline-flex items-center gap-2">
            <Sparkline values={trendValues(r.trend)} title={`${r.title}: ${fmtNumber(trendDays)} kunlik tannarx trendi`} color={change !== null && change > 5 ? 2 : 4} width={56} height={24} formatValue={(n) => fmtNumber(Math.round(n))} />
            <span className={`text-xs tabular-nums ${change === null ? "text-muted-foreground" : change > 5 ? "text-destructive" : change < -5 ? "text-badge-success-text" : "text-muted-foreground"}`}>
              {change === null ? "—" : fmtPercent(change, { digits: 0, sign: true })}
            </span>
          </span>
        );
      },
    },
  ];

  return (
    <DataTable
      caption="Vositalar bo'yicha narx va tannarx"
      columns={columns}
      rows={items}
      rowKey={(r) => r.toolId}
      sort={sort}
      onSortChange={onSortChange}
      onRowClick={onRowClick}
      empty={empty}
      maxHeightClass="max-h-[70vh]"
    />
  );
}
