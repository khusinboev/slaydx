"use client";

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { CustomTemplate } from "@/lib/generation/pptx-template";
import { Check, ImagePlus, RotateCcw, XCircle } from "lucide-react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideSrc, SlideTheme } from "@/lib/generation/slide-types";
import { FONT_MAX, FONT_MIN, listCap, readSlideField, type ListField } from "@/lib/generation/slide-edit";
import { isSlideFontId, type SlideFontId } from "@/lib/generation/slide-fonts";
import { QUIZ_LETTERS } from "@/lib/generation/slide-quiz";
import { SLIDE } from "@/lib/viewers/metrics";
import { cn } from "@/lib/cn";
import {
  LOGO_BOX,
  boxStyle,
  layerKey,
  photoSlot,
  planSlide,
  ptToPx,
} from "@/lib/generation/slide-layout";
import { textLayerStyle, type TextLayer } from "./SlideCanvas";
import { focusAtEnd, insertAtCaret, readItems, readText } from "./editable";
import { useCoarsePointer } from "@/lib/hooks/useCoarsePointer";
import type { VisualViewportState } from "@/lib/hooks/useVisualViewport";
import { useOverlayHistory } from "../nav/useOverlayHistory";
import { SlideEditFloatingPanel, SlideEditStyleBar, keepEditorFocus } from "./slide-edit/StyleBar";
import { SlideEditFontSheet } from "./slide-edit/FontSheet";
import { TAP_MAX_MS, TAP_SLOP_PX, createDoubleTapDetector } from "./slide-edit/doubleTap";
import { placeFloatingPanel, type FocusBox } from "./slide-edit/geometry";
import { VisualViewportWatch, scrollEditBoxIntoView } from "./slide-edit/viewport";

/*
 * `readText`/`readItems`/`insertAtCaret` `editable.ts` ga ko'chdi
 * (Rezyume 2, AUDIT-15) — rezyume muharriri ham AYNAN shu funksiyalarni
 * ishlatadi, ya'ni Enter/Esc/blur ikkala muharrirda bir xil. Eski import
 * yo'llari buzilmasin deb qayta eksport qilinadi.
 */
export { readItems, readText } from "./editable";

/**
 * Tahrir QATLAMI — `SlideStage` ning `overlay` slotida (Muharrir 2).
 *
 * WYSIWYG: ikki bosilgan matn SLAYDNING O'ZIDA tahrirlanadi. Buning
 * uchun overlay ichida sahna bilan BIR XIL masshtabli «egizak» konteyner
 * bor (`transform: scale(scale)`), tahrir maydoni esa qatlamning aynan
 * o'z qutisida, `textLayerStyle` — `SlideCanvas` bilan bitta funksiya —
 * bilan chiziladi: shrift, o'lcham, rang, tekislash, harf oralig'i,
 * uppercase hammasi qatlamniki. Oq quti YO'Q, faqat yupqa ko'k ramka.
 * Asl qatlam bu paytda sahnada yashirinadi (`onEditing` → `hideSrc`),
 * ikki matn ustma-ust tushmaydi.
 *
 * Maydon `contentEditable` (textarea emas): matn qatlam bilan bir xil
 * oqadi, ro'yxat esa `<ul>` ichida `<li>` lar bo'lib — Enter brauzerda
 * yangi `<li>` (yangi band) yaratadi, bo'sh bandda Backspace uni o'chiradi,
 * xuddi PowerPoint qutisi. Ro'yxat BUTUNICHA saqlanadi (`onList`, bitta
 * `list` op), bitta matn `onText`/`onFooter`.
 *
 * Maydon boshqarilmaydi (uncontrolled): React `initial` ni bir marta
 * chizadi, keyin faqat DOM dan o'qiydi (`readText`/`readItems`) —
 * boshqariladigan contentEditable da kursor har harfda sakraydi.
 *
 * SHRIFT PANELI — maydon ustidagi suzuvchi qatorcha (masshtabsiz, o'qish
 * uchun): «−»/«+», tayyor o'lchamlar, «Standart» va shrift OILASI
 * (`SLIDE_FONTS`). Tanlov DARHOL `{op:"style"}` bo'lib ketadi
 * (optimistik) — matn hali yozilayotgan bo'lsa ham maydon yangi
 * shrift/o'lchamda ko'rinadi.
 *
 * Hodisa ushlash: overlay o'zi `pointer-events-none` — ikki bosish
 * ostidagi `SlideCanvas` elementiga tegadi va SAHNA ramkasiga
 * ko'tariladi; biz shu ramkada tinglaymiz va `closest("[data-src]")`
 * bilan manbani topamiz.
 *
 * PHONE (mobile sprint, docs/mobile/PLAN.md §3 O4, R3 S1): with a coarse
 * pointer or < 768 px the floating panel is replaced by a 44 px style bar
 * portalled into the slide toolbar's slot (`editBarSlot`, in-flow above the
 * stage — it can never cover the slide), with «Tayyor» (commit) and «✕»
 * (cancel); font family and size presets open as a chip sheet in-flow above
 * the bar. A text also opens on a pointer double tap (`doubleTap.ts`), and
 * while it is edited the box is kept inside the visible part of the stage
 * (keyboard, `scrollEditBoxIntoView`). Phone back closes the sheet first,
 * then ends the edit (commit — the same «auto-save, then leave» rule as the
 * page, docs/nav/PLAN.md decision 1).
 */

export type StylePatch = { size?: number | null; font?: SlideFontId | null };

export type SlideEditorProps = {
  slide: SlideModel;
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  bodyType: BodyRules;
  logo?: string;
  custom?: CustomTemplate;
  index: number;
  total: number;
  /** Sahna masshtabi (`SlideStageOverlayCtx.scale`). */
  scale: number;
  /** Rasm so'rovi ketayotgan bo'lsa tugmalar o'chadi. */
  busy?: boolean;
  onText: (src: SlideSrc, value: string) => void;
  /** Ro'yxat butunicha (`bullets`/`left`/`right`) — bitta `list` op. */
  onList: (field: ListField, items: string[]) => void;
  /**
   * Kolontitul — DEKA darajasida (`{op:"footer"}`), shuning uchun
   * `onText` dan ALOHIDA: `writeSlideField` `footer` ni ataylab rad
   * etadi (bitta slaydga yozilsa deka ikkiga bo'linardi).
   */
  onFooter: (value: string) => void;
  /** Test kaliti: `{op:"answer", q, answer}` — javoblar slaydi ham qayta yig'iladi. */
  onAnswer: (q: number, answer: number) => void;
  /** Shrift o'lchami va/yoki oilasi: `null` — «Standart» (model qiymatini o'chiradi). */
  onStyle: (src: SlideSrc, patch: StylePatch) => void;
  onImage: (url: null) => void;
  /** «Rasmni qaytarish» — asl AI rasm (`imageOrig`). */
  onRestoreImage: () => void;
  onUpload: (file: File) => void;
  /**
   * Tahrir ochilganda qatlam kaliti (`layerKey`), yopilganda `null` — sahna
   * o'sha qatlamni yashiradi. `box` — qatlam qutisi slayd px da (phone focus
   * zoom uses it, `SlideStage.focus`).
   */
  onEditing?: (key: string | null, box?: FocusBox | null) => void;
  /**
   * Phone only: the toolbar slot the style bar is portalled into
   * (`SlideToolbar.editBar`). Without it (desktop, or before the slot
   * mounts) no phone bar is drawn.
   */
  editBarSlot?: HTMLElement | null;
  /**
   * Explicit edit mode (owner request 2026-11-12, `SlideViewer` «Tahrirlash»).
   *
   * - `true`: every editable box gets a dashed outline + tint, the image and
   *   answer controls show, and a SINGLE click / tap opens a text.
   * - `false` (default): a clean viewer — no outlines or controls, a single
   *   click/tap does nothing; a double click / double tap is the shortcut
   *   that calls `onEnterEdit` and opens that text at once.
   *
   * Turning it off while a text is open commits the text.
   */
  editMode?: boolean;
  /** View-mode shortcut (double click / double tap on a text) asks the viewer to enter edit mode. */
  onEnterEdit?: () => void;
};

/** Mobile UI parts that belong to the edit (a press there is not "outside"). */
const EDIT_UI = "[data-slide-edit-box], [data-slide-font-panel], [data-slide-edit-ui]";

/** Ko'p qatorli tahrirga ruxsat etilgan maydonlar (Shift+Enter → yangi qator). */
function isMultiline(src: SlideSrc): boolean {
  if (src.f === "subtitle" || src.f === "quote") return true;
  return src.f === "steps" && src.k === "text";
}

function listFieldOf(src: SlideSrc | undefined): ListField | null {
  if (!src) return null;
  return src.f === "bullets" || src.f === "left" || src.f === "right" ? src.f : null;
}

type EditState =
  | { kind: "text"; key: string; src: SlideSrc; initial: string; multiline: boolean }
  | { kind: "list"; key: string; field: ListField; initial: string[] };

/**
 * Panelda taklif qilinadigan o'lchamlar (pt) — `slide-edit/StyleBar.tsx`
 * da (desktop panel and phone sheet share them); re-exported here for the
 * old import path.
 */
export { FONT_PRESETS } from "./slide-edit/StyleBar";

/** After a touch double tap opened a text, its compat mouse events are ignored this long (ms). */
const TAP_SWALLOW_MS = 600;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}


type FieldHandlers = {
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
  onBlur: (e: { relatedTarget: EventTarget | null; currentTarget?: EventTarget | null }) => void;
};

/**
 * The contentEditable itself. Memoised on the edit session and the list
 * styling only: a stage scale change (phone focus zoom, keyboard) or the
 * style bar re-renders the twin container around it, never this node — the
 * field is uncontrolled, and a re-render must not move the caret.
 */
const EditField = memo(
  function EditField({
    edit,
    bullets,
    paraSpacePx,
    inputRef,
    handlers,
  }: {
    edit: EditState;
    bullets: boolean;
    paraSpacePx: number;
    inputRef: MutableRefObject<HTMLElement | null>;
    handlers: FieldHandlers;
  }) {
    const setRef = (el: HTMLElement | null) => {
      inputRef.current = el;
    };
    if (edit.kind === "text") {
      return (
        <div
          ref={setRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline={edit.multiline}
          aria-label="Matnni tahrirlash"
          data-slide-edit-input
          data-edit-key={edit.key}
          style={{ width: "100%", minHeight: "1em", outline: "none" }}
          onKeyDown={handlers.onKeyDown}
          onPaste={handlers.onPaste}
          onBlur={handlers.onBlur}
        >
          {edit.initial}
        </div>
      );
    }
    return (
      <ul
        ref={setRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Matnni tahrirlash"
        data-slide-edit-input
        data-edit-key={edit.key}
        className={bullets ? "w-full list-disc pl-[1.15em]" : "w-full list-none"}
        style={{ margin: 0, paddingLeft: bullets ? "1.15em" : 0, outline: "none", minHeight: "1em" }}
        onKeyDown={handlers.onKeyDown}
        onPaste={handlers.onPaste}
        onBlur={handlers.onBlur}
      >
        {edit.initial.map((line, i) => (
          <li key={i} style={{ marginBottom: paraSpacePx }}>
            {line}
          </li>
        ))}
      </ul>
    );
  },
  (a, b) =>
    a.edit === b.edit && a.bullets === b.bullets && a.paraSpacePx === b.paraSpacePx && a.inputRef === b.inputRef && a.handlers === b.handlers,
);

/** `data-src` of the slide text under `target` (null when none or malformed). */
function srcAt(target: EventTarget | null): SlideSrc | null {
  const el = (target as HTMLElement | null)?.closest?.("[data-src]") as HTMLElement | null;
  const raw = el?.getAttribute("data-src");
  if (!raw) return null;
  try {
    const src = JSON.parse(raw) as SlideSrc;
    if (!src || typeof src !== "object" || typeof (src as { f?: unknown }).f !== "string") return null;
    return src;
  } catch {
    return null;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function SlideEditor({
  slide,
  theme,
  visual,
  audience,
  templateId,
  bodyType,
  logo,
  custom,
  index,
  total,
  scale,
  busy = false,
  onText,
  onList,
  onFooter,
  onAnswer,
  onStyle,
  onImage,
  onRestoreImage,
  onUpload,
  onEditing,
  editBarSlot,
  editMode = false,
  onEnterEdit,
}: SlideEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;
  // Esc dan keyin `blur` saqlab yubormasligi uchun bir martalik bayroq.
  const skipBlurRef = useRef(false);
  /** Phone: coarse pointer or < 768 px (bar instead of the floating panel). */
  const coarse = useCoarsePointer();
  /** Until when the compat mouse events of an opening double tap are ignored (`now()` ms). */
  const swallowUntilRef = useRef(0);
  /** Latest `commit` / `open` for callbacks and listeners bound once (no re-bind per slide edit). */
  const commitRef = useRef<() => void>(() => {});
  const openRef = useRef<(src: SlideSrc) => boolean>(() => false);

  const plan = useMemo(
    () => planSlide(slide, theme, visual, index, total, audience, templateId, { bodyType, logo, custom }),
    [slide, theme, visual, index, total, audience, templateId, bodyType, logo, custom],
  );

  /** Kalit bo'yicha qatlam — har renderda qayta topiladi (shrift o'zgarsa yangi qatlam keladi). */
  const layerByKey = useCallback(
    (key: string): TextLayer | null => {
      for (const l of plan.layers) {
        if (l.t === "text" && layerKey(l) === key) return l;
      }
      return null;
    },
    [plan.layers],
  );

  /** `src` ga mos qatlam kaliti — bitta maydon `src` da, band `srcLines` da. */
  const keyOf = useCallback(
    (src: SlideSrc): string | null => {
      const wanted = JSON.stringify(src);
      for (const l of plan.layers) {
        if (l.t !== "text") continue;
        if (l.src && JSON.stringify(l.src) === wanted) return layerKey(l);
        if (l.srcLines?.some((s) => s && JSON.stringify(s) === wanted)) return layerKey(l);
      }
      return null;
    },
    [plan.layers],
  );

  /** Opens `src`; `false` when the slide has no such text. */
  const open = useCallback(
    (src: SlideSrc): boolean => {
      const key = keyOf(src);
      const layer = key ? layerByKey(key) : null;
      if (!key || !layer) return false;
      // The same text again (a `dblclick` after the pointer detector already
      // opened it): keep the session — the typed text and the caret stay.
      if (editRef.current?.key === key) return true;
      // Another text is open: save it first. Never rely on the first tap's
      // compat `mousedown` (swallow window, pen, webviews that drop it).
      if (editRef.current) commitRef.current();
      const field = listFieldOf(layer.srcLines?.find(Boolean));
      const next: EditState =
        field && layer.srcLines && !layer.src
          ? { kind: "list", key, field, initial: (slide[field] ?? []).slice() }
          : { kind: "text", key, src, initial: readSlideField(slide, src) ?? "", multiline: isMultiline(src) };
      editRef.current = next;
      setEdit(next);
      const b = boxStyle(layer.box);
      onEditing?.(key, {
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        fontPx: ptToPx(layer.size),
        singleLine: next.kind === "text" && !next.multiline,
      });
      return true;
    },
    [keyOf, layerByKey, slide, onEditing],
  );

  /*
   * Maydon ochilganda fokus va kursor OXIRIDA — foydalanuvchi darhol
   * yozadi. Selection API bo'lmasa (eski muhit) fokusning o'zi yetadi.
   */
  useEffect(() => {
    const el = inputRef.current;
    if (!edit || !el) return;
    focusAtEnd(el);
  }, [edit]);

  const editLayer = edit ? layerByKey(edit.key) : null;

  /*
   * Shrift o'lchami/oilasi QATLAMGA tegishli, bitta bandga emas:
   * `applyFontOverrides` kalit sifatida `layerKey` (birinchi band) ni
   * o'qiydi. Panel buni ochiq aytadi («Barcha bandlar»).
   */
  const styleSrc: SlideSrc | null = editLayer ? (editLayer.src ?? editLayer.srcLines?.find(Boolean) ?? null) : null;
  const wholeList = Boolean(editLayer && !editLayer.src && editLayer.srcLines?.length);
  const curSize = editLayer ? Math.round(editLayer.size) : 0;
  const hasOverride = Boolean(edit && slide.fontSize?.[edit.key]);
  const curFontRaw = edit ? slide.font?.[edit.key] : undefined;
  const curFont: SlideFontId | "" = isSlideFontId(curFontRaw) ? curFontRaw : "";

  const setSize = useCallback(
    (size: number | null) => {
      if (styleSrc) onStyle(styleSrc, { size });
    },
    [styleSrc, onStyle],
  );
  const setFont = useCallback(
    (font: SlideFontId | null) => {
      if (styleSrc) onStyle(styleSrc, { font });
    },
    [styleSrc, onStyle],
  );

  const [sheetOpen, setSheetOpen] = useState(false);

  const commit = useCallback(() => {
    const e = editRef.current;
    const el = inputRef.current;
    // REF darhol bo'shatiladi: tashqariga bosish `mousedown` bilan
    // yopadi, keyin `blur` ham keladi — ikkinchisi bo'sh ref ko'rib
    // jim qaytadi, aks holda BIR tahrir ikki marta saqlanardi.
    editRef.current = null;
    setEdit(null);
    setSheetOpen(false);
    onEditing?.(null);
    if (!e || !el) return;
    if (e.kind === "text") {
      const value = readText(el);
      // O'zgarmagan matn uchun operatsiya YUBORILMAYDI — bo'sh PATCH
      // hujjat versiyasini oshirib, PPTX ni bekorga qayta yasatardi.
      if (value === e.initial) return;
      // Kolontitul bitta slaydniki emas — butun dekaniki.
      if (e.src.f === "footer") onFooter(value);
      else onText(e.src, value);
      return;
    }
    const items = readItems(el);
    if (sameList(items, e.initial)) return;
    onList(e.field, items);
  }, [onText, onFooter, onList, onEditing]);

  const cancel = useCallback(() => {
    skipBlurRef.current = true;
    editRef.current = null;
    setEdit(null);
    setSheetOpen(false);
    onEditing?.(null);
  }, [onEditing]);

  /*
   * Ochish — SAHNA ramkasida (overlay ning ota elementi). Aynan shu tugun
   * `SlideCanvas` ni ham, bizni ham o'z ichiga oladi. Tahrir maydonining
   * o'zida ikki bosish (so'z tanlash) `data-src` ga tegmaydi.
   *
   * Two ways in: `dblclick` (mouse, and touch where the browser synthesises
   * it) and a pointer double TAP (`doubleTap.ts`) for touch/pen, which does
   * not depend on the synthetic event (iOS WKWebView, Telegram). The tap path
   * renders synchronously and focuses inside the gesture (iOS raises the
   * keyboard only then), and cancels the second tap's `touchend` so its
   * compat `mousedown`/`click`/`dblclick` neither blur nor close the box.
   */
  const editModeRef = useRef(editMode);
  const enterRef = useRef(onEnterEdit);
  useLayoutEffect(() => {
    commitRef.current = commit;
    openRef.current = open;
    editModeRef.current = editMode;
    enterRef.current = onEnterEdit;
  });
  /** View mode: the shortcut gesture enters edit mode first, then opens the text (same commit). */
  const openFromGesture = useCallback((src: SlideSrc): boolean => {
    if (!editModeRef.current) enterRef.current?.();
    return openRef.current(src);
  }, []);
  // Bound once: slide edits (new `open`) must not rebuild the detector mid-gesture.
  useEffect(() => {
    const host = rootRef.current?.closest("[data-slide-frame]") ?? rootRef.current?.parentElement;
    if (!host) return;
    const onDbl = (ev: Event) => {
      const src = srcAt(ev.target);
      if (!src) return;
      ev.preventDefault();
      openFromGesture(src);
    };
    /*
     * Edit mode: a single click opens the text (mouse; a touch tap is opened
     * on `pointerup` below and its compat click then finds the same text
     * already open — `open` keeps the session).
     */
    const onClick = (ev: Event) => {
      if (!editModeRef.current) return;
      const src = srcAt(ev.target);
      if (src) openRef.current(src);
    };
    const taps = createDoubleTapDetector();
    /** Edit mode single taps: where/when the finger went down, and how many are down (pinch is not a tap). */
    let tapDown: { id: number; x: number; y: number; t: number } | null = null;
    const down = new Set<number>();
    let swallowTouchEnd = false;
    const touchy = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
    const onDown = (e: PointerEvent) => {
      // A new contact: a `touchend` that never came (pen, webview quirk) must not eat this one.
      swallowTouchEnd = false;
      if (!touchy(e)) return;
      taps.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      // The first finger of a new gesture: forget contacts whose `pointerup` never came.
      if (e.isPrimary) down.clear();
      down.add(e.pointerId);
      tapDown = down.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
    };
    const singleTap = (e: PointerEvent): boolean => {
      const d = tapDown;
      tapDown = null;
      return Boolean(
        d && d.id === e.pointerId && Math.hypot(d.x - e.clientX, d.y - e.clientY) <= TAP_SLOP_PX && e.timeStamp - d.t <= TAP_MAX_MS,
      );
    };
    const onUp = (e: PointerEvent) => {
      if (!touchy(e)) return;
      down.delete(e.pointerId);
      const tap = singleTap(e);
      const double = taps.up(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      // Edit mode: one tap is enough. View mode: only the double-tap shortcut.
      if (!(editModeRef.current ? tap : double)) return;
      const src = srcAt(e.target);
      if (!src) return;
      let opened = false;
      flushSync(() => {
        opened = openFromGesture(src);
      });
      if (!opened) return;
      // Only a finger produces the compat `touchend` to cancel; pen/mouse never arm it.
      swallowTouchEnd = e.pointerType === "touch";
      swallowUntilRef.current = now() + TAP_SWALLOW_MS;
      const el = inputRef.current;
      if (el && document.activeElement !== el) focusAtEnd(el);
    };
    const onCancel = (e: PointerEvent) => {
      if (!touchy(e)) return;
      taps.cancel(e.pointerId);
      down.delete(e.pointerId);
      tapDown = null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!swallowTouchEnd) return;
      swallowTouchEnd = false;
      if (e.cancelable) e.preventDefault();
    };
    host.addEventListener("dblclick", onDbl);
    host.addEventListener("click", onClick);
    host.addEventListener("pointerdown", onDown as EventListener);
    host.addEventListener("pointerup", onUp as EventListener);
    host.addEventListener("pointercancel", onCancel as EventListener);
    host.addEventListener("touchend", onTouchEnd as EventListener, { passive: false });
    return () => {
      host.removeEventListener("dblclick", onDbl);
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointerdown", onDown as EventListener);
      host.removeEventListener("pointerup", onUp as EventListener);
      host.removeEventListener("pointercancel", onCancel as EventListener);
      host.removeEventListener("touchend", onTouchEnd as EventListener);
    };
  }, [openFromGesture]);

  // Leaving edit mode («Tayyor», phone back, Escape) saves the open text — never drops it.
  useEffect(() => {
    if (!editMode && editRef.current) commitRef.current();
  }, [editMode]);

  /*
   * TASHQARIGA BITTA bosish tahrirni yopadi (va saqlaydi). Shrift
   * PANELI (desktop), phone bar and sheet ichidagi bosish tashqari
   * HISOBLANMAYDI — ular tahrirning o'z qismi.
   */
  useEffect(() => {
    if (!edit) return;
    const onDown = (ev: Event) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.(EDIT_UI)) return;
      // The opening double tap's own compat mousedown (browsers that ignore the touchend cancel).
      if (now() < swallowUntilRef.current) return;
      /*
       * Phone: a tap ON THE SLIDE keeps the edit (and the focus zoom). It is
       * usually the first tap of a double tap on another text: committing
       * here would unzoom the stage and move that text away from the second
       * tap. The switch itself commits (`open`); «Tayyor», back, or a press
       * outside the slide end the edit. The focus must not move either
       * (blur would commit), hence `preventDefault`.
       */
      if (coarse && t?.closest?.("[data-slide-frame]")) {
        ev.preventDefault();
        return;
      }
      commit();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [edit, commit, coarse]);

  /** Ro'yxatda Enter — brauzer yangi `<li>` yaratadi; chegarada bloklanadi. */
  const listMax = edit?.kind === "list" ? listCap(slide, edit.field, bodyType).max : 0;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    const cur = editRef.current;
    if (!cur || e.key !== "Enter") return;
    if (cur.kind === "list") {
      const n = inputRef.current?.querySelectorAll("li").length ?? 0;
      if (n >= listMax) e.preventDefault();
      return;
    }
    if (e.shiftKey && cur.multiline) {
      // Yangi qator MATN sifatida (`\n`) — `white-space: pre-wrap` uni chizadi, `readText` o'qiydi.
      e.preventDefault();
      if (inputRef.current) insertAtCaret(inputRef.current, "\n");
      return;
    }
    e.preventDefault();
    commit();
  };

  /** Faqat MATN qo'yiladi — HTML formatlash qatlamga sizmasin. */
  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData?.getData("text/plain");
    if (text === undefined || text === null) return;
    e.preventDefault();
    if (inputRef.current) insertAtCaret(inputRef.current, text.replace(/\r\n?/g, "\n"));
  };

  const onBlur = (e: { relatedTarget: EventTarget | null; currentTarget?: EventTarget | null }) => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    // The previous field of a switch (already committed) leaving the DOM is not the open edit.
    const from = e.currentTarget as HTMLElement | null | undefined;
    if (from?.getAttribute && from.getAttribute("data-edit-key") !== (editRef.current?.key ?? null)) return;
    // Fokus shrift paneliga (masalan `<select>`) yoki phone bar'ga o'tsa — tahrir davom etadi.
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.closest?.(EDIT_UI)) return;
    commit();
  };

  // Stable handlers for the memoised field; they always call the latest closures.
  const handlersRef = useRef<FieldHandlers>({ onKeyDown, onPaste, onBlur });
  handlersRef.current = { onKeyDown, onPaste, onBlur };
  const handlers = useMemo<FieldHandlers>(
    () => ({
      onKeyDown: (e) => handlersRef.current.onKeyDown(e),
      onPaste: (e) => handlersRef.current.onPaste(e),
      onBlur: (e) => handlersRef.current.onBlur(e),
    }),
    [],
  );

  /* ───────────── phone: bar + sheet, history entries, keep-visible ───────────── */

  const editing = Boolean(edit && editLayer && styleSrc);
  const phoneEdit = coarse && editing;
  const sheetId = useId();
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  /*
   * Phone back (and Telegram's BackButton): the edit session and the sheet
   * each own a history entry, LIFO — the first back closes the sheet, the
   * next one ends the edit with a commit (docs/nav/PLAN.md decision 1:
   * auto-save, then leave). Desktop keeps no entry (unchanged behaviour).
   * The sheet uses `useOverlayHistory`, not `useDialog`: `useDialog` moves
   * the focus into the panel, which would blur the text and close the
   * phone keyboard.
   */
  useOverlayHistory(coarse && Boolean(edit), commit);
  useOverlayHistory(phoneEdit && sheetOpen, closeSheet);

  const vvRef = useRef<Pick<VisualViewportState, "height" | "offsetTop">>({ height: 0, offsetTop: 0 });
  const rafRef = useRef<number | null>(null);
  const revealSoon = useCallback(() => {
    if (rafRef.current !== null) return;
    // After layout: the stage resizes when the bar, the sheet or the focus zoom land.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const b = boxRef.current;
      if (b) scrollEditBoxIntoView(b, vvRef.current, inputRef.current);
    });
  }, []);
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (phoneEdit) revealSoon();
  }, [phoneEdit, edit, scale, sheetOpen, revealSoon]);
  const onViewport = useCallback(
    (vv: VisualViewportState) => {
      vvRef.current = vv;
      revealSoon();
    },
    [revealSoon],
  );

  /* ───────────── desktop: floating panel placed from its measured height ───────────── */

  const showPanel = !coarse && editing;
  const [panelH, setPanelH] = useState(0);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!showPanel || !el) return;
    const measure = () => setPanelH(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showPanel, edit]);

  /*
   * TEST KALITI — variant qutilari ustidagi «✓» tugmalari.
   *
   * `SlideCanvas` ga TEGILMAYDI: to'g'ri javob PPTX ga sizmasligi kerak
   * (ekranda kalitni ko'rsatib qo'yish testni ma'nosiz qilardi), shuning
   * uchun belgi FAQAT shu overlay ichida chiziladi. Joy variant matni
   * qatlamining o'z qutisidan olinadi.
   */
  const answerSpots = useMemo(() => {
    if (!slide.quiz?.length) return [];
    const out: { q: number; j: number; pos: { left: number; top: number; width: number } }[] = [];
    for (const l of plan.layers) {
      if (l.t !== "text" || l.src?.f !== "quiz" || l.src.k !== "option") continue;
      const b = boxStyle(l.box);
      out.push({ q: l.src.i, j: l.src.j, pos: { left: b.left * scale, top: b.top * scale, width: b.width * scale } });
    }
    return out;
  }, [plan.layers, slide.quiz, scale]);

  /*
   * Rasm boshqaruvi — maketda rasm JOYI bo'lsa (rasm hali yo'q bo'lsa
   * ham: «O‘z rasmim» aynan shunda kerak). Logo qatlami ATAYLAB chetlab
   * o'tiladi — `LOGO_BOX` bilan solishtiriladi.
   */
  const slot = photoSlot(slide.layout, visual);
  const hasImage = Boolean(slide.image?.url);
  const imgPos = useMemo(() => {
    if (!slot) return null;
    const imageLayer = plan.layers.find(
      (l) => l.t === "image" && !(l.box.x === LOGO_BOX.x && l.box.y === LOGO_BOX.y && l.box.w === LOGO_BOX.w),
    );
    const b = boxStyle(imageLayer ? imageLayer.box : slot);
    return { left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale };
  }, [slot, plan.layers, scale]);

  /*
   * EDIT MODE OUTLINES — one per editable text layer of THIS slide (a single
   * field `src` or a whole list `srcLines`), in screen px (outside the scaled
   * twin, so the dashed line stays 2 px at any zoom). They are focusable
   * buttons for the keyboard (Tab → Enter opens the text) but
   * `pointer-events-none` for the pointer: a click / tap goes through to the
   * `SlideCanvas` text under it (`[data-src]`), as before.
   */
  const targets = useMemo(() => {
    if (!editMode) return [];
    const out: { key: string; src: SlideSrc; label: string; pos: { left: number; top: number; width: number; height: number } }[] = [];
    for (const l of plan.layers) {
      if (l.t !== "text") continue;
      const src = l.src ?? l.srcLines?.find(Boolean);
      const key = layerKey(l);
      if (!src || !key) continue;
      const b = boxStyle(l.box);
      const text = (l.src ? readSlideField(slide, l.src) : (l.srcLines ?? []).map((s) => (s ? readSlideField(slide, s) : "")).join(" ")) ?? "";
      out.push({
        key,
        src,
        label: text.trim().slice(0, 60) || (src.f === "footer" ? "kolontitul" : "bo‘sh matn"),
        pos: { left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale },
      });
    }
    return out;
  }, [editMode, plan.layers, slide, scale]);

  /*
   * Tahrir qutisi — QATLAM BILAN BIR XIL stil (`textLayerStyle`), faqat
   * toshgan matn ko'rinsin (`overflow: visible`) va yupqa ramka. Fon
   * YO'Q: slaydning o'zi ko'rinadi.
   */
  const boxStyleNow: CSSProperties | null = editLayer
    ? {
        ...textLayerStyle(editLayer),
        // `SlideCanvas` da `className="absolute"` beradi — bu yerda stilning o'zida.
        position: "absolute",
        overflow: "visible",
        outline: "2px solid #0EA5E9",
        outlineOffset: 2,
        pointerEvents: "auto",
        cursor: "text",
      }
    : null;
  const boxPx = editLayer ? boxStyle(editLayer.box) : null;
  const panelAt =
    showPanel && boxPx
      ? placeFloatingPanel({
          box: { left: boxPx.left * scale, top: boxPx.top * scale, width: boxPx.width * scale, height: boxPx.height * scale },
          panelH,
          frameW: SLIDE.w * scale,
          frameH: SLIDE.h * scale,
        })
      : null;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" data-slide-editor data-slide-editor-mode={editMode ? "edit" : "view"}>
      {targets.map(({ key, src, label, pos }) =>
        edit?.key === key ? null : (
          <button
            key={`t-${key}`}
            type="button"
            data-slide-edit-target={key}
            aria-label={`Matnni o‘zgartirish: ${label}`}
            className="pointer-events-none absolute rounded-[2px] bg-sky-400/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)] outline-2 outline-offset-1 outline-sky-400 outline-dashed focus-visible:bg-sky-400/20 focus-visible:outline-[3px] focus-visible:outline-sky-200 focus-visible:outline-solid"
            style={pos}
            onClick={() => open(src)}
          />
        ),
      )}
      {editMode && imgPos ? (
        <div
          data-slide-edit-target="image"
          aria-hidden
          className="pointer-events-none absolute rounded-[2px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.55)] outline-2 outline-offset-1 outline-sky-400 outline-dashed"
          style={imgPos}
        />
      ) : null}
      {(editMode ? answerSpots : []).map(({ q, j, pos }) => {
        const cur = slide.quiz?.[q]?.answer === j;
        return (
          <div
            key={`ans-${q}-${j}`}
            className="pointer-events-none absolute flex justify-end"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            <button
              type="button"
              data-answer-mark={cur ? "current" : "other"}
              aria-pressed={cur}
              aria-label={`${QUIZ_LETTERS[j] ?? j + 1} — to‘g‘ri javob`}
              title={cur ? "Hozirgi to‘g‘ri javob" : "To‘g‘ri javob deb belgilash"}
              className={cn(
                "pointer-events-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                cur ? "bg-emerald-500 text-white" : "bg-black/45 text-white/70 hover:bg-black/70",
              )}
              onClick={() => onAnswer(q, j)}
            >
              <Check className="size-3" />
              {cur ? "To‘g‘ri javob" : QUIZ_LETTERS[j] ?? String(j + 1)}
            </button>
          </div>
        );
      })}

      {editMode && imgPos ? (
        <div
          data-slide-image-controls
          className="pointer-events-auto absolute flex flex-wrap items-start gap-1 p-1"
          style={{ left: imgPos.left, top: imgPos.top, width: imgPos.width }}
        >
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-[13px]"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3" />
            O‘z rasmim
          </button>
          {hasImage ? (
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-[13px]"
              onClick={() => onImage(null)}
            >
              <XCircle className="size-3" />
              Rasmsiz
            </button>
          ) : null}
          {slide.imageOrig ? (
            <button
              type="button"
              disabled={busy}
              title="Asl (AI chizgan) rasmni qaytarish"
              className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3 pointer-coarse:text-[13px]"
              onClick={onRestoreImage}
            >
              <RotateCcw className="size-3" />
              Rasmni qaytarish
            </button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Bir xil faylni qayta tanlash ham hodisa bersin.
              e.target.value = "";
              if (f) onUpload(f);
            }}
          />
        </div>
      ) : null}

      {panelAt ? (
        /*
          Suzuvchi panel (desktop) — maydonning USTIDA, masshtabsiz (o'qish
          uchun). Joy O'LCHANGAN balandlik bo'yicha: sig'masa ostiga, u ham
          sig'masa ramka ichida pastga (`placeFloatingPanel`).
        */
        <SlideEditFloatingPanel
          ref={panelRef}
          style={{ left: panelAt.left, top: panelAt.top }}
          size={curSize}
          min={FONT_MIN}
          max={FONT_MAX}
          hasOverride={hasOverride}
          font={curFont}
          wholeList={wholeList}
          onSize={setSize}
          onFont={setFont}
        />
      ) : null}

      {phoneEdit && editBarSlot
        ? createPortal(
            <div
              data-slide-edit-ui
              className="flex w-full min-w-0 flex-col"
              onPointerDown={(e) => {
                keepEditorFocus(e);
                // Not a press on the slide (the stage's own touch selection must not react).
                e.stopPropagation();
              }}
              onMouseDown={keepEditorFocus}
            >
              {sheetOpen ? (
                <SlideEditFontSheet
                  id={sheetId}
                  size={curSize}
                  hasOverride={hasOverride}
                  font={curFont}
                  wholeList={wholeList}
                  onSize={setSize}
                  onFont={setFont}
                />
              ) : null}
              <SlideEditStyleBar
                size={curSize}
                min={FONT_MIN}
                max={FONT_MAX}
                hasOverride={hasOverride}
                font={curFont}
                wholeList={wholeList}
                onSize={setSize}
                onFont={setFont}
                sheetOpen={sheetOpen}
                sheetId={sheetId}
                onToggleSheet={() => setSheetOpen((v) => !v)}
                onDone={commit}
                onCancel={cancel}
              />
            </div>,
            editBarSlot,
          )
        : null}
      {phoneEdit ? <VisualViewportWatch onChange={onViewport} /> : null}

      {/*
        EGIZAK konteyner — sahna bilan bir xil masshtab. Tahrir qutisi
        qatlamning O'Z koordinatalarida (dyuym → px, `boxStyle`), ya'ni
        `SlideCanvas` dagi qatlam bilan piksel-piksel ustma-ust.
      */}
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left"
        style={{ width: SLIDE.w, height: SLIDE.h, transform: `scale(${scale})` }}
      >
        {edit && editLayer && boxStyleNow ? (
          <div ref={boxRef} data-slide-edit-box style={boxStyleNow}>
            <EditField
              key={edit.key}
              edit={edit}
              bullets={Boolean(editLayer.bullets)}
              paraSpacePx={ptToPx(editLayer.paraSpace ?? 8)}
              inputRef={inputRef}
              handlers={handlers}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
