"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleMinus, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, EmptyState } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtUsd } from "@/lib/admin-format";
import type { ProviderItem, SystemBody, Verdict } from "@/lib/admin-api/providers";
import { tabCountOf, providerFigures, VERDICT_LABEL, type Category, type TabId } from "./categories";
import { VERDICT_TONE, type Period } from "./format";
import { ProviderTable, type TestState } from "./ProviderTable";
import { RoutePanel, SpendPanel } from "./SidePanels";
import { SystemSection } from "./SystemSection";

const ICON = { ok: CircleCheck, single: TriangleAlert, missing: CircleAlert, off: CircleMinus } as const;
const BANNER: Record<Verdict, string> = {
  ok: "border-success/30 bg-success/10",
  single: "border-warning/40 bg-warning/10",
  missing: "border-destructive/30 bg-destructive/10",
  off: "bg-muted/40",
};
const TEXT: Record<Verdict, string> = { ok: "text-success-text", single: "text-badge-warning-text", missing: "text-destructive", off: "text-muted-foreground" };

const OV_GRID =
  "grid grid-cols-2 items-center gap-x-3 gap-y-2.5 min-[760px]:grid-cols-[minmax(0,2fr)_150px_minmax(0,1fr)_minmax(0,1fr)_84px_84px] min-[1100px]:grid-cols-[minmax(0,2.4fr)_170px_minmax(0,1.3fr)_minmax(0,1.3fr)_120px_92px]";
const LBL = "text-muted-foreground mb-0.5 block text-[11px] font-semibold min-[760px]:hidden";

/** «Umumiy»: one row per cost category; «Ochish» switches to its tab. System health sits below, folded. */
export function OverviewTab({ categories, system, legacy, onOpen }: { categories: Category[]; system: SystemBody; legacy: ReactNode; onOpen: (id: TabId) => void }) {
  const h = "text-muted-foreground text-xs font-semibold";
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Toifalar holati" className="bg-card overflow-hidden rounded-xl border">
        <header className="flex flex-wrap items-baseline gap-2 px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold">Toifalar bo&apos;yicha holat</h2>
          <span className="text-muted-foreground text-xs">Toifaga o&apos;tish uchun «Ochish»ni bosing</span>
        </header>
        <div role="table" aria-label="Toifalar">
          <div role="row" className={cn(OV_GRID, "bg-muted/40 hidden px-4 py-2.5 min-[760px]:grid")}>
            <span role="columnheader" className={h}>Toifa</span>
            <span role="columnheader" className={h}>Holat</span>
            <span role="columnheader" className={h}>Asosiy</span>
            <span role="columnheader" className={h}>Zaxira</span>
            <span role="columnheader" className={cn(h, "text-right")}>30 kun</span>
            <span role="columnheader" />
          </div>
          {categories.map((c) => (
            <div key={c.id} role="row" data-category={c.id} data-verdict={c.verdict} className={cn(OV_GRID, "border-t px-4 py-3.5")}>
              <div role="cell" className="col-span-full min-w-0 min-[760px]:col-span-1">
                <p className="font-semibold">{c.label}</p>
                <p className="text-muted-foreground text-[12.5px]">{c.desc}</p>
              </div>
              <div role="cell">
                <span className={LBL}>Holat</span>
                <Badge tone={VERDICT_TONE[c.verdict]} dot>
                  {VERDICT_LABEL[c.verdict]}
                </Badge>
              </div>
              <div role="cell" className="text-[13px]">
                <span className={LBL}>Asosiy</span>
                {c.primary}
              </div>
              <div role="cell" className="text-muted-foreground text-[13px]">
                <span className={LBL}>Zaxira</span>
                {c.fallback}
              </div>
              <div role="cell" className="font-semibold tabular-nums min-[760px]:text-right">
                <span className={LBL}>30 kun</span>
                {fmtUsd(c.spendUsd)}
              </div>
              <div role="cell" className="col-span-full min-[760px]:col-span-1 min-[760px]:text-right">
                <Button size="sm" className="max-[759px]:h-10 max-[759px]:w-full" aria-label={`Ochish: ${c.label}`} onClick={() => onOpen(c.id)}>
                  Ochish
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {legacy}
      <details data-system className="group">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-[13px] font-medium">Tizim holati (jarayonlar, himoya, parallel so&apos;rovlar)</summary>
        <div className="mt-3">
          <SystemSection system={system} />
        </div>
      </details>
    </div>
  );
}

export function CategoryTab({
  category,
  categories,
  canEdit,
  canStoreKeys,
  period,
  onPeriod,
  propagationSec,
  tests,
  onToggle,
  onKey,
  onDeleteKey,
  onTest,
  onChanged,
}: {
  category: Category;
  categories: Category[];
  canEdit: boolean;
  canStoreKeys: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  propagationSec: number;
  tests: Readonly<Record<string, TestState>>;
  onToggle: (item: ProviderItem) => void;
  onKey: (item: ProviderItem) => void;
  onDeleteKey: (item: ProviderItem) => void;
  onTest: (item: ProviderItem) => void;
  onChanged: () => void;
}) {
  const Icon = ICON[category.verdict];
  const rows = category.providers.map((p) => providerFigures(p, category.id, period, tabCountOf(categories, p.id)));
  const multi = category.details.length > 1;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Toifa holati" data-verdict={category.verdict} className={cn("flex flex-col gap-2 rounded-xl border px-4 py-4", BANNER[category.verdict])}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[17px] font-bold">{category.label}</h2>
          <Badge tone={VERDICT_TONE[category.verdict]} dot>
            {category.headline}
          </Badge>
        </div>
        {category.details.map((d) => (
          <div key={d.title} className="flex flex-col gap-1">
            <p data-verdict-detail className={cn("flex items-start gap-2 text-[13px] leading-snug", TEXT[category.verdict])}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {multi ? <strong className="font-semibold">{d.title}: </strong> : null}
                {d.text}
              </span>
            </p>
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">Yetarlilik:</span> {d.minimum}
            </p>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap items-start gap-4">
        {rows.length === 0 ? (
          <Card className="min-w-0 flex-[999_1_640px]">
            <EmptyState title="Bu toifada provayder yo'q" description="Provayderlar ro'yxati bo'sh." />
          </Card>
        ) : (
          <ProviderTable rows={rows} canEdit={canEdit} canStoreKeys={canStoreKeys} period={period} onPeriod={onPeriod} tests={tests} onToggle={onToggle} onKey={onKey} onDeleteKey={onDeleteKey} onTest={onTest} />
        )}
        <div className="flex min-w-0 flex-[1_1_340px] flex-col gap-4">
          <RoutePanel category={category} canEdit={canEdit} propagationSec={propagationSec} onChanged={onChanged} />
          <SpendPanel category={category} />
        </div>
      </div>
    </div>
  );
}
