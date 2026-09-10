"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ResumeItem, ResumeLayout } from "@/lib/generation/resume/layout";
import type { ResumeOp } from "@/lib/generation/resume/edit";
import type { ResumeModel } from "@/lib/generation/resume/model";
import { focusAtEnd, readText } from "../editable";
import { ResumePage, type ResumeEditEvent } from "./ResumePage";

/**
 * Rezyume TAHRIR qatlami — `SlideEditor` bilan bir xil naqsh, boshqa
 * geometriya.
 *
 * Slaydda qatlamlar ABSOLYUT qutilarda turadi, shuning uchun u yerda
 * sahna ustiga «egizak» overlay chiziladi. Rezyume esa oddiy matn OQIMI:
 * ustma-ust qo'yilgan quti bir qator qo'shilishi bilan siljib ketardi.
 * Shuning uchun bu yerda matnning O'ZI `contentEditable` bo'ladi —
 * varaq bitta, joyi ham bitta, ya'ni «ko'rdim = oldim» buzilmaydi.
 *
 * Enter = saqlash, Esc = bekor qilish, blur = saqlash — yordamchilar
 * `components/viewers/editable.ts` da, `SlideEditor` bilan BITTA nusxa.
 *
 * React maydonga tegmaydi: tahrir davomida holat o'zgarmaydi, commitdan
 * keyin esa yangi model kelib butun varaqni qayta chizadi.
 */

export type ResumeEditorProps = {
  layout: ResumeLayout;
  /** Ekrandagi model — `list`/`sectionMove` oplari uchun kerak. */
  model: ResumeModel;
  pageItems: ResumeItem[];
  pageIndex: number;
  total: number;
  onOps: (ops: ResumeOp[]) => void;
  /** «Rasm» tugmasi — fayl tanlash dialogini ko'ruvchi ochadi. */
  onPhoto?: () => void;
};

/** Ko'p qatorli tahrirga ruxsat etilgan maydonlar (Shift+Enter → yangi qator). */
const MULTILINE = /^(summary|experience\.\d+\.bullets\.\d+\.text)$/;

export function ResumeEditor({ layout, model, pageItems, pageIndex, total, onOps, onPhoto }: ResumeEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Ochiq maydon: element, yo'l va tahrirdan OLDINGI matn. */
  const openRef = useRef<{ el: HTMLElement; path: string; chip: number | null; initial: string } | null>(null);

  const modelRef = useRef(model);
  modelRef.current = model;
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;

  const close = useCallback((el: HTMLElement) => {
    el.removeAttribute("contenteditable");
    el.removeAttribute("data-resume-editing");
    openRef.current = null;
  }, []);

  const commit = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    const value = readText(cur.el);
    close(cur.el);
    // O'zgarmagan matn uchun operatsiya YUBORILMAYDI — bo'sh PATCH hujjat
    // versiyasini oshirib, DOCX ni bekorga qayta yasatardi.
    if (value === cur.initial) return;
    if (cur.chip !== null) {
      // Ko'nikma — op BUTUN ro'yxat; qolgan bandlar modeldan olinadi.
      const items = modelRef.current.skills.map((s, i) => (i === cur.chip ? value : s.text));
      onOpsRef.current([{ op: "list", items }]);
      return;
    }
    onOpsRef.current([{ op: "text", path: cur.path, value }]);
  }, [close]);

  const cancel = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    // DOM ni asl matnga qaytaramiz — React bu tugunni o'zi tiklamaydi
    // (uning vdom idagi matn o'zgarmagan).
    cur.el.textContent = cur.initial;
    close(cur.el);
  }, [close]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const open = useCallback(
    (el: HTMLElement) => {
      const path = el.getAttribute("data-path");
      if (!path) return;
      if (openRef.current?.el === el) return;
      if (openRef.current) commitRef.current();
      const chipRaw = el.getAttribute("data-chip");
      openRef.current = {
        el,
        path,
        chip: chipRaw === null ? null : Number(chipRaw),
        initial: readText(el),
      };
      el.setAttribute("contenteditable", "true");
      el.setAttribute("data-resume-editing", "1");
      focusAtEnd(el);
    },
    [],
  );

  /*
   * Ikki bosish — ILDIZDA (delegatsiya): varaq har tahrirdan keyin qayta
   * chiziladi, ya'ni har elementga alohida ilgak osib bo'lmaydi.
   */
  useEffect(() => {
    const host = rootRef.current;
    if (!host) return;

    const onDbl = (ev: Event) => {
      const target = (ev.target as HTMLElement | null)?.closest?.("[data-path]") as HTMLElement | null;
      if (!target || !host.contains(target)) return;
      ev.preventDefault();
      open(target);
    };
    const onKey = (ev: KeyboardEvent) => {
      const cur = openRef.current;
      if (!cur) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cancelRef.current();
        return;
      }
      if (ev.key !== "Enter") return;
      // Shift+Enter — ko'p qatorli maydonda yangi qator (brauzerning o'zi).
      if (ev.shiftKey && MULTILINE.test(cur.path)) return;
      ev.preventDefault();
      commitRef.current();
    };
    const onFocusOut = (ev: FocusEvent) => {
      const cur = openRef.current;
      if (!cur || ev.target !== cur.el) return;
      commitRef.current();
    };

    host.addEventListener("dblclick", onDbl);
    host.addEventListener("keydown", onKey);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      host.removeEventListener("dblclick", onDbl);
      host.removeEventListener("keydown", onKey);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  /** Hover boshqaruvlari (`ResumePage`) → operatsiyalar. */
  const onEdit = useCallback(
    (ev: ResumeEditEvent) => {
      const m = modelRef.current;
      switch (ev.t) {
        case "bulletAdd":
          onOpsRef.current([{ op: "bulletAdd", row: ev.row, at: ev.at }]);
          break;
        case "bulletRemove":
          onOpsRef.current([{ op: "bulletRemove", row: ev.row, index: ev.index }]);
          break;
        case "bulletMove": {
          const n = m.experience[ev.row]?.bullets.length ?? 0;
          if (ev.to < 0 || ev.to >= n || ev.to === ev.from) return;
          onOpsRef.current([{ op: "bulletMove", row: ev.row, from: ev.from, to: ev.to }]);
          break;
        }
        case "rowAdd":
          onOpsRef.current([{ op: "rowAdd", section: ev.section }]);
          break;
        case "rowRemove":
          onOpsRef.current([{ op: "rowRemove", section: ev.section, index: ev.index }]);
          break;
        case "rowMove": {
          const n = (m[ev.section] as unknown[]).length;
          if (ev.to < 0 || ev.to >= n || ev.to === ev.from) return;
          onOpsRef.current([{ op: "rowMove", section: ev.section, from: ev.from, to: ev.to }]);
          break;
        }
        case "chipAdd":
          onOpsRef.current([{ op: "list", items: [...m.skills.map((s) => s.text), NEW_SKILL] }]);
          break;
        case "chipRemove":
          onOpsRef.current([{ op: "list", items: m.skills.filter((_, i) => i !== ev.at).map((s) => s.text) }]);
          break;
        case "sectionMove": {
          // `to` MODELDAGI `order` bo'yicha hisoblanadi — maketda faqat
          // bo'sh bo'lmagan bo'limlar ko'rinadi, indekslar boshqacha.
          const from = m.order.indexOf(ev.section);
          const to = from + ev.dir;
          if (from < 0 || to < 0 || to >= m.order.length) return;
          onOpsRef.current([{ op: "sectionMove", section: ev.section, to }]);
          break;
        }
        case "photo":
          onPhoto?.();
          break;
        default:
          break;
      }
    },
    [onPhoto],
  );

  return (
    <div ref={rootRef} data-resume-editor>
      <ResumePage layout={layout} pageItems={pageItems} pageIndex={pageIndex} total={total} editable onEdit={onEdit} />
    </div>
  );
}

/** Yangi ko'nikma o'rinbosari — foydalanuvchi darhol ustiga yozadi. */
export const NEW_SKILL = "Yangi ko‘nikma";
