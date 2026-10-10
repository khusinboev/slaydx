"use client";

import type { PricingOverview } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { KpiTile } from "@/components/admin/ui";
import { percentDelta, pointsDelta } from "@/components/admin/dashboard/format";
import { Money } from "./bits";
import { SETTING_LABEL, marginTone, markupText, pctText, usdText } from "./shared";

/** Static class per margin tone (Tailwind needs literal class names). */
const MARGIN_TEXT: Record<ReturnType<typeof marginTone>, string> = {
  danger: "text-destructive",
  warning: "text-badge-warning-text",
  success: "text-badge-success-text",
  neutral: "text-foreground",
  info: "text-foreground",
  primary: "text-foreground",
};

export const KPI_LABELS = ["Marja", "Naqd marja", "Tushum", "AI xarajat", "Bonus xarajati", "Maqsadli ustama"] as const;
export const KPI_GRID = "grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6";

/**
 * Six health figures with the change against the previous equal period. Each «?» says
 * in one or two sentences what the number is computed on; the settings the page depends
 * on (target markup, payment fee, dollar rate) share one tile.
 */
export function HealthKpis({ data }: { data: PricingOverview }) {
  const t = data.totals;
  const p = data.previous.totals;
  const vs = `oldingi ${fmtNumber(data.previous.range.days)} kunga nisbatan`;
  return (
    <section aria-label={`Asosiy ko'rsatkichlar (${vs})`} className={KPI_GRID}>
      <KpiTile
        label="Marja"
        value={<span className={MARGIN_TEXT[marginTone(t.marginPct)]}>{pctText(t.marginPct)}</span>}
        delta={pointsDelta(t.marginPct, p.marginPct, "up-good")}
        hint={t.uncoveredTools.length > 0 ? `${fmtNumber(t.uncoveredTools.length)} ta vosita tannarxsiz, kirmagan` : "tannarxi bor vositalar"}
        info={
          <>
            Tayyor ishlar narxi (ball bilan to&apos;langani ham) − tannarx − to&apos;lov komissiyasi {pctText(data.paymentFeePercent)} (faqat naqd qismdan), narxdan foizda.
            {t.uncoveredTools.length > 0 ? ` Tannarxi o'lchanmagan: ${t.uncoveredTools.join(", ")}.` : ""}
          </>
        }
      />
      <KpiTile
        label="Naqd marja"
        value={pctText(t.cashMarginPct)}
        delta={pointsDelta(t.cashMarginPct, p.cashMarginPct, "up-good")}
        hint="faqat naqd tushum"
        info="Faqat naqd pul tushumi bo'yicha (ball bilan to'langan ishlar tushum emas), davrda yaratilgan barcha ishlar."
      />
      <KpiTile
        label="Tushum"
        value={<Money amount={t.revenueSoum} unit="so'm" />}
        delta={percentDelta(t.revenueSoum, p.revenueSoum, "up-good")}
        hint={`${fmtNumber(t.completed)} ta tayyor ish`}
        info="Davrda tugagan ishlarning ro'yxat narxi (qaytarilgani ayrilgan), qanday to'langanidan qat'i nazar. 1 tanga = 1 so'm."
      />
      <KpiTile
        label="AI xarajat"
        value={<Money amount={t.costSoumTools} unit="so'm" />}
        delta={percentDelta(t.costSoumTools, p.costSoumTools, "up-bad")}
        hint={usdText(t.costUsdTools)}
        info={`Pullik vositalarning AI xarajati, xato ishlar bilan. Jami AI ${usdText(t.costUsdAll)}; bepul AI va noma'lum ${usdText(t.costUsdOther)} marjaga kirmaydi.`}
      />
      <KpiTile
        label="Bonus xarajati"
        value={<Money amount={t.bonusCostSoum} unit="so'm" />}
        delta={percentDelta(t.bonusCostSoum, p.bonusCostSoum, "up-bad")}
        hint={`ball ulushi ${pctText(t.pointsSharePct, 0)}`}
        info="Ball bilan to'langan ishlarning AI xarajati — bonuslarning narxi. Ball ulushi: tayyor ishlar tushumining ball bilan to'langan qismi."
      />
      <KpiTile
        label="Maqsadli ustama"
        value={markupText(data.targetMarkup)}
        hint={`komissiya ${pctText(data.paymentFeePercent)} · $1 = ${fmtNumber(data.fx)} so'm`}
        info={`Sozlamalar: «${SETTING_LABEL.targetMarkup}», «${SETTING_LABEL.paymentFee}», «${SETTING_LABEL.fx}». Tavsiya narxni shu ustamaga yetkazadi (komissiyadan keyin).`}
      />
    </section>
  );
}

export function HealthKpisSkeleton() {
  return (
    <div className={KPI_GRID} aria-hidden="true">
      {KPI_LABELS.map((label) => (
        <KpiTile key={label} label={label} value="" loading />
      ))}
    </div>
  );
}
