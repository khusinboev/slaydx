"use client";

import { useSyncExternalStore } from "react";

/**
 * contentEditable yordamchilari — slayd va rezyume muharrirlari uchun
 * BITTA nusxa (Rezyume 2, AUDIT-15 da `SlideEditor.tsx` dan ajratildi).
 *
 * Bu funksiyalar brauzerlarning contentEditable xatti-harakatidagi uch
 * farqni yopadi va ikkala muharrirda ham AYNAN bir xil ishlashi kerak —
 * aks holda rezyumeda Enter yangi qator, slaydda esa saqlash bo'lib
 * qolardi.
 */

/**
 * contentEditable dagi matnni o'qish — `innerText` jsdom da yo'q,
 * `textContent` esa `<br>`/`<div>` qator ajratgichlarini yutadi.
 * Brauzer Enter/Shift+Enter da har xil tugun yaratishi mumkin — hammasi
 * `\n` ga tushadi.
 */
export function readText(el: Node): string {
  let out = "";
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const tag = (n as Element).tagName;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const block = tag === "DIV" || tag === "P" || tag === "LI";
    if (block && !first && out && !out.endsWith("\n")) out += "\n";
    let f = true;
    for (const c of Array.from(n.childNodes)) {
      walk(c, f);
      f = false;
    }
  };
  walk(el, true);
  // Chrome bo'sh qatorga `<br>` qo'yadi — oxiridagi bitta ortiqcha ajratgich hisobga olinmaydi.
  return out.replace(/\n$/, "");
}

/** Ro'yxat maydonidan bandlar: har `<li>` bitta band; ichidagi qo'lda yozilgan `\n` ham bandga ajratiladi. */
export function readItems(ul: HTMLElement): string[] {
  const lis = Array.from(ul.querySelectorAll("li"));
  const raw = lis.length ? lis.map((li) => readText(li)) : [readText(ul)];
  return raw
    .flatMap((t) => t.split("\n"))
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Kursor turgan joyga matn qo'yish — undo stekiga tushadigan yo'l bo'lsa o'sha, bo'lmasa Range API. */
export function insertAtCaret(el: HTMLElement, text: string) {
  const d = document as Document & { execCommand?: (c: string, ui: boolean, v: string) => boolean };
  if (typeof d.execCommand === "function") {
    try {
      if (d.execCommand("insertText", false, text)) return;
    } catch {
      // eski brauzer — pastdagi yo'l
    }
  }
  const sel = window.getSelection?.();
  const node = document.createTextNode(text);
  if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    el.appendChild(node);
  }
}

/**
 * Maydon ochilganda fokus va kursor OXIRIDA — foydalanuvchi darhol
 * yozadi. Selection API bo'lmasa (eski muhit) fokusning o'zi yetadi.
 */
export function focusAtEnd(el: HTMLElement) {
  el.focus();
  try {
    const sel = window.getSelection?.();
    if (sel && typeof sel.selectAllChildren === "function") {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
  } catch {
    // jsdom/eski brauzer — kursor joyi muhim emas
  }
}

/* ───────────────────────── open field (phone «Bekor / Tayyor» bar) ───────────────────────── */

/**
 * The field a document editor (`ArticleEditor`, `ResumeEditor`) has open
 * right now, with the SAME `commit`/`cancel` its Enter/Esc keys run. The
 * phone «Bekor / Tayyor» bar (`EditDoneBar`) and phone back read it from
 * here, so the bar never needs props drilled through the sheets and there is
 * exactly one end-of-edit path per editor (docs/mobile/PLAN.md, R3 «Contract»).
 *
 * Only one contentEditable can hold the focus, so one module-level slot is
 * enough. Editors announce on open and release on close; a release of a
 * field that is no longer the current one is ignored (opening field B
 * commits field A first).
 */
export type OpenField = {
  el: HTMLElement;
  /** Save the text (Enter, «Tayyor», phone back). */
  commit: () => void;
  /** Drop the text and restore the original (Esc, «Bekor»). */
  cancel: () => void;
};

let openField: OpenField | null = null;
const openFieldListeners = new Set<() => void>();

function notifyOpenField() {
  for (const l of [...openFieldListeners]) l();
}

/** An editor opened a field. */
export function announceOpenField(f: OpenField): void {
  openField = f;
  notifyOpenField();
}

/** An editor closed the field `el` (commit, cancel, unmount). */
export function releaseOpenField(el: HTMLElement): void {
  if (openField?.el !== el) return;
  openField = null;
  notifyOpenField();
}

/** The currently open field (event handlers, effects). */
export function getOpenField(): OpenField | null {
  return openField;
}

function subscribeOpenField(cb: () => void): () => void {
  openFieldListeners.add(cb);
  return () => {
    openFieldListeners.delete(cb);
  };
}

/** React binding: re-renders when a field opens or closes. `null` on the server. */
export function useOpenField(): OpenField | null {
  return useSyncExternalStore(subscribeOpenField, getOpenField, () => null);
}

/** How long after a double-tap open its compat mouse events are ignored (ms). */
export const TAP_SWALLOW_MS = 1500;

let tapOpenedAt = -Infinity;

/**
 * Call right after a touch double TAP opened a field. The browser follows
 * the second tap with compat `mousedown`/`click`/`dblclick` at the tap
 * point — after the focus zoom and the swapped field children that point
 * is often ANOTHER element: the `mousedown` would move the focus to it (or
 * `<body>`), `focusout` commits and closes the field just opened, and the
 * `dblclick` opens a different one. The cancelable `touchend` cannot be
 * relied on (its target node may have been replaced), so: one capture
 * listener cancels the next `mousedown` within `TAP_SWALLOW_MS`, and the
 * editors ignore a `dblclick` in that window (`isTapEcho`).
 */
export function swallowTapMouseDown(): void {
  if (typeof document === "undefined") return;
  tapOpenedAt = Date.now();
  swallowNextMouseDown();
}

/**
 * Cancels the next `mousedown` (within `TAP_SWALLOW_MS`): the compat event
 * of a touch tap, so it does not move the focus. Review E1: a tap on ANOTHER
 * field while one is open keeps the open one (no blur, no commit, no
 * re-render under the finger) — if it is the first half of a double tap,
 * `open(next)` commits the open field and opens the next one; a single tap
 * changes nothing (the slide editor's rule; «Tayyor» or back end the edit).
 */
export function swallowNextMouseDown(): void {
  if (typeof document === "undefined") return;
  // No clock check inside: under load the compat event can be late; the timer below bounds the window.
  const onDown = (e: Event) => {
    document.removeEventListener("mousedown", onDown, true);
    e.preventDefault();
  };
  document.addEventListener("mousedown", onDown, true);
  setTimeout(() => document.removeEventListener("mousedown", onDown, true), TAP_SWALLOW_MS);
}

/** A `dblclick` right after a double-tap open is that tap's echo, not a new gesture. */
export function isTapEcho(): boolean {
  return Date.now() - tapOpenedAt < TAP_SWALLOW_MS;
}
