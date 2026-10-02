"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getPricing, type PricingItem, type PricingItemResult, type PricingOverview } from "@/lib/admin-api/pricing";
import { fmtNumber, isIsoDate } from "@/lib/admin-format";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  KpiTile,
  SelectFilter,
  Skeleton,
  presetRange,
  validateRange,
  type DateRange,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { PricingDrawer } from "./PricingDrawer";
import { PricingTable } from "./PricingTable";
import {
  COVERAGE_WARN_PCT,
  DEFAULT_SORT,
  SETTING_LABEL,
  filterByGroup,
  lowCoverage,
  marginTone,
  markupText,
  parseSort,
  pctText,
  sortItems,
  useLoad,
  usdText,
} from "./shared";

/**
 * S20 `/admin/pricing` ("Narxlar", plan §17.6): KPI tiles, the coverage
 * caveat, filters (period, tool group) and sort in the URL, the per-tool table
 * and the row drawer (`tool` in the URL, so a drawer link can be shared).
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
  const load = useCallback((signal: AbortSignal) => getPricing({ from, to }, { signal }), [from, to]);
  const [state, retry] = useLoad<PricingOverview>(load);
  // A successful PUT/DELETE updates the row in place (no round trip); the aggregates are unchanged.
  const [patched, setPatched] = useState<Map<string, PricingItemResult>>(() => new Map());
  const applyResult = (r: PricingItemResult) => setPatched((m) => new Map(m).set(r.toolId, r));

  const activeFilters = Number(from !== defaultRange.from || to !== defaultRange.to) + Number(group !== "");
  const clear = () => update({ from: null, to: null, group: null, sort: null });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight">Narxlar va tannarx</h1>
          {canEdit ? null : <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold">Faqat ko&apos;rish</span>}
        </div>
        <p className="text-muted-foreground text-[13px]">
          Asosiy narx kod formulalaridan keladi; admin har bir vosita uchun foizli tuzatish belgilaydi. O&apos;zgarishlar faqat yangi buyurtmalarga ta&apos;sir qiladi.
        </p>
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
          sort={sort.value}
          openTool={openTool}
          filtered={activeFilters > 0}
          onClear={clear}
          onSort={(s) => update({ sort: s === DEFAULT_SORT ? null : s })}
          onOpen={(toolId) => update({ tool: toolId })}
          onClose={() => update({ tool: null })}
          onChanged={applyResult}
          onStale={retry}
        />
      )}
    </div>
  );
}

/** Static class per margin tone (Tailwind needs literal class names). */
const MARGIN_TEXT: Record<ReturnType<typeof marginTone>, string> = {
  danger: "text-destructive",
  warning: "text-badge-warning-text",
  success: "text-badge-success-text",
  neutral: "text-foreground",
  info: "text-foreground",
  primary: "text-foreground",
};

/**
 * A KPI money value that wraps between the number and its unit instead of
 * being cut off by the tile at 360 px (the number itself never breaks: NBSP groups).
 */
function WrapMoney({ amount, unit }: { amount: number | null; unit: string }) {
  if (amount === null) return <>—</>;
  return <span className="block whitespace-normal">{`${fmtNumber(Math.round(amount))} ${unit}`}</span>;
}

function PricingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Yuklanmoqda" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <KpiTile key={i} label="" value="" loading />
        ))}
      </div>
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-80 w-full" />
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
  sort,
  openTool,
  filtered,
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
  sort: string;
  openTool: string | null;
  filtered: boolean;
  onClear: () => void;
  onSort: (sort: string) => void;
  onOpen: (toolId: string) => void;
  onClose: () => void;
  onChanged: (r: PricingItemResult) => void;
  onStale: () => void;
}) {
  const items = data.items.map((i) => withPatch(i, patched));
  const rows = sortItems(filterByGroup(items, group), parseSort(sort));
  const low = items.filter((i) => i.marginPct !== null && i.marginPct < 30);
  const lowCov = lowCoverage(items);
  const open = openTool ? items.find((i) => i.toolId === openTool) ?? null : null;
  const { totals } = data;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile label="O'rtacha marja" value={<span className={MARGIN_TEXT[marginTone(totals.marginPct)]}>{pctText(totals.marginPct)}</span>} hint="naqd tushum bo'yicha tortilgan" />
        <KpiTile label="Marja < 30% vositalar" value={fmtNumber(low.length)} hint={low.length ? low.map((i) => i.title).join(", ") : "Hammasi me'yorda"} />
        <KpiTile
          label={`AI xarajat · pullik vositalar · ${fmtNumber(data.range.days)} kun`}
          value={<WrapMoney amount={totals.costSoumTools} unit="so'm" />}
          hint={`${usdText(totals.costUsdTools)} (xato ishlar bilan) · jami AI ${usdText(totals.costUsdAll)}, shundan boshqa ${usdText(totals.costUsdOther)} — bepul AI va noma'lum, marjaga kirmaydi`}
        />
        <KpiTile label="Kurs (so'm / USD)" value={fmtNumber(data.fx)} hint={`Sozlama: ${SETTING_LABEL.fx}`} />
        <KpiTile label="Maqsadli ustama" value={markupText(data.targetMarkup)} hint={`Sozlama: ${SETTING_LABEL.targetMarkup}`} />
      </div>

      {lowCov.length > 0 ? (
        <section aria-label="Qamrov ogohlantirishi" className="border-warning/50 bg-warning/10 rounded-xl border px-4 py-3 text-[13px]">
          <p>
            <strong className="font-semibold">Tannarx qamrovi {fmtNumber(COVERAGE_WARN_PCT)}% dan past:</strong>{" "}
            {lowCov.map((i) => `${i.title} (${pctText(i.coveragePct, 0)})`).join(", ")}. Bu vositalarda tannarx kam baholangan bo&apos;lishi, marja esa haqiqatdagidan optimistik
            ko&apos;rinishi mumkin.
          </p>
          {data.caveats.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold">Hisobga olinmaydigan va taxminiy qismlar ({fmtNumber(data.caveats.length)})</summary>
              <ul className="text-muted-foreground mt-2 ml-4 list-disc space-y-1.5 text-xs">
                {data.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <Card>
        <CardHeader
          title="Vositalar bo'yicha narx va tannarx"
          aside={
            <span className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs" aria-label="Marja ranglari">
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
          }
        />
        <CardBody>
          <PricingTable
            items={rows}
            days={data.range.days}
            sort={sort}
            onSortChange={onSort}
            onRowClick={(r) => onOpen(r.toolId)}
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
        </CardBody>
      </Card>

      <p className="text-muted-foreground text-xs">
        Narxlar va tushum tangada, tannarx so&apos;mda; marja va ustama uchun tanga so&apos;mga o&apos;tkaziladi (1 tanga = {fmtNumber(data.soumPerCoin)} so&apos;m).
        Marja = (naqd tushum − to&apos;liq tannarx) ÷ naqd tushum (ballar naqd hisoblanmaydi). To&apos;liq tannarx = tugallangan ishning o&apos;rtacha AI xarajati + xato va tashlab
        ketilgan ishlar xarajatining tugallangan ishga ulushi. Ustama = o&apos;rtacha ro&apos;yxat narxi ÷ to&apos;liq tannarx. «Tavsiya» ustamani maqsadli{" "}
        {markupText(data.targetMarkup)} ga yetkazadigan foiz; tanlama 20 ishdan kam bo&apos;lsa «kam ishonch» deb belgilanadi. Qatorni bosing — grafik, simulyator va tarix ochiladi.
      </p>

      {open ? <PricingDrawer key={open.toolId} item={open} onClose={onClose} onChanged={onChanged} onStale={onStale} /> : null}
    </>
  );
}
