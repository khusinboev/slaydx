"use client";

import { Star } from "lucide-react";
import { create } from "zustand";
import { request } from "@/lib/api-client";
import { cn } from "@/lib/cn";

/**
 * Studio favourites on the client (docs/studio/P7-SPEC.md «P7b»). The server holds the truth (`studio_favorites`, read
 * back by the gallery as `favorite`); this store only remembers what the user toggled on this page, so a star set on a
 * result card shows the same on its gallery card (and back) without a reload. A toggle is optimistic: the star flips at
 * once and flips back, with the server's message, when the request fails.
 */
type FavState = {
  /** generation id → starred, for every id toggled on this page. */
  on: Readonly<Record<string, boolean>>;
  /** Ids with a request in flight (a second press waits). */
  busy: Readonly<Record<string, true>>;
  set: (id: string, on: boolean) => void;
  setBusy: (id: string, busy: boolean) => void;
};

export const useFavorites = create<FavState>((set) => ({
  on: {},
  busy: {},
  set: (id, on) => set((s) => ({ on: { ...s.on, [id]: on } })),
  setBusy: (id, busy) =>
    set((s) => {
      const next = { ...s.busy };
      if (busy) next[id] = true;
      else delete next[id];
      return { busy: next };
    }),
}));

/** `PUT` (star) / `DELETE` (un-star) `/api/media/favorites/<id>`; answers the server's state. */
export async function putFavorite(id: string, on: boolean): Promise<boolean> {
  const r = await request<{ favorite?: unknown }>(`/api/media/favorites/${encodeURIComponent(id)}`, { method: on ? "PUT" : "DELETE" });
  return r.favorite === true;
}

/** Flips the star of one generation (optimistic; reverted on failure, the error is re-thrown for the caller to show). */
export async function toggleFavorite(id: string, current: boolean): Promise<void> {
  const st = useFavorites.getState();
  if (st.busy[id]) return;
  st.setBusy(id, true);
  st.set(id, !current);
  try {
    useFavorites.getState().set(id, await putFavorite(id, !current));
  } catch (e) {
    useFavorites.getState().set(id, current);
    throw e;
  } finally {
    useFavorites.getState().setBusy(id, false);
  }
}

/** The star state to show: what was toggled on this page, else what the server said (`initial`). */
export function useIsFavorite(id: string, initial: boolean): boolean {
  return useFavorites((s) => s.on[id] ?? initial);
}

/**
 * The star button (44 px, `aria-pressed`). `overlay`: the dark round button over a picture; else a bordered one in a
 * card's action row. `onError` gets the failed request's message.
 */
export function FavoriteButton({ id, initial = false, overlay = false, className, onError }: { id: string; initial?: boolean; overlay?: boolean; className?: string; onError?: (message: string) => void }) {
  const on = useIsFavorite(id, initial);
  const busy = useFavorites((s) => s.busy[id] === true);
  const label = on ? "Sevimlilardan olib tashlash" : "Sevimlilarga qo‘shish";
  return (
    <button
      type="button"
      data-favorite={id}
      data-favorite-on={on ? "true" : "false"}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void toggleFavorite(id, on).catch((e: unknown) => onError?.(e instanceof Error ? e.message : "Saqlanmadi"))}
      className={cn(
        "focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center outline-none focus-visible:ring-2 disabled:opacity-60",
        overlay ? "rounded-lg bg-black/70 text-white hover:bg-black/85" : "bg-card hover:bg-muted rounded-[12px] border",
        className,
      )}
    >
      <Star className={cn("size-[18px]", on && "fill-amber-400 text-amber-400")} aria-hidden />
    </button>
  );
}
