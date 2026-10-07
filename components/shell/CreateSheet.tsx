"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { LayoutGrid, X } from "lucide-react";
import { TOOLS, TOOL_BY_ID, visibleToolGroups } from "@/lib/tools";
import type { ToolConfig } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { useDialog } from "../overlays/useDialog";
import { TOOL_ICONS } from "./icons";
import { SAFE_BOTTOM, TOP_INSET } from "./safe-area";
import { CREATE_SHEET_ID } from "./TabBar";
import { mostUsedToolIds } from "./create-sheet";

const KNOWN = new Set<string>(TOOLS.map((t) => t.id));

/**
 * The «+» sheet of the bottom tab bar (docs/redesign/PLAN.md D1): «Nima
 * yaratamiz?», the user's most-used tools first, then every tool by group
 * (`visibleToolGroups()`, the one source `CreateGrid` reads too), and
 * «Barchasi» → `/uz/create`.
 *
 * A `useDialog` overlay (store overlay `"create"`): the phone's back button,
 * Escape, the backdrop and the bar's «×» close it; a tool link REPLACES the
 * sheet's history entry (back from the tool returns to the page under it).
 * The bar stays above the sheet (z 46 vs 45); the sheet's bottom padding
 * clears it (`--tabbar-h`).
 *
 * Login gate exactly as the old Sidebar: when the session is known and the
 * user is signed out, a tool tap still navigates and opens the login over the
 * tool page with `returnTo` (one gesture, NavProvider keeps it open).
 */
export function CreateSheet() {
  const open = useUi((s) => s.overlay === "create");
  const openUi = useUi((s) => s.open);
  // Only closes the sheet: a login opened by the same tap must survive the
  // sheet's deferred close (the nav engine closes a replaced overlay later).
  const close = useCallback(() => {
    if (useUi.getState().overlay === "create") useUi.getState().close();
  }, []);
  const panelRef = useDialog(open, close);
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  const top = useMemo(
    () => mostUsedToolIds(generations, KNOWN).map((id) => TOOL_BY_ID[id as keyof typeof TOOL_BY_ID]).filter(Boolean),
    [generations],
  );

  if (!open) return null;

  // Same groups as `/uz/create` (AUDIT-21 R0): a group without tools is not drawn.
  const groups = visibleToolGroups();

  const onPick = (href: string) => {
    // FE-09: an unchecked session does not count as signed out.
    if (sessionChecked && !loggedIn) openUi("login", { returnTo: href });
  };

  return (
    <div id={CREATE_SHEET_ID} data-create-sheet className="fixed inset-0 z-[45]" role="dialog" aria-modal="true" aria-labelledby="create-sheet-title">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Yopish"
        data-create-scrim
        className="slx-scrim-enter absolute inset-0 bg-black/45"
        onClick={close}
      />
      <div
        ref={panelRef}
        className="slx-sheet-enter bg-card absolute inset-x-0 bottom-0 mx-auto flex w-full max-w-[560px] flex-col overflow-hidden rounded-t-[28px] border border-b-0 shadow-2xl"
        style={{
          maxHeight: `calc(100svh - ${TOP_INSET} - 1.25rem)`,
          paddingBottom: `calc(var(--tabbar-h, 0px) + ${SAFE_BOTTOM} + 0.5rem)`,
        }}
      >
        <div aria-hidden className="bg-border mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full" />
        <div className="flex shrink-0 items-center gap-2 px-5 pt-2 pb-1">
          <h2 id="create-sheet-title" className="min-w-0 flex-1 truncate text-[20px] font-bold tracking-[-0.01em]">
            Nima yaratamiz?
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Yopish"
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring -mr-2 flex size-11 shrink-0 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
          <section data-create-top aria-labelledby="create-top-label" className="mb-3">
            <SectionLabel id="create-top-label">Ko‘p ishlatiladi</SectionLabel>
            <ul className="grid grid-cols-4 gap-1">
              {top.map((t) => (
                <li key={t.id}>
                  <ToolTile tool={t} onPick={onPick} />
                </li>
              ))}
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g.id} data-create-group={g.id} aria-labelledby={`create-group-${g.id}`} className="mb-3">
              <SectionLabel id={`create-group-${g.id}`}>{g.label}</SectionLabel>
              <ul className="grid grid-cols-4 gap-1">
                {TOOLS.filter((t) => t.group === g.id).map((t) => (
                  <li key={t.id}>
                    <ToolTile tool={t} onPick={onPick} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="shrink-0 px-4 pt-2">
          <Link
            href="/uz/create"
            data-create-all
            onClick={() => onPick("/uz/create")}
            className="bg-accent-soft text-foreground hover:bg-accent focus-visible:ring-ring flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15.5px] font-semibold outline-none focus-visible:ring-2"
          >
            <LayoutGrid className="text-accent-soft-foreground size-[18px]" aria-hidden />
            Barchasi
          </Link>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="text-muted-foreground px-2 pt-2 pb-1.5 text-[13px] font-semibold tracking-wider uppercase">
      {children}
    </h3>
  );
}

function ToolTile({ tool, onPick }: { tool: ToolConfig; onPick: (href: string) => void }) {
  const href = `/uz/${tool.slug}`;
  const Icon = TOOL_ICONS[tool.icon];
  return (
    <Link
      href={href}
      data-create-tool={tool.id}
      onClick={() => onPick(href)}
      className="hover:bg-accent focus-visible:ring-ring flex min-h-[5.5rem] flex-col items-center gap-1.5 rounded-2xl px-1 pt-2 pb-1.5 text-center outline-none focus-visible:ring-2"
      style={{ ["--tc" as string]: tool.tc }}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-[16px] bg-[rgb(var(--tc)/0.14)]">
        {Icon ? <Icon className="size-6 text-[rgb(var(--tc))]" aria-hidden /> : null}
      </span>
      <span className={cn("line-clamp-2 text-[12.5px] leading-tight font-medium break-words")}>{tool.title}</span>
    </Link>
  );
}
