"use client";

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
