"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  CursorPager,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  Forbidden,
  SearchInput,
  SelectFilter,
  StatusPill,
  type Column,
} from "@/components/admin/ui";
import { useCan } from "@/components/admin/shell";
import { ExportButton, OptionalRangeFilter, useCursorList, useUrlFilters } from "@/components/admin/payments";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/admin-format";
import { USER_PLANS, USER_SORTS, downloadUsersCsv, listUsers, type AdminUserRow, type UserListParams, type UserPlan, type UserSort } from "@/lib/admin-api/users";
import { SORT_LABEL } from "./labels";

/** URL filter keys of the users list. */
export const USER_FILTER_KEYS = ["q", "blocked", "plan", "isAdmin", "from", "to", "sort"] as const;
type UserFilterKey = (typeof USER_FILTER_KEYS)[number];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function flag(raw: string): boolean | undefined {
  return raw === "1" ? true : raw === "0" ? false : undefined;
}

/** URL text → validated request params (junk in the URL is ignored, never sent). */
export function userParamsFrom(v: Record<UserFilterKey, string>): UserListParams {
  const datesOk = ISO_DAY.test(v.from) && ISO_DAY.test(v.to) && v.from <= v.to;
  return {
    q: v.q.trim() || undefined,
    blocked: flag(v.blocked),
    plan: (USER_PLANS as readonly string[]).includes(v.plan) ? (v.plan as UserPlan) : "",
    isAdmin: flag(v.isAdmin),
    from: datesOk ? v.from : undefined,
    to: datesOk ? v.to : undefined,
    sort: (USER_SORTS as readonly string[]).includes(v.sort) ? (v.sort as UserSort) : "created_desc",
  };
}

const PAGE_SIZE = 50;

/**
 * S4 `/admin/users` (plan §7.1): search (`#id`, Telegram id, `+phone`,
 * `@username`, name prefix — classified on the server), blocked / plan / admin
 * / signup-range filters in the URL, whitelisted sorts, keyset paging, CSV
 * export (`users.export`, step-up). The phone is always masked here.
 */
export function UsersPage() {
  const router = useRouter();
  const canExport = useCan("users.export");
  const store = useUrlFilters(USER_FILTER_KEYS);
  const v = store.values;
  const params = useMemo(() => userParamsFrom(v), [v]);
  const fetchKey = JSON.stringify(params);
  const { state, cursor, setCursor, retry } = useCursorList<AdminUserRow>(fetchKey, (c, signal) =>
    listUsers({ ...params, cursor: c, limit: PAGE_SIZE }, { signal }),
  );

  const activeCount = [params.q, params.blocked !== undefined, params.plan, params.isAdmin !== undefined, params.from].filter(Boolean).length;
  const clear = () => store.clear();
  const rows = state.data?.items ?? [];

  const columns: Column<AdminUserRow>[] = [
    {
      id: "user",
      header: "Foydalanuvchi",
      className: "min-w-[12rem] max-w-[18rem]",
      cell: (u) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Link href={`/admin/users/${u.id}`} className="truncate font-semibold underline-offset-2 hover:underline" title={u.name}>
              {u.name || `#${u.id}`}
            </Link>
            {u.isBlocked ? <Badge tone="danger">Bloklangan</Badge> : null}
            {u.isAdmin ? <Badge tone="primary">Admin</Badge> : null}
          </span>
          <span className="text-muted-foreground truncate text-[12px]">
            {u.username ? `@${u.username}` : "username yo'q"} · #{u.id}
          </span>
        </div>
      ),
    },
    { id: "tg", header: "Telegram ID", className: "font-mono text-[12.5px]", cell: (u) => u.telegramId ?? "—" },
    { id: "phone", header: "Telefon", className: "font-mono text-[12.5px] whitespace-nowrap", cell: (u) => u.phoneMasked ?? "—" },
    {
      id: "plan",
      header: "Tarif",
      cell: (u) => (u.plan === "pro" ? <StatusPill tone="primary">Pro</StatusPill> : <StatusPill>Free</StatusPill>),
    },
    { id: "points", header: "Ball", align: "right", className: "tabular-nums", cell: (u) => fmtNumber(u.points) },
    { id: "quota", header: "Kvota", align: "right", className: "tabular-nums", cell: (u) => fmtNumber(u.quota) },
    { id: "balance", header: "Balans", align: "right", sortKey: "balance_desc", className: "tabular-nums", cell: (u) => fmtNumber(u.balance) },
    { id: "gens", header: "Ishlar", align: "right", className: "tabular-nums", cell: (u) => fmtNumber(u.generations) },
    {
      id: "created",
      header: "Ro'yxatdan",
      sortKey: "created_desc",
      sortKeyReverse: "created_asc",
      className: "tabular-nums whitespace-nowrap",
      cell: (u) => fmtDate(u.createdAt),
    },
    {
      id: "seen",
      header: "Oxirgi faollik",
      sortKey: "last_seen_desc",
      className: "tabular-nums whitespace-nowrap text-muted-foreground",
      cell: (u) => (u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : "—"),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-tight">Foydalanuvchilar</h1>
          <p className="text-muted-foreground text-[13px]">Qidiruv: ism boshi, @username, #ID, Telegram ID yoki +telefon (aniq)</p>
        </div>
        {canExport ? <ExportButton onExport={() => downloadUsersCsv(params)} /> : null}
      </header>

      <FilterBar activeCount={activeCount} onClear={clear}>
        <div className="w-full min-w-0 sm:w-72">
          <SearchInput
            value={v.q}
            onChange={(q) => store.set({ q })}
            placeholder="Ism, @username, #ID, Telegram ID, +telefon"
            ariaLabel="Foydalanuvchi qidirish"
          />
        </div>
        <SelectFilter
          label="Holat"
          value={params.blocked === undefined ? "" : params.blocked ? "1" : "0"}
          onChange={(blocked) => store.set({ blocked })}
          options={[
            { value: "0", label: "Faol" },
            { value: "1", label: "Bloklangan" },
          ]}
        />
        <SelectFilter
          label="Tarif"
          value={params.plan ?? ""}
          onChange={(plan) => store.set({ plan })}
          options={[
            { value: "free", label: "Free" },
            { value: "pro", label: "Pro" },
          ]}
        />
        <SelectFilter
          label="Admin"
          value={params.isAdmin === undefined ? "" : params.isAdmin ? "1" : "0"}
          onChange={(isAdmin) => store.set({ isAdmin })}
          options={[
            { value: "1", label: "Admin" },
            { value: "0", label: "Admin emas" },
          ]}
        />
        <SelectFilter
          label="Saralash"
          value={params.sort ?? "created_desc"}
          allLabel={null}
          onChange={(sort) => store.set({ sort: sort === "created_desc" ? "" : sort })}
          options={USER_SORTS.map((s) => ({ value: s, label: SORT_LABEL[s] }))}
        />
        <OptionalRangeFilter
          label="Ro'yxatdan o'tgan"
          from={params.from ?? ""}
          to={params.to ?? ""}
          onChange={(r) => store.set({ from: r.from, to: r.to })}
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
            caption="Foydalanuvchilar"
            columns={columns}
            rows={rows}
            rowKey={(u) => u.id}
            loading={state.status === "loading"}
            sort={params.sort}
            onSortChange={(sort) => store.set({ sort: sort === "created_desc" ? "" : sort })}
            onRowClick={(u) => router.push(`/admin/users/${u.id}`)}
            empty={
              activeCount > 0 ? (
                <EmptyState
                  title="Hech narsa topilmadi"
                  description="Ism boshini, @username, #ID, Telegram ID yoki to'liq telefon raqamini (+ bilan) sinab ko'ring."
                  action={
                    <Button size="sm" onClick={clear}>
                      Filtrlarni tozalash
                    </Button>
                  }
                />
              ) : (
                <EmptyState title="Foydalanuvchilar yo'q" description="Hali hech kim ro'yxatdan o'tmagan." />
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
