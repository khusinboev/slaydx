"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ImagePlus, RefreshCw, XCircle } from "lucide-react";
import type { SlideAudience, SlideTemplateId, SlideVisual } from "@/lib/generation/slide-templates";
import type { BodyRules } from "@/lib/generation/slide-audience";
import type { SlideModel, SlideSrc, SlideTheme } from "@/lib/generation/slide-types";
import { readSlideField } from "@/lib/generation/slide-edit";
import { SLIDE_LIMITS } from "@/lib/generation/slide-limits";
import {
  LOGO_BOX,
  boxStyle,
  photoSlot,
  planSlide,
  ptToPx,
  type SlideLayer,
} from "@/lib/generation/slide-layout";

/**
 * Tahrir QATLAMI — `SlideStage` ning `overlay` slotida.
 *
 * `SlideCanvas` PASSIV qoladi (SSR paritet testlari uni qulflagan):
 * u faqat har matn qatlamiga `data-src` yozadi, ya'ni «bu matn modelning
 * qaysi maydonidan chizilgan». Bu komponent shu atributni o'qiydi va
 * AYNI o'sha qutida `textarea` ochadi — shrift o'lchami, rangi, tekislashi
 * qatlamniki, shuning uchun matn joyidan qimirlamaydi.
 *
 * Masshtab QO'LDA ko'paytiriladi (`transform: scale()` EMAS): CSS
 * transformi ostidagi `textarea` da kursor va tanlash joyi siljib
 * ketadi. Overlay sahnaning masshtablanmagan ramkasida turgani uchun
 * ham koordinata, ham shrift `scale` ga ko'paytiriladi.
 *
 * Hodisa ushlash: overlay o'zi `pointer-events-none` — ikki bosish
 * ostidagi `SlideCanvas` elementiga tegadi va SAHNA ramkasiga
 * ko'tariladi; biz shu ramkada tinglaymiz va `closest("[data-src]")`
 * bilan manbani topamiz. Shu sabab qatlamlar ustiga ko'rinmas «tutqich»
 * to'rtburchaklar qo'yish shart emas.
 */

export type SlideEditorProps = {
  slide: SlideModel;
  theme: SlideTheme;
  visual: SlideVisual;
  audience: SlideAudience;
  templateId: SlideTemplateId;
  bodyType: BodyRules;
  logo?: string;
  index: number;
  total: number;
  /** Sahna masshtabi (`SlideStageOverlayCtx.scale`). */
  scale: number;
  /** Qolgan bepul qayta chizish. */
  redrawsLeft: number;
  /** Rasm so'rovi ketayotgan bo'lsa tugmalar o'chadi. */
  busy?: boolean;
  onText: (src: SlideSrc, value: string) => void;
  onImage: (url: null) => void;
  onUpload: (file: File) => void;
  onRegenerate: () => void;
};

/** Ko'p qatorli tahrirga ruxsat etilgan maydonlar (Shift+Enter → yangi qator). */
function isMultiline(src: SlideSrc): boolean {
  if (src.f === "subtitle" || src.f === "quote") return true;
  return src.f === "steps" && src.k === "text";
}

/** Ro'yxatli maydonlar — «+ band» tugmasi shular uchun chiqadi. */
type ListField = "bullets" | "left" | "right";
function listFieldOf(src: SlideSrc | undefined): ListField | null {
  if (!src) return null;
  return src.f === "bullets" || src.f === "left" || src.f === "right" ? src.f : null;
}

type Pos = { left: number; top: number; width: number; height: number };

type EditState = {
  src: SlideSrc;
  value: string;
  initial: string;
  pos: Pos;
  style: CSSProperties;
  multiline: boolean;
};

export function SlideEditor({
  slide,
  theme,
  visual,
  audience,
  templateId,
  bodyType,
  logo,
  index,
  total,
  scale,
  redrawsLeft,
  busy = false,
  onText,
  onImage,
  onUpload,
  onRegenerate,
}: SlideEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const editRef = useRef<EditState | null>(null);
  editRef.current = edit;
  // Esc dan keyin `blur` saqlab yubormasligi uchun bir martalik bayroq.
  const skipBlurRef = useRef(false);

  const plan = useMemo(
    () => planSlide(slide, theme, visual, index, total, audience, templateId, { bodyType, logo }),
    [slide, theme, visual, index, total, audience, templateId, bodyType, logo],
  );

  /** `src` ga mos qatlam — shrift/rang/tekislashni undan olamiz. */
  const layerOf = useCallback(
    (src: SlideSrc): SlideLayer | null => {
      const key = JSON.stringify(src);
      for (const l of plan.layers) {
        if (l.t !== "text") continue;
        if (l.src && JSON.stringify(l.src) === key) return l;
        if (l.srcLines?.some((s) => s && JSON.stringify(s) === key)) return l;
      }
      return null;
    },
    [plan.layers],
  );

  const open = useCallback(
    (src: SlideSrc, el: HTMLElement | null, initialOverride?: string) => {
      const layer = layerOf(src);
      const value = initialOverride ?? readSlideField(slide, src) ?? "";
      /*
       * Joy: iloji bo'lsa BOSILGAN elementning o'zidan (ro'yxatdagi
       * bitta band butun qatlam qutisidan kichik). O'lchov bo'lmasa
       * (SSR/jsdom — layout yo'q) qatlam qutisiga tushamiz.
       */
      const host = rootRef.current;
      let pos: Pos | null = null;
      if (el && host) {
        const r = el.getBoundingClientRect();
        const hr = host.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          pos = { left: r.left - hr.left, top: r.top - hr.top, width: r.width, height: r.height };
        }
      }
      if (!pos && layer) {
        const b = boxStyle(layer.box);
        pos = { left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale };
      }
      if (!pos) pos = { left: 0, top: 0, width: 200, height: 40 };

      const style: CSSProperties =
        layer && layer.t === "text"
          ? {
              fontSize: ptToPx(layer.size) * scale,
              color: layer.color,
              fontWeight: layer.bold ? 700 : 500,
              fontStyle: layer.italic ? "italic" : "normal",
              textAlign: layer.align || "left",
              lineHeight: 1.22,
            }
          : { fontSize: 14 * scale, color: theme.text ?? "#111", textAlign: "left" };

      setEdit({ src, value, initial: value, pos, style, multiline: isMultiline(src) });
    },
    [layerOf, slide, scale, theme.text],
  );

  const commit = useCallback(() => {
    const e = editRef.current;
    setEdit(null);
    if (!e) return;
    // O'zgarmagan matn uchun operatsiya YUBORILMAYDI — bo'sh PATCH
    // hujjat versiyasini oshirib, PPTX ni bekorga qayta yasatardi.
    if (e.value === e.initial) return;
    onText(e.src, e.value);
  }, [onText]);

  const cancel = useCallback(() => {
    skipBlurRef.current = true;
    setEdit(null);
  }, []);

  /*
   * Ikki bosish — SAHNA ramkasida (overlay ning ota elementi). Aynan shu
   * tugun `SlideCanvas` ni ham, bizni ham o'z ichiga oladi.
   */
  useEffect(() => {
    /*
     * Sahna RAMKASI — slayd ham, overlay ham shu tugun ichida
     * (`SlideStage` uni `data-slide-frame` bilan belgilaydi).
     * Ramka topilmasa eng yaqin ota tugun (sinovdagi sodda tuzilma).
     */
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
      open(src, el);
    };
    host.addEventListener("dblclick", onDbl);
    return () => host.removeEventListener("dblclick", onDbl);
  }, [open]);

  /*
   * «+ band» — ro'yxatli qatlam ostida. Yangi band ro'yxatning OXIRIGA
   * (`i === length`) yoziladi: `writeSlideField` shu holatni «qo'shish»
   * deb tushunadi.
   */
  const adders = useMemo(() => {
    const out: { field: ListField; pos: Pos }[] = [];
    for (const l of plan.layers) {
      if (l.t !== "text" || !l.srcLines?.length) continue;
      const field = listFieldOf(l.srcLines.find(Boolean));
      if (!field) continue;
      const list = slide[field] ?? [];
      const cap =
        field === "bullets"
          ? slide.layout === "agenda"
            ? bodyType.agendaMax
            : bodyType.maxBullets
          : SLIDE_LIMITS.colItems;
      if (list.length >= cap) continue;
      const b = boxStyle(l.box);
      out.push({
        field,
        pos: {
          left: b.left * scale,
          top: (b.top + b.height) * scale,
          width: b.width * scale,
          height: 22,
        },
      });
    }
    return out;
  }, [plan.layers, slide, bodyType.agendaMax, bodyType.maxBullets, scale]);

  /*
   * Rasm boshqaruvi — maketda rasm JOYI bo'lsa (rasm hali yo'q bo'lsa
   * ham: «Qayta chizish» aynan shunda kerak). Logo qatlami ATAYLAB
   * chetlab o'tiladi — `LOGO_BOX` bilan solishtiriladi.
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

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" data-slide-editor>
      {adders.map((a, i) => (
        <button
          key={`${a.field}-${i}`}
          type="button"
          className="pointer-events-auto absolute rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/80"
          style={{ left: a.pos.left, top: a.pos.top, maxWidth: a.pos.width }}
          onClick={() => open({ f: a.field, i: (slide[a.field] ?? []).length }, null, "")}
        >
          + band
        </button>
      ))}

      {imgPos ? (
        <div
          className="pointer-events-auto absolute flex flex-wrap items-start gap-1 p-1"
          style={{ left: imgPos.left, top: imgPos.top, width: imgPos.width }}
        >
          <button
            type="button"
            disabled={busy || redrawsLeft <= 0}
            title={redrawsLeft > 0 ? "Rasmni qaytadan chizish" : "Limit tugadi"}
            className="inline-flex items-center gap-1 rounded bg-black/65 px-1.5 py-1 text-[11px] text-white hover:bg-black/85 disabled:opacity-50"
            onClick={onRegenerate}
          >
            <RefreshCw className="size-3" />
            Qayta chizish ({redrawsLeft}/5)
          </button>
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

      {edit ? (
        <textarea
          autoFocus
          data-slide-edit-input
          aria-label="Matnni tahrirlash"
          className="pointer-events-auto absolute resize-none rounded-sm bg-white/95 p-0.5 outline-2 outline-sky-500"
          style={{
            left: edit.pos.left,
            top: edit.pos.top,
            width: Math.max(60, edit.pos.width),
            height: Math.max(24, edit.pos.height),
            ...edit.style,
          }}
          value={edit.value}
          onChange={(e) => setEdit((s) => (s ? { ...s, value: e.target.value } : s))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
              return;
            }
            if (e.key === "Enter" && !(e.shiftKey && edit.multiline)) {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={() => {
            if (skipBlurRef.current) {
              skipBlurRef.current = false;
              return;
            }
            commit();
          }}
        />
      ) : null}
    </div>
  );
}
