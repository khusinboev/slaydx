"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { useDialog } from "@/components/overlays/useDialog";

export type AccountSwitchPrompt = {
  /** The signed-in SlaydX account (`accountLabel`). */
  from: string;
  /** The Telegram account the Mini App was opened with (`initDataUserLabel`). */
  to: string;
  /** `ask` — waiting for the answer; `busy` — «O'tish» sent; `refused` — the server said no (calm message). */
  status: "ask" | "busy" | "refused";
  message?: string;
};

/**
 * «Akkauntni almashtirasizmi?» — the Mini App's account switch is NEVER
 * silent (security review B1): Telegram Android's ordinary in-app browser
 * also looks like a Mini App and shares the cookies, so a chat link with
 * someone else's launch data must not swap the session without a tap.
 * `useDialog` gives it a history entry: phone back / Telegram BackButton /
 * Escape = «Yo'q, qolaman».
 */
export function AccountSwitchDialog({
  prompt,
  onConfirm,
  onCancel,
}: {
  prompt: AccountSwitchPrompt | null;
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
  const close = useCallback(() => onCancelRef.current(), []);
  const open = prompt !== null;
  const panelRef = useDialog(open, close);
  if (!prompt) return null;
  const busy = prompt.status === "busy";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/45" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-account-switch
        className="bg-card relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col rounded-2xl border shadow-xl"
      >
        <div className="px-5 pt-4 pb-1">
          <h2 id={titleId} className="text-base font-semibold">
            {prompt.status === "refused" ? "Akkaunt almashtirilmadi" : "Akkauntni almashtirasizmi?"}
          </h2>
          <p className="text-muted-foreground mt-1 text-[14px] leading-snug" data-switch-text>
            {prompt.status === "refused"
              ? prompt.message
              : `Siz hozir ${prompt.from} sifatida kirgansiz. Telegram'dagi ${prompt.to} akkauntiga o'tasizmi?`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">
          {prompt.status === "refused" ? (
            <button type="button" onClick={close} className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium" data-switch-ok>
              Tushunarli
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium disabled:opacity-60"
                data-switch-stay
              >
                Yo&apos;q, qolaman
              </button>
              <button
                type="button"
                onClick={() => onConfirmRef.current()}
                disabled={busy}
                className="bg-primary text-primary-foreground h-11 rounded-lg px-4 text-[15px] font-medium disabled:opacity-60"
                data-switch-go
              >
                {busy ? "O'tilmoqda…" : "O'tish"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
