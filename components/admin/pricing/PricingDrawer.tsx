"use client";

import { useCallback, useState, type ReactNode } from "react";
import { getPricingDetail, type PricingDetail, type PricingItem, type PricingItemResult } from "@/lib/admin-api/pricing";
import { fmtDate, fmtNumber } from "@/lib/admin-format";
import { Button, Drawer, ErrorState, Forbidden, InfoTip, KeyValueList, LineChart, Skeleton } from "@/components/admin/ui";
import { permissionLabel, useCan } from "@/components/admin/shell";
import { CostParts } from "./CostParts";
import { LadderCompare } from "./LadderCompare";
import { PriceEditDialog } from "./PriceEditDialog";
import { PriceResetDialog } from "./PriceResetDialog";
import { Simulator } from "./Simulator";
import { MarginChip, MarkupBar, RecommendationAction } from "./bits";
import {
  REC_BLOCK_HINT,
  isDefaultAdjust,
  ladderRange,
  pctText,
  percentLabel,
  recommendationState,
  roundToText,
  shortDay,
  soumText,
  tangaText,
  useLoad,
  type RecContext,
} from "./shared";

const TREND_DAYS = 90;

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2">
        <h3 className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * The tool sheet (§2.5 of the redesign spec): the decision first — margin, markup against
 * the target and the recommendation with «Qo'llash» — then the economics, what the cost is
 * made of, the ladder, the 90-day cost trend, the simulator and the change history. With
 * `pricing.edit`, «O'zgartirish» and «100% ga qaytarish» in the footer. A bottom sheet on
 * phones, a side panel from `sm` up.
 */
export function PricingDrawer({
  item,
  includeAdmins,
  targetMarkup,
  recContext,
  latest,
  onClose,
  onApply,
  onChanged,
  onStale,
}: {
  item: PricingItem;
  /** The page's «Adminlar bilan» switch: the trend and the simulator follow it. */
  includeAdmins: boolean;
  targetMarkup: number;
  recContext: RecContext;
  /** The last PUT/DELETE answer for this tool (from here or the apply dialog): its history wins over the loaded one. */
  latest: PricingItemResult | undefined;
  onClose: () => void;
  /** Opens the page's apply-recommendation dialog for this tool. */
  onApply: (item: PricingItem) => void;
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
  const shownHistory = latest?.history ?? detail?.history ?? null;
  const rec = recommendationState(item, recContext);

  return (
    <Drawer
      sheet
      open
      onClose={onClose}
      title={item.title}
      description={`${ladderRange(item.ladder, "effective")} tanga · birlik: ${item.unitLabel} · ${fmtNumber(item.jobs)} ish`}
      footer={
        canEdit ? (
          <>
            <Button variant="dangerOutline" onClick={() => setDialog("reset")} disabled={isDefaultAdjust(item.adjust)} className="max-sm:min-h-11">
              100% ga qaytarish
            </Button>
            <Button variant="primary" onClick={() => setDialog("edit")} className="max-sm:min-h-11">
              O&apos;zgartirish
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-xs">Faqat ko&apos;rish rejimi: narxni o&apos;zgartirish uchun «{permissionLabel("pricing.edit")}» ruxsati kerak.</span>
        )
      }
    >
      <section aria-label="Holat" className="bg-muted/40 flex flex-col gap-3 rounded-xl border px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Marja</span>
            <MarginChip marginPct={item.marginPct} digits={1} />
          </span>
          <span className="flex items-center gap-2 text-[13px]">
            <span className="text-muted-foreground">Ustama</span>
            <MarkupBar markup={item.markup} target={targetMarkup} />
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <RecommendationAction rec={rec} title={item.title} canEdit={canEdit} onApply={() => onApply(item)} size="md" />
          <p className="text-muted-foreground text-xs">
            {rec.kind === "change"
              ? `Tuzatish ${percentLabel(item.adjust.percent)} → ${percentLabel(rec.target)}. ${rec.block ? REC_BLOCK_HINT[rec.block] : ""}`
              : rec.kind === "ok"
                ? "Ustama maqsadga yaqin — o'zgartirish shart emas."
                : "Tavsiya uchun ma'lumot yetarli emas (narx yoki tannarx yo'q)."}{" "}
            Tanlama: {fmtNumber(item.sampleSize)} ta tayyor ish.
          </p>
        </div>
      </section>

      <Section title="Iqtisod">
        <KeyValueList
          items={[
            { label: "Tuzatish", value: `${percentLabel(item.adjust.percent)} · yaxlitlash ${roundToText(item.adjust.roundTo)}` },
            { label: "O'rtacha narx", value: `${tangaText(item.avgPrice)} / ish` },
            { label: "Tushum", value: `${tangaText(item.avgRevenue)} / tayyor ish` },
            { label: "Naqd tushum", value: `${tangaText(item.avgCashRevenue)} / ish` },
            { label: "Tannarx", value: `${soumText(item.fullCostSoum)} / ish · ${soumText(item.costPerUnitSoum)} / ${item.unitLabel}` },
            { label: "shundan xato ishlar", value: `${soumText(item.overheadSoum)} / ish` },
            { label: "Naqd marja", value: pctText(item.cashMarginPct, 0) },
            { label: "Bonus xarajati", value: `${soumText(item.bonusCostSoum)} · ball ulushi ${pctText(item.pointsSharePct, 0)}` },
            { label: "Ishlar", value: `${fmtNumber(item.jobs)} · xato ${pctText(item.failRate)} · qamrov ${pctText(item.coveragePct)}` },
          ]}
        />
      </Section>

      <Section
        title="Tannarx tarkibi"
        aside={<InfoTip label="Tannarx tarkibi">Davrdagi AI xarajati qismlar bo&apos;yicha (xato ishlar bilan): qaysi xizmat qimmat — narxni emas, modelni o&apos;zgartirish kerakmi, shu ko&apos;rinadi.</InfoTip>}
      >
        <CostParts parts={item.costParts} unpricedCalls={item.unpricedCalls} />
      </Section>

      <Section title="Narx pog'onalari">
        <LadderCompare current={item.ladder} caption="Narx pog'onalari: asosiy va amaldagi" />
      </Section>

      <Section title={`Tannarx trendi · ${TREND_DAYS} kun`}>
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
      </Section>

      <Section title="Simulyator" aside={<span className="text-muted-foreground text-xs">— agar narx o&apos;zgarsa</span>}>
        <Simulator item={item} ladder={item.ladder} includeAdmins={includeAdmins} />
      </Section>

      <Section title="O'zgarishlar tarixi">
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
      </Section>

      <PriceEditDialog
        open={dialog === "edit"}
        toolId={toolId}
        title={item.title}
        adjust={item.adjust}
        ladder={item.ladder}
        includeAdmins={includeAdmins}
        onClose={() => setDialog(null)}
        onSaved={onChanged}
        onStale={onStale}
      />
      <PriceResetDialog
        open={dialog === "reset"}
        toolId={toolId}
        title={item.title}
        adjust={item.adjust}
        ladder={item.ladder}
        onClose={() => setDialog(null)}
        onReset={onChanged}
        onStale={onStale}
      />
    </Drawer>
  );
}
