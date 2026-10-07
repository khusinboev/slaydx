"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { SAFE_BOTTOM } from "@/components/shell/safe-area";
import { useDialog } from "../overlays/useDialog";
import { confirmAccepted, confirmClock } from "../overlays/useConfirmClick";

/**
 * «⋯» menu of an «Ishlarim» file card: one overlay with two steps — the action
 * list, then the delete confirmation. A bottom sheet on phones, a centred
 * dialog from `sm` up. It goes through `useDialog`, so the phone's back
 * button / Telegram BackButton / Escape close it first (docs/nav/PLAN.md)
 * and the tab bar steps aside while it is open. The confirm button ignores
 * the second half of a double tap (same rule as `useConfirmClick`), so a fast
 * double tap on «O'chirish» cannot delete. Every target is ≥ 48 px.
 */
export function FileMenu({
  gen,
  kind,
  onClose,
  onDelete,
}: {
  gen: Pick<ServerGeneration, "id" | "topic">;
  /** Tool title shown under the file name («Referat»). */
  kind?: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [step, setStep] = useState<"menu" | "confirm">("menu");
  const armedAt = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useDialog(true, onClose);
  // Sheet slides up on phones; the centred dialog only fades in.
  const [wide] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(min-width: 640px)").matches));

  useEffect(() => {
    if (step === "confirm") cancelRef.current?.focus();
  }, [step]);

  const row =
    "hover:bg-accent focus-visible:bg-accent flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left text-[16px] font-medium outline-none";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${gen.topic} — amallar`}
      data-file-menu
    >
      <button
        type="button"
        className="slx-scrim-enter absolute inset-0 bg-black/45"
        aria-label="Yopish"
        tabIndex={-1}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          "bg-card relative z-10 w-full max-w-md rounded-t-[24px] border border-b-0 px-3 pt-2 shadow-2xl sm:rounded-[24px] sm:border-b",
          wide ? "slx-scrim-enter" : "slx-sheet-enter",
        )}
        style={{ paddingBottom: `max(0.75rem, ${SAFE_BOTTOM})` }}
      >
        <div aria-hidden className="bg-border mx-auto mb-2 h-1.5 w-10 rounded-full sm:hidden" />
        <div className="px-2 pt-1 pb-3">
          <p className="text-foreground line-clamp-2 text-[15.5px] leading-snug font-semibold break-words">{gen.topic}</p>
          {kind ? <p className="text-muted-foreground mt-0.5 text-[13px]">{kind}</p> : null}
        </div>
        {step === "menu" ? (
          <div className="flex flex-col gap-0.5 pb-1">
            <button
              type="button"
              data-file-menu-delete
              className={cn(row, "text-destructive")}
              onClick={() => {
                armedAt.current = confirmClock();
                setStep("confirm");
              }}
            >
              <span className="bg-destructive/10 flex size-9 shrink-0 items-center justify-center rounded-xl">
                <Trash2 className="size-[18px]" aria-hidden />
              </span>
              O‘chirish
            </button>
            <button type="button" className={cn(row, "text-muted-foreground justify-center")} onClick={onClose}>
              Bekor qilish
            </button>
          </div>
        ) : (
          <div data-file-menu-confirm className="pb-1">
            <p className="px-2 pb-4 text-[15.5px] leading-relaxed">Bu hujjat o‘chiriladi. Qaytarib bo‘lmaydi. Davom etasizmi?</p>
            <div className="flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                className="border-border hover:bg-accent focus-visible:ring-ring min-h-12 flex-1 rounded-2xl border px-3 text-[16px] font-medium outline-none focus-visible:ring-2"
                onClick={onClose}
              >
                Bekor qilish
              </button>
              <button
                type="button"
                data-file-menu-confirm-delete
                className="bg-destructive text-destructive-foreground dark:text-primary-foreground focus-visible:ring-ring min-h-12 flex-1 rounded-2xl px-3 text-[16px] font-semibold outline-none focus-visible:ring-2"
                onClick={(e) => {
                  if (!confirmAccepted(armedAt.current, e)) return;
                  onDelete(gen.id);
                }}
              >
                O‘chirish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
