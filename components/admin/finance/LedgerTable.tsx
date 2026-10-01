"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Badge,
  Button,
  CursorPager,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  MultiSelectFilter,
  SearchInput,
  type Column,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { WALLET_LABEL } from "@/components/admin/money";
import { fmtDateTime } from "@/lib/admin-format";
import { TRANSACTION_KINDS, downloadLedgerCsv, listLedger, type LedgerEntry, type LedgerListParams, type TransactionKind } from "@/lib/admin-api/payments";
import { ExportButton } from "@/components/admin/payments/ExportButton";
import { KIND_LABEL, KIND_TONE } from "@/components/admin/payments/labels";
import { DeltaCell, ReferenceCell } from "@/components/admin/payments/ledger-cells";
import { useCursorList, useLocalFilters, useUrlFilters, type FilterStore } from "@/components/admin/payments/list-state";
import { OptionalRangeFilter } from "@/components/admin/payments/OptionalRange";

/**
 * Filter keys. On the finance page they share the URL with the summary's
 * `from`/`to`, hence the `l` prefix on the ledger's own date range.
 */
export const LEDGER_FILTER_KEYS = ["kind", "userId", "reference", "lfrom", "lto"] as const;
type LedgerFilterKey = (typeof LEDGER_FILTER_KEYS)[number];

export type LedgerTableProps = {
  /**
   * Filters pinned by the parent page (e.g. WP2's user page passes
   * `{ userId }`): applied to every request and the export, the control and
   * the user column are hidden, "clear filters" never removes it.
   */
  fixedFilters?: { userId?: string };
  /**
   * `true` inside another page (e.g. the user's "Hisob" tab): filters and
   * paging live in local state, the URL is never written. Default `false`.
   */
  embedded?: boolean;
  /** Rows per page (1..100); default 50, or 20 when embedded. */
  pageSize?: number;
};

const DIGITS = /^\d{1,16}$/;

function toParams(v: Record<LedgerFilterKey, string>, fixedUserId: string | undefined): LedgerListParams {
  const kinds = v.kind.split(",").filter((k): k is TransactionKind => (TRANSACTION_KINDS as readonly string[]).includes(k));
  const userId = fixedUserId ?? (DIGITS.test(v.userId) ? v.userId : "");
  return {
    kind: [...new Set(kinds)],
    userId: userId || undefined,
    reference: v.reference.trim() || undefined,
    from: v.lfrom || undefined,
    to: v.lto || undefined,
  };
}

/**
 * S10 "Hisob kitobi": the global ledger (plan §7.1) — kind, user, per-wallet
 * deltas, reference (a link when it resolves to an order or a generation),
 * note, time. Newest first; CSV with `finance.export`.
 */
export function LedgerTable(props: LedgerTableProps) {
  return props.embedded ? <EmbeddedLedger {...props} /> : <RoutedLedger {...props} />;
}

function RoutedLedger(props: LedgerTableProps) {
  const store = useUrlFilters(LEDGER_FILTER_KEYS);
  return <LedgerView store={store} {...props} />;
}

function EmbeddedLedger(props: LedgerTableProps) {
  const store = useLocalFilters(LEDGER_FILTER_KEYS);
  return <LedgerView store={store} {...props} />;
}

function LedgerView({ store, fixedFilters, embedded = false, pageSize }: LedgerTableProps & { store: FilterStore<LedgerFilterKey> }) {
  const canExport = useCan("finance.export");
  const fixedUserId = fixedFilters?.userId;
  const v = store.values;
  const params = useMemo(() => toParams(v, fixedUserId), [v, fixedUserId]);
  const limit = Math.min(Math.max(pageSize ?? (embedded ? 20 : 50), 1), 100);
  const fetchKey = JSON.stringify([params, limit]);
  const { state, cursor, setCursor, retry } = useCursorList<LedgerEntry>(fetchKey, (c, signal) => listLedger({ ...params, cursor: c, limit }, { signal }));

  const activeCount = [v.kind, fixedUserId ? "" : v.userId, v.reference, v.lfrom || v.lto].filter(Boolean).length;
  const clear = () => store.clear();

  const columns: Column<LedgerEntry>[] = [
    {
      id: "kind",
      header: "Turi",
      cell: (e) => <Badge tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Badge>,
    },
    ...(fixedUserId
      ? []
      : [
          {
            id: "user",
            header: "Foydalanuvchi",
            className: "max-w-[11rem]",
            cell: (e: LedgerEntry) => (
              <Link href={`/admin/users/${e.userId}`} className="block truncate underline-offset-2 hover:underline" title={e.userName ?? undefined}>
                {e.userName || `#${e.userId}`}
              </Link>
            ),
          },
        ]),
    { id: "balance", header: WALLET_LABEL.balance, align: "right", cell: (e) => <DeltaCell value={e.balance} /> },
    { id: "quota", header: WALLET_LABEL.quota, align: "right", cell: (e) => <DeltaCell value={e.quota} /> },
    { id: "points", header: WALLET_LABEL.points, align: "right", cell: (e) => <DeltaCell value={e.points} /> },
    { id: "reference", header: "Havola", className: "max-w-[14rem]", cell: (e) => <ReferenceCell reference={e.reference} link={e.link} /> },
    {
      id: "note",
      header: "Izoh",
      className: "max-w-[14rem]",
      hideOnCard: true,
      cell: (e) => (e.note ? <span className="text-muted-foreground block truncate" title={e.note}>{e.note}</span> : "—"),
    },
    { id: "created", header: "Vaqt", sortKey: "created_desc", className: "tabular-nums whitespace-nowrap", cell: (e) => fmtDateTime(e.createdAt) },
  ];

  const rows = state.data?.items ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <FilterBar activeCount={activeCount} onClear={clear}>
            <MultiSelectFilter
              label="Turi"
              values={params.kind ?? []}
              onChange={(next) => store.set({ kind: next.join(",") })}
              options={TRANSACTION_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            {fixedUserId ? null : (
              <div className="w-40">
                <SearchInput
                  value={v.userId}
                  onChange={(userId) => store.set({ userId: userId.replace(/\D/g, "") })}
                  placeholder="Foydalanuvchi ID"
                  ariaLabel="Foydalanuvchi ID bo'yicha filtr"
                />
              </div>
            )}
            <SearchInput
              value={v.reference}
              onChange={(reference) => store.set({ reference })}
              placeholder="Havola (aniq): ish ID, click:…, refund:…"
              ariaLabel="Havola bo'yicha filtr"
            />
            <OptionalRangeFilter label="Sana" from={v.lfrom} to={v.lto} onChange={(r) => store.set({ lfrom: r.from, lto: r.to })} />
          </FilterBar>
        </div>
        {canExport ? <ExportButton onExport={() => downloadLedgerCsv(params)} /> : null}
      </div>

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
            caption="Hisob kitobi"
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            loading={state.status === "loading"}
            skeletonRows={embedded ? 5 : 8}
            sort="created_desc"
            empty={
              activeCount > 0 ? (
                <EmptyState
                  title="Filtrlarga mos yozuv topilmadi"
                  description="Havola aniq moslik bo'yicha qidiriladi."
                  action={
                    <Button size="sm" onClick={clear}>
                      Filtrlarni tozalash
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="Hisob yozuvlari yo'q" />
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
    </div>
  );
}
