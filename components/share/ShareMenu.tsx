"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, Send, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { copyToClipboard, openTelegramShare, resolveShareUrl, shareLink, type LinkShare, type ShareOutcome } from "@/lib/share";
import { useDialog } from "../overlays/useDialog";

/**
 * The fallback of every link «Ulashish» (docs/share/AUDIT.md): shown when the device has no native
 * share sheet (Firefox, Linux Chrome, …) or the sheet failed. Two ways out, both a tap away:
 * «Havolani nusxalash» (Clipboard API → selected field → hidden textarea) and «Telegramda
 * ulashish» (`t.me/share/url` — Telegram's own sheet inside the Mini App, a new tab elsewhere).
 *
 * `useDialog`: Escape closes it, Tab stays inside, the phone's back button closes it before the
 * page. Rows are 48 px. Phone: bottom sheet (safe-area padded); `sm+`: centred card. Theme tokens
 * only, so light and dark both read.
 */

/** How long «Nusxalandi» stays before the menu closes itself. */
export const COPIED_CLOSE_MS = 1_200;

const FOCUS = "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none";
const ROW = "hover:bg-muted flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-[15px] font-medium";

type MenuState = { data: LinkShare; reason: "unsupported" | "error" };

const HINT: Record<MenuState["reason"], string> = {
  unsupported: "Bu qurilmada tizimning ulashish oynasi yo‘q. Havolani quyidagicha yuborishingiz mumkin.",
  error: "Ulashib bo‘lmadi. Boshqa usulni tanlang.",
};

export function ShareMenu({ data, reason, onClose }: { data: LinkShare; reason: MenuState["reason"]; onClose: () => void }) {
  const titleId = useId();
  const panelRef = useDialog(true, onClose);
  const field = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<"idle" | "ok" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = async () => {
    const ok = await copyToClipboard(data.url, { field: field.current });
    setCopy(ok ? "ok" : "failed");
    if (timer.current) clearTimeout(timer.current);
    if (ok) timer.current = setTimeout(onClose, COPIED_CLOSE_MS);
    // A failed copy leaves the link selected in the field for a manual copy.
    else {
      field.current?.focus();
      field.current?.select();
    }
  };

  const onTelegram = () => {
    if (openTelegramShare(data)) onClose();
    else setCopy("failed");
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="no-print fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center sm:p-4" data-share-menu-root>
      <button type="button" tabIndex={-1} aria-label="Yopish" className="absolute inset-0 bg-black/45" onClick={onClose} data-share-menu-backdrop />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-share-menu
        data-share-reason={reason}
        className="bg-card relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-sm flex-col overflow-y-auto rounded-2xl border shadow-xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <h2 id={titleId} className="px-4 pt-3 pr-14 text-base font-semibold">
          Ulashish
        </h2>
        <p className="text-muted-foreground px-4 text-[14px] leading-snug" data-share-menu-hint>
          {HINT[reason]}
        </p>

        <div className="flex flex-col gap-2 px-4 pt-3">
          <button type="button" onClick={() => void onCopy()} data-share-copy-link className={cn(ROW, FOCUS, copy === "ok" && "border-emerald-500/50")}>
            {copy === "ok" ? (
              <Check className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ) : (
              <Link2 className="size-5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">Havolani nusxalash</span>
          </button>
          <button type="button" onClick={onTelegram} data-share-telegram className={cn(ROW, FOCUS)}>
            <Send className="size-5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">Telegramda ulashish</span>
          </button>
        </div>

        <p
          role={copy === "failed" ? "alert" : "status"}
          data-share-menu-status={copy}
          className={cn("min-h-5 px-4 pt-2 text-[13px]", copy === "failed" ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}
        >
          {copy === "ok" ? "Nusxalandi" : copy === "failed" ? "Bajarib bo‘lmadi — havolani belgilab, qo‘lda nusxalang" : ""}
        </p>

        <label className="block px-4 pt-1 pb-4">
          <span className="sr-only">Havola</span>
          <input
            ref={field}
            readOnly
            value={data.url}
            data-share-menu-url
            onFocus={(e) => e.currentTarget.select()}
            className={cn("border-input bg-background h-11 w-full min-w-0 rounded-xl border px-3 font-mono text-[13px]", FOCUS)}
          />
        </label>
        {/* Last in the DOM so the first focus lands on the first action; placed top-right by CSS. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Yopish"
          data-share-menu-close
          className={cn("text-muted-foreground hover:bg-muted absolute top-1 right-1 flex size-11 items-center justify-center rounded-full", FOCUS)}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export type LinkShareApi = {
  /** Call straight from the click handler (the native sheet needs the tap's user activation). */
  share: (data: LinkShare) => void;
  /** Render this once next to the button: it is the fallback menu while it is open, else `null`. */
  menu: ReactNode;
};

/**
 * `shareLink` + the fallback menu for one share button. A share already in flight (the native
 * sheet is open) ignores a second tap. `onOutcome` sees every result (analytics / tests).
 */
export function useLinkShare(opts: { onOutcome?: (o: ShareOutcome) => void } = {}): LinkShareApi {
  const [state, setState] = useState<MenuState | null>(null);
  const busy = useRef(false);
  const outcome = useRef(opts.onOutcome);
  useEffect(() => {
    outcome.current = opts.onOutcome;
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const share = useCallback((data: LinkShare) => {
    if (busy.current) return;
    busy.current = true;
    const link: LinkShare = { ...data, url: resolveShareUrl(data.url) };
    // `shareLink` reaches `navigator.share` synchronously, inside this tap.
    void shareLink(link).then((o) => {
      busy.current = false;
      outcome.current?.(o);
      if (o.status === "fallback" && alive.current) setState({ data: link, reason: o.reason });
    });
  }, []);

  const close = useCallback(() => setState(null), []);
  return { share, menu: state ? <ShareMenu data={state.data} reason={state.reason} onClose={close} /> : null };
}
