"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { listAdmins, type AdminAccountItem } from "@/lib/admin-api/admins";
import { downloadAuditCsv, listAudit, type AuditItem } from "@/lib/admin-api/audit";
import { AdminReauthCancelledError, adminErrorMessage, isAbortError } from "@/lib/admin-api/core";
import { fmtDateTime } from "@/lib/admin-format";
import {
  Button,
  Card,
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
  type FilterOption,
} from "@/components/admin/ui";
import { roleLabel, useCan } from "@/components/admin/shell";
import { AuditDrawer } from "./AuditDrawer";
import { OutcomeBadge, TargetCell } from "./cells";
import {
  OUTCOME_OPTIONS,
  PAGE_LIMIT,
  activeFilterCount,
  parseFilters,
  parseOpenId,
  targetTypeOptions,
  toApiFilters,
  type AuditFilters,
} from "./shared";

/**
 * S17 `/admin/audit`: the append-only audit trail. Filters (admin, action
 * prefix, target type / id, outcome, period) and the open drawer live in the URL,
 * so a link such as `?targetType=user&targetId=42` (from the user page) works;
 * a filter change resets the cursor and the pending request is aborted. The CSV
 * export is offered only to `audit.export` (owner, step-up); the server enforces it.
 */
export function AuditPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canExport = useCan("audit.export");

  const sp = new URLSearchParams(params.toString());
  const filters = parseFilters(sp);
  const openId = parseOpenId(sp);
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
    (signal: AbortSignal) => listAudit({ ...toApiFilters(JSON.parse(filterKey) as AuditFilters), cursor, limit: PAGE_LIMIT }, { signal }),
    [filterKey, cursor],
  );
  const [state, reload] = useLoad(load);

  // The admin picker. A failure only leaves the picker empty: the log itself does not depend on it.
  const [admins, setAdmins] = useState<AdminAccountItem[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    listAdmins({ signal: ctl.signal })
      .then((r) => setAdmins(r.items))
      .catch(() => {});
    return () => ctl.abort();
  }, []);
  const adminOptions: FilterOption[] = useMemo(() => {
    const opts = admins.map((a) => ({ value: a.id, label: a.username ? `${a.name} (@${a.username})` : a.name }));
    // A deep link to an admin we could not list must still show a truthful selection.
    return filters.adminId && !opts.some((o) => o.value === filters.adminId) ? [...opts, { value: filters.adminId, label: `Admin #${filters.adminId}` }] : opts;
  }, [admins, filters.adminId]);

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      await downloadAuditCsv(toApiFilters(filters));
      toast("Eksport boshlandi — fayl yuklab olinmoqda. Amal audit jurnaliga yozildi.");
    } catch (e) {
      if (!isAbortError(e) && !(e instanceof AdminReauthCancelledError)) toast(adminErrorMessage(e), { tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  function clearFilters() {
    update({ adminId: null, action: null, targetType: null, targetId: null, outcome: null, from: null, to: null });
  }

  const items = state.status === "ready" ? state.data.items : [];

  const columns: Column<AuditItem>[] = [
    { id: "at", header: "Vaqt", className: "whitespace-nowrap tabular-nums", cell: (r) => fmtDateTime(r.at) },
    {
      id: "admin",
      header: "Admin",
      className: "max-w-[12rem]",
      cell: (r) =>
        r.adminId ? (
          <div className="flex max-w-full flex-col">
            <span className="truncate">{r.adminName ?? `#${r.adminId}`}</span>
            {r.adminUsername ? <span className="text-muted-foreground truncate text-xs">@{r.adminUsername}</span> : null}
          </div>
        ) : (
          <span className="text-muted-foreground">Tizim (CLI)</span>
        ),
    },
    { id: "role", header: "Rol", hideOnCard: true, className: "whitespace-nowrap", cell: (r) => (r.actorRole ? roleLabel(r.actorRole) : "—") },
    {
      id: "action",
      header: "Amal",
      className: "whitespace-nowrap",
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
    },
    { id: "target", header: "Nishon", className: "min-w-[8rem] max-w-[14rem]", cell: (r) => <TargetCell type={r.targetType} id={r.targetId} /> },
    { id: "outcome", header: "Natija", cell: (r) => <OutcomeBadge outcome={r.outcome} /> },
    {
      id: "reason",
      header: "Sabab",
      hideOnCard: true,
      className: "max-w-[18rem] min-w-[10rem]",
      cell: (r) => (r.reason ? <span className="line-clamp-2 break-words" title={r.reason}>{r.reason}</span> : <span className="text-muted-foreground">—</span>),
    },
    { id: "ip", header: "IP", hideOnCard: true, className: "font-mono text-xs whitespace-nowrap", cell: (r) => r.ip ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Audit jurnali</h1>
          <p className="text-muted-foreground text-[13px]">Faqat qo&apos;shiladi — o&apos;zgartirish yoki o&apos;chirish bazada taqiqlangan.</p>
        </div>
        {canExport ? (
          <Button onClick={exportCsv} loading={exporting} icon={<Download className="size-4" aria-hidden="true" />}>
            CSV yuklab olish
          </Button>
        ) : null}
      </header>

      <Card className="flex flex-col gap-3 p-3">
        <FilterBar activeCount={active} onClear={clearFilters}>
          <SelectFilter label="Admin" value={filters.adminId} onChange={(v) => update({ adminId: v })} options={adminOptions} allLabel="Barcha adminlar" />
          <SearchInput
            value={filters.action}
            onChange={(v) => update({ action: v.trim() })}
            placeholder="Amal boshlanishi, masalan users.wallet"
            ariaLabel="Amal bo'yicha filtr"
          />
          <SelectFilter
            label="Nishon turi"
            value={filters.targetType}
            onChange={(v) => update({ targetType: v })}
            options={targetTypeOptions(filters.targetType)}
            allLabel="Barcha turlar"
          />
          <SearchInput
            value={filters.targetId}
            onChange={(v) => update({ targetId: v.trim() })}
            placeholder="Nishon ID (aniq)"
            ariaLabel="Nishon identifikatori bo'yicha filtr"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold">Natija</span>
            <Segmented
              ariaLabel="Natija bo'yicha"
              options={OUTCOME_OPTIONS}
              value={filters.outcome}
              onChange={(v) => update({ outcome: v })}
            />
          </div>
        </FilterBar>
        <div className="flex flex-wrap items-center gap-2">
          {filters.from && filters.to ? (
            <>
              <DateRangePicker ariaLabel="Davr" value={{ from: filters.from, to: filters.to }} onChange={(r) => update({ from: r.from, to: r.to })} />
              <Button size="sm" variant="ghost" onClick={() => update({ from: null, to: null })}>
                Sanani olib tashlash
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                const r = presetRange("7d");
                update({ from: r.from, to: r.to });
              }}
            >
              Sana bo&apos;yicha filtr
            </Button>
          )}
        </div>
      </Card>

      {state.status === "forbidden" ? (
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
            caption="Audit yozuvlari"
            columns={columns}
            rows={items}
            rowKey={(r) => r.id}
            loading={state.status === "loading"}
            onRowClick={(r) => update({ id: r.id })}
            empty={
              <EmptyState
                title={active > 0 ? "Filtrlarga mos yozuv topilmadi" : "Audit yozuvlari yo'q"}
                description={active > 0 ? "Filtrlarni o'zgartiring yoki tozalang." : "Admin amallari shu yerda paydo bo'ladi."}
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
        <AuditDrawer
          key={openId}
          id={openId}
          onClose={() => update({ id: null })}
          // A filter shortcut from the drawer closes it, so the narrowed list is what the admin sees next.
          onFilter={(patch) => update({ ...patch, id: null })}
        />
      ) : null}
    </div>
  );
}
