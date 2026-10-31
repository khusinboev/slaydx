"use client";

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Badge, Button, Segmented } from "@/components/admin/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtNumber, fmtUsd } from "@/lib/admin-format";
import type { ProviderItem, ProviderTestResult } from "@/lib/admin-api/providers";
import type { ProviderRowData } from "./categories";
import { BILLING, NEED, PERIODS, keyState, providerStatus, type Period } from "./format";

export type TestState = { status: "running" } | ({ status: "done" } & ProviderTestResult);

// One grid, three layouts: <760 px stacked 2-column card, 760-1099 px five columns with key + actions on a second line,
// >=1100 px the full seven-column table. Static strings so Tailwind sees every class.
const GRID =
  "grid grid-cols-2 items-center gap-x-3 gap-y-2.5 min-[760px]:grid-cols-[minmax(0,2fr)_104px_128px_104px_64px] min-[1100px]:grid-cols-[minmax(0,2fr)_104px_128px_minmax(0,1fr)_104px_64px_auto]";
const NAME = "col-span-full min-w-0 min-[760px]:col-span-1";
const WIDE_ONLY_ROW = "col-span-full flex min-w-0 flex-col gap-1 min-[1100px]:col-span-1";
const LABEL = "text-muted-foreground mb-0.5 block text-[11px] font-semibold min-[760px]:hidden";

function Cell({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="cell" className={cn("min-w-0", className)}>
      {label ? <span className={LABEL}>{label}</span> : null}
      {children}
    </div>
  );
}

/** One provider as a compact table row (a stacked card on phones). Roles without edit rights get no switch and no buttons. */
function ProviderRow({
  row,
  canEdit,
  canStoreKeys,
  period,
  test,
  onToggle,
  onKey,
  onDeleteKey,
  onTest,
}: {
  row: ProviderRowData;
  canEdit: boolean;
  canStoreKeys: boolean;
  period: Period;
  test: TestState | undefined;
  onToggle: (item: ProviderItem) => void;
  onKey: (item: ProviderItem) => void;
  onDeleteKey: (item: ProviderItem) => void;
  onTest: (item: ProviderItem) => void;
}) {
  const { item } = row;
  const status = providerStatus(item);
  const key = keyState(item);
  const billing = BILLING[item.billing];
  const need = NEED[item.need];
  const free = item.billing === "free";
  const idle = row.calls === 0;
  const errors = row.errors !== null && row.errors > 0 ? ` · ${fmtNumber(row.errors)} ta xato` : "";
  const btn = "max-[759px]:h-10 max-[759px]:w-full";
  return (
    <div
      role="row"
      id={`provider-${item.id}`}
      data-provider={item.id}
      data-enabled={item.enabled ? "1" : "0"}
      data-usable={item.usable ? "1" : "0"}
      data-billing={item.billing}
      className={cn(GRID, "scroll-mt-20 border-t px-4 py-3.5")}
    >
      <Cell className={NAME}>
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="text-[13.5px] font-semibold">{item.label}</span>
          <Badge tone={need.tone}>{need.label}</Badge>
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs leading-snug">{item.role}</p>
        <p className="text-muted-foreground mt-0.5 font-mono text-[11.5px]">
          <span className="sr-only">Narxi: </span>
          {item.priceNote}
        </p>
      </Cell>
      <Cell label="To'lov">
        <Badge tone={billing.tone} title={billing.hint}>
          {billing.label}
        </Badge>
      </Cell>
      <Cell label="Holat">
        <span data-status={status.tone} title={status.hint}>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </span>
      </Cell>
      <Cell label="Kalit" className={cn(WIDE_ONLY_ROW, "text-xs")}>
        <span data-key-state>
          <Badge tone={key.tone} dot>
            {key.label}
          </Badge>
        </span>
        {item.keyUrl ? (
          <a href={item.keyUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 underline underline-offset-2">
            Kalit olish <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
        {item.updatedAt ? (
          <span className="text-muted-foreground">
            <span className="text-foreground">{item.updatedBy ?? "noma'lum admin"}</span> · {fmtDateTime(item.updatedAt)}
          </span>
        ) : null}
      </Cell>
      <Cell label={PERIODS.find((p) => p.value === period)?.label} className="text-left min-[760px]:text-right">
        <div data-usage data-period={period}>
          <p className="text-[13px] font-semibold tabular-nums">{idle ? (free ? "0 ta so'rov" : "—") : free ? `${fmtNumber(row.calls)} ta so'rov` : fmtUsd(row.usd)}</p>
          <p className="text-muted-foreground text-[11.5px]">
            {idle ? (free ? "" : "ishlatilmagan") : free ? errors.slice(3) : `${fmtNumber(row.calls)} ta so'rov${errors}`}
            {row.shared ? (idle ? "" : " · ") + "barcha toifalar" : ""}
          </p>
        </div>
      </Cell>
      <Cell label="Yoqilgan">
        {canEdit && item.implemented ? (
          <button
            type="button"
            role="switch"
            aria-checked={item.enabled}
            aria-label={`${item.label}: yoqilgan`}
            onClick={() => onToggle(item)}
            className={cn(
              "focus-visible:ring-ring relative h-6 w-11 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2",
              item.enabled ? "border-primary bg-primary" : "border-input bg-muted",
            )}
          >
            <span aria-hidden="true" className={cn("bg-card absolute top-0.5 left-0.5 size-4.5 rounded-full shadow transition-transform", item.enabled ? "translate-x-5" : "translate-x-0")} />
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">{item.enabled ? "Yoqilgan" : "O'chirilgan"}</span>
        )}
      </Cell>
      {canEdit ? (
        <Cell className="col-span-full flex flex-wrap items-center gap-2 max-[759px]:grid max-[759px]:grid-cols-1 min-[1100px]:col-span-1 min-[1100px]:justify-end">
          <Button size="sm" className={btn} onClick={() => onKey(item)} disabled={!canStoreKeys} title={canStoreKeys ? undefined : "Serverda shifrlash kaliti sozlanmagan"}>
            {item.hasDbKey ? "Almashtirish" : "Kalitni kiritish"}
          </Button>
          {item.hasDbKey ? (
            <Button size="sm" className={btn} variant="dangerOutline" onClick={() => onDeleteKey(item)}>
              O&apos;chirish
            </Button>
          ) : null}
          {item.testable ? (
            <Button size="sm" className={btn} variant="ghost" loading={test?.status === "running"} onClick={() => onTest(item)}>
              Tekshirish
            </Button>
          ) : null}
        </Cell>
      ) : null}
      {test?.status === "done" ? (
        <p role="status" data-test-result={test.ok ? "ok" : "fail"} className={cn("col-span-full text-xs font-medium", test.ok ? "text-badge-success-text" : "text-destructive")}>
          {test.message}
        </p>
      ) : null}
    </div>
  );
}

function Head() {
  const h = "text-muted-foreground text-xs font-semibold";
  return (
    <div role="row" className={cn("bg-muted/40 hidden px-4 py-2.5 min-[760px]:grid min-[760px]:grid-cols-[minmax(0,2fr)_104px_128px_104px_64px] min-[1100px]:grid-cols-[minmax(0,2fr)_104px_128px_minmax(0,1fr)_104px_64px_auto] gap-x-3")}>
      <span role="columnheader" className={h}>Provayder</span>
      <span role="columnheader" className={h}>To&apos;lov</span>
      <span role="columnheader" className={h}>Holat</span>
      <span role="columnheader" className={cn(h, "max-[1099px]:hidden")}>Kalit</span>
      <span role="columnheader" className={cn(h, "text-right")}>Ishlatilgan</span>
      <span role="columnheader" className={h}>Yoqiq</span>
      <span role="columnheader" className={cn(h, "max-[1099px]:hidden min-[1100px]:min-w-[200px]")}><span className="sr-only">Amallar</span></span>
    </div>
  );
}

export function ProviderTable({
  rows,
  canEdit,
  canStoreKeys,
  period,
  onPeriod,
  tests,
  onToggle,
  onKey,
  onDeleteKey,
  onTest,
}: {
  rows: ProviderRowData[];
  canEdit: boolean;
  canStoreKeys: boolean;
  period: Period;
  onPeriod: (p: Period) => void;
  tests: Readonly<Record<string, TestState>>;
  onToggle: (item: ProviderItem) => void;
  onKey: (item: ProviderItem) => void;
  onDeleteKey: (item: ProviderItem) => void;
  onTest: (item: ProviderItem) => void;
}) {
  return (
    <section aria-label="Provayderlar" className="bg-card min-w-0 flex-[999_1_640px] overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">Provayderlar</h3>
          <p className="text-muted-foreground text-xs">Bazadagi kalit serverdagi (env) kalitdan ustun</p>
        </div>
        <Segmented ariaLabel="Ishlatilish davri" value={period} onChange={(v) => onPeriod(v as Period)} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
      </header>
      <div role="table" aria-label="Provayderlar jadvali">
        <Head />
        {rows.map((r) => (
          <ProviderRow key={r.item.id} row={r} canEdit={canEdit} canStoreKeys={canStoreKeys} period={period} test={tests[r.item.id]} onToggle={onToggle} onKey={onKey} onDeleteKey={onDeleteKey} onTest={onTest} />
        ))}
      </div>
    </section>
  );
}
