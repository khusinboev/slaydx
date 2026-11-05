"use client";

import { useCallback, useState } from "react";
import { Download } from "lucide-react";
import { adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { STATS_PERIODS, exportMarketSales, getMarketStats, type MarketStatRow } from "@/lib/admin-api/market";
import { fmtIsoDate, fmtNumber, fmtPercent, fmtSoum } from "@/lib/admin-format";
import { Button, Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, Forbidden, KpiTile, LineChart, Segmented, StackedBarChart, toast, useLoad, type Column } from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";

const PERIODS = STATS_PERIODS.map((d) => ({ value: String(d), label: `${d} kun` }));

const RANK_COLUMNS = (head: string): Column<MarketStatRow>[] => [
  { id: "label", header: head, className: "max-w-[20rem] break-words", cell: (r) => r.label },
  { id: "n", header: "Xarid", align: "right", className: "tabular-nums", cell: (r) => fmtNumber(r.purchases) },
  { id: "revenue", header: "Tushum", align: "right", className: "whitespace-nowrap tabular-nums", cell: (r) => fmtSoum(r.revenue) },
];

function RankCard({ title, head, rows }: { title: string; head: string; rows: readonly MarketStatRow[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <DataTable columns={RANK_COLUMNS(head)} rows={rows} rowKey={(r) => r.id} caption={title} empty={<EmptyState title="Xarid yo'q" />} />
      </CardBody>
    </Card>
  );
}

/**
 * «Sotuvlar» (§6): KPIs over 7/30/90 Tashkent days, the daily charts, top items and the two breakdowns. Revenue is the
 * sum of purchases minus the ledger refunds; every number comes from the server.
 */
export function SalesTab() {
  const canExport = useCan("finance.export");
  const [days, setDays] = useState("30");
  const load = useCallback((signal: AbortSignal) => getMarketStats(Number(days), { signal }), [days]);
  const [state, retry] = useLoad(load);
  const [exporting, setExporting] = useState(false);

  if (state.status === "forbidden") return <Forbidden />;
  if (state.status === "error") return <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />;
  const s = state.status === "ready" ? state.data : null;

  async function exportCsv() {
    if (!s) return;
    setExporting(true);
    try {
      await exportMarketSales(s.from, s.to);
    } catch (e) {
      if (!isAbortError(e)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented ariaLabel="Davr" options={PERIODS} value={days} onChange={setDays} />
        {canExport ? (
          <Button size="sm" onClick={exportCsv} loading={exporting} disabled={!s} icon={<Download className="size-4" aria-hidden="true" />}>
            CSV
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="Xaridlar" loading={!s} value={s ? fmtNumber(s.purchases) : ""} />
        <KpiTile label="Tushum" loading={!s} value={s ? fmtSoum(s.revenue) : ""} info="Xaridlar summasi, shu davrdagi qaytarishlar ayrilgan." />
        <KpiTile label="O'rtacha narx" loading={!s} value={s ? fmtSoum(s.avgPrice) : ""} />
        <KpiTile label="Konversiya" loading={!s} value={s ? (s.conversion === null ? "—" : fmtPercent(s.conversion)) : ""} hint={s ? `${fmtNumber(s.views)} ko'rish` : undefined} info="Xaridlar soni / ish sahifasi ko'rishlari." />
        <KpiTile label="Qaytarishlar" loading={!s} value={s ? fmtSoum(s.refunds.amount) : ""} hint={s ? `${fmtNumber(s.refunds.count)} ta` : undefined} />
      </div>
      {s ? (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Kunlik tushum" />
              <CardBody>
                <LineChart title="Kunlik tushum, so'm" valueLabel="Tushum, so'm" color={1} formatValue={(n) => fmtNumber(n)} points={s.daily.map((d) => ({ label: fmtIsoDate(d.day), value: d.revenue }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Kunlik xaridlar" />
              <CardBody>
                <StackedBarChart
                  title="Kunlik xaridlar"
                  formatValue={(n) => fmtNumber(n)}
                  series={[{ key: "purchases", label: "Xaridlar", color: 2 }]}
                  data={s.daily.map((d) => ({ label: fmtIsoDate(d.day), values: { purchases: d.purchases } }))}
                />
              </CardBody>
            </Card>
          </div>
          <RankCard title="Eng ko'p sotilgan 10 ish" head="Ish" rows={s.topItems} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <RankCard title="Vositalar bo'yicha" head="Vosita" rows={s.byTool} />
            <RankCard title="Fanlar bo'yicha" head="Fan" rows={s.bySubject} />
          </div>
          <RankCard title="Xaridor hisobining yoshi" head="Hisob yoshi" rows={s.bySignupAge} />
        </>
      ) : null}
    </div>
  );
}
