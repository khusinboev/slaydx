"use client";

import {
  Card,
  CardBody,
  CardHeader,
  DateRangePicker,
  ErrorState,
  Forbidden,
  KpiTile,
  LineChart,
  Skeleton,
  type DateRange,
} from "@/components/admin/ui";
import { fmtDateTime, fmtIsoDate, fmtNumber, fmtPercent, fmtSoum, fmtTanga } from "@/lib/admin-format";
import { getFinanceSummary, type FinanceSummary, type RevenueBucket } from "@/lib/admin-api/payments";
import { PROVIDER_LABEL, PURPOSE_LABEL } from "@/components/admin/payments/labels";
import { useResource } from "@/components/admin/payments/list-state";
import { useReportForbidden } from "./forbidden";

/** Axis ticks: `1,2 mln`, `350 ming`. */
export function compactSoum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${fmtNumber(n / 1_000_000, { digits: 1 })} mln`;
  if (a >= 1_000) return `${fmtNumber(n / 1_000, { digits: 0 })} ming`;
  return fmtNumber(n);
}

function share(part: number, total: number): string {
  return total > 0 ? fmtPercent((part / total) * 100) : "—";
}

/**
 * S10 "Xulosa" (plan §6.6, §7.1): revenue per Tashkent day, provider and
 * purpose split, job spend and refunds, current liabilities (Σ wallets),
 * external refunds. The server caches each range for 60 s.
 */
export function FinanceSummaryView({
  range,
  onRangeChange,
  onForbidden,
}: {
  range: DateRange;
  onRangeChange: (r: DateRange) => void;
  /** 403: the page drops its tabs (every finance tab needs the same permission). */
  onForbidden?: () => void;
}) {
  const key = `${range.from}:${range.to}`;
  const { state, retry } = useResource<FinanceSummary>(key, (signal) => getFinanceSummary(range, { signal }));
  const s = state.data;
  const loading = state.status === "loading" && !s;
  useReportForbidden(state.status === "forbidden", onForbidden);
  // 403: the forbidden state is all there is — no period picker above it.
  if (state.status === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <DateRangePicker value={range} onChange={onRangeChange} ariaLabel="Xulosa davri" />

      {state.status === "error" ? (
        <div className="bg-card rounded-xl border">
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4" aria-busy={state.status === "loading" || undefined}>
          {/* One column on phones: two would truncate the amounts (e.g. "2 216 000 so'm"). */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <KpiTile
              loading={loading}
              label="Tushum"
              value={s ? fmtSoum(s.revenue.total.soum) : ""}
              hint={s ? `${fmtNumber(s.revenue.total.orders)} ta to'lov` : null}
            />
            <KpiTile
              loading={loading}
              label="Click"
              value={s ? fmtSoum(s.revenue.byProvider.click.soum) : ""}
              hint={s ? `${share(s.revenue.byProvider.click.soum, s.revenue.total.soum)} · ${fmtNumber(s.revenue.byProvider.click.orders)} ta` : null}
            />
            <KpiTile
              loading={loading}
              label="Payme"
              value={s ? fmtSoum(s.revenue.byProvider.payme.soum) : ""}
              hint={s ? `${share(s.revenue.byProvider.payme.soum, s.revenue.total.soum)} · ${fmtNumber(s.revenue.byProvider.payme.orders)} ta` : null}
            />
            <KpiTile
              loading={loading}
              label="Ishlarga sarflandi"
              value={s ? fmtTanga(s.cashSpend.balance) : ""}
              hint={s ? `kvota ${fmtNumber(s.cashSpend.quota)} · bonus ${fmtNumber(s.cashSpend.points)} · ${fmtNumber(s.cashSpend.charges)} ta ish` : null}
            />
            <KpiTile
              loading={loading}
              label="Ishlarga qaytarildi"
              value={s ? fmtTanga(s.refunds.balance) : ""}
              hint={s ? `kvota ${fmtNumber(s.refunds.quota)} · bonus ${fmtNumber(s.refunds.points)} · ${fmtNumber(s.refunds.count)} ta` : null}
            />
            <KpiTile
              loading={loading}
              label="Majburiyat: balans"
              value={s ? fmtTanga(s.liabilities.balance) : ""}
              hint={s ? `hozir · ${fmtNumber(s.liabilities.users)} ta foydalanuvchida` : null}
            />
            <KpiTile loading={loading} label="Majburiyat: Pro kvota" value={s ? fmtTanga(s.liabilities.quota) : ""} hint="hozir" />
            <KpiTile loading={loading} label="Majburiyat: bonus ball" value={s ? fmtNumber(s.liabilities.points) : ""} hint="hozir" />
            <KpiTile
              loading={loading}
              label="Tashqi qaytarishlar"
              value={s ? fmtSoum(s.externalRefunds.amountSoum) : ""}
              hint={
                s
                  ? `${fmtNumber(s.externalRefunds.count)} ta (chargeback ${fmtNumber(s.externalRefunds.chargebacks)}) · yechildi ${fmtNumber(s.externalRefunds.clawedBack.balance + s.externalRefunds.clawedBack.quota)} · yetishmadi ${fmtNumber(s.externalRefunds.shortfall)}`
                  : null
              }
            />
            <KpiTile
              loading={loading}
              label="Admin tuzatishlari"
              value={s ? fmtNumber(s.adjustments.balance, { sign: true }) : ""}
              hint={s ? `balans · kvota ${fmtNumber(s.adjustments.quota, { sign: true })} · ${fmtNumber(s.adjustments.count)} ta` : null}
            />
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader
                title="Kunlik tushum"
                description="To'langan buyurtmalar, to'lov vaqti bo'yicha (Toshkent)"
                aside={s ? <span className="tabular-nums">{fmtSoum(s.revenue.total.soum)}</span> : null}
              />
              <CardBody>
                {s ? (
                  <LineChart
                    title="Kunlik tushum, so'm"
                    valueLabel="So'm"
                    formatValue={compactSoum}
                    points={s.revenue.byDay.map((d) => ({ label: fmtIsoDate(d.day).slice(0, 5), value: d.soum }))}
                  />
                ) : (
                  <Skeleton className="h-[200px] w-full" />
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Taqsimot" description="Provayder va maqsad bo'yicha" />
              {s ? <Breakdown s={s} /> : <Skeleton className="m-4 h-40" />}
            </Card>
          </div>
          {s ? <p className="text-muted-foreground text-xs">Hisoblangan: {fmtDateTime(s.generatedAt)} · 60 soniya keshlanadi</p> : null}
        </div>
      )}
    </div>
  );
}

function Breakdown({ s }: { s: FinanceSummary }) {
  const total = s.revenue.total.soum;
  const rows: Array<[string, RevenueBucket]> = [
    [PROVIDER_LABEL.click, s.revenue.byProvider.click],
    [PROVIDER_LABEL.payme, s.revenue.byProvider.payme],
    [PURPOSE_LABEL.topup, s.revenue.byPurpose.topup],
    [PURPOSE_LABEL.pro, s.revenue.byPurpose.pro],
  ];
  return (
    <div tabIndex={0} role="region" aria-label="Tushum taqsimoti" className="overflow-x-auto focus-visible:ring-foreground/70 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Tushum taqsimoti</caption>
        <thead>
          <tr className="text-muted-foreground text-[11.5px]">
            <th scope="col" className="border-b px-4 py-2 text-left font-semibold">Manba</th>
            <th scope="col" className="border-b px-3 py-2 text-right font-semibold">So&apos;m</th>
            <th scope="col" className="border-b px-3 py-2 text-right font-semibold">Soni</th>
            <th scope="col" className="border-b px-4 py-2 text-right font-semibold">Ulush</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, b], i) => (
            <tr key={label} className={i === 1 ? "border-b-2" : "border-b last:border-b-0"}>
              <th scope="row" className="px-4 py-2 text-left font-medium">{label}</th>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(b.soum)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(b.orders)}</td>
              <td className="text-muted-foreground px-4 py-2 text-right tabular-nums">{share(b.soum, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
