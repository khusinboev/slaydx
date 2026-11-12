"use client";

import type { ReactNode } from "react";
import { MousePointerClick, Save } from "lucide-react";

/** Edit-mode banner: what to do now. */
export const EDIT_MODE_HINT = "Matnni bosing va yozing";
/** After «Tayyor» with unsaved changes: saving is explicit (no auto-PATCH), so the row says so. */
export const SAVE_PROMPT_TEXT = "O‘zgarishlarni saqlang";

/**
 * The in-flow row under the slide stage (never over the slide) of the
 * explicit edit mode (owner request 2026-11-12).
 *
 * - Phones: always there while the deck is editable — it carries the
 *   labelled «Tahrirlash» / «Tayyor» pill (`toggle`), visible next to the
 *   stage without scrolling (the slide toolbar has no room for a label at
 *   390 px).
 * - Desktop: only while it has something to say (edit mode, save prompt);
 *   the toggle itself lives in the slide toolbar.
 *
 * Left side, by priority: the save prompt (`remind`, with its own «Saqlash»
 * so a phone user never has to find the header button), then the edit-mode
 * hint. `role="status"` — screen readers hear the state change.
 */
export function SlideEditModeRow({
  editMode,
  remind,
  pending,
  saving,
  onSave,
  toggle,
}: {
  editMode: boolean;
  /** Edit mode was left with unsaved changes. */
  remind: boolean;
  pending: number;
  saving: boolean;
  onSave: () => void;
  toggle?: ReactNode;
}) {
  return (
    <div
      data-slide-edit-row={remind ? "remind" : editMode ? "edit" : "view"}
      className="no-print flex min-h-11 shrink-0 items-center gap-2 bg-[#252525] py-1 pr-2 pl-3 text-[13px] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
    >
      <div role="status" className="flex min-w-0 flex-1 items-center gap-2">
        {remind ? (
          <>
            <span data-slide-save-prompt className="min-w-0 truncate font-medium text-amber-300">
              {SAVE_PROMPT_TEXT} · {pending}
            </span>
            <button
              type="button"
              data-slide-save-prompt-save
              disabled={saving}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-sky-500 px-3 font-medium text-white outline-none hover:bg-sky-400 focus-visible:ring-2 focus-visible:ring-sky-200 disabled:opacity-60 pointer-coarse:h-11"
              onClick={onSave}
            >
              <Save className="size-4" aria-hidden />
              {saving ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </>
        ) : editMode ? (
          <span data-slide-edit-mode-hint className="flex min-w-0 items-center gap-2">
            <MousePointerClick className="size-4 shrink-0 text-sky-300" aria-hidden />
            <span className="min-w-0 truncate">{EDIT_MODE_HINT}</span>
          </span>
        ) : null}
      </div>
      {toggle}
    </div>
  );
}
