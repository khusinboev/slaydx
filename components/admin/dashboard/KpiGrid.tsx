"use client";

import Link from "next/link";
import type { Overview } from "@/lib/admin-api/metrics";
import { fmtNumber, fmtPercent, fmtSoum, fmtTanga, fmtUsd } from "@/lib/admin-format";
import { KpiTile } from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { percentDelta, pointsDelta } from "./format";

/** Tile labels in display order (the skeleton shows them while loading). */
const LABELS = [
  "Yangi foydalanuvchilar",
  "Faol foydalanuvchilar",
  "Generatsiyalar",
  "Muvaffaqiyat",
  "Tushum",
  "Naqd sarf",
  "Qaytarishlar",
  "AI xarajat",
  "Marja",
  "Kutilayotgan to'lovlar",
] as const;
const GRID = "grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5";

export function KpiGridSkeleton() {
  return (
    <div className={GRID} aria-busy="true">
      {LABELS.map((label) => (
        <KpiTile key={label} label={label} value="" loading />
      ))}
    </div>
  );
}

/** Coverage caption of the AI tile: share of completed jobs that carry cost data. */
export function coverageText(c: Overview["current"]["aiCoverage"]): string {
  if (c.jobsCompleted === 0) return "Qamrov: tayyor ish yo'q";
  return `Qamrov: ${fmtPercent(c.pct)} (${fmtNumber(c.jobsWithCost)}/${fmtNumber(c.jobsCompleted)} tayyor ish)`;
}

/**
 * The ten S3 tiles, each with its "oldingi davr" delta. Definitions live in
 * lib/server/admin-metrics.ts; the captions name what is inside each number.
 */
export function KpiGrid({ data }: { data: Overview }) {
  const canAi = useCan("ai.view");
  const c = data.current;
  const p = data.previous;
  const cov = c.aiCoverage;
  return (
    <div className="flex flex-col gap-2.5">
      <div className={GRID}>
        <KpiTile label="Yangi foydalanuvchilar" value={fmtNumber(c.newUsers)} delta={percentDelta(c.newUsers, p.newUsers, "up-good")} />
        <KpiTile
          label="Faol foydalanuvchilar"
          value={fmtNumber(c.activeUsers)}
          delta={percentDelta(c.activeUsers, p.activeUsers, "up-good")}
          hint="Ish yaratgan yoki kirgan"
        />
        <KpiTile
          label="Generatsiyalar"
          value={fmtNumber(c.generations.total)}
          delta={percentDelta(c.generations.total, p.generations.total, "up-good")}
          hint={`Tayyor ${fmtNumber(c.generations.completed)} · xato ${fmtNumber(c.generations.failed)}`}
        />
        <KpiTile
          label="Muvaffaqiyat"
          value={c.successRate === null ? "—" : fmtPercent(c.successRate)}
          delta={pointsDelta(c.successRate, p.successRate, "up-good")}
          hint="Tayyor ÷ (tayyor + xato)"
        />
        <KpiTile
          label="Tushum"
          value={fmtSoum(c.revenueSoum.total)}
          delta={percentDelta(c.revenueSoum.total, p.revenueSoum.total, "up-good")}
          hint={`${fmtNumber(c.paidOrders)} ta to'lov · Click ${fmtNumber(c.revenueSoum.click)} · Payme ${fmtNumber(c.revenueSoum.payme)}`}
        />
        <KpiTile
          label="Naqd sarf"
          value={fmtTanga(c.cashSpendTanga)}
          delta={percentDelta(c.cashSpendTanga, p.cashSpendTanga, "up-good")}
          hint={`Bonus ball: ${fmtNumber(c.bonusSpendPoints)}`}
        />
        <KpiTile
          label="Qaytarishlar"
          value={fmtTanga(c.refunds.tanga)}
          delta={percentDelta(c.refunds.tanga, p.refunds.tanga, "up-bad")}
          hint={`${fmtNumber(c.refunds.count)} ta · ${fmtNumber(c.refunds.points)} ball`}
        />
        <KpiTile
          label="AI xarajat"
          value={fmtUsd(c.aiCostUsd)}
          delta={percentDelta(c.aiCostUsd, p.aiCostUsd, "up-bad")}
          hint={coverageText(cov)}
        />
        <KpiTile
          label="Marja"
          value={fmtSoum(c.marginSoum)}
          delta={percentDelta(c.marginSoum, p.marginSoum, "up-good")}
          hint={`Tushum − AI × ${fmtNumber(data.soumPerUsd)} so'm/$`}
        />
        <KpiTile
          label="Kutilayotgan to'lovlar"
          value={fmtNumber(c.pendingOrders)}
          delta={percentDelta(c.pendingOrders, p.pendingOrders, "up-bad")}
          hint="Davrda ochilgan, hali yakunlanmagan"
        />
      </div>
      {cov.jobsCompleted > 0 && cov.jobsWithCost < cov.jobsCompleted ? (
        <p className="border-warning/40 bg-warning/10 rounded-lg border px-3 py-2 text-xs">
          AI xarajatda xarajat ma&apos;lumoti bor ishlargina hisobga kiradi: davrdagi tayyor ishlarning {fmtPercent(cov.pct)} ida bor.
          {canAi ? (
            <>
              {" "}
              Batafsil —{" "}
              <Link href="/admin/ai" className="font-medium underline underline-offset-2">
                AI xarajat
              </Link>{" "}
              bo&apos;limida.
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
