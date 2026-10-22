"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDialog } from "@/components/overlays/useDialog";
import { ApiError, request } from "@/lib/api-client";
import { setOfferAsker } from "@/lib/offer-gate";
import { openExternalLink } from "@/lib/telegram-webapp";
import { OFERTA_SUMMARY } from "@/lib/oferta/text";

/**
 * «Ommaviy oferta» acceptance dialog (D6). Mounted once in `Providers`; `lib/api-client.ts request` asks it
 * (via `lib/offer-gate.ts`) whenever a generation submit / payment order is refused with 403
 * `offer_required`. «Qabul qilaman» -> `POST /api/oferta/accept`, then the refused request is repeated.
 * Closing (X / backdrop / phone back / Escape) leaves the action undone. The offer opens in a NEW tab so the
 * form the user is filling stays untouched.
 */
export function OfferDialog() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const settle = useRef<((accepted: boolean) => void) | null>(null);

  const finish = useCallback((accepted: boolean) => {
    setOpen(false);
    setBusy(false);
    setError(null);
    const fn = settle.current;
    settle.current = null;
    fn?.(accepted);
  }, []);

  useEffect(
    () =>
      setOfferAsker(
        (shown) =>
          new Promise<boolean>((resolve) => {
            settle.current = resolve;
            setVersion(shown);
            setOpen(true);
          }),
      ),
    [],
  );

  const close = useCallback(() => finish(false), [finish]);
  const panelRef = useDialog(open, close);

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request<{ ok: true }>("/api/oferta/accept", { method: "POST", body: JSON.stringify({ version }) });
      finish(true);
    } catch (e) {
      setBusy(false);
      // The offer was updated while the dialog was open: take the new version, ask the user to read again.
      if (e instanceof ApiError && e.status === 409 && e.data.code === "offer_outdated" && typeof e.data.version === "number") {
        setVersion(e.data.version);
      }
      setError(e instanceof Error && e.message ? e.message : "Saqlab bo'lmadi, qayta urinib ko'ring");
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/45" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-offer-dialog
        className="bg-card relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border shadow-xl"
      >
        <div className="px-5 pt-4 pb-1">
          <h2 id={titleId} className="text-base font-semibold">
            Ommaviy ofertani qabul qiling
          </h2>
          <p className="text-muted-foreground mt-1 text-[14px] leading-snug">Davom etish uchun xizmat shartlarini qabul qilishingiz kerak. Asosiylari:</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-snug" data-offer-summary>
            {OFERTA_SUMMARY.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <a
            href="/oferta"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              // Inside the Telegram Mini App a plain target=_blank may navigate the app away: use the SDK's openLink.
              if (openExternalLink(new URL("/oferta", window.location.origin).href)) e.preventDefault();
            }}
            data-offer-read
            className="text-primary mt-3 inline-flex min-h-11 items-center text-[15px] font-semibold underline underline-offset-2"
          >
            Ofertani o&apos;qish
          </a>
          {error ? (
            <p role="alert" data-offer-error className="text-destructive mt-1 text-[13px]">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2 px-5 pt-2 pb-4">
          <button type="button" onClick={close} disabled={busy} className="bg-card h-11 rounded-lg border px-4 text-[15px] font-medium disabled:opacity-60" data-offer-cancel>
            Bekor qilish
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="bg-primary text-primary-foreground h-11 rounded-lg px-4 text-[15px] font-medium disabled:opacity-60"
            data-offer-accept
          >
            {busy ? "Saqlanmoqda…" : "Qabul qilaman"}
          </button>
        </div>
      </div>
    </div>
  );
}
