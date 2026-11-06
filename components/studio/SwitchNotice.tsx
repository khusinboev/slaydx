"use client";

import { X } from "lucide-react";

/**
 * The one line a tab shows after a model switch changed or dropped a setting (`studio-values.ts switchNotice`), instead of
 * the silent reset: «Kling 4.0 Flash: Sifat 1080p → 720p · Oxirgi kadr (…) bu modelda yo‘q». A status, closable; the next
 * switch replaces it.
 */
export function SwitchNotice({ text, onClose }: { text: string | null; onClose: () => void }) {
  if (!text) return null;
  return (
    <p role="status" data-switch-notice className="bg-accent-soft text-accent-soft-foreground mb-3 flex items-start gap-2 rounded-[14px] px-3.5 py-2 text-[13.5px] leading-snug">
      <span className="min-w-0 flex-1 break-words">{text}</span>
      <button type="button" aria-label="Yopish" onClick={onClose} className="focus-visible:ring-ring -m-2 grid size-11 shrink-0 place-items-center rounded-[10px] outline-none focus-visible:ring-2">
        <X className="size-4" aria-hidden />
      </button>
    </p>
  );
}
