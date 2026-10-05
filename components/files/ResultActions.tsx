"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Download, Loader2, MoreHorizontal, Send, Share2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { GenerationDetail } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { defaultShareFormat, downloadFormats, downloadSubject, type DownloadFormatId } from "@/lib/downloads/formats";
import { DELIVER_TEXT, IDLE, markGesture, rowBusy, rowPercent, elapsedSeconds, type RowState } from "@/lib/downloads/deliver";
import { useDialog } from "../overlays/useDialog";
import { DownloadSheet, useDownloads, type SheetMode } from "./DownloadSheet";
import { openBotLink, SaveToBotButton, useSaveAction, type ActionToast } from "./SaveToBotButton";
import { ShareButton, useShareAction } from "./ShareButton";

/**
 * Result header actions (docs/mobile/PLAN.md §4.5, R5 P6): ONE «Yuklab olish»
 * (label visible on phones too) + «Ulashish» + «Saqlash», delete in the «⋯»
 * overflow. Owns the header `<nav>`:
 *
 *   phone (< md):  [←] [title, 2 lines] [edit actions] [⋯]
 *                  [ Yuklab olish ][ Ulashish ][ Saqlash ]      ← hidden when the header is compact
 *   compact phone: [←] [title, 1 line] [edit actions] [⬇] [⋯]
 *   md+:           [←] [title · subtitle] [edit actions] [Yuklab olish ▾] [Ulashish] [Saqlash] [⋯]
 *
 * One flex-wrap row with `order` so every control exists once in the DOM
 * (no duplicated buttons for tests or screen readers). Nothing is wider than
 * the viewport at 360 px.
 *
 * Tools with one format skip the sheet: the button itself shows the row
 * state (spinner + seconds, %, «Tayyor — yuklab olish»); a Telegram refusal or
 * an error opens the sheet with that row's fallback / «Qayta urinish».
 */

/** Toast stays this long (ms). */
const TOAST_MS = 4_500;

export function ResultActions({
  gen,
  lead,
  editActions,
  fileStale,
  expired,
  hasResults,
  del,
  deleting,
  registerOpen,
}: {
  gen: GenerationDetail;
  /** «←» + title block (ResultView). */
  lead: ReactNode;
  editActions: ReactNode;
  fileStale: boolean;
  /** COMPLETED but the file is gone: only the overflow (delete) remains. */
  expired: boolean;
  /** Game results exist (results CSV row). */
  hasResults: boolean;
  /** Two-step delete (`useConfirmClick`, owned by ResultView). */
  del: { armed: boolean; trigger: (e?: { detail?: number }) => void };
  deleting: boolean;
  /** Lets viewers open the sheet (`DownloadSheetContext`). */
  registerOpen?: (open: ((mode?: SheetMode) => void) | null) => void;
}) {
  const features = useAppStore((s) => s.features);
  const sessionTelegramId = useAppStore((s) => s.user?.telegramId ?? null);
  const subject = useMemo(() => downloadSubject(gen, { hasResults }), [gen, hasResults]);
  const formats = useMemo(() => downloadFormats(subject, { pdf: Boolean(features?.pdf) }), [subject, features?.pdf]);
  const shareFormat = useMemo(() => defaultShareFormat(subject), [subject]);
  const single = formats.length === 1;

  const downloads = useDownloads(gen.id, gen.fileVersion ?? 0, { canSendToBot: Boolean(sessionTelegramId) });
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const dlRef = useRef<HTMLButtonElement>(null);

  const [toast, setToast] = useState<ActionToast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  const onToast = useCallback((t: ActionToast) => setToast(t), []);

  const openSheet = useCallback(
    (mode: SheetMode = "download") => {
      if (expired) return;
      setSheet(mode);
    },
    [expired],
  );
  useEffect(() => {
    registerOpen?.(openSheet);
    return () => registerOpen?.(null);
  }, [registerOpen, openSheet]);

  /** Download a specific format: one-format tools deliver straight from the button, else the sheet. */
  const downloadFormat = useCallback(
    (id: DownloadFormatId) => {
      if (single) void downloads.tap(id);
      else setSheet("download");
    },
    [single, downloads],
  );

  const save = useSaveAction({ genId: gen.id, sessionTelegramId, onToast });
  const share = useShareAction({ genId: gen.id, title: gen.topic, sessionTelegramId, onToast, onDownload: downloadFormat });

  // One-format tools: a refusal or an error needs the sheet's fallback rows / «Qayta urinish».
  const singleState = single ? (downloads.rows[formats[0].id] ?? IDLE) : IDLE;
  useEffect(() => {
    if (single && (singleState.s === "fallback" || singleState.s === "error")) setSheet("download");
  }, [single, singleState.s]);

  const [menu, setMenu] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const moreRef = useRef<HTMLButtonElement>(null);

  const showSave = Boolean(sessionTelegramId) && !expired;
  const canOtherFormat = formats.length > 1;
  const busyDl = rowBusy(singleState);
  // The one-format button counts seconds while the server prepares.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (singleState.s !== "preparing") return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [singleState.s]);
  const dlLabel = single ? singleLabel(singleState, now) : "Yuklab olish";

  const onDownloadClick = () => {
    if (single) void downloads.tap(formats[0].id);
    else setSheet("download");
  };

  const pick = (id: DownloadFormatId) => {
    const f = formats.find((x) => x.id === id);
    if (!f) return;
    if (sheet === "share") void share.run(f);
    else if (sheet === "save") void save.run(id);
  };

  const btn =
    "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg text-sm font-medium disabled:opacity-70 md:h-9 md:pointer-coarse:h-11";

  return (
    <nav
      className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 group-data-[compact=1]/hdr:flex-nowrap group-data-[compact=1]/hdr:py-1 sm:px-4"
      data-result-nav
    >
      {lead}
      {editActions ? <div className="order-3 flex shrink-0 items-center">{editActions}</div> : null}

      {!expired ? (
        <div
          className="order-5 flex w-full basis-full items-center gap-1.5 group-data-[compact=1]/hdr:order-4 group-data-[compact=1]/hdr:w-auto group-data-[compact=1]/hdr:basis-auto md:order-4 md:w-auto md:basis-auto md:gap-2"
          data-result-actions
        >
          <button
            ref={dlRef}
            type="button"
            data-download-button
            data-file-stale={fileStale ? "1" : undefined}
            data-row-state={single ? singleState.s : undefined}
            aria-haspopup={single ? undefined : "dialog"}
            aria-expanded={single ? undefined : sheet === "download"}
            aria-busy={busyDl || undefined}
            disabled={busyDl || !gen.hasFile}
            title={fileStale ? "Fayl oxirgi tahrirlar bilan yangilanib yuklanadi" : undefined}
            onPointerDown={() => markGesture()}
            onClick={onDownloadClick}
            className={cn(
              btn,
              "bg-primary text-primary-foreground min-w-11 flex-[1.4] px-2.5 md:flex-none md:px-3",
              "group-data-[compact=1]/hdr:flex-none group-data-[compact=1]/hdr:px-0 group-data-[compact=1]/hdr:w-11",
              singleState.s === "ready" && "ring-primary/50 ring-2 ring-offset-1",
            )}
          >
            {busyDl ? <Loader2 className="size-4 shrink-0 animate-spin" /> : singleState.s === "done" ? <Check className="size-4 shrink-0" /> : <Download className="size-4 shrink-0" />}
            <span className="truncate group-data-[compact=1]/hdr:sr-only">{dlLabel}</span>
            {!single ? <ChevronDown className="hidden size-4 shrink-0 opacity-80 group-data-[compact=1]/hdr:hidden md:inline" aria-hidden /> : null}
            {single && singleState.s === "idle" ? (
              <span className="text-primary-foreground/80 hidden text-xs md:inline">{formats[0].ext.toUpperCase()}</span>
            ) : null}
          </button>
          <ShareButton action={share} format={shareFormat} className="flex-1 group-data-[compact=1]/hdr:hidden md:flex-none" />
          <SaveToBotButton action={save} visible={showSave} className="flex-1 group-data-[compact=1]/hdr:hidden md:flex-none" />
        </div>
      ) : null}

      <div className="order-4 flex shrink-0 items-center group-data-[compact=1]/hdr:order-5 md:order-5">
        {del.armed ? (
          <button
            type="button"
            data-delete-confirm
            disabled={deleting}
            onClick={(e) => del.trigger(e)}
            className={cn(btn, "bg-destructive text-destructive-foreground px-3")}
          >
            <Trash2 className="size-4" />
            Rostdan?
          </button>
        ) : (
          <button
            ref={moreRef}
            type="button"
            data-more-button
            aria-label="Boshqa amallar"
            title="Boshqa amallar"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
            className="text-muted-foreground hover:bg-muted flex size-11 shrink-0 items-center justify-center rounded-full md:size-9 md:pointer-coarse:size-11"
          >
            <MoreHorizontal className="size-5" />
          </button>
        )}
      </div>

      <OverflowMenu
        open={menu}
        onClose={closeMenu}
        anchor={moreRef}
        items={[
          ...(!expired && canOtherFormat
            ? [
                { id: "share-other", label: "Boshqa formatda ulashish…", icon: <Share2 className="size-4" />, onSelect: () => setSheet("share") },
                ...(showSave
                  ? [{ id: "save-other", label: "Boshqa formatda saqlash…", icon: <Send className="size-4" />, onSelect: () => setSheet("save") }]
                  : []),
              ]
            : []),
          {
            id: "delete",
            label: "O’chirish",
            icon: <Trash2 className="size-4" />,
            destructive: true,
            // Arms the two-step delete; the confirm button replaces «⋯» in the header (the menu's history entry is gone by then).
            onSelect: () => del.trigger(),
          },
        ]}
      />

      <DownloadSheet
        open={sheet !== null}
        onClose={closeSheet}
        mode={sheet ?? "download"}
        formats={formats}
        downloads={downloads}
        anchorRef={dlRef}
        sizes={downloads.sizes}
        onPick={pick}
      />

      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </nav>
  );
}

/** One-format header button label from the row state. */
function singleLabel(s: RowState, now: number): string {
  switch (s.s) {
    case "preparing":
      return `${DELIVER_TEXT.preparing.replace("…", "")} ${elapsedSeconds(s.since, now)} s`;
    case "delivering": {
      if (s.via === "telegram") return "Telegram…";
      const pct = rowPercent(s);
      return pct === null ? "Yuklanmoqda…" : `${pct}%`;
    }
    case "ready":
      return DELIVER_TEXT.tapButton;
    case "done":
      return DELIVER_TEXT.saved;
    default:
      return "Yuklab olish";
  }
}

type MenuItem = { id: string; label: string; icon: ReactNode; destructive?: boolean; onSelect: () => void };

/** «⋯» menu: `useDialog` (Escape, focus trap, phone back closes it). Portaled for the same reason as the sheet. */
function OverflowMenu({ open, onClose, anchor, items }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; items: MenuItem[] }) {
  const ref = useDialog(open, onClose);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 64, right: 12 });
  useEffect(() => {
    if (!open) return;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) });
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [open, anchor, ref]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="no-print fixed inset-0 z-[60]" aria-hidden onClick={onClose} data-menu-backdrop />
      <div
        ref={ref}
        role="menu"
        aria-label="Boshqa amallar"
        data-result-menu
        className="no-print bg-background fixed z-[61] w-[min(280px,calc(100vw-16px))] rounded-xl border p-1 shadow-2xl"
        style={{ top: pos.top, right: pos.right }}
      >
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            role="menuitem"
            data-menu-item={it.id}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cn(
              "hover:bg-muted flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm",
              it.destructive && "text-destructive",
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

function Toast({ toast, onClose }: { toast: ActionToast; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      data-result-toast={toast.tone}
      className={cn(
        "no-print fixed inset-x-3 z-[70] mx-auto flex max-w-md items-center gap-2 rounded-xl border px-3 py-2 text-sm shadow-xl",
        toast.tone === "error"
          ? "border-destructive/40 bg-background text-destructive"
          : toast.tone === "ok"
            ? "border-emerald-500/40 bg-background text-emerald-800 dark:text-emerald-300"
            : "bg-background",
      )}
      style={{ bottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
    >
      <p className="min-w-0 flex-1">{toast.text}</p>
      {toast.link ? (
        <a
          href={toast.link.href}
          target="_blank"
          rel="noopener noreferrer"
          data-toast-link
          onClick={(e) => {
            e.preventDefault();
            openBotLink(toast.link!.href);
          }}
          className="text-primary inline-flex h-11 shrink-0 items-center px-2 font-medium"
        >
          {toast.link.label}
        </a>
      ) : null}
      <button type="button" aria-label="Yopish" onClick={onClose} className="text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-full">
        <X className="size-4" />
      </button>
    </div>,
    document.body,
  );
}
