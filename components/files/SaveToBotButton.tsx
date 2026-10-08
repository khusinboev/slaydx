"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
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
  isInMiniAppShell,
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
 *
 * Format choice (docs/todo-2026-10-07 T4): a material with several formats
 * opens the format sheet first (`DownloadSheet` mode `save`, the stored file
 * on top); a tap on a row saves THAT format (`POST …/telegram/save {format}`).
 * One-format materials save straight from the button. Each format has its
 * own row state ({@link SendRowState}).
 */

/** A short message under the header (`ResultActions` renders it). */
export type ActionToast = {
  text: string;
  tone: "ok" | "error" | "info";
  /** «Botni ochish» — a t.me link (inside Telegram opened with `openTelegramLink`). */
  link?: { label: string; href: string };
  /**
   * The sheet row of this format shows the same message: while the format
   * sheet of that action is open the toast is not shown (it would cover the
   * row that already says it). Never set on a success toast.
   */
  row?: DownloadFormatId;
};

/**
 * One format row of the «Saqlash» / «Ulashish» sheet:
 * idle → delivering (request in flight / picker open) ⇄ preparing (the
 * route converts: 202, elapsed seconds) → ready (share: the next tap on the
 * row opens the picker) → done | error («Qayta urinish», maybe «Botni ochish»).
 */
export type SendRowState =
  | { s: "idle" }
  | { s: "delivering"; text: string }
  | { s: "preparing"; since: number }
  | { s: "ready" }
  | { s: "done"; text: string }
  | { s: "error"; text: string; link?: { label: string; href: string } };

export type SendRows = Partial<Record<DownloadFormatId, SendRowState>>;

export const SEND_IDLE: SendRowState = { s: "idle" };

/** A row that must not start again on a second tap. */
export function sendRowBusy(s: SendRowState): boolean {
  return s.s === "delivering" || s.s === "preparing";
}

/**
 * One running «Saqlash» / «Ulashish» action. Every effect of the action goes
 * through it, so a dead scope (page left, file version changed) changes nothing.
 */
export type SendScope = {
  /** Aborts the route polling / requests when the scope dies. */
  signal: AbortSignal;
  alive: () => boolean;
  put: (id: DownloadFormatId, st: SendRowState) => void;
  /** 202 preparing: the row and the header label count seconds from `started`. */
  preparing: (id: DownloadFormatId, started: number) => void;
  toast: (t: ActionToast) => void;
  /** The action settled (frees the button and the other rows). */
  end: () => void;
};

type ScopeState = { ctrl: AbortController; running: boolean };

/**
 * Rows + the running action of one {generation, file version} (review M1, M3):
 *  - `begin()` starts an action (`null` while one runs: double-tap safe);
 *  - leaving the page aborts it — polling and requests stop; no toast, no
 *    `close()`, no picker after the page is gone;
 *  - a new file version aborts it too, frees the rows and the button at once
 *    and says so («Fayl yangilandi…») instead of dropping the result silently;
 *    a message prepared for the old file is never sent.
 */
export function useSendScope(genId: string, version: number, onToast: (t: ActionToast) => void) {
  const [rows, setRows] = useState<SendRows>({});
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const toastRef = useRef(onToast);
  useLayoutEffect(() => {
    toastRef.current = onToast;
  });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const cur = useRef<ScopeState | null>(null);
  useEffect(() => {
    const s: ScopeState = { ctrl: new AbortController(), running: false };
    cur.current = s;
    setRows({});
    setBusy(false);
    setSince(null);
    return () => {
      const wasRunning = s.running;
      s.running = false;
      s.ctrl.abort();
      // All cleanups of an unmount run before this microtask, so `mounted` tells a new file version from leaving the page.
      if (wasRunning) queueMicrotask(() => mounted.current && toastRef.current({ text: DELIVER_TEXT.fileChanged, tone: "info" }));
    };
  }, [genId, version]);

  const begin = useCallback((): SendScope | null => {
    const s = cur.current;
    if (!s || s.running) return null;
    s.running = true;
    setBusy(true);
    const alive = () => cur.current === s && !s.ctrl.signal.aborted;
    const put = (id: DownloadFormatId, st: SendRowState) => {
      if (alive()) setRows((r) => (r[id] === st ? r : { ...r, [id]: st }));
    };
    return {
      signal: s.ctrl.signal,
      alive,
      put,
      preparing: (id, started) => {
        if (!alive()) return;
        setSince((x) => x ?? started);
        put(id, { s: "preparing", since: started });
      },
      toast: (t) => {
        if (alive()) toastRef.current(t);
      },
      end: () => {
        if (!alive()) return;
        s.running = false;
        setBusy(false);
        setSince(null);
      },
    };
  }, []);
  return { rows, busy, since, begin };
}

/** Row error + toast from a failed Telegram route call (nothing when the scope is dead: aborted, not failed). */
export function failRow(sc: SendScope, format: DownloadFormatId, e: unknown): void {
  if (!sc.alive()) return;
  const t = telegramFailureToast(e);
  sc.put(format, { s: "error", text: t.text, ...(t.link ? { link: t.link } : {}) });
  sc.toast({ ...t, row: format });
}

/** Delay before `WebApp.close()` after a successful «Saqlash» (lead decision: ~1 s, the toast is read first). */
export const SAVE_CLOSE_DELAY_MS = 1_000;

/** Opens a bot link: in Telegram natively, else a new tab. */
export function openBotLink(href: string): void {
  if (isInMiniAppShell() && openTelegramLink(href)) return;
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
  return isInMiniAppShell() && isMiniAppUserMismatch(sessionTelegramId, miniAppUserId());
}

export type SaveAction = {
  busy: boolean;
  /** Epoch ms when the server started converting (202 preparing), for the elapsed counter. */
  since: number | null;
  /** Per-format row states for the «Saqlash» sheet. */
  rows: SendRows;
  /** Saves `format` (always sent explicitly: the server uploads exactly that file). */
  run: (format: DownloadFormatId) => Promise<void>;
};

export function useSaveAction(args: {
  genId: string;
  /** File version: an edit clears the rows (a «sent» row would describe the old file). */
  version?: number;
  sessionTelegramId: string | null | undefined;
  onToast: (t: ActionToast) => void;
  /** The file reached the bot chat (the format sheet closes). */
  onDone?: (format: DownloadFormatId) => void;
}): SaveAction {
  const { genId, sessionTelegramId, onToast, onDone } = args;
  const { rows, busy, since, begin } = useSendScope(genId, args.version ?? 0, onToast);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const run = useCallback(
    async (format: DownloadFormatId) => {
      const sc = begin();
      if (!sc) return;
      try {
        if (miniAppMismatch(sessionTelegramId)) {
          sc.put(format, { s: "error", text: DELIVER_TEXT.mismatch });
          sc.toast({ text: DELIVER_TEXT.mismatch, tone: "error", row: format });
          return;
        }
        sc.put(format, { s: "delivering", text: DELIVER_TEXT.sending });
        const started = Date.now();
        const inTelegram = isInMiniAppShell();
        const attempt = async (retried: boolean): Promise<void> => {
          try {
            const r = await telegramAction("save", genId, format, () => sc.preparing(format, started), { signal: sc.signal });
            // Left the page or a new file version meanwhile: no row, no toast — and never `close()`.
            if (!sc.alive()) return;
            const cap = saveCapability({ inTelegram, hasTelegramId: true, pending: getNavSnapshot().guardPending });
            const href = botUrlOf(null, r.botUrl);
            sc.put(format, { s: "done", text: DELIVER_TEXT.sentToBot });
            sc.toast({
              text: DELIVER_TEXT.sentToBot,
              tone: "ok",
              ...(cap === "web-toast" && href ? { link: { label: DELIVER_TEXT.openBot, href } } : {}),
            });
            onDone?.(format);
            if (cap === "tg-close") closeTimer.current = setTimeout(() => closeApp(), SAVE_CLOSE_DELAY_MS);
          } catch (e) {
            // The bot may not write to this user yet: ask once, then try again once.
            if (sc.alive() && apiErrorCode(e) === "bot_unreachable" && inTelegram && !retried && (await requestWriteAccess())) {
              return attempt(true);
            }
            failRow(sc, format, e);
          }
        };
        await attempt(false);
      } finally {
        sc.end();
      }
    },
    [genId, sessionTelegramId, onDone, begin],
  );

  return { busy, since, rows, run };
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

/**
 * «Saqlash» button. `visible` = the session account has a Telegram id (`saveCapability` ≠ hidden).
 * `onPress` saves the only format or opens the format sheet (`picker`).
 */
export function SaveToBotButton({
  action,
  visible,
  onPress,
  picker = false,
  expanded = false,
  buttonRef,
  iconOnly = false,
  className,
}: {
  action: SaveAction;
  visible: boolean;
  onPress: () => void;
  /** The press opens the format sheet (the material has several formats). */
  picker?: boolean;
  /** Its format sheet is open (`aria-expanded`). */
  expanded?: boolean;
  /** The desktop format popover hangs from this button. */
  buttonRef?: Ref<HTMLButtonElement>;
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
      ref={buttonRef}
      data-save-to-bot
      aria-busy={action.busy || undefined}
      aria-haspopup={picker ? "dialog" : undefined}
      aria-expanded={picker ? expanded : undefined}
      disabled={action.busy}
      title="Telegram'ga saqlash — fayl bot chatiga yuboriladi"
      aria-label={iconOnly ? "Telegram'ga saqlash" : undefined}
      onPointerDown={() => markGesture()}
      onClick={onPress}
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
