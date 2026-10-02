"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Minus } from "lucide-react";
import {
  Button,
  CursorPager,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  MultiSelectFilter,
  SearchInput,
  SelectFilter,
  StatusPill,
  type Column,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { fmtDateTime, fmtNumber, fmtSoum } from "@/lib/admin-format";
import {
  ORDER_PROVIDERS,
  ORDER_PURPOSES,
  ORDER_SORTS,
  ORDER_STATES,
  downloadOrdersCsv,
  listOrders,
  type AdminOrderRow,
  type OrderListParams,
  type OrderProvider,
  type OrderPurpose,
  type OrderSort,
  type OrderState,
} from "@/lib/admin-api/payments";
import { ExportButton } from "./ExportButton";
import { ORDER_STATE_LABEL, ORDER_STATE_TONE, PROVIDER_LABEL, PURPOSE_LABEL, shortId } from "./labels";
import { useCursorList, useLocalFilters, useUrlFilters, type FilterStore } from "./list-state";
import { OptionalRangeFilter } from "./OptionalRange";

/** URL / local filter keys of the orders table (`state` is comma-joined). */
export const ORDER_FILTER_KEYS = ["state", "provider", "purpose", "userId", "q", "from", "to", "sort"] as const;
type OrderFilterKey = (typeof ORDER_FILTER_KEYS)[number];

export type OrdersTableProps = {
  /**
   * Filters pinned by the parent page (e.g. WP2's user page passes
   * `{ userId }`). A pinned filter is applied to every request and the export,
   * its control is hidden, and "clear filters" never removes it.
   */
  fixedFilters?: { userId?: string };
  /**
   * `true` inside another page (e.g. the user's "To'lovlar" tab): filters,
   * sort and paging live in local state and the URL is never written.
   * Default `false`: filters live in the URL query of the current page.
   */
  embedded?: boolean;
  /** Rows per page (1..100); default 50, or 20 when embedded. */
  pageSize?: number;
};

const DIGITS = /^\d{1,16}$/;

function pick<T extends string>(raw: string, allowed: readonly T[]): T | "" {
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : "";
}

/** URL text → validated request params (junk in the URL is ignored, never sent). */
function toParams(v: Record<OrderFilterKey, string>, fixedUserId: string | undefined): OrderListParams {
  const states = v.state
    .split(",")
    .filter((s): s is OrderState => (ORDER_STATES as readonly string[]).includes(s));
  const userId = fixedUserId ?? (DIGITS.test(v.userId) ? v.userId : "");
  return {
    state: [...new Set(states)],
    provider: pick<OrderProvider>(v.provider, ORDER_PROVIDERS),
    purpose: pick<OrderPurpose>(v.purpose, ORDER_PURPOSES),
    userId: userId || undefined,
    q: v.q.trim() || undefined,
    from: v.from || undefined,
    to: v.to || undefined,
    sort: pick<OrderSort>(v.sort, ORDER_SORTS) || "created_desc",
  };
}

/**
 * S8 orders table (plan §7.1): filters, sortable columns (created ↓, amount ↓),
 * keyset paging, CSV export (with `payments.export`). Row click opens S9.
 */
export function OrdersTable(props: OrdersTableProps) {
  return props.embedded ? <EmbeddedOrders {...props} /> : <RoutedOrders {...props} />;
}

function RoutedOrders(props: OrdersTableProps) {
  const store = useUrlFilters(ORDER_FILTER_KEYS);
  return <OrdersView store={store} {...props} />;
}

function EmbeddedOrders(props: OrdersTableProps) {
  const store = useLocalFilters(ORDER_FILTER_KEYS);
  return <OrdersView store={store} {...props} />;
}

function OrdersView({ store, fixedFilters, embedded = false, pageSize }: OrdersTableProps & { store: FilterStore<OrderFilterKey> }) {
  const router = useRouter();
  const canExport = useCan("payments.export");
  const fixedUserId = fixedFilters?.userId;
  const v = store.values;
  const params = useMemo(() => toParams(v, fixedUserId), [v, fixedUserId]);
  const limit = Math.min(Math.max(pageSize ?? (embedded ? 20 : 50), 1), 100);
  const fetchKey = JSON.stringify([params, limit]);
  const { state, cursor, setCursor, retry } = useCursorList<AdminOrderRow>(fetchKey, (c, signal) =>
    listOrders({ ...params, cursor: c, limit }, { signal }),
  );

  const activeCount = [v.state, v.provider, v.purpose, fixedUserId ? "" : v.userId, v.q, v.from || v.to].filter(Boolean).length;

  // Key columns first (amount, state, the default sort Yaratilgan, credited, external refunds),
  // so they fit the 990 px content box at 1280; provider details and the long txn id follow.
  const columns: Column<AdminOrderRow>[] = [
    {
      id: "id",
      header: "Buyurtma",
      cell: (o) => (
        <Link href={`/admin/payments/${o.id}`} title={o.id} className="font-mono text-[12.5px] underline-offset-2 hover:underline">
          {shortId(o.id)}
        </Link>
      ),
    },
    ...(fixedUserId
      ? []
      : [
          {
            id: "user",
            header: "Foydalanuvchi",
            cell: (o: AdminOrderRow) => (
              <Link href={`/admin/users/${o.userId}`} className="block max-w-[9rem] truncate underline-offset-2 hover:underline" title={o.userName || `#${o.userId}`}>
                {o.userName || `#${o.userId}`}
              </Link>
            ),
          },
        ]),
    { id: "amount", header: "Summa", align: "right", sortKey: "amount_desc", className: "tabular-nums whitespace-nowrap", cell: (o) => fmtSoum(o.amountSoum) },
    {
      id: "state",
      header: "Holat",
      cell: (o) => (
        <StatusPill tone={ORDER_STATE_TONE[o.state]} dot>
          {ORDER_STATE_LABEL[o.state]}
        </StatusPill>
      ),
    },
    { id: "created", header: "Yaratilgan", sortKey: "created_desc", className: "tabular-nums whitespace-nowrap", cell: (o) => fmtDateTime(o.createdAt) },
    {
      id: "credited",
      header: "Hisobga yozildi",
      align: "center",
      cell: (o) =>
        o.credited ? (
          <Check className="text-badge-success-text mx-auto size-4" aria-label="Ha" />
        ) : o.state === "paid" ? (
          <StatusPill tone="danger">Yo&apos;q</StatusPill>
        ) : (
          <Minus className="text-muted-foreground mx-auto size-4" aria-label="Yo'q" />
        ),
    },
    {
      id: "refunds",
      header: "Tashqi qaytarish",
      align: "right",
      className: "tabular-nums",
      cell: (o) => (o.externalRefunds > 0 ? <StatusPill tone="danger">{fmtNumber(o.externalRefunds)}</StatusPill> : "—"),
    },
    { id: "provider", header: "Provayder", cell: (o) => PROVIDER_LABEL[o.provider] },
    {
      id: "purpose",
      header: "Maqsad",
      cell: (o) => (o.purpose === "pro" ? <StatusPill tone="primary">Pro</StatusPill> : <span className="whitespace-nowrap">To&apos;ldirish</span>),
    },
    {
      id: "txn",
      header: "Tranzaksiya",
      cell: (o) => (o.providerTxn ? <span className="block max-w-[10rem] truncate font-mono text-[12px]" title={o.providerTxn}>{o.providerTxn}</span> : "—"),
    },
    { id: "performed", header: "To'langan", className: "tabular-nums whitespace-nowrap", cell: (o) => fmtDateTime(o.performTime) },
  ];

  const clear = () => store.clear();
  const rows = state.data?.items ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <FilterBar activeCount={activeCount} onClear={clear}>
            <SearchInput
              value={v.q}
              onChange={(q) => store.set({ q })}
              placeholder="Buyurtma ID yoki tranzaksiya (aniq)"
              ariaLabel="Buyurtma qidirish"
            />
            <MultiSelectFilter
              label="Holat"
              values={params.state ?? []}
              onChange={(next) => store.set({ state: next.join(",") })}
              options={ORDER_STATES.map((s) => ({ value: s, label: ORDER_STATE_LABEL[s] }))}
            />
            <SelectFilter
              label="Provayder"
              value={params.provider ?? ""}
              onChange={(provider) => store.set({ provider })}
              options={ORDER_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
            />
            <SelectFilter
              label="Maqsad"
              value={params.purpose ?? ""}
              onChange={(purpose) => store.set({ purpose })}
              options={ORDER_PURPOSES.map((p) => ({ value: p, label: PURPOSE_LABEL[p] }))}
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
            <OptionalRangeFilter label="Yaratilgan sana" from={v.from} to={v.to} onChange={(r) => store.set({ from: r.from, to: r.to })} />
          </FilterBar>
        </div>
        {canExport ? <ExportButton onExport={() => downloadOrdersCsv(params)} /> : null}
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
            caption="To'lov buyurtmalari"
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            loading={state.status === "loading"}
            skeletonRows={embedded ? 5 : 8}
            sort={params.sort}
            onSortChange={(sort) => store.set({ sort: sort === "created_desc" ? "" : sort })}
            onRowClick={(o) => router.push(`/admin/payments/${o.id}`)}
            empty={
              activeCount > 0 ? (
                <EmptyState
                  title="Filtrlarga mos buyurtma topilmadi"
                  description="Qidiruv aniq moslik bo'yicha ishlaydi: buyurtma ID, prepare ID yoki provayder tranzaksiyasi."
                  action={
                    <Button size="sm" onClick={clear}>
                      Filtrlarni tozalash
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="Buyurtmalar yo'q" description="Click yoki Payme orqali hali birorta buyurtma yaratilmagan." />
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
