"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { CalendarRange, X } from "lucide-react";
import {
  AdminForbiddenError,
  adminErrorMessage,
  adminRequestId,
  isAbortError,
  type ListResult,
} from "@/lib/admin-api/core";
import { GAME_KINDS, listGameLinks, type GameLinkKind, type LinkListQuery, type ModerationLink } from "@/lib/admin-api/moderation";
import { fmtDateTime, fmtNumber, isIsoDate } from "@/lib/admin-format";
import {
  Button,
  CursorPager,
  DataTable,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  SearchInput,
  Segmented,
  SelectFilter,
  presetRange,
  type Column,
} from "@/components/admin/ui";
import { LinkDrawer } from "./LinkDrawer";
import { ACTIVE_OPTIONS, KIND_OPTIONS, LinkStatusPill, kindLabel } from "./shared";

/* ───────────────────────────── filter state ───────────────────────────── */

export type LinkFilters = {
  /** `""` all, `"1"` live, `"0"` dead. */
  active: "" | "1" | "0";
  kind: "" | GameLinkKind;
  userId: string;
  q: string;
  from: string;
  to: string;
};

export const EMPTY_FILTERS: LinkFilters = { active: "", kind: "", userId: "", q: "", from: "", to: "" };

const DIGITS = /^\d{1,16}$/;
const Q_MAX = 100;

/** URL query → filters. Malformed values are dropped, so a hand-edited link shows the unfiltered list. */
export function filtersFromParams(sp: Pick<URLSearchParams, "get"> | null): LinkFilters {
  if (!sp) return EMPTY_FILTERS;
  const active = sp.get("active");
  const kind = sp.get("kind") ?? "";
  const userId = sp.get("userId") ?? "";
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const datesOk = isIsoDate(from) && isIsoDate(to) && from <= to;
  return {
    active: active === "1" || active === "0" ? active : "",
    kind: (GAME_KINDS as readonly string[]).includes(kind) ? (kind as GameLinkKind) : "",
    userId: DIGITS.test(userId) ? userId : "",
    q: Array.from(sp.get("q") ?? "").slice(0, Q_MAX).join(""),
    from: datesOk ? from : "",
    to: datesOk ? to : "",
  };
}

export function filtersToSearch(f: LinkFilters): string {
  const sp = new URLSearchParams();
  if (f.active) sp.set("active", f.active);
  if (f.kind) sp.set("kind", f.kind);
  if (f.userId) sp.set("userId", f.userId);
  if (f.q) sp.set("q", f.q);
  if (f.from && f.to) {
    sp.set("from", f.from);
    sp.set("to", f.to);
  }
  return sp.toString();
}

/** `active` is a Segmented (always visible), so it counts as a filter only when narrowed. */
function activeFilterCount(f: LinkFilters): number {
  return (f.active ? 1 : 0) + (f.kind ? 1 : 0) + (f.userId ? 1 : 0) + (f.q ? 1 : 0) + (f.from ? 1 : 0);
}

function PeriodFilter({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  if (!from || !to) {
    return (
      <Button
        onClick={() => {
          const r = presetRange("30d");
          onChange(r.from, r.to);
        }}
        icon={<CalendarRange className="size-4" aria-hidden="true" />}
      >
        Davr tanlash
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-start gap-2">
      <DateRangePicker value={{ from, to }} onChange={(r) => onChange(r.from, r.to)} ariaLabel="Yaratilgan davr" />
      <Button size="sm" variant="ghost" onClick={() => onChange("", "")} icon={<X className="size-3.5" aria-hidden="true" />}>
        Davrni olib tashlash
      </Button>
    </div>
  );
}

/* ───────────────────────────── table ───────────────────────────── */

type Result =
  | { reqKey: string; kind: "ok"; data: ListResult<ModerationLink> }
  | { reqKey: string; kind: "error"; message: string; requestId?: string }
  | { reqKey: string; kind: "forbidden" };

const PAGE_SIZE = 50;

/** S12 links table: URL-driven filters, keyset pager, row → drawer. */
export function LinksTable() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlKey = searchParams?.toString() ?? "";
  const filters = useMemo(() => filtersFromParams(new URLSearchParams(urlKey)), [urlKey]);

  const setFilters = useCallback(
    (next: LinkFilters) => {
      const qs = filtersToSearch(next);
      // Native history update: the App Router syncs `useSearchParams` with it without a server round trip.
      window.history.replaceState(null, "", `${pathname ?? ""}${qs ? `?${qs}` : ""}`);
    },
    [pathname],
  );
  const patch = (p: Partial<LinkFilters>) => setFilters({ ...filters, ...p });

  const query: LinkListQuery = useMemo(
    () => ({
      active: filters.active === "" ? undefined : filters.active === "1",
      kind: filters.kind || undefined,
      userId: filters.userId,
      q: filters.q,
      from: filters.from,
      to: filters.to,
    }),
    [filters],
  );
  const filterKey = JSON.stringify(query);

  // The cursor belongs to one filter set: a new filter key means page one again.
  const [page, setPage] = useState<{ key: string; cursor: string | null }>({ key: filterKey, cursor: null });
  const cursor = page.key === filterKey ? page.cursor : null;
  const [reload, setReload] = useState(0);
  const reqKey = `${filterKey}|${cursor ?? ""}|${reload}`;

  const [result, setResult] = useState<Result | null>(null);
  const [lastOk, setLastOk] = useState<ListResult<ModerationLink> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    listGameLinks({ ...query, cursor, limit: PAGE_SIZE }, { signal: ctl.signal })
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
    // `reqKey` covers query, cursor and reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  const current = result && result.reqKey === reqKey ? result : null;
  const loading = current === null;
  const data = current?.kind === "ok" ? current.data : lastOk;
  const rows = data?.items ?? [];
  const active = activeFilterCount(filters);
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const onChanged = useCallback(() => setReload((n) => n + 1), []);

  const columns: Column<ModerationLink>[] = [
    {
      id: "topic",
      header: "Mavzu",
      className: "min-w-[12rem] max-w-[22rem]",
      cell: (l) => <span className="line-clamp-2 break-words">{l.topic || "—"}</span>,
    },
    { id: "kind", header: "Turi", className: "whitespace-nowrap", cell: (l) => kindLabel(l.kind) },
    {
      id: "owner",
      header: "Egasi",
      className: "max-w-[12rem]",
      cell: (l) => (
        <Link href={`/admin/users/${encodeURIComponent(l.userId)}`} className="hover:text-primary block truncate underline-offset-2 hover:underline">
          {l.userName || `#${l.userId}`}
        </Link>
      ),
    },
    { id: "results", header: "Natijalar", align: "right", className: "tabular-nums", cell: (l) => fmtNumber(l.results) },
    { id: "created", header: "Yaratilgan", className: "tabular-nums whitespace-nowrap", cell: (l) => fmtDateTime(l.createdAt) },
    {
      id: "expires",
      header: "Tugaydi",
      className: "tabular-nums whitespace-nowrap",
      cell: (l) => (l.expiresAt ? fmtDateTime(l.expiresAt) : "Muddatsiz"),
    },
    { id: "status", header: "Holat", cell: (l) => <LinkStatusPill active={l.active} /> },
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
          rowKey={(l) => l.id}
          caption="O'yin havolalari"
          loading={loading}
          onRowClick={(l) => setOpenId(l.id)}
          empty={
            <EmptyState
              title="Havola topilmadi"
              description={active > 0 ? "Bu filtrlar bo'yicha o'yin havolasi yo'q." : "Hali birorta o'yin havolasi yaratilmagan."}
              action={
                active > 0 ? (
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

  // 403: the forbidden state is all there is — no filter bar above it.
  if (current?.kind === "forbidden") return body;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterBar activeCount={active} onClear={clearFilters}>
        <div className="w-full min-w-[12rem] sm:w-64">
          <SearchInput value={filters.q} placeholder="Mavzu boshi bo'yicha qidirish" ariaLabel="Mavzu bo'yicha qidirish" onChange={(v) => patch({ q: v.slice(0, Q_MAX) })} />
        </div>
        <Segmented
          ariaLabel="Havola holati"
          options={ACTIVE_OPTIONS}
          value={filters.active}
          onChange={(v) => patch({ active: v === "1" || v === "0" ? v : "" })}
        />
        <SelectFilter label="Turi" value={filters.kind} options={KIND_OPTIONS} allLabel="Barcha turlar" onChange={(v) => patch({ kind: v as LinkFilters["kind"] })} />
        <div className="w-full min-w-[10rem] sm:w-48">
          <SearchInput
            value={filters.userId}
            placeholder="Egasi ID"
            onChange={(v) => {
              const id = v.replace(/\D/g, "").slice(0, 16);
              if (id !== filters.userId) patch({ userId: id });
            }}
          />
        </div>
        <PeriodFilter from={filters.from} to={filters.to} onChange={(from, to) => patch({ from, to })} />
      </FilterBar>
      {body}
      <LinkDrawer id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />
    </div>
  );
}
