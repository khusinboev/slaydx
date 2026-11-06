"use client";

import { X } from "lucide-react";

/**
 * The one line a tab shows after a model switch changed or dropped a setting (`studio-values.ts switchNotice`), instead of
 * the silent reset: «Kling 4.0 Flash: Sifat 1080p → 720p · Oxirgi kadr: bor — bu modelda yo‘q». Closable; the next switch
 * replaces it. The `status` region stays mounted while empty: a screen reader announces what appears in a live region
 * already on the page, not a region that arrives with its text.
 */
export function SwitchNotice({ text, onClose }: { text: string | null; onClose: () => void }) {
  return (
    <div role="status" data-switch-notice-region>
      {text ? (
        <p data-switch-notice className="bg-accent-soft text-accent-soft-foreground mb-3 flex items-start gap-2 rounded-[14px] px-3.5 py-2 text-[13.5px] leading-snug">
          <span className="min-w-0 flex-1 break-words">{text}</span>
          <button type="button" aria-label="Yopish" onClick={onClose} className="focus-visible:ring-ring -m-2 grid size-11 shrink-0 place-items-center rounded-[10px] outline-none focus-visible:ring-2">
            <X className="size-4" aria-hidden />
          </button>
        </p>
      ) : null}
    </div>
  );
}
