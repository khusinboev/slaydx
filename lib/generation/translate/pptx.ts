/**
 * PPTX adapteri — slayd va ma'ruzachi izohlaridagi matnni almashtiradi.
 *
 * DOCX bilan bir xil g'oya (offsetli tuzatish, zona/token modeli), lekin
 * DrawingML ning uch farqi bor:
 *
 *  • `<a:br/>` run ICHIDA emas, run YONIDA turadi — shuning uchun u
 *    qo'shni running matniga `⟦br⟧` bo'lib qo'shiladi va qayta yozishda
 *    runlar orasiga `<a:br/>` bo'lib qaytadi;
 *  • tabulyatsiya alohida teg emas, `<a:t>` ichidagi oddiy `\t` belgisi;
 *  • giperhavola alohida element emas, `<a:rPr>` ichidagi
 *    `<a:hlinkClick>` — ya'ni «havola zonasi» = ketma-ket havolali runlar.
 *
 * Maket, tema, shrift, rang, jadval tuzilishi, rasm — umuman tegilmaydi:
 * biz faqat `<a:t>` tugunlarini qayta yozamiz. Diagramma (`ppt/charts`)
 * va SmartArt keshi (`ppt/diagrams`) ATAYIN tashqarida qoladi: ularning
 * matni o'z ma'lumot modeliga bog'langan va uni qayta yozish diagrammani
 * buzadi. Foydalanuvchi bu haqda ogohlantirish oladi.
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
  children,
  findAll,
  numIn,
  openOoxml,
  saveOoxml,
  type Edit,
  type Elem,
} from "./xml-scan";

const SLIDE_RE = /^ppt\/slides\/slide\d+\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide\d+\.xml$/;
const SLIDE_RELS_RE = /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/;
const GRAPHIC_RE = /^ppt\/(charts|diagrams)\/.*\.xml$/;

function wantPart(name: string): boolean {
  return SLIDE_RE.test(name) || NOTES_RE.test(name) || SLIDE_RELS_RE.test(name) || GRAPHIC_RE.test(name);
}

type PartMeta = { name: string; code: string; ctx: string; notes: boolean };

/**
 * `notesSlideN.xml` → u TEGISHLI slayd raqami.
 *
 * Fayl raqami slayd raqamiga TENG EMAS: PowerPoint izohni faqat kerak
 * bo'lganda yaratadi, ya'ni 5-slaydning izohi `notesSlide1.xml` bo'lishi
 * mumkin. Kontekst yorlig'i («notes 5») ko'ruvchida foydalanuvchiga
 * ko'rinadi, shuning uchun u rels orqali ANIQ hisoblanadi.
 */
function notesOwners(parts: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [name, xml] of parts) {
    if (!SLIDE_RELS_RE.test(name)) continue;
    const slide = numIn(name.replace(/\.rels$/, ""));
    for (const m of xml.matchAll(/Target="([^"]*notesSlide\d+\.xml)"/g)) {
      out.set(`ppt/notesSlides/${m[1].split("/").pop()}`, slide);
    }
  }
  return out;
}

function partMeta(name: string, owners: Map<string, number>): PartMeta {
  const n = numIn(name);
  return NOTES_RE.test(name)
    ? { name, code: `n${n}`, ctx: `notes ${owners.get(name) ?? n}`, notes: true }
    : { name, code: `s${n}`, ctx: `slide ${n}`, notes: false };
}

/** Slaydlar RAQAM bo'yicha tartiblanadi — `slide10` `slide2` dan keyin. */
function orderedParts(names: string[]): string[] {
  return names
    .filter((n) => SLIDE_RE.test(n) || NOTES_RE.test(n))
    .sort((a, b) => {
      const rank = (n: string) => (SLIDE_RE.test(n) ? 0 : 1);
      return rank(a) - rank(b) || numIn(a) - numIn(b);
    });
}

/** `a:rPr` ni formatlash kalitiga — til va imlo belgilari ko'rinishga tegmaydi. */
export function aRprKey(rpr: string): string {
  return rpr
    .replace(/\s(lang|altLang|dirty|err|smtClean|noProof)="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const RUN_CHILDREN = new Set(["a:rPr", "a:t"]);

type RunParse = { ok: true; rPr: string; text: string } | { ok: false };

function parseRun(xml: string, r: Elem): RunParse {
  let rPr = "";
  let text = "";
  for (const c of children(xml, r.innerStart, r.innerEnd)) {
    if (!RUN_CHILDREN.has(c.name)) return { ok: false };
    if (c.name === "a:rPr") rPr = xml.slice(c.start, c.end);
    else text += xmlDecode(xml.slice(c.innerStart, c.innerEnd)).replace(/\t/g, "⟦tab⟧");
  }
  return { ok: true, rPr, text };
}

type Atom = { el: Elem; rPr: string; text: string; link: boolean };

type ZoneSlot = { start: number; end: number; runs: Array<{ rPr: string }> };

type ParaPlan = { id: string; kind: SegmentKind; text: string; para: ParaText; slots: ZoneSlot[] };

function makeZone(atoms: Atom[], link: boolean): { part: ParaPart; slot: ZoneSlot } {
  const raw: ZoneRun[] = atoms.map((a) => ({ key: aRprKey(a.rPr), text: a.text }));
  const merged = mergeRuns(raw);
  const zone: Zone = { link, runs: merged.map((m) => ({ key: m.key, text: m.text })) };
  return {
    part: { kind: "zone", zone },
    slot: {
      start: atoms[0].el.start,
      end: atoms[atoms.length - 1].el.end,
      runs: merged.map((m) => ({ rPr: atoms[m.first].rPr })),
    },
  };
}

/** Shakl turini (`p:ph type`) va `a:tc` oraliqlarini oldindan yig'adi. */
type Shapes = { ph: Array<{ start: number; end: number; type: string }>; cells: Array<[number, number]> };

function shapesOf(xml: string): Shapes {
  const ph: Shapes["ph"] = [];
  for (const sp of findAll(xml, "p:sp")) {
    const inner = xml.slice(sp.start, sp.end);
    const m = /<p:ph\b[^>]*\btype="([^"]*)"/.exec(inner);
    ph.push({ start: sp.start, end: sp.end, type: m ? m[1] : "" });
  }
  const cells = findAll(xml, "a:tc").map((c) => [c.start, c.end] as [number, number]);
  return { ph, cells };
}

function paraKind(p: Elem, shapes: Shapes, notes: boolean): SegmentKind {
  if (notes) return "note";
  if (shapes.cells.some(([a, b]) => p.start > a && p.end < b)) return "cell";
  // Eng ICHKI shakl — guruhlangan shakllarda tashqisi ham mos keladi.
  let best: string | null = null;
  let bestSize = Number.POSITIVE_INFINITY;
  for (const s of shapes.ph) {
    if (p.start <= s.start || p.end >= s.end) continue;
    if (s.end - s.start < bestSize) {
      bestSize = s.end - s.start;
      best = s.type;
    }
  }
  if (best === "title" || best === "ctrTitle") return "title";
  if (best === "subTitle") return "h";
  return "p";
}

function scanPart(xml: string, meta: PartMeta): ParaPlan[] {
  const shapes = shapesOf(xml);
  const plans: ParaPlan[] = [];

  findAll(xml, "a:p").forEach((p, i) => {
    const parts: ParaPart[] = [];
    const slots: ZoneSlot[] = [];
    let buf: Atom[] = [];
    let pendingBr: { el: Elem } | null = null;

    const flush = () => {
      if (!buf.length) {
        pendingBr = null;
        return;
      }
      // Zona ichidagi bir xil havola holati bo'yicha bo'lib chiqamiz.
      let from = 0;
      for (let k = 1; k <= buf.length; k++) {
        if (k < buf.length && buf[k].link === buf[from].link) continue;
        const group = buf.slice(from, k);
        const { part, slot } = makeZone(group, group[0].link);
        parts.push(part);
        slots.push(slot);
        from = k;
      }
      buf = [];
      pendingBr = null;
    };

    for (const c of children(xml, p.innerStart, p.innerEnd)) {
      if (c.name === "a:pPr" || c.name === "a:endParaRPr") continue;
      if (c.name === "a:br") {
        // `<a:br/>` qo'shni runga `⟦br⟧` bo'lib qo'shiladi; zona oralig'i
        // uni o'z ichiga oladi, ya'ni qayta yozishda joyi tiklanadi.
        if (buf.length) {
          buf[buf.length - 1].text += "⟦br⟧";
          buf[buf.length - 1].el = { ...buf[buf.length - 1].el, end: c.end };
        } else {
          pendingBr = { el: c };
        }
        continue;
      }
      if (c.name !== "a:r") {
        // `a:fld` (sahifa raqami, sana), `a:graphicFrame` va boshqalar.
        flush();
        parts.push({ kind: "opaque" });
        continue;
      }
      const parsed = parseRun(xml, c);
      if (!parsed.ok) {
        flush();
        parts.push({ kind: "opaque" });
        continue;
      }
      const link = /<a:hlinkClick\b/.test(parsed.rPr);
      const lead = pendingBr;
      pendingBr = null;
      // Havola chegarasi zonani bo'ladi (`flush` da), lekin XML oralig'i
      // uzilmaydi — shuning uchun runlar bitta buferda yig'iladi.
      buf.push({
        el: lead ? { ...c, start: lead.el.start } : c,
        rPr: parsed.rPr,
        text: (lead ? "⟦br⟧" : "") + parsed.text,
        link,
      });
    }
    flush();

    if (!slots.length) return;
    const para = buildParaText(parts);
    plans.push({
      id: `${meta.code}:p${i}`,
      kind: paraKind(p, shapes, meta.notes),
      text: para.text,
      para,
      slots,
    });
  });

  return plans;
}

/** `⟦br⟧` runlar ORASIGA `<a:br/>` bo'lib chiqadi, `⟦tab⟧` esa oddiy tab. */
function emitZone(slot: ZoneSlot, pieces: Piece[]): string {
  const out: string[] = [];
  for (const piece of pieces) {
    const rPr = (slot.runs[piece.run] ?? slot.runs[0]).rPr;
    const chunks = piece.text.split("⟦br⟧");
    chunks.forEach((chunk, i) => {
      if (i) out.push("<a:br/>");
      const body = chunk.replace(/⟦tab⟧/g, "\t");
      if (body) out.push(`<a:r>${rPr}<a:t>${xmlEscape(body)}</a:t></a:r>`);
    });
  }
  return out.join("");
}

/**
 * Diagramma/SmartArt ichida HARFLI matn bormi.
 *
 * Faqat shu holda ogohlantirish beriladi: raqamli o'qlar va bo'sh
 * keshlar uchun foydalanuvchini bezovta qilishning ma'nosi yo'q.
 */
function graphicWarning(parts: Map<string, string>): string[] {
  let count = 0;
  for (const [name, xml] of parts) {
    if (!GRAPHIC_RE.test(name)) continue;
    const hasText = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].some((m) => /\p{L}/u.test(xmlDecode(m[1])));
    if (hasText) count++;
  }
  return count ? [`${count} ta diagramma/SmartArt matni tarjima qilinmadi`] : [];
}

export async function extractPptx(bytes: Uint8Array): Promise<Extracted> {
  const doc = await openOoxml(bytes, wantPart);
  const owners = notesOwners(doc.parts);
  const segments: Segment[] = [];
  for (const name of orderedParts(doc.names)) {
    const xml = doc.parts.get(name);
    if (!xml) continue;
    const meta = partMeta(name, owners);
    for (const plan of scanPart(xml, meta)) {
      segments.push({ id: plan.id, text: plan.text, kind: plan.kind, ctx: meta.ctx, part: name });
    }
  }
  return { segments, chars: 0, warnings: graphicWarning(doc.parts) };
}

export async function applyPptx(bytes: Uint8Array, map: SegmentMap): Promise<Uint8Array> {
  const doc = await openOoxml(bytes, wantPart);
  const owners = notesOwners(doc.parts);
  const changed = new Map<string, string>();

  for (const name of orderedParts(doc.names)) {
    const xml = doc.parts.get(name);
    if (!xml) continue;
    const edits: Edit[] = [];
    for (const plan of scanPart(xml, partMeta(name, owners))) {
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
