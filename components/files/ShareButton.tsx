"use client";

import { useCallback, useEffect, useState, type Ref } from "react";
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
  type ReadyFile,
} from "@/lib/downloads/deliver";
import {
  isInMiniAppShell,
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
  useSendScope,
  type ActionToast,
  type SendRows,
  type SendScope,
} from "./SaveToBotButton";

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
  const inTelegram = isInMiniAppShell();
  return shareCapability({
    inTelegram,
    version: inTelegram ? tgVersion() : null,
    hasTelegramId,
    canShareFiles: !inTelegram && canShareFile(f),
  });
}

/** Info toast when nothing can be shared from here (UX review m13: say why a download list opens). */
export function shareFallbackToast(): ActionToast {
  return { text: isInMiniAppShell() ? DELIVER_TEXT.shareNoAccount : DELIVER_TEXT.shareNoBrowser, tone: "info" };
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

/**
 * A prepared file of the page's download state (`useDownloads().warm`): the
 * Web Share path reuses the sheet's pre-warm instead of a second prepare loop
 * for the same PDF (review N3).
 */
export type WarmFile = (id: DownloadFormatId) => { since: number; promise: Promise<ReadyFile>; file?: ReadyFile };

export function useShareAction(args: {
  genId: string;
  /** File version: an edit stops the running share and drops prepared messages/files and the rows. */
  version?: number;
  title: string;
  sessionTelegramId: string | null | undefined;
  onToast: (t: ActionToast) => void;
  /** `download-only` / failed Web Share: download this format instead. */
  onDownload: (id: DownloadFormatId) => void;
  /** Shared (or saved for forwarding): the format sheet closes. */
  onDone?: (id: DownloadFormatId) => void;
  /** The page's prepared files (pre-warm); without it the file is prepared here. */
  warm?: WarmFile;
}): ShareAction {
  const { genId, title, sessionTelegramId, onToast, onDownload, onDone, warm } = args;
  const version = args.version ?? 0;
  const [web, setWeb] = useState<WebReady | null>(null);
  const [tgReady, setTgReady] = useState<TgReady | null>(null);
  const { rows, busy, since, begin } = useSendScope(genId, version, onToast);
  useEffect(() => {
    setWeb(null);
    setTgReady(null);
  }, [genId, version]);

  const saveForward = useCallback(
    async (format: DownloadFormatId, started: number, sc: SendScope) => {
      sc.put(format, { s: "delivering", text: DELIVER_TEXT.sending });
      await telegramAction("save", genId, format, () => sc.preparing(format, started), { signal: sc.signal });
      if (!sc.alive()) return;
      sc.put(format, { s: "done", text: DELIVER_TEXT.shareForwarded });
      sc.toast({ text: DELIVER_TEXT.shareForwarded, tone: "ok" });
      onDone?.(format);
    },
    [genId, onDone],
  );

  const shareInTelegram = useCallback(
    async (format: DownloadFormatId, started: number, pending: TgReady | null, sc: SendScope) => {
      const attempt = async (retriedAccess: boolean, retriedExpiry: boolean): Promise<void> => {
        let preparedId: string;
        let expiresAt: string;
        sc.put(format, { s: "delivering", text: DELIVER_TEXT.sharing });
        try {
          ({ preparedId, expiresAt } = await telegramAction("share", genId, format, () => sc.preparing(format, started), { signal: sc.signal }));
        } catch (e) {
          if (!sc.alive()) return;
          const code = apiErrorCode(e);
          // Inline mode off, or a Telegram id the prepared-message API cannot take: the file goes to the bot chat instead.
          if (code === "share_unavailable" || code === "telegram_id_unsupported") return saveForward(format, started, sc);
          if (code === "bot_unreachable" && !retriedAccess && (await requestWriteAccess())) return attempt(true, retriedExpiry);
          throw e;
        }
        // Prepared for a file that is no longer current (or the page is gone): never send it (review M3).
        if (!sc.alive()) return;
        // Android drops `web_app_send_prepared_message` > 10 s after the last touch, silently
        // (BotWebViewContainer `lastClickMs`): after a long upload ask for one more tap instead
        // (the header button, or this format's sheet row: «Tayyor — ulashish uchun bosing»).
        if (gestureRequired(currentDeliveryEnv().platform) && !gestureFresh(lastGesture(), performance.now())) {
          setTgReady({ format, preparedId, expiresAt });
          sc.put(format, { s: "ready" });
          sc.toast({ text: DELIVER_TEXT.shareReady, tone: "info", row: format });
          return;
        }
        await openPicker(preparedId, retriedAccess, retriedExpiry);
      };
      const openPicker = async (preparedId: string, retriedAccess: boolean, retriedExpiry: boolean): Promise<void> => {
        sc.put(format, { s: "delivering", text: DELIVER_TEXT.pickChat });
        const outcome = await shareMessageResult(preparedId);
        if (!sc.alive()) return;
        if (outcome === "sent") {
          sc.put(format, { s: "done", text: DELIVER_TEXT.shared });
          sc.toast({ text: DELIVER_TEXT.shared, tone: "ok" });
          onDone?.(format);
        } else if (outcome === "expired" && !retriedExpiry) return attempt(retriedAccess, true);
        // A second expiry in a row: say so instead of ending silently (UX review m5).
        else if (outcome === "expired") {
          sc.put(format, { s: "error", text: DELIVER_TEXT.shareExpired });
          sc.toast({ text: DELIVER_TEXT.shareExpired, tone: "error", row: format });
        } else if (outcome === "unsupported") return saveForward(format, started, sc);
        else if (outcome === "error" || outcome === "busy") {
          sc.put(format, { s: "error", text: DELIVER_TEXT.failed });
          sc.toast({ text: DELIVER_TEXT.failed, tone: "error", row: format });
        }
        // `failed` (picker closed) and `unknown` (Telegram never answered — maybe sent, maybe not):
        // nothing to claim; the button/row is usable again and the next tap prepares a new message.
        else sc.put(format, SEND_IDLE);
      };
      if (pending && pending.format === format && Date.parse(pending.expiresAt) - Date.now() > 60_000) {
        // The second tap of the Android flow: open the picker within this tap.
        await openPicker(pending.preparedId, false, false);
        return;
      }
      await attempt(false, false);
    },
    [genId, onDone, saveForward],
  );

  /** Web Share, first tap: the bytes (the pre-warmed prepare when there is one). */
  const fetchForShare = useCallback(
    async (id: DownloadFormatId, started: number, sc: SendScope): Promise<File> => {
      let ready: ReadyFile;
      if (warm) {
        const w = warm(id);
        if (!w.file) sc.put(id, { s: "preparing", since: w.since });
        ready = await w.promise;
      } else {
        ready = await prepareDownload(genId, id, () => sc.preparing(id, started), { signal: sc.signal });
      }
      if (sc.alive()) sc.put(id, { s: "delivering", text: DELIVER_TEXT.preparing });
      const blob = await fetchFileBlob(ready, { signal: sc.signal });
      return new File([blob], ready.fileName, { type: ready.mime });
    },
    [genId, warm],
  );

  const run = useCallback(
    async (f: DownloadFormat) => {
      const cap = currentShareCapability(f, Boolean(sessionTelegramId));
      if (cap === "download-only") {
        if (busy) return;
        // Say why a download list opens when the user asked to share (UX review m13).
        onToast(shareFallbackToast());
        onDownload(f.id);
        return;
      }
      const sc = begin();
      if (!sc) return;
      if (cap === "web-share-files" && web && web.format === f.id) {
        // Second tap: synchronous `share()` inside the user activation.
        const file = web.file;
        setWeb(null);
        sc.put(f.id, SEND_IDLE);
        try {
          await navigator.share({ files: [file], title });
          if (!sc.alive()) return;
          sc.put(f.id, { s: "done", text: DELIVER_TEXT.shared });
          onDone?.(f.id);
        } catch (e) {
          if ((e instanceof DOMException && e.name === "AbortError") || !sc.alive()) return;
          sc.put(f.id, { s: "error", text: deliverErrorText(e) });
          sc.toast({ text: deliverErrorText(e), tone: "error" });
          onDownload(f.id);
        } finally {
          sc.end();
        }
        return;
      }
      try {
        if ((cap === "tg-prepared" || cap === "tg-save-forward") && miniAppMismatch(sessionTelegramId)) {
          sc.put(f.id, { s: "error", text: DELIVER_TEXT.mismatch });
          sc.toast({ text: DELIVER_TEXT.mismatch, tone: "error", row: f.id });
          return;
        }
        // One prepared message / fetched file at a time: another format's «Tayyor» row goes back to idle.
        const stale = web?.format ?? tgReady?.format ?? null;
        if (stale && stale !== f.id) sc.put(stale, SEND_IDLE);
        const started = Date.now();
        if (cap === "tg-prepared") {
          const pending = tgReady;
          setTgReady(null); // a prepared id is used at most once; any later tap prepares a new one
          await shareInTelegram(f.id, started, pending, sc);
        } else if (cap === "tg-save-forward") await saveForward(f.id, started, sc);
        else {
          setWeb(null);
          sc.put(f.id, { s: "delivering", text: DELIVER_TEXT.preparing });
          const file = await fetchForShare(f.id, started, sc);
          if (!sc.alive()) return;
          setWeb({ format: f.id, file });
          sc.put(f.id, { s: "ready" });
          sc.toast({ text: DELIVER_TEXT.shareReady, tone: "info", row: f.id });
        }
      } catch (e) {
        failRow(sc, f.id, e);
      } finally {
        sc.end();
      }
    },
    [title, sessionTelegramId, web, tgReady, busy, onToast, onDownload, onDone, shareInTelegram, saveForward, fetchForShare, begin],
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
  expanded = false,
  buttonRef,
  iconOnly = false,
  className,
}: {
  action: ShareAction;
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
  const ready = action.readyFor !== null;
  return (
    <button
      type="button"
      ref={buttonRef}
      data-share-button
      data-share-ready={ready ? "1" : undefined}
      aria-busy={action.busy || undefined}
      aria-haspopup={picker && !ready ? "dialog" : undefined}
      aria-expanded={picker && !ready ? expanded : undefined}
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
