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
  const re = /(?:[ \t]*\r?\n){2,}[ \t]*/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out.push({ text: body.slice(at, m.index), sep: m[0] });
    at = m.index + m[0].length;
  }
  /*
   * Oxirgi paragrafning ORTIDAGI bo'shliq segmentga kirmaydi.
   *
   * Deyarli har matn fayli `\n` bilan tugaydi va usiz oxirgi segment
   * `…yerda.⟦br⟧` bo'lib chiqardi: model uchun ma'nosiz token, tarjimada
   * esa yo'qolib faylning oxirgi qator uzilishini olib ketardi.
   */
  const tail = body.slice(at);
  const trail = /\s*$/.exec(tail)![0];
  out.push({ text: tail.slice(0, tail.length - trail.length), sep: trail });
  return out;
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

const MD_LINK = /^!?\[/;

function inlineOf(src: string): Inline {
  const opaques: string[] = [];
  const links: string[] = [];
  const marks: string[] = [];
  let out = "";
  let i = 0;

  while (i < src.length) {
    const rest = src.slice(i);

    // Kod: `x` — mazmuni kod, tarjima qilinmaydi.
    const code = /^(`+)([^`]|[^`][\s\S]*?)\1/.exec(rest);
    if (code) {
      opaques.push(code[0]);
      out += `⟦${opaques.length}⟧`;
      i += code[0].length;
      continue;
    }
    // Avtomatik havola: <https://…>
    const auto = /^<(?:https?:\/\/|mailto:)[^>\s]+>/.exec(rest);
    if (auto) {
      opaques.push(auto[0]);
      out += `⟦${opaques.length}⟧`;
      i += auto[0].length;
      continue;
    }
    if (MD_LINK.test(rest)) {
      const link = /^(!?)\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/.exec(rest);
      if (link) {
        if (link[1] === "!") {
          // Rasm — `alt` matni ham tarjimaga arzimaydigan darajada texnik.
          opaques.push(link[0]);
          out += `⟦${opaques.length}⟧`;
        } else {
          links.push(link[3]);
          out += `⟦l${links.length}⟧${link[2]}⟦/l${links.length}⟧`;
        }
        i += link[0].length;
        continue;
      }
    }
    // Ta'kid: **x** __x__ ~~x~~ *x* _x_
    const mark = /^(\*\*|__|~~|\*|_)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (mark && marks.length < MAX_RUN_MARKERS) {
      marks.push(mark[1]);
      out += `⟦r${marks.length}⟧${mark[2]}⟦/r${marks.length}⟧`;
      i += mark[0].length;
      continue;
    }
    out += src[i];
    i++;
  }
  return { text: out.replace(/\t/g, "⟦tab⟧"), opaques, links, marks };
}

/** Tokenlarni asl Markdown belgilariga qaytaradi. */
function inlineBack(text: string, meta: Inline): string {
  return text
    .replace(/⟦(\d+)⟧/g, (m, n: string) => meta.opaques[Number(n) - 1] ?? "")
    .replace(/⟦l(\d+)⟧([\s\S]*?)⟦\/l\1⟧/g, (m, n: string, inner: string) => `[${inner}]${meta.links[Number(n) - 1] ?? ""}`)
    .replace(/⟦r(\d+)⟧([\s\S]*?)⟦\/r\1⟧/g, (m, n: string, inner: string) => {
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
        const tail = /\s*$/.exec(raw)![0];
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
