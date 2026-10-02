"use client";

import { useState } from "react";
import { Button, CursorPager, DataTable, EmptyState, ErrorState, FilterBar, Forbidden, MultiSelectFilter, StatusPill, type Column } from "@/components/admin/ui";
import { DeltaCell, KIND_LABEL, KIND_TONE, ReferenceCell, useCursorList } from "@/components/admin/payments";
import { WALLET_LABEL } from "@/components/admin/money";
import { fmtDateTime } from "@/lib/admin-format";
import { TRANSACTION_KINDS, listUserTransactions, type AdminUserTransaction, type TransactionKind } from "@/lib/admin-api/users";

const PAGE_SIZE = 20;

/** The resolved link of a ledger row, built from ids only (never from the raw reference). */
function linkOf(t: AdminUserTransaction) {
  if (t.generationId) return { type: "generation" as const, id: t.generationId };
  if (t.orderId) return { type: "order" as const, id: t.orderId };
  return null;
}

/**
 * The user's "Hisob" tab: their ledger with the per-wallet split, on
 * `/api/admin/users/:id/transactions` (users.view — support has no
 * finance.view, so WP4's global `LedgerTable` is not used here). Filters and
 * paging are local state; the page URL is not touched.
 */
export function UserLedgerTable({ userId }: { userId: string }) {
  const [kinds, setKinds] = useState<TransactionKind[]>([]);
  const fetchKey = JSON.stringify([userId, kinds]);
  const { state, cursor, setCursor, retry } = useCursorList<AdminUserTransaction>(fetchKey, (c, signal) =>
    listUserTransactions(userId, { kind: kinds, cursor: c, limit: PAGE_SIZE }, { signal }),
  );
  const rows = state.data?.items ?? [];
  // Legacy Pro quota («Kvota (eski)»): the column shows only while a row on this page moved quota.
  const anyQuota = rows.some((t) => t.quota !== 0);

  const columns: Column<AdminUserTransaction>[] = [
    { id: "at", header: "Vaqt", className: "tabular-nums whitespace-nowrap", cell: (t) => fmtDateTime(t.createdAt) },
    {
      id: "kind",
      header: "Turi",
      cell: (t) => <StatusPill tone={KIND_TONE[t.kind]}>{KIND_LABEL[t.kind]}</StatusPill>,
    },
    { id: "points", header: "Ball", align: "right", cell: (t) => <DeltaCell value={t.points} /> },
    ...(anyQuota ? [{ id: "quota", header: WALLET_LABEL.quota, align: "right", cell: (t) => <DeltaCell value={t.quota} /> } satisfies Column<AdminUserTransaction>] : []),
    { id: "balance", header: "Balans", align: "right", cell: (t) => <DeltaCell value={t.balance} /> },
    { id: "ref", header: "Havola", className: "max-w-[14rem]", cell: (t) => <ReferenceCell reference={t.reference} link={linkOf(t)} /> },
    {
      id: "note",
      header: "Izoh (foydalanuvchiga ko'rinadi)",
      className: "max-w-[18rem]",
      cell: (t) => (t.note ? <span className="block truncate" title={t.note}>{t.note}</span> : "—"),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterBar activeCount={kinds.length} onClear={() => setKinds([])}>
        <MultiSelectFilter
          label="Turi"
          values={kinds}
          onChange={(next) => setKinds(next.filter((k): k is TransactionKind => (TRANSACTION_KINDS as readonly string[]).includes(k)))}
          options={TRANSACTION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        />
      </FilterBar>
      {state.status === "forbidden" ? (
        <div className="bg-card rounded-xl border">
          <Forbidden />
        </div>
      ) : state.status === "error" ? (
        <div className="bg-card rounded-xl border">
          <ErrorState message={state.message} requestId={state.requestId} onRetry={retry} />
        </div>
      ) : (
        <>
          <DataTable
            caption="Foydalanuvchi hisob jurnali"
            columns={columns}
            rows={rows}
            rowKey={(t) => t.id}
            loading={state.status === "loading"}
            skeletonRows={5}
            empty={
              kinds.length ? (
                <EmptyState
                  title="Bu turdagi yozuv yo'q"
                  action={
                    <Button size="sm" onClick={() => setKinds([])}>
                      Filtrlarni tozalash
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="Hisob jurnali bo'sh" description="Foydalanuvchida hali hech qanday kirim-chiqim yo'q." />
              )
            }
          />
          <CursorPager
            cursor={cursor}
            nextCursor={state.data?.nextCursor ?? null}
            onCursorChange={setCursor}
            total={state.data?.total ?? null}
            totalCapped={state.data?.totalCapped ?? false}
            loading={state.status === "loading"}
            resetKey={fetchKey}
          />
        </>
      )}
      <p className="text-muted-foreground text-xs">Admin ismi va tuzatish sababi foydalanuvchiga ko&apos;rinmaydi — ular faqat audit jurnalida.</p>
    </div>
  );
}
