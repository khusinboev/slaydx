"use client";

import { createPortal } from "react-dom";
import { SlidersHorizontal } from "lucide-react";
import { Segmented, SelectField } from "@/components/forms/compact";
import { OverlayFrame, OverlayHeader, OverlayPanel, OverlayScrim } from "@/components/overlays/OverlayFrame";
import { useDialog } from "@/components/overlays/useDialog";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { groupDigits } from "@/lib/format";
import type { MarketListResponse } from "@/lib/market/types";
import type { ToolId } from "@/lib/types";
import { LEVEL_OPTIONS, SORT_OPTIONS, SUBJECT_OPTIONS, TOOL_CHIPS, sheetFilterCount, type MarketFilters } from "./market-model";

export type Facets = MarketListResponse["facets"] | null;
type Patch = (p: Partial<MarketFilters>) => void;

const CHIP =
  "focus-visible:ring-ring inline-flex min-h-11 flex-none items-center gap-1.5 rounded-full border px-4 text-[14.5px] font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2";
const CHIP_ON = "border-foreground bg-foreground text-background";
const CHIP_OFF = "bg-card text-muted-foreground hover:text-foreground";

/** A facet count when the server sent one for this tool. */
function toolCount(facets: Facets, id: ToolId): number | null {
  return facets?.tools.find((t) => t.id === id)?.count ?? null;
}

function ToolChips({ filters, facets, onChange, scope }: { filters: MarketFilters; facets: Facets; onChange: Patch; scope: string }) {
  const chip = (id: ToolId | "", label: string, count: number | null) => {
    const on = filters.tool === id;
    return (
      <button key={id || "all"} type="button" data-market-tool={id || "all"} data-market-scope={scope} aria-pressed={on} onClick={() => onChange({ tool: id })} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}>
        {label}
        {count ? <span className="text-[13px] font-normal tabular-nums opacity-70">{groupDigits(count)}</span> : null}
      </button>
    );
  };
  return (
    <>
      {chip("", "Hammasi", null)}
      {TOOL_CHIPS.map((t) => chip(t.id, t.label, toolCount(facets, t.id)))}
    </>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-muted-foreground text-[13px] font-semibold tracking-[0.06em] uppercase">{label}</span>
      {children}
    </div>
  );
}

/** Fan · Daraja · Saralash: one set of controls for the desktop panel and the phone sheet. */
function FilterControls({ filters, facets, onChange }: { filters: MarketFilters; facets: Facets; onChange: Patch }) {
  const subjects = SUBJECT_OPTIONS.map((o) => {
    const n = o.value ? facets?.subjects.find((s) => s.id === o.value)?.count : undefined;
    return { value: o.value, label: n ? `${o.label} (${groupDigits(n)})` : o.label };
  });
  return (
    <>
      <FilterBlock label="Fan">
        <SelectField ariaLabel="Fan" value={filters.subject} options={subjects} onChange={(v) => onChange({ subject: v as MarketFilters["subject"] })} />
      </FilterBlock>
      <FilterBlock label="Daraja">
        <Segmented ariaLabel="Daraja" value={filters.level} options={[...LEVEL_OPTIONS]} onChange={(v) => onChange({ level: v as MarketFilters["level"] })} />
      </FilterBlock>
      <FilterBlock label="Saralash">
        <SelectField ariaLabel="Saralash" value={filters.sort} options={[...SORT_OPTIONS]} onChange={(v) => onChange({ sort: v as MarketFilters["sort"] })} />
      </FilterBlock>
    </>
  );
}

/** Desktop (≥ 1024 px): a sticky panel beside the grid. */
export function FilterPanel({ filters, facets, onChange, onReset, dirty }: { filters: MarketFilters; facets: Facets; onChange: Patch; onReset: () => void; dirty: boolean }) {
  return (
    <aside aria-label="Filtrlar" data-market-panel className="hidden lg:block">
      <div className="bg-card sticky top-[5.25rem] flex flex-col gap-4 rounded-[20px] border p-4 shadow-[var(--shadow-card)]">
        <FilterBlock label="Ish turi">
          <div role="group" aria-label="Ish turi" className="flex flex-wrap gap-1.5">
            <ToolChips filters={filters} facets={facets} onChange={onChange} scope="panel" />
          </div>
        </FilterBlock>
        <FilterControls filters={filters} facets={facets} onChange={onChange} />
        {dirty ? (
          <button type="button" data-market-reset onClick={onReset} className="text-accent-soft-foreground hover:bg-accent-soft focus-visible:ring-ring min-h-11 rounded-[12px] text-[14.5px] font-semibold outline-none focus-visible:ring-2">
            Filtrlarni tozalash
          </button>
        ) : null}
      </div>
    </aside>
  );
}

/** Phone and tablet: one row of tool chips + «Filtr» that opens the sheet. Scrolls by itself, never the page. */
export function FilterRow({ filters, facets, onChange, onOpen }: { filters: MarketFilters; facets: Facets; onChange: Patch; onOpen: () => void }) {
  const count = sheetFilterCount(filters);
  return (
    <div data-market-row className="flex min-w-0 items-center gap-2 lg:hidden">
      <button
        type="button"
        data-market-filter-open
        aria-haspopup="dialog"
        aria-label={count ? `Filtr, ${count} ta tanlangan` : "Filtr"}
        onClick={onOpen}
        className={cn(CHIP, "bg-card text-foreground px-3.5", count > 0 && "border-primary")}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filtr
        {count ? (
          <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-full text-[12.5px] font-bold tabular-nums">{count}</span>
        ) : null}
      </button>
      <div role="group" aria-label="Ish turi" className="-mr-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pr-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <ToolChips filters={filters} facets={facets} onChange={onChange} scope="row" />
      </div>
    </div>
  );
}

/** Mounted only while open (`OverlayFrame` listens to the viewport); `useDialog` makes the phone's back close it. */
export function FilterSheet({ filters, facets, onChange, onReset, onClose }: { filters: MarketFilters; facets: Facets; onChange: Patch; onReset: () => void; onClose: () => void }) {
  const panelRef = useDialog(true, onClose);
  const phone = useCoarsePointer();
  return createPortal(
    <OverlayFrame label="Filtrlar" phone={phone} sheet className={phone ? "flex items-end justify-center" : "flex items-center justify-center p-4"}>
      <OverlayScrim onClose={onClose} />
      <OverlayPanel ref={panelRef} phone={phone} sheet className={phone ? undefined : "max-w-md"}>
        <div data-market-sheet>
          <OverlayHeader title="Filtrlar" phone={phone} onClose={onClose} className="mb-3" />
          <div className="flex flex-col gap-4 pb-1">
            <FilterControls filters={filters} facets={facets} onChange={onChange} />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button type="button" data-market-reset onClick={onReset} className="bg-card hover:bg-muted focus-visible:ring-ring min-h-11 rounded-[14px] border text-[15px] font-semibold outline-none focus-visible:ring-2">
                Tozalash
              </button>
              <button type="button" data-market-sheet-done onClick={onClose} className="bg-primary text-primary-foreground focus-visible:ring-ring min-h-11 rounded-[14px] text-[15px] font-semibold outline-none focus-visible:ring-2">
                Ko‘rsatish
              </button>
            </div>
          </div>
        </div>
      </OverlayPanel>
    </OverlayFrame>,
    document.body,
  );
}
