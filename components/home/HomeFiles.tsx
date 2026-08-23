"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDownUp, ChevronDown, FolderOpen, Plus, Trash2 } from "lucide-react";
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
    const ret = params.get("returnTo");
    if (ret && sessionChecked && !loggedIn) open("login", { returnTo: ret });
  }, [params, loggedIn, sessionChecked, open]);

  // Navbatdagi ish tugaguncha ro'yxatni yangilab turamiz — foydalanuvchi
  // sahifani qo'lda yangilamasdan «Tayyor» ni ko'radi.
  const hasRunning = generations.some(
    (g) => g.status === "QUEUED" || g.status === "IN_PROGRESS",
  );
  useEffect(() => {
    if (!hasRunning || !loggedIn) return;
    const t = setInterval(() => void refreshGenerations(), 3000);
    return () => clearInterval(t);
  }, [hasRunning, loggedIn, refreshGenerations]);

  async function onDelete(id: string) {
    setError(null);
    try {
      await api.deleteGeneration(id);
      drop(id);
      void useAppStore.getState().refreshSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : "O'chirilmadi");
    }
  }

  const list = useMemo(() => {
    let rows = generations.filter((g) => {
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
  }, [generations, filter, sort, desc]);

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
              return (
                <div key={g.id} className="border-border/60 bg-card overflow-hidden rounded-xl border">
                  {tool ? <div className="h-1" style={{ background: `rgb(${tool.tc})` }} /> : null}
                  <Link href={`/uz/files/${g.id}`} className="bg-muted block h-36 overflow-hidden sm:h-40">
                    <FilePreview gen={g} />
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
                      className="text-muted-foreground hover:text-destructive p-1"
                      onClick={() => void onDelete(g.id)}
                      aria-label={`${g.topic} — o'chirish`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
