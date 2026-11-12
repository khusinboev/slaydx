"use client";

import type { ButtonHTMLAttributes } from "react";
import { Check, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { TOUCH_BOX } from "./toolbar";

/** Label of the toggle while edit mode is off / on (one source for the three viewers and their tests). */
export const EDIT_TOGGLE_LABEL = "Tahrirlash";
export const EDIT_TOGGLE_DONE_LABEL = "Tayyor";

/**
 * The ONE «Tahrirlash» toggle of the result viewers (slides, Word, resume —
 * owner request 2026-11-12: «soddaroq odam ham tushunsin»). Same look and
 * wording everywhere: pencil + «Tahrirlash» while viewing, check + «Tayyor»
 * (filled) while editing; `aria-pressed` says the state, so the meaning never
 * rests on the colour alone. What pressing it does stays the viewer's own
 * business (`onClick`).
 *
 * - `variant="toolbar"`: the compact dark-toolbar button (44 px on a coarse
 *   pointer via `TOUCH_BOX`). `narrowIconOnly` keeps only the icon below a
 *   24rem toolbar (a 360 px phone row); the name stays for screen readers.
 * - `variant="pill"`: the phone slide control under the stage — always
 *   labelled and always ≥ 44 px.
 */
export function EditToggle({
  on,
  variant = "toolbar",
  narrowIconOnly = false,
  className,
  ...rest
}: {
  on: boolean;
  variant?: "toolbar" | "pill";
  narrowIconOnly?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed" | "children">) {
  const Icon = on ? Check : Pencil;
  return (
    <button
      type="button"
      aria-pressed={on}
      data-edit-toggle={on ? "on" : "off"}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-1 focus-visible:ring-offset-[#3b3b3b]",
        variant === "pill"
          ? "h-11 min-w-11 justify-center rounded-full px-4 text-[14px]"
          : cn("px-2 py-1 text-[12px]", TOUCH_BOX, "pointer-coarse:text-[13px]"),
        on
          ? "bg-sky-500 text-white hover:bg-sky-400"
          : variant === "pill"
            ? "bg-white text-[#1e1e1e] shadow hover:bg-white/90"
            : "bg-white/10 text-white hover:bg-white/20",
        className,
      )}
      {...rest}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className={narrowIconOnly ? "@max-sm:sr-only" : undefined}>{on ? EDIT_TOGGLE_DONE_LABEL : EDIT_TOGGLE_LABEL}</span>
    </button>
  );
}
