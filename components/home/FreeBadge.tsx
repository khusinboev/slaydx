import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";

/**
 * The «Bepul» pill of a free tool or service — what a card shows instead of a price of 0 (never «0 so'm»). The text is
 * `formatPrice(0)`, the one wording of a free price.
 */
export function FreeBadge({ className }: { className?: string }) {
  return (
    <span
      data-free-badge
      className={cn(
        "text-badge-success-text inline-flex shrink-0 items-center rounded-full bg-[color-mix(in_oklab,var(--success)_16%,transparent)] px-2 text-[12.5px] leading-5 font-semibold",
        className,
      )}
    >
      {formatPrice(0)}
    </span>
  );
}
