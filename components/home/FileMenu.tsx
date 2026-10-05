"use client";

import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { ServerGeneration } from "@/lib/api-client";
import { useDialog } from "../overlays/useDialog";
import { confirmAccepted, confirmClock } from "../overlays/useConfirmClick";

/**
 * Phone file card «⋯» sheet: one overlay with two steps — the action list,
 * then the delete confirmation. It goes through `useDialog`, so the phone's
 * back button / Telegram BackButton / Escape close it first (docs/nav/PLAN.md).
 * The confirm button ignores the second half of a double tap (same rule as
 * `useConfirmClick`), so a fast double tap on «O'chirish» cannot delete.
 */
export function FileMenu({
  gen,
  onClose,
  onDelete,
}: {
  gen: Pick<ServerGeneration, "id" | "topic">;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [step, setStep] = useState<"menu" | "confirm">("menu");
  const armedAt = useRef(0);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useDialog(true, onClose);

  useEffect(() => {
    if (step === "confirm") cancelRef.current?.focus();
  }, [step]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${gen.topic} — amallar`}
      data-file-menu
    >
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Yopish" tabIndex={-1} onClick={onClose} />
      <div
        ref={panelRef}
        className="bg-card relative z-10 w-full max-w-md rounded-t-2xl border p-3 shadow-xl sm:rounded-2xl"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <p className="text-muted-foreground line-clamp-2 px-2 pt-1 pb-2 text-sm font-medium break-words">{gen.topic}</p>
        {step === "menu" ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              data-file-menu-delete
              className="text-destructive hover:bg-muted flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base font-medium"
              onClick={() => {
                armedAt.current = confirmClock();
                setStep("confirm");
              }}
            >
              <Trash2 className="size-5" />
              O‘chirish
            </button>
            <button
              type="button"
              className="hover:bg-muted flex min-h-12 w-full items-center rounded-xl px-3 text-left text-base font-medium"
              onClick={onClose}
            >
              Bekor qilish
            </button>
          </div>
        ) : (
          <div data-file-menu-confirm>
            <p className="px-2 pb-3 text-base">Bu hujjat o‘chiriladi. Qaytarib bo‘lmaydi. Davom etasizmi?</p>
            <div className="flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                className="border-input hover:bg-muted min-h-12 flex-1 rounded-xl border px-3 text-base font-medium"
                onClick={onClose}
              >
                Bekor qilish
              </button>
              <button
                type="button"
                data-file-menu-confirm-delete
                className="bg-destructive min-h-12 flex-1 rounded-xl px-3 text-base font-medium text-white"
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
