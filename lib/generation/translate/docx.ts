/**
 * DOCX adapteri — Word hujjatidan segment olish va tarjimani AYNAN
 * o'sha joylarga qaytarish.
 *
 * Asosiy qoida: hujjat qayta qurilmaydi. `word/document.xml` (va
 * kolontitul/izohlar) satrida faqat MATN tugunlari almashtiriladi;
 * `pPr`, `rPr`, `tblPr`, `sectPr`, `drawing`, raqamlash, uslublar, tema,
 * media — bayt-ba-bayt joyida qoladi. Shuning uchun tarjima qilingan
 * fayl Word/LibreOffice da asl maketda ochiladi.
 *
 * Eng nozik uch joy:
 *
 *  1. MAYDONLAR (`w:fldChar` guruhi). `PAGE`, `NUMPAGES`, `DATE`, `SEQ`,
 *     `PAGEREF` — butun guruh OPAQUE: ularning «natija» matni Word
 *     tomonidan qayta hisoblanadi va tarjima qilingani ma'nosiz (yoki
 *     zararli — `PAGEREF` keshini buzadi). `TOC`, `HYPERLINK`,
 *     `MERGEFIELD`, `QUOTE` da esa natija matni foydalanuvchi ko'radigan
 *     MATN (mundarija satrlari), shuning uchun u tarjima qilinadi.
 *  2. MATN QUTISI (`w:txbxContent`). Ichidagi `w:p` — mustaqil paragraf,
 *     tashqi paragrafda esa uni o'rab turgan run OPAQUE. Ikkalasi
 *     alohida segment bo'ladi va tuzatishlar bir-birini kesib o'tmaydi.
 *  3. TAQSIMLASH. Paragraf bir necha «zona» ga bo'linadi (matn / havola),
 *     tarjima esa opaque va havola tokenlari bo'yicha bo'linib zonalarga
 *     1:1 qaytariladi. Mos kelmasa — hammasi birinchi zonaga (matn
 *     yo'qolmaydi, faqat formatlash sodda bo'ladi).
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
  type SegmentKind,
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

/** Tarjima qilinadigan qismlar. `comments`/`glossary` ataylab tashqarida. */
function wantPart(name: string): boolean {
  return (
    name === "word/document.xml" ||
    /^word\/(header|footer)\d+\.xml$/.test(name) ||
    name === "word/footnotes.xml" ||
    name === "word/endnotes.xml"
  );
}

type PartMeta = { name: string; code: string; ctx?: string; kind: "body" | "note" };

function partMeta(name: string): PartMeta {
  if (name === "word/document.xml") return { name, code: "d0", kind: "body" };
  if (name === "word/footnotes.xml") return { name, code: "fn", ctx: "footnote", kind: "note" };
  if (name === "word/endnotes.xml") return { name, code: "en", ctx: "endnote", kind: "note" };
  const header = /^word\/header(\d+)\.xml$/.exec(name);
  if (header) return { name, code: `h${header[1]}`, ctx: "header", kind: "body" };
  const footer = /^word\/footer(\d+)\.xml$/.exec(name);
  if (footer) return { name, code: `f${footer[1]}`, ctx: "footer", kind: "body" };
  return { name, code: name, kind: "body" };
}

/** Qismlar barqaror tartibda — id lar ikki o'tishda ham bir xil bo'lsin. */
function orderedParts(names: string[]): string[] {
  return names.filter(wantPart).sort((a, b) => {
    const rank = (n: string) =>
      n === "word/document.xml" ? 0 : n.startsWith("word/header") ? 1 : n.startsWith("word/footer") ? 2 : 3;
    return rank(a) - rank(b) || numIn(a) - numIn(b) || a.localeCompare(b);
  });
}

/* ── run va rPr ──────────────────────────────────────────────────── */

/**
 * `rPr` ni formatlash KALITIGA aylantiradi.
 *
 * `w:rsid*` (tahrir seansi identifikatorlari), `w:lang` va `w:noProof`
 * olib tashlanadi: ular ko'rinishga ta'sir qilmaydi, lekin Word bitta
 * jumlani ular bo'yicha o'nlab runga bo'lib tashlaydi. Tozalanmasa har
 * so'z alohida «formatlangan span» bo'lib ko'rinardi va markerlar
 * chegarasi (4) darrov to'lib, butun paragraf dominant runga tushardi.
 */
export function rprKey(rpr: string): string {
  return rpr
    .replace(/<w:lang\b[^>]*\/>/g, "")
    .replace(/<w:lang\b[^>]*>[\s\S]*?<\/w:lang>/g, "")
    .replace(/<w:noProof\b[^>]*\/>/g, "")
    .replace(/\sw:rsid[A-Za-z]*="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Run ichida matndan boshqa nima bo'lsa — run OPAQUE bo'ladi. */
const TEXT_CHILDREN = new Set(["w:rPr", "w:t", "w:tab", "w:br", "w:cr", "w:lastRenderedPageBreak", "w:softHyphen"]);

type RunParse =
  | { ok: true; rPr: string; text: string }
  | { ok: false };

function parseRun(xml: string, r: Elem): RunParse {
  let rPr = "";
  let text = "";
  for (const c of children(xml, r.innerStart, r.innerEnd)) {
    if (!TEXT_CHILDREN.has(c.name)) return { ok: false };
    if (c.name === "w:rPr") rPr = xml.slice(c.start, c.end);
    else if (c.name === "w:t") text += xmlDecode(xml.slice(c.innerStart, c.innerEnd));
    else if (c.name === "w:tab") text += "⟦tab⟧";
    else if (c.name === "w:br" || c.name === "w:cr") text += "⟦br⟧";
  }
  return { ok: true, rPr, text };
}

/* ── maydonlar ───────────────────────────────────────────────────── */

/**
 * Butun guruhi OPAQUE bo'ladigan maydonlar.
 *
 * Ular Word tomonidan HISOBLANADI (sahifa raqami, sana, avtoraqam,
 * havola keshi). Ichidagi matn — kesh, uni tarjima qilish faylni
 * yangilaganda baribir yo'qoladi, lekin `PAGEREF`/`REF` da kesh matni
 * bilan birga bog'lanish ham buziladi.
 */
const OPAQUE_FIELDS = new Set([
  "PAGE", "NUMPAGES", "SECTIONPAGES", "DATE", "TIME", "SAVEDATE", "PRINTDATE",
  "CREATEDATE", "SEQ", "REF", "PAGEREF", "NOTEREF", "STYLEREF", "SYMBOL",
]);

export function fieldOpaque(instr: string): boolean {
  const t = instr.trim();
  if (!t) return false;
  // `= 2+2` — formula maydoni.
  if (t.startsWith("=")) return true;
  return OPAQUE_FIELDS.has((t.split(/\s+/)[0] ?? "").toUpperCase());
}

/* ── paragrafni qismlarga ajratish ───────────────────────────────── */

/** Zona uchun manba run: qayta yozishda `<w:r>` shu ma'lumotdan tiklanadi. */
type SrcRun = { attrs: string; rPr: string };

type ZoneSlot = { start: number; end: number; pass: string; runs: SrcRun[] };

type ParaPlan = {
  id: string;
  kind: SegmentKind;
  text: string;
  para: ParaText;
  slots: ZoneSlot[];
};

/** Paragraf ichidagi bitta element — ajratishdan keyin. */
type Item =
  | { t: "run"; el: Elem }
  | { t: "opaque" }
  | { t: "link"; runs: Elem[]; start: number; end: number }
  | { t: "pass"; el: Elem };

/** `w:ins`, `w:smartTag`, `w:sdt` — shaffof idishlar: ichidagi runlar ko'rinadi. */
const TRANSPARENT = new Set(["w:ins", "w:smartTag", "w:sdtContent", "w:bdo", "w:dir"]);

function flatten(xml: string, from: number, to: number, out: Item[]): void {
  for (const c of children(xml, from, to)) {
    if (c.name === "w:pPr" || c.name === "w:del" || c.name === "w:moveFrom") continue;
    if (c.name === "w:r") {
      out.push({ t: "run", el: c });
      continue;
    }
    if (c.name === "w:sdt") {
      const inner = children(xml, c.innerStart, c.innerEnd).find((x) => x.name === "w:sdtContent");
      if (inner) flatten(xml, inner.innerStart, inner.innerEnd, out);
      continue;
    }
    if (TRANSPARENT.has(c.name)) {
      flatten(xml, c.innerStart, c.innerEnd, out);
      continue;
    }
    if (c.name === "w:hyperlink") {
      const runs = children(xml, c.innerStart, c.innerEnd).filter((x) => x.name === "w:r");
      out.push({ t: "link", runs, start: c.start, end: c.end });
      continue;
    }
    if (c.name === "w:fldSimple") {
      if (fieldOpaque(attr(c.attrs, "w:instr") ?? "")) {
        out.push({ t: "opaque" });
        continue;
      }
      flatten(xml, c.innerStart, c.innerEnd, out);
      continue;
    }
    // Xatcho'p, imlo belgisi, izoh chegarasi — o'z joyida qoladi.
    out.push({ t: "pass", el: c });
  }
}

/** `w:fldChar` guruhlarini hisobga olib, runlarni matn/opaque ga ajratadi. */
type Classified = { kind: "text"; el: Elem; rPr: string; text: string } | { kind: "opaque" } | { kind: "pass"; el: Elem };

function classify(xml: string, items: Item[]): Array<Classified | { kind: "link"; runs: Elem[] }> {
  type Frame = { opaque: boolean; instr: string; result: boolean };
  const stack: Frame[] = [];
  const out: Array<Classified | { kind: "link"; runs: Elem[] }> = [];
  const opaqueNow = () => stack.some((f) => f.opaque) || (stack.length > 0 && !stack[stack.length - 1].result);

  for (const it of items) {
    if (it.t === "pass") {
      out.push({ kind: "pass", el: it.el });
      continue;
    }
    if (it.t === "opaque") {
      out.push({ kind: "opaque" });
      continue;
    }
    if (it.t === "link") {
      out.push({ kind: "link", runs: it.runs });
      continue;
    }
    const inner = xml.slice(it.el.innerStart, it.el.innerEnd);
    /*
     * Maydon hodisalari BITTA run ichida ham bo'lishi mumkin.
     *
     * `docx` kutubxonasi `PAGE` ni aynan shunday chiqaradi:
     * `<w:r><w:fldChar begin/><w:instrText>PAGE</w:instrText>
     * <w:fldChar separate/><w:fldChar end/></w:r>`. Faqat BIRINCHI
     * hodisani o'qish `begin` ni ko'rib freymni ochib qo'yardi va uni
     * hech qachon yopmasdi — paragrafning QOLGAN hamma matni «maydon
     * ko'rsatmasi» deb hisoblanib, tarjimasiz qolardi.
     */
    const events = [
      ...inner.matchAll(/<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"|<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g),
    ];
    if (events.length) {
      for (const ev of events) {
        const f = stack[stack.length - 1];
        if (ev[1] === "begin") stack.push({ opaque: false, instr: "", result: false });
        else if (ev[1] === "separate") {
          if (f) {
            f.result = true;
            f.opaque = fieldOpaque(f.instr);
          }
        } else if (ev[1] === "end") stack.pop();
        else if (f) {
          f.instr += xmlDecode(ev[2] ?? "");
          f.opaque = fieldOpaque(f.instr);
        }
      }
      out.push({ kind: "opaque" });
      continue;
    }
    const parsed = parseRun(xml, it.el);
    if (!parsed.ok || opaqueNow()) {
      out.push({ kind: "opaque" });
      continue;
    }
    out.push({ kind: "text", el: it.el, rPr: parsed.rPr, text: parsed.text });
  }
  return out;
}

/** Ketma-ket matn runlaridan bitta zona va uning yozish o'rnini yasaydi. */
function makeZone(xml: string, runs: Array<{ el: Elem; rPr: string; text: string }>, pass: Elem[], link: boolean): { part: ParaPart; slot: ZoneSlot } {
  const raw: ZoneRun[] = runs.map((r) => ({ key: rprKey(r.rPr), text: r.text }));
  const merged = mergeRuns(raw);
  const zone: Zone = { link, runs: merged.map((m) => ({ key: m.key, text: m.text })) };
  const start = runs[0].el.start;
  const end = runs[runs.length - 1].el.end;
  const inside = pass.filter((p) => p.start > start && p.end < end);
  return {
    part: { kind: "zone", zone },
    slot: {
      start,
      end,
      pass: inside.map((p) => xml.slice(p.start, p.end)).join(""),
      runs: merged.map((m) => ({ attrs: runs[m.first].el.attrs, rPr: runs[m.first].rPr })),
    },
  };
}

function paraKind(xml: string, p: Elem, inTable: boolean, note: boolean): SegmentKind {
  if (note) return "note";
  const pPr = children(xml, p.innerStart, p.innerEnd).find((c) => c.name === "w:pPr");
  if (pPr) {
    const inner = xml.slice(pPr.innerStart, pPr.innerEnd);
    const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(inner)?.[1] ?? "";
    if (/^title$/i.test(style) || /^(наименование|nomi)$/i.test(style)) return "title";
    if (/heading|sarlavha|заголовок/i.test(style) || /<w:outlineLvl\b/.test(inner)) return "h";
    if (/<w:numPr\b/.test(inner) || /list(paragraph|bullet|number)?/i.test(style)) return "li";
  }
  if (inTable) return "cell";
  return "p";
}

/**
 * Bitta qismni skanerlaydi.
 *
 * Extract va apply IKKALASI ham shu funksiyani chaqiradi — id lar aynan
 * bir xil chiqishi shundan kelib chiqadi. Apply hujjatni qaytadan
 * o'qiydi, ya'ni oraliq holatni saqlash/uzatish shart emas.
 */
function scanPart(xml: string, meta: PartMeta): ParaPlan[] {
  const tables = findAll(xml, "w:tbl").map((t) => [t.start, t.end] as const);
  const paras = findAll(xml, "w:p");
  const plans: ParaPlan[] = [];

  paras.forEach((p, i) => {
    const items: Item[] = [];
    flatten(xml, p.innerStart, p.innerEnd, items);
    const classified = classify(xml, items);

    const parts: ParaPart[] = [];
    const slots: ZoneSlot[] = [];
    let buf: Array<{ el: Elem; rPr: string; text: string }> = [];
    const pass: Elem[] = [];

    const flush = () => {
      if (!buf.length) return;
      const { part, slot } = makeZone(xml, buf, pass, false);
      parts.push(part);
      slots.push(slot);
      buf = [];
    };

    for (const c of classified) {
      if (c.kind === "pass") {
        pass.push(c.el);
        continue;
      }
      if (c.kind === "text") {
        buf.push(c);
        continue;
      }
      flush();
      if (c.kind === "opaque") {
        parts.push({ kind: "opaque" });
        continue;
      }
      // Havola: ichidagi runlar o'z zonasi bo'ladi.
      const linkRuns: Array<{ el: Elem; rPr: string; text: string }> = [];
      for (const r of c.runs) {
        const parsed = parseRun(xml, r);
        if (parsed.ok) linkRuns.push({ el: r, rPr: parsed.rPr, text: parsed.text });
      }
      if (!linkRuns.length) {
        parts.push({ kind: "opaque" });
        continue;
      }
      const { part, slot } = makeZone(xml, linkRuns, [], true);
      parts.push(part);
      slots.push(slot);
    }
    flush();

    if (!slots.length) return;
    const para = buildParaText(parts);
    const inTable = tables.some(([a, b]) => p.start > a && p.end < b);
    plans.push({
      id: `${meta.code}:p${i}`,
      kind: paraKind(xml, p, inTable, meta.kind === "note"),
      text: para.text,
      para,
      slots,
    });
  });

  return plans;
}

/* ── yozish ──────────────────────────────────────────────────────── */

/** Matnni `<w:t>` / `<w:tab/>` / `<w:br/>` ketma-ketligiga aylantiradi. */
function runBody(text: string): string {
  let out = "";
  for (const chunk of text.split(/(⟦tab⟧|⟦br⟧)/)) {
    if (!chunk) continue;
    if (chunk === "⟦tab⟧") out += "<w:tab/>";
    else if (chunk === "⟦br⟧") out += "<w:br/>";
    // `xml:space="preserve"` SHART: usiz Word boshidagi/oxiridagi
    // probelni yeb qo'yadi va «so'zso'z» bo'lib qo'shilib ketadi.
    else out += `<w:t xml:space="preserve">${xmlEscape(chunk)}</w:t>`;
  }
  return out;
}

function emitZone(slot: ZoneSlot, pieces: Piece[]): string {
  let out = slot.pass;
  for (const piece of pieces) {
    const src = slot.runs[piece.run] ?? slot.runs[0];
    const body = runBody(piece.text);
    if (!body) continue;
    out += `<w:r${src.attrs}>${src.rPr}${body}</w:r>`;
  }
  return out;
}

/* ── ommaviy API ─────────────────────────────────────────────────── */

export async function extractDocx(bytes: Uint8Array): Promise<Extracted> {
  const doc = await openOoxml(bytes, wantPart);
  const segments: Segment[] = [];
  for (const name of orderedParts(doc.names)) {
    const xml = doc.parts.get(name);
    if (!xml) continue;
    const meta = partMeta(name);
    for (const plan of scanPart(xml, meta)) {
      segments.push({ id: plan.id, text: plan.text, kind: plan.kind, ctx: meta.ctx, part: name });
    }
  }
  return { segments, chars: 0, warnings: [] };
}

export async function applyDocx(bytes: Uint8Array, map: SegmentMap): Promise<Uint8Array> {
  const doc = await openOoxml(bytes, wantPart);
  const changed = new Map<string, string>();

  for (const name of orderedParts(doc.names)) {
    const xml = doc.parts.get(name);
    if (!xml) continue;
    const edits: Edit[] = [];
    for (const plan of scanPart(xml, partMeta(name))) {
      const translated = map.get(plan.id);
      if (translated === undefined) continue;
      const perZone = distribute(translated, plan.para.zones);
      plan.para.zones.forEach((zp, i) => {
        const pieces = planZone(zp, perZone[i]);
        if (!pieces) return;
        edits.push({ start: plan.slots[i].start, end: plan.slots[i].end, text: emitZone(plan.slots[i], pieces) });
      });
    }
    if (edits.length) changed.set(name, applyEdits(xml, edits));
  }

  return saveOoxml(doc, changed);
}
