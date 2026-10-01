"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

const CONTROL =
  "border-input bg-card focus:ring-ring h-9 rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2 disabled:opacity-60";

export type FilterOption = { value: string; label: string };

/** Wrapping row of filter controls with an optional "clear filters" action. */
export function FilterBar({
  children,
  activeCount = 0,
  onClear,
}: {
  children: ReactNode;
  /** Number of filters currently set; the clear button shows only when > 0. */
  activeCount?: number;
  onClear?: () => void;
}) {
  return (
    <div role="group" aria-label="Filtrlar" className="flex flex-wrap items-end gap-2">
      {children}
      {onClear && activeCount > 0 ? (
        <Button size="sm" variant="ghost" onClick={onClear} icon={<X className="size-3.5" aria-hidden="true" />}>
          Filtrlarni tozalash
        </Button>
      ) : null}
    </div>
  );
}

/** Label above a control, tied to it for assistive tech. */
function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-muted-foreground text-[11px] font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Debounced search box. `onChange` fires `delayMs` after the last keystroke
 * (immediately on Enter or clear), so a list does not refetch per character.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  delayMs = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Required, Uzbek. */
  placeholder: string;
  ariaLabel?: string;
  delayMs?: number;
}) {
  const [text, setText] = useState(value);
  // Last value we emitted: the parent echoing it back must not overwrite newer typing.
  const [emitted, setEmitted] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  if (value !== prevValue) {
    setPrevValue(value);
    // An external change (e.g. "clear filters") that we did not emit ourselves.
    if (value !== emitted) {
      setText(value);
      setEmitted(value);
    }
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function emit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setEmitted(next);
    onChangeRef.current(next);
  }

  function type(next: string) {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => emit(next), delayMs);
  }

  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
      <input
        type="search"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") emit(text);
        }}
        className={cn(CONTROL, "w-full pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden")}
      />
      {text ? (
        <button
          type="button"
          aria-label="Qidiruvni tozalash"
          onClick={() => {
            setText("");
            emit("");
          }}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Single-choice dropdown (native `<select>`: compact and keyboard friendly). */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
  allLabel = "Hammasi",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<FilterOption>;
  /** Label of the empty ("no filter") option; pass `null` to omit it. */
  allLabel?: string | null;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn(CONTROL, "max-w-[14rem]")}>
        {allLabel !== null ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Multi-choice dropdown with checkboxes (e.g. several statuses at once). */
export function MultiSelectFilter({
  label,
  values,
  onChange,
  options,
}: {
  label: string;
  values: ReadonlyArray<string>;
  onChange: (values: string[]) => void;
  options: ReadonlyArray<FilterOption>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const summary =
    values.length === 0
      ? "Hammasi"
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? values[0])
        : `${values.length} ta tanlangan`;

  function toggle(v: string) {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  }

  return (
    <div ref={root} className="relative flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-[11px] font-semibold">{label}</span>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(CONTROL, "flex min-w-[8rem] max-w-[14rem] items-center justify-between gap-2")}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-label={label}
          className="bg-popover absolute top-full left-0 z-30 mt-1 flex max-h-64 min-w-full flex-col gap-0.5 overflow-y-auto rounded-lg border p-1.5 shadow-lg"
        >
          {options.map((o) => (
            <label key={o.value} className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] whitespace-nowrap">
              <input
                type="checkbox"
                checked={values.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="accent-primary size-4"
              />
              {o.label}
            </label>
          ))}
          {values.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-muted-foreground hover:text-foreground mt-1 rounded px-2 py-1.5 text-left text-xs"
            >
              Tanlovni tozalash
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Short single-choice switch (3-6 options). */
export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: ReadonlyArray<FilterOption>;
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="bg-muted/60 inline-flex max-w-full flex-wrap gap-0.5 rounded-lg p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "focus-visible:ring-ring rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
              on ? "bg-card text-foreground font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
