"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useDialog } from "@/components/overlays/useDialog";

/**
 * O'yindan chiqish tasdiqlash dialogi.
 *
 * «O'yindan chiqasizmi? Javoblaringiz saqlanmaydi» xabari bilan
 * «Qolish» va «Chiqish» tugmalari. Escape = Qolish.
 *
 * TARIX (docs/nav/PLAN.md, N4): `useDialog` odatdagidek o'z tarix yozuvini
 * oladi — `{ history: false }` BERILMAYDI. Sabab: qo'riqchi (`useLeaveGuard`)
 * orqaga bosilganda O'Z yozuvini allaqachon yeb bo'lgan (pop), dialog esa
 * shu pop ichidan ochiladi. Dialogning yozuvi bo'lmasa, dialog ochiq turganda
 * ikkinchi «orqaga» sahifadan indamay chiqarib yuborardi (qo'riqchi yo'q,
 * dialog tarixi yo'q). Yozuv bilan: ikkinchi «orqaga» dialogni yopadi (=
 * «Qolish»), qo'riqchi qayta o'rnatiladi. «Qolish» da dialog yozuvi qo'riqchiga
 * topshiriladi (yangi yozuv qo'shilmaydi). «Chiqish» da dialog yozuvi + sahifa
 * ortga yuriladi — Chromium smoke da bitta harakat (scratchpad/n4b).
 */
export function LeaveGameDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const onConfirmRef = useRef(onConfirm);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onCancelRef.current = onCancel;
  });

  const close = useCallback(() => {
    onCancelRef.current();
  }, []);

  const panelRef = useDialog(open, close);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Yopish"
        className="absolute inset-0 bg-black/45"
        onClick={close}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col rounded-2xl border shadow-xl"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-1">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold">
              O&apos;yindan chiqasizmi?
            </h2>
            <div className="text-muted-foreground mt-1 text-[13px]">
              Javoblaringiz saqlanmaydi.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">
          <button
            type="button"
            onClick={close}
            className="bg-card h-10 rounded-lg border px-4 text-[15px] font-medium"
            data-stay
          >
            Qolish
          </button>
          <button
            type="button"
            onClick={() => onConfirmRef.current()}
            className="bg-destructive text-destructive-foreground h-10 rounded-lg px-4 text-[15px] font-medium"
            data-leave
          >
            Chiqish
          </button>
        </div>
      </div>
    </div>
  );
}
