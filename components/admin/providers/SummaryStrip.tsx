"use client";

import { KpiTile } from "@/components/admin/ui";
import { fmtNumber } from "@/lib/admin-format";
import type { ProvidersResponse } from "@/lib/admin-api/providers";
import { moneyText, providerNeedsAttention } from "./format";

/** The four numbers the owner reads first: what AI cost, how many providers work, and what needs attention. */
export function summarize(data: ProvidersResponse) {
  const today = data.items.reduce((s, i) => s + i.usage.today.usd, 0);
  const usable = data.items.filter((i) => i.usable).length;
  const paidUsable = data.items.filter((i) => i.usable && i.billing !== "free").length;
  const purposeIssues = data.purposes.filter((p) => p.verdict === "missing" || p.verdict === "single").length;
  const providerIssues = data.items.filter(providerNeedsAttention).length;
  return { today, usable, paidUsable, purposeIssues, providerIssues, attention: purposeIssues + providerIssues };
}

export function SummaryStrip({ data }: { data: ProvidersResponse }) {
  const s = summarize(data);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-summary>
      <KpiTile label="30 kunlik AI sarfi" value={moneyText(data.total30.usd, data.soumPerUsd)} hint={`${fmtNumber(data.total30.calls)} ta so'rov`} />
      <KpiTile label="Bugungi sarf" value={moneyText(s.today, data.soumPerUsd)} hint="Toshkent vaqti bilan" />
      <KpiTile label="Ishlayotgan provayderlar" value={`${s.usable} / ${data.items.length}`} hint={`shundan ${s.paidUsable} tasi to'lovli`} />
      <KpiTile
        label="Diqqat talab"
        value={s.attention === 0 ? "Hammasi joyida" : `${s.attention} ta`}
        hint={s.attention === 0 ? "Yetarli emas yoki zaxirasiz vazifa yo'q" : `${s.purposeIssues} vazifa · ${s.providerIssues} provayder`}
      />
    </div>
  );
}
