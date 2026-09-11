"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { renderCitations, type ArticlePlan } from "@/lib/generation/article/layout";
import { langKeyOf, parseBlockPath, type ArticleLang, type ArticleOp } from "@/lib/generation/article/edit";
import type { AcademicDoc } from "@/lib/generation/types";
import type { FlowItem } from "@/lib/viewers/flow";
import { focusAtEnd } from "./editable";

/**
 * Maqola TAHRIR qatlami (Maqola 2, AUDIT-17 WP7) — `ResumeEditor` naqshi:
 * matnning O'ZI `contentEditable` bo'ladi (varaq bitta, joyi bitta —
 * «ko'rdim = oldim» buzilmaydi), hodisalar ILDIZDA (delegatsiya: varaq
 * har tahrirdan keyin qayta chiziladi).
 *
 * Rezyumedan IKKI farq — ikkalasi ham maqolaning «yagona manba» qaroridan
 * kelib chiqadi (ekrandagi matn ≠ hujjatdagi matn):
 *
 *   1. IQTIBOSLAR. Ekranda «[1; 25-b.]», hujjatda `[W2741809807; 25-b.]`.
 *      Maydon ochilganda matn HUJJATDAN (raw) yig'iladi: oddiy matn
 *      tugunlari + iqtibos guruhlari `contenteditable=false` span sifatida
 *      (`data-cite-raw` — xom guruh, ko'rinishi `renderCitations` bilan
 *      raqamli). Foydalanuvchi ularni butun holda o'chira oladi
 *      (Backspace), ichini buza olmaydi; saqlashda `readRaw` span o'rniga
 *      xom guruhni qaytaradi — `[W…]` id lar yo'qolmaydi.
 *
 *   2. RAQAMLAR. «1-rasm.», «1.», «2.1.» — rejadan (`planArticle`);
 *      ochilganda faqat sarlavha/matn ko'rsatiladi, raqam op ga kirmaydi.
 *
 * React tugunlari SAQLANADI: ochilganda elementning bolalari chetga
 * olinadi (`keep`), yopilganda qaytariladi — React o'z tugunlarini
 * yangilashda davom etadi (yangi tugun yaratilsa React eski, uzilgan
 * tugunga yozardi va ekran eskirib qolardi).
 *
 * Iqtibosni olib tashlash: `.word-cite` ustida bosish — birinchisi
 * «qurollantiradi» (3 s), ikkinchisi `refRemove` (manba ro'yxatdan va
 * barcha iqtiboslardan chiqadi) — `useConfirmClick` bilan bir xil qaror.
 *
 * Bo'sh qoldirib Enter — blok o'chadi (`blockRemove`).
 */

/* ────────────────────────── nishonlar ────────────────────────── */

export type EditTarget =
  | { t: "text"; path: string }
  | { t: "heading"; sectionId: string }
  | { t: "abstract"; lang: string }
  | { t: "highlights" }
  | { t: "figure"; id: string }
  | { t: "table"; id: string }
  | { t: "row"; tableId: string; r: number };

/** `data-path` qiymati (katak uchun ustun `WordViewer` qo'shadi). */
export function targetAttr(t: EditTarget): string {
  switch (t.t) {
    case "text":
      return t.path;
    case "heading":
      return `heading:${t.sectionId}`;
    case "abstract":
      return `abstract:${t.lang}`;
    case "highlights":
      return "highlights";
    case "figure":
      return `caption:figure:${t.id}`;
    case "table":
      return `caption:table:${t.id}`;
    case "row":
      return `cell:${t.tableId}:${t.r}`;
  }
}

type Parsed =
  | { t: "text"; path: string }
  | { t: "heading"; sectionId: string }
  | { t: "abstract"; lang: ArticleLang }
  | { t: "highlights" }
  | { t: "caption"; target: "figure" | "table"; id: string }
  | { t: "cell"; tableId: string; r: number; c: number };

export function parseTarget(s: string): Parsed | null {
  if (parseBlockPath(s)) return { t: "text", path: s };
  if (s === "highlights") return { t: "highlights" };
  const parts = s.split(":");
  if (parts[0] === "heading" && parts[1]) return { t: "heading", sectionId: parts.slice(1).join(":") };
  if (parts[0] === "abstract" && parts[1]) return { t: "abstract", lang: langKeyOf(parts[1]) };
  if (parts[0] === "caption" && (parts[1] === "figure" || parts[1] === "table") && parts[2]) return { t: "caption", target: parts[1], id: parts.slice(2).join(":") };
  if (parts[0] === "cell" && parts.length === 4) {
    const r = Number(parts[2]);
    const c = Number(parts[3]);
    if (Number.isInteger(r) && Number.isInteger(c) && r >= -1 && c >= 0) return { t: "cell", tableId: parts[1], r, c };
  }
  return null;
}

/**
 * Oqim bandi → tahrir nishoni. `articleFlow` rejani QAT'IY tartibda
 * bandlarga o'giradi (bosh blok, tana, adabiyotlar); bu yerda o'sha
 * tartib qaytadan yuriladi va har bandning `id` si nishonga bog'lanadi.
 * Bitta band ham mos kelmasa (reja ≠ oqim) — bo'sh xarita: noto'g'ri
 * blokni tahrirlashdan ko'ra tahrirsiz qolgan yaxshi.
 */
export function articleEditTargets(plan: ArticlePlan, items: FlowItem[]): Map<string, EditTarget> {
  const map = new Map<string, EditTarget>();
  let k = 0;
  const next = (type: FlowItem["type"]): FlowItem | null => {
    const it = items[k++];
    return it && it.type === type ? it : null;
  };
  for (const h of plan.head) {
    const type: FlowItem["type"] = h.k === "udk" ? "udk" : h.k === "title" ? "articleTitle" : h.k === "authors" ? "authors" : h.k === "abstract" ? "abstract" : "highlights";
    const it = next(type);
    if (!it) return new Map();
    if (h.k === "abstract") map.set(it.id, { t: "abstract", lang: langKeyOf(h.lang) });
    else if (h.k === "highlights") map.set(it.id, { t: "highlights" });
  }
  for (const b of plan.body) {
    if (b.k === "table") {
      const head = next("table-head");
      if (!head) return new Map();
      map.set(head.id, { t: "table", id: b.tableId });
      for (let r = 0; r < b.table.rows.length; r++) {
        const row = next("table-row");
        if (!row) return new Map();
        map.set(row.id, { t: "row", tableId: b.tableId, r });
      }
      continue;
    }
    const it = next(b.k);
    if (!it) return new Map();
    switch (b.k) {
      case "h1":
        // Bo'lim sarlavhasi (`sectionId` bor) — `heading`; blok ichidagi h1 — oddiy matn.
        map.set(it.id, b.sectionId ? { t: "heading", sectionId: b.sectionId } : { t: "text", path: b.path });
        break;
      case "figure":
        map.set(it.id, { t: "figure", id: b.figureId });
        break;
      case "formula":
        // Formula LaTeX — KaTeX chizmasi ustida tahrir qilinmaydi (WP7 dan tashqarida).
        break;
      default:
        map.set(it.id, { t: "text", path: b.path });
    }
  }
  return map;
}

/**
 * Eski maqola (`doc.article` yo'q) — umumiy `docToFlow` tartibi: titul,
 * mundarija, annotatsiyalar, bo'limlar (h1 + bloklar), jadvallar,
 * adabiyotlar. Faqat matn nishonlari (bo'lim sarlavhasi, bloklar,
 * jadval kataklari) — annotatsiya/manba modeli unda yo'q.
 */
export function legacyEditTargets(doc: AcademicDoc, items: FlowItem[]): Map<string, EditTarget> {
  const map = new Map<string, EditTarget>();
  let k = 0;
  const next = (type: FlowItem["type"]): FlowItem => {
    const it = items[k++];
    if (!it || it.type !== type) throw new Error("mismatch");
    return it;
  };
  const blockType = (kind: string): FlowItem["type"] =>
    kind === "h1" || kind === "h2" || kind === "h3" || kind === "li" || kind === "quote" || kind === "code" ? (kind as FlowItem["type"]) : "p";
  try {
    if (doc.titlePage) next("title");
    if (doc.toc) next("toc");
    (doc.abstracts ?? []).forEach(() => next("abstract"));
    doc.sections.forEach((s, si) => {
      if (!s.blocks.length) return;
      map.set(next("h1").id, { t: "heading", sectionId: s.id });
      s.blocks.forEach((b, bi) => map.set(next(blockType(b.kind)).id, { t: "text", path: `sections.${si}.blocks.${bi}` }));
    });
    for (const tb of doc.tables ?? []) {
      const head = next("table-head");
      if (tb.id) map.set(head.id, { t: "table", id: tb.id });
      tb.rows.forEach((_, r) => {
        const row = next("table-row");
        if (tb.id) map.set(row.id, { t: "row", tableId: tb.id, r });
      });
    }
  } catch {
    return new Map();
  }
  return map;
}

/* ────────────────────────── matn ⇄ DOM ────────────────────────── */

const GROUP_RE = /\[([^\[\]\n]{1,240})\]/g;

/** Ko'p qatorli maydonlar — Shift+Enter yangi qator. */
function multiline(p: Parsed, doc: AcademicDoc): boolean {
  if (p.t === "abstract" || p.t === "highlights") return true;
  if (p.t === "text") {
    const b = blockOf(doc, p.path);
    return b?.kind === "code";
  }
  return false;
}

function blockOf(doc: AcademicDoc, path: string) {
  const i = parseBlockPath(path);
  return i ? doc.sections[i.si]?.blocks[i.bi] : undefined;
}

/** Nishonning HUJJATDAGI xom matni (`null` — topilmadi). */
export function rawTextOf(doc: AcademicDoc, p: Parsed): string | null {
  switch (p.t) {
    case "text":
      return blockOf(doc, p.path)?.text ?? null;
    case "heading":
      return doc.sections.find((s) => s.id === p.sectionId)?.title ?? null;
    case "abstract":
      return (doc.abstracts ?? []).find((a) => langKeyOf(a.lang) === p.lang)?.text ?? null;
    case "highlights":
      return (doc.article?.highlights ?? []).join("\n");
    case "caption":
      if (p.target === "figure") return doc.article?.figures.find((f) => f.id === p.id)?.caption ?? null;
      return (doc.tables ?? []).find((t) => t.id === p.id)?.caption ?? "";
    case "cell": {
      const t = (doc.tables ?? []).find((x) => x.id === p.tableId);
      if (!t) return null;
      return p.r === -1 ? (t.headers[p.c] ?? null) : (t.rows[p.r]?.[p.c] ?? null);
    }
  }
}

/**
 * Xom matn → tahrir tugunlari: iqtibos guruhi (`[W…]`, `[fig:f1]`) —
 * o'chirilmas span, ko'rinishi rejadagidek (`renderCitations`); qolgani
 * — matn tugunlari. Rejasiz (eski maqola) hamma narsa oddiy matn.
 */
export function editNodes(raw: string, plan: ArticlePlan | null, d: Document): Node[] {
  const out: Node[] = [];
  if (!plan) return [d.createTextNode(raw)];
  const refs = plan.refs.map((r) => r.ref);
  let last = 0;
  let m: RegExpExecArray | null;
  GROUP_RE.lastIndex = 0;
  while ((m = GROUP_RE.exec(raw))) {
    const r = renderCitations(m[0], refs, plan.cite, plan.language, plan.numbers);
    const isCite = r.spans.some((s) => s.cite);
    // Reyestrda yo'q id (`[W999]`) yoki oddiy qavs — matn sifatida qoladi.
    if (!isCite && r.text === m[0]) continue;
    if (m.index > last) out.push(d.createTextNode(raw.slice(last, m.index)));
    const span = d.createElement("span");
    span.setAttribute("data-cite-raw", m[0]);
    span.setAttribute("contenteditable", "false");
    span.className = isCite ? "word-cite" : "word-cite-ref";
    const cite = r.spans.find((s) => s.cite)?.cite;
    if (cite) {
      span.setAttribute("data-ref-verified", cite.verified);
      span.setAttribute("data-ref-ids", cite.ids.join(" "));
    }
    span.textContent = r.text || m[0];
    out.push(span);
    last = m.index + m[0].length;
  }
  if (last < raw.length || !out.length) out.push(d.createTextNode(raw.slice(last)));
  return out;
}

/**
 * Tahrir maydonidan XOM matn: iqtibos spanlari `data-cite-raw` bilan,
 * `<br>`/blok tugunlari `\n` (`editable.ts readText` bilan bir xil
 * qoida, faqat iqtibos qo'shilgan).
 */
export function readRaw(el: Node): string {
  let out = "";
  const walk = (n: Node, first: boolean) => {
    if (n.nodeType === 3) {
      out += n.nodeValue ?? "";
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as Element;
    const raw = e.getAttribute("data-cite-raw");
    if (raw !== null) {
      out += raw;
      return;
    }
    const tag = e.tagName;
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
  return out.replace(/\n$/, "");
}

/** Xom matn → op lar (o'zgarmagan bo'lsa bo'sh). */
export function opsFor(doc: AcademicDoc, p: Parsed, before: string, value: string): ArticleOp[] {
  if (value === before) return [];
  switch (p.t) {
    case "text": {
      const b = blockOf(doc, p.path);
      if (!b) return [];
      const empty = !value.trim();
      // Bo'sh qoldirilgan matn bloki — o'chadi; rasm/jadval/formula sarlavhasi bo'sh bo'lishi mumkin.
      if (empty && (b.kind === "figure" || b.kind === "tableRef")) return [{ op: "text", path: p.path, value: "" }];
      if (empty) return [{ op: "blockRemove", path: p.path }];
      return [{ op: "text", path: p.path, value }];
    }
    case "heading":
      return value.trim() ? [{ op: "heading", sectionId: p.sectionId, title: value }] : [];
    case "abstract":
      return value.trim() ? [{ op: "abstract", lang: p.lang, text: value }] : [];
    case "highlights":
      return [{ op: "highlights", items: value.split("\n").map((s) => s.trim()).filter(Boolean) }];
    case "caption":
      return [{ op: "caption", target: p.target, id: p.id, value }];
    case "cell":
      return p.r === -1 && !value.trim() ? [] : [{ op: "cell", tableId: p.tableId, r: p.r, c: p.c, value }];
  }
}

/* ────────────────────────── komponent ────────────────────────── */

export type ArticleEditorProps = {
  doc: AcademicDoc;
  /** Reja — iqtibos ko'rinishi uchun; eski maqolada `null`. */
  plan: ArticlePlan | null;
  onOps: (ops: ArticleOp[]) => void;
  children: ReactNode;
};

const ARM_MS = 3000;

const STYLE = `
[data-article-editor] [data-path]{cursor:text}
[data-article-editor] [data-article-editing]{outline:2px solid #0ea5e9;outline-offset:2px;background:#f0f9ff;white-space:pre-wrap}
[data-article-editor] .word-cite{cursor:pointer;border-bottom:1px dashed #0ea5e9}
[data-article-editor] .word-cite[data-cite-armed]{background:#fee2e2;outline:1px solid #ef4444;border-radius:2px}
[data-article-editor] [data-article-editing] .word-cite{cursor:default;background:#e0f2fe;border-radius:2px}
`;

export function ArticleEditor({ doc, plan, onOps, children }: ArticleEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /** Ochiq maydon: element, nishon, xom matn, chetga olingan React tugunlari. */
  const openRef = useRef<{ el: HTMLElement; p: Parsed; initial: string; keep: Node[]; multi: boolean } | null>(null);
  const armRef = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);

  const docRef = useRef(doc);
  docRef.current = doc;
  const planRef = useRef(plan);
  planRef.current = plan;
  const onOpsRef = useRef(onOps);
  onOpsRef.current = onOps;

  const close = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    /*
     * AVVAL ref tozalanadi, keyin DOM: Chromium `contenteditable` olib
     * tashlanganda `focusout` ni SINXRON yuboradi — `onFocusOut` shu
     * paytda `commit` ni qayta chaqirsa, bitta tahrir uchun ikkita bir xil
     * op navbatga tushardi («Saqlash · 2», Ctrl+Z bir bosishda qaytmasdi).
     * jsdom buni qilmaydi — brauzer smoke'da topildi.
     */
    openRef.current = null;
    cur.el.removeAttribute("contenteditable");
    cur.el.removeAttribute("data-article-editing");
    // React tugunlari qaytadi — undan keyingi render ularni yangilaydi.
    cur.el.replaceChildren(...cur.keep);
  }, []);

  const commit = useCallback(() => {
    const cur = openRef.current;
    if (!cur) return;
    const value = readRaw(cur.el);
    close();
    // O'zgarmagan matn uchun operatsiya YUBORILMAYDI (bo'sh PATCH bo'lmasin).
    const ops = opsFor(docRef.current, cur.p, cur.initial, value);
    if (ops.length) onOpsRef.current(ops);
  }, [close]);

  const cancel = useCallback(() => close(), [close]);

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  const open = useCallback((el: HTMLElement) => {
    const attr = el.getAttribute("data-path");
    const p = attr ? parseTarget(attr) : null;
    if (!p) return;
    if (openRef.current?.el === el) return;
    if (openRef.current) commitRef.current();
    const raw = rawTextOf(docRef.current, p);
    if (raw === null) return;
    const keep = Array.from(el.childNodes);
    el.replaceChildren(...editNodes(raw, planRef.current, el.ownerDocument));
    openRef.current = { el, p, initial: raw, keep, multi: multiline(p, docRef.current) };
    el.setAttribute("contenteditable", "true");
    el.setAttribute("data-article-editing", "1");
    focusAtEnd(el);
  }, []);

  const disarm = useCallback(() => {
    const a = armRef.current;
    if (!a) return;
    clearTimeout(a.timer);
    a.el.removeAttribute("data-cite-armed");
    armRef.current = null;
  }, []);

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
      if (ev.shiftKey && cur.multi) return;
      ev.preventDefault();
      commitRef.current();
    };
    const onFocusOut = (ev: FocusEvent) => {
      const cur = openRef.current;
      if (!cur || ev.target !== cur.el) return;
      commitRef.current();
    };
    /*
     * Iqtibosni olib tashlash — ikki bosish. Ochiq maydon ichidagi
     * spanlar (o'zimizniki, `data-cite-raw`) bunga kirmaydi: u yerda
     * foydalanuvchi Backspace bilan o'chiradi.
     */
    const onClick = (ev: Event) => {
      const span = (ev.target as HTMLElement | null)?.closest?.(".word-cite[data-ref-ids]") as HTMLElement | null;
      if (!span || !host.contains(span) || span.closest("[data-article-editing]")) {
        disarm();
        return;
      }
      ev.preventDefault();
      if (armRef.current?.el === span) {
        const ids = (span.getAttribute("data-ref-ids") ?? "").split(/\s+/).filter(Boolean);
        disarm();
        if (ids.length) onOpsRef.current(ids.map((refId) => ({ op: "refRemove", refId })));
        return;
      }
      disarm();
      span.setAttribute("data-cite-armed", "1");
      span.setAttribute("title", "Yana bir bosing — manba ro‘yxatdan va barcha iqtiboslardan olib tashlanadi");
      armRef.current = { el: span, timer: setTimeout(() => disarm(), ARM_MS) };
    };

    host.addEventListener("dblclick", onDbl);
    host.addEventListener("keydown", onKey);
    host.addEventListener("focusout", onFocusOut);
    host.addEventListener("click", onClick);
    return () => {
      host.removeEventListener("dblclick", onDbl);
      host.removeEventListener("keydown", onKey);
      host.removeEventListener("focusout", onFocusOut);
      host.removeEventListener("click", onClick);
      disarm();
    };
  }, [open, disarm]);

  // Qatlam yopilganda ochiq maydon React tugunlari bilan qoladi.
  useEffect(() => () => close(), [close]);

  return (
    <div ref={rootRef} data-article-editor>
      {/* CSP `style-src 'unsafe-inline'` — inline uslub ruxsat etilgan; `globals.css` ga tegilmaydi. */}
      <style>{STYLE}</style>
      {children}
    </div>
  );
}
