"use client";

import type { ReactNode } from "react";
import type { PricingItem } from "@/lib/admin-api/pricing";
import { fmtNumber, fmtPercent } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { Badge, DataTable, Sparkline, type Column } from "@/components/admin/ui";
import { MarginChip, MarkupBar, RecommendationAction } from "./bits";
import {
  COVERAGE_WARN_PCT,
  isDefaultAdjust,
  ladderRange,
  listTrendDays,
  pctText,
  percentLabel,
  recommendationState,
  roundToText,
  soumText,
  trendChangePct,
  trendValues,
  type RecContext,
} from "./shared";

/** A cost trend over ±5 % counts as a move; inside it is flat. */
const TREND_FLAT_PCT = 5;

export type ToolListProps = {
  items: ReadonlyArray<PricingItem>;
  days: number;
  sort: string;
  targetMarkup: number;
  recContext: RecContext;
  canEdit: boolean;
  onSortChange: (sort: string) => void;
  onOpen: (item: PricingItem) => void;
  onApply: (item: PricingItem) => void;
  empty: ReactNode;
};

/** Small status chips of a tool: what makes its numbers less certain. */
export function StatusChips({ item }: { item: PricingItem }) {
  const chips: ReactNode[] = [];
  if (item.completed > 0 && item.fullCostSoum === null) chips.push(<Badge key="nc" tone="warning">tannarx yo&apos;q</Badge>);
  else if (item.coveragePct !== null && item.coveragePct < COVERAGE_WARN_PCT) chips.push(<Badge key="cov" tone="warning">qamrov {pctText(item.coveragePct, 0)}</Badge>);
  if (item.unpricedCalls > 0) chips.push(<Badge key="up" tone="warning">narxsiz xizmat</Badge>);
  if (item.completed > 0 && item.confidence === "low") chips.push(<Badge key="lc">kam ishonch</Badge>);
  if (item.completed === 0) chips.push(<Badge key="nd">ish yo&apos;q</Badge>);
  return chips.length ? <span className="flex flex-wrap gap-1">{chips}</span> : null;
}

/** «3 500 – 9 500» and, when the tool is adjusted, its percent and the base range. */
function PriceCell({ item }: { item: PricingItem }) {
  const adjusted = !isDefaultAdjust(item.adjust);
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className={cn("tabular-nums", adjusted && "font-semibold")}>{ladderRange(item.ladder, "effective")}</span>
      <span className="text-muted-foreground text-xs whitespace-nowrap" title={adjusted ? `Yaxlitlash ${roundToText(item.adjust.roundTo)}` : undefined}>
        {adjusted ? `${percentLabel(item.adjust.percent)} · asosiy ${ladderRange(item.ladder, "base")}` : "asosiy narx"}
      </span>
    </span>
  );
}

function TrendCell({ item, days }: { item: PricingItem; days: number }) {
  const change = trendChangePct(item.trend);
  const up = change !== null && change > TREND_FLAT_PCT;
  const down = change !== null && change < -TREND_FLAT_PCT;
  return (
    <span className="inline-flex items-center gap-2">
      <Sparkline
        values={trendValues(item.trend)}
        title={`${item.title}: ${fmtNumber(days)} kunlik tannarx trendi`}
        color={up ? 2 : 4}
        width={56}
        height={24}
        formatValue={(n) => fmtNumber(Math.round(n))}
      />
      <span className={cn("text-xs tabular-nums", up ? "text-destructive" : down ? "text-badge-success-text" : "text-muted-foreground")}>
        {change === null ? "—" : fmtPercent(change, { digits: 0, sign: true })}
      </span>
    </span>
  );
}

/** Phone card: the same facts as a row, stacked; one tap opens the tool. */
function ToolCard({ item, targetMarkup, recContext, canEdit, onApply }: { item: PricingItem; targetMarkup: number; recContext: RecContext; canEdit: boolean; onApply: () => void }) {
  const rec = recommendationState(item, recContext);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <b className="block text-[14px]">{item.title}</b>
          <span className="text-muted-foreground text-xs tabular-nums">
            {ladderRange(item.ladder, "effective")} tanga
            {isDefaultAdjust(item.adjust) ? "" : ` · ${percentLabel(item.adjust.percent)}`}
          </span>
        </span>
        <MarginChip marginPct={item.marginPct} />
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        Tannarx {soumText(item.fullCostSoum)} / ish · {fmtNumber(item.jobs)} ish
      </span>
      <MarkupBar markup={item.markup} target={targetMarkup} />
      <StatusChips item={item} />
      {rec.kind === "change" ? <RecommendationAction rec={rec} title={item.title} canEdit={canEdit} onApply={onApply} size="md" /> : null}
    </div>
  );
}

/**
 * One row per tool (desktop) / one card per tool (phone). Seven columns, each answering
 * one question: what it costs us, what we charge, what is left, what to do.
 */
export function PricingTable({ items, days, sort, targetMarkup, recContext, canEdit, onSortChange, onOpen, onApply, empty }: ToolListProps) {
  const trendDays = listTrendDays(days);
  const columns: Column<PricingItem>[] = [
    {
      id: "tool",
      header: "Vosita",
      cell: (r) => (
        <span className="flex min-w-[9rem] flex-col gap-1">
          <span>
            <b>{r.title}</b>
            <span className="text-muted-foreground block text-xs">birlik: {r.unitLabel}</span>
          </span>
          <StatusChips item={r} />
        </span>
      ),
    },
    {
      id: "price",
      header: "Narx, tanga",
      info: "Amaldagi narx pog'onalari (eng arzon – eng qimmat). Foiz — asosiy (kod formulasi) narxga tuzatish.",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => <PriceCell item={r} />,
    },
    {
      id: "cost",
      header: "Tannarx / ish",
      info: "Tayyor ishning o'rtacha AI xarajati + xato ishlar xarajatining ulushi, so'mda.",
      align: "right",
      sortKey: "cost_desc",
      sortKeyReverse: "cost_asc",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span>{soumText(r.fullCostSoum)}</span>
          {r.costPerUnitSoum !== null ? (
            <span className="text-muted-foreground text-xs">
              {soumText(r.costPerUnitSoum)} / {r.unitLabel}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "margin",
      header: "Marja · ustama",
      info: "Marja: narx − tannarx − to'lov komissiyasi, narxdan foizda (ball bilan to'langan ishlar ham). Chiziq: ustama (narx ÷ tannarx) va maqsad belgisi.",
      sortKey: "margin_asc",
      sortKeyReverse: "margin_desc",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1.5">
          <MarginChip marginPct={r.marginPct} />
          <MarkupBar markup={r.markup} target={targetMarkup} />
        </span>
      ),
    },
    {
      id: "rec",
      header: "Tavsiya",
      info: "Narxni qancha o'zgartirsa ustama maqsadga yetadi. «Qo'llash» — o'zgarishni ko'rsatib, sabab so'raydi.",
      cell: (r) => <RecommendationAction rec={recommendationState(r, recContext)} title={r.title} canEdit={canEdit} onApply={() => onApply(r)} showLabel={false} />,
    },
    {
      id: "jobs",
      header: "Ishlar",
      info: `Davrda yaratilgan ishlar (${fmtNumber(days)} kun) va tugaganlar ichida xato ulushi.`,
      align: "right",
      sortKey: "volume_desc",
      sortKeyReverse: "volume_asc",
      className: "tabular-nums whitespace-nowrap",
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5">
          <span>{fmtNumber(r.jobs)}</span>
          <span className="text-muted-foreground text-xs">xato {pctText(r.failRate, 0)}</span>
        </span>
      ),
    },
    {
      id: "trend",
      header: `Tannarx, ${fmtNumber(trendDays)} kun`,
      className: "whitespace-nowrap",
      cell: (r) => <TrendCell item={r} days={trendDays} />,
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
      onRowClick={onOpen}
      empty={empty}
      maxHeightClass="max-h-none"
      renderCard={(r) => <ToolCard item={r} targetMarkup={targetMarkup} recContext={recContext} canEdit={canEdit} onApply={() => onApply(r)} />}
    />
  );
}
