"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronRight, Download, ExternalLink, FileText, Loader2, RefreshCw, Send, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DownloadFormat, DownloadFormatId } from "@/lib/downloads/formats";
import {
  currentDeliveryEnv,
  deliver,
  deliverErrorText,
  downloadToDevice,
  DELIVER_TEXT,
  gestureFresh,
  IDLE,
  lastGesture,
  markGesture,
  openInBrowser,
  prepareDownload,
  readyFresh,
  rowBusy,
  rowPercent,
  rowReducer,
  rowStatusText,
  sendToBot,
  type ReadyFile,
  type RowEvent,
  type RowState,
} from "@/lib/downloads/deliver";
import { useDialog } from "../overlays/useDialog";
import { usePhone } from "./result-layout/prefs";

/**
 * «Yuklab olish» sheet (docs/mobile/PLAN.md §4.5, R1 §5).
 *
 * Phone (`< md`): bottom sheet with safe-area padding; wider screens: a
 * popover under the button. `useDialog` gives Escape, the focus trap and a
 * history entry, so the phone's back button / Telegram BackButton close the
 * sheet first. Portaled to `<body>`: the sticky result header has
 * `backdrop-filter`, which would otherwise become the containing block of a
 * `position: fixed` sheet.
 *
 * Rows come from the format registry (`downloadFormats`), each a small state
 * machine (`rowReducer`): idle → preparing (spinner + elapsed seconds) →
 * ready («Tayyor — yuklab olish», Telegram gesture rule) → delivering
 * (% in a browser, «Telegram yuklab olmoqda…») → done | fallback
 * («Botga yuborish» / «Brauzerda ochish») | error («Qayta urinish»).
 * Other rows stay usable while one works.
 *
 * `mode: "share" | "save"` reuses the sheet as a format picker for
 * «Ulashish» / «Saqlash» (they use the stored file by default, one tap).
 */

export type SheetMode = "download" | "share" | "save";

/** Formats prepared as soon as the sheet opens (lead decision: PDF on open; the stored file is a cheap token mint and gives its size). */
const PREWARM: readonly DownloadFormatId[] = ["native", "pdf"];

type Warm = { since: number; promise: Promise<ReadyFile>; file?: ReadyFile };

/**
 * Row states + actions for one generation. Lives in `ResultActions` so the
 * header button (one-format tools skip the sheet) and the sheet share it.
 * `version` (file version) resets prepared URLs after an edit.
 */
export function useDownloads(genId: string, version: number, opts: { canSendToBot: boolean }) {
  const [rows, setRows] = useState<Partial<Record<DownloadFormatId, RowState>>>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const warm = useRef(new Map<DownloadFormatId, Warm>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    warm.current.clear();
    setRows({});
  }, [genId, version]);

  const dispatch = useCallback((id: DownloadFormatId, e: RowEvent) => {
    if (!alive.current) return;
    setRows((r) => {
      const next = rowReducer(r[id] ?? IDLE, e);
      rowsRef.current = { ...r, [id]: next };
      return rowsRef.current;
    });
  }, []);

  const prepare = useCallback(
    (id: DownloadFormatId): Warm => {
      const have = warm.current.get(id);
      if (have && (!have.file || readyFresh(have.file))) return have;
      const entry: Warm = { since: Date.now(), promise: Promise.resolve(null as unknown as ReadyFile) };
      entry.promise = prepareDownload(genId, id).then(
        (file) => {
          entry.file = file;
          return file;
        },
        (e: unknown) => {
          if (warm.current.get(id) === entry) warm.current.delete(id);
          throw e;
        },
      );
      warm.current.set(id, entry);
      return entry;
    },
    [genId],
  );

  /** Background preparation on sheet open; failures stay silent until the user taps the row. */
  const prewarm = useCallback(
    (formats: readonly DownloadFormat[]) => {
      for (const f of formats) {
        if (!PREWARM.includes(f.id)) continue;
        if ((rowsRef.current[f.id] ?? IDLE).s !== "idle") continue;
        prepare(f.id).promise.catch(() => {});
      }
    },
    [prepare],
  );

  const deliverRow = useCallback(
    async (id: DownloadFormatId, file: ReadyFile) => {
      const env = currentDeliveryEnv();
      if (env.capability === "tg-download" && !gestureFresh(lastGesture(), performance.now())) {
        dispatch(id, { t: "await-tap", file });
        return;
      }
      dispatch(id, { t: "deliver", via: env.capability === "browser" ? "browser" : "telegram" });
      try {
        const result = await deliver(file, {
          ...env,
          lastGestureAt: lastGesture(),
          onProgress: (loaded, total) => dispatch(id, { t: "progress", loaded, total }),
        });
        dispatch(id, { t: "result", result, file });
        if (result.kind === "needs-tap" && result.late) {
          // Android answered after the wait after all: the download did start.
          void result.late.then((o) => {
            if (o === "downloading" && (rowsRef.current[id] ?? IDLE).s === "ready") {
              dispatch(id, { t: "result", result: { kind: "tg-downloading" }, file });
            }
          });
        }
      } catch (e) {
        dispatch(id, { t: "fail", text: deliverErrorText(e) });
      }
    },
    [dispatch],
  );

  /** A tap on a row (or on the one-format header button). Double-tap safe. */
  const tap = useCallback(
    async (id: DownloadFormatId) => {
      const st = rowsRef.current[id] ?? IDLE;
      if (rowBusy(st)) return;
      if ((st.s === "ready" || st.s === "fallback") && readyFresh(st.file)) {
        await deliverRow(id, st.file);
        return;
      }
      const w = prepare(id);
      let file = w.file && readyFresh(w.file) ? w.file : null;
      if (!file) {
        dispatch(id, { t: "prepare", since: w.since });
        try {
          file = await w.promise;
        } catch (e) {
          dispatch(id, { t: "fail", text: deliverErrorText(e) });
          return;
        }
      }
      await deliverRow(id, file);
    },
    [deliverRow, dispatch, prepare],
  );

  const sendRowToBot = useCallback(
    async (id: DownloadFormatId) => {
      const st = rowsRef.current[id] ?? IDLE;
      if (st.s !== "fallback") return;
      dispatch(id, { t: "send" });
      try {
        const started = Date.now();
        await sendToBot(genId, id, () => dispatch(id, { t: "send-wait", since: started }));
        dispatch(id, { t: "sent" });
      } catch (e) {
        dispatch(id, { t: "fail", text: deliverErrorText(e) });
      }
    },
    [dispatch, genId],
  );

  const openRowInBrowser = useCallback(
    (id: DownloadFormatId) => {
      const st = rowsRef.current[id] ?? IDLE;
      if (st.s !== "fallback") return;
      if (openInBrowser(st.file)) dispatch(id, { t: "opened" });
      else dispatch(id, { t: "fail", text: DELIVER_TEXT.failed });
    },
    [dispatch],
  );

  return { rows, tap, prewarm, sendRowToBot, openRowInBrowser, canSendToBot: opts.canSendToBot };
}

export type Downloads = ReturnType<typeof useDownloads>;

/**
 * Lets a viewer inside the result page (image tiles) open the page's download
 * sheet — e.g. inside Telegram, where a single asset has no signed URL and the
 * registry's ZIP is what can be delivered. `null` outside a result page.
 */
export const DownloadSheetContext = createContext<((mode?: SheetMode) => void) | null>(null);
export function useOpenDownloads(): ((mode?: SheetMode) => void) | null {
  return useContext(DownloadSheetContext);
}

/** Re-render every 500 ms while some row counts seconds. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const TITLE: Record<SheetMode, string> = {
  download: "Yuklab olish",
  share: "Qaysi formatda ulashish?",
  save: "Qaysi formatda saqlash?",
};

type PopoverPos = { top: number; right: number };

export function DownloadSheet({
  open,
  onClose,
  mode,
  formats,
  downloads,
  anchorRef,
  sizes,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  mode: SheetMode;
  formats: readonly DownloadFormat[];
  downloads: Downloads;
  /** The button the desktop popover hangs from. */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Known sizes (bytes) per format (from prepared rows). */
  sizes?: Partial<Record<DownloadFormatId, number>>;
  /** `share` / `save` modes: the chosen format (the sheet closes). */
  onPick?: (id: DownloadFormatId) => void;
}) {
  const phone = usePhone();
  const ref = useDialog(open, onClose);
  const { rows, tap, prewarm, sendRowToBot, openRowInBrowser, canSendToBot } = downloads;
  const ticking = open && Object.values(rows).some((r) => r?.s === "preparing" || (r?.s === "sending" && r.since !== undefined));
  const now = useTicker(ticking);
  const [pos, setPos] = useState<PopoverPos | null>(null);

  useEffect(() => {
    if (open && mode === "download") prewarm(formats);
  }, [open, mode, formats, prewarm]);

  useLayoutEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const r = anchorRef?.current?.getBoundingClientRect();
      if (!r) return setPos({ top: 72, right: 16 });
      setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, phone, anchorRef]);

  // Focus the first row when the sheet opens (keyboard and screen reader land inside).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[data-download-row]")?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [open, ref]);

  if (!open || typeof document === "undefined") return null;

  const sheet = (
    <>
      <div
        className={cn("no-print fixed inset-0 z-[60]", phone ? "bg-black/40" : "bg-transparent")}
        aria-hidden
        onClick={onClose}
        data-download-backdrop
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[mode]}
        data-download-sheet={mode}
        data-sheet-kind={phone ? "sheet" : "popover"}
        onPointerDownCapture={() => markGesture()}
        className={cn(
          "no-print bg-background fixed z-[61] flex flex-col shadow-2xl",
          phone ? "inset-x-0 bottom-0 max-h-[85svh] rounded-t-2xl border-t" : "w-[min(380px,calc(100vw-16px))] max-h-[min(70vh,560px)] rounded-xl border",
        )}
        style={
          phone
            ? { paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" }
            : { top: pos?.top ?? 72, right: pos?.right ?? 16 }
        }
      >
        {phone ? <div className="bg-muted-foreground/30 mx-auto mt-2 h-1 w-10 shrink-0 rounded-full" aria-hidden /> : null}
        <div className="flex shrink-0 items-center gap-2 px-4 pt-2 pb-1">
          <p className="min-w-0 flex-1 truncate text-[15px] font-semibold">{TITLE[mode]}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Yopish"
            data-download-close
            className="text-muted-foreground hover:bg-muted -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full"
          >
            <X className="size-5" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" data-download-rows>
          {formats.map((f) => (
            <Row
              key={f.id}
              f={f}
              mode={mode}
              state={rows[f.id] ?? IDLE}
              now={now}
              size={sizes?.[f.id] ?? null}
              canSendToBot={canSendToBot}
              onTap={() => {
                if (mode === "download") void tap(f.id);
                else {
                  onPick?.(f.id);
                  onClose();
                }
              }}
              onSendToBot={() => void sendRowToBot(f.id)}
              onOpenInBrowser={() => openRowInBrowser(f.id)}
            />
          ))}
        </ul>
      </div>
    </>
  );
  return createPortal(sheet, document.body);
}

function Row({
  f,
  mode,
  state,
  now,
  size,
  canSendToBot,
  onTap,
  onSendToBot,
  onOpenInBrowser,
}: {
  f: DownloadFormat;
  mode: SheetMode;
  state: RowState;
  now: number;
  size: number | null;
  canSendToBot: boolean;
  onTap: () => void;
  onSendToBot: () => void;
  onOpenInBrowser: () => void;
}) {
  const busy = rowBusy(state);
  const status = mode === "download" ? rowStatusText(state, f, { now, size }) : [f.hint].filter(Boolean).join(" · ");
  const pct = rowPercent(state);
  const tone = state.s === "error" ? "error" : state.s === "done" ? "done" : state.s === "ready" ? "ready" : "plain";
  return (
    <li className="py-0.5" data-download-item={f.id}>
      <button
        type="button"
        data-download-row={f.id}
        data-row-state={state.s}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={onTap}
        className={cn(
          "hover:bg-muted focus-visible:bg-muted flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left outline-none disabled:cursor-progress",
          tone === "ready" && "bg-primary/10 ring-primary/40 ring-1",
        )}
      >
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-lg" aria-hidden>
          {mode === "download" ? <Download className="size-5" /> : mode === "share" ? <Send className="size-5" /> : <FileText className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-medium">{f.label}</span>
          {status ? (
            <span
              className={cn(
                "mt-0.5 block text-[13px] leading-snug",
                tone === "error" ? "text-destructive" : tone === "done" ? "text-emerald-700 dark:text-emerald-400" : tone === "ready" ? "text-primary font-medium" : "text-muted-foreground",
              )}
              data-row-status
              role={state.s === "error" ? "alert" : undefined}
            >
              {status}
            </span>
          ) : null}
          {pct !== null ? (
            <span className="bg-muted mt-1.5 block h-1.5 overflow-hidden rounded-full" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span className="bg-primary block h-full transition-[width]" style={{ width: `${pct}%` }} />
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1 text-[13px]" aria-hidden>
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : state.s === "done" ? (
            <Check className="size-5 text-emerald-600" />
          ) : state.s === "error" ? (
            <>
              <RefreshCw className="size-4" />
              <span>{DELIVER_TEXT.retry}</span>
            </>
          ) : state.s === "ready" ? (
            <Download className="text-primary size-5" />
          ) : mode === "download" ? null : (
            <ChevronRight className="size-5" />
          )}
        </span>
      </button>
      {state.s === "fallback" || state.s === "sending" ? (
        <div className="flex flex-wrap gap-2 px-3 pt-1 pb-2" data-download-fallback>
          {state.s === "fallback" ? (
            <p className="text-muted-foreground flex w-full items-center gap-1.5 text-[13px]">
              <AlertCircle className="size-4 shrink-0" aria-hidden />
              {state.text}
            </p>
          ) : null}
          {canSendToBot ? (
            <button
              type="button"
              data-fallback-bot
              disabled={state.s === "sending"}
              onClick={onSendToBot}
              className="bg-primary text-primary-foreground inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:opacity-60"
            >
              {state.s === "sending" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {DELIVER_TEXT.sendToBot}
            </button>
          ) : null}
          <button
            type="button"
            data-fallback-browser
            disabled={state.s === "sending"}
            onClick={onOpenInBrowser}
            className="bg-card inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-sm disabled:opacity-60"
          >
            <ExternalLink className="size-4" />
            {DELIVER_TEXT.openInBrowser}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * A download button outside the header (translation «Fayl» tab, game results
 * CSV): a registry format through the delivery driver. In a browser the file
 * is fetched and saved right away (`downloadToDevice`); inside Telegram the
 * page's «Yuklab olish» sheet opens (Telegram `downloadFile`, gesture rule,
 * «Botga yuborish» fallback) — a plain link saves nothing in the Mini App
 * webview (R1 §4).
 */
export function DirectDownloadButton({
  genId,
  format,
  label,
  className,
  ...data
}: {
  genId: string;
  format: DownloadFormatId;
  label: string;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const openDownloads = useOpenDownloads();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async () => {
    if (busy) return;
    markGesture();
    setError(null);
    if (currentDeliveryEnv().capability !== "browser" && openDownloads) {
      openDownloads("download");
      return;
    }
    setBusy(true);
    try {
      await downloadToDevice(genId, format);
    } catch (e) {
      setError(deliverErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        {...data}
        data-file-download-button={format}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => void onClick()}
        className={cn(
          "bg-card hover:bg-muted inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium disabled:opacity-70",
          className,
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-destructive text-[12px]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Known sizes per format, from rows that reached the server (prepared or delivered). */
export function useKnownSizes(downloads: Downloads): Partial<Record<DownloadFormatId, number>> {
  const { rows } = downloads;
  return useMemo(() => {
    const out: Partial<Record<DownloadFormatId, number>> = {};
    for (const [id, st] of Object.entries(rows) as [DownloadFormatId, RowState | undefined][]) {
      if (st && (st.s === "ready" || st.s === "fallback" || st.s === "sending")) out[id] = st.file.size;
    }
    return out;
  }, [rows]);
}
