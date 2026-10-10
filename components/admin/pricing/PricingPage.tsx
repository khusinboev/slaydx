"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getPricing, type PriceAdjust, type PricingItem, type PricingItemResult, type PricingOverview } from "@/lib/admin-api/pricing";
import { fmtNumber, isIsoDate } from "@/lib/admin-format";
import {
  Button,
  Card,
  CardHeader,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  SelectFilter,
  Skeleton,
  presetRange,
  validateRange,
  type DateRange,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { ApplyRecommendationDialog } from "./ApplyRecommendationDialog";
import { AttentionStrip } from "./AttentionStrip";
import { HealthKpis, HealthKpisSkeleton } from "./HealthKpis";
import { MethodNotes } from "./MethodNotes";
import { PricingDrawer } from "./PricingDrawer";
import { PricingTable } from "./PricingTable";
import { attentionList } from "./attention";
import { DEFAULT_SORT, SORT_OPTIONS, filterByGroup, parseSort, recommendationState, sortItems, useLoad, type RecContext } from "./shared";

/**
 * S20 `/admin/pricing` («Narxlar»), a decision panel (docs/admin/pricing-redesign.md):
 * what needs attention first, then six health figures, then every tool (table on desktop,
 * cards on phones) with its sheet. Period, group, admin switch, sort and the open tool live
 * in the URL, so any view can be shared.
 */
export function PricingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const canEdit = useCan("pricing.edit");

  const defaultRange = presetRange("30d");
  const rawFrom = params.get("from") ?? "";
  const rawTo = params.get("to") ?? "";
  // An invalid or over-long range in the URL falls back to the default instead of a 400.
  const urlRange: DateRange = { from: rawFrom, to: rawTo };
  const range: DateRange = isIsoDate(rawFrom) && isIsoDate(rawTo) && validateRange(urlRange) === null ? urlRange : defaultRange;
  const group = params.get("group") ?? "";
  // Admin accounts' test jobs are left out by default; `admins=1` adds them (the same switch the API has).
  const includeAdmins = params.get("admins") === "1";
  const sort = parseSort(params.get("sort"));
  const openTool = params.get("tool");

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

  const { from, to } = range;
  const load = useCallback((signal: AbortSignal) => getPricing({ from, to, includeAdmins }, { signal }), [from, to, includeAdmins]);
  const [state, retry] = useLoad<PricingOverview>(load);
  // A successful PUT/DELETE updates the row in place (no round trip); the aggregates are unchanged.
  const [patched, setPatched] = useState<Map<string, PricingItemResult>>(() => new Map());
  const applyResult = (r: PricingItemResult) => setPatched((m) => new Map(m).set(r.toolId, r));
  // A reload brings fresh adjustments: local patches would only hide them.
  const reload = () => {
    setPatched(new Map());
    retry();
  };

  const activeFilters = Number(from !== defaultRange.from || to !== defaultRange.to) + Number(group !== "") + Number(includeAdmins);
  const clear = () => update({ from: null, to: null, group: null, sort: null, admins: null });

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">Narxlar</h1>
          {canEdit ? null : <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold">Faqat ko&apos;rish</span>}
        </div>
        <p className="text-muted-foreground text-[13px]">Har vositaning narxi, tannarxi va marjasi. O&apos;zgarish faqat yangi buyurtmalarga ta&apos;sir qiladi.</p>
      </header>

      {state.status === "forbidden" ? null : (
        <FilterBar activeCount={activeFilters} onClear={clear}>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold">Davr</span>
            <DateRangePicker value={range} onChange={(r) => update({ from: r.from, to: r.to })} ariaLabel="Narxlar davri" />
          </div>
          <SelectFilter
            label="Vosita guruhi"
            value={group}
            onChange={(v) => update({ group: v })}
            options={state.status === "ready" ? state.data.groups.map((g) => ({ value: g.id, label: g.label })) : []}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-muted-foreground text-[11px] font-semibold">Admin ishlari</span>
            <label className="border-input bg-card flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px] max-sm:h-11">
              <input
                type="checkbox"
                checked={includeAdmins}
                onChange={(e) => update({ admins: e.target.checked ? "1" : null })}
                className="accent-primary size-4"
              />
              Adminlar bilan
            </label>
          </div>
          {state.status === "ready" ? <AdminJobsNote includeAdmins={state.data.includeAdmins} adminJobs={state.data.adminJobs} /> : null}
        </FilterBar>
      )}

      {state.status === "loading" ? (
        <PricingSkeleton />
      ) : state.status === "forbidden" ? (
        <Card>
          <Forbidden />
        </Card>
      ) : state.status === "error" ? (
        <Card>
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </Card>
      ) : (
        <Ready
          data={state.data}
          patched={patched}
          group={group}
          includeAdmins={includeAdmins}
          sort={sort.value}
          openTool={openTool}
          filtered={activeFilters > 0}
          canEdit={canEdit}
          onClear={clear}
          onSort={(s) => update({ sort: s === DEFAULT_SORT ? null : s })}
          onOpen={(toolId) => update({ tool: toolId })}
          onClose={() => update({ tool: null })}
          onChanged={applyResult}
          onStale={reload}
        />
      )}
    </div>
  );
}

/** Next to the switch: how many admin jobs the figures leave out (or contain). */
function AdminJobsNote({ includeAdmins, adminJobs }: { includeAdmins: boolean; adminJobs: number }) {
  if (adminJobs === 0) return null;
  return (
    <p className="text-muted-foreground max-w-xs self-end pb-2 text-xs" role="status">
      {includeAdmins
        ? `Adminlarning ${fmtNumber(adminJobs)} ta tugallangan ishi ham hisobga olingan.`
        : `Adminlarning ${fmtNumber(adminJobs)} ta tugallangan ishi hisobga olinmagan.`}
    </p>
  );
}

function PricingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <Skeleton className="h-36 w-full rounded-xl" />
      <HealthKpisSkeleton />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}

/** An overview item with the adjustment/ladder of a later PUT/DELETE answer applied. */
function withPatch(item: PricingItem, patched: Map<string, PricingItemResult>): PricingItem {
  const p = patched.get(item.toolId);
  return p ? { ...item, adjust: p.adjust, ladder: p.ladder } : item;
}

function Ready({
  data,
  patched,
  group,
  includeAdmins,
  sort,
  openTool,
  filtered,
  canEdit,
  onClear,
  onSort,
  onOpen,
  onClose,
  onChanged,
  onStale,
}: {
  data: PricingOverview;
  patched: Map<string, PricingItemResult>;
  group: string;
  includeAdmins: boolean;
  sort: string;
  openTool: string | null;
  filtered: boolean;
  canEdit: boolean;
  onClear: () => void;
  onSort: (sort: string) => void;
  onOpen: (toolId: string) => void;
  onClose: () => void;
  onChanged: (r: PricingItemResult) => void;
  onStale: () => void;
}) {
  const sortId = useId();
  const [applying, setApplying] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);
  const items = data.items.map((i) => withPatch(i, patched));
  // The recommendations were computed against the adjustments of the overview load.
  const recContext: RecContext = useMemo(
    () => ({ basis: new Map<string, PriceAdjust>(data.items.map((i) => [i.toolId, i.adjust])), rangeFrom: data.range.from }),
    [data],
  );
  const rows = sortItems(filterByGroup(items, group), parseSort(sort));
  // Tools with no job in the period have nothing to decide: one toggle instead of a long tail of dashes.
  const idle = rows.filter((r) => r.jobs === 0 && r.completed === 0).length;
  const active = rows.filter((r) => r.jobs > 0 || r.completed > 0);
  const listed = showIdle || active.length === 0 ? rows : active;
  const attention = attentionList(filterByGroup(items, group), { ...recContext, targetMarkup: data.targetMarkup });
  const open = openTool ? (items.find((i) => i.toolId === openTool) ?? null) : null;
  const applyItem = applying ? (items.find((i) => i.toolId === applying) ?? null) : null;
  const applyRec = applyItem ? recommendationState(applyItem, recContext) : null;
  const startApply = (item: PricingItem) => setApplying(item.toolId);

  return (
    <>
      <AttentionStrip
        entries={attention}
        targetMarkup={data.targetMarkup}
        canEdit={canEdit}
        hasJobs={data.totals.completed > 0}
        onOpen={(i) => onOpen(i.toolId)}
        onApply={startApply}
      />

      <HealthKpis data={data} />

      <Card>
        <CardHeader
          title={`Vositalar (${fmtNumber(rows.length)})`}
          aside={
            <>
              <span className="text-muted-foreground hidden flex-wrap items-center gap-3 text-xs sm:flex" aria-label="Marja ranglari">
                <span className="inline-flex items-center gap-1">
                  <i aria-hidden="true" className="bg-destructive inline-block size-2.5 rounded-full" /> &lt; 30%
                </span>
                <span className="inline-flex items-center gap-1">
                  <i aria-hidden="true" className="bg-warning inline-block size-2.5 rounded-full" /> 30–60%
                </span>
                <span className="inline-flex items-center gap-1">
                  <i aria-hidden="true" className="bg-success inline-block size-2.5 rounded-full" /> &gt; 60%
                </span>
              </span>
              <span className="sm:hidden">
                <label htmlFor={sortId} className="sr-only">
                  Saralash
                </label>
                <select
                  id={sortId}
                  value={sort}
                  onChange={(e) => onSort(e.target.value)}
                  className="border-input bg-card focus:ring-ring h-11 rounded-lg border px-2.5 text-[13px] outline-none focus:ring-2"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
            </>
          }
        />
        <PricingTable
          items={listed}
          days={data.range.days}
          sort={sort}
          targetMarkup={data.targetMarkup}
          recContext={recContext}
          canEdit={canEdit}
          onSortChange={onSort}
          onOpen={(r) => onOpen(r.toolId)}
          onApply={startApply}
          empty={
            <EmptyState
              title="Bu guruhda vosita yo'q"
              description="Tanlangan guruhga mos vosita topilmadi."
              action={
                filtered ? (
                  <Button size="sm" onClick={onClear}>
                    Filtrlarni tozalash
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {idle > 0 && active.length > 0 ? (
          <div className="border-t px-4 py-2">
            <Button size="sm" variant="ghost" onClick={() => setShowIdle((v) => !v)} aria-expanded={showIdle} className="max-sm:min-h-11">
              {showIdle ? "Ishsiz vositalarni yashirish" : `Bu davrda ishi bo'lmagan vositalar (${fmtNumber(idle)})`}
            </Button>
          </div>
        ) : null}
      </Card>

      <MethodNotes caveats={data.caveats} targetMarkup={data.targetMarkup} paymentFeePercent={data.paymentFeePercent} soumPerCoin={data.soumPerCoin} />

      {open ? (
        <PricingDrawer
          key={open.toolId}
          item={open}
          includeAdmins={includeAdmins}
          targetMarkup={data.targetMarkup}
          recContext={recContext}
          latest={patched.get(open.toolId)}
          onClose={onClose}
          onApply={startApply}
          onChanged={onChanged}
          onStale={onStale}
        />
      ) : null}

      {canEdit && applyItem && applyRec?.kind === "change" && applyRec.block === null ? (
        <ApplyRecommendationDialog
          key={applyItem.toolId}
          item={applyItem}
          target={applyRec.target}
          targetMarkup={data.targetMarkup}
          includeAdmins={includeAdmins}
          onClose={() => setApplying(null)}
          onApplied={(r) => {
            // Closed here: once the row is patched the dialog unmounts before ConfirmDialog's own close.
            setApplying(null);
            onChanged(r);
          }}
          onStale={onStale}
        />
      ) : null}
    </>
  );
}
