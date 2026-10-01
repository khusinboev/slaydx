"use client";

import { create } from "zustand";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

export type ToastTone = "success" | "error" | "info";

export type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastState = {
  toasts: ToastItem[];
  push: (message: string, tone: ToastTone, durationMs: number) => number;
  dismiss: (id: number) => void;
  clear: () => void;
};

const MAX_VISIBLE = 4;
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Module-level store so `toast()` works from anywhere (event handlers, API callbacks). */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message, tone, durationMs) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-MAX_VISIBLE) }));
    if (durationMs > 0) timers.set(id, setTimeout(() => get().dismiss(id), durationMs));
    return id;
  },
  dismiss: (id) => {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
  clear: () => {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ toasts: [] });
  },
}));

export type ToastOptions = {
  tone?: ToastTone;
  /** 0 keeps the toast until dismissed. Errors stay longer by default. */
  durationMs?: number;
};

/** Shows a toast. Returns its id (for `useToastStore.getState().dismiss`). */
export function toast(message: string, opts: ToastOptions = {}): number {
  const tone = opts.tone ?? "success";
  const durationMs = opts.durationMs ?? (tone === "error" ? 8000 : 4000);
  return useToastStore.getState().push(message, tone, durationMs);
}

const ICON = { success: CircleCheck, error: CircleAlert, info: Info } as const;
const ICON_TONE = {
  success: "text-success-text",
  error: "text-destructive",
  info: "text-info",
} as const;

/** Mount once in the admin layout. The container is an always-present polite live region. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-[70] flex flex-col items-end gap-2 sm:left-auto"
    >
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div
            key={t.id}
            className="bg-card pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] shadow-lg"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[t.tone])} aria-hidden="true" />
            <p className="min-w-0 flex-1 break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Xabarni yopish"
              className="hover:bg-muted focus-visible:ring-ring -mt-0.5 -mr-1 rounded-full p-1 outline-none focus-visible:ring-2"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
