"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, Check, FolderOpen, Plus, RotateCw, Search } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import {
  DEFAULT_FILE_VIEW,
  FILE_FILTERS,
  FILE_SORTS,
  fileFilterMatch,
  readFileView,
  replaceSearch,
  writeFileView,
  type FileFilterId,
  type FileView,
  useUi,
} from "@/lib/ui";
import { useOverlayHistory } from "@/components/nav/useOverlayHistory";
import { HeaderIconButton, PageHeader } from "@/components/shell/PageHeader";
import { cn } from "@/lib/cn";
import { FileMenu } from "./FileMenu";
import { PhoneFileCard } from "./PhoneFileCard";
import { groupFilesByDate } from "./file-meta";

/** Body width of the tab (header row uses the same). */
const CONTENT = "max-w-6xl";

/** The «all» chip reads «Hammasi · N» on this tab (mockup A); the other labels come from `FILE_FILTERS`. */
function chipLabel(id: FileFilterId, label: string): string {
  return id === "all" ? "Hammasi" : label;
}

/** Entrance stagger: card `i` fades in after `i × 20 ms`, at most 140 ms (reduced motion: none). */
const STAGGER_MS = 20;
const STAGGER_MAX = 7;

type ListError = { message: string; retry?: () => void };

export function HomeFiles() {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  const generationsLoaded = useAppStore((s) => s.generationsLoaded);
  const firstCursor = useAppStore((s) => s.generationsCursor);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const drop = useAppStore((s) => s.dropGeneration);
  const open = useUi((s) => s.open);
  const overlay = useUi((s) => s.overlay);
  const close = useUi((s) => s.close);
  const params = useSearchParams();
  /*
   * Filter/sort live in the URL (`?filter=docs&sort=name&desc=0`; defaults are
   * left out): open a file, come back — the list is in the same view. The
   * state is kept locally too (instant redraw on tap) and the URL is updated
   * with `replace` — no new history entry.
   */
  const [view, setView] = useState<FileView>(() => readFileView(params));
  const { filter, sort, desc } = view;
  const [error, setError] = useState<ListError | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const sortWrap = useRef<HTMLDivElement>(null);

  function changeView(patch: Partial<FileView>) {
    const next = { ...view, ...patch };
    setView(next);
    replaceSearch(writeFileView(new URLSearchParams(window.location.search), next));
  }

  // The URL changed from outside (a link to `/uz/files`, back/forward): the view follows.
  useEffect(() => {
    const fromUrl = readFileView(params);
    setView((cur) =>
      cur.filter === fromUrl.filter && cur.sort === fromUrl.sort && cur.desc === fromUrl.desc ? cur : fromUrl,
    );
  }, [params]);

  useEffect(() => {
    // `returnTo` comes from the query (e.g. `?returnTo=javascript:...`) — UNCHECKED
    // here on purpose: `useUi.open` sanitises it in one place (`lib/ui.ts`,
    // `safeReturnTo`; C02/FE-01/SECA-02).
    const ret = params.get("returnTo");
    if (!ret || !sessionChecked) return;
    if (!loggedIn) open("login", { returnTo: ret });
    // The value went to the store (or the user is already signed in): left in
    // the URL, a reload would open the login again.
    const rest = new URLSearchParams(params.toString());
    rest.delete("returnTo");
    replaceSearch(rest);
  }, [params, loggedIn, sessionChecked, open]);

  // The sort menu has its own history entry: the phone's back closes it.
  const sortOpen = overlay === "sort";
  useOverlayHistory(sortOpen, () => {
    if (useUi.getState().overlay === "sort") close();
  });
  // …and so do Escape and a tap anywhere outside it.
  useEffect(() => {
    if (!sortOpen) return;
    const shut = () => {
      if (useUi.getState().overlay === "sort") useUi.getState().close();
    };
    const onDown = (e: PointerEvent) => {
      if (sortWrap.current && e.target instanceof Node && sortWrap.current.contains(e.target)) return;
      shut();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") shut();
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sortOpen]);

  /*
   * Refresh the list while a job is queued/running — the user sees «Tayyor»
   * without reloading.
   *
   * FE-12: the interval starts at 3 s and grows ×1.5 (up to 15 s), so a long
   * queue does not hit the server every 3 s from every tab; a HIDDEN tab does
   * not ask at all and asks at once when it is shown again (`waitTurn` — the
   * same rule as the result page polling).
   */
  const hasRunning = generations.some((g) => g.status === "QUEUED" || g.status === "IN_PROGRESS");
  useEffect(() => {
    if (!hasRunning || !loggedIn) return;
    const ctrl = new AbortController();
    void (async () => {
      let delay = LIST_POLL_START_MS;
      for (;;) {
        await api.waitTurn(delay, ctrl.signal);
        await refreshGenerations();
        delay = Math.min(LIST_POLL_MAX_MS, Math.round(delay * 1.5));
      }
    })().catch((e: unknown) => {
      // The effect was cleaned up (`ctrl.abort`) — an expected stop.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError({ message: e instanceof Error ? e.message : "Ro'yxat yangilanmadi", retry: () => void refreshGenerations() });
    });
    return () => ctrl.abort();
  }, [hasRunning, loggedIn, refreshGenerations]);

  /*
   * «Yana ko'rsatish» (FE-08): the server pages the list (50 by default,
   * `nextCursor`). The store keeps only the FIRST page (polling refreshes it);
   * older pages live here, separately — both are merged by id. Cursor: after
   * the first load — the store's first-page cursor (`generationsCursor`), then
   * the last loaded page's. An old server sends no `nextCursor` → no button.
   */
  const [older, setOlder] = useState<api.ServerGeneration[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreCursor =
    olderCursor === undefined ? (loggedIn && generationsLoaded ? firstCursor : null) : olderCursor;

  async function loadMore() {
    if (!moreCursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await api.listGenerations({ cursor: moreCursor });
      setOlder((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        return [...prev, ...page.generations.filter((g) => !seen.has(g.id))];
      });
      setOlderCursor(page.nextCursor ?? null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Ro'yxat yuklanmadi", retry: () => void loadMore() });
    } finally {
      setLoadingMore(false);
    }
  }

  const all = useMemo(() => {
    if (!older.length) return generations;
    const fresh = new Set(generations.map((g) => g.id));
    return [...generations, ...older.filter((g) => !fresh.has(g.id))];
  }, [generations, older]);

  async function onDelete(id: string) {
    setError(null);
    try {
      await api.deleteGeneration(id);
      drop(id);
      setOlder((prev) => prev.filter((g) => g.id !== id));
      void useAppStore.getState().refreshSession();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "O'chirilmadi", retry: () => void onDelete(id) });
    }
  }

  const list = useMemo(() => {
    let rows = all.filter((g) => fileFilterMatch(filter, g.type));
    rows = [...rows].sort((a, b) => {
      if (sort === "name") return a.topic.localeCompare(b.topic, "uz");
      if (sort === "created") return a.createdAt.localeCompare(b.createdAt);
      return (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt);
    });
    if (!desc && sort !== "name") rows.reverse();
    return rows;
  }, [all, filter, sort, desc]);

  /*
   * One «now» for all cards (today/yesterday sections and times, Tashkent),
   * re-read whenever the list changes (poll, delete, next page) — so the
   * sections roll over at midnight with the next refresh, and memoised cards
   * are not redrawn by unrelated renders (sort menu, error banner).
   */
  const now = useMemo(() => {
    void all;
    return new Date();
  }, [all]);
  /*
   * Date sections «Bugun / Kecha / Shu hafta / Avvalroq» by the date the list
   * is sorted on; sorted by name there are no sections (they would cut the
   * alphabet apart).
   */
  const groups = useMemo(() => {
    if (sort === "name") return [{ id: "all" as const, label: null, rows: list }];
    const dateOf = (g: api.ServerGeneration) => (sort === "created" ? g.createdAt : (g.finishedAt ?? g.createdAt));
    return groupFilesByDate(list, dateOf, now);
  }, [list, sort, now]);

  const menuGen = menuId ? all.find((g) => g.id === menuId) : undefined;
  const sortLabel = FILE_SORTS.find((s) => s.id === sort)?.label ?? FILE_SORTS[0].label;
  // `desc` means «the sort's natural order»: newest first for «modified», first-made first for «created».
  const newestFirst = sort === "created" ? !desc : desc;
  const customView = sort !== DEFAULT_FILE_VIEW.sort || desc !== DEFAULT_FILE_VIEW.desc;
  const loading = !sessionChecked || (loggedIn && !generationsLoaded);
  const total = `${all.length}${moreCursor ? "+" : ""}`;
  const subtitle = loading
    ? "Yuklanmoqda…"
    : !loggedIn
      ? "Yaratgan fayllaringiz shu yerda"
      : all.length
        ? `${total} ta ish`
        : "Hali ish yo‘q";

  let cardIndex = 0;

  return (
    <div className="flex w-full flex-col">
      <PageHeader
        title="Ishlarim"
        subtitle={<span data-files-count>{subtitle}</span>}
        contentClassName={CONTENT}
        actions={
          <>
            <HeaderIconButton label="Qidirish" onClick={() => open("search")}>
              <Search className="size-[1.2rem]" aria-hidden />
            </HeaderIconButton>
            <div ref={sortWrap} className="relative">
              <HeaderIconButton
                label={`Saralash: ${sortLabel}`}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                data-sort-button
                data-sort-custom={customView ? "" : undefined}
                onClick={() => (sortOpen ? close() : open("sort"))}
                className={cn("relative", sortOpen && "bg-accent")}
              >
                <ArrowDownUp className="size-[1.2rem]" aria-hidden />
                {customView ? (
                  <span aria-hidden className="bg-primary ring-background absolute top-2 right-2 size-2 rounded-full ring-2" />
                ) : null}
              </HeaderIconButton>
              {sortOpen ? (
                <div
                  role="menu"
                  aria-label="Saralash"
                  data-sort-menu
                  className="slx-scrim-enter bg-popover text-popover-foreground absolute top-12 right-0 z-30 w-64 rounded-2xl border p-1.5 shadow-[var(--shadow-bar)]"
                >
                  <p className="text-muted-foreground px-3 pt-1.5 pb-1 text-[12.5px] font-semibold tracking-[0.06em] uppercase">
                    Saralash
                  </p>
                  {FILE_SORTS.map((s) => (
                    <MenuRadio
                      key={s.id}
                      checked={sort === s.id}
                      onPick={() => {
                        changeView({ sort: s.id });
                        close();
                      }}
                    >
                      {s.label}
                    </MenuRadio>
                  ))}
                  {sort !== "name" ? (
                    <>
                      <div className="bg-border mx-2 my-1.5 h-px" />
                      <p className="text-muted-foreground px-3 pt-1 pb-1 text-[12.5px] font-semibold tracking-[0.06em] uppercase">
                        Tartib
                      </p>
                      {[
                        { newest: true, label: "Yangisi birinchi" },
                        { newest: false, label: "Eskisi birinchi" },
                      ].map((d) => (
                        <MenuRadio
                          key={d.label}
                          checked={newestFirst === d.newest}
                          onPick={() => {
                            changeView({ desc: sort === "created" ? !d.newest : d.newest });
                            close();
                          }}
                        >
                          {d.label}
                        </MenuRadio>
                      ))}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        }
      />

      <div className={cn("mx-auto w-full px-4 pb-8", CONTENT)}>
        <div
          data-filter-chips
          role="group"
          aria-label="Hujjat turi"
          className="-mx-4 flex gap-1.5 overflow-x-auto overscroll-x-contain px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {FILE_FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                data-filter-chip={f.id}
                onClick={() => changeView({ filter: f.id })}
                className="group/chip focus-visible:ring-ring flex h-11 flex-none items-center rounded-full outline-none focus-visible:ring-2"
              >
                <span
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14.5px] font-medium whitespace-nowrap transition-colors",
                    on
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card text-foreground/80 group-hover/chip:bg-accent",
                  )}
                >
                  {chipLabel(f.id, f.label)}
                  {f.id === "all" && loggedIn && !loading ? (
                    <span className={cn("tabular-nums", on ? "opacity-75" : "text-muted-foreground")}>· {total}</span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {error ? (
          <div
            role="alert"
            data-files-error
            className="border-destructive/30 bg-destructive/8 mt-3 flex items-center gap-3 rounded-2xl border py-2 pr-2 pl-4"
          >
            <p className="text-destructive min-w-0 flex-1 text-[14.5px]">{error.message}</p>
            {error.retry ? (
              <button
                type="button"
                data-files-retry
                onClick={() => {
                  const retry = error.retry;
                  setError(null);
                  retry?.();
                }}
                className="text-foreground hover:bg-accent focus-visible:ring-ring inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14.5px] font-semibold outline-none focus-visible:ring-2"
              >
                <RotateCw className="size-4" aria-hidden />
                Qayta urinish
              </button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <FilesSkeleton />
        ) : list.length === 0 ? (
          <EmptyState
            loggedIn={loggedIn}
            filtered={all.length > 0 && filter !== "all"}
            onCreate={() => open("create")}
            onLogin={() => open("login")}
            onShowAll={() => changeView({ filter: "all" })}
          />
        ) : (
          groups.map((group) => (
            <section key={group.id} data-file-group={group.id} className="mt-4">
              {group.label ? (
                <h2 className="text-muted-foreground mb-2.5 px-0.5 text-[13px] font-semibold tracking-[0.06em] uppercase">
                  {group.label}
                </h2>
              ) : null}
              <ul role="list" data-file-list className="grid grid-cols-1 gap-2.5 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
                {group.rows.map((g) => {
                  const i = cardIndex++;
                  return (
                    <li
                      key={g.id}
                      className="motion-safe:animate-[slx-enter-fade_180ms_ease-out_backwards]"
                      style={i ? { animationDelay: `${Math.min(i, STAGGER_MAX) * STAGGER_MS}ms` } : undefined}
                    >
                      <PhoneFileCard gen={g} tool={TOOL_BY_ID[g.type]} onMenu={setMenuId} now={now} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        {moreCursor && !loading ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              aria-busy={loadingMore}
              data-load-more
              className="border-border bg-card hover:bg-accent focus-visible:ring-ring inline-flex h-11 items-center rounded-full border px-6 text-[15px] font-medium shadow-[var(--shadow-card)] outline-none focus-visible:ring-2 disabled:opacity-60"
            >
              {loadingMore ? "Yuklanmoqda…" : "Yana ko‘rsatish"}
            </button>
          </div>
        ) : null}
      </div>

      {menuGen ? (
        <FileMenu
          key={menuGen.id}
          gen={menuGen}
          kind={TOOL_BY_ID[menuGen.type]?.title}
          onClose={() => setMenuId(null)}
          onDelete={(id) => {
            setMenuId(null);
            void onDelete(id);
          }}
        />
      ) : null}
    </div>
  );
}

function MenuRadio({ checked, onPick, children }: { checked: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onPick}
      className={cn(
        "hover:bg-accent focus-visible:bg-accent flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-[15px] outline-none",
        checked && "font-semibold",
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {checked ? <Check className="text-accent-soft-foreground size-4 shrink-0" aria-hidden /> : null}
    </button>
  );
}

/** Loading: the shapes of the real rows / cards, shimmering (static under reduced motion). */
function FilesSkeleton() {
  return (
    <div data-files-skeleton aria-hidden className="mt-4">
      <div className="bg-muted slx-shimmer mb-3 h-3.5 w-20 rounded-md" />
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-card border-border/80 flex items-center gap-3 rounded-[18px] border p-2.5 md:flex-col md:items-stretch md:gap-0 md:overflow-hidden md:rounded-[var(--radius-card)] md:p-0"
          >
            <div className="bg-muted slx-shimmer aspect-video w-[104px] shrink-0 rounded-xl md:w-full md:rounded-none" />
            <div className="min-w-0 flex-1 space-y-2 md:p-4">
              <div className="bg-muted slx-shimmer h-4 w-4/5 rounded-md" />
              <div className="bg-muted slx-shimmer h-3.5 w-1/2 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({
  loggedIn,
  filtered,
  onCreate,
  onLogin,
  onShowAll,
}: {
  loggedIn: boolean;
  filtered: boolean;
  onCreate: () => void;
  onLogin: () => void;
  onShowAll: () => void;
}) {
  const btn =
    "focus-visible:ring-ring mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-6 text-[15.5px] font-semibold outline-none focus-visible:ring-2";
  return (
    <div data-files-empty className="bg-card mt-4 flex flex-col items-center rounded-[var(--radius-card)] border px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <span className="bg-accent-soft text-accent-soft-foreground flex size-14 items-center justify-center rounded-2xl">
        <FolderOpen className="size-7" aria-hidden />
      </span>
      <p className="mt-4 text-[17px] font-semibold">
        {!loggedIn ? "Yaratgan fayllaringiz shu yerda saqlanadi" : filtered ? "Bu turda ish yo‘q" : "Hozircha ish yo‘q"}
      </p>
      <p className="text-muted-foreground mt-1.5 max-w-sm text-[14.5px] leading-relaxed">
        {!loggedIn
          ? "Kirish qiling — keyin slayd, insho va boshqa hujjatlar shu yerda ochiladi"
          : filtered
            ? "Boshqa turni tanlang yoki hamma ishlarni ko‘ring"
            : "Slayd, referat, insho yoki boshqa ishni bir necha daqiqada yarating"}
      </p>
      {!loggedIn ? (
        <button type="button" onClick={onLogin} className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")}>
          Kirish
        </button>
      ) : filtered ? (
        <button type="button" onClick={onShowAll} className={cn(btn, "border-border hover:bg-accent border")}>
          Hammasini ko‘rsatish
        </button>
      ) : (
        <button
          type="button"
          data-files-create
          onClick={onCreate}
          className={cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90 shadow-[var(--shadow-fab)]")}
        >
          <Plus className="size-5" aria-hidden />
          Yangi ish yaratish
        </button>
      )}
    </div>
  );
}

/** List polling: first interval and upper bound (FE-12). */
const LIST_POLL_START_MS = 3000;
const LIST_POLL_MAX_MS = 15_000;
