"use client";

import Link from "next/link";
import { TOOL_BY_ID, clientAdjustedPrice, toolBlockedReason } from "@/lib/tools";
import { useAppStore, usePricingVersion } from "@/lib/store";
import type { ToolConfig } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TOOL_ICONS } from "@/components/shell/icons";
import { QUICK_TOOL_IDS, quickDetail } from "./hub-model";

const CARD =
  "group bg-card focus-visible:ring-ring relative flex min-h-[7.5rem] flex-col justify-between gap-3 rounded-[var(--radius-card)] border p-3.5 text-left shadow-[var(--shadow-card)] outline-none focus-visible:ring-2";

/**
 * «Tez boshlash»: Slayd, Referat, Insho, Rezyume as four large cards (2 × 2) —
 * tinted icon chip (`TOOLS[].tc`), title, one line of real registry data
 * (output format · «from» price, as the catalogue shows it). Links to
 * `/uz/<slug>` behind the hub's login gate. A tool whose provider key is
 * missing (`toolBlockedReason`) is drawn disabled with the reason, as in the
 * catalogue — it is not sold.
 */
export function QuickStart({ onPick }: { onPick: (href: string) => void }) {
  const features = useAppStore((s) => s.features);
  usePricingVersion(); // admin price adjustments re-render the «from» prices
  return (
    <ul className="grid grid-cols-2 gap-2.5" data-hub-quick>
      {QUICK_TOOL_IDS.map((id, i) => {
        const tool = TOOL_BY_ID[id];
        return (
          <li key={id} className="min-w-0">
            <QuickCard tool={tool} first={i === 0} blocked={toolBlockedReason(tool, features)} onPick={onPick} />
          </li>
        );
      })}
    </ul>
  );
}

function QuickCard({
  tool,
  first,
  blocked,
  onPick,
}: {
  tool: ToolConfig;
  first: boolean;
  blocked: string | null;
  onPick: (href: string) => void;
}) {
  const Icon = TOOL_ICONS[tool.icon];
  const href = `/uz/${tool.slug}`;
  const body = (
    <>
      <span className="flex size-11 items-center justify-center rounded-[14px] bg-[rgb(var(--tc)/0.14)]">
        {Icon ? <Icon className="size-[22px] text-[rgb(var(--tc))]" aria-hidden /> : null}
      </span>
      <span className="block min-w-0">
        <span className="block truncate text-[16.5px] leading-snug font-semibold">{tool.title}</span>
        <span
          data-quick-detail
          className={cn(
            "mt-0.5 line-clamp-2 block text-[13px] leading-snug",
            blocked ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground",
          )}
        >
          {blocked ?? quickDetail(tool, clientAdjustedPrice(tool.id, tool.basePrice))}
        </span>
      </span>
    </>
  );
  const style = { ["--tc" as string]: tool.tc };
  if (blocked) {
    return (
      <div data-quick-tool={tool.id} aria-disabled="true" style={style} className={cn(CARD, "opacity-60")}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      data-quick-tool={tool.id}
      onClick={() => onPick(href)}
      style={style}
      className={cn(
        CARD,
        "hover:border-primary/40 transition-[border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100",
        first && "bg-accent-soft/60 dark:bg-accent-soft",
      )}
    >
      {body}
    </Link>
  );
}
