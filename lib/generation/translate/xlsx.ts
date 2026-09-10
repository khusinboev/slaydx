/**
 * XLSX adapteri — matn kataklarini tarjima qiladi, HISOBNI tegmaydi.
 *
 * Excel da matn ikki joyda yashaydi:
 *
 *  • `xl/sharedStrings.xml` — takrorlanmaydigan satrlar jadvali. Katak
 *    unga INDEKS bilan ishora qiladi (`<c t="s"><v>12</v></c>`). Shuning
 *    uchun `<si>` QO'SHISH yoki O'CHIRISH mumkin emas — barcha indekslar
 *    siljib, butun varaq buzilardi. `count`/`uniqueCount` atributlari ham
 *    shu sababdan tegilmaydi (biz sonni o'zgartirmayapmiz).
 *  • `<c t="inlineStr"><is>…</is></c>` — katakning ichida saqlangan matn.
 *
 * `<f>` (formula), `<v>` (hisoblangan qiymat), `t="str"` (formula
 * natijasi matn ko'rinishida) UMUMAN tegilmaydi: formulani tarjima
 * qilish uni ishlamaydigan qilib qo'yadi, `<v>` esa Excel qayta
 * hisoblaganda baribir almashadi.
 */

import { xmlDecode, xmlEscape } from "../xml";
import {
  buildParaText,
  distribute,
  mergeRuns,
  planZone,
  type Extracted,
  type ParaPart,
  type ParaText,
  type Piece,
  type Segment,
  type SegmentMap,
  type Zone,
  type ZoneRun,
} from "./segments";
import {
  applyEdits,
  attr,
  children,
  findAll,
  numIn,
  openOoxml,
  saveOoxml,
  type Edit,
  type Elem,
} from "./xml-scan";

const SHARED = "xl/sharedStrings.xml";
const SHEET_RE = /^xl\/worksheets\/sheet\d+\.xml$/;

function wantPart(name: string): boolean {
  return name === SHARED || SHEET_RE.test(name) || name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels";
}

/** Varaq nomlari — `workbook.xml` dagi tartibda, rels orqali faylga bog'lab. */
function sheetOrder(parts: Map<string, string>, names: string[]): Array<{ name: string; file: string }> {
  const book = parts.get("xl/workbook.xml") ?? "";
  const rels = parts.get("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const r of findAll(rels, "Relationship")) {
    const id = attr(r.attrs, "Id");
    const t = attr(r.attrs, "Target");
    if (id && t) target.set(id, t.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const out: Array<{ name: string; file: string }> = [];
  for (const s of findAll(book, "sheet")) {
    const label = xmlDecode(attr(s.attrs, "name") ?? "");
    const rid = attr(s.attrs, "r:id") ?? attr(s.attrs, "relationshipId") ?? "";
    const file = `xl/${target.get(rid) ?? ""}`;
    if (names.includes(file)) out.push({ name: label, file });
  }
  // Rels buzilgan bo'lsa ham varaqlar yo'qolmasin.
  for (const n of names.filter(SHEET_RE.test.bind(SHEET_RE)).sort((a, b) => numIn(a) - numIn(b))) {
    if (!out.some((s) => s.file === n)) out.push({ name: `Sheet${numIn(n)}`, file: n });
  }
  return out;
}

/** Excel `<t>` da qator uzilishi va tab XOM belgi bo'lib turadi. */
function toTokens(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\n/g, "⟦br⟧").replace(/\t/g, "⟦tab⟧");
}

function fromTokens(s: string): string {
  return s.replace(/⟦br⟧/g, "\n").replace(/⟦tab⟧/g, "\t");
}

type ZoneSlot = { start: number; end: number; rich: boolean; runs: Array<{ rPr: string }> };

type StrPlan = { id: string; text: string; para: ParaText; slots: ZoneSlot[]; ctx?: string };

/**
 * `<si>` yoki `<is>` ichini zonalarga ajratadi.
 *
 * `<rPh>` (yaponcha furigana) OPAQUE: u asosiy matnning o'qilishi va
 * uni tarjima qilish ma'nosiz.
 */
function parseString(xml: string, innerStart: number, innerEnd: number): { parts: ParaPart[]; slots: ZoneSlot[] } {
  const parts: ParaPart[] = [];
  const slots: ZoneSlot[] = [];
  let buf: Array<{ el: Elem; rPr: string; text: string }> = [];

  const flush = () => {
    if (!buf.length) return;
    const raw: ZoneRun[] = buf.map((r) => ({ key: r.rPr.replace(/\s+/g, " ").trim(), text: r.text }));
    const merged = mergeRuns(raw);
    const zone: Zone = { link: false, runs: merged.map((m) => ({ key: m.key, text: m.text })) };
    parts.push({ kind: "zone", zone });
    slots.push({
      start: buf[0].el.start,
      end: buf[buf.length - 1].el.end,
      rich: true,
      runs: merged.map((m) => ({ rPr: buf[m.first].rPr })),
    });
    buf = [];
  };

  for (const c of children(xml, innerStart, innerEnd)) {
    if (c.name === "t") {
      // Oddiy (boy bo'lmagan) satr — bitta `<t>` elementi.
      flush();
      parts.push({ kind: "zone", zone: { link: false, runs: [{ key: "", text: toTokens(xmlDecode(xml.slice(c.innerStart, c.innerEnd))) }] } });
      slots.push({ start: c.start, end: c.end, rich: false, runs: [{ rPr: "" }] });
      continue;
    }
    if (c.name === "r") {
      let rPr = "";
      let text = "";
      for (const rc of children(xml, c.innerStart, c.innerEnd)) {
        if (rc.name === "rPr") rPr = xml.slice(rc.start, rc.end);
        else if (rc.name === "t") text += toTokens(xmlDecode(xml.slice(rc.innerStart, rc.innerEnd)));
      }
      buf.push({ el: c, rPr, text });
      continue;
    }
    if (c.name === "rPh") {
      flush();
      parts.push({ kind: "opaque" });
      continue;
    }
    // `phoneticPr` va boshqalar — o'z joyida qoladi.
  }
  flush();
  return { parts, slots };
}

function emitZone(slot: ZoneSlot, pieces: Piece[]): string {
  if (!slot.rich) {
    const text = fromTokens(pieces.map((p) => p.text).join(""));
    return `<t xml:space="preserve">${xmlEscape(text)}</t>`;
  }
  let out = "";
  for (const piece of pieces) {
    const rPr = (slot.runs[piece.run] ?? slot.runs[0]).rPr;
    const text = fromTokens(piece.text);
    if (!text) continue;
    out += `<r>${rPr}<t xml:space="preserve">${xmlEscape(text)}</t></r>`;
  }
  return out;
}

/** Formula matni tarjima qilinmaydi — `=SUM(A1:A2)` kabi satrlar. */
function isFormulaText(text: string): boolean {
  return text.trimStart().startsWith("=");
}

type Scan = { shared: StrPlan[]; sheets: Map<string, StrPlan[]> };

function scanBook(parts: Map<string, string>, names: string[]): Scan {
  const sheets = new Map<string, StrPlan[]>();
  const order = sheetOrder(parts, names);

  // Umumiy satr qaysi varaqda birinchi uchraydi — `ctx` shundan.
  const sharedCtx = new Map<number, string>();
  order.forEach(({ name, file }) => {
    const xml = parts.get(file) ?? "";
    for (const m of xml.matchAll(/<c\b[^>]*\bt="s"[^>]*>\s*<v>(\d+)<\/v>/g)) {
      const idx = Number(m[1]);
      if (!sharedCtx.has(idx)) sharedCtx.set(idx, name);
    }
  });

  const sharedXml = parts.get(SHARED) ?? "";
  const shared: StrPlan[] = [];
  findAll(sharedXml, "si").forEach((si, i) => {
    const { parts: pp, slots } = parseString(sharedXml, si.innerStart, si.innerEnd);
    if (!slots.length) return;
    const para = buildParaText(pp);
    if (isFormulaText(para.text)) return;
    shared.push({ id: `x:s${i}`, text: para.text, para, slots, ctx: sharedCtx.get(i) });
  });

  order.forEach(({ name, file }, si) => {
    const xml = parts.get(file);
    if (!xml) return;
    const plans: StrPlan[] = [];
    for (const c of findAll(xml, "c")) {
      if (attr(c.attrs, "t") !== "inlineStr") continue;
      const is = children(xml, c.innerStart, c.innerEnd).find((x) => x.name === "is");
      if (!is) continue;
      const ref = attr(c.attrs, "r") ?? `${c.start}`;
      const { parts: pp, slots } = parseString(xml, is.innerStart, is.innerEnd);
      if (!slots.length) continue;
      const para = buildParaText(pp);
      if (isFormulaText(para.text)) continue;
      plans.push({ id: `x:i${si + 1}:${ref}`, text: para.text, para, slots, ctx: name });
    }
    if (plans.length) sheets.set(file, plans);
  });

  return { shared, sheets };
}

const FORMULA_WARNING = "Formulalar va raqamlar o'zgartirilmadi — ular hisob-kitobga bog'liq";

export async function extractXlsx(bytes: Uint8Array): Promise<Extracted> {
  const doc = await openOoxml(bytes, wantPart);
  const scan = scanBook(doc.parts, doc.names);
  const segments: Segment[] = [];
  for (const plan of scan.shared) {
    segments.push({ id: plan.id, text: plan.text, kind: "cell", ctx: plan.ctx, part: SHARED });
  }
  for (const [file, plans] of scan.sheets) {
    for (const plan of plans) segments.push({ id: plan.id, text: plan.text, kind: "cell", ctx: plan.ctx, part: file });
  }
  return { segments, chars: 0, warnings: [FORMULA_WARNING] };
}

function editsFor(plans: StrPlan[], map: SegmentMap): Edit[] {
  const edits: Edit[] = [];
  for (const plan of plans) {
    const translated = map.get(plan.id);
    if (translated === undefined) continue;
    const perZone = distribute(translated, plan.para.zones);
    plan.para.zones.forEach((zp, i) => {
      const pieces = planZone(zp, perZone[i]);
      if (!pieces) return;
      edits.push({ start: plan.slots[i].start, end: plan.slots[i].end, text: emitZone(plan.slots[i], pieces) });
    });
  }
  return edits;
}

export async function applyXlsx(bytes: Uint8Array, map: SegmentMap): Promise<Uint8Array> {
  const doc = await openOoxml(bytes, wantPart);
  const scan = scanBook(doc.parts, doc.names);
  const changed = new Map<string, string>();

  const sharedXml = doc.parts.get(SHARED);
  if (sharedXml) {
    const edits = editsFor(scan.shared, map);
    if (edits.length) changed.set(SHARED, applyEdits(sharedXml, edits));
  }
  for (const [file, plans] of scan.sheets) {
    const xml = doc.parts.get(file);
    if (!xml) continue;
    const edits = editsFor(plans, map);
    if (edits.length) changed.set(file, applyEdits(xml, edits));
  }

  return saveOoxml(doc, changed);
}
