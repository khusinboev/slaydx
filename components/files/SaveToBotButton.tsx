"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DownloadFormatId } from "@/lib/downloads/formats";
import {
  apiErrorCode,
  botUrlOf,
  deliverErrorText,
  DELIVER_TEXT,
  elapsedSeconds,
  markGesture,
  telegramAction,
} from "@/lib/downloads/deliver";
import { getNavSnapshot } from "@/lib/nav/history";
import {
  closeApp,
  isInTelegramWebApp,
  isMiniAppUserMismatch,
  miniAppUserId,
  openTelegramLink,
  requestWriteAccess,
  saveCapability,
} from "@/lib/telegram-webapp";

/**
 * «Saqlash» (docs/mobile/PLAN.md §1.3, §4.4–§4.5; R2 §3, §5): the bot sends
 * the file into the user's own bot chat. Inside Telegram the Mini App then
 * closes after ~1 s, so the user lands in that chat (`saveCapability`
 * `tg-close`); with unsaved edits (a leave guard is pending) it only toasts.
 * Hidden for accounts without a Telegram id. The recipient is always the
 * session's Telegram account (server); the client also refuses when the Mini
 * App user is a different Telegram account.
 */

/** A short message under the header (`ResultActions` renders it). */
export type ActionToast = {
  text: string;
  tone: "ok" | "error" | "info";
  /** «Botni ochish» — a t.me link (inside Telegram opened with `openTelegramLink`). */
  link?: { label: string; href: string };
};

/** Delay before `WebApp.close()` after a successful «Saqlash» (lead decision: ~1 s, the toast is read first). */
export const SAVE_CLOSE_DELAY_MS = 1_000;

/** Opens a bot link: in Telegram natively, else a new tab. */
export function openBotLink(href: string): void {
  if (isInTelegramWebApp() && openTelegramLink(href)) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Shared failure handling of the Telegram routes → a toast (bot unreachable gets «Botni ochish»). */
export function telegramFailureToast(e: unknown): ActionToast {
  if (apiErrorCode(e) === "bot_unreachable") {
    const href = botUrlOf(e);
    return { text: DELIVER_TEXT.botUnreachable, tone: "error", ...(href ? { link: { label: DELIVER_TEXT.openBot, href } } : {}) };
  }
  return { text: deliverErrorText(e), tone: "error" };
}

/** The Mini App user is another Telegram account than the session's (UX guard; the server sends to the session's id anyway). */
export function miniAppMismatch(sessionTelegramId: string | null | undefined): boolean {
  return isInTelegramWebApp() && isMiniAppUserMismatch(sessionTelegramId, miniAppUserId());
}

export type SaveAction = {
  busy: boolean;
  /** Epoch ms when the server started converting (202 preparing), for the elapsed counter. */
  since: number | null;
  run: (format?: DownloadFormatId) => Promise<void>;
};

export function useSaveAction(args: {
  genId: string;
  sessionTelegramId: string | null | undefined;
  onToast: (t: ActionToast) => void;
}): SaveAction {
  const { genId, sessionTelegramId, onToast } = args;
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const inFlight = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const run = useCallback(
    async (format?: DownloadFormatId) => {
      if (inFlight.current) return;
      if (miniAppMismatch(sessionTelegramId)) {
        onToast({ text: DELIVER_TEXT.mismatch, tone: "error" });
        return;
      }
      inFlight.current = true;
      setBusy(true);
      const started = Date.now();
      const inTelegram = isInTelegramWebApp();
      const attempt = async (retried: boolean): Promise<void> => {
        try {
          const r = await telegramAction("save", genId, format, () => setSince((s) => s ?? started));
          const cap = saveCapability({ inTelegram, hasTelegramId: true, pending: getNavSnapshot().guardPending });
          const href = botUrlOf(null, r.botUrl);
          onToast({
            text: DELIVER_TEXT.sentToBot,
            tone: "ok",
            ...(cap === "web-toast" && href ? { link: { label: DELIVER_TEXT.openBot, href } } : {}),
          });
          if (cap === "tg-close") closeTimer.current = setTimeout(() => closeApp(), SAVE_CLOSE_DELAY_MS);
        } catch (e) {
          // The bot may not write to this user yet: ask once, then try again once.
          if (apiErrorCode(e) === "bot_unreachable" && inTelegram && !retried && (await requestWriteAccess())) {
            return attempt(true);
          }
          onToast(telegramFailureToast(e));
        }
      };
      try {
        await attempt(false);
      } finally {
        inFlight.current = false;
        setBusy(false);
        setSince(null);
      }
    },
    [genId, sessionTelegramId, onToast],
  );

  return { busy, since, run };
}

/**
 * Button label while the route converts (202 preparing): never a bare «2 s»
 * (UX review m3). Phones keep the verb (the button is ~100 px wide) and the
 * spinner; md+ shows «Tayyorlanmoqda… 2 s»; screen readers get the live line.
 */
export function ActionLabel({ verb, since, now }: { verb: string; since: number | null; now: number }) {
  if (since === null) return <span className="truncate">{verb}</span>;
  const line = `${DELIVER_TEXT.preparing} ${elapsedSeconds(since, now)} s`;
  return (
    <>
      <span className="truncate md:hidden" aria-hidden>
        {verb}
      </span>
      <span className="hidden truncate md:inline" aria-hidden>
        {line}
      </span>
      <span role="status" className="sr-only" data-action-progress>
        {line}
      </span>
    </>
  );
}

/** «Saqlash» button. `visible` = the session account has a Telegram id (`saveCapability` ≠ hidden). */
export function SaveToBotButton({
  action,
  visible,
  iconOnly = false,
  className,
}: {
  action: SaveAction;
  visible: boolean;
  iconOnly?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (action.since === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [action.since]);
  if (!visible) return null;
  return (
    <button
      type="button"
      data-save-to-bot
      aria-busy={action.busy || undefined}
      disabled={action.busy}
      title="Telegram'ga saqlash — fayl bot chatiga yuboriladi"
      aria-label={iconOnly ? "Telegram'ga saqlash" : undefined}
      onPointerDown={() => markGesture()}
      onClick={() => void action.run()}
      className={cn(
        "bg-card hover:bg-muted inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-[13px] font-medium disabled:opacity-70 md:h-9 md:gap-1.5 md:px-3 md:text-sm md:pointer-coarse:h-11",
        className,
      )}
    >
      {action.busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      {iconOnly ? null : <ActionLabel verb="Saqlash" since={action.since} now={now} />}
    </button>
  );
}
