"use client";

import type { CostPart } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { costKindLabel, pctText, soumText } from "./shared";

/** Kit chart colours for the stacked bar (red last: it reads as an alarm); literal classes for Tailwind's scanner. */
const SWATCH = ["bg-chart-2", "bg-chart-4", "bg-chart-1", "bg-chart-5", "bg-chart-3"] as const;

/**
 * What a tool's AI cost is made of over the period (text model, images, voice, search):
 * one stacked bar and a legend with so'm and share. Tells whether a margin problem is a
 * price problem or a model/provider one.
 */
export function CostParts({ parts, unpricedCalls }: { parts: ReadonlyArray<CostPart>; unpricedCalls: number }) {
  if (parts.length === 0) return <p className="text-muted-foreground text-[13px]">Bu davrda AI xarajati yozilmagan.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted flex h-2.5 w-full overflow-hidden rounded-full" aria-hidden="true">
        {parts.map((p, i) => (
          <span key={p.kind} className={cn("h-full", SWATCH[i % SWATCH.length])} style={{ width: `${p.sharePct}%` }} />
        ))}
      </div>
      <ul className="flex flex-col gap-1.5 text-[13px]">
        {parts.map((p, i) => (
          <li key={p.kind} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-sm", SWATCH[i % SWATCH.length])} aria-hidden="true" />
            <span className="min-w-0 flex-1">{costKindLabel(p.kind)}</span>
            <span className="tabular-nums">{soumText(p.soum)}</span>
            <span className="text-muted-foreground w-12 text-right text-xs tabular-nums">{pctText(p.sharePct, 0)}</span>
          </li>
        ))}
      </ul>
      {unpricedCalls > 0 ? (
        <p className="text-badge-warning-text text-xs">{fmtNumber(unpricedCalls)} ta chaqiruvning narxi noma&apos;lum (0 $ deb olingan): haqiqiy tannarx yuqoriroq.</p>
      ) : null}
    </div>
  );
}
