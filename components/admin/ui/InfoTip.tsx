"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A «?» button that opens a short explanation of the number next to it (what it is
 * computed on). Click or Enter toggles it; Escape, a click outside or Tab away closes it.
 * Escape is taken in the capture phase, so an open tip inside a drawer or modal closes
 * the tip, not the dialog. The hit area is 36 px (44 px on phones) although the icon is small.
 */
export function InfoTip({ label, children, align = "center" }: { label: string; children: ReactNode; align?: "start" | "center" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="relative inline-flex align-middle"
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={`Izoh: ${label}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring relative inline-flex size-4 items-center justify-center rounded-full outline-none after:absolute after:-inset-2.5 focus-visible:ring-2 max-sm:after:-inset-3.5"
      >
        <CircleHelp className="size-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={id}
          role="note"
          className={cn(
            "bg-popover text-popover-foreground absolute top-full z-30 mt-2 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border px-3 py-2 text-left text-xs leading-relaxed font-normal tracking-normal whitespace-normal normal-case shadow-lg",
            align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
