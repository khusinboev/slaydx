"use client";

import { Pencil, X } from "lucide-react";

/**
 * One-time touch hint (PLAN §3 O4): «Matnni tahrirlash uchun ikki marta
 * bosing». Shown below the stage (in-flow, never over the slide) on touch
 * devices until the user dismisses it or opens a text once. The «seen» flag
 * lives in `localStorage`; every access is wrapped (private mode, blocked
 * storage, thumbnails) — without storage the hint simply shows again next time.
 */
export const EDIT_HINT_KEY = "slaydx:slide-edit-hint";
export const EDIT_HINT_TEXT = "Matnni tahrirlash uchun ikki marta bosing";

export function readEditHintSeen(): boolean {
  try {
    return window.localStorage.getItem(EDIT_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeEditHintSeen(): void {
  try {
    window.localStorage.setItem(EDIT_HINT_KEY, "1");
  } catch {
    // Storage unavailable: the hint is hidden for this page only.
  }
}

export function SlideEditHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div
      data-slide-edit-hint
      role="note"
      className="no-print flex min-h-11 shrink-0 items-center gap-2 bg-[#252525] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] pl-3 text-[13px] text-white/80"
    >
      <Pencil className="size-4 shrink-0 text-sky-300" aria-hidden />
      <span className="min-w-0 flex-1">{EDIT_HINT_TEXT}</span>
      <button
        type="button"
        aria-label="Maslahatni yopish"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/10"
        onClick={onDismiss}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
