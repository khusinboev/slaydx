"use client";

import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Skeleton } from "./Skeleton";

export type Align = "left" | "right" | "center";

export type Column<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /**
   * Whitelisted sort value requested when the header is clicked (e.g. `created_desc`).
   * A column is sortable only when this is set; the table never invents sort values.
   */
  sortKey?: string;
  /** The opposite direction (e.g. `created_asc`); clicking toggles between the two. */
  sortKeyReverse?: string;
  align?: Align;
  /** Extra classes for the `<td>` / `<th>` (widths, truncation, `tabular-nums`). */
  className?: string;
  /** Hide this column in the card list shown below `sm`. */
  hideOnCard?: boolean;
  /** One short line under the header (and the card label) saying what the column is computed on. */
  hint?: string;
};

export type DataTableProps<T> = {
  columns: ReadonlyArray<Column<T>>;
  rows: ReadonlyArray<T>;
  rowKey: (row: T) => string;
  /** Accessible table name. */
  caption: string;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered instead of the rows when `rows` is empty and not loading (usually `EmptyState`). */
  empty?: ReactNode;
  /** Current server sort value; matched against `sortKey` / `sortKeyReverse` for `aria-sort`. */
  sort?: string;
  onSortChange?: (sortKey: string) => void;
  onRowClick?: (row: T) => void;
  /** Checkbox column (only where a bulk action exists). */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  /** Tailwind max-height for the scroll area so the sticky header actually sticks. */
  maxHeightClass?: string;
  /**
   * Name of the scroll region. Without `onRowClick` nothing inside may be focusable, so the
   * region itself takes focus to let keyboard users scroll it; defaults to the caption, which
   * keeps two tables on one page from sharing a landmark name.
   */
  regionLabel?: string;
};

const ALIGN: Record<Align, string> = { left: "text-left", right: "text-right", center: "text-center" };
const JUSTIFY: Record<Align, string> = { left: "justify-start", right: "justify-end", center: "justify-center" };

/** Sort direction is encoded in the value suffix (`_asc` / `_desc`), as the API whitelists do. */
function directionOf(sortValue: string): "ascending" | "descending" {
  return sortValue.endsWith("_asc") ? "ascending" : "descending";
}

function ariaSortOf<T>(col: Column<T>, sort: string | undefined): "ascending" | "descending" | "none" | undefined {
  if (!col.sortKey) return undefined;
  if (sort && (sort === col.sortKey || sort === col.sortKeyReverse)) return directionOf(sort);
  return "none";
}

function nextSort<T>(col: Column<T>, sort: string | undefined): string | null {
  if (!col.sortKey) return null;
  if (col.sortKeyReverse && sort === col.sortKey) return col.sortKeyReverse;
  return col.sortKey;
}

/** Clicks on controls inside a row must not count as a row click. */
function fromInteractive(e: MouseEvent | KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return Boolean(el?.closest("a, button, input, select, textarea, label"));
}

function SelectBox({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={(e) => onChange(e.target.checked)}
      className="accent-primary size-4 cursor-pointer"
    />
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  skeletonRows = 8,
  empty,
  sort,
  onSortChange,
  onRowClick,
  selectable = false,
  selected,
  onSelectedChange,
  maxHeightClass = "max-h-[75vh]",
  regionLabel,
}: DataTableProps<T>) {
  const selectedSet = selected ?? new Set<string>();
  const keys = rows.map(rowKey);
  const allSelected = keys.length > 0 && keys.every((k) => selectedSet.has(k));
  const someSelected = !allSelected && keys.some((k) => selectedSet.has(k));
  const showSkeleton = loading && rows.length === 0;
  const showEmpty = !loading && rows.length === 0;

  function toggleAll(on: boolean) {
    const next = new Set(selectedSet);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    onSelectedChange?.(next);
  }

  function toggleOne(key: string, on: boolean) {
    const next = new Set(selectedSet);
    if (on) next.add(key);
    else next.delete(key);
    onSelectedChange?.(next);
  }

  function rowProps(row: T) {
    if (!onRowClick) return {};
    return {
      tabIndex: 0,
      onClick: (e: MouseEvent) => {
        if (!fromInteractive(e)) onRowClick(row);
      },
      onKeyDown: (e: KeyboardEvent) => {
        if ((e.key === "Enter" || e.key === " ") && !fromInteractive(e)) {
          e.preventDefault();
          onRowClick(row);
        }
      },
    };
  }

  if (showEmpty) {
    return <div className="bg-card rounded-xl border">{empty}</div>;
  }

  const cardColumns = columns.filter((c) => !c.hideOnCard);
  const [titleCol, ...restCols] = cardColumns;

  return (
    <div className="bg-card overflow-hidden rounded-xl border" aria-busy={loading || undefined}>
      {/* Table: from `sm` up. */}
      <div
        className={cn(
          "hidden overflow-auto sm:block",
          !onRowClick && "focus-visible:ring-foreground/70 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset",
          maxHeightClass,
        )}
        {...(onRowClick ? {} : { tabIndex: 0, role: "region", "aria-label": regionLabel ?? caption })}
      >
        <table className="w-full text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="bg-card sticky top-0 z-10 w-10 border-b px-3 py-2">
                  <SelectBox
                    checked={allSelected}
                    indeterminate={someSelected}
                    label="Hammasini tanlash"
                    onChange={toggleAll}
                  />
                </th>
              ) : null}
              {columns.map((col) => {
                const align = col.align ?? "left";
                const sorted = ariaSortOf(col, sort);
                const target = nextSort(col, sort);
                return (
                  <th
                    key={col.id}
                    scope="col"
                    aria-sort={sorted}
                    className={cn(
                      "bg-card text-muted-foreground sticky top-0 z-10 border-b px-3 py-2 text-[11.5px] font-semibold whitespace-nowrap",
                      ALIGN[align],
                      col.className,
                    )}
                  >
                    {col.sortKey && target && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(target)}
                        className={cn(
                          "hover:text-foreground focus-visible:ring-foreground/70 -mx-1 inline-flex items-center gap-1 rounded px-1 outline-none focus-visible:ring-2",
                          JUSTIFY[align],
                          sorted && sorted !== "none" && "text-foreground",
                        )}
                      >
                        {col.header}
                        {sorted === "ascending" ? (
                          <ArrowUp className="size-3" aria-hidden="true" />
                        ) : sorted === "descending" ? (
                          <ArrowDown className="size-3" aria-hidden="true" />
                        ) : (
                          <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                    {col.hint ? (
                      <span
                        className={cn(
                          "text-muted-foreground mt-0.5 block max-w-[9.5rem] text-[10.5px] leading-snug font-normal whitespace-normal",
                          align === "right" && "ml-auto",
                          align === "center" && "mx-auto",
                        )}
                      >
                        {col.hint}
                      </span>
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className={cn(loading && !showSkeleton && "opacity-60")}>
            {showSkeleton
              ? Array.from({ length: skeletonRows }, (_, i) => (
                  <tr key={i} data-skeleton-row>
                    {selectable ? (
                      <td className="border-b px-3 py-2.5">
                        <Skeleton className="size-4" />
                      </td>
                    ) : null}
                    {columns.map((col) => (
                      <td key={col.id} className="border-b px-3 py-2.5">
                        <Skeleton className="h-4 w-full max-w-[9rem]" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const key = rowKey(row);
                  const isSelected = selectedSet.has(key);
                  return (
                    <tr
                      key={key}
                      data-row-key={key}
                      className={cn(
                        "border-b last:border-b-0",
                        onRowClick &&
                          "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-foreground/70 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset",
                        isSelected && "bg-primary/10",
                      )}
                      {...rowProps(row)}
                    >
                      {selectable ? (
                        <td className="w-10 px-3 py-2.5">
                          <SelectBox checked={isSelected} label="Qatorni tanlash" onChange={(on) => toggleOne(key, on)} />
                        </td>
                      ) : null}
                      {columns.map((col) => (
                        <td key={col.id} className={cn("px-3 py-2.5 align-middle", ALIGN[col.align ?? "left"], col.className)}>
                          {col.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      {/* Card list: below `sm`, where a wide table is unusable. */}
      <ul className="divide-y sm:hidden" data-card-list>
        {showSkeleton
          ? Array.from({ length: Math.min(skeletonRows, 5) }, (_, i) => (
              <li key={i} className="flex flex-col gap-2 px-3.5 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3.5 w-1/2" />
              </li>
            ))
          : rows.map((row) => {
              const key = rowKey(row);
              const isSelected = selectedSet.has(key);
              return (
                <li
                  key={key}
                  data-card-key={key}
                  className={cn(
                    "flex flex-col gap-1.5 px-3.5 py-3 text-[13px]",
                    onRowClick &&
                      "active:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-foreground/70 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset",
                    isSelected && "bg-primary/10",
                  )}
                  {...rowProps(row)}
                >
                  <div className="flex items-start gap-2.5">
                    {selectable ? (
                      <div className="pt-0.5">
                        <SelectBox checked={isSelected} label="Qatorni tanlash" onChange={(on) => toggleOne(key, on)} />
                      </div>
                    ) : null}
                    <div className="min-w-0 flex-1 font-medium">{titleCol ? titleCol.cell(row) : null}</div>
                  </div>
                  <dl className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 gap-y-1">
                    {restCols.map((col) => (
                      <div key={col.id} className="contents">
                        <dt className="text-muted-foreground text-xs">
                          {col.header}
                          {col.hint ? <span className="block text-[10.5px] opacity-80">{col.hint}</span> : null}
                        </dt>
                        <dd className="min-w-0 text-right break-words">{col.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
      </ul>
    </div>
  );
}
