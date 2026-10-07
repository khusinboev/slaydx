"use client";

import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { Loader2, Share2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DownloadFormat, DownloadFormatId } from "@/lib/downloads/formats";
import {
  apiErrorCode,
  deliverErrorText,
  DELIVER_TEXT,
  fetchFileBlob,
  markGesture,
  prepareDownload,
  telegramAction,
  currentDeliveryEnv,
  gestureFresh,
  gestureRequired,
  lastGesture,
} from "@/lib/downloads/deliver";
import {
  isInTelegramWebApp,
  requestWriteAccess,
  shareCapability,
  shareMessageResult,
  tgVersion,
  type ShareCapability,
} from "@/lib/telegram-webapp";
import {
  ActionLabel,
  failRow,
  miniAppMismatch,
  SEND_IDLE,
  useSendRows,
  type ActionToast,
  type SendRows,
  type SendRowState,
} from "./SaveToBotButton";

type PutRow = (id: DownloadFormatId, st: SendRowState) => void;

/**
 * «Ulashish» (docs/mobile/PLAN.md §1.2, §4.5; R2 §2, §5).
 *
 * Capability (`shareCapability`, decided at tap time — the Telegram script
 * may load after the first render):
 *  - `tg-prepared` (Telegram ≥ 8.0): the server uploads the file into the
 *    user's bot chat and prepares an inline message; `shareMessage` opens
 *    Telegram's chat picker and the file itself is posted into the chosen chat;
 *  - `tg-save-forward` (older client), `501 share_unavailable` (inline mode
 *    off) or `UNSUPPORTED`: «Saqlash» + «u yerdan uzating»;
 *  - `web-share-files` (browser that can share this file type): two taps —
 *    the first downloads the bytes, the second calls `navigator.share`
 *    synchronously (transient activation);
 *  - `download-only`: falls back to downloading.
 *
 * Format choice (docs/todo-2026-10-07 T4): a material with several formats
 * opens the format sheet first (`DownloadSheet` mode `share`, the stored file
 * on top); a tap on a row shares THAT format (`POST …/telegram/share {format}`
 * → `shareMessage`). The «Tayyor» re-tap (Android 10-second rule, Web Share's
 * second tap) lives on that row. One-format materials share from the button.
 */

/** Pure probe: this browser's Web Share accepts a file of this type (Chromium refuses DOCX/PPTX). */
export function canShareFile(f: Pick<DownloadFormat, "ext" | "mime">, nav: unknown = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  try {
    const n = nav as { canShare?: (d: { files: File[] }) => boolean; share?: unknown } | undefined;
    if (!n || typeof n.canShare !== "function" || typeof n.share !== "function" || typeof File === "undefined") return false;
    return n.canShare({ files: [new File([""], `fayl.${f.ext}`, { type: f.mime })] }) === true;
  } catch {
    return false;
  }
}

/** The capability right now, for this format and session. */
export function currentShareCapability(f: DownloadFormat, hasTelegramId: boolean): ShareCapability {
  const inTelegram = isInTelegramWebApp();
  return shareCapability({
    inTelegram,
    version: inTelegram ? tgVersion() : null,
    hasTelegramId,
    canShareFiles: !inTelegram && canShareFile(f),
  });
}

/** Info toast when nothing can be shared from here (UX review m13: say why a download list opens). */
export function shareFallbackToast(): ActionToast {
  return { text: isInTelegramWebApp() ? DELIVER_TEXT.shareNoAccount : DELIVER_TEXT.shareNoBrowser, tone: "info" };
}

export type ShareAction = {
  busy: boolean;
  since: number | null;
  /**
   * Web Share: the file is downloaded, the next tap opens the system share sheet;
   * Telegram (Android): the message is prepared, the next tap opens the chat picker.
   */
  readyFor: DownloadFormatId | null;
  /** Per-format row states for the «Ulashish» sheet. */
  rows: SendRows;
  run: (f: DownloadFormat) => Promise<void>;
};

type WebReady = { format: DownloadFormatId; file: File };
/** Telegram (Android): prepared, but the tap is too old for the client — the next tap opens the picker. */
type TgReady = { format: DownloadFormatId; preparedId: string; expiresAt: string };

export function useShareAction(args: {
  genId: string;
  /** File version: an edit drops prepared messages/files and the rows. */
  version?: number;
  title: string;
  sessionTelegramId: string | null | undefined;
  onToast: (t: ActionToast) => void;
  /** `download-only` / failed Web Share: download this format instead. */
  onDownload: (id: DownloadFormatId) => void;
  /** Shared (or saved for forwarding): the format sheet closes. */
  onDone?: (id: DownloadFormatId) => void;
}): ShareAction {
  const { genId, title, sessionTelegramId, onToast, onDownload, onDone } = args;
  const version = args.version ?? 0;
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [web, setWeb] = useState<WebReady | null>(null);
  const [tgReady, setTgReady] = useState<TgReady | null>(null);
  const { rows, bind } = useSendRows(genId, version);
  const inFlight = useRef(false);
  useEffect(() => {
    setWeb(null);
    setTgReady(null);
  }, [genId, version]);

  const saveForward = useCallback(
    async (format: DownloadFormatId, started: number, put: PutRow) => {
      put(format, { s: "delivering", text: DELIVER_TEXT.sending });
      await telegramAction("save", genId, format, () => {
        setSince((s) => s ?? started);
        put(format, { s: "preparing", since: started });
      });
      put(format, { s: "done", text: DELIVER_TEXT.shareForwarded });
      onToast({ text: DELIVER_TEXT.shareForwarded, tone: "ok" });
      onDone?.(format);
    },
    [genId, onToast, onDone],
  );

  const shareInTelegram = useCallback(
    async (format: DownloadFormatId, started: number, pending: TgReady | null, put: PutRow) => {
      const attempt = async (retriedAccess: boolean, retriedExpiry: boolean): Promise<void> => {
        let preparedId: string;
        let expiresAt: string;
        put(format, { s: "delivering", text: DELIVER_TEXT.sharing });
        try {
          ({ preparedId, expiresAt } = await telegramAction("share", genId, format, () => {
            setSince((s) => s ?? started);
            put(format, { s: "preparing", since: started });
          }));
        } catch (e) {
          const code = apiErrorCode(e);
          // Inline mode off, or a Telegram id the prepared-message API cannot take: the file goes to the bot chat instead.
          if (code === "share_unavailable" || code === "telegram_id_unsupported") return saveForward(format, started, put);
          if (code === "bot_unreachable" && !retriedAccess && (await requestWriteAccess())) return attempt(true, retriedExpiry);
          throw e;
        }
        // Android drops `web_app_send_prepared_message` > 10 s after the last touch, silently
        // (BotWebViewContainer `lastClickMs`): after a long upload ask for one more tap instead
        // (the header button, or this format's sheet row: «Tayyor — ulashish uchun bosing»).
        if (gestureRequired(currentDeliveryEnv().platform) && !gestureFresh(lastGesture(), performance.now())) {
          setTgReady({ format, preparedId, expiresAt });
          put(format, { s: "ready" });
          onToast({ text: DELIVER_TEXT.shareReady, tone: "info", row: format });
          return;
        }
        await openPicker(preparedId, retriedAccess, retriedExpiry);
      };
      const openPicker = async (preparedId: string, retriedAccess: boolean, retriedExpiry: boolean): Promise<void> => {
        put(format, { s: "delivering", text: DELIVER_TEXT.pickChat });
        const outcome = await shareMessageResult(preparedId);
        if (outcome === "sent") {
          put(format, { s: "done", text: DELIVER_TEXT.shared });
          onToast({ text: DELIVER_TEXT.shared, tone: "ok" });
          onDone?.(format);
        } else if (outcome === "expired" && !retriedExpiry) return attempt(retriedAccess, true);
        // A second expiry in a row: say so instead of ending silently (UX review m5).
        else if (outcome === "expired") {
          put(format, { s: "error", text: DELIVER_TEXT.shareExpired });
          onToast({ text: DELIVER_TEXT.shareExpired, tone: "error", row: format });
        } else if (outcome === "unsupported") return saveForward(format, started, put);
        else if (outcome === "error" || outcome === "busy") {
          put(format, { s: "error", text: DELIVER_TEXT.failed });
          onToast({ text: DELIVER_TEXT.failed, tone: "error", row: format });
        }
        // `failed` (picker closed) and `unknown` (Telegram never answered — maybe sent, maybe not):
        // nothing to claim; the button/row is usable again and the next tap prepares a new message.
        else put(format, SEND_IDLE);
      };
      if (pending && pending.format === format && Date.parse(pending.expiresAt) - Date.now() > 60_000) {
        // The second tap of the Android flow: open the picker within this tap.
        await openPicker(pending.preparedId, false, false);
        return;
      }
      await attempt(false, false);
    },
    [genId, onToast, onDone, saveForward],
  );

  const run = useCallback(
    async (f: DownloadFormat) => {
      if (inFlight.current) return;
      const put = bind();
      const cap = currentShareCapability(f, Boolean(sessionTelegramId));
      if (cap === "download-only") {
        // Say why a download list opens when the user asked to share (UX review m13).
        onToast(shareFallbackToast());
        onDownload(f.id);
        return;
      }
      if (cap === "web-share-files" && web && web.format === f.id) {
        // Second tap: synchronous `share()` inside the user activation.
        const file = web.file;
        setWeb(null);
        put(f.id, SEND_IDLE);
        try {
          await navigator.share({ files: [file], title });
          put(f.id, { s: "done", text: DELIVER_TEXT.shared });
          onDone?.(f.id);
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          put(f.id, { s: "error", text: deliverErrorText(e) });
          onToast({ text: deliverErrorText(e), tone: "error" });
          onDownload(f.id);
        }
        return;
      }
      if ((cap === "tg-prepared" || cap === "tg-save-forward") && miniAppMismatch(sessionTelegramId)) {
        put(f.id, { s: "error", text: DELIVER_TEXT.mismatch });
        onToast({ text: DELIVER_TEXT.mismatch, tone: "error", row: f.id });
        return;
      }
      // One prepared message / fetched file at a time: another format's «Tayyor» row goes back to idle.
      const stale = web?.format ?? tgReady?.format ?? null;
      if (stale && stale !== f.id) put(stale, SEND_IDLE);
      inFlight.current = true;
      setBusy(true);
      const started = Date.now();
      try {
        if (cap === "tg-prepared") {
          const pending = tgReady;
          setTgReady(null); // a prepared id is used at most once; any later tap prepares a new one
          await shareInTelegram(f.id, started, pending, put);
        }
        else if (cap === "tg-save-forward") await saveForward(f.id, started, put);
        else {
          setWeb(null);
          put(f.id, { s: "delivering", text: DELIVER_TEXT.preparing });
          const ready = await prepareDownload(genId, f.id, () => {
            setSince((s) => s ?? started);
            put(f.id, { s: "preparing", since: started });
          });
          const blob = await fetchFileBlob(ready);
          setWeb({ format: f.id, file: new File([blob], ready.fileName, { type: ready.mime }) });
          put(f.id, { s: "ready" });
          onToast({ text: DELIVER_TEXT.shareReady, tone: "info", row: f.id });
        }
      } catch (e) {
        onToast(failRow(put, f.id, e));
      } finally {
        inFlight.current = false;
        setBusy(false);
        setSince(null);
      }
    },
    [genId, title, sessionTelegramId, web, tgReady, onToast, onDownload, onDone, shareInTelegram, saveForward, bind],
  );

  return { busy, since, readyFor: web?.format ?? tgReady?.format ?? null, rows, run };
}

/**
 * «Ulashish» button. `onPress` shares the only format, or opens the format
 * sheet (`picker`) — or, when a format is already «Tayyor» (Android re-tap,
 * Web Share second tap), shares that one directly (the caller decides).
 */
export function ShareButton({
  action,
  onPress,
  picker = false,
  buttonRef,
  iconOnly = false,
  className,
}: {
  action: ShareAction;
  onPress: () => void;
  /** The press opens the format sheet (the material has several formats). */
  picker?: boolean;
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
  const ready = action.readyFor !== null;
  return (
    <button
      type="button"
      ref={buttonRef}
      data-share-button
      data-share-ready={ready ? "1" : undefined}
      aria-busy={action.busy || undefined}
      aria-haspopup={picker && !ready ? "dialog" : undefined}
      disabled={action.busy}
      title={ready ? DELIVER_TEXT.shareReady : "Ulashish — Telegram chatiga yoki boshqa ilovaga"}
      aria-label={iconOnly ? "Ulashish" : undefined}
      onPointerDown={() => markGesture()}
      onClick={onPress}
      className={cn(
        "hover:bg-muted inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-lg border px-2 text-[13px] font-medium disabled:opacity-70 md:h-9 md:gap-1.5 md:px-3 md:text-sm md:pointer-coarse:h-11",
        ready ? "border-primary bg-primary/10 text-primary ring-primary/40 ring-2" : "bg-card",
        className,
      )}
    >
      {action.busy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
      {iconOnly ? null : <ActionLabel verb="Ulashish" since={action.since} now={now} />}
    </button>
  );
}
