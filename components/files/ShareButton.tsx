"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DownloadFormat, DownloadFormatId } from "@/lib/downloads/formats";
import {
  apiErrorCode,
  deliverErrorText,
  DELIVER_TEXT,
  elapsedSeconds,
  fetchFileBlob,
  markGesture,
  prepareDownload,
  telegramAction,
} from "@/lib/downloads/deliver";
import {
  isInTelegramWebApp,
  requestWriteAccess,
  shareCapability,
  shareMessageResult,
  tgVersion,
  type ShareCapability,
} from "@/lib/telegram-webapp";
import { miniAppMismatch, telegramFailureToast, type ActionToast } from "./SaveToBotButton";

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

export type ShareAction = {
  busy: boolean;
  since: number | null;
  /** Web Share: the file is downloaded, the next tap opens the system share sheet. */
  readyFor: DownloadFormatId | null;
  run: (f: DownloadFormat) => Promise<void>;
};

type WebReady = { format: DownloadFormatId; file: File };

export function useShareAction(args: {
  genId: string;
  title: string;
  sessionTelegramId: string | null | undefined;
  onToast: (t: ActionToast) => void;
  /** `download-only` / failed Web Share: download this format instead. */
  onDownload: (id: DownloadFormatId) => void;
}): ShareAction {
  const { genId, title, sessionTelegramId, onToast, onDownload } = args;
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  const [web, setWeb] = useState<WebReady | null>(null);
  const inFlight = useRef(false);
  useEffect(() => setWeb(null), [genId]);

  const saveForward = useCallback(
    async (format: DownloadFormatId, started: number) => {
      await telegramAction("save", genId, format, () => setSince((s) => s ?? started));
      onToast({ text: DELIVER_TEXT.shareForwarded, tone: "ok" });
    },
    [genId, onToast],
  );

  const shareInTelegram = useCallback(
    async (format: DownloadFormatId, started: number) => {
      const attempt = async (retriedAccess: boolean, retriedExpiry: boolean): Promise<void> => {
        let preparedId: string;
        try {
          preparedId = (await telegramAction("share", genId, format, () => setSince((s) => s ?? started))).preparedId;
        } catch (e) {
          const code = apiErrorCode(e);
          // Inline mode off, or a Telegram id the prepared-message API cannot take: the file goes to the bot chat instead.
          if (code === "share_unavailable" || code === "telegram_id_unsupported") return saveForward(format, started);
          if (code === "bot_unreachable" && !retriedAccess && (await requestWriteAccess())) return attempt(true, retriedExpiry);
          throw e;
        }
        const outcome = await shareMessageResult(preparedId);
        if (outcome === "sent") onToast({ text: DELIVER_TEXT.shared, tone: "ok" });
        else if (outcome === "expired" && !retriedExpiry) return attempt(retriedAccess, true);
        else if (outcome === "unsupported") return saveForward(format, started);
        else if (outcome === "error") onToast({ text: DELIVER_TEXT.failed, tone: "error" });
        // `failed` (picker closed) and `busy` (a picker is already open): nothing to say.
      };
      await attempt(false, false);
    },
    [genId, onToast, saveForward],
  );

  const run = useCallback(
    async (f: DownloadFormat) => {
      if (inFlight.current) return;
      const cap = currentShareCapability(f, Boolean(sessionTelegramId));
      if (cap === "download-only") {
        onDownload(f.id);
        return;
      }
      if (cap === "web-share-files" && web && web.format === f.id) {
        // Second tap: synchronous `share()` inside the user activation.
        const file = web.file;
        setWeb(null);
        try {
          await navigator.share({ files: [file], title });
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          onToast({ text: deliverErrorText(e), tone: "error" });
          onDownload(f.id);
        }
        return;
      }
      if ((cap === "tg-prepared" || cap === "tg-save-forward") && miniAppMismatch(sessionTelegramId)) {
        onToast({ text: DELIVER_TEXT.mismatch, tone: "error" });
        return;
      }
      inFlight.current = true;
      setBusy(true);
      const started = Date.now();
      try {
        if (cap === "tg-prepared") await shareInTelegram(f.id, started);
        else if (cap === "tg-save-forward") await saveForward(f.id, started);
        else {
          const ready = await prepareDownload(genId, f.id, () => setSince((s) => s ?? started));
          const blob = await fetchFileBlob(ready);
          setWeb({ format: f.id, file: new File([blob], ready.fileName, { type: ready.mime }) });
          onToast({ text: DELIVER_TEXT.shareReady, tone: "info" });
        }
      } catch (e) {
        onToast(telegramFailureToast(e));
      } finally {
        inFlight.current = false;
        setBusy(false);
        setSince(null);
      }
    },
    [genId, title, sessionTelegramId, web, onToast, onDownload, shareInTelegram, saveForward],
  );

  return { busy, since, readyFor: web?.format ?? null, run };
}

/** «Ulashish» button (the stored file by default: `format`). */
export function ShareButton({
  action,
  format,
  iconOnly = false,
  className,
}: {
  action: ShareAction;
  format: DownloadFormat;
  iconOnly?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (action.since === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [action.since]);
  const ready = action.readyFor === format.id;
  const label = action.since !== null ? `${elapsedSeconds(action.since, now)} s` : "Ulashish";
  return (
    <button
      type="button"
      data-share-button
      data-share-ready={ready ? "1" : undefined}
      aria-busy={action.busy || undefined}
      disabled={action.busy}
      title={ready ? DELIVER_TEXT.shareReady : "Ulashish — Telegram chatiga yoki boshqa ilovaga"}
      aria-label={iconOnly ? "Ulashish" : undefined}
      onPointerDown={() => markGesture()}
      onClick={() => void action.run(format)}
      className={cn(
        "hover:bg-muted inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium disabled:opacity-70 md:h-9 md:pointer-coarse:h-11",
        ready ? "border-primary bg-primary/10 text-primary ring-primary/40 ring-2" : "bg-card",
        className,
      )}
    >
      {action.busy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
      {iconOnly ? null : <span className="truncate">{label}</span>}
    </button>
  );
}
