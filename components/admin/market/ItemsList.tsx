"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AdminForbiddenError, adminErrorMessage, adminRequestId, isAbortError, type ListResult } from "@/lib/admin-api/core";
import { listMarketItems, type MarketAdminItem, type MarketItemsQuery } from "@/lib/admin-api/market";
import { CursorPager, DataTable, EmptyState, ErrorState, Forbidden, type Column } from "@/components/admin/ui";

type Result =
  | { reqKey: string; kind: "ok"; data: ListResult<MarketAdminItem> }
  | { reqKey: string; kind: "error"; message: string; requestId?: string }
  | { reqKey: string; kind: "forbidden" };

const PAGE_SIZE = 50;

/**
 * The table of the Navbat and Katalog tabs: `query` is the filter set, `reload` bumps re-read the page. Keyed by the
 * JSON of the filters (the same pattern as the moderation list), so a stale answer never overwrites a newer one.
 */
export function ItemsList({
  query,
  reload,
  columns,
  caption,
  emptyTitle,
  emptyText,
  onOpen,
  selected,
  onSelectedChange,
  renderCard,
  onRows,
}: {
  query: MarketItemsQuery;
  reload: number;
  columns: Column<MarketAdminItem>[];
  caption: string;
  emptyTitle: string;
  emptyText: string;
  onOpen: (id: string) => void;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  renderCard?: (row: MarketAdminItem) => ReactNode;
  onRows?: (rows: readonly MarketAdminItem[]) => void;
}) {
  const filterKey = JSON.stringify(query);
  // The cursor belongs to one filter set: a new filter key means page one again.
  const [page, setPage] = useState<{ key: string; cursor: string | null }>({ key: filterKey, cursor: null });
  const cursor = page.key === filterKey ? page.cursor : null;
  const [attempt, setAttempt] = useState(0);
  const reqKey = `${filterKey}|${cursor ?? ""}|${reload}|${attempt}`;
  const [result, setResult] = useState<Result | null>(null);
  const [lastOk, setLastOk] = useState<ListResult<MarketAdminItem> | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listMarketItems({ ...query, cursor, limit: PAGE_SIZE }, { signal: ctl.signal })
      .then((data) => {
        setResult({ reqKey, kind: "ok", data });
        setLastOk(data);
        onRows?.(data.items);
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (e instanceof AdminForbiddenError) setResult({ reqKey, kind: "forbidden" });
        else setResult({ reqKey, kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
    // `reqKey` covers the filters, the cursor and both reload counters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const current = result && result.reqKey === reqKey ? result : null;
  const loading = current === null;
  const data = current?.kind === "ok" ? current.data : lastOk;
  const rows = useMemo(() => data?.items ?? [], [data]);

  if (current?.kind === "forbidden") {
    return (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  }
  if (current?.kind === "error") {
    return (
      <div className="bg-card rounded-xl border">
        <ErrorState message={current.message} requestId={current.requestId} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }
  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        caption={caption}
        loading={loading}
        onRowClick={(r) => onOpen(r.id)}
        selectable={Boolean(onSelectedChange)}
        selected={selected}
        onSelectedChange={onSelectedChange}
        renderCard={renderCard}
        empty={<EmptyState title={emptyTitle} description={emptyText} />}
      />
      <CursorPager
        cursor={cursor}
        nextCursor={current?.kind === "ok" ? current.data.nextCursor : null}
        onCursorChange={(c) => setPage({ key: filterKey, cursor: c })}
        total={data?.total ?? null}
        totalCapped={data?.totalCapped ?? false}
        loading={loading}
        resetKey={filterKey}
      />
    </>
  );
}
