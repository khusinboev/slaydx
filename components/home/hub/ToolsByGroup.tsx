"use client";

import Link from "next/link";
import { useState } from "react";
import { TOOLS, visibleToolGroups } from "@/lib/tools";
import type { ToolConfig, ToolGroup } from "@/lib/types";
import { cn } from "@/lib/cn";
import { TOOL_ICONS } from "@/components/shell/icons";

/**
 * «Barcha vositalar»: one chip per group (`visibleToolGroups()` — the one
 * source the catalogue and the «+» sheet read; a group without tools is not
 * drawn) and a compact grid of the chosen group's tools from `TOOLS`. Every
 * tile links to `/uz/<slug>` behind the hub's login gate.
 */
export function ToolsByGroup({ onPick }: { onPick: (href: string) => void }) {
  const groups = visibleToolGroups();
  const [group, setGroup] = useState<ToolGroup>(groups[0]!.id);
  const tools = TOOLS.filter((t) => t.group === group);
  return (
    <div data-hub-tools>
      <div
        role="group"
        aria-label="Bo‘limlar"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            data-hub-group={g.id}
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
            className={cn(
              "focus-visible:ring-ring inline-flex h-11 flex-none items-center rounded-full border px-4 text-[14.5px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2",
              group === g.id
                ? "border-foreground bg-foreground text-background"
                : "bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
      <ul
        key={group}
        data-hub-group-tools={group}
        className="mt-3 grid grid-cols-4 gap-1 motion-safe:animate-[slx-enter-fade_180ms_ease-out_backwards] sm:grid-cols-6 lg:grid-cols-8"
      >
        {tools.map((t) => (
          <li key={t.id} className="min-w-0">
            <ToolTile tool={t} onPick={onPick} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ToolTile({ tool, onPick }: { tool: ToolConfig; onPick: (href: string) => void }) {
  const href = `/uz/${tool.slug}`;
  const Icon = TOOL_ICONS[tool.icon];
  return (
    <Link
      href={href}
      data-hub-tool={tool.id}
      onClick={() => onPick(href)}
      style={{ ["--tc" as string]: tool.tc }}
      className="hover:bg-accent focus-visible:ring-ring flex min-h-[5.75rem] flex-col items-center gap-1.5 rounded-2xl px-1 pt-2 pb-1.5 text-center outline-none focus-visible:ring-2"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-[rgb(var(--tc)/0.14)]">
        {Icon ? <Icon className="size-6 text-[rgb(var(--tc))]" aria-hidden /> : null}
      </span>
      <span className="line-clamp-2 text-[13px] leading-tight font-medium break-words">{tool.title}</span>
    </Link>
  );
}
