"use client";

import Link from "next/link";
import { TOOL_ICONS } from "@/components/shell/icons";
import { FreeBadge } from "../FreeBadge";
import type { HomeFreeItem } from "./hub-model";
import { HubSection } from "./HubSection";

/**
 * «Bepul xizmatlar», under the grid: compact cards (icon, name, one-line promise, a «Bepul» badge). On a phone one
 * row that scrolls sideways inside itself (snap, no scrollbar, the page never scrolls sideways); from 640 px the
 * cards wrap. Links keep the hub's login gate. Drawn even with one card left.
 */
export function FreeRow({ items, onPick, index }: { items: HomeFreeItem[]; onPick: (href: string) => void; index: number }) {
  return (
    <HubSection id="free" title="Bepul xizmatlar" index={index}>
      <ul
        data-hub-free
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => (
          <li key={item.id} className="w-[14.5rem] flex-none snap-start sm:w-[15.5rem]">
            <FreeCard item={item} onPick={onPick} />
          </li>
        ))}
      </ul>
    </HubSection>
  );
}

function FreeCard({ item, onPick }: { item: HomeFreeItem; onPick: (href: string) => void }) {
  const Icon = TOOL_ICONS[item.icon];
  return (
    <Link
      href={item.href}
      data-hub-free-item={item.id}
      onClick={() => onPick(item.href)}
      style={{ ["--tc" as string]: item.tc }}
      className="bg-card hover:bg-accent focus-visible:ring-ring flex h-full min-h-[4.5rem] items-center gap-3 rounded-[var(--radius-card)] border px-3 py-2.5 outline-none focus-visible:ring-2"
    >
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-[rgb(var(--tc)/0.14)] text-[rgb(var(--tc))]">
        {Icon ? <Icon className="size-[1.375rem]" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[15px] leading-snug font-semibold">{item.title}</span>
          <FreeBadge />
        </span>
        <span className="text-muted-foreground mt-0.5 block truncate text-[13px] leading-snug">{item.promise}</span>
      </span>
    </Link>
  );
}
