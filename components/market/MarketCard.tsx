"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { Lock, Star, TrendingUp } from "lucide-react";
import { TOOL_ICONS } from "@/components/shell/icons";
import { cn } from "@/lib/cn";
import { formatSom, groupDigits } from "@/lib/format";
import type { MarketCard as Card } from "@/lib/market/types";
import { TOOL_BY_ID } from "@/lib/tools";
import type { ToolId } from "@/lib/types";
import { discountPercent, isWideCover, itemHref, metaLine, toolTitle } from "./market-model";

/** The tool's tint as a CSS variable, the way tool cards carry it (`--tc`). */
export function toolTint(toolId: string): CSSProperties {
  return { ["--tc" as string]: TOOL_BY_ID[toolId as ToolId]?.tc ?? "245 158 11" };
}

/**
 * Price block (§4 display): the market price, the original struck through, the discount. All three numbers are read as
 * text by a screen reader; the percent is drawn only when there is a real discount. Sizes: `card` for the grid, `hero`
 * for the buy card.
 */
export function PriceTag({ card, size = "card", className }: { card: Pick<Card, "price" | "originalPrice">; size?: "card" | "hero"; className?: string }) {
  const off = discountPercent(card);
  const hero = size === "hero";
  return (
    <div data-market-price className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span data-price-now className={cn("text-foreground font-bold tracking-[-0.01em] tabular-nums", hero ? "text-[28px] leading-tight" : "text-[17px] leading-snug")}>
        {formatSom(card.price)}
      </span>
      {off > 0 ? (
        <>
          <span className="sr-only">Asl narx:</span>
          <s data-price-old className={cn("text-muted-foreground tabular-nums", hero ? "text-[16px]" : "text-[13.5px]")}>
            {groupDigits(card.originalPrice)}
          </s>
          {hero ? (
            <span data-price-off className="bg-accent-soft text-accent-soft-foreground self-center rounded-full px-2 py-0.5 text-[13.5px] font-bold tabular-nums">
              −{off} %
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Stars + votes; absent below the server's vote floor (`rating` is null then). */
export function RatingBadge({ rating, className }: { rating: Card["rating"]; className?: string }) {
  if (!rating) return null;
  return (
    <span data-market-rating className={cn("inline-flex items-center gap-1 tabular-nums", className)}>
      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
      <span className="sr-only">Baho:</span>
      {rating.avg.toFixed(1)}
      <span className="text-muted-foreground">({rating.count})</span>
    </span>
  );
}

/**
 * The paper on the tinted plate. Same plate for every card, so rows stay even: a document is a 3:4 sheet that rises from
 * the bottom edge, a deck a 16:9 slide in the middle. The server can answer 503 while LibreOffice is busy (§9): the card
 * then keeps a neutral face with the tool's icon, never a broken image.
 */
export function MarketCover({ card, className, eager }: { card: Pick<Card, "cover" | "title" | "toolId" | "status">; className?: string; eager?: boolean }) {
  const [broken, setBroken] = useState(false);
  const wide = isWideCover(card.toolId);
  const tool = TOOL_BY_ID[card.toolId];
  const Icon = tool ? TOOL_ICONS[tool.icon] : undefined;
  return (
    <span
      data-market-cover={wide ? "wide" : "page"}
      style={toolTint(card.toolId)}
      className={cn(
        "relative flex aspect-[5/6] w-full justify-center overflow-hidden bg-[rgb(var(--tc)/0.12)] dark:bg-[rgb(var(--tc)/0.16)]",
        wide ? "items-center" : "items-end",
        className,
      )}
    >
      {broken ? (
        <span data-market-cover-fallback className="flex flex-col items-center justify-center gap-2 self-center px-4 text-center">
          {Icon ? <Icon className="size-9 text-[rgb(var(--tc))]" aria-hidden /> : null}
          <span className="text-muted-foreground line-clamp-3 text-[13px] leading-snug font-medium">{card.title}</span>
        </span>
      ) : (
        // Public watermarked rasters from our own API: a plain `<img>` (§3.1), `next/image` would only re-encode them.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.cover}
          alt={`${card.title} — 1-sahifa namunasi`}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
          className={cn(
            "bg-white object-cover object-top shadow-[0_8px_22px_-8px_rgba(43,32,19,0.35)] transition-transform duration-300 group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0",
            wide ? "aspect-video w-[90%] rounded-[8px]" : "aspect-[3/4] w-[78%] translate-y-[6%] rounded-t-[8px]",
            card.status === "sold_out" && "opacity-60 grayscale",
          )}
        />
      )}
    </span>
  );
}

/**
 * A catalog card: cover-led, the tool on top of the plate, the discount in the corner, then the price, the title and one
 * meta line. The whole card is one link, so the 44 px rule is met by the card itself.
 */
export function MarketCardView({ card, eager }: { card: Card; eager?: boolean }) {
  const off = discountPercent(card);
  const soldOut = card.status === "sold_out";
  const tool = TOOL_BY_ID[card.toolId];
  const Icon = tool ? TOOL_ICONS[tool.icon] : undefined;
  return (
    <Link
      href={itemHref(card.id)}
      data-market-card={card.id}
      style={toolTint(card.toolId)}
      className="group bg-card focus-visible:ring-ring relative flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] border shadow-[var(--shadow-card)] outline-none transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[rgb(var(--tc)/0.45)] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--page-bg)] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <MarketCover card={card} eager={eager} />
      <span className="absolute top-2 left-2 inline-flex max-w-[calc(100%-4.5rem)] items-center gap-1 rounded-full bg-[var(--card)]/90 px-2 py-1 text-[12.5px] font-semibold shadow-sm backdrop-blur-sm">
        {Icon ? <Icon className="size-3.5 shrink-0 text-[rgb(var(--tc))]" aria-hidden /> : null}
        <span className="truncate max-[420px]:hidden">{toolTitle(card.toolId)}</span>
      </span>
      {soldOut ? (
        <span data-market-soldout className="bg-foreground text-background absolute top-2 right-2 rounded-full px-2 py-1 text-[12.5px] font-semibold">
          Sotuvda yo‘q
        </span>
      ) : off > 0 ? (
        <span data-market-off className="bg-primary text-primary-foreground absolute top-2 right-2 rounded-full px-2 py-1 text-[12.5px] font-bold tabular-nums">
          −{off} %
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-3">
        <PriceTag card={card} />
        <span data-market-title className="text-foreground line-clamp-2 text-[14.5px] leading-[1.3] font-semibold break-words">
          {card.title}
        </span>
        <span className="text-muted-foreground mt-auto truncate pt-0.5 text-[13px]">{metaLine(card)}</span>
        {card.soldCount > 0 || card.rating ? (
          <span className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 text-[13px]">
            <RatingBadge rating={card.rating} className="text-foreground font-medium" />
            {card.soldCount > 0 ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <TrendingUp className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{groupDigits(card.soldCount)} marta olingan</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

/** Same box as a card, so the grid does not jump when the page arrives. */
export function MarketCardSkeleton() {
  return (
    <div data-market-skeleton aria-hidden className="bg-card flex flex-col overflow-hidden rounded-[20px] border shadow-[var(--shadow-card)]">
      <div className="bg-muted slx-shimmer aspect-[5/6] w-full" />
      <div className="flex flex-col gap-2 p-3">
        <div className="bg-muted slx-shimmer h-5 w-2/3 rounded-md" />
        <div className="bg-muted slx-shimmer h-4 w-full rounded-md" />
        <div className="bg-muted slx-shimmer h-3.5 w-1/2 rounded-md" />
      </div>
    </div>
  );
}

/** A small lock note, shared by the gallery stubs and the buy card. */
export function LockNote({ children, className }: { children: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Lock className="size-3.5 shrink-0" aria-hidden />
      {children}
    </span>
  );
}
