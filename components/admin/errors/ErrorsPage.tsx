"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { BULK_RESOLVE_LIMIT, listErrors, resolveErrors, type ErrorItem } from "@/lib/admin-api/system";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CursorPager,
  DataTable,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  Segmented,
  SearchInput,
  SelectFilter,
  presetRange,
  toast,
  useLoad,
  type Column,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { ErrorDrawer } from "./ErrorDrawer";
import {
  LEVEL_LABEL,
  LEVEL_OPTIONS,
  PAGE_LIMIT,
  RESOLVED_OPTIONS,
  activeFilterCount,
  parseFilters,
  parseOpenId,
  toApiParams,
  urlValueOfResolved,
  type ResolvedView,
} from "./shared";

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * S16 `/admin/errors`: grouped, persisted errors. Filters (resolved view,
 * level, scope, message prefix, last-seen period) and the open drawer live in
 * the URL; a filter change resets the cursor and drops the selection and the
 * pending request is aborted. Checkbox bulk resolve (at most 100) and the
 * resolve button of the drawer appear only with `errors.resolve` (cosmetic,
 * the server enforces it).
 */
export function ErrorsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canResolve = useCan("errors.resolve");

  const filters = parseFilters(new URLSearchParams(params.toString()));
  const openId = parseOpenId(new URLSearchParams(params.toString()));
  const active = activeFilterCount(filters);
  const filterKey = JSON.stringify(filters);

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // The cursor belongs to one filter set: another filter set starts again at the first page.
  const [paging, setPaging] = useState<{ key: string; cursor: string | null }>({ key: filterKey, cursor: null });
  const cursor = paging.key === filterKey ? paging.cursor : null;
  const setCursor = (c: string | null) => setPaging({ key: filterKey, cursor: c });

  const load = useCallback(
    (signal: AbortSignal) => listErrors({ ...toApiParams(JSON.parse(filterKey) as ReturnType<typeof parseFilters>), cursor, limit: PAGE_LIMIT }, { signal }),
    [filterKey, cursor],
  );
  const [state, reload] = useLoad(load);

  // Selection is per page: it is keyed by filter set + cursor, so paging or filtering drops it.
  const selKey = `${filterKey}|${cursor ?? ""}`;
  const [sel, setSel] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: selKey, ids: EMPTY_SET });
  const selected = sel.key === selKey ? sel.ids : EMPTY_SET;
  const [bulkOpen, setBulkOpen] = useState(false);

  const items = state.status === "ready" ? state.data.items : [];
  // 403: the forbidden state is all there is — no filters, bulk action or pager around it.
  const forbidden = state.status === "forbidden";
  // Resolved rows can be ticked by "select all" but are never sent: the server would skip them anyway.
  const selectedOpen = items.filter((e) => selected.has(e.id) && !e.resolvedAt).map((e) => e.id);

  function clearFilters() {
    update({ resolved: null, level: null, scope: null, q: null, from: null, to: null });
  }

  const columns: Column<ErrorItem>[] = [
    { id: "last", header: "Oxirgi marta", className: "whitespace-nowrap tabular-nums", cell: (e) => fmtDateTime(e.lastSeenAt) },
    { id: "count", header: "Soni", align: "right", className: "tabular-nums", cell: (e) => fmtNumber(e.count) },
    {
      id: "level",
      header: "Daraja",
      cell: (e) => (
        <Badge tone={e.level === "error" ? "danger" : "warning"} dot>
          {LEVEL_LABEL[e.level] ?? e.level}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Holat",
      cell: (e) => (e.resolvedAt ? <Badge tone="success">Hal qilingan</Badge> : <Badge>Ochiq</Badge>),
    },
    {
      id: "scope",
      header: "Joy",
      cell: (e) =>
        e.scope ? (
          <button
            type="button"
            title="Shu joy bo'yicha filtrlash"
            onClick={() => update({ scope: e.scope })}
            className="hover:bg-muted focus-visible:ring-ring -mx-1 rounded px-1 font-mono text-xs outline-none focus-visible:ring-2"
          >
            {e.scope}
          </button>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: "message",
      header: "Xabar",
      className: "max-w-[26rem] min-w-[14rem]",
      cell: (e) => <span className="line-clamp-2 font-mono text-xs break-words">{e.message}</span>,
    },
    {
      id: "path",
      header: "Yo'l",
      hideOnCard: true,
      cell: (e) =>
        e.path ? (
          <span className="block max-w-[14rem] truncate font-mono text-xs" title={e.path}>
            {e.path}
          </span>
        ) : (
          "—"
        ),
    },
    { id: "process", header: "Jarayon", hideOnCard: true, cell: (e) => (e.process ? <span className="font-mono text-xs">{e.process}</span> : "—") },
  ];

  const hasRange = filters.from !== "" && filters.to !== "";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Xatolar</h1>
          <p className="text-muted-foreground text-[13px]">Bir xil xatolar birlashtiriladi. 90 kun saqlanadi.</p>
        </div>
        {canResolve && !forbidden ? (
          <Button
            variant="primary"
            disabled={selectedOpen.length === 0 || selectedOpen.length > BULK_RESOLVE_LIMIT}
            onClick={() => setBulkOpen(true)}
            icon={<CircleCheck className="size-3.5" aria-hidden="true" />}
          >
            Hal qilindi deb belgilash ({fmtNumber(selectedOpen.length)})
          </Button>
        ) : null}
      </header>

      {forbidden ? null : (
        <Card className="flex flex-col gap-3 p-3">
          <FilterBar activeCount={active} onClear={clearFilters}>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-muted-foreground text-[11px] font-semibold">Holat</span>
              <Segmented
                ariaLabel="Holat bo'yicha"
                options={RESOLVED_OPTIONS}
                value={filters.resolved}
                onChange={(v) => update({ resolved: urlValueOfResolved(v as ResolvedView) })}
              />
            </div>
            <SelectFilter
              label="Daraja"
              value={filters.level}
              onChange={(v) => update({ level: v })}
              options={LEVEL_OPTIONS}
              allLabel="Barcha darajalar"
            />
            <SearchInput value={filters.scope} onChange={(v) => update({ scope: v.trim() })} placeholder="Joy (scope), masalan pdf" ariaLabel="Joy bo'yicha qidirish" />
            <SearchInput value={filters.q} onChange={(v) => update({ q: v.trim() })} placeholder="Xabar boshlanishi bo'yicha qidirish" ariaLabel="Xabar bo'yicha qidirish" />
          </FilterBar>
          <div className="flex flex-wrap items-center gap-2">
            {hasRange ? (
              <>
                <DateRangePicker
                  ariaLabel="Oxirgi ko'rilgan davr"
                  value={{ from: filters.from, to: filters.to }}
                  onChange={(r) => update({ from: r.from, to: r.to })}
                />
                <Button size="sm" variant="ghost" onClick={() => update({ from: null, to: null })}>
                  Sanani olib tashlash
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => update(rangeParams())}>
                Sana bo&apos;yicha filtr
              </Button>
            )}
          </div>
        </Card>
      )}

      {forbidden ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={reload} />
        </Card>
      ) : (
        <>
          <DataTable
            caption="Saqlangan xatolar ro'yxati"
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            loading={state.status === "loading"}
            onRowClick={(e) => update({ id: e.id })}
            selectable={canResolve}
            selected={selected}
            onSelectedChange={(ids) => setSel({ key: selKey, ids })}
            empty={
              <EmptyState
                title={active > 0 ? "Filtrlarga mos xato topilmadi" : filters.resolved === "open" ? "Ochiq xato yo'q" : "Xatolar yo'q"}
                description={
                  active > 0
                    ? "Filtrlarni o'zgartiring yoki tozalang."
                    : "Xatolar worker va veb jarayonlar jurnaldan avtomatik yig'iladi."
                }
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
            nextCursor={state.status === "ready" ? state.data.nextCursor : null}
            onCursorChange={setCursor}
            total={state.status === "ready" ? state.data.total : null}
            totalCapped={state.status === "ready" ? state.data.totalCapped : false}
            loading={state.status === "loading"}
            resetKey={filterKey}
          />
        </>
      )}

      {openId ? (
        <ErrorDrawer key={openId} id={openId} canResolve={canResolve} onClose={() => update({ id: null })} onChanged={reload} />
      ) : null}

      {canResolve ? (
        <ConfirmDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          title="Xatolarni hal qilindi deb belgilash"
          description="Xuddi shu xato qayta yuz bersa, u yangi ochiq yozuv sifatida paydo bo'ladi."
          target={`${fmtNumber(selectedOpen.length)} ta ochiq xato`}
          reason={{ required: false, label: "Izoh (ixtiyoriy)" }}
          typedConfirmation={selectedOpen.length > 1 ? String(selectedOpen.length) : undefined}
          confirmLabel="Belgilash"
          onConfirm={async (ctx) => {
            const r = await resolveErrors(selectedOpen, ctx.reason);
            toast(`${fmtNumber(r.resolved)} ta xato hal qilindi deb belgilandi`);
            setSel({ key: selKey, ids: EMPTY_SET });
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** "Sana bo'yicha filtr" starts with the last 7 days. */
function rangeParams(): Record<string, string> {
  const r = presetRange("7d");
  return { from: r.from, to: r.to };
}
