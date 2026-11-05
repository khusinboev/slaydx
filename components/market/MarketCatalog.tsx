"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Receipt, Search, X } from "lucide-react";
import { HEADER_ICON_CLASS, PageHeader } from "@/components/shell/PageHeader";
import { BalanceChip } from "@/components/shell/BalanceChip";
import * as api from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { MarketCard, MarketListResponse } from "@/lib/market/types";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import { replaceSearch } from "@/lib/ui";
import { MarketCardSkeleton, MarketCardView } from "./MarketCard";
import { MarketClosed, MarketNote, NOTE_ACTION, useMarketOn } from "./MarketClosed";
import { FilterPanel, FilterRow, FilterSheet, type Facets } from "./MarketFilters";
import { MARKET_PURCHASES, NO_FILTERS, PAGE_SIZE, SEARCH_MAX, SEARCH_MIN, filtersToSearch, hasFilters, parseFilters, type MarketFilters } from "./market-model";

/** Typing pause before a search goes out. */
const SEARCH_DEBOUNCE_MS = 350;
const WIDTH = "max-w-[1240px]";
/** The grid of §5.2: 2 columns at 360 px, 3 from 768, 4 from 1200. */
export const GRID = "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 min-[1200px]:grid-cols-4";

type Status = "loading" | "ready" | "error" | "closed";

/** One key per first page: the server's page is only good for the exact query it answered. */
const pageKey = (f: MarketFilters): string => filtersToSearch(f).toString();

function queryOf(f: MarketFilters, cursor: string | null): api.MarketListParams {
  const q = f.q.trim();
  return { tool: f.tool, subject: f.subject, level: f.level, sort: f.sort === "new" ? undefined : f.sort, q: q.length >= SEARCH_MIN ? q : undefined, cursor, limit: PAGE_SIZE };
}

function isClosed(e: unknown): boolean {
  return e instanceof api.ApiError && e.status === 503 && e.data.code === "market_disabled";
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label data-market-search className="bg-card focus-within:ring-ring flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] border px-3.5 shadow-[var(--shadow-card)] focus-within:ring-2">
      <Search className="text-muted-foreground size-[18px] shrink-0" aria-hidden />
      <span className="sr-only">Bozordan qidirish</span>
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        value={value}
        maxLength={SEARCH_MAX}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Mavzu bo‘yicha qidirish"
        className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-[16px] outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button type="button" aria-label="Qidiruvni tozalash" onClick={() => onChange("")} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mr-2.5 grid size-11 shrink-0 place-items-center rounded-[12px] outline-none focus-visible:ring-2">
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </label>
  );
}

/**
 * «Ishlar bozori», the catalog (docs/market/PLAN.md §5.2). The server draws the first page (`initial`, indexable); filters
 * live in the URL, so a link keeps them. Later pages load when the end of the list scrolls into view and by «Yana
 * ko'rsatish» (the keyboard's way, and the only way without an observer). `enabled` is the server's reading of the switch:
 * when it is off the page stays closed for everyone but an admin, who sees the dark catalog.
 */
export function MarketCatalog({ enabled, initial }: { enabled: boolean; initial: MarketListResponse | null }) {
  const params = useSearchParams();
  const marketOn = useMarketOn();
  const loggedIn = useAppStore((s) => s.loggedIn);
  const [filters, setFilters] = useState<MarketFilters>(() => parseFilters(params));
  const [search, setSearch] = useState(filters.q);
  const initialKey = useRef(initial ? pageKey(filters) : null);
  const [items, setItems] = useState<MarketCard[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.nextCursor ?? null);
  const [facets, setFacets] = useState<Facets>(initial?.facets ?? null);
  const [status, setStatus] = useState<Status>(initial ? "ready" : "loading");
  const [more, setMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [sheet, setSheet] = useState(false);
  // A page of an older query that answers late is dropped; one request per list at a time.
  const epoch = useRef(0);
  const busy = useRef(false);
  const live = enabled || marketOn;

  const load = useCallback(async (f: MarketFilters, from: string | null) => {
    if (from !== null && busy.current) return;
    if (from === null) epoch.current += 1;
    const mine = epoch.current;
    busy.current = true;
    setMoreError(false);
    if (from === null) setStatus("loading");
    else setMore(true);
    try {
      const page = await api.marketList(queryOf(f, from));
      if (mine !== epoch.current) return;
      setItems((prev) => {
        if (from === null) return page.items;
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
      if (from === null) setFacets(page.facets);
      setStatus("ready");
    } catch (e) {
      if (mine !== epoch.current) return;
      if (isClosed(e)) setStatus("closed");
      else if (from === null) setStatus("error");
      else setMoreError(true);
    } finally {
      if (mine === epoch.current) {
        busy.current = false;
        setMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!live) return;
    if (initialKey.current === pageKey(filters)) {
      initialKey.current = null;
      return;
    }
    initialKey.current = null;
    void load(filters, null);
  }, [filters, live, load]);

  const apply = useCallback((next: MarketFilters) => {
    setFilters(next);
    replaceSearch(filtersToSearch(next));
  }, []);

  const patch = useCallback((p: Partial<MarketFilters>) => apply({ ...filters, ...p }), [apply, filters]);

  // The field answers at once; the query follows after a pause, and only from two characters (or when cleared).
  useEffect(() => {
    const q = search.trim();
    if (q === filters.q.trim() || (q.length > 0 && q.length < SEARCH_MIN)) return;
    const t = setTimeout(() => apply({ ...filters, q }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, filters, apply]);

  const reset = useCallback(() => {
    setSearch("");
    apply(NO_FILTERS);
  }, [apply]);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || status !== "ready" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(filters, cursor);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, filters, load, status]);

  const dirty = hasFilters(filters);
  const createHref = useMemo(() => (filters.tool ? `/uz/${TOOL_BY_ID[filters.tool]?.slug ?? filters.tool}` : "/uz/create"), [filters.tool]);

  // Off: the calm page (an admin gets the catalog as soon as the session says so). `closed` = it went off mid-visit.
  if (status === "closed" || !live) return <MarketClosed />;

  return (
    <div className="flex w-full flex-col" data-market-catalog>
      <PageHeader
        back
        backFallback="/uz"
        title="Ishlar bozori"
        subtitle="Tayyor ishlar — asl narxdan 2 barobar arzon"
        contentClassName={WIDTH}
        actions={
          loggedIn ? (
            <Link href={MARKET_PURCHASES} aria-label="Xaridlarim" title="Xaridlarim" data-market-purchases-link className={HEADER_ICON_CLASS}>
              <Receipt className="size-[1.2rem]" aria-hidden />
            </Link>
          ) : null
        }
      />
      <div className={cn("mx-auto w-full px-4 pt-1 pb-6", WIDTH)}>
        <div className="sticky top-[4.5rem] z-10 -mx-4 flex flex-col gap-2 bg-[var(--page-bg)]/90 px-4 py-2 backdrop-blur-md lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
          <div className="flex min-w-0 items-center gap-2">
            <SearchField value={search} onChange={setSearch} />
            <BalanceChip />
          </div>
          <FilterRow filters={filters} facets={facets} onChange={patch} onOpen={() => setSheet(true)} />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <FilterPanel filters={filters} facets={facets} onChange={patch} onReset={reset} dirty={dirty} />
          <div className="min-w-0" aria-busy={status === "loading" || more}>
            {status === "loading" ? (
              <div className={GRID} data-market-grid="loading">
                {Array.from({ length: 8 }, (_, i) => (
                  <MarketCardSkeleton key={i} />
                ))}
              </div>
            ) : status === "error" ? (
              <MarketNote
                title="Bozor yuklanmadi"
                text="Aloqani tekshirib, qayta urinib ko‘ring."
                action={
                  <button type="button" data-market-retry onClick={() => void load(filters, null)} className={NOTE_ACTION}>
                    Qayta urinish
                  </button>
                }
              />
            ) : items.length === 0 ? (
              dirty ? (
                <MarketNote
                  title="Hech narsa topilmadi"
                  text="Boshqa so‘z bilan qidiring yoki shu mavzuda yangi ish yarating."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Link href={createHref} data-market-empty-create className={NOTE_ACTION}>
                        Yangi ish yaratish
                      </Link>
                      <button type="button" data-market-empty-reset onClick={reset} className="bg-card hover:bg-muted focus-visible:ring-ring mt-1 min-h-11 rounded-[14px] border px-5 text-[15.5px] font-semibold outline-none focus-visible:ring-2">
                        Filtrlarni tozalash
                      </button>
                    </div>
                  }
                />
              ) : (
                <MarketNote title="Bozor tez orada ochiladi" text="Hozircha sotuvda ishlar yo‘q. Tez orada shu yerda tayyor ishlar paydo bo‘ladi." />
              )
            ) : (
              <>
                <ul className={GRID} data-market-grid="ready">
                  {items.map((card, i) => (
                    <li key={card.id} className="min-w-0">
                      <MarketCardView card={card} eager={i < 4} />
                    </li>
                  ))}
                </ul>
                <div ref={sentinel} aria-hidden className="h-px" />
                {cursor ? (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    {moreError ? (
                      <p role="alert" className="text-destructive text-[14.5px]">
                        Keyingi sahifa yuklanmadi.
                      </p>
                    ) : null}
                    <button type="button" data-market-more disabled={more} onClick={() => void load(filters, cursor)} className="bg-card hover:bg-muted focus-visible:ring-ring min-h-11 rounded-[14px] border px-6 text-[15px] font-semibold outline-none focus-visible:ring-2 disabled:opacity-60">
                      {more ? "Yuklanmoqda…" : "Yana ko‘rsatish"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      {sheet ? <FilterSheet filters={filters} facets={facets} onChange={patch} onReset={reset} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}
