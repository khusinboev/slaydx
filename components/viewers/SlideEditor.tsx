"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CustomTemplate } from "@/lib/generation/pptx-template";
import { Check, ImagePlus, Minus, Plus, RotateCcw, XCircle } from "lucide-react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideSrc, SlideTheme } from "@/lib/generation/slide-types";
import { FONT_MAX, FONT_MIN, listCap, readSlideField, type ListField } from "@/lib/generation/slide-edit";
import { SLIDE_FONTS, isSlideFontId, type SlideFontId } from "@/lib/generation/slide-fonts";
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
  /** Tahrir ochilganda qatlam kaliti (`layerKey`), yopilganda `null` — sahna o'sha qatlamni yashiradi. */
  onEditing?: (key: string | null) => void;
};

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
 * Panelda taklif qilinadigan o'lchamlar (pt) — matn muharrirlaridagi
 * odatiy qator. Oraliq `FONT_MIN..FONT_MAX` ichida, ya'ni har tanlov
 * serverdan o'tadi.
 */
export const FONT_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 44, 54, 66] as const;

/** «−»/«+» qadami (pt). */
const FONT_STEP = 2;

function clampFont(n: number): number {
  return Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(n)));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
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
}: SlideEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLElement | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;
  // Esc dan keyin `blur` saqlab yubormasligi uchun bir martalik bayroq.
  const skipBlurRef = useRef(false);

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

  const open = useCallback(
    (src: SlideSrc) => {
      const key = keyOf(src);
      const layer = key ? layerByKey(key) : null;
      if (!key || !layer) return;
      const field = listFieldOf(layer.srcLines?.find(Boolean));
      if (field && layer.srcLines && !layer.src) {
        setEdit({ kind: "list", key, field, initial: (slide[field] ?? []).slice() });
      } else {
        setEdit({ kind: "text", key, src, initial: readSlideField(slide, src) ?? "", multiline: isMultiline(src) });
      }
      onEditing?.(key);
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

  const commit = useCallback(() => {
    const e = editRef.current;
    const el = inputRef.current;
    // REF darhol bo'shatiladi: tashqariga bosish `mousedown` bilan
    // yopadi, keyin `blur` ham keladi — ikkinchisi bo'sh ref ko'rib
    // jim qaytadi, aks holda BIR tahrir ikki marta saqlanardi.
    editRef.current = null;
    setEdit(null);
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
    onEditing?.(null);
  }, [onEditing]);

  /*
   * Ikki bosish — SAHNA ramkasida (overlay ning ota elementi). Aynan shu
   * tugun `SlideCanvas` ni ham, bizni ham o'z ichiga oladi. Tahrir
   * maydonining o'zida ikki bosish (so'z tanlash) `data-src` ga tegmaydi.
   */
  useEffect(() => {
    const host = rootRef.current?.closest("[data-slide-frame]") ?? rootRef.current?.parentElement;
    if (!host) return;
    const onDbl = (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      const el = target?.closest?.("[data-src]") as HTMLElement | null;
      if (!el) return;
      const raw = el.getAttribute("data-src");
      if (!raw) return;
      let src: SlideSrc;
      try {
        src = JSON.parse(raw) as SlideSrc;
      } catch {
        return;
      }
      if (!src || typeof src !== "object" || typeof (src as { f?: unknown }).f !== "string") return;
      ev.preventDefault();
      open(src);
    };
    host.addEventListener("dblclick", onDbl);
    return () => host.removeEventListener("dblclick", onDbl);
  }, [open]);

  /*
   * TASHQARIGA BITTA bosish tahrirni yopadi (va saqlaydi). Shrift
   * PANELI ichidagi bosish tashqari HISOBLANMAYDI — u tahrirning o'z
   * qismi.
   */
  useEffect(() => {
    if (!edit) return;
    const onDown = (ev: Event) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest?.("[data-slide-edit-box]") || t?.closest?.("[data-slide-font-panel]")) return;
      commit();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [edit, commit]);

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

  const onBlur = (e: { relatedTarget: EventTarget | null }) => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    // Fokus shrift paneliga (masalan `<select>`) o'tsa — tahrir davom etadi.
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.closest?.("[data-slide-font-panel]")) return;
    commit();
  };

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
    return { left: b.left * scale, top: b.top * scale, width: b.width * scale };
  }, [slot, plan.layers, scale]);

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
  const panelTop = editLayer ? Math.round(boxStyle(editLayer.box).top * scale) : 0;
  const panelLeft = editLayer ? Math.round(boxStyle(editLayer.box).left * scale) : 0;
  const panelH = editLayer ? Math.round(boxStyle(editLayer.box).height * scale) : 0;

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" data-slide-editor>
      {answerSpots.map(({ q, j, pos }) => {
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

      {imgPos ? (
        <div
          className="pointer-events-auto absolute flex flex-wrap items-start gap-1 p-1"
          style={{ left: imgPos.left, top: imgPos.top, width: imgPos.width }}
        >
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="size-3" />
            O‘z rasmim
          </button>
          {hasImage ? (
            <button
              type="button"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50"
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
              className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50"
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

      {edit && editLayer && styleSrc ? (
        /*
          Suzuvchi panel — maydonning USTIDA, masshtabsiz (o'qish uchun).
          Joy yetmasa (yuqori qatlam) maydonning ostiga tushadi.
        */
        <div
          data-slide-font-panel
          className="pointer-events-auto absolute z-10 flex max-w-[min(640px,95%)] flex-wrap items-center gap-1 rounded-md bg-[#2b2b2b] px-1.5 py-1 text-[11px] text-white/85 shadow-lg"
          style={{ left: panelLeft, top: panelTop >= 34 ? panelTop - 34 : panelTop + panelH + 4 }}
          // Panelga bosganda maydon fokusni yo'qotmasin — `<select>` bundan
          // mustasno (u fokus olmasa ochilmaydi; `onBlur` uni tanib turadi).
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).tagName !== "SELECT") e.preventDefault();
          }}
        >
          <span className="px-1 text-white/45">{wholeList ? "Barcha bandlar" : "Shrift"}</span>
          <select
            aria-label="Shrift oilasi"
            className="rounded bg-white/10 px-1 py-0.5 text-[11px] text-white outline-none"
            value={curFont}
            onChange={(e) => {
              const v = e.target.value;
              setFont(isSlideFontId(v) ? v : null);
            }}
          >
            <option value="" className="text-black">
              Standart (Arial)
            </option>
            {SLIDE_FONTS.map((f) => (
              <option key={f.id} value={f.id} className="text-black">
                {f.label}
              </option>
            ))}
          </select>
          <span className="mx-0.5 h-3.5 w-px bg-white/20" />
          <button
            type="button"
            aria-label="Shriftni kichraytirish"
            className="hover:bg-white/15 rounded p-1 disabled:opacity-40"
            disabled={curSize <= FONT_MIN}
            onClick={() => setSize(clampFont(curSize - FONT_STEP))}
          >
            <Minus className="size-3" />
          </button>
          <span className="min-w-6 text-center tabular-nums" aria-label="Joriy shrift o‘lchami">
            {curSize}
          </span>
          <button
            type="button"
            aria-label="Shriftni kattalashtirish"
            className="hover:bg-white/15 rounded p-1 disabled:opacity-40"
            disabled={curSize >= FONT_MAX}
            onClick={() => setSize(clampFont(curSize + FONT_STEP))}
          >
            <Plus className="size-3" />
          </button>
          <span className="mx-0.5 h-3.5 w-px bg-white/20" />
          {FONT_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`Shrift ${n} pt`}
              className={cn(
                "rounded px-1 py-0.5 tabular-nums",
                curSize === n ? "bg-sky-500 text-white" : "hover:bg-white/15",
              )}
              onClick={() => setSize(n)}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className={cn("rounded px-1.5 py-0.5", hasOverride ? "hover:bg-white/15" : "text-white/35")}
            disabled={!hasOverride}
            onClick={() => setSize(null)}
          >
            Standart
          </button>
        </div>
      ) : null}

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
          <div data-slide-edit-box style={boxStyleNow}>
            {edit.kind === "text" ? (
              <div
                ref={(el) => {
                  inputRef.current = el;
                }}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline={edit.multiline}
                aria-label="Matnni tahrirlash"
                data-slide-edit-input
                style={{ width: "100%", minHeight: "1em", outline: "none" }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={onBlur}
              >
                {edit.initial}
              </div>
            ) : (
              <ul
                ref={(el) => {
                  inputRef.current = el;
                }}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline
                aria-label="Matnni tahrirlash"
                data-slide-edit-input
                className={editLayer.bullets ? "w-full list-disc pl-[1.15em]" : "w-full list-none"}
                style={{ margin: 0, paddingLeft: editLayer.bullets ? "1.15em" : 0, outline: "none", minHeight: "1em" }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={onBlur}
              >
                {edit.initial.map((line, i) => (
                  <li key={i} style={{ marginBottom: ptToPx(editLayer.paraSpace ?? 8) }}>
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
