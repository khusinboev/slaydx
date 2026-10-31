"use client";

import { Sparkline } from "@/components/admin/ui";
import { fmtIsoDate, fmtNumber, fmtUsd } from "@/lib/admin-format";
import type { ProviderItem } from "@/lib/admin-api/providers";
import { moneyText, totalsOf, unitText, usageKindLabel, usageLine, type Period } from "./format";

/**
 * What a provider was used for in the chosen period: the headline figure (money for paid providers, request count
 * for free ones), the details, a 14-day trend and the 30-day split by kind (text / image / voice / search ...).
 * Free providers spend no money, so their figure is the number of requests; a paid provider that was never called
 * says so instead of showing a lonely zero.
 */
export function UsageBlock({ item, period, soumPerUsd }: { item: ProviderItem; period: Period; soumPerUsd: number }) {
  const t = totalsOf(item.usage, period);
  const line = usageLine(item, t, soumPerUsd);
  const free = item.billing === "free";
  const trend = item.usage.daily.map((d) => (free ? d.calls : d.usd));
  const trendTitle = free ? "Oxirgi 14 kunlik so'rovlar soni" : "Oxirgi 14 kunlik sarf (USD)";
  const idle = t.calls === 0;
  return (
    <div data-usage data-period={period} className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-tight font-semibold tabular-nums">{idle ? (free ? "0 ta so'rov" : "Ishlatilmagan") : line.primary}</p>
          {!idle && line.secondary.length > 0 ? <p className="text-muted-foreground mt-0.5 text-xs">{line.secondary.join(" · ")}</p> : null}
        </div>
        {item.usage.d30.calls > 0 ? <Sparkline values={trend} title={trendTitle} formatValue={(n) => (free ? fmtNumber(n) : fmtUsd(n))} width={104} height={30} /> : null}
      </div>
      {item.usage.kinds.length > 0 ? (
        <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs" aria-label="30 kunlik taqsimot">
          {item.usage.kinds.map((k) => (
            <li key={k.kind}>
              {usageKindLabel(k.kind)}{" "}
              <span className="text-foreground tabular-nums">
                {free || k.usd === 0 ? `${fmtNumber(k.calls)} ta` : moneyText(k.usd, soumPerUsd)}
                {unitText(k.kind, k.units) ? ` · ${unitText(k.kind, k.units)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {item.usage.lastDay ? `Oxirgi so'rov: ${fmtIsoDate(item.usage.lastDay)}` : "30 kunda bitta ham so'rov bo'lmagan"}
      </p>
    </div>
  );
}
