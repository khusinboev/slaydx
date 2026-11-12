"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Redo2, Undo2 } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import type { TitulOp } from "@/lib/generation/title-page/edit";
import { planTitlePage } from "@/lib/generation/title-page/layout";
import { A4 } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import { useTitulEdit } from "../files/useTitulEdit";
import type { EditActionsState } from "../files/EditActions";
import { announceOpenField, focusAtEnd, isTapEcho, readText, releaseOpenField, swallowTapMouseDown } from "./editable";
import { createDoubleTapDetector } from "./slide-edit/doubleTap";
import { EditDoneBar } from "./EditDoneBar";
import { PageRow, Workspace, ZoomFrame } from "./sheet";
import { TOUCH_BOX, ViewerToolbar } from "./toolbar";
import { useFitZoom } from "./useFitZoom";
import { TitulPage } from "./titul/TitulPage";

/**
 * «Titul» viewer — one A4 sheet from `planTitlePage` (the DOCX draws the same
 * plan). «Tahrirlash» turns on in-place editing: a double click / double tap
 * on any text opens it (contentEditable on the run itself, so the page never
 * reflows into a form); Enter or leaving the field keeps the text, Esc cancels.
 * Each change is one `{ op: "text" }` in the `useDocEdit` queue; «Saqlash» in
 * the page header sends it and the server rebuilds the DOCX from the same plan.
 */
export function TitulViewer({
  doc,
  gen,
  onGen,
  onEditState,
  initialEdit = false,
}: {
  doc: AcademicDoc;
  gen?: unknown;
  onGen?: (g: unknown) => void;
  onEditState?: (s: EditActionsState | null) => void;
  /** `/uz/files/<id>?edit=1` (the bot's «Tahrirlash» button): start with editing on, as the other viewers do. */
  initialEdit?: boolean;
}) {
  const ed = useTitulEdit({ gen, onGen });
  const docNow = ed.doc ?? doc;
  const plan = useMemo(() => (docNow.titul ? planTitlePage(docNow.titul) : null), [docNow]);

  const workRef = useRef<HTMLDivElement>(null);
  const { zoom, setZoom, fit, wide } = useFitZoom(workRef, A4.wPx);
  const [editOn, setEditOn] = useState(initialEdit);
  const editable = ed.editable && !ed.legacy;
  const editing = editOn && editable;
  const coarse = useCoarsePointer();

  const { run, undo, redo, save, pending, discard, saving, saveFailed, justSaved } = ed;
  const runOps = useCallback((ops: TitulOp[]) => void run(ops), [run]);

  const onEditStateRef = useRef(onEditState);
  onEditStateRef.current = onEditState;
  useEffect(() => {
    onEditStateRef.current?.(editable ? { pending, saving, saveFailed, justSaved, save, discard } : null);
  }, [editable, pending, saving, saveFailed, justSaved, save, discard]);
  useEffect(() => () => onEditStateRef.current?.(null), []);

  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S while editing. */
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        if (pending > 0) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo, redo, save, pending]);

  if (!plan) return <p className="p-6 text-center text-[14px]">Titul ma’lumoti topilmadi.</p>;

  const editButton = editable ? (
    <button
      type="button"
      aria-pressed={editing}
      className={cn("rounded px-2 py-1 text-[12px]", TOUCH_BOX, editing ? "bg-sky-500 text-white" : "hover:bg-white/10")}
      onClick={() => setEditOn((v) => !v)}
    >
      {coarse ? <Pencil className="size-4 shrink-0" aria-hidden /> : null}
      <span className={coarse ? "@max-sm:sr-only" : undefined}>Tahrirlash</span>
    </button>
  ) : null;
  const right = editable ? (
    <>
      <button type="button" aria-label="Bekor qilish" title="Bekor qilish (Ctrl+Z)" className={cn("rounded p-1.5 hover:bg-white/10 disabled:opacity-30", TOUCH_BOX)} disabled={!ed.canUndo} onClick={undo}>
        <Undo2 className="size-4" />
      </button>
      <button type="button" aria-label="Qaytarish" title="Qaytarish (Ctrl+Shift+Z)" className={cn("rounded p-1.5 hover:bg-white/10 disabled:opacity-30", TOUCH_BOX)} disabled={!ed.canRedo} onClick={redo}>
        <Redo2 className="size-4" />
      </button>
      {coarse ? null : editButton}
    </>
  ) : null;

  return (
    <div className="flex grow flex-col" data-viewer-root="titul">
      <ViewerToolbar sticky zoom={zoom} onZoom={setZoom} page={1} pages={1} onPage={() => {}} onFit={fit} right={right} pinned={coarse ? editButton : undefined} />
      {editing ? <p className="no-print bg-sky-900/80 px-3 py-1.5 text-[12px] text-white" data-titul-hint>Matnni o‘zgartirish uchun ustiga ikki marta bosing. Enter — saqlash, Esc — bekor qilish.</p> : null}
      {ed.error ? (
        <div className="no-print flex items-center gap-2 bg-rose-900/80 px-3 py-1.5 text-[12px] text-white">
          <span className="flex-1">{ed.error}</span>
          <button type="button" className="underline" onClick={ed.clearError}>
            Yopish
          </button>
        </div>
      ) : null}
      <Workspace ref={workRef} className="grow">
        <div className="flex flex-col items-center">
          <PageRow wide={wide}>
            <ZoomFrame zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              {editing ? <TitulEditor onOps={runOps}>{<TitulPage plan={plan} />}</TitulEditor> : <TitulPage plan={plan} />}
            </ZoomFrame>
          </PageRow>
        </div>
      </Workspace>
      {editing ? <EditDoneBar revealKey={zoom} /> : null}
    </div>
  );
}

/**
 * Edit layer: the run under a double click / tap becomes contentEditable in
 * place (same pattern and helpers as `ResumeEditor`). React does not touch the
 * open run; the committed op re-renders the whole sheet from the new plan.
 */
export function TitulEditor({ onOps, children }: { onOps: (ops: TitulOp[]) => void; children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<{ el: HTMLElement; id: string; initial: string } | null>(null);
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;

  const close = useCallback((el: HTMLElement) => {
    // Clear first: removing contenteditable blurs and fires focusout synchronously.
    openRef.current = null;
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-titul-editing");
    releaseOpenField(el);
  }, []);

  const commit = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    const value = readText(cur.el).replace(/\s+/g, " ").trim();
    close(cur.el);
    if (value === cur.initial.trim()) return;
    onOpsRef.current([{ op: "text", id: cur.id, value }]);
  }, [close]);

  const cancel = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    cur.el.textContent = cur.initial;
    close(cur.el);
  }, [close]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const open = useCallback((el: HTMLElement) => {
    const id = el.getAttribute("data-path");
    if (!id || openRef.current?.el === el) return;
    if (openRef.current) commitRef.current();
    openRef.current = { el, id, initial: readText(el) };
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-titul-editing", "1");
    focusAtEnd(el);
    announceOpenField({ el, commit: () => commitRef.current(), cancel: () => cancelRef.current() });
  }, []);

  useEffect(() => {
    const host = rootRef.current;
    if (!host) return;
    const onDbl = (ev: Event) => {
      if (ev.type === "dblclick" && isTapEcho()) {
        ev.preventDefault();
        return;
      }
      const target = (ev.target as HTMLElement | null)?.closest?.("[data-path]") as HTMLElement | null;
      if (!target || !host.contains(target)) return;
      ev.preventDefault();
      open(target);
    };
    const taps = createDoubleTapDetector();
    const onPointerDown = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") taps.down(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp);
    };
    const onPointerUp = (ev: PointerEvent) => {
      if (ev.pointerType === "mouse" || !taps.up(ev.pointerId, ev.clientX, ev.clientY, ev.timeStamp)) return;
      const before = openRef.current?.el ?? null;
      onDbl(ev);
      if (openRef.current && openRef.current.el !== before) swallowTapMouseDown();
    };
    const onPointerCancel = (ev: PointerEvent) => taps.cancel(ev.pointerId);
    const onKey = (ev: KeyboardEvent) => {
      if (!openRef.current) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancelRef.current();
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        commitRef.current();
      }
    };
    const onFocusOut = (ev: FocusEvent) => {
      if (openRef.current && ev.target === openRef.current.el) commitRef.current();
    };
    host.addEventListener("dblclick", onDbl);
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerCancel);
    host.addEventListener("keydown", onKey);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      host.removeEventListener("dblclick", onDbl);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerCancel);
      host.removeEventListener("keydown", onKey);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  useEffect(
    () => () => {
      const cur = openRef.current;
      if (!cur) return;
      openRef.current = null;
      releaseOpenField(cur.el);
    },
    [],
  );

  return (
    <div ref={rootRef} data-titul-editor className="[&_[data-path]]:cursor-text [&_[data-path]:hover]:outline [&_[data-path]:hover]:outline-1 [&_[data-path]:hover]:outline-sky-400/70">
      {children}
    </div>
  );
}
