"use client";

import Link from "next/link";
import { TOOL_ICONS } from "@/components/shell/icons";
import { cn } from "@/lib/cn";
import type { HomeCell } from "./hub-model";
import { HUB_ENTER, HUB_STAGGER_MS } from "./HubSection";

const CELL =
  "focus-visible:ring-ring flex min-h-[5.75rem] flex-col items-center gap-1.5 rounded-2xl px-0.5 pt-2 pb-1.5 text-center outline-none focus-visible:ring-2";
const TILE = "flex size-[3.25rem] shrink-0 items-center justify-center rounded-[16px]";
const LABEL = "line-clamp-2 text-[13px] leading-tight break-words";

/**
 * The service grid: four columns on a phone, eight in one row from 1024 px, one tap each (targets are ≥ 44 px). The
 * first cell (Slayd, 73 % of the work) has a ringed, stronger tile; its size is the others', so the grid keeps its
 * rhythm. A tool without its provider key is drawn disabled with the reason, as in the catalogue. Links keep the hub's
 * login gate. `pending` = the session is unknown: a cell that depends on a switch is a skeleton of the same size.
 */
export function HubGrid({ cells, pending, onPick, index }: { cells: HomeCell[]; pending: boolean; onPick: (href: string) => void; index: number }) {
  return (
    <section aria-label="Xizmatlar" data-hub-section="grid" className={cn("min-w-0", HUB_ENTER)} style={{ animationDelay: `${index * HUB_STAGGER_MS}ms` }}>
      <ul data-hub-grid className="grid grid-cols-4 gap-x-1 gap-y-2 lg:grid-cols-8">
        {cells.map((cell, i) => (
          <li key={cell.id} className="min-w-0">
            {pending && cell.flagged ? <CellSkeleton /> : <Cell cell={cell} primary={i === 0} onPick={onPick} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CellSkeleton() {
  return (
    <div data-hub-cell-skeleton aria-hidden className={cn(CELL, "pointer-events-none")}>
      <span className={cn(TILE, "bg-muted slx-shimmer")} />
      <span className="bg-muted slx-shimmer h-3.5 w-4/5 rounded-md" />
    </div>
  );
}

function Cell({ cell, primary, onPick }: { cell: HomeCell; primary: boolean; onPick: (href: string) => void }) {
  const Icon = TOOL_ICONS[cell.icon];
  const shared = {
    "data-hub-cell": cell.id,
    "data-hub-cell-primary": primary ? "" : undefined,
    style: cell.tc ? { ["--tc" as string]: cell.tc } : undefined,
  };
  const body = (
    <>
      <span
        className={cn(
          TILE,
          !cell.tc && "bg-muted text-foreground",
          cell.tc && "text-[rgb(var(--tc))]",
          cell.tc && (primary ? "bg-[rgb(var(--tc)/0.2)] ring-2 ring-[rgb(var(--tc)/0.55)] ring-inset" : "bg-[rgb(var(--tc)/0.14)]"),
        )}
      >
        {Icon ? <Icon className="size-6" aria-hidden /> : null}
      </span>
      <span className={cn(LABEL, primary ? "font-bold" : "font-medium")}>{cell.label}</span>
      {cell.blocked ? <span className="sr-only">{cell.blocked}</span> : null}
    </>
  );
  if (cell.blocked) {
    return (
      <div {...shared} aria-disabled="true" title={cell.blocked} className={cn(CELL, "opacity-60")}>
        {body}
      </div>
    );
  }
  return (
    <Link
      {...shared}
      href={cell.href}
      onClick={() => onPick(cell.href)}
      className={cn(CELL, "hover:bg-accent transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100")}
    >
      {body}
    </Link>
  );
}
