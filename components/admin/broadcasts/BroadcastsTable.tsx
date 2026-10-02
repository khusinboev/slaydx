"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AdminForbiddenError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
  type ListResult,
} from "@/lib/admin-api/core";
import { listBroadcasts, type BroadcastListItem, type BroadcastStatus } from "@/lib/admin-api/broadcasts";
import { fmtDateTime, fmtNumber } from "@/lib/admin-format";
import {
  Button,
  CursorPager,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  MultiSelectFilter,
  type Column,
} from "@/components/admin/ui";
import { STATUS_OPTIONS, StatusPill, audienceLabel, isBroadcastStatus } from "./shared";

/** URL query → statuses. Unknown values are dropped, so a hand-edited link shows the unfiltered list. */
export function statusesFromParams(sp: Pick<URLSearchParams, "get"> | null): BroadcastStatus[] {
  const raw = sp?.get("status") ?? "";
  const out: BroadcastStatus[] = [];
  for (const v of raw.split(",")) if (isBroadcastStatus(v) && !out.includes(v)) out.push(v);
  return out;
}

export function statusesToSearch(statuses: ReadonlyArray<BroadcastStatus>): string {
  return statuses.length ? `status=${statuses.join(",")}` : "";
}

type Result =
  | { reqKey: string; kind: "ok"; data: ListResult<BroadcastListItem> }
  | { reqKey: string; kind: "error"; message: string; requestId?: string }
  | { reqKey: string; kind: "forbidden" };

const PAGE_SIZE = 50;

/** S13 list: status filter in the URL, keyset pager, row → detail page. */
export function BroadcastsTable() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlKey = searchParams?.toString() ?? "";
  const statuses = useMemo(() => statusesFromParams(new URLSearchParams(urlKey)), [urlKey]);
  const filterKey = statuses.join(",");

  const setStatuses = useCallback(
    (next: BroadcastStatus[]) => {
      const qs = statusesToSearch(next);
      // Native history update: the App Router syncs `useSearchParams` with it without a server round trip.
      window.history.replaceState(null, "", `${pathname ?? ""}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );

  // The cursor belongs to one filter set: a new filter key means page one again.
  const [page, setPage] = useState<{ key: string; cursor: string | null }>({ key: filterKey, cursor: null });
  const cursor = page.key === filterKey ? page.cursor : null;
  const [reload, setReload] = useState(0);
  const reqKey = `${filterKey}|${cursor ?? ""}|${reload}`;

  const [result, setResult] = useState<Result | null>(null);
  const [lastOk, setLastOk] = useState<ListResult<BroadcastListItem> | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listBroadcasts({ status: statuses, cursor, limit: PAGE_SIZE }, { signal: ctl.signal })
      .then((data) => {
        setResult({ reqKey, kind: "ok", data });
        setLastOk(data);
      })
      .catch((e: unknown) => {
        if (isAbortError(e)) return;
        if (e instanceof AdminForbiddenError) setResult({ reqKey, kind: "forbidden" });
        else setResult({ reqKey, kind: "error", message: adminErrorMessage(e), requestId: adminRequestId(e) });
      });
    return () => ctl.abort();
    // `reqKey` covers the filter, the cursor and the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const current = result && result.reqKey === reqKey ? result : null;
  const loading = current === null;
  const data = current?.kind === "ok" ? current.data : lastOk;
  const rows = data?.items ?? [];
  const clearFilters = () => setStatuses([]);

  const columns: Column<BroadcastListItem>[] = [
    {
      id: "status",
      header: "Holat",
      cell: (b) => <StatusPill status={b.status} />,
    },
    {
      id: "text",
      header: "Matn",
      className: "min-w-[14rem] max-w-[26rem]",
      cell: (b) => (
        <Link href={`/admin/broadcasts/${encodeURIComponent(b.id)}`} className="hover:text-primary line-clamp-2 break-words underline-offset-2 hover:underline">
          {b.preview}
          {b.textLength > b.preview.length ? "…" : ""}
        </Link>
      ),
    },
    { id: "audience", header: "Auditoriya", className: "whitespace-nowrap", cell: (b) => audienceLabel(b.audience) },
    {
      id: "progress",
      header: "Yuborildi",
      align: "right",
      className: "tabular-nums whitespace-nowrap",
      cell: (b) => (b.total > 0 ? `${fmtNumber(b.sent)} / ${fmtNumber(b.total)}` : "—"),
    },
    { id: "failed", header: "Xato", align: "right", className: "tabular-nums", cell: (b) => (b.failed > 0 ? fmtNumber(b.failed) : "—") },
    { id: "by", header: "Muallif", className: "max-w-[10rem] truncate", cell: (b) => b.createdByName || "—" },
    { id: "created", header: "Yaratilgan", className: "tabular-nums whitespace-nowrap", cell: (b) => fmtDateTime(b.createdAt) },
  ];

  let body: ReactNode;
  if (current?.kind === "forbidden") {
    body = (
      <div className="bg-card rounded-xl border">
        <Forbidden />
      </div>
    );
  } else if (current?.kind === "error") {
    body = (
      <div className="bg-card rounded-xl border">
        <ErrorState message={current.message} requestId={current.requestId} onRetry={() => setReload((n) => n + 1)} />
      </div>
    );
  } else {
    body = (
      <>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          caption="Telegram e'lonlari"
          loading={loading}
          onRowClick={(b) => router.push(`/admin/broadcasts/${encodeURIComponent(b.id)}`)}
          empty={
            <EmptyState
              title="Xabar topilmadi"
              description={statuses.length > 0 ? "Bu filtr bo'yicha xabar yo'q." : "Hali birorta xabar yaratilmagan."}
              action={
                statuses.length > 0 ? (
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

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterBar activeCount={statuses.length} onClear={clearFilters}>
        <MultiSelectFilter label="Holat" values={statuses} options={STATUS_OPTIONS} onChange={(v) => setStatuses(v.filter(isBroadcastStatus))} />
      </FilterBar>
      {body}
    </div>
  );
}
