"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Redo2, Trash2, Undo2 } from "lucide-react";
import type { AcademicDoc } from "@/lib/generation/types";
import type { ResumeOp } from "@/lib/generation/resume/edit";
import { planResume, type ResumeItem, type ResumeLayout } from "@/lib/generation/resume/layout";
import { legacyResumeModel } from "@/lib/generation/resume/model";
import {
  RESUME_PALETTES,
  RESUME_PALETTE_IDS,
  RESUME_TEMPLATES,
  RESUME_TEMPLATE_IDS,
  isResumePaletteId,
  isResumeTemplateId,
} from "@/lib/generation/resume/templates";
import { A4, resumeMainHeightPx, resumeMainPadMm } from "@/lib/viewers/metrics";
import { type TextSplitter } from "@/lib/viewers/split";
import { cn } from "@/lib/cn";
import { useResumeEdit } from "../files/useResumeEdit";
import type { EditActionsState } from "../files/EditActions";
import { useMeasuredPages } from "./measure";
import { ZoomFrame, Workspace } from "./sheet";
import { ViewerToolbar } from "./toolbar";
import { useVisiblePage } from "./useVisiblePage";
import { ResumeItemView, ResumePage } from "./resume/ResumePage";
import { ResumeEditor } from "./resume/ResumeEditor";

/**
 * Rezyume ko'ruvchisi (Rezyume 2, AUDIT-15) — `SlideViewer` bilan bir
 * xil imzo: `{ doc, gen, onGen, onEditState }`.
 *
 * VARAQNI o'zi chizmaydi: hamma narsa `planResume` → `ResumePage`.
 * Shu tufayli ekrandagi rezyume DOCX bilan bir xil bo'ladi va shablon/
 * palitra almashsa ikkalasi ham birdaniga o'zgaradi.
 *
 * Sahifalash `main` zonasi itemlari ustida (`useMeasuredPages`), `aside`
 * va bosh qism esa faqat BIRINCHI varaqda — Word jadval qatorini
 * bo'lganda panel foni davom etadi, matni takrorlanmaydi.
 *
 * Tahrir tugmasi bor (slayddan farqi): rezyumeda matn zich va ikki
 * bosish tasodifan tez-tez tushadi, shuning uchun rejim ANIQ yoqiladi.
 */

/* Uzun blok ham Word kabi qator orasidan bo'linadi. */
const RESUME_SPLITTER: TextSplitter<ResumeItem> = {
  takeText: (it) => (it.k === "p" || it.k === "li" ? it.text : null),
  makePart: (it, part) => ({ ...it, text: part }),
};

function mainItemsOf(layout: ResumeLayout): ResumeItem[] {
  return layout.zones.find((z) => z.id === "main")?.items ?? [];
}

export function ResumeViewer({
  doc,
  gen,
  onGen,
  onEditState,
}: {
  doc: AcademicDoc;
  /** Tayyor generatsiya (`api.GenerationDetail`) — TAHRIR shu bilan yoqiladi. */
  gen?: unknown;
  /** Tahrirdan keyin yangilangan generatsiya — sahifa holatiga qaytariladi. */
  onGen?: (g: unknown) => void;
  /** Tahrir holati sahifa sarlavhasidagi `EditActions` ga; `null` — tahrir yo'q. */
  onEditState?: (s: EditActionsState | null) => void;
}) {
  const ed = useResumeEdit({ gen, onGen });
  const docNow = ed.doc ?? doc;
  const model = useMemo(() => docNow.resume ?? legacyResumeModel(docNow), [docNow]);
  const layout = useMemo(() => planResume(model), [model]);

  const [zoom, setZoom] = useState(100);
  const [editOn, setEditOn] = useState(false);
  const editable = ed.editable && !ed.legacy;
  const editing = editOn && editable;

  const items = useMemo(() => mainItemsOf(layout), [layout]);
  const pad = resumeMainPadMm(layout.template, 0);
  const measureWidthMm = Math.max(60, layout.mainWidthMm - pad.x * 2);

  const { pages: measured, measureNode } = useMeasuredPages(
    items,
    (it) => (
      <div
        style={{
          width: `${measureWidthMm}mm`,
          fontFamily: layout.template.type.font,
          fontSize: `${layout.template.type.body}pt`,
          lineHeight: layout.template.type.line,
        }}
      >
        <ResumeItemView layout={layout} item={it} />
      </div>
    ),
    {
      /*
       * Chegara BIRINCHI varaqniki: bannerli maketda u eng qisqasi,
       * ya'ni keyingi varaqlar ozgina bo'sh qoladi — matn kesilgandan
       * ko'ra bu xavfsizroq.
       */
      limit: resumeMainHeightPx(layout.template, 0),
      key: `${model.template}|${model.palette}|${items.map((it) => `${it.k}:${itemText(it).length}`).join("|")}`,
      split: RESUME_SPLITTER,
    },
  );
  const pages = measured?.length ? measured : [items];
  const total = pages.length;

  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useVisiblePage(scrollRef, () => refs.current, [total, zoom]);

  const go = useCallback(
    (n: number) => {
      const next = Math.max(1, Math.min(total, n));
      setPage(next);
      refs.current[next - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [total, setPage],
  );

  const { run, undo, redo, save, pending, discard, saving, justSaved } = ed;
  const runOps = useCallback((ops: ResumeOp[]) => void run(ops), [run]);

  /* ═══ surat ═══ */
  const fileRef = useRef<HTMLInputElement>(null);
  const pickPhoto = useCallback(() => fileRef.current?.click(), []);
  // Suratsiz shablonda (`photo: null`) yuklash tugmasi umuman chiqmaydi;
  // shakl faqat suratli shablon uchun kerak — standart doira.
  const photoShape = layout.template.photo?.shape ?? "circle";
  const onPhotoFile = useCallback(
    async (file: File) => {
      await ed.uploadPhoto({ file, shape: photoShape });
    },
    [ed, photoShape],
  );

  /*
   * Tahrir holati SAHIFAGA (`EditActions`). Ref orqali — har renderda
   * yangi callback berilsa ham effekt qayta ishlamasin.
   */
  const onEditStateRef = useRef(onEditState);
  onEditStateRef.current = onEditState;
  useEffect(() => {
    onEditStateRef.current?.(editable ? { pending, saving, justSaved, save, discard } : null);
  }, [editable, pending, saving, justSaved, save, discard]);
  useEffect(() => () => onEditStateRef.current?.(null), []);

  /* Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y / Ctrl+S. */
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

  const right = editable ? (
    <>
      <select
        aria-label="Shablon"
        title="Shablon"
        className="rounded bg-white/10 px-1.5 py-1 text-[12px] text-white outline-none"
        value={model.template}
        onChange={(e) => {
          const v = e.target.value;
          if (isResumeTemplateId(v) && v !== model.template) runOps([{ op: "template", template: v }]);
        }}
      >
        {RESUME_TEMPLATE_IDS.map((id) => (
          <option key={id} value={id} className="text-black">
            {RESUME_TEMPLATES[id].title}
          </option>
        ))}
      </select>
      <select
        aria-label="Rang"
        title="Rang"
        className="rounded bg-white/10 px-1.5 py-1 text-[12px] text-white outline-none"
        value={model.palette}
        onChange={(e) => {
          const v = e.target.value;
          if (isResumePaletteId(v) && v !== model.palette) runOps([{ op: "palette", palette: v }]);
        }}
      >
        {RESUME_PALETTE_IDS.map((id) => (
          <option key={id} value={id} className="text-black">
            {RESUME_PALETTES[id].title}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="Rasm yuklash"
        title="Rasm yuklash"
        className="hover:bg-white/10 rounded p-1.5 disabled:opacity-40"
        disabled={saving}
        onClick={pickPhoto}
      >
        <ImagePlus className="size-4" />
      </button>
      {model.photo ? (
        <button
          type="button"
          aria-label="Rasmni olib tashlash"
          title="Rasmni olib tashlash"
          className="hover:bg-white/10 rounded p-1.5 disabled:opacity-40"
          disabled={saving}
          onClick={() => void ed.removePhoto()}
        >
          <Trash2 className="size-4" />
        </button>
      ) : null}
      <span className="mx-1 h-4 w-px bg-white/20" />
      <button
        type="button"
        aria-label="Bekor qilish"
        title="Bekor qilish (Ctrl+Z)"
        className="hover:bg-white/10 rounded p-1.5 disabled:opacity-30"
        disabled={!ed.canUndo}
        onClick={undo}
      >
        <Undo2 className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Qaytarish"
        title="Qaytarish (Ctrl+Shift+Z)"
        className="hover:bg-white/10 rounded p-1.5 disabled:opacity-30"
        disabled={!ed.canRedo}
        onClick={redo}
      >
        <Redo2 className="size-4" />
      </button>
      <button
        type="button"
        aria-pressed={editing}
        className={cn("rounded px-2 py-1 text-[12px]", editing ? "bg-sky-500 text-white" : "hover:bg-white/10")}
        onClick={() => setEditOn((v) => !v)}
      >
        Tahrirlash
      </button>
    </>
  ) : null;

  return (
    <div className="flex h-full min-h-[70vh] flex-col">
      <ViewerToolbar
        zoom={zoom}
        onZoom={setZoom}
        page={page}
        pages={total}
        onPage={go}
        onFit={() => setZoom(100)}
        right={right}
      />
      {ed.error ? (
        <div className="no-print bg-rose-900/80 flex items-center gap-2 px-3 py-1.5 text-[12px] text-white">
          <span className="flex-1">{ed.error}</span>
          <button type="button" className="underline" onClick={ed.clearError}>
            Yopish
          </button>
        </div>
      ) : null}
      <Workspace ref={scrollRef}>
        <div className="flex flex-col items-center gap-8">
          {pages.map((chunk, i) => (
            <ZoomFrame key={i} zoom={zoom / 100} width={A4.wPx} height={A4.hPx}>
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
              >
                {editing ? (
                  <ResumeEditor
                    layout={layout}
                    model={model}
                    pageItems={chunk}
                    pageIndex={i}
                    total={total}
                    onOps={runOps}
                    onPhoto={pickPhoto}
                  />
                ) : (
                  <ResumePage layout={layout} pageItems={chunk} pageIndex={i} total={total} />
                )}
              </div>
            </ZoomFrame>
          ))}
        </div>
      </Workspace>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          // Bir xil faylni qayta tanlash ham hodisa bersin.
          e.target.value = "";
          if (f) void onPhotoFile(f);
        }}
      />
      {measureNode}
    </div>
  );
}

/** Sahifalash kaliti uchun — item matnining uzunligi o'zgarsa qayta o'lchanadi. */
function itemText(it: ResumeItem): string {
  switch (it.k) {
    case "p":
    case "li":
    case "h2":
    case "name":
    case "headline":
      return it.text;
    case "row":
      return `${it.title}${it.sub}${it.period}`;
    case "kv":
      return `${it.key}${it.val}`;
    case "chips":
      return it.items.map((c) => c.text).join("");
    case "contact":
      return it.lines.map((l) => l.text).join("");
    default:
      return "";
  }
}
