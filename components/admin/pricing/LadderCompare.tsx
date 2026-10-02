"use client";

import type { LadderRow } from "@/lib/admin-api/pricing";
import { fmtNumber } from "@/lib/admin-format";
import { cn } from "@/lib/cn";

/**
 * Tier ladder table: base → current effective, optionally → a proposed
 * effective price with the difference. Used by the drawer, the simulator and
 * the edit/reset dialogs. Every number comes from the server.
 */
export function LadderCompare({
  current,
  proposed,
  caption,
}: {
  current: ReadonlyArray<LadderRow>;
  /** Same steps re-priced with a proposed adjustment (from the simulate endpoint). */
  proposed?: ReadonlyArray<LadderRow> | null;
  caption: string;
}) {
  const byLabel = new Map((proposed ?? []).map((s) => [s.label, s.effective]));
  const showProposed = Boolean(proposed);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/60 text-muted-foreground text-left text-[11px] font-semibold tracking-wide uppercase">
          <tr>
            <th scope="col" className="px-3 py-2">
              Daraja
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Asosiy
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {showProposed ? "Hozir" : "Amaldagi"}
            </th>
            {showProposed ? (
              <>
                <th scope="col" className="px-3 py-2 text-right">
                  Yangi
                </th>
                <th scope="col" className="px-3 py-2 text-right">
                  Farq
                </th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {current.map((s) => {
            const next = byLabel.get(s.label);
            const diff = next === undefined ? null : next - s.effective;
            return (
              <tr key={s.label} className="border-t">
                <td className="px-3 py-1.5">{s.label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtNumber(s.base)}</td>
                <td className={cn("px-3 py-1.5 text-right tabular-nums", s.effective !== s.base && !showProposed && "font-semibold")}>{fmtNumber(s.effective)}</td>
                {showProposed ? (
                  <>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{next === undefined ? "—" : fmtNumber(next)}</td>
                    <td
                      className={cn(
                        "px-3 py-1.5 text-right tabular-nums",
                        diff === null || diff === 0 ? "text-muted-foreground" : diff > 0 ? "text-badge-success-text" : "text-destructive",
                      )}
                    >
                      {diff === null || diff === 0 ? "—" : fmtNumber(diff, { sign: true })}
                    </td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
