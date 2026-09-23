/**
 * TXT / Markdown / CSV adapteri.
 *
 * OOXML dan farqli o'laroq bu yerda «tuzilma» = matnning O'ZI, shuning
 * uchun saqlash qoidasi boshqacha: har qatorning PREFIKSI (`## `, `- `,
 * `> `, jadval `|`), kod bloklari, CSV ajratgichi, qo'shtirnoq va qator
 * yakuni AYNAN o'z holicha qoldiriladi, modelga esa faqat ma'noli matn
 * boradi.
 *
 * Markdown ning ichki belgilari (`**qalin**`, `` `kod` ``, `[matn](url)`)
 * tokenlarga aylanadi: model matnni tarjima qiladi, biz esa belgilarni
 * o'z joyiga QAYTARAMIZ. Aks holda model `**` ni ko'chirib yuborar
 * (yoki tarjima qilar) va hujjat formatlashi buzilardi.
 */

import {
  MAX_RUN_MARKERS,
  type Extracted,
  type Segment,
  type SegmentKind,
  type SegmentMap,
} from "./segments";

/** Qator yakuni manbadagidek qoladi — Windows fayli Windows bo'lib qoladi. */
function eolOf(text: string): string {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

function splitBom(text: string): { bom: string; body: string } {
  return text.startsWith("﻿") ? { bom: "﻿", body: text.slice(1) } : { bom: "", body: text };
}

function toTokens(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\n/g, "⟦br⟧").replace(/\t/g, "⟦tab⟧");
}

function fromTokens(s: string, eol: string): string {
  return s.replace(/⟦br⟧/g, eol).replace(/⟦tab⟧/g, "\t");
}

/* ── TXT ─────────────────────────────────────────────────────────── */

type TxtPart = { text: string; sep: string };

/**
 * Bo'sh qator paragraflarni ajratadi; paragraf ichidagi yakka qator
 * uzilishi `⟦br⟧` bo'lib saqlanadi (she'r, manzil, ro'yxat).
 */
function txtParts(body: string): TxtPart[] {
  const out: TxtPart[] = [];
  let at = 0;
  for (let m = paraBreak(body, 0); m; m = paraBreak(body, at)) {
    out.push({ text: body.slice(at, m[0]), sep: body.slice(m[0], m[1]) });
    at = m[1];
  }
  /*
   * Oxirgi paragrafning ORTIDAGI bo'shliq segmentga kirmaydi.
   *
   * Deyarli har matn fayli `\n` bilan tugaydi va usiz oxirgi segment
   * `…yerda.⟦br⟧` bo'lib chiqardi: model uchun ma'nosiz token, tarjimada
   * esa yo'qolib faylning oxirgi qator uzilishini olib ketardi.
   */
  const tail = body.slice(at);
  const keep = tail.trimEnd().length;
  out.push({ text: tail.slice(0, keep), sep: tail.slice(keep) });
  return out;
}

/*
 * SECB-01: bu fayldagi regexlar CHIZIQLI kod bilan almashtirildi.
 *
 * `/(?:[ \t]*\r?\n){2,}[ \t]*`, `/\s*$/`, `inlineOf` dagi `[\s\S]*?` lar va
 * `inlineBack` dagi `⟦l1⟧…⟦/l1⟧` juftlagichi «yopilmagan» uzun qatorda har
 * boshlanish nuqtasidan oxirigacha qayta skanerlardi — O(n²), 200 000 belgi
 * o'nlab soniya. Quyidagilar o'sha regexlar bilan AYNAN bir xil natija
 * beradi. `/\s*$/` o'rniga `trimEnd()`: ECMAScript da `\s` va `trim` bir xil
 * belgilar to'plami (WhiteSpace + LineTerminator).
 */

function isBlankCode(c: number): boolean {
  return c === 32 || c === 9;
}

/**
 * `/(?:[ \t]*\r?\n){2,}[ \t]*` ning `from` dan keyingi birinchi mosligi
 * (`[start, end)`) — chiziqli.
 *
 * Moslik doim `\n` dan boshlanadigan guruh atrofida: eng chapdagi boshlanish
 * shu `\n` oldidagi ixtiyoriy `\r` va `[ \t]` yugurishining boshi (lekin
 * `from` dan oldin emas). Ikkinchi guruh bo'lmasa, shu `\n` dan oldingi har
 * boshlanish ham aynan shu joyda yiqiladi — qidiruv keyingi `\n` dan davom etadi.
 */
function paraBreak(body: string, from: number): [number, number] | null {
  let pos = from;
  for (;;) {
    const nl = body.indexOf("\n", pos);
    if (nl < 0) return null;
    let start = nl;
    if (start - 1 >= pos && body.charCodeAt(start - 1) === 13) start--;
    while (start - 1 >= pos && isBlankCode(body.charCodeAt(start - 1))) start--;
    let end = nl + 1;
    let groups = 1;
    for (;;) {
      let j = end;
      while (j < body.length && isBlankCode(body.charCodeAt(j))) j++;
      if (body.charCodeAt(j) === 10) {
        end = j + 1;
        groups++;
      } else if (body.charCodeAt(j) === 13 && body.charCodeAt(j + 1) === 10) {
        end = j + 2;
        groups++;
      } else {
        if (groups >= 2) return [start, j];
        break;
      }
    }
    pos = nl + 1;
  }
}

const WS_RE = /\s/;
/** Regexdagi `\s` (bitta UTF-16 birligi uchun). */
function isWsCode(c: number): boolean {
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return WS_RE.test(String.fromCharCode(c));
}

/** O'sish tartibidagi `list` da `>= p` bo'lgan birinchi qiymat (yo'q bo'lsa -1). */
function firstAtOrAfter(list: number[], p: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid] < p) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? list[lo] : -1;
}

/** `src` dagi `pred` ga mos belgilarning o'rinlari (o'sish tartibida). */
function positionsOf(src: string, pred: (c: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) if (pred(src.charCodeAt(i))) out.push(i);
  return out;
}

/**
 * Backtick yugurishlari: «`from` dan keyin boshlanadigan, uzunligi `>= r`
 * bo'lgan birinchi yugurish» so'rovi uchun maksimum segment daraxti.
 */
class TickRuns {
  private starts: number[] = [];
  private tree: Int32Array;
  private size = 1;

  constructor(src: string) {
    const lens: number[] = [];
    for (let i = 0; i < src.length; ) {
      if (src.charCodeAt(i) !== 96) {
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && src.charCodeAt(j) === 96) j++;
      this.starts.push(i);
      lens.push(j - i);
      i = j;
    }
    while (this.size < lens.length) this.size *= 2;
    this.tree = new Int32Array(this.size * 2);
    for (let k = 0; k < lens.length; k++) this.tree[this.size + k] = lens[k];
    for (let k = this.size - 1; k >= 1; k--) this.tree[k] = Math.max(this.tree[2 * k], this.tree[2 * k + 1]);
  }

  /** `from` dan boshlanib `r` tadan kam bo'lmagan birinchi yugurish boshi, yo'q bo'lsa -1. */
  find(from: number, r: number): number {
    let lo = 0;
    let hi = this.starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    const k = this.firstAtLeast(1, 0, this.size, lo, r);
    return k < 0 ? -1 : this.starts[k];
  }

  private firstAtLeast(node: number, nl: number, nr: number, k: number, r: number): number {
    if (nr <= k || this.tree[node] < r) return -1;
    if (nr - nl === 1) return nl < this.starts.length ? nl : -1;
    const mid = (nl + nr) >>> 1;
    const left = this.firstAtLeast(2 * node, nl, mid, k, r);
    return left >= 0 ? left : this.firstAtLeast(2 * node + 1, mid, nr, k, r);
  }
}

const MARK_DELIMS = ["**", "__", "~~", "*", "_"] as const;

/**
 * Bitta qator ichidagi belgilar indeksi — `inlineOf` dagi har tekshiruv
 * O(log n): kerakli ro'yxatlar birinchi so'rovda bir marta quriladi.
 */
class InlineIndex {
  private cache = new Map<string, number[]>();
  private ticks: TickRuns | null = null;

  constructor(private src: string) {}

  private list(key: string, build: () => number[]): number[] {
    let l = this.cache.get(key);
    if (!l) {
      l = build();
      this.cache.set(key, l);
    }
    return l;
  }

  /** `/^(`+)([^`]|[^`][\s\S]*?)\1/` ning `i` dagi mosligi oxiri, yo'q bo'lsa -1. */
  code(i: number): number {
    const src = this.src;
    let r = 0;
    while (i + r < src.length && src.charCodeAt(i + r) === 96) r++;
    // Qisqaroq ochuvchi mos kelmaydi: undan keyingi belgi yana backtick bo'ladi.
    if (i + r >= src.length) return -1;
    this.ticks ??= new TickRuns(src);
    const close = this.ticks.find(i + r + 1, r);
    return close < 0 ? -1 : close + r;
  }

  /** `/^<(?:https?:\/\/|mailto:)[^>\s]+>/` ning `i` dagi mosligi oxiri, yo'q bo'lsa -1. */
  autolink(i: number): number {
    const src = this.src;
    const p = src.startsWith("https://", i + 1) ? 8 : src.startsWith("http://", i + 1) ? 7 : src.startsWith("mailto:", i + 1) ? 7 : 0;
    if (!p) return -1;
    const q = i + 1 + p;
    const stops = this.list(">ws", () => positionsOf(src, (c) => c === 62 || isWsCode(c)));
    const j = firstAtOrAfter(stops, q);
    return j > q && src.charCodeAt(j) === 62 ? j + 1 : -1;
  }

  /** `/^(!?)\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/` mosligi. */
  link(i: number): { end: number; bang: boolean; label: string; target: string } | null {
    const src = this.src;
    const bang = src.charCodeAt(i) === 33;
    const lb = i + (bang ? 1 : 0);
    if (src.charCodeAt(lb) !== 91) return null;
    const rbs = this.list("]", () => positionsOf(src, (c) => c === 93));
    const c1 = firstAtOrAfter(rbs, lb + 1);
    if (c1 < 0) return null;
    const next = src.charCodeAt(c1 + 1);
    let c2 = -1;
    if (next === 40) c2 = firstAtOrAfter(this.list(")", () => positionsOf(src, (c) => c === 41)), c1 + 2);
    else if (next === 91) c2 = firstAtOrAfter(rbs, c1 + 2);
    if (c2 < 0) return null;
    return { end: c2 + 1, bang, label: src.slice(lb + 1, c1), target: src.slice(c1 + 1, c2 + 1) };
  }

  /** `/^(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/` mosligi. */
  mark(i: number): { delim: string; inner: string; end: number } | null {
    const src = this.src;
    for (const d of MARK_DELIMS) {
      if (!src.startsWith(d, i)) continue;
      const s0 = i + d.length;
      if (s0 >= src.length || isWsCode(src.charCodeAt(s0))) continue;
      // Yopuvchi: `d` ning o'zi, oldidagi belgi bo'shliq emas.
      const closers = this.list(`m${d}`, () => {
        const out: number[] = [];
        for (let e = 1; e < src.length; e++) {
          if (src.startsWith(d, e) && !isWsCode(src.charCodeAt(e - 1))) out.push(e);
        }
        return out;
      });
      const e = firstAtOrAfter(closers, s0 + 1);
      if (e >= 0) return { delim: d, inner: src.slice(s0, e), end: e + d.length };
    }
    return null;
  }
}

/**
 * `/⟦L(\d+)⟧([\s\S]*?)⟦\/L\1⟧/g` bilan `replace` — chiziqli teng variant.
 * Yopuvchi tokenlar raqami bo'yicha oldindan yig'iladi.
 */
function replacePairs(text: string, letter: "l" | "r", fn: (n: string, inner: string) => string): string {
  const open = `⟦${letter}`;
  const closeHead = `⟦/${letter}`;
  const closes = new Map<string, number[]>();
  for (let at = text.indexOf(closeHead); at >= 0; at = text.indexOf(closeHead, at + 1)) {
    let k = at + closeHead.length;
    while (k < text.length && text.charCodeAt(k) >= 48 && text.charCodeAt(k) <= 57) k++;
    if (k === at + closeHead.length || text[k] !== "⟧") continue;
    const n = text.slice(at + closeHead.length, k);
    let l = closes.get(n);
    if (!l) closes.set(n, (l = []));
    l.push(at);
  }
  if (!closes.size) return text;
  let out = "";
  let from = 0;
  for (let at = text.indexOf(open); at >= 0; ) {
    let k = at + open.length;
    while (k < text.length && text.charCodeAt(k) >= 48 && text.charCodeAt(k) <= 57) k++;
    if (k === at + open.length || text[k] !== "⟧") {
      at = text.indexOf(open, at + 1);
      continue;
    }
    const n = text.slice(at + open.length, k);
    const c = firstAtOrAfter(closes.get(n) ?? [], k + 1);
    if (c < 0) {
      at = text.indexOf(open, at + 1);
      continue;
    }
    out += text.slice(from, at) + fn(n, text.slice(k + 1, c));
    from = c + closeHead.length + n.length + 1;
    at = text.indexOf(open, from);
  }
  return from ? out + text.slice(from) : text;
}

export function textToSegments(text: string): Extracted {
  const { body } = splitBom(text);
  const segments: Segment[] = [];
  txtParts(body).forEach((p, i) => {
    if (!p.text.trim()) return;
    segments.push({ id: `t:${i}`, text: toTokens(p.text), kind: "p", part: "text" });
  });
  return { segments, chars: 0, warnings: [] };
}

export function applyText(text: string, map: SegmentMap): string {
  const { bom, body } = splitBom(text);
  const eol = eolOf(text);
  let out = "";
  txtParts(body).forEach((p, i) => {
    const t = map.get(`t:${i}`);
    out += t === undefined || !t.trim() ? p.text : fromTokens(t, eol);
    out += p.sep;
  });
  return bom + out;
}

/* ── Markdown ────────────────────────────────────────────────────── */

/**
 * Bitta qatordan olingan ichki belgilar.
 *
 * Apply MANBANI qaytadan o'qib shu ro'yxatni tiklaydi — hech qanday
 * oraliq holat saqlanmaydi, ya'ni extract va apply hech qachon
 * ajralib ketmaydi.
 */
type Inline = { text: string; opaques: string[]; links: string[]; marks: string[] };


function inlineOf(src: string): Inline {
  const opaques: string[] = [];
  const links: string[] = [];
  const marks: string[] = [];
  let out = "";
  let i = 0;
  const idx = new InlineIndex(src);

  while (i < src.length) {
    // Har tekshiruv o'z birinchi belgisini talab qiladi — shu bo'yicha tanlanadi.
    const c = src.charCodeAt(i);

    // Kod: `x` — mazmuni kod, tarjima qilinmaydi.
    if (c === 96) {
      const end = idx.code(i);
      if (end > 0) {
        opaques.push(src.slice(i, end));
        out += `⟦${opaques.length}⟧`;
        i = end;
        continue;
      }
    }
    // Avtomatik havola: <https://…>
    if (c === 60) {
      const end = idx.autolink(i);
      if (end > 0) {
        opaques.push(src.slice(i, end));
        out += `⟦${opaques.length}⟧`;
        i = end;
        continue;
      }
    }
    if (c === 33 || c === 91) {
      const link = idx.link(i);
      if (link) {
        if (link.bang) {
          // Rasm — `alt` matni ham tarjimaga arzimaydigan darajada texnik.
          opaques.push(src.slice(i, link.end));
          out += `⟦${opaques.length}⟧`;
        } else {
          links.push(link.target);
          out += `⟦l${links.length}⟧${link.label}⟦/l${links.length}⟧`;
        }
        i = link.end;
        continue;
      }
    }
    // Ta'kid: **x** __x__ ~~x~~ *x* _x_
    if ((c === 42 || c === 95 || c === 126) && marks.length < MAX_RUN_MARKERS) {
      const mark = idx.mark(i);
      if (mark) {
        marks.push(mark.delim);
        out += `⟦r${marks.length}⟧${mark.inner}⟦/r${marks.length}⟧`;
        i = mark.end;
        continue;
      }
    }
    out += src[i];
    i++;
  }
  return { text: out.replace(/\t/g, "⟦tab⟧"), opaques, links, marks };
}

/** Tokenlarni asl Markdown belgilariga qaytaradi. */
function inlineBack(text: string, meta: Inline): string {
  const withOpaques = text.replace(/⟦(\d+)⟧/g, (m, n: string) => meta.opaques[Number(n) - 1] ?? "");
  const withLinks = replacePairs(withOpaques, "l", (n, inner) => `[${inner}]${meta.links[Number(n) - 1] ?? ""}`);
  return replacePairs(withLinks, "r", (n, inner) => {
    const d = meta.marks[Number(n) - 1] ?? "";
    return `${d}${inner}${d}`;
  })
    // Juftini yo'qotgan markerlar — matn baribir saqlanadi.
    .replace(/⟦\/?[rl]\d+⟧/g, "")
    .replace(/⟦tab⟧/g, "\t");
}

const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEP = /^[\s|:-]+$/;
const MD_PREFIX = /^(\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?)/;

type MdLine =
  | { t: "pass" }
  | { t: "line"; prefix: string; kind: SegmentKind; inline: Inline }
  | { t: "row"; cells: Array<{ lead: string; inline: Inline; tail: string }> };

function scanMd(body: string): MdLine[] {
  const lines = body.split(/\r?\n/);
  let fence = "";
  return lines.map((line) => {
    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = "";
      return { t: "pass" } as MdLine;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      return { t: "pass" };
    }
    if (TABLE_ROW.test(line) && line.includes("|")) {
      if (TABLE_SEP.test(line)) return { t: "pass" };
      // Ustunlar `|` bo'yicha; birinchi va oxirgi bo'lak — quvur atrofidagi bo'shliq.
      const cells: Array<{ lead: string; inline: Inline; tail: string }> = [];
      for (const raw of line.split("|")) {
        const lead = /^\s*/.exec(raw)![0];
        const tail = raw.slice(raw.trimEnd().length);
        const core = raw.slice(lead.length, raw.length - tail.length);
        cells.push({ lead, inline: inlineOf(core), tail: raw.length === lead.length ? "" : tail });
      }
      return { t: "row", cells };
    }
    const prefix = MD_PREFIX.exec(line)![1];
    const rest = line.slice(prefix.length);
    if (!rest.trim()) return { t: "pass" };
    const kind: SegmentKind = /#{1,6}\s+$/.test(prefix) ? "h" : /(?:[-*+]|\d+[.)])\s+$/.test(prefix) ? "li" : "p";
    return { t: "line", prefix, kind, inline: inlineOf(rest) };
  });
}

export function mdToSegments(text: string): Extracted {
  const { body } = splitBom(text);
  const segments: Segment[] = [];
  scanMd(body).forEach((l, i) => {
    if (l.t === "line") {
      segments.push({ id: `m:${i}`, text: l.inline.text, kind: l.kind, part: "text" });
      return;
    }
    if (l.t === "row") {
      l.cells.forEach((c, j) => {
        if (!c.inline.text.trim()) return;
        segments.push({ id: `m:${i}:${j}`, text: c.inline.text, kind: "cell", part: "text" });
      });
    }
  });
  return { segments, chars: 0, warnings: [] };
}

export function applyMd(text: string, map: SegmentMap): string {
  const { bom, body } = splitBom(text);
  const eol = eolOf(text);
  const src = body.split(/\r?\n/);
  const out = scanMd(body).map((l, i) => {
    if (l.t === "pass") return src[i];
    if (l.t === "line") {
      const t = map.get(`m:${i}`);
      if (t === undefined || !t.trim()) return src[i];
      return l.prefix + inlineBack(t, l.inline);
    }
    const cells = l.cells.map((c, j) => {
      const t = map.get(`m:${i}:${j}`);
      const body2 = t === undefined || !t.trim() ? inlineBack(c.inline.text, c.inline) : inlineBack(t, c.inline);
      return c.lead + body2 + c.tail;
    });
    return cells.join("|");
  });
  return bom + out.join(eol);
}

/* ── CSV ─────────────────────────────────────────────────────────── */

export const CSV_DELIMS = [",", ";", "\t"] as const;

/**
 * Ajratgich BIRINCHI qatordan aniqlanadi.
 *
 * Yevropa/rus Excel `;` bilan eksport qiladi, ingliz — `,` bilan.
 * Noto'g'ri taxmin butun faylni bitta ustunga aylantiradi va tarjimadan
 * keyin foydalanuvchi tanimaydigan fayl chiqadi.
 */
export function detectDelim(body: string): string {
  const line = /^[^\n]*/.exec(body)?.[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of CSV_DELIMS) {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

type Field = { value: string; quoted: boolean };
type Row = { fields: Field[]; eol: string };

function parseCsv(body: string, delim: string): Row[] {
  const rows: Row[] = [];
  let fields: Field[] = [];
  let value = "";
  let quoted = false;
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    fields.push({ value, quoted });
    value = "";
    quoted = false;
  };
  const endRow = (eol: string) => {
    endField();
    rows.push({ fields, eol });
    fields = [];
  };

  while (i < body.length) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      value += ch;
      i++;
      continue;
    }
    if (ch === '"' && !value) {
      inQuotes = true;
      quoted = true;
      i++;
      continue;
    }
    if (ch === delim) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const eol = ch === "\r" && body[i + 1] === "\n" ? "\r\n" : ch;
      endRow(eol);
      i += eol.length;
      continue;
    }
    value += ch;
    i++;
  }
  if (value || quoted || fields.length) endRow("");
  return rows;
}

function csvField(text: string, quoted: boolean, delim: string): string {
  const needs = quoted || text.includes(delim) || text.includes('"') || /[\r\n]/.test(text);
  return needs ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvToSegments(text: string): Extracted {
  const { body } = splitBom(text);
  const rows = parseCsv(body, detectDelim(body));
  const segments: Segment[] = [];
  rows.forEach((row, r) => {
    row.fields.forEach((f, c) => {
      if (!f.value.trim()) return;
      segments.push({
        id: `c:${r}:${c}`,
        text: toTokens(f.value),
        kind: "cell",
        ctx: r === 0 ? "header" : undefined,
        part: "text",
      });
    });
  });
  return { segments, chars: 0, warnings: [] };
}

export function applyCsv(text: string, map: SegmentMap): string {
  const { bom, body } = splitBom(text);
  const eol = eolOf(text);
  const delim = detectDelim(body);
  const rows = parseCsv(body, delim);
  const out = rows
    .map((row, r) => {
      const line = row.fields
        .map((f, c) => {
          const t = map.get(`c:${r}:${c}`);
          const value = t === undefined || !t.trim() ? f.value : fromTokens(t, eol);
          return csvField(value, f.quoted, delim);
        })
        .join(delim);
      return line + row.eol;
    })
    .join("");
  return bom + out;
}
