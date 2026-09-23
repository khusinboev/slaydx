"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, ChevronDown, FileX, FolderOpen, Plus, Trash2 } from "lucide-react";
import * as api from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { TOOL_BY_ID } from "@/lib/tools";
import { FILE_FILTERS, FILE_SORTS, useUi } from "@/lib/ui";
import { cn } from "@/lib/cn";
import { FilePreview } from "./FilePreview";

export function HomeFiles() {
  const sessionChecked = useAppStore((s) => s.sessionChecked);
  const loggedIn = useAppStore((s) => s.loggedIn);
  const generations = useAppStore((s) => s.generations);
  const generationsLoaded = useAppStore((s) => s.generationsLoaded);
  const refreshGenerations = useAppStore((s) => s.refreshGenerations);
  const drop = useAppStore((s) => s.dropGeneration);
  const open = useUi((s) => s.open);
  const overlay = useUi((s) => s.overlay);
  const close = useUi((s) => s.close);
  const params = useSearchParams();
  const [filter, setFilter] = useState<(typeof FILE_FILTERS)[number]["id"]>("all");
  const [sort, setSort] = useState<(typeof FILE_SORTS)[number]["id"]>("modified");
  const [desc, setDesc] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // `ret` so'rov parametridan (masalan `?returnTo=javascript:...`)
    // keladi — TEKSHIRILMAGAN. Sanatsiya `useUi.open` ichida
    // (`lib/ui.ts`, `safeReturnTo`) yagona joyda bajariladi, shu bois
    // bu yerda xom qiymat shunchaki uzatiladi (C02/FE-01/SECA-02).
    const ret = params.get("returnTo");
    if (ret && sessionChecked && !loggedIn) open("login", { returnTo: ret });
  }, [params, loggedIn, sessionChecked, open]);

  /*
   * Navbatdagi ish tugaguncha ro'yxatni yangilab turamiz — foydalanuvchi
   * sahifani qo'lda yangilamasdan «Tayyor» ni ko'radi.
   *
   * FE-12: oraliq 3 s dan boshlab ×1,5 o'sadi (15 s gacha) — navbat soatlab
   * cho'zilganda ham har yorliq serverni 3 s da bir bosmasin; yorliq
   * YASHIRIN bo'lsa umuman so'ramaydi, ko'ringan zahoti darhol so'raydi
   * (`waitTurn` — natija sahifasi pollingi bilan bir xil qoida).
   */
  const hasRunning = generations.some(
    (g) => g.status === "QUEUED" || g.status === "IN_PROGRESS",
  );
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
      // Effekt tozalanganda (`ctrl.abort`) — kutilgan to'xtash.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Ro'yxat yangilanmadi");
    });
    return () => ctrl.abort();
  }, [hasRunning, loggedIn, refreshGenerations]);

  /*
   * «Yana ko'rsatish» (FE-08): server ro'yxatni sahifalab beradi (standart
   * 50 ta, `nextCursor`). Store faqat BIRINCHI sahifani yuritadi (polling
   * ham shuni yangilaydi); eski sahifalar shu yerda, alohida — ikkalasi
   * id bo'yicha birlashtiriladi. Kursor: birinchi yuklashdan keyin —
   * birinchi sahifaniki (`firstPageCursor`), keyin — oxirgi yuklangan
   * sahifaniki. Eski server `nextCursor` bermaydi → tugma chiqmaydi.
   */
  const [older, setOlder] = useState<api.ServerGeneration[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreCursor =
    olderCursor === undefined ? (loggedIn && generationsLoaded ? api.firstPageCursor() : null) : olderCursor;

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
      setError(e instanceof Error ? e.message : "Ro'yxat yuklanmadi");
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
      setError(e instanceof Error ? e.message : "O'chirilmadi");
    }
  }

  /*
   * Ikki bosqichli o'chirish — birinchi bosish tugmani «qurollantiradi»,
   * 3 s ichidagi ikkinchi bosishgina o'chiradi. Ilgari ro'yxatdagi bir
   * bosish hujjatni darhol yo'q qilardi (undo yo'q).
   */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);
  function askDelete(id: string) {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirmId === id) {
      setConfirmId(null);
      void onDelete(id);
      return;
    }
    setConfirmId(id);
    confirmTimer.current = setTimeout(() => setConfirmId(null), 3000);
  }

  const list = useMemo(() => {
    let rows = all.filter((g) => {
      if (filter === "slide") return g.type === "slide";
      if (filter === "image") return g.type === "image";
      if (filter === "docs") return g.type !== "slide" && g.type !== "image";
      if (filter === "tests" || filter === "games") return false;
      return true;
    });
    rows = [...rows].sort((a, b) => {
      if (sort === "name") return a.topic.localeCompare(b.topic, "uz");
      if (sort === "created") return a.createdAt.localeCompare(b.createdAt);
      return (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt);
    });
    if (!desc && sort !== "name") rows.reverse();
    return rows;
  }, [all, filter, sort, desc]);

  const sortLabel = FILE_SORTS.find((s) => s.id === sort)?.label ?? FILE_SORTS[0].label;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-5 lg:px-8 lg:py-8 2xl:max-w-[1440px]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <FolderOpen className="size-5 shrink-0" strokeWidth={1.75} />
          <h1 className="text-base font-semibold tracking-tight">Mening fayllarim</h1>
        </div>
        <Link
          href="/uz/create"
          onClick={() => {
            if (!loggedIn) open("login", { returnTo: "/uz/create" });
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full px-5 text-[15.5px] font-medium shadow-sm sm:w-auto"
        >
          <Plus className="size-4" />
          Yaratish
        </Link>
      </div>

      <div className="mt-8 flex flex-row items-center justify-between gap-2 sm:gap-3">
        <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex sm:flex-wrap">
          {FILE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "inline-flex h-9 flex-none items-center rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors",
                filter === f.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 sm:hidden">
          <select
            className="border-input bg-background h-10 w-full rounded-full border px-4 text-sm font-medium"
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            {FILE_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="relative flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={() => (overlay === "sort" ? close() : open("sort"))}
            className="border-input bg-background hover:bg-accent inline-flex h-10 items-center gap-2 rounded-full border px-5 text-[15.5px] font-medium"
          >
            <span className="hidden sm:inline">{sortLabel}</span>
            <ArrowDownUp className="size-4 sm:hidden" />
            <ChevronDown className="hidden size-4 opacity-70 sm:inline" />
          </button>
          {overlay === "sort" ? (
            <div className="bg-popover absolute top-12 right-10 z-20 min-w-48 rounded-xl border p-1 shadow-lg">
              {FILE_SORTS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="hover:bg-muted w-full rounded-lg px-3 py-2 text-left text-sm"
                  onClick={() => {
                    setSort(s.id);
                    close();
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setDesc((v) => !v)}
            className="border-input bg-background hover:bg-accent flex size-10 items-center justify-center rounded-full border"
            aria-label="Tartibni o'zgartirish"
          >
            <ArrowDownUp className="size-4" />
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        {!sessionChecked || (loggedIn && !generationsLoaded) ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="border-border/60 bg-card overflow-hidden rounded-xl border">
                <div className="bg-accent h-24 w-full animate-pulse sm:h-28" />
                <div className="space-y-2 p-4">
                  <div className="bg-accent h-4 w-4/5 animate-pulse rounded-md" />
                  <div className="bg-accent h-4 w-3/5 animate-pulse rounded-md" />
                  <div className="bg-accent h-3 w-1/2 animate-pulse rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="bg-card rounded-2xl border px-6 py-16 text-center">
            <p className="font-medium">
              {loggedIn ? "Hozircha fayl yo‘q" : "Yaratgan fayllaringiz shu yerda saqlanadi"}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {loggedIn
                ? "Yaratish tugmasi orqali birinchi hujjatni boshlang"
                : "Kirish qiling — keyin slayd, insho va boshqa hujjatlar shu yerda ochiladi"}
            </p>
            {loggedIn ? (
              <Link href="/uz/create" className="text-primary mt-4 inline-block text-sm font-medium">
                Nima yaratamiz?
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => open("login")}
                className="bg-primary text-primary-foreground mt-5 h-10 rounded-full px-5 text-sm font-medium"
              >
                Kirish
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
            {list.map((g) => {
              const tool = TOOL_BY_ID[g.type];
              // Fayl/hujjat endi MUDDATSIZ saqlanadi — avtomatik "muddati
              // tugagan" holati yo'q (`011_no_expiry.sql`).
              return (
                <div key={g.id} className="border-border/60 bg-card overflow-hidden rounded-xl border">
                  {tool ? <div className="h-1" style={{ background: `rgb(${tool.tc})` }} /> : null}
                  <Link href={`/uz/files/${g.id}`} className="bg-muted block h-36 overflow-hidden sm:h-40">
                    {g.filesPurgedAt ? (
                      /*
                       * Retention (W2-D2): bonus-faqat hujjat fayllari
                       * o'chirilgan — eskiz/rasm havolasi o'chgan aktivga
                       * olib borardi (404). Neytral belgi chiziladi.
                       */
                      <div
                        className="text-muted-foreground flex h-full flex-col items-center justify-center gap-1.5 text-xs"
                        data-files-purged
                      >
                        <FileX className="size-7 opacity-60" />
                        Fayl o‘chirilgan
                      </div>
                    ) : (
                      <FilePreview gen={g} />
                    )}
                  </Link>
                  <div className="flex items-start justify-between gap-2 p-4">
                    <Link href={`/uz/files/${g.id}`} className="min-w-0">
                      <div className="truncate text-sm font-medium">{g.topic}</div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {tool?.title} · {g.status === "COMPLETED" ? "Tayyor" : g.step}
                      </div>
                    </Link>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded p-1 text-xs",
                        confirmId === g.id
                          ? "text-destructive font-medium"
                          : "text-muted-foreground hover:text-destructive",
                      )}
                      onClick={() => askDelete(g.id)}
                      aria-label={
                        confirmId === g.id
                          ? `${g.topic} — o'chirishni tasdiqlang`
                          : `${g.topic} — o'chirish`
                      }
                    >
                      <Trash2 className="size-4" />
                      {confirmId === g.id ? <span>Rostdan?</span> : null}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {moreCursor ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              aria-busy={loadingMore}
              data-load-more
              className="border-input bg-background hover:bg-accent inline-flex h-10 items-center rounded-full border px-6 text-sm font-medium disabled:opacity-60"
            >
              {loadingMore ? "Yuklanmoqda…" : "Yana ko‘rsatish"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Ro'yxat pollingi: birinchi oraliq va yuqori chegara (FE-12). */
const LIST_POLL_START_MS = 3000;
const LIST_POLL_MAX_MS = 15_000;
