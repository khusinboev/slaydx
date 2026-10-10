"use client";

import { fmtNumber } from "@/lib/admin-format";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/admin/ui";
import { MARGIN_GOOD_PCT, MARGIN_LOW_PCT, REC_BLOCK_HINT, REC_BLOCK_TEXT, changeText, marginTone, markupText, pctText, type RecState } from "./shared";

/** Words for the margin band, so the colour is never the only signal. */
function marginWord(marginPct: number | null): string {
  if (marginPct === null) return "ma'lumot yo'q";
  if (marginPct < 0) return "zarar";
  if (marginPct < MARGIN_LOW_PCT) return "past";
  if (marginPct <= MARGIN_GOOD_PCT) return "o'rtacha";
  return "yaxshi";
}

/** Traffic-light margin: dot + number; the band word for screen readers. */
export function MarginChip({ marginPct, digits = 0 }: { marginPct: number | null; digits?: number }) {
  return (
    <Badge tone={marginTone(marginPct)} dot>
      {pctText(marginPct, digits)}
      <span className="sr-only"> ({marginWord(marginPct)})</span>
    </Badge>
  );
}

/** The bar's scale reaches at least this multiple of the target, so the target tick never sits at the edge. */
const BAR_SCALE_OF_TARGET = 1.5;

/**
 * Markup against the target: a thin track, the markup as a fill and the target as a tick,
 * with the two numbers as text (the bar alone carries no information for a screen reader).
 */
export function MarkupBar({ markup, target, className }: { markup: number | null; target: number; className?: string }) {
  const scale = Math.max(target * BAR_SCALE_OF_TARGET, markup ?? 0);
  const fill = markup === null || !(scale > 0) ? 0 : Math.min(1, markup / scale);
  const tick = scale > 0 ? Math.min(1, target / scale) : 0;
  if (markup === null) return <span className={cn("text-muted-foreground text-xs", className)}>ustama —</span>;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        role="img"
        aria-label={`Ustama ${markupText(markup)}, maqsad ${markupText(target)}`}
        className="bg-muted relative inline-block h-1.5 w-16 shrink-0 overflow-visible rounded-full"
      >
        <span className="bg-muted-foreground/70 absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill * 100}%` }} />
        <span className="bg-foreground absolute -top-1 -bottom-1 w-0.5 rounded-full" style={{ left: `calc(${tick * 100}% - 1px)` }} />
      </span>
      <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
        {markupText(markup)} <span aria-hidden="true">/</span>
        <span className="sr-only"> maqsad </span> {markupText(target)}
      </span>
    </span>
  );
}

/**
 * «Tavsiya +121% · Qo'llash»: the recommended price change and, when it may be applied
 * and the admin has `pricing.edit`, the one-click entry to the apply dialog. A blocked
 * recommendation shows why instead of the button.
 */
export function RecommendationAction({
  rec,
  title,
  canEdit,
  onApply,
  size = "sm",
  showLabel = true,
  primary = false,
}: {
  rec: RecState;
  /** Tool title, for the button's accessible name. */
  title: string;
  canEdit: boolean;
  onApply: () => void;
  /** Button size from `sm` up; below `sm` it is always at least 44 px tall. */
  size?: "sm" | "md";
  showLabel?: boolean;
  /** The main action of its surface (the tool sheet's decision block). */
  primary?: boolean;
}) {
  if (rec.kind === "none") return <span className="text-muted-foreground text-xs">—</span>;
  if (rec.kind === "ok") return <Badge tone="success">Mos</Badge>;
  const tone = rec.direction === "up" ? "warning" : "info";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={tone} title={`Tuzatish ${fmtNumber(rec.target)}% bo'lsa, ustama maqsadga yetadi`}>
        {showLabel ? "Tavsiya " : null}
        {changeText(rec.changePct)}
      </Badge>
      {rec.block !== null ? (
        <span className="text-muted-foreground text-xs" title={REC_BLOCK_HINT[rec.block]}>
          {REC_BLOCK_TEXT[rec.block]}
        </span>
      ) : canEdit ? (
        <Button
          size={size === "md" ? "md" : "sm"}
          variant={primary ? "primary" : "secondary"}
          onClick={onApply}
          aria-label={`Tavsiyani qo'llash: ${title}, narx ${changeText(rec.changePct)}`}
          className="max-sm:min-h-11 max-sm:px-4"
        >
          Qo&apos;llash
        </Button>
      ) : null}
    </span>
  );
}

/** A KPI money figure: wraps between the number and its unit (never inside the number) instead of being cut off. */
export function Money({ amount, unit }: { amount: number | null; unit: string }) {
  if (amount === null) return <>—</>;
  return <span className="block whitespace-normal">{`${fmtNumber(Math.round(amount))} ${unit}`}</span>;
}
