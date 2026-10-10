"use client";

import { useCallback, useState } from "react";
import { getPricingDetail, type PricingDetail, type PricingItem, type PricingItemResult } from "@/lib/admin-api/pricing";
import { fmtDate, fmtNumber } from "@/lib/admin-format";
import { Badge, Button, Card, CardBody, CardHeader, Drawer, ErrorState, Forbidden, KeyValueList, LineChart, Skeleton } from "@/components/admin/ui";
import { permissionLabel, useCan } from "@/components/admin/shell";
import { LadderCompare } from "./LadderCompare";
import { PriceEditDialog } from "./PriceEditDialog";
import { PriceResetDialog } from "./PriceResetDialog";
import { Simulator } from "./Simulator";
import {
  isDefaultAdjust,
  marginTone,
  markupText,
  pctText,
  percentLabel,
  recommendationOf,
  recommendationText,
  roundToText,
  shortDay,
  soumText,
  tangaText,
  useLoad,
} from "./shared";

const TREND_DAYS = 90;

/**
 * Row drawer (§17.6): the headline figures of the overview row, the 90-day
 * cost trend, the ladder base → effective, the simulator, the change history
 * and — with `pricing.edit` — "O'zgartirish" and "100% ga qaytarish".
 */
export function PricingDrawer({
  item,
  includeAdmins,
  paymentFeePercent,
  onClose,
  onChanged,
  onStale,
}: {
  item: PricingItem;
  /** The page's «Adminlar bilan» switch: the trend and the simulator follow it. */
  includeAdmins: boolean;
  /** `pricing.payment_fee_percent` the page's margin was computed with. */
  paymentFeePercent: number;
  onClose: () => void;
  /** A successful PUT/DELETE: the overview swaps in the new adjustment and ladder. */
  onChanged: (result: PricingItemResult) => void;
  /** The server state differs from what is shown (409): reload the overview. */
  onStale: () => void;
}) {
  const canEdit = useCan("pricing.edit");
  const [dialog, setDialog] = useState<"edit" | "reset" | null>(null);
  const toolId = item.toolId;
  const load = useCallback((signal: AbortSignal) => getPricingDetail(toolId, TREND_DAYS, { signal, includeAdmins }), [toolId, includeAdmins]);
  const [state, retry] = useLoad<PricingDetail>(load);
  const detail = state.status === "ready" ? state.data : null;
  // History comes from the drawer load, then from the last mutation's answer.
  const [history, setHistory] = useState<PricingItemResult["history"] | null>(null);
  const shownHistory = history ?? detail?.history ?? null;
  const rec = recommendationOf(item);

  const applied = (result: PricingItemResult) => {
    setHistory(result.history);
    onChanged(result);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={item.title}
      description={`Narx · birlik: ${item.unitLabel}`}
      footer={
        canEdit ? (
          <>
            <Button variant="danger" onClick={() => setDialog("reset")} disabled={isDefaultAdjust(item.adjust)}>
              100% ga qaytarish
            </Button>
            <Button variant="primary" onClick={() => setDialog("edit")}>
              O&apos;zgartirish
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Faqat ko&apos;rish rejimi: narxni o&apos;zgartirish uchun «{permissionLabel("pricing.edit")}» ruxsati kerak.</span>
        )
      }
    >
      <KeyValueList
        items={[
          {
            label: "Joriy tuzatish",
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={isDefaultAdjust(item.adjust) ? "neutral" : "primary"}>{percentLabel(item.adjust.percent)}</Badge>
                <span className="text-muted-foreground text-xs">yaxlitlash {roundToText(item.adjust.roundTo)}</span>
              </span>
            ),
          },
          { label: "O'rtacha narx (barcha buyurtmalar)", value: `${tangaText(item.avgPrice)} / ish` },
          { label: "Tushum (ro'yxat narxi)", value: `${tangaText(item.avgRevenue)} / tugallangan ish` },
          { label: "Naqd tushum", value: `${tangaText(item.avgCashRevenue)} / ish` },
          {
            label: "To'liq tannarx",
            value: `${soumText(item.fullCostSoum)} / ish · ${soumText(item.costPerUnitSoum)} / ${item.unitLabel}`,
          },
          {
            label: "Ustama · marja",
            value: (
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                {markupText(item.markup)}
                <Badge tone={marginTone(item.marginPct)}>{pctText(item.marginPct, 0)}</Badge>
                <span className="text-muted-foreground text-xs">ro&apos;yxat narxi − tannarx − komissiya {pctText(paymentFeePercent)}</span>
              </span>
            ),
          },
          {
            label: "Naqd marja",
            value: (
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                {pctText(item.cashMarginPct, 0)}
                <span className="text-muted-foreground text-xs">faqat naqd pul tushumi bo&apos;yicha</span>
              </span>
            ),
          },
          {
            label: "Bonus xarajati",
            value: (
              <span className="flex flex-wrap items-center gap-2 tabular-nums">
                {soumText(item.bonusCostSoum)}
                <span className="text-muted-foreground text-xs">ball ulushi {pctText(item.pointsSharePct, 0)} — ball bilan to&apos;langan ishlarning tannarxi</span>
              </span>
            ),
          },
          {
            label: "Tavsiya",
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={rec.kind === "ok" ? "success" : rec.kind === "up" ? (item.marginPct !== null && item.marginPct < 30 ? "danger" : "warning") : rec.kind === "down" ? "info" : "neutral"}>
                  {recommendationText(rec)}
                </Badge>
                {item.confidence === "low" ? <Badge tone="neutral">kam ishonch</Badge> : null}
                <span className="text-muted-foreground text-xs">tanlama: {fmtNumber(item.sampleSize)} ta tayyor ish</span>
              </span>
            ),
          },
          {
            label: "Ishlar",
            value: `${fmtNumber(item.jobs)} · xato ${pctText(item.failRate)} · qamrov ${pctText(item.coveragePct)}`,
          },
        ]}
      />

      <Card>
        <CardHeader as="h3" title="Narx pog'onalari" description="Asosiy narx — kod formulasi; amaldagi — tuzatish bilan." />
        <CardBody>
          <LadderCompare current={item.ladder} caption="Narx pog'onalari: asosiy va amaldagi" />
        </CardBody>
      </Card>

      <Card>
        <CardHeader as="h3" title={`Tannarx trendi · ${TREND_DAYS} kun`} description="so'm / ish, Toshkent kunlari bo'yicha" />
        <CardBody>
          {state.status === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : state.status === "forbidden" ? (
            <Forbidden />
          ) : state.status === "error" ? (
            <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
          ) : (
            <LineChart
              title={`${item.title}: ${TREND_DAYS} kunlik tannarx trendi (so'm / ish)`}
              color={4}
              valueLabel="Tannarx"
              formatValue={(n) => fmtNumber(Math.round(n))}
              points={state.data.trend.map((p) => ({ label: shortDay(p.day), value: p.avgCostSoum ?? 0 }))}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader as="h3" title="Simulyator" aside={<span className="text-muted-foreground text-xs">saqlanmaydi</span>} />
        <CardBody>
          <Simulator item={item} ladder={item.ladder} includeAdmins={includeAdmins} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader as="h3" title="O'zgarishlar tarixi" />
        <CardBody>
          {shownHistory === null ? (
            state.status === "loading" ? (
              <Skeleton className="h-10 w-full" />
            ) : null
          ) : shownHistory.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">Hali o&apos;zgartirilmagan — 100% (kod formulasi).</p>
          ) : (
            <ol className="flex flex-col gap-2 text-[13px]">
              {shownHistory.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b pb-2 last:border-b-0">
                  <span className="min-w-0">
                    <b className="tabular-nums">
                      {percentLabel(h.oldPercent)} → {percentLabel(h.newPercent)}
                    </b>
                    {h.oldRoundTo !== h.newRoundTo ? (
                      <span className="text-muted-foreground tabular-nums">
                        {" "}
                        · yaxlitlash {fmtNumber(h.oldRoundTo)} → {roundToText(h.newRoundTo)}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground"> · {h.admin ?? "o'chirilgan admin"}</span>
                    <span className="text-muted-foreground block text-xs">{h.reason}</span>
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">{fmtDate(h.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>

      <PriceEditDialog
        open={dialog === "edit"}
        toolId={toolId}
        title={item.title}
        adjust={item.adjust}
        ladder={item.ladder}
        includeAdmins={includeAdmins}
        onClose={() => setDialog(null)}
        onSaved={applied}
      />
      <PriceResetDialog
        open={dialog === "reset"}
        toolId={toolId}
        title={item.title}
        adjust={item.adjust}
        ladder={item.ladder}
        onClose={() => setDialog(null)}
        onReset={applied}
        onStale={onStale}
      />
    </Drawer>
  );
}
