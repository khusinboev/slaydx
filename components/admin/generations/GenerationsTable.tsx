"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, Download, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  AdminForbiddenError,
  AdminReauthCancelledError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
  type ListResult,
} from "@/lib/admin-api/core";
import {
  GENERATION_SORTS,
  GENERATION_STATUSES,
  downloadGenerationsCsv,
  listGenerations,
  type AdminGenerationListItem,
  type GenerationListQuery,
  type GenerationSort,
  type GenerationStatus,
} from "@/lib/admin-api/generations";
import { fmtDateTime, fmtDuration, fmtNumber, fmtUsd, isIsoDate } from "@/lib/admin-format";
import {
  Badge,
  Button,
  CursorPager,
  DataTable,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  MultiSelectFilter,
  SearchInput,
  SelectFilter,
  presetRange,
  toast,
  type Column,
  type FilterOption,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { GenerationStatusPill, SORT_OPTIONS, STATUS_OPTIONS, chargeText, isCharged, shortId, toolLabel } from "./shared";

/* ───────────────────────────── filter state ───────────────────────────── */

export type GenerationFilters = {
  status: GenerationStatus[];
  tool: string;
  userId: string;
  from: string;
  to: string;
  hasError: boolean;
  unrefunded: boolean;
  stuck: boolean;
  sort: GenerationSort;
};

export const EMPTY_FILTERS: GenerationFilters = {
  status: [],
  tool: "",
  userId: "",
  from: "",
  to: "",
  hasError: false,
  unrefunded: false,
  stuck: false,
  sort: "created_desc",
};

const DIGITS = /^\d{1,16}$/;

/**
 * URL query → filters. Unknown or malformed values are dropped here, so a
 * hand-edited link shows the unfiltered list instead of a 400 error page.
 */
export function filtersFromParams(sp: Pick<URLSearchParams, "get"> | null, tools: ReadonlyArray<FilterOption>): GenerationFilters {
  if (!sp) return EMPTY_FILTERS;
  const status = (sp.get("status") ?? "")
    .split(",")
    .filter((s, i, all): s is GenerationStatus => (GENERATION_STATUSES as readonly string[]).includes(s) && all.indexOf(s) === i);
  const tool = sp.get("tool") ?? "";
  const userId = sp.get("userId") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const sort = sp.get("sort") ?? "";
  const datesOk = isIsoDate(from) && isIsoDate(to) && from <= to;
  return {
    status,
    tool: tools.some((t) => t.value === tool) ? tool : "",
    userId: DIGITS.test(userId) ? userId : "",
    from: datesOk ? from : "",
    to: datesOk ? to : "",
    hasError: sp.get("hasError") === "1",
    unrefunded: sp.get("unrefunded") === "1",
    stuck: sp.get("stuck") === "1",
    sort: (GENERATION_SORTS as readonly string[]).includes(sort) ? (sort as GenerationSort) : "created_desc",
  };
}

/** Filters → URL query (defaults omitted), in a stable key order. */
export function filtersToSearch(f: GenerationFilters): string {
  const sp = new URLSearchParams();
  if (f.status.length) sp.set("status", f.status.join(","));
  if (f.tool) sp.set("tool", f.tool);
  if (f.userId) sp.set("userId", f.userId);
  if (f.from && f.to) {
    sp.set("from", f.from);
    sp.set("to", f.to);
  }
  if (f.hasError) sp.set("hasError", "1");
  if (f.unrefunded) sp.set("unrefunded", "1");
  if (f.stuck) sp.set("stuck", "1");
  if (f.sort !== "created_desc") sp.set("sort", f.sort);
  return sp.toString();
}

function activeFilterCount(f: GenerationFilters, pinnedUser: boolean): number {
  return (
    (f.status.length ? 1 : 0) +
    (f.tool ? 1 : 0) +
    (f.userId && !pinnedUser ? 1 : 0) +
    (f.from ? 1 : 0) +
    (f.hasError ? 1 : 0) +
    (f.unrefunded ? 1 : 0) +
    (f.stuck ? 1 : 0)
  );
}

/* ───────────────────────────── small controls ───────────────────────────── */

function ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        "focus-visible:ring-ring h-9 rounded-lg border px-3 text-[13px] whitespace-nowrap outline-none focus-visible:ring-2",
        on ? "border-primary bg-primary/15 text-foreground font-medium" : "border-input bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  if (!from || !to) {
    return (
      <Button onClick={() => {
        const r = presetRange("30d");
        onChange(r.from, r.to);
      }} icon={<CalendarRange className="size-4" aria-hidden="true" />}>
        Davr tanlash
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-start gap-2">
      <DateRangePicker value={{ from, to }} onChange={(r) => onChange(r.from, r.to)} ariaLabel="Yaratilgan davr" />
      <Button size="sm" variant="ghost" onClick={() => onChange("", "")} icon={<X className="size-3.5" aria-hidden="true" />}>
        Davrni olib tashlash
      </Button>
    </div>
  );
}

/* ───────────────────────────── table ───────────────────────────── */

export type GenerationsTableProps = {
  /**
   * Tool registry as filter options (`{ value: toolId, label: title }`). Server
   * pages pass `adminToolOptions()` from `lib/server/admin-generations.ts`, so
   * the client bundle never pulls in `lib/tools.ts`.
   */
  tools: ReadonlyArray<FilterOption>;
  /**
   * Filters pinned by the host page (e.g. the user detail page pins `userId`).
   * A pinned filter is always sent, its control is hidden, and "clear filters"
   * keeps it. The user column is hidden when `userId` is pinned.
   */
  fixedFilters?: { userId?: string };
  /**
   * `true` inside another page (a tab): filters, sort and paging live in local
   * state and the page URL is never touched. `false` (default): filters and
   * sort live in the URL query (shareable, back button works).
   */
  embedded?: boolean;
  /** Rows per page, 1..100 (default 50). */
  pageSize?: number;
  /** Accessible table name (default "Generatsiyalar"). */
  caption?: string;
};

type Result =
  | { reqKey: string; kind: "ok"; data: ListResult<AdminGenerationListItem> }
  | { reqKey: string; kind: "error"; message: string; requestId?: string }
  | { reqKey: string; kind: "forbidden" };

/**
 * S6 jobs table with its filter bar, keyset pager and CSV export. Reused by
 * the user detail page ("Generatsiyalar" tab) with `embedded` and
 * `fixedFilters={{ userId }}`.
 */
export function GenerationsTable({ tools, fixedFilters, embedded = false, pageSize = 50, caption = "Generatsiyalar" }: GenerationsTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canExport = useCan("jobs.export");
  const pinnedUser = fixedFilters?.userId && DIGITS.test(fixedFilters.userId) ? fixedFilters.userId : "";

  const [localFilters, setLocalFilters] = useState<GenerationFilters>(EMPTY_FILTERS);
  const urlKey = searchParams?.toString() ?? "";
  const urlFilters = useMemo(() => filtersFromParams(new URLSearchParams(urlKey), tools), [urlKey, tools]);
  const filters = embedded ? localFilters : urlFilters;

  const setFilters = useCallback(
    (next: GenerationFilters) => {
      if (embedded) {
        setLocalFilters(next);
        return;
      }
      const qs = filtersToSearch(next);
      // Native history update: the App Router syncs `useSearchParams` with it
      // without a server round trip (`router.replace` would re-render the
      // dynamic page on the server and the controls would lag behind clicks).
      window.history.replaceState(null, "", `${pathname ?? ""}${qs ? `?${qs}` : ""}`);
    },
    [embedded, pathname],
  );
  const patch = (p: Partial<GenerationFilters>) => setFilters({ ...filters, ...p });

  const query: GenerationListQuery = useMemo(
    () => ({
      status: filters.status,
      tool: filters.tool,
      userId: pinnedUser || filters.userId,
      from: filters.from,
      to: filters.to,
      hasError: filters.hasError,
      unrefunded: filters.unrefunded,
      stuck: filters.stuck,
      sort: filters.sort,
    }),
    [filters, pinnedUser],
  );
  const filterKey = JSON.stringify(query);

  // The cursor belongs to one filter set: a new filter key means page one again.
  const [page, setPage] = useState<{ key: string; cursor: string | null }>({ key: filterKey, cursor: null });
  const cursor = page.key === filterKey ? page.cursor : null;
  const [reload, setReload] = useState(0);
  const reqKey = `${filterKey}|${cursor ?? ""}|${reload}`;

  const [result, setResult] = useState<Result | null>(null);
  const [lastOk, setLastOk] = useState<ListResult<AdminGenerationListItem> | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listGenerations({ ...query, cursor, limit: pageSize }, { signal: ctl.signal })
      .then((data) => {
        setResult({ reqKey, kind: "ok", data });
        setLastOk(data);
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (e instanceof AdminForbiddenError) setResult({ reqKey, kind: "forbidden" });
        else setResult({ reqKey, kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
    // `reqKey` covers query, cursor and reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey, pageSize]);

  const current = result && result.reqKey === reqKey ? result : null;
  const loading = current === null;
  const data = current?.kind === "ok" ? current.data : lastOk;
  const rows = data?.items ?? [];
  const active = activeFilterCount(filters, Boolean(pinnedUser));

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadGenerationsCsv(query);
      toast("Eksport boshlandi — fayl yuklab olinmoqda");
    } catch (e) {
      if (!isAbortError(e) && !(e instanceof AdminReauthCancelledError)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  const clearFilters = () => setFilters({ ...EMPTY_FILTERS, sort: filters.sort });

  const columns: Column<AdminGenerationListItem>[] = [
    {
      id: "topic",
      header: "Mavzu",
      className: "min-w-[12rem] max-w-[20rem]",
      cell: (g) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="line-clamp-2 break-words">{g.topic || "—"}</span>
          {g.error ? (
            <span className="text-destructive truncate text-xs" title={g.error}>
              {g.error}
            </span>
          ) : null}
        </div>
      ),
    },
    { id: "id", header: "ID", className: "font-mono text-xs", cell: (g) => shortId(g.id) },
    ...(pinnedUser
      ? []
      : [
          {
            id: "user",
            header: "Foydalanuvchi",
            className: "max-w-[12rem]",
            cell: (g: AdminGenerationListItem) => (
              <Link href={`/admin/users/${encodeURIComponent(g.userId)}`} className="hover:text-primary block truncate underline-offset-2 hover:underline">
                {g.userName || `#${g.userId}`}
              </Link>
            ),
          },
        ]),
    { id: "tool", header: "Vosita", className: "whitespace-nowrap", cell: (g) => toolLabel(tools, g.toolId) },
    { id: "status", header: "Holat", cell: (g) => <GenerationStatusPill status={g.status} stuck={g.stuck} /> },
    { id: "price", header: "Narx", align: "right", className: "tabular-nums whitespace-nowrap", cell: (g) => fmtNumber(g.price) },
    {
      id: "charged",
      header: "Yechilgan",
      className: "text-xs whitespace-nowrap tabular-nums",
      hideOnCard: true,
      cell: (g) => chargeText(g.charged),
    },
    {
      id: "refunded",
      header: "Qaytarildi",
      cell: (g) =>
        g.refunded ? (
          <Badge tone="success">Ha</Badge>
        ) : g.status === "FAILED" && isCharged(g.charged) ? (
          <Badge tone="danger">Yo&apos;q</Badge>
        ) : (
          "—"
        ),
    },
    { id: "attempts", header: "Urinish", align: "right", className: "tabular-nums", hideOnCard: true, cell: (g) => fmtNumber(g.attempts) },
    {
      id: "duration",
      header: "Davomiylik",
      align: "right",
      sortKey: "duration_desc",
      className: "tabular-nums whitespace-nowrap",
      cell: (g) => fmtDuration(g.durationSec),
    },
    { id: "cost", header: "AI $", align: "right", className: "tabular-nums whitespace-nowrap", cell: (g) => (g.costUsd === null ? "—" : fmtUsd(g.costUsd, 4)) },
    {
      id: "created",
      header: "Yaratilgan",
      sortKey: "created_desc",
      sortKeyReverse: "created_asc",
      className: "tabular-nums whitespace-nowrap",
      cell: (g) => fmtDateTime(g.createdAt),
    },
  ];

  let body: ReactNode;
  if (current?.kind === "forbidden") {
    body = (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  } else if (current?.kind === "error") {
    body = (
      <div className="bg-card rounded-xl border">
        <ErrorState message={current.message} requestId={current.requestId} onRetry={() => setReload((n) => n + 1)} />
      </div>
    );
  } else {
    body = (
      <>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          caption={caption}
          loading={loading}
          sort={filters.sort}
          onSortChange={(s) => patch({ sort: s as GenerationSort })}
          onRowClick={(g) => router.push(`/admin/generations/${encodeURIComponent(g.id)}`)}
          empty={
            <EmptyState
              title="Generatsiya topilmadi"
              description={active > 0 ? "Bu filtrlar bo'yicha ish yo'q." : pinnedUser ? "Bu foydalanuvchida hali generatsiya yo'q." : "Hali birorta generatsiya yo'q."}
              action={
                active > 0 ? (
                  <Button size="sm" onClick={clearFilters}>
                    Filtrlarni tozalash
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <CursorPager
          cursor={cursor}
          nextCursor={current?.kind === "ok" ? current.data.nextCursor : null}
          onCursorChange={(c) => setPage({ key: filterKey, cursor: c })}
          total={data?.total ?? null}
          totalCapped={data?.totalCapped ?? false}
          loading={loading}
          resetKey={filterKey}
        />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Column on phones: a flex-1 bar next to the button would be squeezed to a sliver. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 sm:flex-1">
          <FilterBar activeCount={active} onClear={clearFilters}>
            <MultiSelectFilter label="Holat" values={filters.status} options={STATUS_OPTIONS} onChange={(v) => patch({ status: v as GenerationStatus[] })} />
            <SelectFilter label="Vosita" value={filters.tool} options={tools} allLabel="Barcha vositalar" onChange={(v) => patch({ tool: v })} />
            <SelectFilter label="Saralash" value={filters.sort} options={SORT_OPTIONS} allLabel={null} onChange={(v) => patch({ sort: v as GenerationSort })} />
            {pinnedUser ? null : (
              <div className="w-full min-w-[10rem] sm:w-48">
                <SearchInput
                  value={filters.userId}
                  placeholder="Foydalanuvchi ID"
                  onChange={(v) => {
                    const id = v.replace(/\D/g, "").slice(0, 16);
                    if (id !== filters.userId) patch({ userId: id });
                  }}
                />
              </div>
            )}
            <ToggleChip label="Xato bor" on={filters.hasError} onChange={(on) => patch({ hasError: on })} />
            <ToggleChip label="Qaytarilmagan" on={filters.unrefunded} onChange={(on) => patch({ unrefunded: on })} />
            <ToggleChip label="Osilib qolgan" on={filters.stuck} onChange={(on) => patch({ stuck: on })} />
            <PeriodFilter from={filters.from} to={filters.to} onChange={(from, to) => patch({ from, to })} />
          </FilterBar>
        </div>
        {canExport ? (
          <Button onClick={exportCsv} loading={exporting} className="self-start sm:self-end" icon={<Download className="size-4" aria-hidden="true" />}>
            CSV eksport
          </Button>
        ) : null}
      </div>
      {body}
    </div>
  );
}
