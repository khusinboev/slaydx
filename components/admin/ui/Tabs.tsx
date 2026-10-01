"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem = { id: string; label: string; /** Small count or flag after the label. */ badge?: ReactNode };

const tabDomId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelDomId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Tab strip (`role="tablist"`) with roving tabindex and arrow-key navigation.
 * Pair each panel with `TabPanel` using the same `idPrefix`.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix,
}: {
  tabs: ReadonlyArray<TabItem>;
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  /** Shared with `TabPanel`; generated when omitted (then panels cannot be linked). */
  idPrefix?: string;
}) {
  const generated = useId();
  const prefix = idPrefix ?? generated;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    refs.current.get(id)?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-0.5 overflow-x-auto border-b">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={tabDomId(prefix, t.id)}
            aria-selected={on}
            aria-controls={panelDomId(prefix, t.id)}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "focus-visible:ring-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2",
              on ? "border-primary text-foreground font-semibold" : "text-muted-foreground hover:text-foreground border-transparent font-medium",
            )}
          >
            {t.label}
            {t.badge !== undefined ? <span className="text-muted-foreground text-xs tabular-nums">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Content of one tab; render only the active one (or hide the rest) in the page. */
export function TabPanel({ idPrefix, id, children }: { idPrefix: string; id: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelDomId(idPrefix, id)} aria-labelledby={tabDomId(idPrefix, id)} tabIndex={0} className="outline-none">
      {children}
    </div>
  );
}
