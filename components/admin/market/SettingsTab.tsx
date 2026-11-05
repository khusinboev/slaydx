"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { getMarketToolPricing, setMarketToolPercent, type MarketOverview, type MarketToolPricing } from "@/lib/admin-api/market";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Forbidden, toast, useLoad, type Column } from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell/admin-identity";
import { fmtNumber } from "@/lib/admin-format";

const FIELD = "border-input bg-card focus:ring-ring h-9 w-full rounded-lg border px-2.5 text-[13px] tabular-nums outline-none focus:ring-2";

/** Hoisted: a stable loader for `useLoad`. */
const loadPricing = (signal: AbortSignal) => getMarketToolPricing({ signal });

/** «Sozlamalar»: the link to the settings tab with the market keys, and the per-tool percent table. */
export function SettingsTab({ overview }: { overview: MarketOverview | null }) {
  const canPrice = useCan("pricing.edit");
  const [state, retry] = useLoad(loadPricing);
  const [editing, setEditing] = useState<MarketToolPricing | null>(null);

  const columns: Column<MarketToolPricing>[] = [
    {
      id: "title",
      header: "Vosita",
      cell: (t) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {t.title}
          {t.disabled ? <Badge tone="warning">O&apos;chirilgan</Badge> : null}
        </span>
      ),
    },
    { id: "active", header: "Sotuvda", align: "right", className: "tabular-nums", cell: (t) => fmtNumber(t.active) },
    {
      id: "percent",
      header: "Ulush",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      cell: (t) => (
        <>
          {t.effective} %{t.percent === null ? <span className="text-muted-foreground"> · umumiy</span> : null}
        </>
      ),
    },
    ...(canPrice
      ? [
          {
            id: "act",
            header: "",
            align: "right" as const,
            cell: (t: MarketToolPricing) => (
              <Button size="sm" onClick={() => setEditing(t)}>
                O&apos;zgartirish
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3 pt-3">
      <Card>
        <CardHeader title="Bozor sozlamalari" description="Umumiy foiz, yaxlitlash, nusxa chegaralari va yoqish tugmasi Sozlamalar sahifasida." />
        <CardBody className="flex flex-col gap-2 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/settings?tab=market" className="border-input hover:bg-muted inline-flex h-9 items-center rounded-lg border px-3">
              «Bozor» sozlamalari
            </Link>
            <Link href="/admin/settings?tab=features" className="border-input hover:bg-muted inline-flex h-9 items-center rounded-lg border px-3">
              Yoqish: «Funksiyalar»
            </Link>
          </div>
          {overview && !overview.trgm ? <p className="text-muted-foreground text-xs">pg_trgm: yo&apos;q. Qidiruv faqat to&apos;liq matn bo&apos;yicha ishlaydi.</p> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Vositalar bo'yicha ulush" description={state.status === "ready" ? `Umumiy ulush: ${state.data.percent} %. Vosita uchun alohida foiz undan ustun turadi.` : undefined} />
        <CardBody>
          {state.status === "forbidden" ? <Forbidden /> : null}
          {state.status === "error" ? <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} /> : null}
          {state.status === "loading" || state.status === "ready" ? (
            <DataTable
              columns={columns}
              rows={state.status === "ready" ? state.data.items : []}
              rowKey={(t) => t.toolId}
              caption="Vositalar bo'yicha ulush"
              loading={state.status === "loading"}
              empty={<EmptyState title="Vosita yo'q" />}
            />
          ) : null}
        </CardBody>
      </Card>
      {editing ? <PercentDialog key={editing.toolId} tool={editing} onClose={() => setEditing(null)} onSaved={retry} /> : null}
    </div>
  );
}

function PercentDialog({ tool, onClose, onSaved }: { tool: MarketToolPricing; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [text, setText] = useState(tool.percent === null ? "" : String(tool.percent));
  const next = text === "" ? null : Number(text);
  const valid = next === null || (Number.isInteger(next) && next >= 10 && next <= 100);
  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Ulush — ${tool.title}`}
      description="Bo'sh qoldirilsa umumiy foiz ishlaydi. Ko'rilayotgan xaridda narx o'zgarsa, xaridorga yangi narx ko'rsatiladi."
      before={tool.percent === null ? "umumiy" : `${tool.percent} %`}
      after={next === null ? "umumiy" : `${next} %`}
      reason={{ minLength: 5 }}
      confirmLabel="Qo'llash"
      confirmDisabled={!valid || next === tool.percent}
      sheet
      onConfirm={async ({ reason, idempotencyKey }) => {
        await setMarketToolPercent(tool.toolId, next, reason, idempotencyKey);
        toast("Ulush yangilandi");
        onSaved();
      }}
    >
      <label htmlFor={id} className="flex flex-col gap-1 text-[12.5px] font-semibold">
        Ulush, % <span className="text-muted-foreground font-normal">· 10–100</span>
        <input id={id} value={text} inputMode="numeric" autoComplete="off" aria-invalid={!valid} onChange={(e) => setText(e.target.value.replace(/\D/g, "").slice(0, 3))} className={FIELD} />
      </label>
    </ConfirmDialog>
  );
}
